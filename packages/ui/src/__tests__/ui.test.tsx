import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Spinner } from '../components/Spinner.js';
import { Toast, type ToastData } from '../components/Toast.js';
import { Autocomplete } from '../components/Autocomplete.js';

// Ensure DOM is cleaned between tests even without globals mode.
afterEach(() => { cleanup(); });

// jsdom doesn't implement scrollIntoView — stub it.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = () => undefined;
});

// ─── Spinner ──────────────────────────────────────────────────────────────────

describe('Spinner', () => {
  it('renders an SVG with role=status', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('accepts size prop without error', () => {
    const { unmount } = render(<Spinner size="lg" />);
    unmount();
  });
});

// ─── Toast ────────────────────────────────────────────────────────────────────

describe('Toast', () => {
  it('renders the message', () => {
    const toast: ToastData = { id: '1', message: 'Hello world', variant: 'success' };
    render(<Toast toast={toast} onDismiss={() => undefined} />);
    expect(screen.getByText('Hello world')).toBeTruthy();
  });

  it('calls onDismiss when close button clicked', async () => {
    const user = userEvent.setup();
    let dismissed = false;
    const toast: ToastData = { id: '2', message: 'Bye', variant: 'info' };
    render(<Toast toast={toast} onDismiss={() => { dismissed = true; }} />);
    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(dismissed).toBe(true);
  });
});

// ─── Autocomplete ─────────────────────────────────────────────────────────────

describe('Autocomplete', () => {
  const options = [
    { value: 'main', label: 'main' },
    { value: 'dev', label: 'develop' },
    { value: 'feat', label: 'feature/new-ui' },
  ];

  it('renders the trigger button', () => {
    render(<Autocomplete options={options} onChange={() => undefined} placeholder="Pick a branch" />);
    expect(screen.getByText('Pick a branch')).toBeTruthy();
  });

  it('opens dropdown and shows options on click', async () => {
    const user = userEvent.setup();
    render(<Autocomplete options={options} onChange={() => undefined} placeholder="Pick" />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getByText('main')).toBeTruthy();
    expect(screen.getByText('develop')).toBeTruthy();
  });

  it('calls onChange with selected value', async () => {
    const user = userEvent.setup();
    let selected: string | undefined;
    render(<Autocomplete options={options} onChange={v => { selected = v; }} placeholder="Pick" />);
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByText('develop'));
    expect(selected).toBe('dev');
  });
});
