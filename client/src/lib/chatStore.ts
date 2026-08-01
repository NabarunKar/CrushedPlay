import { ChatMessagePayload } from './roomSocket';

type Listener = (messages: ChatMessagePayload[]) => void;

const messages: ChatMessagePayload[] = [];
const listeners = new Set<Listener>();

function snapshot(): ChatMessagePayload[] {
  return [...messages];
}

function emit() {
  const current = snapshot();
  for (const listener of listeners) {
    listener(current);
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => {
    listeners.delete(listener);
  };
}

export function getMessages(): ChatMessagePayload[] {
  return snapshot();
}

export function appendMessage(message: ChatMessagePayload) {
  if (!messages.some((m) => m.id === message.id)) {
    messages.push(message);
    emit();
  }
}

export function reset() {
  if (messages.length === 0) {
    return;
  }
  messages.length = 0;
  emit();
}
