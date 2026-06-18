import { useState, useEffect } from 'react';
import { getCurrentUser, signOut } from 'aws-amplify/auth';
import Login from './components/Login';
import Chat from './components/Chat';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AmplifyUser = Record<string, any>;

export default function App() {
  const [user, setUser] = useState<AmplifyUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCurrentUser()
      .then((u) => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const handleLogout = async () => {
    await signOut();
    setUser(null);
  };

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          fontFamily: 'system-ui, sans-serif',
          color: '#6b7280',
        }}
      >
        Loading…
      </div>
    );
  }

  return user ? (
    <Chat user={user} onLogout={handleLogout} />
  ) : (
    <Login onLogin={setUser} />
  );
}
