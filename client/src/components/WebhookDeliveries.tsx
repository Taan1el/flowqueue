import React, { useState } from 'react';
import { WebhookDelivery, WebhookSubscription } from '../../../shared/types';
import { api } from '../services/api';

interface WebhookDeliveriesProps {
  subscriptions: WebhookSubscription[];
  deliveries: WebhookDelivery[];
  onRefresh: () => void;
}

export const WebhookDeliveries: React.FC<WebhookDeliveriesProps> = ({
  subscriptions,
  deliveries,
  onRefresh,
}) => {
  const [testingSubId, setTestingSubId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const handleTriggerTest = async (sub: WebhookSubscription) => {
    setTestingSubId(sub.id);
    setTestResult(null);
    try {
      const delivery = await api.triggerTestWebhook(sub.id, 'job.completed');
      setTestResult(
        `Dispatched test webhook to ${sub.url}! Status: ${delivery.status_code} (${delivery.duration_ms}ms) | Signature: ${delivery.signature}`
      );
      onRefresh();
    } catch (err: any) {
      setTestResult(`Test dispatch failed: ${err.message}`);
    } finally {
      setTestingSubId(null);
    }
  };

  return (
    <div className="webhooks-section">
      <div className="section-header">
        <div>
          <h2 className="section-heading">Webhook Subscriptions & HMAC Dispatcher</h2>
          <p className="section-subheading">
            Outbound webhooks signed with <code>X-FlowQueue-Signature: sha256=HMAC_SHA256(payload, secret)</code>.
          </p>
        </div>
      </div>

      {testResult && (
        <div className="alert-box alert-info">
          {testResult}
        </div>
      )}

      <div className="subscriptions-grid">
        {subscriptions.map((sub) => (
          <div key={sub.id} className="sub-card">
            <div className="sub-header">
              <span className="sub-title">{sub.name}</span>
              <span className="badge badge-success">Active</span>
            </div>
            <div className="sub-url font-mono">{sub.url}</div>
            <div className="sub-events">
              <span className="sub-label">Events:</span>
              {sub.events.map((ev: string) => (
                <span key={ev} className="event-pill">{ev}</span>
              ))}
            </div>
            <div className="sub-secret">
              <span className="sub-label">Secret:</span>
              <span className="font-mono text-xs">{sub.secret.substring(0, 10)}••••••••</span>
            </div>
            <div className="sub-actions">
              <button
                className="btn btn-secondary btn-xs"
                onClick={() => handleTriggerTest(sub)}
                disabled={testingSubId === sub.id}
              >
                {testingSubId === sub.id ? 'Dispatching...' : '⚡ Test HMAC Dispatch'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="section-divider" />

      <h3 className="subheading-margin">Recent Deliveries Audit Trail</h3>
      <div className="table-responsive">
        <table className="data-table">
          <thead>
            <tr>
              <th>Delivered At</th>
              <th>Subscription</th>
              <th>Event</th>
              <th>Status</th>
              <th>Latency</th>
              <th>HMAC-SHA256 Signature</th>
              <th>Response</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.length === 0 ? (
              <tr>
                <td colSpan={7} className="table-empty">
                  No webhook deliveries recorded yet.
                </td>
              </tr>
            ) : (
              deliveries.map((del) => (
                <tr key={del.id}>
                  <td className="text-xs text-muted">
                    {new Date(del.delivered_at).toLocaleTimeString()}
                  </td>
                  <td>{del.subscription_name || del.subscription_id}</td>
                  <td>
                    <span className="event-pill">{del.event}</span>
                  </td>
                  <td>
                    <span className={`badge ${del.status_code === 200 ? 'badge-success' : 'badge-danger'}`}>
                      {del.status_code}
                    </span>
                  </td>
                  <td>{del.duration_ms} ms</td>
                  <td className="font-mono text-xs font-truncate max-w-200">
                    {del.signature}
                  </td>
                  <td className="text-xs text-muted font-truncate max-w-200">
                    {del.response_body || '--'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
