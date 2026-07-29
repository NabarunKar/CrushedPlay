export type PlaybackSourceKind = 'local-file' | 'temporary-upload' | 'progressive-relay' | 'google-drive';

export type PlaybackSession = {
  id: string;
  kind: PlaybackSourceKind;
  sourceUrl: string;
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  cleanup: () => void;
};

export interface PlaybackProvider<Input> {
  kind: PlaybackSourceKind;
  createSession(input: Input): Promise<PlaybackSession>;
}
