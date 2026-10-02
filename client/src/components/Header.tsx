import React from 'react';
import { Plus, RefreshCw } from 'lucide-react';

interface HeaderProps {
  loading: boolean;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  onRefresh: () => void;
  onEnqueue: () => void;
  children?: React.ReactNode;
}

export const Header: React.FC<HeaderProps> = ({
  loading,
  autoRefresh,
  onToggleAutoRefresh,
  onRefresh,
  onEnqueue,
  children,
}) => (
  <header className="app-header">
    <div className="header-inner">
      <div className="brand">
        <h1 className="brand-name">FlowQueue</h1>
        <p className="brand-subtitle">
          Background job queue with capacity-aware workers, retries, dead letters and signed webhooks.
        </p>
      </div>

      <div className="header-actions">
        <label className="checkbox-field">
          <input type="checkbox" checked={autoRefresh} onChange={onToggleAutoRefresh} />
          Refresh every 3 s
        </label>
        <button className="btn btn-secondary" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
          {loading ? 'Refreshing' : 'Refresh'}
        </button>
        <button className="btn btn-primary" onClick={onEnqueue}>
          <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          Enqueue job
        </button>
      </div>
    </div>
    {children}
  </header>
);
