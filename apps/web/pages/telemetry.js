import { useEffect, useState } from "react";
import Link from "next/link";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
const ADMIN_KEY_STORAGE = "gh-projects-admin-key";

const formatDuration = (ms) => {
  if (!ms || ms <= 0) {
    return "0s";
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
};

const formatEventValue = (event) => {
  if (!event) {
    return "-";
  }
  if (event.eventType === "time_on_page" && Number.isFinite(event.value)) {
    return formatDuration(event.value);
  }
  if (Number.isFinite(event.value)) {
    return String(event.value);
  }
  return "-";
};

const formatTimestamp = (value) => {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
};

export default function TelemetryPage() {
  const [adminKey, setAdminKey] = useState("");
  const [summary, setSummary] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem(ADMIN_KEY_STORAGE);
    if (stored) {
      setAdminKey(stored);
    }
  }, []);

  const promptAdminKey = () => {
    if (typeof window === "undefined") {
      return;
    }
    const next = window.prompt(
      adminKey
        ? "Update admin key (leave blank to clear)"
        : "Enter admin key"
    );
    if (next === null) {
      return;
    }
    const trimmed = next.trim();
    if (!trimmed) {
      window.localStorage.removeItem(ADMIN_KEY_STORAGE);
      setAdminKey("");
      return;
    }
    window.localStorage.setItem(ADMIN_KEY_STORAGE, trimmed);
    setAdminKey(trimmed);
  };

  const loadTelemetry = async () => {
    if (!adminKey) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE_URL}/admin/telemetry`, {
        headers: { "x-admin-key": adminKey }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load telemetry");
      }
      setSummary(payload.summary || null);
      setEvents(Array.isArray(payload.recentEvents) ? payload.recentEvents : []);
    } catch (err) {
      setError(err.message || "Failed to load telemetry");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (adminKey) {
      loadTelemetry();
    }
  }, [adminKey]);

  const avgTime =
    summary && summary.pageViews
      ? Math.round(summary.timeOnPageMs / summary.pageViews)
      : 0;

  return (
    <main className="telemetry-page">
      <header className="telemetry-header">
        <div className="telemetry-intro">
          <p className="eyebrow">Telemetry</p>
          <h1>Usage overview</h1>
          <p className="muted">
            Admin-only telemetry for page usage and chat activity.
          </p>
        </div>
        <div className="telemetry-actions">
          <button type="button" className="ghost-button" onClick={promptAdminKey}>
            Admin key
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={loadTelemetry}
            disabled={!adminKey || loading}
          >
            Refresh
          </button>
          <Link className="ghost-button" href="/">
            Back
          </Link>
        </div>
      </header>

      {!adminKey ? (
        <p className="status error">Admin key required to view telemetry.</p>
      ) : error ? (
        <p className="status error">{error}</p>
      ) : summary ? (
        <>
          <section className="telemetry-grid">
            <div className="telemetry-card">
              <span className="telemetry-label">Unique visitors</span>
              <span className="telemetry-value">{summary.uniqueVisitors}</span>
            </div>
            <div className="telemetry-card">
              <span className="telemetry-label">Page views</span>
              <span className="telemetry-value">{summary.pageViews}</span>
            </div>
            <div className="telemetry-card">
              <span className="telemetry-label">Time on page</span>
              <span className="telemetry-value">
                {formatDuration(summary.timeOnPageMs)}
              </span>
              <span className="telemetry-sub">
                Avg {formatDuration(avgTime)}
              </span>
            </div>
            <div className="telemetry-card">
              <span className="telemetry-label">Total messages</span>
              <span className="telemetry-value">{summary.totalMessages}</span>
              <span className="telemetry-sub">
                User {summary.userMessages} / AI {summary.assistantMessages}
              </span>
            </div>
            <div className="telemetry-card">
              <span className="telemetry-label">Chat sessions</span>
              <span className="telemetry-value">{summary.sessions}</span>
            </div>
          </section>

          <section className="telemetry-events">
            <h2>Recent events</h2>
            {events.length === 0 ? (
              <p className="muted">No telemetry events yet.</p>
            ) : (
              <div className="telemetry-table-wrap">
                <table className="telemetry-table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Value</th>
                      <th>Path</th>
                      <th>Visitor</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event) => (
                      <tr key={event.id}>
                        <td>{event.eventType}</td>
                        <td>{formatEventValue(event)}</td>
                        <td>{event.metadata?.path || "-"}</td>
                        <td>{event.visitorId || "-"}</td>
                        <td>{formatTimestamp(event.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : (
        <p className="muted">Loading telemetry...</p>
      )}
    </main>
  );
}
