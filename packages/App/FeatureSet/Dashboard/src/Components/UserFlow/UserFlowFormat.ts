/*
 * Number formatting for the User Flows page. Pure, so the copy the page
 * prints is pinned by node tests.
 */

export function formatUserFlowCount(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return Math.round(value).toLocaleString("en-US");
}

/* 0.4567 -> "46%", 0.004 -> "<1%", 0 -> "0%". */
export function formatUserFlowShare(share: number): string {
  if (!Number.isFinite(share) || share <= 0) {
    return "0%";
  }

  const percent: number = share * 100;

  if (percent < 1) {
    return "<1%";
  }

  if (percent < 10 && Math.round(percent) !== percent) {
    return `${percent.toFixed(1)}%`;
  }

  return `${Math.round(percent)}%`;
}

export function formatUserFlowDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "—";
  }

  const seconds: number = Math.round(ms / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes: number = Math.floor(seconds / 60);
  const rest: number = seconds % 60;

  if (minutes < 60) {
    return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
  }

  const hours: number = Math.floor(minutes / 60);
  const restMinutes: number = minutes % 60;

  return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

/*
 * A label that fits a node box: keep the END of a path, which is the part
 * that names the page ("…/orders/:id/refund"), not the start.
 */
export function truncateUserFlowLabel(label: string, maxChars: number): string {
  if (label.length <= maxChars) {
    return label;
  }

  if (maxChars <= 1) {
    return "…";
  }

  return `…${label.slice(label.length - (maxChars - 1))}`;
}

export function pluralizeSessions(count: number): string {
  return `${formatUserFlowCount(count)} session${count === 1 ? "" : "s"}`;
}
