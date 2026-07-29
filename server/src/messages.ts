export type ClientMessage =
  | {
      type: 'join-room';
      roomId: string;
      clientId: string;
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

export type ServerMessage =
  | {
      type: 'joined-room';
      roomId: string;
      users: number;
      hostId: string;
      isHost: boolean;
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
    };
