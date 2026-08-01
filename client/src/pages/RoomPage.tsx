import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { getRoom } from '../lib/api';
import { getClientId } from '../lib/clientId';
import { getRoomHostId } from '../lib/hostIdentity';
import { createRoomSocket, sendMediaSelected, sendPlaybackCommand, sendChatMessage, Participant, ChatMessagePayload } from '../lib/roomSocket';
import { addParticipant as storeAddParticipant, getParticipants, removeParticipant as storeRemoveParticipant, reset as resetParticipants, setSnapshot as setParticipantsSnapshot, subscribe as subscribeParticipants } from '../lib/participants';
import { appendMessage, getMessages, reset as resetChat, subscribe as subscribeChat } from '../lib/chatStore';
import { compareMediaIdentity, createMediaIdentity, formatBytes, MediaDifference, MediaIdentity, readVideoDuration } from '../media';
import { formatDuration, inspectMediaFile, localFileProvider, logPlayerEvent, PlaybackSession } from '../playback';
import { AudioTrack } from '../playback/types';
import { createLocalSubtitleTrack, SubtitleTrack } from '../subtitles';
import { WebRTCManager } from '../lib/webrtcManager';
import { UsernameModal } from '../components/UsernameModal';

type RoomStatus = 'loading' | 'ready' | 'not-found' | 'error';
type VerificationStatus = 'none' | 'waiting' | 'verified' | 'mismatch';

