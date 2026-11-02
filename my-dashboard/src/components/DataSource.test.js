import { render, screen } from '@testing-library/react';
import DataSource from './DataSource';

afterEach(() => jest.restoreAllMocks());

const health = (body, ok = true) => jest.spyOn(global, 'fetch').mockResolvedValue({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) });

test('says when the supplies come from the database', async () => {
  health({ source: 'postgres', ok: true, email: null });
  render(<DataSource />);
  expect(await screen.findByText(/Supplies from the Postgres database/)).toBeInTheDocument();
});

test('says when they come from the Google Sheet', async () => {
  health({ source: 'sheet', ok: true, email: null });
  render(<DataSource />);
  expect(await screen.findByText(/Supplies from the Google Sheet/)).toBeInTheDocument();
});

test('says when it reads the live sheet, read-only', async () => {
  health({ source: 'sheet-public', ok: true, email: null });
  render(<DataSource />);
  expect(await screen.findByText(/Supplies from the live Google Sheet \(read-only\)/)).toBeInTheDocument();
});

test('sample data is never labelled as the sheet', async () => {
  health({ source: 'sample', ok: true, email: null });
  render(<DataSource />);
  expect(await screen.findByText(/Sample data, not the real inventory/)).toBeInTheDocument();
  expect(screen.queryByText(/Google Sheet/)).not.toBeInTheDocument();
});

test('a database that is set up but down is called out', async () => {
  health({ source: 'postgres', ok: false, email: null });
  render(<DataSource />);
  expect(await screen.findByText(/Postgres database \(not answering\)/)).toBeInTheDocument();
});

test('no answer from the server', async () => {
  jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
  render(<DataSource />);
  expect(await screen.findByText(/Couldn’t ask the server/)).toBeInTheDocument();
});
