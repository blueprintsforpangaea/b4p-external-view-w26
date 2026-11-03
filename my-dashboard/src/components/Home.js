import { useEffect, useRef } from 'react';
import { toSection } from './Header';
import SearchBox from './SearchBox';

// The whole site on one scrolling page, in the order of the chapter inventory site:
// welcome, what to know first, totals, search and the inventory (`children`), how requesting
// works, contact. The header links jump to #/inventory, #/how-it-works and #/contact.

const steps = (signIn) => [
  ['Find what you need', <>Search or filter the list above. Check the quantity, availability and expiration date.</>],
  ['Add it and send your list', <>Click <strong>+ Add to list</strong>, then open <strong>Your list</strong> and click <strong>Review and send</strong>.
    {signIn ? ' You sign in with your work email before it sends.' : ' Give your clinic’s name and work email so we can reach you.'}</>],
  ['We confirm with you', <>A Blueprints team member checks what is on hand and emails you when your request is approved, and again when it ships.</>],
];

export default function Home({ clinic, search = '', onSearch, suggestIndex, stats, contactEmail, signIn = true, children }) {
  const titleRef = useRef(null);
  // Focus the heading for screen readers without scrolling away from a section someone jumped to.
  useEffect(() => titleRef.current && titleRef.current.focus({ preventScroll: true }), []);

  const toList = (e) => {
    if (e) e.preventDefault();
    const list = document.getElementById('inventory');
    if (list) list.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="home">
      <section className="home__hero">
        <div className="home__hero-inner">
          <p className="home__kicker">Blueprints for Pangaea (B4P)</p>
          <h1 className="home__title" tabIndex={-1} ref={titleRef}>Welcome, {clinic || 'clinic'}</h1>
          <p className="home__lede">
            Blueprints for Pangaea (B4P) is a student-run nonprofit that collects donated and surplus medical
            supplies and redistributes them to clinics, hospitals and communities that need them.
          </p>
          <p className="home__lede">
            Use this page to find donated supplies and request them for your clinic.
            {signIn ? ' Anyone can look; you sign in with your work email when you send a request.' : ' Anyone can look and send a request.'}
          </p>
          <div className="home__actions">
            <a className="btn btn--primary btn--lg" href="#/inventory" onClick={toSection}>Find supplies</a>
            <a className="btn btn--secondary btn--lg" href="#/how-it-works" onClick={toSection}>How requesting works</a>
            {signIn && !clinic && <a className="btn btn--secondary btn--lg" href="#/signin">Sign in</a>}
          </div>
        </div>
      </section>

      <section className="notice" aria-labelledby="notice-title">
        <h2 className="notice__title" id="notice-title">Please read before requesting</h2>
        <ul>
          <li><strong>The list changes often.</strong> Items listed here may already have gone to another clinic.</li>
          <li><strong>Adding to your list is not a reservation.</strong> A request is confirmed only when the Blueprints team approves it.</li>
          <li><strong>We confirm before we ship.</strong> We email you when your request is approved and again when it ships.</li>
          <li><strong>This website does not give medical advice.</strong> Check each product’s suitability, labeling and expiration with a qualified professional before use.</li>
        </ul>
      </section>

      {stats && (
        <section className="stats" aria-label="Inventory totals">
          {stats.map(([n, label, hint]) => (
            <div className="stats__tile" key={label}>
              <p className="stats__n num">{n.toLocaleString('en-US')}</p>
              <p className="stats__label">{label}</p>
              {hint && <p className="stats__hint">{hint}</p>}
            </div>
          ))}
        </section>
      )}

      <section className="inv" id="inventory" aria-labelledby="inventory-title">
        <h2 className="home__how-title" id="inventory-title">Supply inventory</h2>
        <form className="home__search" role="search" onSubmit={toList}>
          <label className="home__search-label" htmlFor="supply-search">Search supplies</label>
          <div className="home__search-row">
            <SearchBox value={search} onChange={onSearch} onPick={toList} index={suggestIndex} />
            <button type="submit" className="btn btn--primary btn--lg">Search</button>
          </div>
          <p className="home__hint" id="search-hint">Search by supply name, maker, batch or category.</p>
        </form>
        {children}
      </section>

      <section className="home__how" id="how-it-works" aria-labelledby="how-title">
        <h2 className="home__how-title" id="how-title">How to request supplies</h2>
        <ol className="home__steps">
          {steps(signIn).map(([title, text]) => (
            <li key={title}><h3 className="home__step-title">{title}</h3><p>{text}</p></li>
          ))}
        </ol>
      </section>

      <section className="home__contact" id="contact" aria-labelledby="contact-title">
        <h2 className="home__how-title" id="contact-title">Contact B4P</h2>
        <p>
          Questions about a supply or a request? Email{' '}
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a> with your clinic’s name and what you need.
        </p>
      </section>
    </div>
  );
}
