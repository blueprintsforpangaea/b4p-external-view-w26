import Icon from './Icons';
import { useEffect, useRef, useState } from 'react';

// A section link to where the address already is changes nothing, so jump there directly.
export function toSection(e) {
  const href = e.currentTarget.getAttribute('href');
  if (window.location.hash !== href) return;
  e.preventDefault();
  const el = document.getElementById(href.slice(2));
  if (el) el.scrollIntoView();
}

// Signed in: the person icon opens a small menu (who is signed in, My requests, Change password,
// the team dashboard for team accounts, Sign out).
function AccountMenu({ account, onSignOut }) {
  const ref = useRef(null);
  return (
    <details className="acct" ref={ref}>
      <summary className="header__icon-btn acct__btn" aria-label={`Account: ${account.org}`}>
        <Icon name="user" size={26} />
        <span className="header__icon-label">Account</span>
      </summary>
      <div className="acct__menu">
        <p className="acct__who">
          Signed in as<br />
          <strong>{account.name || account.org}</strong><br />
          <span className="acct__email">{account.email}</span>
        </p>
        <a className="acct__item" href="#/requests" onClick={() => { ref.current.open = false; }}>My requests</a>
        <a className="acct__item" href="#/password" onClick={() => { ref.current.open = false; }}>Change password</a>
        {account.role === 'hq' && (
          <a className="acct__item" href="#/team" onClick={() => { ref.current.open = false; }}>Team dashboard</a>
        )}
        <button type="button" className="acct__item" onClick={() => { ref.current.open = false; onSignOut(); }}>Sign out</button>
      </div>
    </details>
  );
}

// One row: logo and label (home), the section links, then Account and Your list on the right.
export default function Header({ view, lineCount, units = 0, onOpenSlip, account, onSignOut, authPage, showSignIn }) {
  // Counts up each time the list grows (a new supply, or more of one), to replay the animation.
  const [bump, setBump] = useState(0);
  const lastUnits = useRef(units);
  useEffect(() => {
    if (units > lastUnits.current) setBump((n) => n + 1);
    lastUnits.current = units;
  }, [units]);

  const listName = lineCount ? `Your list, ${lineCount} ${lineCount === 1 ? 'supply' : 'supplies'}` : 'Your list, empty';

  return (
    <header className="header">
      <div className="header__inner">
        {/* The logo alone is the way home. Inlined into the CSS as a data: URI, so the page makes no image requests. */}
        <a className="header__brand" href="#/" aria-label="Blueprints for Pangaea, home">
          <span className="header__logo" aria-hidden="true" />
          <span className="header__tag" aria-hidden="true">Medical supply<br />requests</span>
        </a>

        {/* Section links on the one main page, as on the chapter inventory site. */}
        <nav className="header__main" aria-label="Page sections">
          <a className="header__request" href="#/inventory" onClick={toSection}>Browse supplies</a>
          <a className="header__request" href="#/how-it-works" onClick={toSection}>How to request</a>
          <a className="header__request" href="#/contact" onClick={toSection}>Contact</a>
        </nav>

        <div className="header__end">
          {account ? (
            <AccountMenu account={account} onSignOut={onSignOut} />
          ) : showSignIn && (
            <a href="#/signin" className="header__icon-btn" aria-label="Account: sign in"
              aria-current={view === 'signin' ? 'page' : undefined}>
              <Icon name="user" size={26} />
              <span className="header__icon-label">Account</span>
            </a>
          )}
          {!authPage && (
            <button type="button" className={`header__icon-btn header__slip${lineCount ? '' : ' header__slip--empty'}`}
              onClick={onOpenSlip} aria-label={listName}>
              {/* Restarted (new key) each time something is added: a ring spreads out and the count pops. */}
              {bump > 0 && <span key={`ring-${bump}`} className="header__slip-ring" aria-hidden="true" />}
              <span className="header__slip-icon" aria-hidden="true">
                <Icon name="slip" size={26} />
                {lineCount > 0 && (
                  <span key={`n-${bump}`} className={`header__badge num${bump ? ' header__slip-n' : ''}`}>{lineCount}</span>
                )}
              </span>
              <span className="header__icon-label">Your list</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
