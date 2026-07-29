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

    this.dataChannel.addEventListener('open', () => {
      console.log('[WebRTC] DataChannel opened');
      this.dataChannel?.send('Hello World from ' + (this.dataChannel.label || 'peer'));
    });

    this.dataChannel.addEventListener('message', (event) => {
      console.log(`[WebRTC] Received message: ${event.data}`);
    });
  }

  public destroy() {
    this.dataChannel?.close();
    this.peerConnection.close();
  }
}
