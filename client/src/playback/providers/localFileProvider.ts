import { PlaybackProvider, PlaybackSession } from '../types';

export const localFileProvider: PlaybackProvider<File> = {
  kind: 'local-file',

  async createSession(file: File): Promise<PlaybackSession> {
    const sourceUrl = URL.createObjectURL(file);

    return {
      id: `${file.name}-${file.size}-${file.lastModified}`,
      kind: 'local-file',
      sourceUrl,
      filename: file.name,
      mimeType: file.type || undefined,
      sizeBytes: file.size,
      video: {
        src: sourceUrl,
        filename: file.name,
        mimeType: file.type || undefined,
        sizeBytes: file.size
      },
      subtitleTracks: [],
      cleanup: () => URL.revokeObjectURL(sourceUrl)
    };
  }
};
