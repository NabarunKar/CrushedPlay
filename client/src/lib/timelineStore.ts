import { ChatMessagePayload } from './roomSocket';

export type ChatItem = {
  kind: 'chat';
  message: ChatMessagePayload;
};

export type SystemItem = {
  kind: 'system';
  id: string;
  text: string;
  timestamp: number;
  groupId?: string;
  metadata?: string;
};

export type TimelineItem = ChatItem | SystemItem;

type Listener = (timeline: TimelineItem[]) => void;

const timeline: TimelineItem[] = [];
const listeners = new Set<Listener>();

let lastSystemEventTime = 0;
let lastSystemEventText = '';

function snapshot(): TimelineItem[] {
  return [...timeline];
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

export function getTimeline(): TimelineItem[] {
  return snapshot();
}

export function appendChatMessage(message: ChatMessagePayload) {
  if (!timeline.some((m) => m.kind === 'chat' && m.message.id === message.id)) {
    timeline.push({ kind: 'chat', message });
    emit();
  }
}

export function appendSystemEvent(text: string) {
  const now = Date.now();
  timeline.push({
    kind: 'system',
    id: `sys-${now}-${Math.random().toString(36).substring(2, 9)}`,
    text,
    timestamp: now
  });
  emit();
}

export function appendPlaybackEvent(text: string, type: 'play' | 'pause' | 'seek', senderId: string) {
  const now = Date.now();
  const lastItem = timeline[timeline.length - 1];

  if (
    lastItem &&
    lastItem.kind === 'system' &&
    lastItem.groupId === `playback-${senderId}` &&
    now - lastItem.timestamp < 1500
  ) {
    if (type === 'seek') {
      lastItem.text = text;
      lastItem.timestamp = now;
      lastItem.metadata = type;
      emit();
    } else if (lastItem.metadata === 'seek') {
      // Ignore 'play' or 'pause' if they happen immediately after a 'seek'
      return;
    } else {
      lastItem.text = text;
      lastItem.timestamp = now;
      lastItem.metadata = type;
      emit();
    }
    return;
  }

  timeline.push({
    kind: 'system',
    id: `sys-${now}-${Math.random().toString(36).substring(2, 9)}`,
    text,
    timestamp: now,
    groupId: `playback-${senderId}`,
    metadata: type
  });
  emit();
}

export function reset() {
  if (timeline.length === 0) {
    return;
  }
  timeline.length = 0;
  lastSystemEventTime = 0;
  lastSystemEventText = '';
  emit();
}
