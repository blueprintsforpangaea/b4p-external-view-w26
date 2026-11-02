import { useMemo, useState } from 'react';
import { useDebounced } from '../hooks';
import { suggest } from '../suggest';
import Icon from './Icons';

const LIST_ID = 'search-suggestions';

// The search box with suggestions under it as you type (supply names and categories, close
// spellings too). Arrow keys move, Enter picks the highlighted one (or searches what was typed),
// Escape closes the list (a second Escape clears the box). Picking one fills the box and
// calls onPick. ARIA combobox pattern: focus stays in the box; the highlighted option is
// announced through aria-activedescendant.
export default function SearchBox({ value, onChange, onPick, index }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = useDebounced(value, 80);
  const options = useMemo(() => (index ? suggest(typed, index) : []), [typed, index]);
  const shown = open && value.trim() !== '' && options.length > 0;

  const pick = (option) => {
    onChange(option.label);
    setOpen(false);
    setActive(-1);
    onPick();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!shown) { setOpen(true); return; }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      // Past either end goes back to what was typed (-1), as on Google.
      setActive((i) => {
        const next = i + step;
        return next >= options.length ? -1 : next < -1 ? options.length - 1 : next;
      });
    } else if (e.key === 'Enter' && shown && options[active]) {
      e.preventDefault();
      pick(options[active]);
    } else if (e.key === 'Escape') {
      if (shown) { e.preventDefault(); setOpen(false); setActive(-1); }
      else if (value) { e.preventDefault(); onChange(''); }
    }
  };

  return (
    <div className="suggest">
      <span className="finder__search">
        <Icon name="search" size={22} />
        <input id="supply-search" type="search" autoComplete="off" spellCheck="false" enterKeyHint="search"
          role="combobox" aria-expanded={shown} aria-controls={LIST_ID} aria-autocomplete="list"
          aria-activedescendant={shown && options[active] ? `suggestion-${active}` : undefined}
          aria-describedby="search-hint" value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
          onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKeyDown} />
      </span>
      <ul className="suggest__list" id={LIST_ID} role="listbox" aria-label="Suggestions" hidden={!shown}>
        {shown && options.map((o, i) => (
          // Mouse down would blur the box (and close the list) before the click lands.
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events
          <li key={`${o.kind}|${o.label}`} id={`suggestion-${i}`} role="option" aria-selected={i === active}
            className="suggest__item" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)}
            onMouseMove={() => i !== active && setActive(i)}>
            <Icon name={o.kind === 'category' ? 'list' : 'search'} size={18} />
            <span className="suggest__text">
              {o.label.slice(0, o.start)}<b>{o.label.slice(o.start, o.end)}</b>{o.label.slice(o.end)}
            </span>
            {o.kind === 'category' && <span className="suggest__kind">Category</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
