export type ClientMessage =
  | {
      type: 'join-room';
      roomId: string;
      clientId: string;
      username: string;
    }
  | {
      type: 'leave-room';
      roomId?: string;
    }
  | {
      type: 'play';
      time: number;
    }
  | {
      type: 'pause';
      time: number;
    }
  | {
      type: 'seek';
      time: number;
      playing: boolean;
    }
  | {
      type: 'webrtc-offer' | 'webrtc-answer';
      sdp: string;
      targetId?: string;
    }
  | {
      type: 'webrtc-ice-candidate';
      candidate: string;
      sdpMid: string | null;
      sdpMLineIndex: number | null;
      targetId?: string;
    }
  | {
      type: 'media-selected';
      media: MediaIdentityMessage;
    };

export type MediaIdentityMessage = {
  filename: string;
  sizeBytes: number;
  durationSeconds: number;
  mimeType: string;
  fingerprint: string;
};

export type Participant = {
  connectionId: string;
  clientId: string;
  username: string;
  isHost: boolean;
  joinedAt: number;
};

export type ServerMessage =
  | {
      type: 'joined-room';
      roomId: string;
      users: number;
      hostId: string;
      isHost: boolean;
      participants: Participant[];
    }
  | {
      type: 'participant-joined';
      participant: Participant;
    }
  | {
      type: 'participant-left';
      connectionId: string;
      clientId: string;
    }
  | {
      type: 'user-count';
      roomId: string;
      users: number;
    }
  | {
      type: 'room-not-found';
      roomId: string;
    }
  | {
      type: 'play';
      time: number;
    }
  | {
      type: 'pause';
      time: number;
    }
  | {
      type: 'seek';
      time: number;
      playing: boolean;
    }
  | {
      type: 'media-selected';
      media: MediaIdentityMessage;
    }
  | {
      type: 'error';
      message: string;
    }
  | {
      type: 'webrtc-offer' | 'webrtc-answer';
      sdp: string;
      senderId: string;
      targetId?: string;
    }
  | {
      type: 'webrtc-ice-candidate';
      candidate: string;
      sdpMid: string | null;
      sdpMLineIndex: number | null;
      senderId: string;
      targetId?: string;
    };
