import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { formatDuration, formatTime, secondsUntil, shortId } from '../utils/format.js';
import { Breakable } from '../components/Breakable.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('demo banner', () => {
  it('renders nothing outside demo mode', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    const { DemoBanner } = await import('../components/DemoBanner.js');
    const { container } = render(<DemoBanner onReset={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the banner with both links in demo mode and resets after confirmation', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    const { DemoBanner } = await import('../components/DemoBanner.js');
    const onReset = vi.fn();
    render(<DemoBanner onReset={onReset} />);

    expect(screen.getByText('Demo: everything runs in your browser with sample data.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Source on GitHub' })).toHaveAttribute('href', 'https://github.com/Taan1el/flowqueue');

    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Reset sample data' }));
    expect(onReset).not.toHaveBeenCalled();

    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Reset sample data' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

describe('demo app', () => {
  it('runs the whole dashboard on the in-browser engine', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { App } = await import('../App.js');
    const { stopDemoWorker } = await import('../services/demoApi.js');
    render(<App />);

    expect(await screen.findByText('generate_monthly_analytics_pdf')).toBeInTheDocument();
    expect(screen.getByText('Demo: everything runs in your browser with sample data.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Webhooks/ }));
    expect(screen.getByText('2 subscriptions')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Enqueue' }));

    // enqueue through the form, then let the demo worker run it
    fireEvent.change(screen.getByLabelText('Job name'), { target: { value: 'send_invite_email' } });
    fireEvent.submit(document.getElementById('enqueue-form')!);
    expect(await screen.findByText(/^Enqueued job job_/)).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(6000);
    await waitFor(() => expect(screen.getAllByText('send_invite_email').length).toBeGreaterThan(0));
    stopDemoWorker();
  });
});

describe('format helpers', () => {
  it('formats durations', () => {
    expect(formatDuration(412)).toBe('412 ms');
    expect(formatDuration(1000)).toBe('1.0 s');
    expect(formatDuration(6000)).toBe('6.0 s');
    expect(formatDuration(null)).toBe('-');
    expect(formatDuration(undefined)).toBe('-');
  });

  it('formats clock times and tolerates bad input', () => {
    expect(formatTime('2026-10-02T09:05:07.000Z')).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(formatTime('not a date')).toBe('-');
  });

  it('shortens ids and counts down seconds', () => {
    expect(shortId('0123456789abcdef')).toBe('01234567');
    const now = Date.parse('2026-10-02T09:00:00.000Z');
    expect(secondsUntil('2026-10-02T09:00:10.500Z', now)).toBe(11);
    expect(secondsUntil('2026-10-02T08:59:00.000Z', now)).toBe(0);
  });
});

describe('Breakable', () => {
  it('lets text wrap only after separators', () => {
    const { container } = render(<Breakable text="https://hooks.example.com/a/b" />);
    expect(container.textContent).toBe('https://hooks.example.com/a/b');
    expect(container.querySelectorAll('wbr').length).toBeGreaterThan(3);
  });
});
