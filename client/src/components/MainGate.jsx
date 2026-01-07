import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import '../styles/components/MainGate.css';
import { API_URL } from '../constants/api';

export default function MainGate({ children }) {
  const location = useLocation();
  const [status, setStatus] = useState('loading');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const bypassGate = location.pathname.startsWith('/success');

  useEffect(() => {
    if (bypassGate) {
      return undefined;
    }
    let active = true;
    axios
      .get(`${API_URL}/main/session`, { withCredentials: true })
      .then(() => {
        if (active) {
          setStatus('unlocked');
        }
      })
      .catch(() => {
        if (active) {
          setStatus('locked');
        }
      });
    return () => {
      active = false;
    };
  }, [bypassGate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    try {
      await axios.post(`${API_URL}/main/login`, { password }, { withCredentials: true });
      setPassword('');
      setStatus('unlocked');
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401) {
        setError('Wrong password. Try again.');
      } else if (status === 500) {
        setError('Main site password is not configured on the server.');
      } else {
        setError('Unable to reach the server. Check your connection.');
      }
    }
  };

  if (bypassGate) {
    return children;
  }

  if (status === 'loading') {
    return (
      <div className="main-gate">
        <div className="main-gate-card">Checking access...</div>
      </div>
    );
  }

  if (status === 'unlocked') {
    return children;
  }

  return (
    <div className="main-gate">
      <div className="main-gate-card">
        <div className="main-gate-title">Password required</div>
        <form className="main-gate-form" onSubmit={handleSubmit}>
          <input
            type="password"
            className="main-gate-input"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
          <button type="submit" className="main-gate-button">
            Enter
          </button>
        </form>
        {error && <div className="main-gate-error">{error}</div>}
      </div>
    </div>
  );
}
