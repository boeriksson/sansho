import { useState, useEffect, useRef, useCallback, FormEvent } from 'react';
import { signOut, fetchAuthSession } from 'aws-amplify/auth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AmplifyUser = Record<string, any>;

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface WsMessage {
  type: string;
  content?: string;
  message?: string;
}

interface ChatProps {
  user: AmplifyUser;
  onLogout: () => void;
}

const WS_ENDPOINT = import.meta.env.VITE_WS_ENDPOINT as string;
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

export default function Chat({ onLogout }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, waiting]);

  const connect = useCallback(async () => {
    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();
      if (!token) throw new Error('No id token');

      const ws = new WebSocket(`${WS_ENDPOINT}?token=${token}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectAttempts.current = 0;
      };

      ws.onmessage = (event: MessageEvent<string>) => {
        try {
          const data = JSON.parse(event.data) as WsMessage;
          if (data.type === 'message') {
            const content = data.content ?? data.message ?? '';
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', content },
            ]);
            setWaiting(false);
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;

        if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts.current += 1;
          reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts.current += 1;
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const handleSend = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({ message: text }));
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setInput('');
    setWaiting(true);
  };

  const handleLogout = async () => {
    wsRef.current?.close();
    await signOut();
    onLogout();
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        backgroundColor: '#f9fafb',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 24px',
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e5e7eb',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px', fontWeight: 700, color: '#111827' }}>
            Sansho
          </span>
          <span
            style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: connected ? '#22c55e' : '#f59e0b',
            }}
          />
          <span style={{ fontSize: '12px', color: '#9ca3af' }}>
            {connected ? 'Connected' : 'Connecting…'}
          </span>
        </div>
        <button
          onClick={handleLogout}
          style={{
            padding: '7px 14px',
            fontSize: '13px',
            fontWeight: 500,
            color: '#6b7280',
            backgroundColor: 'transparent',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            cursor: 'pointer',
          }}
        >
          Sign out
        </button>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {messages.length === 0 && !waiting && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#9ca3af',
              fontSize: '14px',
            }}
          >
            Send a message to get started.
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              style={{
                maxWidth: '70%',
                padding: '10px 14px',
                borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                backgroundColor: msg.role === 'user' ? '#2563eb' : '#ffffff',
                color: msg.role === 'user' ? '#ffffff' : '#111827',
                fontSize: '14px',
                lineHeight: '1.5',
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {waiting && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div
              style={{
                padding: '10px 16px',
                borderRadius: '18px 18px 18px 4px',
                backgroundColor: '#ffffff',
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                display: 'flex',
                gap: '4px',
                alignItems: 'center',
              }}
            >
              {[0, 1, 2].map((n) => (
                <span
                  key={n}
                  style={{
                    display: 'inline-block',
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: '#9ca3af',
                    animation: `bounce 1.2s ease-in-out ${n * 0.2}s infinite`,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSend}
        style={{
          display: 'flex',
          gap: '10px',
          padding: '16px 24px',
          backgroundColor: '#ffffff',
          borderTop: '1px solid #e5e7eb',
          flexShrink: 0,
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!connected}
          placeholder={connected ? 'Type a message…' : 'Connecting…'}
          style={{
            flex: 1,
            padding: '10px 14px',
            fontSize: '14px',
            border: '1px solid #d1d5db',
            borderRadius: '24px',
            outline: 'none',
            backgroundColor: connected ? '#ffffff' : '#f9fafb',
            color: '#111827',
          }}
        />
        <button
          type="submit"
          disabled={!connected || !input.trim()}
          style={{
            padding: '10px 20px',
            fontSize: '14px',
            fontWeight: 600,
            color: '#ffffff',
            backgroundColor:
              connected && input.trim() ? '#2563eb' : '#93c5fd',
            border: 'none',
            borderRadius: '24px',
            cursor: connected && input.trim() ? 'pointer' : 'not-allowed',
            flexShrink: 0,
            transition: 'background-color 0.15s',
          }}
        >
          Send
        </button>
      </form>

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
