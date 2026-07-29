const CLIENT_ID_KEY = 'crushedplay:client-id';

export function getClientId() {
  const existingClientId = window.localStorage.getItem(CLIENT_ID_KEY);

  if (existingClientId) {
    return existingClientId;
  }

  const clientId = window.crypto.randomUUID();
  window.localStorage.setItem(CLIENT_ID_KEY, clientId);

  return clientId;
}
