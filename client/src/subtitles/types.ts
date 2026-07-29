export type SubtitleTrack = {
  id: string;
  src: string;
  filename: string;
  label: string;
  language: string;
  kind: 'subtitles';
  isDefault: boolean;
  cleanup: () => void;
};
