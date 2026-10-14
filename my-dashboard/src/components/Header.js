import Icon from './Icons';
import { useEffect, useRef, useState } from 'react';

function AccountMenu({ account, onSignOut }) {
  const ref = useRef(null);
  return (
    <details className="acct" ref={ref}>
      <summary className="acct__btn" aria-label={`${account.org}, account menu`}>
        <span className="acct__initial" aria-hidden="true">{account.org.trim().charAt(0).toUpperCase()}</span>
        <span className="acct__org">{account.org}</span>
        <span className="acct__label">Account</span>
        <span className="visually-hidden">, account menu</span>
      </summary>
      <div className="acct__menu">
        <p className="acct__who">
          Signed in as<br />
          <strong>{account.name || account.org}</strong><br />
          <span className="acct__email">{account.email}</span>
        </p>
        <a className="acct__item" href="#/requests" onClick={() => { ref.current.open = false; }}>My requests</a>
        <button type="button" className="acct__item" onClick={() => { ref.current.open = false; onSignOut(); }}>Sign out</button>
      </div>
    </details>
  );
}

export default function Header({ view, lineCount, units = 0, onOpenSlip, onOpenCategories, onHome, siteName, account, onSignOut, authPage, showSignIn, contactEmail }) {
  // Counts up each time the list grows (a new supply, or more of one), to replay the animation.
  const [bump, setBump] = useState(0);
  const lastUnits = useRef(units);
  useEffect(() => {
    if (units > lastUnits.current) setBump((n) => n + 1);
    lastUnits.current = units;
  }, [units]);

  return (
    <header className="header">
      <div className="header__inner">
        <a className="header__brand" href="#/" onClick={onHome} aria-label={`${siteName}, home`}>
          {/* Inlined into the CSS as a data: URI, so the page makes no image requests. */}
          <span className="header__logo" role="img" aria-label="Blueprints for Pangaea" />
          <span className="header__name">
            <span className="header__name-long">{siteName}</span>
            <span className="header__name-short">Supply Requests</span>
          </span>
        </a>
        {!authPage && onOpenCategories && (
          <button type="button" className="header__cats btn btn--quiet" onClick={onOpenCategories}>
            <Icon name="list" size={18} /> <span className="header__cats-label">Categories</span>
          </button>
        )}
        <nav className="header__nav" aria-label="Main">
          <a href="#/how-it-works" className="header__link header__link--help" aria-current={view === 'guide' ? 'page' : undefined}>
            <span className="header__help-long">How it works</span><span className="header__help-short">Guide</span>
          </a>
          {(account || !showSignIn) && (
            <a href="#/requests" className="header__link header__link--requests" aria-current={view === 'requests' ? 'page' : undefined}>
              My requests
            </a>
          )}
          {/* One click opens an email to the team, already addressed. */}
          <a
            href={`mailto:${contactEmail}?subject=${encodeURIComponent('Help with a supply request')}`}
            className="header__email"
            aria-label={`Get help: email ${contactEmail}`}
          >
            <Icon name="mail" size={18} />
            <span className="header__help-long">Email for help</span><span className="header__help-short">Help</span>
          </a>
          {!authPage && (lineCount ? (
            <button type="button" className="header__slip" onClick={onOpenSlip}>
              {/* Restarted (new key) each time something is added: a ring spreads out and the count pops. */}
              {bump > 0 && <span key={`ring-${bump}`} className="header__slip-ring" aria-hidden="true" />}
              <Icon name="slip" size={18} />
              <span className="header__slip-label">Your list</span>{' '}
              <span key={`n-${bump}`} className={`num${bump ? ' header__slip-n' : ''}`}>({lineCount})</span>
              <span className="visually-hidden"> {lineCount === 1 ? 'supply' : 'supplies'}</span>
            </button>
          ) : (
            // Still opens the (empty) list, but quietly: there is nothing to act on yet.
            <button type="button" className="header__slip header__slip--empty" onClick={onOpenSlip}>
              <Icon name="slip" size={18} /> Your list is empty
            </button>
          ))}
        </nav>
        {/* The clinic's profile (or Sign in) sits alone at the far right, like the title on the far left. */}
        {account ? (
          <div className="header__profile"><AccountMenu account={account} onSignOut={onSignOut} /></div>
        ) : showSignIn && !authPage && (
          <div className="header__profile">
            <a href="#/signin" className="header__link" aria-current={view === 'signin' ? 'page' : undefined}>Sign in</a>
          </div>
        )}
      </div>
    </header>
  );
}
