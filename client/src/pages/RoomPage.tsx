import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getRoom } from '../lib/api';
import { getClientId } from '../lib/clientId';
import { getRoomHostId } from '../lib/hostIdentity';
import { createRoomSocket, sendMediaSelected, sendPlaybackCommand } from '../lib/roomSocket';
import { compareMediaIdentity, createMediaIdentity, formatBytes, MediaDifference, MediaIdentity, readVideoDuration } from '../media';
import { formatDuration, localFileProvider, logPlayerEvent, PlaybackSession } from '../playback';

type RoomStatus = 'loading' | 'ready' | 'not-found' | 'error';
type VerificationStatus = 'none' | 'waiting' | 'verified' | 'mismatch';

export function RoomPage() {
  const { roomId = 'unknown' } = useParams<{ roomId: string }>();
  const [status, setStatus] = useState<RoomStatus>('loading');
  const [users, setUsers] = useState(0);
  const [copyStatus, setCopyStatus] = useState('Copy Link');
  const [isHost, setIsHost] = useState(false);
  const [playbackSession, setPlaybackSession] = useState<PlaybackSession | undefined>();
  const [selectedMedia, setSelectedMedia] = useState<MediaIdentity | undefined>();
  const [expectedMedia, setExpectedMedia] = useState<MediaIdentity | undefined>();
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>('none');
  const [mediaDifferences, setMediaDifferences] = useState<MediaDifference[]>([]);
  const [duration, setDuration] = useState<number | undefined>();
  const [currentTime, setCurrentTime] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<Plyr | null>(null);
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const isHostRef = useRef(false);
  const selectedMediaRef = useRef<MediaIdentity | undefined>(undefined);
  const remoteActionRef = useRef(false);
  const playbackSessionRef = useRef<PlaybackSession | undefined>(undefined);
  const shareUrl = useMemo(() => window.location.href, []);

  useEffect(() => {
    playbackSessionRef.current = playbackSession;
  }, [playbackSession]);

  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  useEffect(() => {
    selectedMediaRef.current = selectedMedia;
  }, [selectedMedia]);

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

        const clientId = getRoomHostId(roomId) ?? getClientId();

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

          if (message.type === 'joined-room') {
            setIsHost(message.isHost);
          }

          if (message.type === 'play' || message.type === 'pause' || message.type === 'seek') {
            applyRemotePlaybackCommand(message);
          }

          if (message.type === 'media-selected') {
            setExpectedMedia(message.media);
            compareAgainstExpectedMedia(message.media, selectedMediaRef.current);
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
    const fileDuration = await readVideoDuration(file);
    const mediaIdentity = await createMediaIdentity(file, fileDuration);
    playbackSessionRef.current?.cleanup();

    setPlaybackSession(nextSession);
    setSelectedMedia(mediaIdentity);
    setDuration(undefined);
    setCurrentTime(0);

    if (isHostRef.current) {
      setExpectedMedia(mediaIdentity);
      setVerificationStatus('verified');
      setMediaDifferences([]);
      sendMediaSelected(socketRef.current, mediaIdentity);
    } else if (expectedMedia) {
      compareAgainstExpectedMedia(expectedMedia, mediaIdentity);
    } else {
      setVerificationStatus('waiting');
      setMediaDifferences([]);
    }

    if (videoRef.current) {
      videoRef.current.src = nextSession.sourceUrl;
      videoRef.current.load();
    }

    event.target.value = '';
  }

  function compareAgainstExpectedMedia(expected: MediaIdentity, actual: MediaIdentity | undefined) {
    if (!actual) {
      setVerificationStatus('waiting');
      setMediaDifferences([]);
      return;
    }

    const differences = compareMediaIdentity(expected, actual);
    setMediaDifferences(differences);
    setVerificationStatus(differences.length === 0 ? 'verified' : 'mismatch');
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
          <p className="role-badge">
            {isHost
              ? 'You are Host — your selected movie defines the room media.'
              : 'Shared controls enabled — select the matching movie to verify.'}
          </p>
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
          <p className="host-status">{isHost ? 'Host media identity source' : 'Guest media verification'}</p>
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
          <p className="section-kicker">Media identity</p>
          <h2>Selected Movie</h2>
          <p className={`verification-status verification-${verificationStatus}`}>
            {verificationStatus === 'verified'
              ? '✓ Movie Verified'
              : verificationStatus === 'mismatch'
                ? 'Movie does not match.'
                : verificationStatus === 'waiting'
                  ? 'Waiting for matching file...'
                  : 'No movie selected'}
          </p>
          {expectedMedia ? (
            <div className="expected-media">
              <p className="section-kicker">Movie selected by host</p>
              <p>{expectedMedia.filename}</p>
              <p>{formatDuration(expectedMedia.durationSeconds)} · {formatBytes(expectedMedia.sizeBytes)}</p>
              <p>{expectedMedia.mimeType}</p>
            </div>
          ) : null}
          {mediaDifferences.length > 0 ? (
            <ul className="media-differences">
              {mediaDifferences.map((difference) => (
                <li key={difference.field}>
                  <strong>{difference.field}</strong>: expected {difference.expected}, got {difference.actual}
                </li>
              ))}
            </ul>
          ) : null}
          <dl className="playback-details">
            <div>
              <dt>Filename</dt>
              <dd>{selectedMedia?.filename ?? playbackSession?.filename ?? 'No movie selected'}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{selectedMedia ? formatBytes(selectedMedia.sizeBytes) : '—'}</dd>
            </div>
            <div>
              <dt>MIME type</dt>
              <dd>{selectedMedia?.mimeType ?? '—'}</dd>
            </div>
            <div>
              <dt>Fingerprint</dt>
              <dd>{selectedMedia?.fingerprint ?? '—'}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{formatDuration(selectedMedia?.durationSeconds ?? duration)}</dd>
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
