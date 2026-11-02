import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { buildIndex } from '../suggest';
import SearchBox from './SearchBox';

const index = buildIndex(['Nitrile exam gloves', 'Sterile gloves', '10 mL syringe'], ['Gloves']);

function Box({ onPick = () => {} }) {
  const [value, setValue] = useState('');
  return <SearchBox value={value} onChange={setValue} onPick={onPick} index={index} />;
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const type = (text) => {
  const box = screen.getByRole('combobox');
  fireEvent.focus(box);
  fireEvent.change(box, { target: { value: text } });
  act(() => { jest.advanceTimersByTime(100); });
  return box;
};

test('typing shows suggestions with the match in bold; arrows and Enter pick one', () => {
  const onPick = jest.fn();
  render(<Box onPick={onPick} />);
  const box = type('glo');
  expect(box).toHaveAttribute('aria-expanded', 'true');
  const options = screen.getAllByRole('option');
  expect(options.map((o) => o.textContent)).toEqual(['GlovesCategory', 'Sterile gloves', 'Nitrile exam gloves']);
  expect(options[1].querySelector('b')).toHaveTextContent('glo');
  fireEvent.keyDown(box, { key: 'ArrowDown' });
  fireEvent.keyDown(box, { key: 'ArrowDown' });
  expect(box).toHaveAttribute('aria-activedescendant', 'suggestion-1');
  expect(options[1]).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(box).toHaveValue('Sterile gloves');
  expect(box).toHaveAttribute('aria-expanded', 'false');
  expect(onPick).toHaveBeenCalledTimes(1);
});

test('Escape closes the list, a second Escape clears the box; clicking a suggestion picks it', () => {
  render(<Box />);
  const box = type('syr');
  fireEvent.keyDown(box, { key: 'Escape' });
  expect(screen.queryByRole('option')).not.toBeInTheDocument();
  expect(box).toHaveValue('syr');
  fireEvent.keyDown(box, { key: 'Escape' });
  expect(box).toHaveValue('');
  type('glvoes');
  fireEvent.click(screen.getByRole('option', { name: /Gloves/ }));
  expect(box).toHaveValue('Gloves');
});

test('leaving the box closes the list', () => {
  render(<Box />);
  const box = type('glo');
  fireEvent.blur(box);
  expect(screen.queryByRole('option')).not.toBeInTheDocument();
});
