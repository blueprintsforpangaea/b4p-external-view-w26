import Icon from './Icons';

// The one search box, at the top of the supply pages. Results show as you type;
// the Search button is there because people expect one (it also closes a phone keyboard).
export default function SearchBar({ value, onChange }) {
  return (
    <form
      className="find"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        e.currentTarget.querySelector('input').blur();
      }}
    >
      <label htmlFor="supply-search" className="find__label">What do you need?</label>
      <div className="find__row">
        <input
          id="supply-search"
          className="find__input"
          type="search"
          autoComplete="off"
          spellCheck="false"
          enterKeyHint="search"
          placeholder="Type a supply, like gloves or gauze"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && value) {
              e.preventDefault();
              onChange('');
            }
          }}
        />
        <button type="submit" className="btn btn--primary find__btn">
          <Icon name="search" size={20} /> Search
        </button>
      </div>
    </form>
  );
}
