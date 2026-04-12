import './CollabPanel.css';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useEditorStore } from '@/state/editorStore';
import { CollabClient } from '@/collab/CollabClient';

type Mode = 'idle' | 'hosting' | 'joined';

export function CollabPanel({ hidden = false }: { hidden?: boolean }) {
  const collabClient = useEditorStore((s) => s.collabClient);
  const isCollaborating = useEditorStore((s) => s.isCollaborating);
  const remoteUsers = useEditorStore((s) => s.remoteUsers);
  const setCollabClient = useEditorStore((s) => s.setCollabClient);
  const setShowCollabPanel = useEditorStore((s) => s.setShowCollabPanel);

  const [mode, setMode] = useState<Mode>('idle');
  const [roomId, setRoomId] = useState('');
  const [joinRoomId, setJoinRoomId] = useState('');
  const [userName, setUserName] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const clientRef = useRef<CollabClient | null>(null);

  // Load userName from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('eled_userName');
    if (saved) setUserName(saved);
  }, []);

  // Save userName to localStorage on change
  useEffect(() => {
    if (userName) {
      localStorage.setItem('eled_userName', userName);
    }
  }, [userName]);

  // Sync mode with external collab state (e.g. disconnect from elsewhere)
  useEffect(() => {
    if (!isCollaborating && mode !== 'idle') {
      setMode('idle');
      setIsConnecting(false);
    }
  }, [isCollaborating, mode]);

  const handleCreateRoom = useCallback(() => {
    const name = userName.trim() || 'Anonymous';
    const newRoomId = Math.random().toString(36).slice(2, 8);
    setRoomId(newRoomId);
    setIsConnecting(true);

    const client = new CollabClient(() => useEditorStore.getState());
    clientRef.current = client;
    setCollabClient(client);
    client.connect(newRoomId, name);

    setMode('hosting');
    setIsConnecting(false);
  }, [userName, setCollabClient]);

  const handleJoinRoom = useCallback(() => {
    const id = joinRoomId.trim();
    if (!id) return;
    const name = userName.trim() || 'Anonymous';
    setRoomId(id);
    setIsConnecting(true);

    const client = new CollabClient(() => useEditorStore.getState());
    clientRef.current = client;
    setCollabClient(client);
    client.connect(id, name);

    setMode('joined');
    setIsConnecting(false);
  }, [joinRoomId, userName, setCollabClient]);

  const handleLeave = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    setCollabClient(null);
    useEditorStore.setState({
      isCollaborating: false,
      remoteUsers: new Map(),
    });
    setMode('idle');
    setRoomId('');
    setJoinRoomId('');
  }, [setCollabClient]);

  const handleCopyLink = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomId);
    navigator.clipboard.writeText(url.toString()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [roomId]);

  // Auto-join from URL ?room= param on mount
  const autoJoinedRef = useRef(false);
  useEffect(() => {
    if (autoJoinedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const urlRoom = params.get('room');
    if (!urlRoom || mode !== 'idle') return;
    autoJoinedRef.current = true;

    // Remove ?room= from URL so refresh doesn't re-join
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url.toString());

    const name = userName.trim() || localStorage.getItem('eled_userName') || 'Anonymous';
    const client = new CollabClient(() => useEditorStore.getState());
    clientRef.current = client;
    setCollabClient(client);
    client.connect(urlRoom, name);
    setRoomId(urlRoom);
    setJoinRoomId(urlRoom);
    setMode('joined');
    useEditorStore.getState().setShowCollabPanel(true);
  }, [mode, userName, setCollabClient]);

  const remoteUserList = Array.from(remoteUsers.values());

  return (
    <div className={`collab-panel${hidden ? ' collab-panel--hidden' : ''}`}>
      <div className="collab-panel__header">
        <span className="collab-panel__header-title">Collaboration</span>
        <button
          className="collab-panel__close-btn"
          onClick={() => setShowCollabPanel(false)}
          title="Close"
        >
          ×
        </button>
      </div>

      <div className="collab-panel__body">
        {mode === 'idle' ? (
          <>
            <label className="collab-panel__label">
              Username
              <input
                className="input"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Your name"
                style={{ marginTop: 4 }}
              />
            </label>

            <button
              className="btn collab-panel__primary-btn"
              onClick={handleCreateRoom}
              disabled={isConnecting}
            >
              Create Room
            </button>

            <div className="collab-panel__divider">
              <span className="collab-panel__divider-line" />
              <span className="collab-panel__divider-text">or</span>
              <span className="collab-panel__divider-line" />
            </div>

            <label className="collab-panel__label">
              Room ID
              <input
                className="input"
                value={joinRoomId}
                onChange={(e) => setJoinRoomId(e.target.value)}
                placeholder="Enter room ID"
                style={{ marginTop: 4 }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleJoinRoom();
                }}
              />
            </label>

            <button
              className="btn collab-panel__secondary-btn"
              onClick={handleJoinRoom}
              disabled={isConnecting || !joinRoomId.trim()}
            >
              Join Room
            </button>
          </>
        ) : (
          <>
            {/* Connection status */}
            <div className="collab-panel__status-row">
              <span
                className="collab-panel__status-dot"
                style={{ background: collabClient?.connected ? '#4caf50' : '#ff9800' }}
              />
              <span className="collab-panel__status-text">
                {collabClient?.connected ? 'Connected' : 'Connecting...'}
              </span>
            </div>

            {/* Room ID */}
            <div className="collab-panel__room-row">
              <span className="collab-panel__room-label">Room:</span>
              <code className="collab-panel__room-id">{roomId}</code>
              <button
                className="btn collab-panel__copy-btn"
                onClick={handleCopyLink}
                title="Copy invite link"
              >
                {copied ? 'Copied!' : 'Copy Link'}
              </button>
            </div>

            {/* Users list */}
            <div className="collab-panel__users-section">
              <div className="collab-panel__users-title">
                Users ({1 + remoteUserList.length})
              </div>
              <div className="collab-panel__users-list">
                <div className="collab-panel__user-item">
                  <span
                    className="collab-panel__user-dot"
                    style={{ background: '#4caf50' }}
                  />
                  <span className="collab-panel__user-name">
                    {userName || 'Anonymous'} (you)
                  </span>
                </div>
                {remoteUserList.map((user) => (
                  <div key={user.userId} className="collab-panel__user-item">
                    <span
                      className="collab-panel__user-dot"
                      style={{ background: user.color }}
                    />
                    <span className="collab-panel__user-name">{user.userName}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Leave button */}
            <button
              className="btn collab-panel__leave-btn"
              onClick={handleLeave}
            >
              Leave Room
            </button>
          </>
        )}
      </div>
    </div>
  );
}
