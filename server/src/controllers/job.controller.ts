import { Request, Response, NextFunction } from 'express';
import { QueueService } from '../services/queue.service.js';
import { JobPriority, JobStatus } from '../../../shared/types.js';

export class JobController {
  constructor(private queueService: QueueService) {}

  enqueue = (req: Request, res: Response, next: NextFunction) => {
    try {
      const { queue_name, name, payload, priority, delay_seconds, idempotency_key, max_retries } = req.body;

      if (!queue_name || !name) {
        res.status(400).json({ success: false, error: 'queue_name and name are required' });
        return;
      }

      const result = this.queueService.enqueue({
        queue_name,
        name,
        payload: payload || {},
        priority: priority as JobPriority,
        delay_seconds: delay_seconds ? Number(delay_seconds) : 0,
        idempotency_key,
        max_retries: max_retries ? Number(max_retries) : undefined,
      });

      // 201 Created or 200 OK for idempotent duplicate
      const statusCode = result.duplicate ? 200 : 201;
      res.status(statusCode).json({
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
      const { queue_id, status, priority, search, limit, offset } = req.query;

      const result = this.queueService.listJobs({
        queue_id: queue_id ? String(queue_id) : undefined,
        status: status ? (String(status) as JobStatus) : undefined,
        priority: priority ? (String(priority) as JobPriority) : undefined,
        search: search ? String(search) : undefined,
        limit: limit ? Number(limit) : 50,
        offset: offset ? Number(offset) : 0,
      });

      res.json({
        success: true,
        data: result.jobs,
        meta: {
          total: result.total,
          limit: limit ? Number(limit) : 50,
          offset: offset ? Number(offset) : 0,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  getById = (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const job = this.queueService.getJob(id);
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
      const { id } = req.params;
      const job = this.queueService.retryJob(id);
      res.json({ success: true, data: job });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  };
}
