import { sendWebRTCMessage } from './roomSocket';

export class WebRTCManager {
  private peerConnection: RTCPeerConnection;
  private dataChannel: RTCDataChannel | null = null;
  private socket: WebSocket | undefined;
  private onTransferComplete?: (file: File) => void;
  public onProgress?: (transferred: number, total: number) => void;

  constructor(socket: WebSocket | undefined, onTransferComplete?: (file: File) => void) {
    this.socket = socket;
    this.onTransferComplete = onTransferComplete;
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
    let startTime = 0;
    
    // OPFS state
    let fileHandle: FileSystemFileHandle | null = null;
    let writableStream: FileSystemWritableFileStream | null = null;
    let chunkCount = 0;
    
    let writeQueue: ArrayBuffer[] = [];
    let isWriting = false;
    let lastReportTime = 0;

    const processQueue = async () => {
      if (isWriting || !writableStream) return;
      isWriting = true;

      try {
        while (writeQueue.length > 0) {
          const chunk = writeQueue.shift()!;
          await writableStream.write(chunk);
          receivedSize += chunk.byteLength;
          chunkCount++;

          const now = performance.now();
          if (now - lastReportTime > 50 || receivedSize >= expectedSize) {
            lastReportTime = now;
            if (this.onProgress && expectedSize > 0) {
              this.onProgress(receivedSize, expectedSize);
            }
          }

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

            // Inform about successful transfer completion
            if (fileHandle) {
              console.log(`[WebRTC] Extracting File object from OPFS...`);
              const file = await fileHandle.getFile();
              
              console.log('[WebRTC] SUCCESS: WebRTC transfer complete! 🚀');
              if (this.onTransferComplete) {
                this.onTransferComplete(file);
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
          console.log(`[WebRTC] Transfer started. Expecting ${msg.size} bytes.`);
          expectedSize = msg.size;
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

    this.dataChannel.send(JSON.stringify({
      type: 'transfer-start',
      filename: file.name,
      size: file.size
    }));

    console.log(`[WebRTC] Starting chunked transfer...`);
    const startTime = performance.now();
    let offset = 0;
    let chunkCount = 0;
    let lastReportTime = 0;

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

      const now = performance.now();
      if (now - lastReportTime > 50 || offset >= file.size) {
        lastReportTime = now;
        if (this.onProgress) {
          this.onProgress(offset, file.size);
        }
      }
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
