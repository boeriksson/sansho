import { useState, FormEvent } from 'react';
import { signIn } from 'aws-amplify/auth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AmplifyUser = Record<string, any>;

interface LoginProps {
  onLogin: (user: AmplifyUser) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await signIn({ username: email, password });
      if (result.isSignedIn) {
        onLogin(result);
      } else {
        setError('Sign-in requires additional steps. Please contact support.');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sign in failed.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        backgroundColor: '#f3f4f6',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.1)',
          padding: '40px 48px',
          width: '100%',
          maxWidth: '400px',
        }}
      >
        <h1
          style={{
            margin: '0 0 8px 0',
            fontSize: '24px',
            fontWeight: 700,
            color: '#111827',
          }}
        >
          Sansho
        </h1>
        <p style={{ margin: '0 0 32px 0', fontSize: '14px', color: '#6b7280' }}>
          Sign in to continue
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label
              htmlFor="email"
              style={{
                display: 'block',
                marginBottom: '6px',
                fontSize: '13px',
                fontWeight: 500,
                color: '#374151',
              }}
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
              placeholder="you@example.com"
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                outline: 'none',
                boxSizing: 'border-box',
                backgroundColor: loading ? '#f9fafb' : '#ffffff',
                color: '#111827',
              }}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label
              htmlFor="password"
              style={{
                display: 'block',
                marginBottom: '6px',
                fontSize: '13px',
                fontWeight: 500,
                color: '#374151',
              }}
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              placeholder="••••••••"
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                outline: 'none',
                boxSizing: 'border-box',
                backgroundColor: loading ? '#f9fafb' : '#ffffff',
                color: '#111827',
              }}
            />
          </div>

          {error && (
            <div
              style={{
                marginBottom: '16px',
                padding: '10px 12px',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '8px',
                fontSize: '13px',
                color: '#b91c1c',
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '11px',
              fontSize: '14px',
              fontWeight: 600,
              color: '#ffffff',
              backgroundColor: loading ? '#93c5fd' : '#2563eb',
              border: 'none',
              borderRadius: '8px',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.15s',
            }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
