import { memo } from 'react';
import { iconForSubcategory, ProductIcon } from '../catalogIcons';

const FIRST = 6;

const kinds = (n) => `${n} ${n === 1 ? 'kind' : 'kinds'} of supplies`;

// The home page: a link to the guide for first-timers, then one large tile per
// category (A–Z). The tile's heading is a link to the whole category.
function Landing({ catalog }) {
  return (
    <div className="landing">
      <a className="landing__guide" href="#/how-it-works">
        <strong>First time here?</strong> Read how to request supplies, step by step
        <span aria-hidden="true"> →</span>
      </a>
      <h1 className="page-title">Supplies for partner clinics</h1>
      <p className="lede">Donated medical supplies, free for partner clinics.</p>

      <h2 className="section-title landing__browse">Choose a category</h2>
      <div className="landing__grid">
        {catalog.map((cat) => (
          <section key={cat.slug} className="cat" aria-labelledby={`cat-${cat.slug}`}>
            <h2 className="cat__title" id={`cat-${cat.slug}`}>
              <a href={`#/c/${cat.slug}`} className="cat__link">
                <span className="cat__art"><ProductIcon type={iconForSubcategory(cat.name)} size={40} /></span>
                <span className="cat__text">
                  <span className="cat__name">{cat.name}</span>
                  <span className="cat__kinds">{kinds(cat.types.length)}</span>
                </span>
              </a>
            </h2>
            <ul className="cat__types">
              {cat.types.slice(0, FIRST).map((t) => (
                <li key={t.slug}><a href={`#/c/${cat.slug}/${t.slug}`}>{t.label}</a></li>
              ))}
            </ul>
            {cat.types.length > FIRST && (
              <a className="cat__all" href={`#/c/${cat.slug}`}>
                See all {cat.types.length} kinds in {cat.name}<span aria-hidden="true"> →</span>
              </a>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

export default memo(Landing);
