import { Request, Response, NextFunction } from 'express';
import { QueueService } from '../services/queue.service.js';

export class QueueController {
  constructor(private queueService: QueueService) {}

  list = (_req: Request, res: Response, next: NextFunction) => {
    try {
      const queues = this.queueService.listQueues();
      res.json({ success: true, data: queues });
    } catch (err) {
      next(err);
    }
  };

  update = (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { is_paused, concurrency, max_retries } = req.body;
      const updated = this.queueService.updateQueue(id, { is_paused, concurrency, max_retries });
      if (!updated) {
        res.status(404).json({ success: false, error: 'Queue not found' });
        return;
      }
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  };
}
