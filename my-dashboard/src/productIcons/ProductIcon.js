// Product line drawings. Render <ProductIconSprite /> once near the app root,
// then <ProductIcon type="syringe" size={48} /> anywhere. Ink is currentColor.
import { hasIcon, SPRITE } from './sprite';

// `title` is accepted as an alias for `label`.
export function ProductIcon({ type, size = 48, label, title, className }) {
  const id = hasIcon(type) ? type : 'box';
  const name = label || title;
  return (
    <svg
      className={className ? `product-icon ${className}` : 'product-icon'}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={name ? undefined : true}
      role={name ? 'img' : undefined}
      aria-label={name}
      focusable="false"
    >
      <use href={`#pi-${id}`} />
    </svg>
  );
}

const hidden = { position: 'absolute', width: 0, height: 0, overflow: 'hidden' };

// Hidden <svg> holding every <symbol>. Not display:none, so <use> still resolves.
export function ProductIconSprite() {
  return <svg aria-hidden="true" focusable="false" style={hidden} dangerouslySetInnerHTML={{ __html: SPRITE }} />;
}

export default ProductIcon;
