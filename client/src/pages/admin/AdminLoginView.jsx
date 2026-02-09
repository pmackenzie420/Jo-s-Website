export default function AdminLoginView({
  password,
  otp,
  notice,
  onPasswordChange,
  onOtpChange,
  onLogin
}) {
  return (
    <div className="admin-container login-container">
      <div className="login-card">
        <div className="login-title">L.F.S Admin</div>
        <form onSubmit={onLogin}>
          <input
            id="admin-password"
            type="password"
            className="admin-input"
            placeholder="Password"
            aria-label="Password"
            value={password}
            onChange={onPasswordChange}
            autoComplete="current-password"
          />
          <input
            id="admin-otp"
            type="text"
            className="admin-input"
            placeholder="2FA code (if enabled)"
            aria-label="2FA code"
            value={otp}
            onChange={onOtpChange}
            autoComplete="one-time-code"
            inputMode="numeric"
          />
          <button type="submit" className="admin-button">
            Log In
          </button>
        </form>
        {notice && <div className="admin-helper-text error">{notice.text}</div>}
      </div>
    </div>
  );
}
