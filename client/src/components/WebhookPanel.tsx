import React, { useState } from 'react';
import { Send } from 'lucide-react';
import type { WebhookDelivery, WebhookSubscription } from '../../../shared/types.js';
import { api } from '../services/index.js';
import { Breakable } from './Breakable.js';
import { formatDuration, formatTime } from '../utils/format.js';
import { formatCount } from '../utils/pluralize.js';

interface WebhookPanelProps {
  subscriptions: WebhookSubscription[];
  deliveries: WebhookDelivery[];
  onRefresh: () => void;
}

const isOk = (code: number) => code >= 200 && code < 300;

export const WebhookPanel: React.FC<WebhookPanelProps> = ({ subscriptions, deliveries, onRefresh }) => {
  const [testingId, setTestingId] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const sendTest = async (sub: WebhookSubscription) => {
    setTestingId(sub.id);
    setResult(null);
    try {
      const delivery = await api.triggerTestWebhook(sub.id, 'job.completed');
      setResult({
        ok: isOk(delivery.status_code),
        text: `${sub.name} answered ${delivery.status_code} in ${formatDuration(delivery.duration_ms)}.`,
      });
      onRefresh();
    } catch (err: any) {
      setResult({ ok: false, text: `Test delivery failed: ${err.message}` });
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="split">
      <ul className="dense-list" aria-label="Recent webhook deliveries">
        {deliveries.length === 0 && <li className="list-empty">No webhook deliveries recorded yet.</li>}
        {deliveries.map((d) => (
          <li key={d.id} className="delivery">
            <span className="mono">{formatTime(d.delivered_at)}</span>
            <span className="status mono">
              <span className={`dot ${isOk(d.status_code) ? 'dot-active' : 'dot-bad'}`} aria-hidden="true" />
              {d.status_code}
            </span>
            <span className="delivery-who">
              <span className="mono delivery-event">{d.event}</span> to {d.subscription_name || d.subscription_id}
            </span>
            <span className="mono">{formatDuration(d.duration_ms)}</span>
            <code className="delivery-line" title={d.signature}>
              {d.signature}
            </code>
            <span className="delivery-line is-quiet" title={d.response_body || undefined}>
              {d.response_body ? `Response: ${d.response_body}` : 'No response body'}
            </span>
          </li>
        ))}
      </ul>

      <aside className="side-panel" aria-labelledby="subscriptions-heading">
        <h3 className="panel-heading" id="subscriptions-heading">
          {formatCount(subscriptions.length, 'subscription')}
        </h3>
        {subscriptions.map((sub) => (
          <div key={sub.id} className="subscription">
            <p className="subscription-name">{sub.name}</p>
            <p className="subscription-url">
              <Breakable text={sub.url} />
            </p>
            <p className="subscription-meta">{sub.events.join(', ')}</p>
            <p className="subscription-meta">{`Secret ${sub.secret}`}</p>
            <button
              className="btn btn-secondary btn-compact"
              onClick={() => sendTest(sub)}
              disabled={testingId === sub.id}
              aria-label={`Send test delivery to ${sub.name}`}
            >
              <Send size={14} strokeWidth={1.75} aria-hidden="true" />
              {testingId === sub.id ? 'Sending' : 'Send test delivery'}
            </button>
          </div>
        ))}
        {result && <output className={`test-result${result.ok ? '' : ' is-error'}`}>{result.text}</output>}
      </aside>
    </div>
  );
};
