export function formatRelativeTime(dateString: string): string {
  const now: number = Date.now();
  const date: number = new Date(dateString).getTime();
  const seconds: number = Math.floor((now - date) / 1000);

  if (seconds < 60) {
    return "just now";
  }

  const minutes: number = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours: number = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days: number = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }

  const months: number = Math.floor(days / 30);
  if (months < 12) {
    return `${months}mo ago`;
  }

  const years: number = Math.floor(months / 12);
  return `${years}y ago`;
}

export function formatDateTime(dateString: string): string {
  const date: Date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
