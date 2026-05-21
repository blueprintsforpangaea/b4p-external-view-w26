import React, { useState, useEffect, useMemo } from 'react';

const CATEGORY_KEYWORDS = {
  'Wound Care': ['bandage', 'gauze', 'wound', 'dressing', 'tape', 'suture', 'staple', 'adhesive', 'wrap'],
  'Gloves & PPE': ['glove', 'mask', 'gown', 'shield', 'goggles', 'ppe', 'protective', 'nitrile', 'latex'],
  'Syringes & Needles': ['syringe', 'needle', 'IV', 'cannula', 'catheter', 'infusion', 'injection'],
  'Diagnostics': ['test', 'strip', 'monitor', 'glucose', 'diagnostic', 'culture', 'specimen', 'swab'],
  'Sterilization': ['steril', 'alcohol', 'antiseptic', 'disinfect', 'wipe', 'sanitiz', 'iodine'],
  'Office Supplies': ['paper', 'pen', 'form', 'folder', 'label', 'stapler', 'printer', 'toner'],
  'Medications': ['tablet', 'capsule', 'vial', 'ampoule', 'medication', 'drug', 'pill', 'dose'],
};

const PALETTE = {
  'Wound Care': '#B5D4F4',
  'Gloves & PPE': '#9FE1CB',
  'Syringes & Needles': '#F5C4B3',
  'Diagnostics': '#FAC775',
  'Sterilization': '#C0DD97',
  'Office Supplies': '#D3D1C7',
  'Medications': '#F4C0D1',
  'Other': '#CECBF6',
};

const TEXT_PALETTE = {
  'Wound Care': '#0C447C',
  'Gloves & PPE': '#085041',
  'Syringes & Needles': '#712B13',
  'Diagnostics': '#633806',
  'Sterilization': '#3B6D11',
  'Office Supplies': '#444441',
  'Medications': '#72243E',
  'Other': '#3C3489',
};

function categorize(item) {
  const text = Object.values(item).join(' ').toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) return cat;
  }
  return 'Other';
}

function CategoryBadge({ category }) {
  return (
    <span style={{
      background: PALETTE[category] || PALETTE['Other'],
      color: TEXT_PALETTE[category] || TEXT_PALETTE['Other'],
      fontSize: '11px',
      fontWeight: 500,
      padding: '3px 8px',
      borderRadius: '999px',
      whiteSpace: 'nowrap',
      letterSpacing: '0.02em',
    }}>
      {category}
    </span>
  );
}

