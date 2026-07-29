import { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { ClientMessage, ServerMessage } from './messages.js';
import { getRoom, joinRoom, leaveRoom } from './rooms.js';

type ClientState = {
  connectionId: string;
  clientId?: string;
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
        handleJoinRoom(socket, state, message.roomId, message.clientId, clients);
        return;
      }

      if (message.type === 'leave-room') {
        handleLeaveRoom(socket, state, clients, message.roomId);
        return;
      }

      if (message.type === 'play' || message.type === 'pause' || message.type === 'seek') {
        handlePlaybackMessage(socket, state, message, clients);
      }
    });

    socket.on('close', () => {
      handleLeaveRoom(socket, state, clients);
      clients.delete(socket);
    });
  });

  return webSocketServer;
}

function handleJoinRoom(
  socket: WebSocket,
  state: ClientState,
  roomId: string,
  clientId: string,
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

  const room = joinRoom(roomId, state.connectionId);

  if (!room) {
    send(socket, { type: 'room-not-found', roomId });
    return;
  }

  state.clientId = clientId;
  state.roomId = roomId;
  send(socket, {
    type: 'joined-room',
    roomId: room.roomId,
    users: room.users,
    hostId: room.hostId,
    isHost: clientId === room.hostId
  });
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
        send(client, { type: 'seek', time: message.time, playing: message.playing });
      } else {
        send(client, { type: message.type, time: message.time });
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

  state.roomId = undefined;
  const room = leaveRoom(roomId, state.connectionId);

  if (room) {
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

    if (parsed.type === 'join-room' && typeof parsed.roomId === 'string' && typeof parsed.clientId === 'string') {
      return {
        type: 'join-room',
        roomId: parsed.roomId,
        clientId: parsed.clientId
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
  } catch {
    return undefined;
  }

  return undefined;
}
