import { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { ClientMessage, MediaIdentityMessage, Participant, ServerMessage } from './messages.js';
import { getRoom, joinRoom, leaveRoom } from './rooms.js';

type ClientState = {
  connectionId: string;
  clientId?: string;
  username?: string;
  roomId?: string;
};

export function createWebSocketServer(server: HttpServer) {
  const webSocketServer = new WebSocketServer({ server });
  const clients = new Map<WebSocket, ClientState>();

  webSocketServer.on('connection', (socket) => {
    const state: ClientState = {
      connectionId: randomUUID()
    };

    clients.set(socket, state);

    socket.on('message', (rawMessage) => {
      const message = parseMessage(rawMessage.toString());

      if (!message) {
        send(socket, { type: 'error', message: 'Invalid WebSocket message' });
        return;
      }

      if (message.type === 'join-room') {
        handleJoinRoom(socket, state, message.roomId, message.clientId, message.username, clients);
        return;
      }

      if (message.type === 'leave-room') {
        handleLeaveRoom(socket, state, clients, message.roomId);
        return;
      }

      if (message.type === 'play' || message.type === 'pause' || message.type === 'seek') {
        handlePlaybackMessage(socket, state, message, clients);
        return;
      }

      if (message.type === 'media-selected') {
        handleMediaSelected(socket, state, message.media, clients);
        return;
      }

      if (message.type === 'webrtc-offer' || message.type === 'webrtc-answer' || message.type === 'webrtc-ice-candidate') {
        handleWebRTCRelay(socket, state, message, clients);
        return;
      }

      if (message.type === 'send-chat-message') {
        handleSendChatMessage(socket, state, message, clients);
        return;
      }
    });

    socket.on('close', () => {
      handleLeaveRoom(socket, state, clients);
      clients.delete(socket);
    });
  });

  return webSocketServer;
}

function handleMediaSelected(
  socket: WebSocket,
  state: ClientState,
  media: MediaIdentityMessage,
  clients: Map<WebSocket, ClientState>
) {
  if (!state.roomId) {
    return;
  }

  for (const [client, clientState] of clients) {
    if (client !== socket && clientState.roomId === state.roomId) {
      send(client, { type: 'media-selected', media });
    }
  }
}

function handleWebRTCRelay(
  socket: WebSocket,
  state: ClientState,
  message: ClientMessage & { type: 'webrtc-offer' | 'webrtc-answer' | 'webrtc-ice-candidate' },
  clients: Map<WebSocket, ClientState>
) {
  if (!state.roomId || !state.clientId) {
    return;
  }

  for (const [client, clientState] of clients) {
    if (client !== socket && clientState.roomId === state.roomId) {
      if (!message.targetId || message.targetId === clientState.clientId) {
        send(client, { ...message, senderId: state.clientId });
      }
    }
  }
}

function handleSendChatMessage(
  socket: WebSocket,
  state: ClientState,
  message: ClientMessage & { type: 'send-chat-message' },
  clients: Map<WebSocket, ClientState>
) {
  if (!state.roomId || !state.username) {
    return;
  }

  const timestamp = Date.now();
  const id = `${timestamp}-${state.connectionId}`;

  const chatMessage: ServerMessage = {
    type: 'chat-message',
    message: {
      id,
      senderConnectionId: state.connectionId,
      senderUsername: state.username,
      text: message.text,
      timestamp
    }
  };

  for (const [client, clientState] of clients) {
    if (clientState.roomId === state.roomId) {
      send(client, chatMessage);
    }
  }
}

function handleJoinRoom(
  socket: WebSocket,
  state: ClientState,
  roomId: string,
  clientId: string,
  username: string,
  clients: Map<WebSocket, ClientState>
) {
  const existingRoom = getRoom(roomId);

  if (!existingRoom) {
    send(socket, { type: 'room-not-found', roomId });
    return;
  }

  if (state.roomId && state.roomId !== roomId) {
    handleLeaveRoom(socket, state, clients);
  }

  const participant: Participant = {
    connectionId: state.connectionId,
    clientId,
    username,
    isHost: clientId === existingRoom.hostId,
    joinedAt: Date.now()
  };

  const room = joinRoom(roomId, participant);

  if (!room) {
    send(socket, { type: 'room-not-found', roomId });
    return;
  }

  state.clientId = clientId;
  state.username = username;
  state.roomId = roomId;
  send(socket, {
    type: 'joined-room',
    roomId: room.roomId,
    users: room.users,
    hostId: room.hostId,
    isHost: participant.isHost,
    participants: room.participants
  });

  for (const [client, clientState] of clients) {
    if (client !== socket && clientState.roomId === roomId) {
      send(client, { type: 'participant-joined', participant });
    }
  }

  broadcastUserCount(room.roomId, room.users, clients);
}

function handlePlaybackMessage(
  socket: WebSocket,
  state: ClientState,
  message: ClientMessage & { type: 'play' | 'pause' | 'seek' },
  clients: Map<WebSocket, ClientState>
) {
  if (!state.roomId || !state.clientId) {
    return;
  }

  const room = getRoom(state.roomId);

  if (!room) {
    send(socket, { type: 'error', message: 'Room not found' });
    return;
  }

  for (const [client, clientState] of clients) {
    if (client !== socket && clientState.roomId === state.roomId) {
      if (message.type === 'seek') {
        send(client, { type: 'seek', time: message.time, playing: message.playing, senderConnectionId: state.connectionId });
      } else {
        send(client, { type: message.type, time: message.time, senderConnectionId: state.connectionId });
      }
    }
  }
}

function handleLeaveRoom(
  socket: WebSocket,
  state: ClientState,
  clients: Map<WebSocket, ClientState>,
  requestedRoomId?: string
) {
  const roomId = requestedRoomId ?? state.roomId;

  if (!roomId || state.roomId !== roomId) {
    return;
  }

  const leavingConnectionId = state.connectionId;
  const leavingClientId = state.clientId ?? '';

  state.roomId = undefined;
  const room = leaveRoom(roomId, leavingConnectionId);

  if (room) {
    for (const [client, clientState] of clients) {
      if (client !== socket && clientState.roomId === roomId) {
        send(client, {
          type: 'participant-left',
          connectionId: leavingConnectionId,
          clientId: leavingClientId
        });
      }
    }

    broadcastUserCount(room.roomId, room.users, clients);
  }

  if (socket.readyState === WebSocket.OPEN) {
    send(socket, { type: 'user-count', roomId, users: room?.users ?? 0 });
  }
}

function broadcastUserCount(roomId: string, users: number, clients: Map<WebSocket, ClientState>) {
  for (const [client, clientState] of clients) {
    if (clientState.roomId === roomId) {
      send(client, { type: 'user-count', roomId, users });
    }
  }
}

function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function parseMessage(message: string): ClientMessage | undefined {
  try {
    const parsed = JSON.parse(message) as Partial<ClientMessage>;

    if (parsed.type === 'join-room' && typeof parsed.roomId === 'string' && typeof parsed.clientId === 'string' && typeof parsed.username === 'string') {
      const trimmedUsername = parsed.username.trim();

      if (trimmedUsername.length === 0 || trimmedUsername.length > 24) {
        return undefined;
      }

      return {
        type: 'join-room',
        roomId: parsed.roomId,
        clientId: parsed.clientId,
        username: trimmedUsername
      };
    }

    if (parsed.type === 'leave-room') {
      return {
        type: 'leave-room',
        roomId: typeof parsed.roomId === 'string' ? parsed.roomId : undefined
      };
    }

    if (
      (parsed.type === 'play' || parsed.type === 'pause' || parsed.type === 'seek') &&
      typeof parsed.time === 'number' &&
      Number.isFinite(parsed.time)
    ) {
      if (parsed.type === 'seek') {
        return {
          type: 'seek',
          time: parsed.time,
          playing: typeof parsed.playing === 'boolean' ? parsed.playing : false
        };
      }

      return {
        type: parsed.type,
        time: parsed.time
      };
    }

    if (parsed.type === 'media-selected' && isMediaIdentity(parsed.media)) {
      return {
        type: 'media-selected',
        media: parsed.media
      };
    }

    if (parsed.type === 'webrtc-offer' || parsed.type === 'webrtc-answer') {
      if (typeof parsed.sdp === 'string') {
        return {
          type: parsed.type,
          sdp: parsed.sdp,
          targetId: typeof parsed.targetId === 'string' ? parsed.targetId : undefined
        };
      }
    }

    if (parsed.type === 'webrtc-ice-candidate') {
      if (typeof parsed.candidate === 'string') {
        return {
          type: 'webrtc-ice-candidate',
          candidate: parsed.candidate,
          sdpMid: typeof parsed.sdpMid === 'string' ? parsed.sdpMid : null,
          sdpMLineIndex: typeof parsed.sdpMLineIndex === 'number' ? parsed.sdpMLineIndex : null,
          targetId: typeof parsed.targetId === 'string' ? parsed.targetId : undefined
        };
      }
    }

    if (parsed.type === 'send-chat-message' && typeof parsed.text === 'string') {
      const trimmedText = parsed.text.trim();
      if (trimmedText.length > 0 && trimmedText.length <= 500) {
        return {
          type: 'send-chat-message',
          text: trimmedText
        };
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function isMediaIdentity(value: unknown): value is Extract<ClientMessage, { type: 'media-selected' }>['media'] {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const media = value as Record<string, unknown>;

  return (
    typeof media.filename === 'string' &&
    typeof media.sizeBytes === 'number' &&
    Number.isFinite(media.sizeBytes) &&
    typeof media.durationSeconds === 'number' &&
    Number.isFinite(media.durationSeconds) &&
    typeof media.mimeType === 'string' &&
    typeof media.fingerprint === 'string'
  );
}
