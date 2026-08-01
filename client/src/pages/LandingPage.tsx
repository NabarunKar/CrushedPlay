import { FormEvent, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { createRoom } from '../lib/api';
import { saveRoomHostId } from '../lib/hostIdentity';
import { MAX_USERNAME_LENGTH, validateUsername } from '../lib/username';

export function LandingPage() {
  const history = useHistory();
  const [username, setUsername] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  function resolveUsername(): string | undefined {
    const result = validateUsername(username);

    if (!result.ok) {
      setError(result.error);
      return undefined;
    }

    return result.value;
  }

  async function handleCreateRoom() {
    setError('');

    const validUsername = resolveUsername();

    if (!validUsername) {
      return;
    }

    setIsCreating(true);

    try {
      const room = await createRoom();
      saveRoomHostId(room.roomId, room.hostId);
      history.push(`/room/${room.roomId}`, { username: validUsername });
    } catch {
      setError('Unable to create a room. Please try again.');
      setIsCreating(false);
    }
  }

  function handleJoinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    const validUsername = resolveUsername();

    if (!validUsername) {
      return;
    }

    const trimmedRoomCode = roomCode.trim();

    if (trimmedRoomCode.length > 0) {
      history.push(`/room/${encodeURIComponent(trimmedRoomCode)}`, { username: validUsername });
    }
  }

  return (
    <main className="page page-centered">
      <section className="hero-card" aria-labelledby="landing-title">
        <p className="eyebrow">Watch parties, simplified.</p>
        <div className="title-container">
          <h1 id="landing-title" className="app-title">CrushedPlay_</h1>
          <img src="/assets/giant-clash.gif" alt="" className="title-gif" />
        </div>
        <p className="lede">
          A clean foundation for watching videos together with friends over the internet.
        </p>

        <div className="actions">
          <form className="join-form" onSubmit={(event) => event.preventDefault()}>
            <label htmlFor="username">Your username</label>
            <div className="input-row">
              <input
                id="username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="e.g. Kurosawa"
                autoComplete="off"
                maxLength={MAX_USERNAME_LENGTH}
              />
            </div>
          </form>

          <button type="button" className="primary-button" onClick={handleCreateRoom} disabled={isCreating}>
            {isCreating ? 'Creating...' : 'Create Room'}
          </button>

          <form className="join-form" onSubmit={handleJoinRoom}>
            <label htmlFor="room-code">Join Room</label>
            <div className="input-row">
              <input
                id="room-code"
                type="text"
                value={roomCode}
                onChange={(event) => setRoomCode(event.target.value)}
                placeholder="Enter room code"
                autoComplete="off"
              />
              <button type="submit" className="secondary-button">
                Join
              </button>
            </div>
          </form>

          {error ? <p className="form-error">{error}</p> : null}
        </div>
      </section>
    </main>
  );
}
