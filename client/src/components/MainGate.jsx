import { useEffect, useState } from 'react';
import axios from 'axios';
import '../styles/components/MainGate.css';
import { API_URL } from '../constants/api';

const COPY = {
  en: {
    checking: 'Checking access...',
    title: 'Password required',
    placeholder: 'Password',
    submit: 'Enter',
    wrongPassword: 'Wrong password. Try again.',
    notConfigured: 'Main site password is not configured on the server.',
    unreachable: 'Unable to reach the server. Check your connection.'
  },
  fr: {
    checking: "V\u00e9rification de l'acc\u00e8s...",
    title: 'Mot de passe requis',
    placeholder: 'Mot de passe',
    submit: 'Entrer',
    wrongPassword: 'Mot de passe incorrect. R\u00e9essayez.',
    notConfigured: 'Le mot de passe du site principal n\u2019est pas configur\u00e9 sur le serveur.',
    unreachable: 'Impossible de joindre le serveur. V\u00e9rifiez votre connexion.'
  }
};

export default function MainGate({ children, lang }) {
  const copy = lang === 'fr' ? COPY.fr : COPY.en;
  const [status, setStatus] = useState('loading');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const devBypass = import.meta.env.DEV || import.meta.env.VITE_DISABLE_MAIN_GATE === 'true';
  const bypassGate = devBypass;

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
        setError(copy.wrongPassword);
      } else if (status === 500) {
        setError(copy.notConfigured);
      } else {
        setError(copy.unreachable);
      }
    }
  };

  if (bypassGate) {
    return children;
  }

  if (status === 'loading') {
    return (
      <div className="main-gate">
        <div className="main-gate-card">{copy.checking}</div>
      </div>
    );
  }

  if (status === 'unlocked') {
    return children;
  }

  return (
    <div className="main-gate">
      <div className="main-gate-card">
        <div className="main-gate-title">{copy.title}</div>
        <form className="main-gate-form" onSubmit={handleSubmit}>
          <input
            type="password"
            className="main-gate-input"
            placeholder={copy.placeholder}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
          <button type="submit" className="main-gate-button">
            {copy.submit}
          </button>
        </form>
        {error && <div className="main-gate-error">{error}</div>}
      </div>
    </div>
  );
}
