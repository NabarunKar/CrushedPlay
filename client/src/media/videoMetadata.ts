export function readVideoDuration(file: File) {
  return new Promise<number>((resolve, reject) => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);

    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
    };

    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = video.duration;
      cleanup();
      resolve(duration);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error('Unable to read video metadata'));
    };
    video.src = objectUrl;
  });
}
