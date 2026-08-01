import { Participant } from './roomSocket';

/**
 * In-memory participant store for the current room. Straight mirror of the
 * server's participant registry — every participant corresponds to exactly
 * one WebSocket connection, keyed by `connectionId`.
 *
 * Lives at module scope (framework-agnostic) so it can be mutated from the
 * raw WebSocket message handler in `RoomPage` without going through React
 * state. React consumers subscribe via `subscribe` and mirror into their
 * own local state for rendering.
 */

type Listener = (participants: Participant[]) => void;

const participants = new Map<string, Participant>();
const listeners = new Set<Listener>();

function snapshot(): Participant[] {
  return Array.from(participants.values()).sort((a, b) => a.joinedAt - b.joinedAt);
}

function emit() {
  const current = snapshot();
  for (const listener of listeners) {
    listener(current);
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  // Fire once immediately so subscribers see current state without waiting
  // for the next mutation.
  listener(snapshot());
  return () => {
    listeners.delete(listener);
  };
}

export function getParticipants(): Participant[] {
  return snapshot();
}

export function setSnapshot(next: Participant[]) {
  participants.clear();
  for (const participant of next) {
    participants.set(participant.connectionId, participant);
  }
  emit();
}

export function addParticipant(participant: Participant) {
  participants.set(participant.connectionId, participant);
  emit();
}

export function removeParticipant(connectionId: string) {
  if (participants.delete(connectionId)) {
    emit();
  }
}

/**
 * Clear all participants. Called on room unmount so a subsequent room
 * doesn't inherit stale entries.
 */
export function reset() {
  if (participants.size === 0) {
    return;
  }
  participants.clear();
  emit();
}
