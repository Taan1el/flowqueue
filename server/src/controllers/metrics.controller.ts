import { Request, Response, NextFunction } from 'express';
import { MetricsService } from '../services/metrics.service.js';

export class MetricsController {
  constructor(private metricsService: MetricsService) {}

  getOverview = (_req: Request, res: Response, next: NextFunction) => {
    try {
      const metrics = this.metricsService.getMetrics();
      res.json({ success: true, data: metrics });
    } catch (err) {
      next(err);
    }
  };
}
