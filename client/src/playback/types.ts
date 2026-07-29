import { SubtitleTrack } from '../subtitles';

export type PlaybackSourceKind = 'local-file' | 'temporary-upload' | 'progressive-relay' | 'google-drive';

export type PlaybackVideo = {
  src: string;
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
};

export type PlaybackSession = {
  id: string;
  kind: PlaybackSourceKind;
  sourceUrl: string;
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  video: PlaybackVideo;
  subtitleTracks: SubtitleTrack[];
  cleanup: () => void;
};

export interface PlaybackProvider<Input> {
  kind: PlaybackSourceKind;
  createSession(input: Input): Promise<PlaybackSession>;
}
