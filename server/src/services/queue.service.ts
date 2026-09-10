import { QueueRepository, QueueWithStats } from '../repositories/queue.repository.js';
import { JobRepository, ListJobsFilter } from '../repositories/job.repository.js';
import { EnqueueJobDto, Job, JobPriority, UpdateQueueDto } from '../../../shared/types.js';

export class QueueService {
  constructor(
    private queueRepo: QueueRepository,
    private jobRepo: JobRepository
  ) {}

  listQueues(): QueueWithStats[] {
    return this.queueRepo.getAllQueues();
  }

  updateQueue(id: string, updates: UpdateQueueDto) {
    return this.queueRepo.updateQueue(id, updates);
  }

  enqueue(dto: EnqueueJobDto): { job: Job; duplicate: boolean } {
    if (!dto.queue_name || !dto.name) {
      throw new Error('queue_name and name are required to enqueue a job');
    }

    // 1. Resolve queue
    let queue = this.queueRepo.getQueueByName(dto.queue_name);
    if (!queue) {
      throw new Error(`Queue '${dto.queue_name}' does not exist.`);
    }

    // 2. Check Idempotency Key
    if (dto.idempotency_key) {
      const existing = this.jobRepo.getJobByIdempotencyKey(dto.idempotency_key);
      if (existing) {
        return { job: existing, duplicate: true };
      }
    }

    const priority: JobPriority = dto.priority || 'normal';
    const maxRetries = dto.max_retries ?? queue.max_retries;

    const job = this.jobRepo.createJob({
      queue_id: queue.id,
      name: dto.name,
      priority,
      payload: dto.payload || {},
      idempotency_key: dto.idempotency_key,
      max_retries: maxRetries,
      delay_seconds: dto.delay_seconds || 0,
    });

    return { job, duplicate: false };
  }

  getJob(id: string) {
    return this.jobRepo.getJobById(id);
  }

  listJobs(filters: ListJobsFilter) {
    return this.jobRepo.listJobs(filters);
  }

  retryJob(id: string): Job {
    const job = this.jobRepo.getJobById(id);
    if (!job) {
      throw new Error(`Job ${id} not found`);
    }
    if (job.status !== 'dlq' && job.status !== 'failed') {
      throw new Error(`Only failed or DLQ jobs can be replayed (current status: ${job.status})`);
    }

    const replayed = this.jobRepo.replayDlqJob(id);
    if (!replayed) {
      throw new Error(`Could not replay job ${id}`);
    }
    return replayed;
  }
}
