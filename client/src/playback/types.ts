import { SubtitleTrack } from '../subtitles';

export type PlaybackSourceKind = 'local-file' | 'temporary-upload' | 'progressive-relay' | 'google-drive';

export type PlaybackVideo = {
  src: string;
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  codec?: string;
  width?: number;
  height?: number;
};

export type AudioTrack = {
  id: string;
  index: number;
  language: string;
  codec: string;
  channels?: number;
  isDefault: boolean;
  title?: string;
  playable: boolean;
};

export type PlaybackSession = {
  id: string;
  kind: PlaybackSourceKind;
  sourceUrl: string;
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  video: PlaybackVideo;
  audioTracks: AudioTrack[];
  subtitleTracks: SubtitleTrack[];
  cleanup: () => void;
};

export interface PlaybackProvider<Input> {
  kind: PlaybackSourceKind;
  createSession(input: Input): Promise<PlaybackSession>;
}