function ItemRow({ item, category, selected, onToggle, columns }) {
  return (
    <tr
      onClick={onToggle}
      style={{
        background: selected ? '#EBF4FF' : 'var(--color-background-primary)',
        cursor: 'pointer',
        transition: 'background 0.1s',
      }}
    >
      <td style={{ padding: '10px 14px', width: '36px' }}>
        <div style={{
          width: '16px', height: '16px', borderRadius: '4px', flexShrink: 0,
          border: selected ? 'none' : '1.5px solid var(--color-border-secondary)',
          background: selected ? '#378ADD' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {selected && (
            <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
              <path d="M1 3.5L3 5.5L8 1" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
      </td>
      {columns.map(col => (
        <td key={col.key} style={{
          padding: '10px 14px',
          fontSize: '13px',
          color: col.primary ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
          fontWeight: col.primary ? 500 : 400,
          maxWidth: col.primary ? '260px' : '140px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {col.key === '_category'
            ? <CategoryBadge category={item[col.key]} />
            : item[col.key] ?? '—'}
        </td>
      ))}
    </tr>
  );
}

export default function App() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [selected, setSelected] = useState(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notes, setNotes] = useState('');
  const [requesterName, setRequesterName] = useState('');
  const [submissionSummary, setSubmissionSummary] = useState(null);

  useEffect(() => {
    fetch(`${process.env.REACT_APP_API_URL || 'http://localhost:8000'}/api/supplies`)
      .then(r => r.json())
      .then(json => { setData(json); setLoading(false); })
      .catch(() => { setLoadError('Could not connect to server.'); setLoading(false); });
  }, []);

  const enriched = useMemo(() =>
    data.map(item => ({ ...item, _category: categorize(item) })),
    [data]
  );

  const categories = useMemo(() => {
    const cats = ['All', ...new Set(enriched.map(i => i._category))].sort((a, b) =>
      a === 'All' ? -1 : b === 'All' ? 1 : a.localeCompare(b)
    );
    return cats;
  }, [enriched]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return enriched.filter(item => {
      const matchesQuery = !q || Object.values(item).some(v =>
        String(v).toLowerCase().includes(q)
      );
      const matchesCat = activeCategory === 'All' || item._category === activeCategory;
      return matchesQuery && matchesCat;
    });
  }, [enriched, query, activeCategory]);

  const toggleItem = (sheetRow) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(sheetRow) ? next.delete(sheetRow) : next.add(sheetRow);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selected.size === 0) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL || 'http://localhost:8000'}/api/requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requester_name: requesterName.trim() || 'External User',
          notes,
          items: [...selected].map(sheetRow => ({ sheet_row: sheetRow })),
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || 'Request submission failed.');
      }

      setSubmissionSummary(payload);
      setSubmitting(false);
      setSubmitted(true);
    } catch (err) {
      setSubmitting(false);
      setSubmitError(err.message || 'Request submission failed.');
    }
  };

  const reset = () => {
    setSubmitted(false);
    setSelected(new Set());
    setNotes('');
    setRequesterName('');
    setSubmissionSummary(null);
    setQuery('');
    setActiveCategory('All');
    setSubmitError(null);
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '300px' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: '32px', height: '32px', border: '2.5px solid var(--color-border-tertiary)',
          borderTopColor: '#378ADD', borderRadius: '50%', margin: '0 auto 16px',
          animation: 'spin 0.8s linear infinite',
        }} />
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', margin: 0 }}>Loading supplies...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );

  if (loadError) return (
    <div style={{ padding: '40px 24px', textAlign: 'center' }}>
      <p style={{ color: 'var(--color-text-danger)', fontSize: '14px' }}>{loadError}</p>
    </div>
  );

  if (submitted) {
    const selectedItems = enriched.filter(item => selected.has(item._sheet_row));
    return (
      <div style={{ maxWidth: '640px', margin: '0 auto', padding: '40px 24px', fontFamily: 'var(--font-sans)' }}>
        <div style={{
          background: 'var(--color-background-success)',
          border: '0.5px solid var(--color-border-success)',
          borderRadius: '12px', padding: '20px 24px', marginBottom: '24px',
          display: 'flex', alignItems: 'center', gap: '12px',
        }}>
          <div style={{
            width: '28px', height: '28px', borderRadius: '50%', background: '#639922',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <svg width="14" height="11" viewBox="0 0 14 11" fill="none">
              <path d="M1 5.5L5 9.5L13 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <p style={{ margin: 0, fontWeight: 500, fontSize: '15px', color: 'var(--color-text-success)' }}>Request submitted</p>
            <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--color-text-success)' }}>
              {submissionSummary?.count || selected.size} item{selected.size !== 1 ? 's' : ''} requested and emailed to the team
            </p>
          </div>
        </div>

        {submissionSummary?.requested_supply_ids?.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: '0 0 6px' }}>Supply IDs sent</p>
            <p style={{ fontSize: '14px', color: 'var(--color-text-primary)', margin: 0 }}>
              {submissionSummary.requested_supply_ids.join(', ')}
            </p>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
          {selectedItems.map((item, i) => {
            const nameKey = Object.keys(item).find(k =>
              ['name', 'item', 'description', 'supply', 'product'].some(n => k.toLowerCase().includes(n))
            ) || Object.keys(item)[0];
            return (
              <div key={i} style={{
                background: 'var(--color-background-secondary)',
                borderRadius: '8px', padding: '10px 14px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span style={{ fontSize: '14px', color: 'var(--color-text-primary)' }}>{item[nameKey]}</span>
                <CategoryBadge category={item._category} />
              </div>
            );
          })}
        </div>

        {notes && (
          <div style={{ marginBottom: '20px' }}>
            <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: '0 0 6px' }}>Notes</p>
            <p style={{ fontSize: '14px', color: 'var(--color-text-primary)', margin: 0 }}>{notes}</p>
          </div>
        )}

        <button onClick={reset} style={{
          background: 'transparent', border: '0.5px solid var(--color-border-secondary)',
          borderRadius: '8px', padding: '9px 18px', fontSize: '14px', cursor: 'pointer',
          color: 'var(--color-text-primary)',
        }}>
          New request
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '28px 24px', fontFamily: 'var(--font-sans)' }}>

      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 500, margin: '0 0 4px', color: 'var(--color-text-primary)' }}>
          Supply request
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', margin: 0 }}>
          Search for what you need, select items, and submit a request.
        </p>
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: '16px' }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
          style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
          <circle cx="6.5" cy="6.5" r="4.5" stroke="var(--color-text-tertiary)" strokeWidth="1.5"/>
          <path d="M10 10L14 14" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <input
          type="text"
          placeholder="Search by name, type, or keyword..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box',
            paddingLeft: '38px', paddingRight: '14px',
            fontSize: '14px',
          }}
        />
      </div>

      {/* Category pills */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '20px' }}>
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            style={{
              padding: '5px 12px', fontSize: '13px', borderRadius: '999px', cursor: 'pointer',
              border: activeCategory === cat ? 'none' : '0.5px solid var(--color-border-secondary)',
              background: activeCategory === cat
                ? (cat === 'All' ? '#378ADD' : PALETTE[cat] || PALETTE['Other'])
                : 'transparent',
              color: activeCategory === cat
                ? (cat === 'All' ? 'white' : TEXT_PALETTE[cat] || TEXT_PALETTE['Other'])
                : 'var(--color-text-secondary)',
              fontWeight: activeCategory === cat ? 500 : 400,
              transition: 'all 0.12s',
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Results count */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: 0 }}>
          {filtered.length} item{filtered.length !== 1 ? 's' : ''}
          {query && ` matching "${query}"`}
        </p>
        {selected.size > 0 && (
          <button onClick={() => setSelected(new Set())} style={{
            fontSize: '12px', color: 'var(--color-text-secondary)', background: 'transparent',
            border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline',
          }}>
            Clear {selected.size} selected
          </button>
        )}
      </div>

      {/* Table list */}
      {filtered.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center' }}>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', margin: 0 }}>
            No items found. Try a different search or category.
          </p>
        </div>
      ) : (() => {
        const allKeys = data.length > 0 ? Object.keys(data[0]) : [];
        const nameKey = allKeys.find(k =>
          ['name', 'item', 'description', 'supply', 'product'].some(n => k.toLowerCase().includes(n))
        ) || allKeys[0];
        const rest = allKeys.filter(k => k !== nameKey).slice(0, 4);
        const columns = [
          { key: nameKey, label: nameKey, primary: true },
          ...rest.map(k => ({ key: k, label: k, primary: false })),
          { key: '_category', label: 'Category', primary: false },
        ];
        return (
          <div style={{ border: '0.5px solid var(--color-border-tertiary)', borderRadius: '10px', overflow: 'hidden', marginBottom: '28px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <thead>
                <tr style={{ background: 'var(--color-background-secondary)', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                  <th style={{ width: '44px', padding: '9px 14px' }} />
                  {columns.map(col => (
                    <th key={col.key} style={{
                      padding: '9px 14px', textAlign: 'left',
                      fontSize: '12px', fontWeight: 500,
                      color: 'var(--color-text-secondary)',
                      letterSpacing: '0.03em',
                      textTransform: 'uppercase',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && (
                      <tr style={{ height: 0 }}>
                        <td colSpan={columns.length + 1} style={{ padding: 0, borderTop: '0.5px solid var(--color-border-tertiary)' }} />
                      </tr>
                    )}
                    <ItemRow
                      item={item}
                      category={item._category}
                      selected={selected.has(item._sheet_row)}
                      onToggle={() => toggleItem(item._sheet_row)}
                      columns={columns}
                    />
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* Submit panel */}
      {selected.size > 0 && (
        <div style={{
          position: 'sticky', bottom: 0,
          background: 'var(--color-background-primary)',
          borderTop: '0.5px solid var(--color-border-tertiary)',
          padding: '16px 0 4px',
          marginTop: '8px',
        }}>
          <textarea
            placeholder="Add notes for your request (optional)..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'vertical',
              fontSize: '13px', marginBottom: '12px', padding: '10px 12px',
              borderRadius: '8px', border: '0.5px solid var(--color-border-secondary)',
              background: 'var(--color-background-secondary)',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-sans)',
            }}
          />
          <input
            type="text"
            placeholder="Your name (optional)"
            value={requesterName}
            onChange={e => setRequesterName(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box',
              fontSize: '13px', marginBottom: '12px', padding: '10px 12px',
              borderRadius: '8px', border: '0.5px solid var(--color-border-secondary)',
              background: 'var(--color-background-secondary)',
              color: 'var(--color-text-primary)',
            }}
          />
          {submitError && (
            <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--color-text-danger)' }}>
              {submitError}
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{
                background: submitting ? 'var(--color-background-secondary)' : '#185FA5',
                color: submitting ? 'var(--color-text-secondary)' : 'white',
                border: 'none', borderRadius: '8px', padding: '10px 20px',
                fontSize: '14px', fontWeight: 500, cursor: submitting ? 'default' : 'pointer',
                transition: 'background 0.15s',
              }}
            >
              {submitting ? 'Submitting...' : `Submit request (${selected.size} item${selected.size !== 1 ? 's' : ''})`}
            </button>
            <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
              {[...selected].slice(0, 3).map(sheetRow => {
                const item = enriched.find(entry => entry._sheet_row === sheetRow);
                if (!item) return null;
                const nameKey = Object.keys(item).find(k =>
                  ['name', 'item', 'description', 'supply', 'product'].some(n => k.toLowerCase().includes(n))
                ) || Object.keys(item)[0];
                return item[nameKey];
              }).filter(Boolean).join(', ')}
              {selected.size > 3 ? ` +${selected.size - 3} more` : ''}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
