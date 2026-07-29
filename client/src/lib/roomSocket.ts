export type RoomSocketMessage =
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

export type MediaIdentityMessage = {
  filename: string;
  sizeBytes: number;
  durationSeconds: number;
  mimeType: string;
  fingerprint: string;
};

export type PlaybackCommand = Extract<RoomSocketMessage, { type: 'play' | 'pause' | 'seek' }>;

export function createRoomSocket(roomId: string, clientId: string, onMessage: (message: RoomSocketMessage) => void) {
  const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3000';
  const socket = new WebSocket(wsUrl);

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'join-room', roomId, clientId }));
  });

  socket.addEventListener('message', (event) => {
    const message = parseMessage(event.data);

    if (message) {
      onMessage(message);
    }
  });

  return socket;
}

export function sendPlaybackCommand(socket: WebSocket | undefined, command: PlaybackCommand) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(command));
  }
}

export function sendMediaSelected(socket: WebSocket | undefined, media: MediaIdentityMessage) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'media-selected', media }));
  }
}

export function sendWebRTCMessage(
  socket: WebSocket | undefined,
  message:
    | { type: 'webrtc-offer' | 'webrtc-answer'; sdp: string; targetId?: string }
    | { type: 'webrtc-ice-candidate'; candidate: string; sdpMid: string | null; sdpMLineIndex: number | null; targetId?: string }
) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function parseMessage(message: unknown): RoomSocketMessage | undefined {
  if (typeof message !== 'string') {
    return undefined;
  }

  try {
    const parsed = JSON.parse(message) as RoomSocketMessage;

    if (
      parsed.type === 'joined-room' ||
      parsed.type === 'user-count' ||
      parsed.type === 'room-not-found' ||
      parsed.type === 'play' ||
      parsed.type === 'pause' ||
      parsed.type === 'seek' ||
      parsed.type === 'media-selected' ||
      parsed.type === 'error' ||
      parsed.type === 'webrtc-offer' ||
      parsed.type === 'webrtc-answer' ||
      parsed.type === 'webrtc-ice-candidate'
    ) {
      return parsed;
    }
  } catch {
    return undefined;
  }

  return undefined;
}
