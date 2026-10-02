import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TriangleAlert } from 'lucide-react';
import { api } from './services/index.js';
import type { QueueWithStats } from './services/index.js';
import type { Job, JobPriority, JobStatus, QueueMetrics, WebhookDelivery, WebhookSubscription } from '../../shared/types.js';
import { Header } from './components/Header.js';
import { DemoBanner } from './components/DemoBanner.js';
import { StatsBar } from './components/StatsBar.js';
import { QueuesTable } from './components/QueuesTable.js';
import { JobsTable } from './components/JobsTable.js';
import { EnqueueForm } from './components/EnqueueForm.js';
import { DeadLetters } from './components/DeadLetters.js';
import { WebhookPanel } from './components/WebhookPanel.js';
import { JobInspector } from './components/JobInspector.js';
import { formatCount } from './utils/pluralize.js';
import './App.css';

export const App: React.FC = () => {
  const [metrics, setMetrics] = useState<QueueMetrics | null>(null);
  const [queues, setQueues] = useState<QueueWithStats[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsTotal, setJobsTotal] = useState(0);
  const [deadLetters, setDeadLetters] = useState<Job[]>([]);
  const [webhookSubs, setWebhookSubs] = useState<WebhookSubscription[]>([]);
  const [webhookDeliveries, setWebhookDeliveries] = useState<WebhookDelivery[]>([]);

  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<JobStatus | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<JobPriority | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [inspectedJobId, setInspectedJobId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const queueSelectRef = useRef<HTMLSelectElement>(null);

  const loadData = useCallback(async () => {
    try {
      const [m, q, jList, dlq, subs, dels] = await Promise.all([
        api.getMetrics(),
        api.getQueues(),
        api.listJobs({
          queue_id: selectedQueueId || undefined,
          status: statusFilter || undefined,
          priority: priorityFilter || undefined,
          search: searchQuery.trim() || undefined,
        }),
        api.listJobs({ status: 'dlq' }),
        api.getWebhookSubscriptions(),
        api.getWebhookDeliveries(),
      ]);

      setMetrics(m);
      setQueues(q);
      setJobs(jList.jobs);
      setJobsTotal(jList.total);
      setDeadLetters(dlq.jobs);
      setWebhookSubs(subs);
      setWebhookDeliveries(dels);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Could not load dashboard data');
    }
  }, [selectedQueueId, statusFilter, priorityFilter, searchQuery]);

  useEffect(() => {
    setLoading(true);
    loadData().finally(() => setLoading(false));
  }, [loadData]);

  // Poll so queue depth and job states stay current.
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      loadData();
    }, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadData]);

  const handleTogglePause = async (queueId: string, currentPaused: boolean) => {
    try {
      await api.updateQueue(queueId, { is_paused: !currentPaused });
      await loadData();
    } catch (err: any) {
      setError(`Could not update the queue: ${err.message}`);
    }
  };

  const handleReplayJob = async (jobId: string) => {
    try {
      await api.retryJob(jobId);
      await loadData();
    } catch (err: any) {
      setError(`Could not replay the job: ${err.message}`);
    }
  };

  const focusEnqueueForm = () => {
    document.getElementById('enqueue-form')?.scrollIntoView({ block: 'start' });
    queueSelectRef.current?.focus();
  };

  return (
    <div className="app-container">
      <DemoBanner onReset={loadData} />

      <Header
        loading={loading}
        onRefresh={loadData}
        autoRefresh={autoRefresh}
        onToggleAutoRefresh={() => setAutoRefresh((prev) => !prev)}
        onEnqueue={focusEnqueueForm}
      />

      <main className="app-main">
        {error && (
          <div className="alert">
            <span className="alert-message">
              <TriangleAlert size={16} strokeWidth={1.75} aria-hidden="true" />
              <output>{error}</output>
            </span>
            <button className="btn btn-secondary btn-compact" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}

        <StatsBar metrics={metrics} />

        <section aria-labelledby="queues-heading">
          <div className="section-head">
            <h2 className="section-heading" id="queues-heading">
              Queues
            </h2>
            <p className="section-description">
              Each queue runs at most its capacity in jobs at once; pausing stops new jobs from starting.
            </p>
          </div>
          <QueuesTable
            queues={queues}
            selectedQueueId={selectedQueueId}
            onSelectQueue={(id) => setSelectedQueueId((prev) => (prev === id ? null : id))}
            onTogglePause={handleTogglePause}
          />
        </section>

        <section aria-labelledby="jobs-heading">
          <div className="section-head">
            <h2 className="section-heading" id="jobs-heading">
              Jobs
            </h2>
            <p className="section-description">{`${formatCount(jobsTotal, 'job')} match the filters, newest first.`}</p>
          </div>
          <div className="split">
            <JobsTable
              jobs={jobs}
              queues={queues}
              selectedQueueId={selectedQueueId}
              onSelectQueueId={setSelectedQueueId}
              statusFilter={statusFilter}
              onSelectStatusFilter={setStatusFilter}
              priorityFilter={priorityFilter}
              onSelectPriorityFilter={setPriorityFilter}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onInspectJob={setInspectedJobId}
              onReplayJob={handleReplayJob}
            />
            <EnqueueForm queues={queues} onJobEnqueued={loadData} ref={queueSelectRef} />
          </div>
        </section>

        <section aria-labelledby="dlq-heading">
          <div className="section-head">
            <h2 className="section-heading" id="dlq-heading">
              Dead letters
            </h2>
            <p className="section-description">Jobs that used all of their attempts. Replaying one grants a single extra run.</p>
          </div>
          <DeadLetters jobs={deadLetters} onInspectJob={setInspectedJobId} onReplayJob={handleReplayJob} />
        </section>

        <section aria-labelledby="webhooks-heading">
          <div className="section-head">
            <h2 className="section-heading" id="webhooks-heading">
              Webhook deliveries
            </h2>
            <p className="section-description">
              Job events are posted once to each subscribed endpoint with an HMAC-SHA256 signature header.
            </p>
          </div>
          <WebhookPanel subscriptions={webhookSubs} deliveries={webhookDeliveries} onRefresh={loadData} />
        </section>
      </main>

      <footer className="app-footer">
        <div>FlowQueue &middot; MIT License</div>
        <a href="https://github.com/Taan1el/flowqueue" target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </footer>

      <JobInspector jobId={inspectedJobId} onClose={() => setInspectedJobId(null)} onJobUpdated={loadData} />
    </div>
  );
};

export default App;
