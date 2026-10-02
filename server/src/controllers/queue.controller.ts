import { Request, Response, NextFunction } from 'express';
import { QueueService } from '../services/queue.service.js';
import { parseQueueUpdate } from '../lib/validation.js';

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
      const updated = this.queueService.updateQueue(req.params.id, parseQueueUpdate(req.body));
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
