export default function AdminToast({ notice, onAction }) {
  if (!notice) return null;
  return (
    <div className={`admin-toast ${notice.type}`}>
      <span>{notice.text}</span>
      {notice.actionLabel && notice.action && (
        <button
          type="button"
          className="admin-toast-action"
          onClick={onAction}
        >
          {notice.actionLabel}
        </button>
      )}
    </div>
  );
}
