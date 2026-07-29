import mediaInfoFactory, { Track } from 'mediainfo.js';
import mediaInfoWasmUrl from 'mediainfo.js/MediaInfoModule.wasm?url';
import { SubtitleTrack } from '../subtitles';
import { AudioTrack, PlaybackVideo } from './types';

type MediaInfoTrack = Track & Record<string, unknown>;

export type MediaInspection = {
  video: Pick<PlaybackVideo, 'codec' | 'width' | 'height'>;
  audioTracks: AudioTrack[];
  subtitleTracks: SubtitleTrack[];
};

export async function inspectMediaFile(file: File): Promise<MediaInspection> {
  const mediaInfo = await mediaInfoFactory({
    format: 'object',
    locateFile: () => mediaInfoWasmUrl
  });

  try {
    const result = await mediaInfo.analyzeData(
      file.size,
      async (size, offset) => new Uint8Array(await file.slice(offset, offset + size).arrayBuffer())
    );

    return mapMediaInfo(result);
  } finally {
    mediaInfo.close();
  }
}

function mapMediaInfo(result: { media?: { track?: Track[] } }): MediaInspection {
  const tracks = (result.media?.track ?? []) as MediaInfoTrack[];
  const videoTrack = tracks.find((track) => track['@type'] === 'Video');
  const audioTracks = tracks.filter((track) => track['@type'] === 'Audio');
  const subtitleTracks = tracks.filter((track) => track['@type'] === 'Text');

  return {
    video: {
      codec: getString(videoTrack, 'Format') ?? getString(videoTrack, 'CodecID') ?? 'Unknown',
      width: getNumber(videoTrack, 'Width'),
      height: getNumber(videoTrack, 'Height')
    },
    audioTracks: audioTracks.map((track, index) => ({
      id: getString(track, 'ID') ?? `audio-${index}`,
      index,
      language: getLanguage(track),
      codec: getString(track, 'Format') ?? getString(track, 'CodecID') ?? 'Unknown',
      channels: getNumber(track, 'Channels'),
      isDefault: getFlag(track, 'Default'),
      title: getString(track, 'Title'),
      playable: false
    })),
    subtitleTracks: subtitleTracks.map((track, index) => ({
      id: getString(track, 'ID') ?? `embedded-subtitle-${index}`,
      filename: 'Embedded subtitle track',
      label: getString(track, 'Title') ?? `${getLanguage(track)} ${getString(track, 'Format') ?? 'subtitle'}`,
      language: getLanguage(track),
      kind: 'subtitles',
      isDefault: getFlag(track, 'Default'),
      isForced: getFlag(track, 'Forced'),
      codec: getString(track, 'Format') ?? getString(track, 'CodecID') ?? 'Unknown',
      title: getString(track, 'Title'),
      source: 'embedded',
      playable: false,
      cleanup: () => undefined
    }))
  };
}

function getString(track: MediaInfoTrack | undefined, key: string) {
  const value = track?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function getNumber(track: MediaInfoTrack | undefined, key: string) {
  const value = track?.[key];

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value.replace(/\s/g, ''));
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function getFlag(track: MediaInfoTrack, key: string) {
  const value = track[key] ?? track[`${key}_String`];

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return value.toLowerCase() === 'yes' || value.toLowerCase() === 'true';
  }

  return false;
}

function getLanguage(track: MediaInfoTrack) {
  return getString(track, 'Language') ?? getString(track, 'Language_String') ?? 'Unknown';
}
