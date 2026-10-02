const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

/** Clock time such as 14:05:09. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '-' : timeFormat.format(date);
}

/** Milliseconds as "412 ms" or "5.0 s". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '-';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

/** First eight characters of an id. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** Whole seconds until `iso`, or 0 when it is already due. */
export function secondsUntil(iso: string, nowMs: number): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - nowMs) / 1000));
}
