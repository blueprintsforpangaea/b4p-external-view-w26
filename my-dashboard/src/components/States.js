import Icon from './Icons';

export function EmptyState({ title, children, action, level = 2 }) {
  const Heading = `h${level}`;
  return (
    <div className="state">
      <Heading className="state__title">{title}</Heading>
      {children && <p className="state__text">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title = 'Couldn’t load this', message, onRetry, retrying }) {
  return (
    <div className="state state--error" role="alert">
      <Icon name="alert" size={24} className="state__icon" />
      <h2 className="state__title">{title}</h2>
      <p className="state__text">{message}</p>
      {onRetry && (
        <button type="button" className="btn btn--secondary" onClick={onRetry} disabled={retrying}>
          <Icon name="refresh" size={18} /> {retrying ? 'Trying again…' : 'Try again'}
        </button>
      )}
    </div>
  );
}

export function WakingNotice() {
  return (
    <p className="waking" role="status">
      Waking up the server. The first visit after a quiet spell can take up to a minute.
    </p>
  );
}

export function SkeletonTable({ rows = 10 }) {
  return (
    <div className="skeleton-table" aria-hidden="true">
      <div className="skeleton skeleton--title" />
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-row" key={i}>
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--line skeleton--short" />
        </div>
      ))}
    </div>
  );
}
