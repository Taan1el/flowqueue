import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TriangleAlert } from 'lucide-react';
import { api } from './services/index.js';
import type { QueueWithStats } from './services/index.js';
import type { Job, JobPriority, JobStatus, QueueMetrics, WebhookDelivery, WebhookSubscription } from '../../shared/types.js';
import { Header } from './components/Header.js';
import { DemoBanner } from './components/DemoBanner.js';
import { StatsBar } from './components/StatsBar.js';
import { QueueTabs } from './components/QueueTabs.js';
import { EventLog } from './components/EventLog.js';
import { JobsTable } from './components/JobsTable.js';
import { EnqueueForm } from './components/EnqueueForm.js';
import { DeadLetters } from './components/DeadLetters.js';
import { WebhookPanel } from './components/WebhookPanel.js';
import { JobInspector } from './components/JobInspector.js';
import { formatCount } from './utils/pluralize.js';
import './App.css';

type PanelId = 'dead' | 'webhooks' | 'enqueue';

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
  const [panel, setPanel] = useState<PanelId>('dead');
  const [enqueueRequests, setEnqueueRequests] = useState(0);
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
    setPanel('enqueue');
    setEnqueueRequests((n) => n + 1);
  };

  // The form only exists while its tab is open, so focus it after the tab renders.
  useEffect(() => {
    if (enqueueRequests === 0) return;
    document.getElementById('enqueue-form')?.scrollIntoView({ block: 'nearest' });
    queueSelectRef.current?.focus();
  }, [enqueueRequests]);

  const handleTabKeys = (e: React.KeyboardEvent) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const ids = panels.map((p) => p.id);
    const at = ids.indexOf(panel);
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
    setPanel(ids[next]);
    document.getElementById(`tab-${ids[next]}`)?.focus();
  };

  const panels: { id: PanelId; label: string }[] = [
    { id: 'dead', label: `Dead letters (${deadLetters.length})` },
    { id: 'webhooks', label: `Webhooks (${webhookSubs.length})` },
    { id: 'enqueue', label: 'Enqueue' },
  ];

  return (
    <div className="app-container">
      <DemoBanner onReset={loadData} />

      <Header
        loading={loading}
        onRefresh={loadData}
        autoRefresh={autoRefresh}
        onToggleAutoRefresh={() => setAutoRefresh((prev) => !prev)}
        onEnqueue={focusEnqueueForm}
      >
        <StatsBar metrics={metrics} />
      </Header>

      <main className="console">
        {error && (
          <div className="alert console-alert">
            <span className="alert-message">
              <TriangleAlert size={16} strokeWidth={1.75} aria-hidden="true" />
              <output>{error}</output>
            </span>
            <button className="btn btn-secondary btn-compact" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}

        <section className="rail" aria-labelledby="queues-heading">
          <h2 className="rule-title" id="queues-heading">
            Queues
          </h2>
          <p className="section-note">Each queue runs at most its capacity at once. Pausing stops new starts.</p>
          <QueueTabs
            queues={queues}
            selectedQueueId={selectedQueueId}
            onSelectQueue={(id) => setSelectedQueueId((prev) => (prev === id ? null : id))}
            onTogglePause={handleTogglePause}
          />
        </section>

        <div className="work">
          <section aria-labelledby="jobs-heading">
            <h2 className="rule-title" id="jobs-heading">
              Jobs
            </h2>
            <p className="section-note">{`${formatCount(jobsTotal, 'job')} match the filters, newest first.`}</p>
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
          </section>

          <section className="under-tabs" aria-label="Dead letters, webhooks and enqueue">
            <div className="tabbar" role="tablist" aria-label="Job tools" onKeyDown={handleTabKeys}>
              {panels.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  id={`tab-${p.id}`}
                  aria-selected={panel === p.id}
                  aria-controls={`panel-${p.id}`}
                  tabIndex={panel === p.id ? 0 : -1}
                  className="tab"
                  onClick={() => setPanel(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div role="tabpanel" id={`panel-${panel}`} aria-labelledby={`tab-${panel}`} className="tabpanel">
              {panel === 'dead' && (
                <>
                  <p className="section-note">Jobs that used all of their attempts. Replaying one grants a single extra run.</p>
                  <DeadLetters jobs={deadLetters} onInspectJob={setInspectedJobId} onReplayJob={handleReplayJob} />
                </>
              )}
              {panel === 'webhooks' && (
                <>
                  <p className="section-note">
                    Job events are posted once to each subscribed endpoint with an HMAC-SHA256 signature header.
                  </p>
                  <WebhookPanel subscriptions={webhookSubs} deliveries={webhookDeliveries} onRefresh={loadData} />
                </>
              )}
              {panel === 'enqueue' && <EnqueueForm queues={queues} onJobEnqueued={loadData} ref={queueSelectRef} />}
            </div>
          </section>
        </div>

        <aside className="log" aria-labelledby="log-heading">
          <h2 className="rule-title" id="log-heading">
            Event log
          </h2>
          <EventLog jobs={jobs} deliveries={webhookDeliveries} />
        </aside>
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
