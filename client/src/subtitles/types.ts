export type SubtitleTrack = {
  id: string;
  src?: string;
  filename: string;
  label: string;
  language: string;
  kind: 'subtitles';
  isDefault: boolean;
  isForced?: boolean;
  codec?: string;
  title?: string;
  source: 'external' | 'embedded';
  playable: boolean;
  cleanup: () => void;
};
