import { MediaDifference, MediaIdentity } from './types';

const FINGERPRINT_BYTES = 4 * 1024 * 1024;

export async function createMediaIdentity(file: File, durationSeconds: number): Promise<MediaIdentity> {
  return {
    filename: file.name,
    sizeBytes: file.size,
    durationSeconds: normalizeDuration(durationSeconds),
    mimeType: file.type || 'unknown',
    fingerprint: await createPartialFingerprint(file)
  };
}

export function compareMediaIdentity(expected: MediaIdentity, actual: MediaIdentity): MediaDifference[] {
  const differences: MediaDifference[] = [];

  if (expected.filename !== actual.filename) {
    differences.push({ field: 'filename', expected: expected.filename, actual: actual.filename });
  }

  if (expected.sizeBytes !== actual.sizeBytes) {
    differences.push({ field: 'sizeBytes', expected: formatBytes(expected.sizeBytes), actual: formatBytes(actual.sizeBytes) });
  }

  if (Math.abs(expected.durationSeconds - actual.durationSeconds) > 1) {
    differences.push({
      field: 'durationSeconds',
      expected: formatDurationValue(expected.durationSeconds),
      actual: formatDurationValue(actual.durationSeconds)
    });
  }

  if (expected.mimeType !== actual.mimeType) {
    differences.push({ field: 'mimeType', expected: expected.mimeType, actual: actual.mimeType });
  }

  if (expected.fingerprint !== actual.fingerprint) {
    differences.push({ field: 'fingerprint', expected: expected.fingerprint, actual: actual.fingerprint });
  }

  return differences;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function normalizeDuration(durationSeconds: number) {
  return Number.isFinite(durationSeconds) ? Math.round(durationSeconds) : 0;
}

function formatDurationValue(durationSeconds: number) {
  return `${durationSeconds}s`;
}

async function createPartialFingerprint(file: File) {
  const slice = file.slice(0, Math.min(file.size, FINGERPRINT_BYTES));
  const hashBuffer = await crypto.subtle.digest('SHA-256', await slice.arrayBuffer());

  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24);
}
