import { convertSrtToVtt } from './srt';
import { SubtitleTrack } from './types';

export async function createLocalSubtitleTrack(file: File): Promise<SubtitleTrack> {
  const extension = getFileExtension(file.name);
  const sourceText = await file.text();
  const vttText = extension === 'srt' ? convertSrtToVtt(sourceText) : sourceText;
  const blob = new Blob([vttText], { type: 'text/vtt' });
  const src = URL.createObjectURL(blob);

  return {
    id: `${file.name}-${file.size}-${file.lastModified}`,
    src,
    filename: file.name,
    label: getSubtitleLabel(file.name),
    language: getLanguageFromFilename(file.name) ?? 'Unknown',
    kind: 'subtitles',
    isDefault: true,
    cleanup: () => URL.revokeObjectURL(src)
  };
}

function getFileExtension(filename: string) {
  return filename.split('.').pop()?.toLowerCase();
}

function getSubtitleLabel(filename: string) {
  return filename.replace(/\.(srt|vtt)$/i, '') || 'External subtitles';
}

function getLanguageFromFilename(filename: string) {
  const match = filename.match(/\.([a-z]{2,3})(?:[-_][a-z]{2,4})?\.(?:srt|vtt)$/i);
  return match?.[1]?.toLowerCase();
}
