import { sendWebRTCMessage } from './roomSocket';

export class WebRTCManager {
  private peerConnection: RTCPeerConnection;
  private dataChannel?: RTCDataChannel;
  private socket: WebSocket | undefined;

  constructor(socket: WebSocket | undefined) {
    this.socket = socket;
    this.peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    this.peerConnection.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        sendWebRTCMessage(this.socket, {
          type: 'webrtc-ice-candidate',
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex
        });
      }
    });

    this.peerConnection.addEventListener('datachannel', (event) => {
      this.dataChannel = event.channel;
      this.setupDataChannel();
    });
  }

  public async startAsHost() {
    console.log('[WebRTC] Starting as host. Creating DataChannel...');
    this.dataChannel = this.peerConnection.createDataChannel('file-transfer', {
      negotiated: false
    });
    this.setupDataChannel();

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    console.log('[WebRTC] Created and sent SDP Offer');

    if (this.peerConnection.localDescription) {
      sendWebRTCMessage(this.socket, {
        type: 'webrtc-offer',
        sdp: this.peerConnection.localDescription.sdp
      });
    }
  }

  public async handleOffer(sdp: string, senderId: string) {
    console.log('[WebRTC] Received SDP Offer. Creating Answer...');
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    console.log('[WebRTC] Sent SDP Answer');

    if (this.peerConnection.localDescription) {
      sendWebRTCMessage(this.socket, {
        type: 'webrtc-answer',
        sdp: this.peerConnection.localDescription.sdp,
        targetId: senderId
      });
    }
  }

  public async handleAnswer(sdp: string) {
    console.log('[WebRTC] Received SDP Answer. Setting remote description...');
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
  }

  public async handleIceCandidate(candidate: string, sdpMid: string | null, sdpMLineIndex: number | null) {
    console.log('[WebRTC] Received remote ICE candidate');
    await this.peerConnection.addIceCandidate(new RTCIceCandidate({ candidate, sdpMid, sdpMLineIndex }));
  }

  private setupDataChannel() {
    if (!this.dataChannel) return;

    this.dataChannel.binaryType = 'arraybuffer';
    this.dataChannel.bufferedAmountLowThreshold = 1024 * 1024; // 1MB threshold

    this.dataChannel.addEventListener('open', () => {
      console.log('[WebRTC] DataChannel opened');
    });

    let receivedSize = 0;
    let expectedSize = 0;
    let expectedHash = '';
    let startTime = 0;
    
    // OPFS state
    let fileHandle: FileSystemFileHandle | null = null;
    let writableStream: FileSystemWritableFileStream | null = null;
    let chunkCount = 0;
    
    // Async write queue to handle race conditions and order
    let writeQueue: ArrayBuffer[] = [];
    let isWriting = false;

    const processQueue = async () => {
      if (isWriting || !writableStream) return;
      isWriting = true;

      try {
        while (writeQueue.length > 0) {
          const chunk = writeQueue.shift()!;
          await writableStream.write(chunk);
          receivedSize += chunk.byteLength;
          chunkCount++;

          if (receivedSize >= expectedSize && expectedSize > 0) {
            // Close the stream immediately to flush to disk
            await writableStream.close();
            const endTime = performance.now();
            
            const elapsedSeconds = (endTime - startTime) / 1000;
            const mbps = (expectedSize / (1024 * 1024)) / elapsedSeconds;

            console.log(`[WebRTC] Transfer finished.`);
            console.log(`[WebRTC] Received ${expectedSize} bytes directly to OPFS in ${chunkCount} chunks.`);
            console.log(`[WebRTC] Elapsed time: ${elapsedSeconds.toFixed(2)}s`);
            console.log(`[WebRTC] Throughput: ${mbps.toFixed(2)} MB/s`);

            // Verify integrity by extracting the File from OPFS
            if (fileHandle) {
              console.log(`[WebRTC] Extracting File object from OPFS...`);
              const file = await fileHandle.getFile();
              
              // Note: arrayBuffer() reads the whole file into RAM.
              // For a 5GB file this will crash, but it works for our Milestone 2 & 3 test files.
              const arrayBuffer = await file.arrayBuffer();
              const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
              const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

              console.log(`[WebRTC] Sender SHA-256:   ${expectedHash}`);
              console.log(`[WebRTC] Receiver SHA-256: ${hashHex}`);
              
              if (hashHex === expectedHash) {
                console.log('[WebRTC] SUCCESS: Hashes match exactly from OPFS disk! 🚀');
              } else {
                console.error('[WebRTC] ERROR: Hash mismatch!');
              }
            }

            // Cleanup
            writableStream = null;
            fileHandle = null;
            receivedSize = 0;
            expectedSize = 0;
            break; // Stop processing since transfer is done
          }
        }
      } catch (err) {
        console.error('[WebRTC] Error writing chunk to OPFS:', err);
      } finally {
        isWriting = false;
      }
    };

    this.dataChannel.addEventListener('message', async (event) => {
      if (typeof event.data === 'string') {
        const msg = JSON.parse(event.data);
        if (msg.type === 'transfer-start') {
          console.log(`[WebRTC] Transfer started. Expecting ${msg.size} bytes. Expected Hash: ${msg.expectedHash}`);
          expectedSize = msg.size;
          expectedHash = msg.expectedHash;
          receivedSize = 0;
          chunkCount = 0;
          writeQueue = [];
          startTime = performance.now();
          
          try {
            const opfsRoot = await navigator.storage.getDirectory();
            fileHandle = await opfsRoot.getFileHandle(msg.filename || 'transfer.bin', { create: true });
            writableStream = await fileHandle.createWritable();
            console.log(`[WebRTC] OPFS stream opened for ${msg.filename}`);
            processQueue(); // Process any chunks that arrived while opening
          } catch (err) {
            console.error('[WebRTC] Failed to initialize OPFS:', err);
          }
        }
      } else if (event.data instanceof ArrayBuffer) {
        writeQueue.push(event.data);
        processQueue();
      }
    });
  }

  public async transferFile(file: File) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.error('[WebRTC] DataChannel is not open');
      return;
    }

    const CHUNK_SIZE = 64 * 1024; // 64 KB

    console.log(`[WebRTC] Hashing original file (${file.name}, ${file.size} bytes)...`);
    const fileBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', fileBuffer);
    const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    console.log(`[WebRTC] Original SHA-256: ${hashHex}`);

    this.dataChannel.send(JSON.stringify({
      type: 'transfer-start',
      filename: file.name,
      size: file.size,
      expectedHash: hashHex
    }));

    console.log(`[WebRTC] Starting chunked transfer...`);
    const startTime = performance.now();
    let offset = 0;
    let chunkCount = 0;

    const waitForBackpressure = () => {
      return new Promise<void>((resolve) => {
        if (!this.dataChannel || this.dataChannel.bufferedAmount <= this.dataChannel.bufferedAmountLowThreshold) {
          resolve();
          return;
        }
        const listener = () => {
          this.dataChannel?.removeEventListener('bufferedamountlow', listener);
          resolve();
        };
        this.dataChannel.addEventListener('bufferedamountlow', listener);
      });
    };

    while (offset < file.size) {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();
      
      await waitForBackpressure();
      
      this.dataChannel.send(buffer);
      offset += buffer.byteLength;
      chunkCount++;
    }

    const endTime = performance.now();
    const elapsedSeconds = (endTime - startTime) / 1000;
    const mbps = (file.size / (1024 * 1024)) / elapsedSeconds;

    console.log(`[WebRTC] Sent ${file.size} bytes in ${chunkCount} chunks.`);
    console.log(`[WebRTC] Send elapsed time: ${elapsedSeconds.toFixed(2)}s`);
    console.log(`[WebRTC] Send throughput: ${mbps.toFixed(2)} MB/s`);
  }

  public destroy() {
    this.dataChannel?.close();
    this.peerConnection.close();
  }
}
