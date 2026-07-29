import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getRoom } from '../lib/api';
import { getClientId } from '../lib/clientId';
import { getRoomHostId } from '../lib/hostIdentity';
import { createRoomSocket, sendMediaSelected, sendPlaybackCommand } from '../lib/roomSocket';
import { compareMediaIdentity, createMediaIdentity, formatBytes, MediaDifference, MediaIdentity, readVideoDuration } from '../media';
import { formatDuration, inspectMediaFile, localFileProvider, logPlayerEvent, PlaybackSession } from '../playback';
import { AudioTrack } from '../playback/types';
import { createLocalSubtitleTrack, SubtitleTrack } from '../subtitles';
import { WebRTCManager } from '../lib/webrtcManager';

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
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [embeddedSubtitleTracks, setEmbeddedSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [videoCodec, setVideoCodec] = useState('Unknown');
  const [videoResolution, setVideoResolution] = useState('Unknown');
  const [currentAudioTrack, setCurrentAudioTrack] = useState('Browser default audio track');
  const [activeSubtitle, setActiveSubtitle] = useState('None');
  const [duration, setDuration] = useState<number | undefined>();
  const [currentTime, setCurrentTime] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const subtitleInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<Plyr | null>(null);
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const isHostRef = useRef(false);
  const selectedMediaRef = useRef<MediaIdentity | undefined>(undefined);
  const subtitleTracksRef = useRef<SubtitleTrack[]>([]);
  const remoteActionRef = useRef(false);
  const playbackSessionRef = useRef<PlaybackSession | undefined>(undefined);
  const webrtcManagerRef = useRef<WebRTCManager | null>(null);
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
    subtitleTracksRef.current = subtitleTracks;
  }, [subtitleTracks]);

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

          if (message.type === 'joined-room') {
            setIsHost(message.isHost);
            isHostRef.current = message.isHost;
          }

          if (message.type === 'joined-room' || message.type === 'user-count') {
            setUsers(message.users);
            if (isHostRef.current && message.users > 1) {
              webrtcManagerRef.current?.startAsHost().catch(console.error);
            }
          }

          if (message.type === 'play' || message.type === 'pause' || message.type === 'seek') {
            applyRemotePlaybackCommand(message);
          }

          if (message.type === 'media-selected') {
            setExpectedMedia(message.media);
            compareAgainstExpectedMedia(message.media, selectedMediaRef.current);
          }

          if (message.type === 'webrtc-offer' && 'senderId' in message) {
            webrtcManagerRef.current?.handleOffer(message.sdp, message.senderId as string).catch(console.error);
          }
          if (message.type === 'webrtc-answer') {
            webrtcManagerRef.current?.handleAnswer(message.sdp).catch(console.error);
          }
          if (message.type === 'webrtc-ice-candidate') {
            webrtcManagerRef.current?.handleIceCandidate(message.candidate, message.sdpMid, message.sdpMLineIndex).catch(console.error);
          }
        });
        socketRef.current = socket;
        webrtcManagerRef.current = new WebRTCManager(socket);
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
      webrtcManagerRef.current?.destroy();
      webrtcManagerRef.current = null;
    };
  }, [roomId]);

  useEffect(() => {
    const video = videoRef.current;

    if (!video || playerRef.current) {
      return;
    }

    playerRef.current = new Plyr(video, {
      controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'captions', 'settings', 'fullscreen'],
      captions: { active: true, language: 'auto', update: true }
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
    const updateActiveSubtitle = () => setActiveSubtitle(getActiveSubtitleLabel(video));
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

    for (const textTrack of video.textTracks) {
      textTrack.addEventListener('change', updateActiveSubtitle);
    }

    return () => {
      for (const eventName of events) {
        video.removeEventListener(eventName, handleEvent);
      }

      for (const textTrack of video.textTracks) {
        textTrack.removeEventListener('change', updateActiveSubtitle);
      }
    };
  }, [status]);

  useEffect(() => {
    return () => {
      playbackSessionRef.current?.cleanup();
      subtitleTracksRef.current.forEach((track) => track.cleanup());
    };
  }, []);

  async function handleMovieSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const nextSession = await localFileProvider.createSession(file);
    const mediaInspection = await inspectMediaFile(file);
    const fileDuration = await readVideoDuration(file);
    const mediaIdentity = await createMediaIdentity(file, fileDuration);
    playbackSessionRef.current?.cleanup();

    const enrichedSession: PlaybackSession = {
      ...nextSession,
      video: {
        ...nextSession.video,
        ...mediaInspection.video
      },
      audioTracks: mediaInspection.audioTracks,
      subtitleTracks: mediaInspection.subtitleTracks
    };

    setPlaybackSession(enrichedSession);
    setAudioTracks(mediaInspection.audioTracks);
    setEmbeddedSubtitleTracks(mediaInspection.subtitleTracks);
    setVideoCodec(mediaInspection.video.codec ?? 'Unknown');
    setVideoResolution(
      mediaInspection.video.width && mediaInspection.video.height
        ? `${mediaInspection.video.width} × ${mediaInspection.video.height}`
        : 'Unknown'
    );
    setCurrentAudioTrack(getBrowserAudioTrackLabel(videoRef.current, mediaInspection.audioTracks));
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

  async function handleSubtitleSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const nextTrack = await createLocalSubtitleTrack(file);
    subtitleTracksRef.current.forEach((track) => track.cleanup());
    setSubtitleTracks([nextTrack]);
    setActiveSubtitle(nextTrack.label);

    window.setTimeout(() => {
      playerRef.current?.toggleCaptions(true);
      setActiveSubtitle(getActiveSubtitleLabel(videoRef.current));
    }, 0);

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
          <input
            ref={subtitleInputRef}
            className="visually-hidden"
            type="file"
            accept=".srt,.vtt,text/vtt"
            onChange={handleSubtitleSelected}
          />
          <button type="button" className="primary-button select-movie-button" onClick={() => fileInputRef.current?.click()}>
            Select Movie
          </button>
          <button type="button" className="secondary-button load-subtitles-button" onClick={() => subtitleInputRef.current?.click()}>
            Load Subtitles
          </button>

          <video ref={videoRef} className="player-video" playsInline controls>
            {subtitleTracks.map((track) => (
              <track
                key={track.id}
                kind={track.kind}
                src={track.src}
                srcLang={track.language === 'Unknown' ? 'und' : track.language}
                label={track.label}
                default={track.isDefault}
              />
            ))}
          </video>
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
          <p className="section-kicker">Subtitles</p>
          <h2>Local subtitles</h2>
          <dl className="playback-details">
            <div>
              <dt>Subtitle filename</dt>
              <dd>{subtitleTracks[0]?.filename ?? 'No subtitles loaded'}</dd>
            </div>
            <div>
              <dt>Language</dt>
              <dd>{subtitleTracks[0]?.language ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt>Track count</dt>
              <dd>{subtitleTracks.length}</dd>
            </div>
            <div>
              <dt>External track count</dt>
              <dd>{subtitleTracks.length}</dd>
            </div>
            <div>
              <dt>Embedded track count</dt>
              <dd>{embeddedSubtitleTracks.length}</dd>
            </div>
            <div>
              <dt>Current active subtitle</dt>
              <dd>{activeSubtitle}</dd>
            </div>
          </dl>
          {embeddedSubtitleTracks.length > 0 ? (
            <ul className="track-list">
              {embeddedSubtitleTracks.map((track) => (
                <li key={track.id}>
                  <strong>{track.label}</strong> · {track.language} · {track.codec}
                  {track.isDefault ? ' · Default' : ''}
                  {track.isForced ? ' · Forced' : ''}
                  {!track.playable ? ' · Metadata only' : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="panel">
          <p className="section-kicker">Video</p>
          <h2>Container video</h2>
          <dl className="playback-details">
            <div>
              <dt>Codec</dt>
              <dd>{videoCodec}</dd>
            </div>
            <div>
              <dt>Resolution</dt>
              <dd>{videoResolution}</dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <p className="section-kicker">Audio</p>
          <h2>Audio tracks</h2>
          <dl className="playback-details">
            <div>
              <dt>Current track</dt>
              <dd>{currentAudioTrack}</dd>
            </div>
            <div>
              <dt>Track count</dt>
              <dd>{audioTracks.length}</dd>
            </div>
          </dl>
          {audioTracks.length > 0 ? (
            <ul className="track-list">
              {audioTracks.map((track) => (
                <li key={track.id}>
                  <strong>#{track.index + 1}</strong> · {track.language} · {track.codec}
                  {track.channels ? ` · ${track.channels} channels` : ''}
                  {track.title ? ` · ${track.title}` : ''}
                  {track.isDefault ? ' · Default' : ''}
                  {!track.playable ? ' · Metadata only' : ''}
                </li>
              ))}
            </ul>
          ) : null}
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

function getActiveSubtitleLabel(video: HTMLVideoElement | null) {
  if (!video) {
    return 'None';
  }

  for (const textTrack of video.textTracks) {
    if (textTrack.mode === 'showing') {
      return textTrack.label || textTrack.language || 'Unknown';
    }
  }

  return 'None';
}

function getBrowserAudioTrackLabel(video: HTMLVideoElement | null, inspectedTracks: AudioTrack[]) {
  const audioTracks = video ? (video as HTMLVideoElement & { audioTracks?: { length: number; [index: number]: { enabled: boolean; label?: string; language?: string } } }).audioTracks : undefined;

  if (audioTracks?.length) {
    for (let index = 0; index < audioTracks.length; index += 1) {
      const track = audioTracks[index];

      if (track.enabled) {
        return track.label || track.language || `Browser audio track ${index + 1}`;
      }
    }
  }

  const defaultTrack = inspectedTracks.find((track) => track.isDefault) ?? inspectedTracks[0];
  return defaultTrack ? `${defaultTrack.language} · ${defaultTrack.codec}` : 'Browser default audio track';
}
