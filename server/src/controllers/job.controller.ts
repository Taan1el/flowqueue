import { Request, Response, NextFunction } from 'express';
import { QueueService } from '../services/queue.service.js';
import { parseEnqueueBody, parseJobListQuery } from '../lib/validation.js';

export class JobController {
  constructor(private queueService: QueueService) {}

  enqueue = (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = this.queueService.enqueue(parseEnqueueBody(req.body));

      // 201 Created, or 200 OK when the idempotency key already exists
      res.status(result.duplicate ? 200 : 201).json({
        success: true,
        data: result.job,
        meta: {
          idempotent_duplicate: result.duplicate,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  list = (req: Request, res: Response, next: NextFunction) => {
    try {
      const filters = parseJobListQuery(req.query);
      const result = this.queueService.listJobs(filters);

      res.json({
        success: true,
        data: result.jobs,
        meta: { total: result.total, limit: filters.limit, offset: filters.offset },
      });
    } catch (err) {
      next(err);
    }
  };

  getById = (req: Request, res: Response, next: NextFunction) => {
    try {
      const job = this.queueService.getJob(req.params.id);
      if (!job) {
        res.status(404).json({ success: false, error: 'Job not found' });
        return;
      }
      res.json({ success: true, data: job });
    } catch (err) {
      next(err);
    }
  };

  retry = (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: this.queueService.retryJob(req.params.id) });
    } catch (err) {
      next(err);
    }
  };
}
