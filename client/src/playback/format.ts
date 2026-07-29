export function formatDuration(seconds: number | undefined) {
  if (!seconds || !Number.isFinite(seconds)) {
    return '00:00';
  }

  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${padTime(minutes)}:${padTime(remainingSeconds)}`;
  }

  return `${padTime(minutes)}:${padTime(remainingSeconds)}`;
}

function padTime(value: number) {
  return value.toString().padStart(2, '0');
}
