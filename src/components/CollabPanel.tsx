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
    <div style={{ ...styles.panel, ...(hidden ? { display: 'none' } : {}) }}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>Collaboration</span>
        <button
          style={styles.closeBtn}
          onClick={() => setShowCollabPanel(false)}
          title="Close"
        >
          ×
        </button>
      </div>

      <div style={styles.body}>
        {mode === 'idle' ? (
          <>
            <label style={styles.label}>
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
              className="btn"
              style={styles.primaryBtn}
              onClick={handleCreateRoom}
              disabled={isConnecting}
            >
              Create Room
            </button>

            <div style={styles.divider}>
              <span style={styles.dividerLine} />
              <span style={styles.dividerText}>or</span>
              <span style={styles.dividerLine} />
            </div>

            <label style={styles.label}>
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
              className="btn"
              style={styles.secondaryBtn}
              onClick={handleJoinRoom}
              disabled={isConnecting || !joinRoomId.trim()}
            >
              Join Room
            </button>
          </>
        ) : (
          <>
            {/* Connection status */}
            <div style={styles.statusRow}>
              <span
                style={{
                  ...styles.statusDot,
                  background: collabClient?.connected ? '#4caf50' : '#ff9800',
                }}
              />
              <span style={styles.statusText}>
                {collabClient?.connected ? 'Connected' : 'Connecting...'}
              </span>
            </div>

            {/* Room ID */}
            <div style={styles.roomRow}>
              <span style={styles.roomLabel}>Room:</span>
              <code style={styles.roomId}>{roomId}</code>
              <button
                className="btn"
                style={styles.copyBtn}
                onClick={handleCopyLink}
                title="Copy invite link"
              >
                {copied ? 'Copied!' : 'Copy Link'}
              </button>
            </div>

            {/* Users list */}
            <div style={styles.usersSection}>
              <div style={styles.usersSectionTitle}>
                Users ({1 + remoteUserList.length})
              </div>
              <div style={styles.usersList}>
                <div style={styles.userItem}>
                  <span
                    style={{
                      ...styles.userDot,
                      background: '#4caf50',
                    }}
                  />
                  <span style={styles.userName}>
                    {userName || 'Anonymous'} (you)
                  </span>
                </div>
                {remoteUserList.map((user) => (
                  <div key={user.userId} style={styles.userItem}>
                    <span
                      style={{
                        ...styles.userDot,
                        background: user.color,
                      }}
                    />
                    <span style={styles.userName}>{user.userName}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Leave button */}
            <button
              className="btn"
              style={styles.leaveBtn}
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

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 280,
    height: '100%',
    background: 'var(--color-bg-secondary)',
    borderLeft: '1px solid var(--color-border)',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 150,
    boxShadow: '-4px 0 16px rgba(0, 0, 0, 0.3)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
    borderBottom: '1px solid var(--color-border)',
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--color-text-primary)',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--color-text-secondary)',
    fontSize: 18,
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: '1',
  },
  body: {
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    overflowY: 'auto',
    flex: 1,
  },
  label: {
    fontSize: 12,
    color: 'var(--color-text-secondary)',
    display: 'block',
  },
  primaryBtn: {
    width: '100%',
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: 600,
    background: 'var(--color-accent)',
    color: '#fff',
    borderRadius: 'var(--radius-md)',
    textAlign: 'center' as const,
  },
  secondaryBtn: {
    width: '100%',
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: 600,
    background: 'var(--color-bg-tertiary)',
    color: 'var(--color-text-primary)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    textAlign: 'center' as const,
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    background: 'var(--color-border)',
  },
  dividerText: {
    fontSize: 11,
    color: 'var(--color-text-secondary)',
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  statusText: {
    fontSize: 12,
    color: 'var(--color-text-primary)',
  },
  roomRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 0',
  },
  roomLabel: {
    fontSize: 12,
    color: 'var(--color-text-secondary)',
    flexShrink: 0,
  },
  roomId: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--color-accent)',
    letterSpacing: '0.04em',
    flex: 1,
  },
  copyBtn: {
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 600,
    background: 'var(--color-bg-tertiary)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-text-primary)',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  },
  usersSection: {
    marginTop: 4,
  },
  usersSectionTitle: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    color: 'var(--color-text-secondary)',
    marginBottom: 8,
  },
  usersList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  userItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 0',
  },
  userDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    flexShrink: 0,
  },
  userName: {
    fontSize: 12,
    color: 'var(--color-text-primary)',
  },
  leaveBtn: {
    width: '100%',
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: 600,
    background: 'rgba(255, 85, 85, 0.15)',
    color: '#ff8888',
    border: '1px solid rgba(255, 85, 85, 0.3)',
    borderRadius: 'var(--radius-md)',
    textAlign: 'center' as const,
    marginTop: 'auto',
  },
};
