import { FormEvent, useState } from 'react';
import { MAX_USERNAME_LENGTH, validateUsername } from '../lib/username';

type UsernameModalProps = {
  title?: string;
  description?: string;
  submitLabel?: string;
  onSubmit: (username: string) => void;
};

/**
 * Modal overlay used to capture a username before joining a room.
 *
 * The modal is intentionally self-contained: it holds its own input state,
 * runs validation locally, and only calls `onSubmit` with a validated,
 * trimmed username. Nothing is persisted.
 */
export function UsernameModal({
  title = 'What should we call you?',
  description = 'Pick a display name for this watch party. It will be visible to everyone in the room.',
  submitLabel = 'Join Room',
  onSubmit
}: UsernameModalProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const result = validateUsername(value);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setError('');
    onSubmit(result.value);
  }

  return (
    <div className="debug-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="username-modal-title">
      <div className="debug-modal panel" style={{ maxWidth: '440px', gap: '16px' }}>
        <div>
          <p className="eyebrow">Join room</p>
          <h2 id="username-modal-title" style={{ margin: '4px 0 8px 0' }}>{title}</h2>
          <p className="lede" style={{ margin: 0 }}>{description}</p>
        </div>

        <form className="join-form" onSubmit={handleSubmit}>
          <label htmlFor="username-input">Username</label>
          <div className="input-row">
            <input
              id="username-input"
              type="text"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="e.g. Tarkovsky"
              autoComplete="off"
              autoFocus
              maxLength={MAX_USERNAME_LENGTH}
            />
            <button type="submit" className="primary-button">
              {submitLabel}
            </button>
          </div>
          {error ? <p className="form-error">{error}</p> : null}
        </form>
      </div>
    </div>
  );
}
