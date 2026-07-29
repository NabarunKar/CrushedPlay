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
      type: 'error';
      message: string;
    };

export type PlaybackCommand = Extract<RoomSocketMessage, { type: 'play' | 'pause' | 'seek' }>;

export function createRoomSocket(roomId: string, clientId: string, onMessage: (message: RoomSocketMessage) => void) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = import.meta.env.DEV ? 'localhost:3000' : window.location.host;
  const socket = new WebSocket(`${protocol}//${host}`);

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
      parsed.type === 'error'
    ) {
      return parsed;
    }
  } catch {
    return undefined;
  }

  return undefined;
}
