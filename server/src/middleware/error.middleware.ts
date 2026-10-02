import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../lib/errors.js';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  // body-parser errors carry their own 4xx status; anything else is a bug.
  const status =
    err instanceof HttpError
      ? err.status
      : typeof (err as { status?: unknown })?.status === 'number'
        ? (err as { status: number }).status
        : 500;
  if (status >= 500) console.error('[Unhandled API Error]:', err);
  const message = status >= 500 ? 'Internal Server Error' : (err as Error).message || 'Request failed';
  res.status(status).json({ success: false, error: message });
}
