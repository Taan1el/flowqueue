import React, { useState, useEffect, useCallback } from 'react';
import { api, QueueWithStats } from './services/api';
import { Job, JobPriority, JobStatus, QueueMetrics, WebhookDelivery, WebhookSubscription } from '../../shared/types';
import { MetricsBanner } from './components/MetricsBanner';
import { QueueCard } from './components/QueueCard';
import { JobList } from './components/JobList';
import { JobDrawer } from './components/JobDrawer';
import { EnqueueJobModal } from './components/EnqueueJobModal';
import { WebhookDeliveries } from './components/WebhookDeliveries';
import './App.css';

export const App: React.FC = () => {
  const [metrics, setMetrics] = useState<QueueMetrics | null>(null);
  const [queues, setQueues] = useState<QueueWithStats[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [webhookSubs, setWebhookSubs] = useState<WebhookSubscription[]>([]);
  const [webhookDeliveries, setWebhookDeliveries] = useState<WebhookDelivery[]>([]);

  const [activeTab, setActiveTab] = useState<'tasks' | 'webhooks'>('tasks');
  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<JobStatus | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<JobPriority | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [inspectedJobId, setInspectedJobId] = useState<string | null>(null);
  const [isEnqueueModalOpen, setIsEnqueueModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [m, q, jList, subs, dels] = await Promise.all([
        api.getMetrics(),
        api.getQueues(),
        api.listJobs({
          queue_id: selectedQueueId || undefined,
          status: statusFilter || undefined,
          priority: priorityFilter || undefined,
          search: searchQuery.trim() || undefined,
        }),
        api.getWebhookSubscriptions(),
        api.getWebhookDeliveries(),
      ]);

      setMetrics(m);
      setQueues(q);
      setJobs(jList.jobs);
      setWebhookSubs(subs);
      setWebhookDeliveries(dels);
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    }
  }, [selectedQueueId, statusFilter, priorityFilter, searchQuery]);

  useEffect(() => {
    setLoading(true);
    loadData().finally(() => setLoading(false));
  }, [loadData]);

  // Periodic polling for real-time queue synchronization
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
      loadData();
    } catch (err: any) {
      alert(`Error updating queue: ${err.message}`);
    }
  };

  const handleReplayJob = async (jobId: string) => {
    try {
      await api.retryJob(jobId);
      loadData();
    } catch (err: any) {
      alert(`Error replaying job: ${err.message}`);
    }
  };

  return (
    <div className="app-container">
      <MetricsBanner
        metrics={metrics}
        loading={loading}
        onRefresh={loadData}
        autoRefresh={autoRefresh}
        onToggleAutoRefresh={() => setAutoRefresh((prev) => !prev)}
      />

      <main className="main-content">
        <div className="content-tabs-bar">
          <div className="tabs-nav" role="tablist">
            <button
              className={`tab-btn ${activeTab === 'tasks' ? 'active' : ''}`}
              onClick={() => setActiveTab('tasks')}
              role="tab"
              aria-selected={activeTab === 'tasks'}
            >
              📋 Queue Engine & Tasks
            </button>
            <button
              className={`tab-btn ${activeTab === 'webhooks' ? 'active' : ''}`}
              onClick={() => setActiveTab('webhooks')}
              role="tab"
              aria-selected={activeTab === 'webhooks'}
            >
              🔔 Webhooks & Dispatches ({webhookDeliveries.length})
            </button>
          </div>

          <button
            className="btn btn-primary"
            onClick={() => setIsEnqueueModalOpen(true)}
            aria-label="Enqueue New Background Task"
          >
            + Enqueue Task
          </button>
        </div>

        {activeTab === 'tasks' ? (
          <>
            <section className="queues-section" aria-label="Task Queues">
              <div className="section-title-wrap">
                <h2 className="section-heading">Active Queues</h2>
                {selectedQueueId && (
                  <button
                    className="btn btn-link btn-xs"
                    onClick={() => setSelectedQueueId(null)}
                  >
                    Clear Filter
                  </button>
                )}
              </div>
              <div className="queues-grid">
                {queues.map((q) => (
                  <QueueCard
                    key={q.id}
                    queue={q}
                    isSelected={selectedQueueId === q.id}
                    onSelectQueue={(id) => setSelectedQueueId((prev) => (prev === id ? null : id))}
                    onTogglePause={handleTogglePause}
                  />
                ))}
              </div>
            </section>

            <section className="jobs-section" aria-label="Task List">
              <JobList
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
                onInspectJob={(id) => setInspectedJobId(id)}
                onReplayJob={handleReplayJob}
              />
            </section>
          </>
        ) : (
          <WebhookDeliveries
            subscriptions={webhookSubs}
            deliveries={webhookDeliveries}
            onRefresh={loadData}
          />
        )}
      </main>

      <JobDrawer
        jobId={inspectedJobId}
        onClose={() => setInspectedJobId(null)}
        onJobUpdated={loadData}
      />

      <EnqueueJobModal
        queues={queues}
        isOpen={isEnqueueModalOpen}
        onClose={() => setIsEnqueueModalOpen(false)}
        onJobEnqueued={loadData}
      />
    </div>
  );
};
