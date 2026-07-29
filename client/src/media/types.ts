export type MediaIdentity = {
  filename: string;
  sizeBytes: number;
  durationSeconds: number;
  mimeType: string;
  fingerprint: string;
};

export type MediaDifference = {
  field: 'filename' | 'sizeBytes' | 'durationSeconds' | 'mimeType' | 'fingerprint';
  expected: string;
  actual: string;
};
