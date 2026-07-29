import { FormEvent, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { createRoom } from '../lib/api';
import { saveRoomHostId } from '../lib/hostIdentity';

export function LandingPage() {
  const history = useHistory();
  const [roomCode, setRoomCode] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  async function handleCreateRoom() {
    setIsCreating(true);
    setError('');

    try {
      const room = await createRoom();
      saveRoomHostId(room.roomId, room.hostId);
      history.push(`/room/${room.roomId}`);
    } catch {
      setError('Unable to create a room. Please try again.');
      setIsCreating(false);
    }
  }

  function handleJoinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedRoomCode = roomCode.trim();

    if (trimmedRoomCode.length > 0) {
      history.push(`/room/${encodeURIComponent(trimmedRoomCode)}`);
    }
  }

  return (
    <main className="page page-centered">
      <section className="hero-card" aria-labelledby="landing-title">
        <p className="eyebrow">Private watch parties for local files</p>
        <h1 id="landing-title">CrushedPlay</h1>
        <p className="lede">
          A clean foundation for watching videos together with friends over the internet.
        </p>

        <div className="actions">
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
