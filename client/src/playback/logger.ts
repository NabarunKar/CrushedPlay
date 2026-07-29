let lastTimeUpdateLog = 0;

export function logPlayerEvent(eventName: string, video: HTMLVideoElement) {
  if (eventName === 'timeupdate') {
    const now = Date.now();

    if (now - lastTimeUpdateLog < 1000) {
      return;
    }

    lastTimeUpdateLog = now;
  }

  console.log('[player]', eventName, {
    currentTime: video.currentTime,
    duration: Number.isFinite(video.duration) ? video.duration : undefined
  });
}
