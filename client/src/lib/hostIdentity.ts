const HOST_ID_PREFIX = 'crushedplay:room-host:';

export function saveRoomHostId(roomId: string, hostId: string) {
  window.sessionStorage.setItem(`${HOST_ID_PREFIX}${roomId}`, hostId);
}

export function getRoomHostId(roomId: string) {
  return window.sessionStorage.getItem(`${HOST_ID_PREFIX}${roomId}`);
}