export function RoomPage() {
  const { roomId = 'unknown' } = useParams<{ roomId: string }>();
  const location = useLocation<{ username?: string } | undefined>();
  const initialUsername = typeof location.state?.username === 'string' ? location.state.username : undefined;
  const [username, setUsername] = useState<string | undefined>(initialUsername);
  const [status, setStatus] = useState<RoomStatus>('loading');
  const [users, setUsers] = useState(0);
  const [participants, setParticipants] = useState<Participant[]>(() => getParticipants());
  const [messages, setMessages] = useState<ChatMessagePayload[]>(() => getMessages());
  const localClientId = getClientId();
  const localConnectionId = participants.find(p => p.clientId === localClientId)?.connectionId;
  const [chatInput, setChatInput] = useState('');
  const [isChatExpanded, setIsChatExpanded] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
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
  const [showDebug, setShowDebug] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [transferProgress, setTransferProgress] = useState<{ transferred: number; total: number } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const subtitleInputRef = useRef<HTMLInputElement | null>(null);
  const transferInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<Plyr | null>(null);
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const isHostRef = useRef(false);
  const selectedMediaRef = useRef<MediaIdentity | undefined>(undefined);
  const expectedMediaRef = useRef<MediaIdentity | undefined>(undefined);
  const subtitleTracksRef = useRef<SubtitleTrack[]>([]);
  const remoteActionRef = useRef(false);
  const playbackSessionRef = useRef<PlaybackSession | undefined>(undefined);
  const webrtcManagerRef = useRef<WebRTCManager | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const isChatExpandedRef = useRef(isChatExpanded);
  const isScrolledToBottomRef = useRef(true);
  const shareUrl = useMemo(() => window.location.href, []);

  useEffect(() => {
    playbackSessionRef.current = playbackSession;
  }, [playbackSession]);

  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  useEffect(() => {
    isChatExpandedRef.current = isChatExpanded;
    if (isChatExpanded) {
      setUnreadCount(0);
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      }
    }
  }, [isChatExpanded]);

  useEffect(() => {
    if (messagesContainerRef.current && isChatExpanded) {
      if (isScrolledToBottomRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      }
    }
  }, [messages, isChatExpanded]);

  useEffect(() => {
    selectedMediaRef.current = selectedMedia;
  }, [selectedMedia]);

  useEffect(() => {
    expectedMediaRef.current = expectedMedia;
  }, [expectedMedia]);

  useEffect(() => {
    subtitleTracksRef.current = subtitleTracks;
  }, [subtitleTracks]);

  useEffect(() => {
    const unsubscribeParticipants = subscribeParticipants(setParticipants);
    const unsubscribeChat = subscribeChat(setMessages);
    return () => {
      unsubscribeParticipants();
      unsubscribeChat();
      resetParticipants();
      resetChat();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    let socket: WebSocket | undefined;

    if (!username) {
      // Wait for the user to submit a username via <UsernameModal> before
      // touching the room API or opening a WebSocket. This effect will re-run
      // as soon as `username` is set.
      return;
    }

    const currentUsername = username;

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

        socket = createRoomSocket(roomId, clientId, currentUsername, (message) => {
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
            setParticipantsSnapshot(message.participants);
          }

          if (message.type === 'joined-room' || message.type === 'user-count') {
            setUsers(message.users);
            if (isHostRef.current && message.users > 1) {
              webrtcManagerRef.current?.startAsHost().catch(console.error);
            }
          }

          if (message.type === 'participant-joined') {
            storeAddParticipant(message.participant);
          }

          if (message.type === 'chat-message') {
            appendMessage(message.message);
            if (!isChatExpandedRef.current) {
              setUnreadCount((c) => c + 1);
            }
          }

          if (message.type === 'participant-left') {
            storeRemoveParticipant(message.connectionId);
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
        webrtcManagerRef.current = new WebRTCManager(socket, (file: File) => {
          setTransferProgress(null);
          loadMovieFromFile(file).catch(console.error);
        });
        webrtcManagerRef.current.onProgress = (transferred, total) => {
          setTransferProgress({ transferred, total });
        };
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
  }, [roomId, username]);

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

  async function loadMovieFromFile(file: File) {
    setSelectedFile(file);
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
    } else if (expectedMediaRef.current) {
      compareAgainstExpectedMedia(expectedMediaRef.current, mediaIdentity);
    } else {
      setVerificationStatus('waiting');
      setMediaDifferences([]);
    }

    if (videoRef.current) {
      videoRef.current.src = nextSession.sourceUrl;
      videoRef.current.load();
    }
  }

  async function handleMovieSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    await loadMovieFromFile(file);

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

  async function handleTestTransfer(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (webrtcManagerRef.current) {
      await webrtcManagerRef.current.transferFile(file).catch(console.error);
      setTransferProgress(null);
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

    void video.play().catch((err) => {
      if (err.name === 'NotAllowedError') {
        console.warn('[player] remote play was blocked by the browser');
        setAutoplayBlocked(true);
      }
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

  if (!username) {
    return (
      <main className="page page-centered">
        <UsernameModal
          description="Pick a display name for this watch party. It will be visible to everyone in the room."
          submitLabel="Join Room"
          onSubmit={(name) => setUsername(name)}
        />
      </main>
    );
  }

  if (status === 'loading') {
    return (
      <main className="page page-centered">
        <section className="hero-card compact-card">
          <p className="eyebrow">Loading room</p>
          <h1 className="app-title">CrushedPlay_</h1>
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
          <h1 className="app-title">CrushedPlay_</h1>
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
          <input
            ref={transferInputRef}
            className="visually-hidden"
            type="file"
            onChange={handleTestTransfer}
          />
          
          <div className="player-controls-container" style={{ width: '100%' }}>
            <button type="button" className="primary-button select-movie-button" onClick={() => fileInputRef.current?.click()}>
              Select Movie
            </button>
            {isHost ? (
              <button 
                type="button" 
                className="secondary-button" 
                style={{ marginLeft: '12px', marginBottom: '18px' }}
                onClick={() => {
                  if (selectedFile) {
                    if (webrtcManagerRef.current) {
                      webrtcManagerRef.current.transferFile(selectedFile).catch(console.error);
                    }
                  } else {
                    transferInputRef.current?.click();
                  }
                }}
              >
                Send Movie ᯓ ✈︎ ⋆°•☁︎
              </button>
            ) : null}
            <button type="button" className="secondary-button load-subtitles-button" onClick={() => subtitleInputRef.current?.click()}>
              Load Subtitles
            </button>
            
            {transferProgress !== null && (
              <div className="progress-container">
                <div className="progress-bar-fill" style={{ width: `${(transferProgress.transferred / transferProgress.total) * 100}%` }} />
                <p className="progress-text">
                  {Math.floor((transferProgress.transferred / transferProgress.total) * 100)}% ({formatBytes(transferProgress.transferred)} / {formatBytes(transferProgress.total)})
                </p>
              </div>
            )}

            {autoplayBlocked && (
              <div style={{ marginTop: '16px', background: 'rgba(255, 111, 145, 0.14)', border: '1px solid rgba(255, 111, 145, 0.32)', borderRadius: '16px', padding: '16px' }}>
                <p style={{ color: '#ffb4c2', fontWeight: 800, margin: '0 0 12px 0' }}>
                  Your browser blocked remote playback.
                </p>
                <button 
                  type="button" 
                  className="primary-button" 
                  onClick={() => {
                    setAutoplayBlocked(false);
                    attemptRemotePlay();
                  }}
                >
                  Click to Sync & Play
                </button>
              </div>
            )}
          </div>

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
          {participants.length > 0 ? (
            <ul className="participant-list">
              {participants.map((participant) => (
                <li key={participant.connectionId} className="participant-item">
                  <span className="participant-name">{participant.username}</span>
                  {participant.isHost ? <span className="participant-badge">HOST</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {users <= 1 ? <p>Waiting for others...</p> : null}
        </section>

        <section className="panel" style={{ display: 'flex', flexDirection: 'column', flex: isChatExpanded ? 1 : 'none', height: isChatExpanded ? '400px' : 'auto' }}>
          <p className="section-kicker">Chat</p>
          <div className="chat-header" onClick={() => setIsChatExpanded(!isChatExpanded)}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <h2>Room Chat</h2>
              {!isChatExpanded && unreadCount > 0 && (
                <span className="unread-badge">{unreadCount}</span>
              )}
            </div>
            <span>{isChatExpanded ? '▼' : '▲'}</span>
          </div>
          
          {isChatExpanded && (
            <>
              <div 
                ref={messagesContainerRef} 
                className="chat-messages-container"
                onScroll={(e) => {
                  const target = e.currentTarget;
                  isScrolledToBottomRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 50;
                }}
              >
                {messages.map((msg) => {
                  const isSelf = msg.senderConnectionId === localConnectionId;
                  const timeString = new Intl.DateTimeFormat('en-US', {
                    hour: 'numeric',
                    minute: '2-digit'
                  }).format(new Date(msg.timestamp));

                  return (
                    <div key={msg.id} className={`chat-bubble-wrapper ${isSelf ? 'chat-bubble-self' : 'chat-bubble-other'}`}>
                      <div className="chat-meta">
                        <span>{msg.senderUsername}</span>
                        <span>•</span>
                        <span>{timeString}</span>
                      </div>
                      <div className="chat-bubble">
                        {msg.text}
                      </div>
                    </div>
                  );
                })}
                {messages.length === 0 && <p style={{ color: 'var(--color-text-dim)', textAlign: 'center', marginTop: '16px' }}>{'Pretty empty here :( 📭'}</p>}
                <div ref={messagesEndRef} />
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input 
                  type="text" 
                  value={chatInput} 
                  onChange={(e) => setChatInput(e.target.value)} 
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (chatInput.trim()) {
                        isScrolledToBottomRef.current = true;
                        sendChatMessage(socketRef.current, chatInput.trim());
                        setChatInput('');
                      }
                    }
                  }}
                  style={{ flex: 1 }} 
                  placeholder="Type a message..." 
                />
                <button 
                  type="button" 
                  className="primary-button" 
                  onClick={() => {
                    if (chatInput.trim()) {
                      isScrolledToBottomRef.current = true;
                      sendChatMessage(socketRef.current, chatInput.trim());
                      setChatInput('');
                    }
                  }}
                >
                  Send
                </button>
              </div>
            </>
          )}
        </section>

        <section className="panel">
          <p className="section-kicker">Media</p>
          <h2>Playback</h2>
          <p className={`verification-status verification-${verificationStatus}`}>
            {verificationStatus === 'verified'
              ? '✓ Movie Verified'
              : verificationStatus === 'mismatch'
                ? 'Movie does not match.'
                : verificationStatus === 'waiting'
                  ? 'Waiting for matching file...'
                  : 'No movie selected'}
          </p>
          <dl className="playback-details" style={{ marginTop: '16px' }}>
            <div>
              <dt>Selected Movie</dt>
              <dd>{selectedMedia?.filename ?? playbackSession?.filename ?? 'None'}</dd>
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
          <button type="button" className="secondary-button" style={{ marginTop: '24px', width: '100%' }} onClick={() => setShowDebug(true)}>
            Debug Info for nerds
          </button>
        </section>
      </aside>

      {showDebug && (
        <div className="debug-modal-backdrop" onClick={() => setShowDebug(false)}>
          <div className="debug-modal panel" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h2 style={{ margin: 0 }}>Debug Info for nerds</h2>
              <button type="button" className="secondary-button" onClick={() => setShowDebug(false)}>Close</button>
            </div>

            <p className="host-status" style={{ margin: '0 0 24px 0' }}>{isHost ? 'Host media identity source' : 'Guest media verification'}</p>

            <section className="debug-section">
              <h3>Media Identity & Verification</h3>
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
              </dl>
            </section>

            <section className="debug-section">
              <h3>Subtitles</h3>
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

            <section className="debug-section">
              <h3>Video</h3>
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

            <section className="debug-section">
              <h3>Audio</h3>
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
          </div>
        </div>
      )}
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
  const audioTracks = video ? (video as HTMLVideoElement & { audioTracks?: { length: number;[index: number]: { enabled: boolean; label?: string; language?: string } } }).audioTracks : undefined;

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
