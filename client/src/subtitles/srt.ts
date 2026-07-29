export function convertSrtToVtt(srtText: string) {
  const normalized = srtText
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  const withoutNumericCueIds = normalized.replace(/^\d+\n(?=\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->)/gm, '');
  const convertedTimestamps = withoutNumericCueIds.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    '$1.$2 --> $3.$4'
  );

  return `WEBVTT\n\n${convertedTimestamps}\n`;
}
