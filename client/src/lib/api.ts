export type Room = {
  roomId: string;
  users: number;
  hostId: string;
};

export async function createRoom() {
  const response = await fetch('/api/rooms', {
    method: 'POST'
  });

  if (!response.ok) {
    throw new Error('Unable to create room');
  }

  return (await response.json()) as Pick<Room, 'roomId' | 'hostId'>;
}

export async function getRoom(roomId: string) {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`);

  if (response.status === 404) {
    return undefined;
  }

  if (!response.ok) {
    throw new Error('Unable to load room');
  }

  return (await response.json()) as Room;
}
