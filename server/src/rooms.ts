import { customAlphabet } from 'nanoid';

const createRoomId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);

export type RoomSnapshot = {
  roomId: string;
  users: number;
  hostId: string;
};

type Room = {
  roomId: string;
  hostId: string;
  connections: Set<string>;
  cleanupTimer?: NodeJS.Timeout;
};

const rooms = new Map<string, Room>();

export function createRoom(hostId: string): RoomSnapshot {
  let roomId = createRoomId();

  while (rooms.has(roomId)) {
    roomId = createRoomId();
  }

  const room: Room = {
    roomId,
    hostId,
    connections: new Set<string>()
  };

  rooms.set(roomId, room);

  return getRoomSnapshot(room);
}

export function getRoom(roomId: string): RoomSnapshot | undefined {
  const room = rooms.get(roomId);

  if (!room) {
    return undefined;
  }

  return getRoomSnapshot(room);
}

export function joinRoom(roomId: string, connectionId: string): RoomSnapshot | undefined {
  const room = rooms.get(roomId);

  if (!room) {
    return undefined;
  }

  if (room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = undefined;
  }

  room.connections.add(connectionId);
  return getRoomSnapshot(room);
}

export function leaveRoom(roomId: string, connectionId: string): RoomSnapshot | undefined {
  const room = rooms.get(roomId);

  if (!room) {
    return undefined;
  }

  room.connections.delete(connectionId);

  if (room.connections.size === 0) {
    room.cleanupTimer = setTimeout(() => {
      if (room.connections.size === 0) {
        rooms.delete(roomId);
      }
    }, 5000);

    return undefined;
  }

  return getRoomSnapshot(room);
}

function getRoomSnapshot(room: Room): RoomSnapshot {
  return {
    roomId: room.roomId,
    users: room.connections.size,
    hostId: room.hostId
  };
}
