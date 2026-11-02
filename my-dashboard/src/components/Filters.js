// The two filters that matter for a clinic: can I get it, and is it about to expire?
export default function Filters({ filters, setFilter, count, noun = 'supplies' }) {
  return (
    <div className="filters">
      <p className="filters__count" aria-live="polite">
        <span className="num">{count.toLocaleString('en-US')}</span> {count === 1 ? noun.replace(/ies$/, 'y') : noun}
      </p>
      <label className="check">
        <input type="checkbox" checked={filters.inStockOnly} onChange={(e) => setFilter('inStockOnly', e.target.checked)} />
        <span>In stock only</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={filters.hideExpiring} onChange={(e) => setFilter('hideExpiring', e.target.checked)} />
        <span>Hide expiring soon</span>
      </label>
    </div>
  );
}
