import { ResourceTopologyHealth } from "./ResourceTopologyModel";

/*
 * Status words, as inventories report them ("running", "exited", "down",
 * "CrashLoopBackOff"), read as health. The lists follow the badge colours
 * the product's own resource tables give the same words
 * (Components/Infrastructure/ResourceTable getStatusBadgeClass: green,
 * yellow, red), plus the words that mean a thing was stopped on purpose,
 * which the map shows as off rather than as a problem.
 */

const HEALTHY_WORDS: ReadonlySet<string> = new Set<string>([
  "running",
  "ready",
  "active",
  "bound",
  "succeeded",
  "available",
  "true",
  "up",
  "online",
  "connected",
  "healthy",
  "ok",
  "powered on",
  "enabled",
  "replicating",
  "in quorum",
]);

const WARNING_WORDS: ReadonlySet<string> = new Set<string>([
  "pending",
  "unknown",
  "waiting",
  "terminating",
  "degraded",
  "warn",
  "warning",
  "restarting",
  "starting",
  "preparing",
  "assigned",
  "accepted",
  "allocated",
  "new",
  "unrecognized",
  "not ready",
  "drain",
  "pause",
]);

const CRITICAL_WORDS: ReadonlySet<string> = new Set<string>([
  "failed",
  "crashloopbackoff",
  "error",
  "lost",
  "notready",
  "imagepullbackoff",
  "false",
  "down",
  "offline",
  "err",
  "dead",
  "rejected",
  "orphaned",
  "critical",
  "missing",
  "unhealthy",
  "disconnected",
]);

const OFF_WORDS: ReadonlySet<string> = new Set<string>([
  "exited",
  "stopped",
  "shutdown",
  "complete",
  "completed",
  "created",
  "paused",
  "removed",
  "remove",
  "released",
  "powered off",
  "disabled",
  "not installed",
  "not_installed",
]);

/* The health a status word means, or null for a word this list does not know. */
export function healthOfStatusWord(
  word: string | null | undefined,
): ResourceTopologyHealth | null {
  const normalized: string = (word || "").trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (CRITICAL_WORDS.has(normalized)) {
    return "critical";
  }

  if (WARNING_WORDS.has(normalized)) {
    return "warning";
  }

  if (OFF_WORDS.has(normalized)) {
    return "off";
  }

  if (HEALTHY_WORDS.has(normalized)) {
    return "healthy";
  }

  return null;
}

/* "not_installed" -> "Not installed", "running" -> "Running". */
export function formatStatusWord(word: string | null | undefined): string {
  const normalized: string = (word || "").trim();

  if (!normalized) {
    return "";
  }

  if (normalized.toLowerCase() === "ok") {
    return "OK";
  }

  const spaced: string = normalized.split("_").join(" ");

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
