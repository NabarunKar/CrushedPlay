import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getRoom } from '../lib/api';
import { getClientId } from '../lib/clientId';
import { createRoomSocket, sendPlaybackCommand } from '../lib/roomSocket';
import { formatDuration, localFileProvider, logPlayerEvent, PlaybackSession } from '../playback';

type RoomStatus = 'loading' | 'ready' | 'not-found' | 'error';

export function RoomPage() {
  const { roomId = 'unknown' } = useParams<{ roomId: string }>();
  const [status, setStatus] = useState<RoomStatus>('loading');
  const [users, setUsers] = useState(0);
  const [copyStatus, setCopyStatus] = useState('Copy Link');
  const [playbackSession, setPlaybackSession] = useState<PlaybackSession | undefined>();
  const [duration, setDuration] = useState<number | undefined>();
  const [currentTime, setCurrentTime] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<Plyr | null>(null);
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const remoteActionRef = useRef(false);
  const playbackSessionRef = useRef<PlaybackSession | undefined>(undefined);
  const shareUrl = useMemo(() => window.location.href, []);

  useEffect(() => {
    playbackSessionRef.current = playbackSession;
  }, [playbackSession]);

  useEffect(() => {
    let isMounted = true;
    let socket: WebSocket | undefined;

    async function loadRoom() {
      setStatus('loading');

      try {
        const room = await getRoom(roomId);

        if (!isMounted) {
          return;
        }

        if (!room) {
          setStatus('not-found');
          return;
        }

        setUsers(room.users);
        setStatus('ready');

        const clientId = getClientId();

        socket = createRoomSocket(roomId, clientId, (message) => {
          if (!isMounted) {
            return;
          }

          if (message.type === 'room-not-found') {
            setStatus('not-found');
            return;
          }

          if (message.type === 'joined-room' || message.type === 'user-count') {
            setUsers(message.users);
          }

          if (message.type === 'play' || message.type === 'pause' || message.type === 'seek') {
            applyRemotePlaybackCommand(message);
          }
        });
        socketRef.current = socket;
      } catch {
        if (isMounted) {
          setStatus('error');
        }
      }
    }

    loadRoom();

    return () => {
      isMounted = false;

      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'leave-room', roomId }));
      }

      socket?.close();
      socketRef.current = undefined;
    };
  }, [roomId]);

  useEffect(() => {
    const video = videoRef.current;

    if (!video || playerRef.current) {
      return;
    }

    playerRef.current = new Plyr(video, {
      controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'settings', 'fullscreen']
    });

    return () => {
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [status]);

  useEffect(() => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    const events = ['play', 'pause', 'seeked', 'ended', 'timeupdate', 'loadedmetadata'] as const;
    const handleEvent = (event: Event) => {
      if (event.type === 'loadedmetadata') {
        setDuration(video.duration);
      }

      if (event.type === 'timeupdate') {
        setCurrentTime(video.currentTime);
      }

      const eventName = event.type === 'seeked' ? 'seek' : event.type;
      logPlayerEvent(eventName, video);

      if (eventName === 'play' || eventName === 'pause' || eventName === 'seek') {
        if (remoteActionRef.current) {
          return;
        }

        sendPlaybackCommand(
          socketRef.current,
          eventName === 'seek'
            ? {
                type: 'seek',
                time: video.currentTime,
                playing: !video.paused
              }
            : {
                type: eventName,
                time: video.currentTime
              }
        );
      }
    };

    for (const eventName of events) {
      video.addEventListener(eventName, handleEvent);
    }

    return () => {
      for (const eventName of events) {
        video.removeEventListener(eventName, handleEvent);
      }
    };
  }, [status]);

  useEffect(() => {
    return () => {
      playbackSessionRef.current?.cleanup();
    };
  }, []);

  async function handleMovieSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const nextSession = await localFileProvider.createSession(file);
    playbackSessionRef.current?.cleanup();

    setPlaybackSession(nextSession);
    setDuration(undefined);
    setCurrentTime(0);

    if (videoRef.current) {
      videoRef.current.src = nextSession.sourceUrl;
      videoRef.current.load();
    }

    event.target.value = '';
  }

  function applyRemotePlaybackCommand(command: { type: 'play' | 'pause'; time: number } | { type: 'seek'; time: number; playing: boolean }) {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    remoteActionRef.current = true;

    if (command.type === 'seek') {
      video.currentTime = command.time;

      if (command.playing) {
        attemptRemotePlay();
      }
    }

    if (command.type === 'play') {
      video.currentTime = command.time;
      attemptRemotePlay();
    }

    if (command.type === 'pause') {
      video.currentTime = command.time;
      video.pause();
    }

    window.setTimeout(() => {
      remoteActionRef.current = false;
    }, 250);
  }

  function attemptRemotePlay() {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    void video.play().catch(() => {
      console.warn('[player] remote play was blocked by the browser');
    });
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyStatus('Copied');
      window.setTimeout(() => setCopyStatus('Copy Link'), 1800);
    } catch {
      setCopyStatus('Copy failed');
      window.setTimeout(() => setCopyStatus('Copy Link'), 1800);
    }
  }

  if (status === 'loading') {
    return (
      <main className="page page-centered">
        <section className="hero-card compact-card">
          <p className="eyebrow">Loading room</p>
          <h1>CrushedPlay</h1>
          <p className="lede">Checking whether this room exists...</p>
        </section>
      </main>
    );
  }

  if (status === 'not-found') {
    return (
      <main className="page page-centered">
        <section className="hero-card compact-card">
          <p className="eyebrow">Room not found</p>
          <h1>Room not found</h1>
          <p className="lede">This room does not exist or has already closed.</p>
          <Link className="primary-button button-link" to="/">
            Return Home
          </Link>
        </section>
      </main>
    );
  }

  if (status === 'error') {
    return (
      <main className="page page-centered">
        <section className="hero-card compact-card">
          <p className="eyebrow">Connection issue</p>
          <h1>Unable to load room</h1>
          <p className="lede">Please try again in a moment.</p>
          <Link className="primary-button button-link" to="/">
            Return Home
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page room-layout">
      <header className="room-header">
        <div>
          <p className="eyebrow">Watch room</p>
          <h1>CrushedPlay</h1>
        </div>
        <Link className="text-link" to="/">
          Back home
        </Link>
      </header>

      <section className="panel video-panel" aria-labelledby="video-heading">
        <div className="player-shell">
          <p className="section-kicker">Video player container</p>
          <h2 id="video-heading">Local playback</h2>
          <p className="role-badge">Shared controls enabled — anyone in the room can play, pause, or seek.</p>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept="video/*,.mkv"
            onChange={handleMovieSelected}
          />
          <button type="button" className="primary-button select-movie-button" onClick={() => fileInputRef.current?.click()}>
            Select Movie
          </button>

          <video ref={videoRef} className="player-video" playsInline controls />
        </div>
      </section>

      <aside className="room-sidebar" aria-label="Room details">
        <section className="panel">
          <p className="section-kicker">Room information</p>
          <h2>Room</h2>
          <p className="room-code">{roomId}</p>
          <p className="host-status">Shared playback controls enabled</p>
          <label className="share-label" htmlFor="share-url">
            Shareable URL
          </label>
          <input id="share-url" className="share-input" value={shareUrl} readOnly />
          <button type="button" className="secondary-button copy-button" onClick={handleCopyLink}>
            {copyStatus}
          </button>
        </section>

        <section className="panel">
          <p className="section-kicker">Connected users</p>
          <h2>Users</h2>
          <p className="user-count">Connected Users: {users}</p>
          {users <= 1 ? <p>Waiting for others...</p> : null}
        </section>

        <section className="panel">
          <p className="section-kicker">Playback details</p>
          <h2>Local movie</h2>
          <dl className="playback-details">
            <div>
              <dt>Filename</dt>
              <dd>{playbackSession?.filename ?? 'No movie selected'}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{formatDuration(duration)}</dd>
            </div>
            <div>
              <dt>Current time</dt>
              <dd>{formatDuration(currentTime)}</dd>
            </div>
          </dl>
        </section>
      </aside>
    </main>
  );
}
