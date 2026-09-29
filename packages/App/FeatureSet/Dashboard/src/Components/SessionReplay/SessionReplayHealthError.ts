/*
 * The recording-health failure vocabulary, split out of
 * useSessionReplayHealth so it can be read without React.
 *
 * The hook that owns the poller is a React module; the classification of a
 * failure and the copy for it are neither React nor DOM. Every surface that
 * only needs to say WHY health is missing - the overview's detail row, a
 * node test - imports this file, and App's test/compile passes never pull
 * react into their program through it.
 *
 * useSessionReplayHealth re-exports all three names, so existing importers
 * are unchanged.
 */

export type SessionReplayHealthErrorKind =
  /* 401/403: the viewer lacks the session-replay read permission. */
  | "permission"
  /* 402: the project's plan does not include session replay. */
  | "plan"
  /* Anything else: network, 5xx, malformed body. */
  | "other";

export interface SessionReplayHealthError {
  kind: SessionReplayHealthErrorKind;
  /* The server's own message, kept for the "details" line only. */
  message: string;
}

/*
 * Honest copy per failure class. The raw server string is kept as a
 * secondary line, never as the headline: "Please upgrade your plan" and
 * "Not authorized" do not tell the person which permission or plan they
 * are missing, and both used to be printed bare in red.
 */
export function describeHealthError(error: SessionReplayHealthError): {
  title: string;
  detail: string;
} {
  if (error.kind === "permission") {
    return {
      title: "You cannot see recording health",
      detail:
        "Reading recording health needs the Read Session Replay permission (project owners, admins and telemetry admins have it). Ask a project admin to grant it, or to run this check for you.",
    };
  }

  if (error.kind === "plan") {
    return {
      title: "Recording health is not included in this project's plan",
      detail:
        "Session replay needs a plan that includes it. Once the plan is upgraded, this check and the recordings themselves become available. The project-wide master switch is never plan-gated.",
    };
  }

  return {
    title: "Recording health could not be loaded",
    detail:
      "The health request failed, so nothing here says whether recording works. It retries on its own; the next poll may succeed.",
  };
}
