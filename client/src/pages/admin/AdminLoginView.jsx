import { t } from '../admin-i18n';

export default function AdminLoginView({
  password,
  notice,
  onPasswordChange,
  onLogin
}) {
  const lang = 'fr';
  return (
    <div className="admin-container login-container">
      <div className="login-card">
        <div className="login-title">{t('login.title', lang)}</div>
        <form onSubmit={onLogin}>
          <input
            id="admin-password"
            type="password"
            className="admin-input"
            placeholder={t('login.password', lang)}
            aria-label={t('login.password', lang)}
            value={password}
            onChange={onPasswordChange}
            autoComplete="current-password"
          />
          <button type="submit" className="admin-button">
            {t('login.submit', lang)}
          </button>
        </form>
        {notice && <div className="admin-helper-text error">{notice.text}</div>}
      </div>
    </div>
  );
}
