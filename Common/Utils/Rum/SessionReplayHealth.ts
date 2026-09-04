import {
  RecordingHealthAction,
  RecordingHealthActionTarget,
  RecordingHealthDiagnosis,
  RecordingHealthPolicy,
  RecordingHealthStatus,
  SessionReplayRefusalCount,
  SessionReplayRefusalReason,
  isSessionReplayRefusalReason,
} from "../../Types/Rum/SessionReplayHealth";
import SessionReplayCaptureTrigger from "../../Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "../../Types/Rum/SessionReplayConsentMode";
import {
  readDtoBoolean,
  readDtoNumber,
  readDtoOptionalNumber,
  readDtoString,
  readDtoStringArray,
} from "../../Types/Rum/SessionReplayApi";

/*
 * diagnoseRecordingHealth: one pure function that turns the ingest-status
 * response into the single sentence the list page, the settings page and
 * the setup guide all show.
 *
 * Pure and isomorphic (no Date.now(), no I/O, no DOM) so every state in
 * the priority table is a unit test with a fixed clock. The copy rules it
 * enforces are the product's, not decoration: name the cause, quantify
 * it, offer ONE action, never render a counter that was not read as 0,
 * and never say "disconnected" without saying why.
 */

/*
 * A refusal reason has to recur before it is reported as THE problem: a
 * handful of origin-not-allowed refusals in a day is a developer's local
 * build, hundreds is a misconfigured allowlist.
 */
export const SESSION_REPLAY_REFUSAL_ALERT_THRESHOLD: number = 5;

/*
 * A recorder that keeps fetching its policy but has not delivered a chunk
 * for this long is stuck, not quiet. 6h spans a working day's lull
 * without flagging a site that simply has evening traffic.
 */
export const SESSION_REPLAY_STALE_CHUNK_MS: number = 6 * 60 * 60 * 1000;

/*
 * "The recorder is loading on the site" means a policy fetch inside this
 * window. Past it the site may have removed the script, in which case a
 * missing chunk is quiet traffic rather than a stuck recorder.
 */
export const SESSION_REPLAY_RECORDER_ACTIVE_WINDOW_MS: number =
  24 * 60 * 60 * 1000;

const SECOND_MS: number = 1000;
const MINUTE_MS: number = 60 * SECOND_MS;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

/*
 * "12s ago", "5m ago", "7h ago", "3d ago". A future or sub-second time is
 * "just now" (clock skew between the browser and the server is normal); a
 * non-finite input is "unknown" so a bad timestamp can never render as
 * "0s ago", which would claim liveness that was never observed.
 */
export function formatRelativeAge(
  fromUnixMs: number,
  nowUnixMs: number,
): string {
  if (!Number.isFinite(fromUnixMs) || !Number.isFinite(nowUnixMs)) {
    return "unknown";
  }

  const ageMs: number = nowUnixMs - fromUnixMs;

  if (ageMs < SECOND_MS) {
    return "just now";
  }

  if (ageMs < MINUTE_MS) {
    return `${Math.floor(ageMs / SECOND_MS)}s ago`;
  }

  if (ageMs < HOUR_MS) {
    return `${Math.floor(ageMs / MINUTE_MS)}m ago`;
  }

  if (ageMs < DAY_MS) {
    return `${Math.floor(ageMs / HOUR_MS)}h ago`;
  }

  return `${Math.floor(ageMs / DAY_MS)}d ago`;
}

/* "1h", "6h", "3d" - a duration rather than an age, for "no chunk for 7h". */
export function formatDurationForCopy(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "unknown";
  }

  if (durationMs < MINUTE_MS) {
    return `${Math.floor(durationMs / SECOND_MS)}s`;
  }

  if (durationMs < HOUR_MS) {
    return `${Math.floor(durationMs / MINUTE_MS)}m`;
  }

  if (durationMs < DAY_MS) {
    return `${Math.floor(durationMs / HOUR_MS)}h`;
  }

  return `${Math.floor(durationMs / DAY_MS)}d`;
}

/*
 * A count for copy: "1,234", or "unknown" for null. Formatted by hand
 * rather than toLocaleString so the sentence is identical in every
 * browser locale and in tests.
 */
export function formatCountForCopy(count: number | null): string {
  if (count === null || !Number.isFinite(count)) {
    return "unknown";
  }

  const rounded: number = Math.max(0, Math.floor(count));
  const digits: string = String(rounded);
  let formatted: string = "";

  for (let index: number = 0; index < digits.length; index++) {
    const fromEnd: number = digits.length - index;

    if (index > 0 && fromEnd % 3 === 0) {
      formatted += ",";
    }

    formatted += digits[index];
  }

  return formatted;
}

/* "1 GB", "512 MB", "2.5 GB". Byte budgets are set in whole GB or MB. */
export function formatBytesForCopy(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "unknown";
  }

  const gb: number = bytes / (1024 * 1024 * 1024);

  if (gb >= 1) {
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  }

  const mb: number = bytes / (1024 * 1024);

  return `${Math.round(mb)} MB`;
}

/* ISO string -> unix ms, or null when absent or unparseable. */
export function parseHealthTimestamp(value: string | null): number | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const parsed: number = Date.parse(value);

  return Number.isFinite(parsed) ? parsed : null;
}

/*
 * Normalise the /ingest-status JSON. The legacy top-level policy fields
 * are folded into `policy`; every additive field defaults to null (not
 * measured) rather than 0 or "", and unknown refusal reasons are dropped
 * so the diagnosis only ever names a reason it has copy for. Returns null
 * for a body that is not an object at all, which the caller reports as
 * "unknown" health.
 */
export function parseRecordingHealthStatus(
  raw: unknown,
): RecordingHealthStatus | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const row: Record<string, unknown> = raw as Record<string, unknown>;

  const readNullableString: (key: string) => string | null = (
    key: string,
  ): string | null => {
    const value: unknown = row[key];

    return typeof value === "string" && value.length > 0 ? value : null;
  };

  const readNullableNumber: (key: string) => number | null = (
    key: string,
  ): number | null => {
    const value: number | undefined = readDtoOptionalNumber(row, key);

    return value === undefined ? null : value;
  };

  const rawRefusals: unknown = row["refusalsLast24h"];
  let refusals: Array<SessionReplayRefusalCount> | null = null;

  if (Array.isArray(rawRefusals)) {
    refusals = [];

    for (const entry of rawRefusals) {
      if (entry === null || typeof entry !== "object") {
        continue;
      }

      const entryRow: Record<string, unknown> = entry as Record<
        string,
        unknown
      >;
      const reason: unknown = entryRow["reason"];
      const count: number | undefined = readDtoOptionalNumber(
        entryRow,
        "count",
      );

      if (isSessionReplayRefusalReason(reason) && count !== undefined) {
        refusals.push({ reason: reason, count: count });
      }
    }
  }

  const retentionInDays: number | undefined = readDtoOptionalNumber(
    row,
    "retentionInDays",
  );

  const policy: RecordingHealthPolicy = {
    isProjectEnabled: readDtoBoolean(row, "isProjectAllowed"),
    isApplicationEnabled: readDtoBoolean(row, "isApplicationEnabled"),
    captureTrigger: readDtoString(row, "captureTrigger"),
    samplePercentage: readDtoNumber(row, "samplePercentage"),
    consentMode: readDtoString(row, "consentMode"),
    maskingMode: readDtoString(row, "maskingMode"),
    retentionInDays: retentionInDays === undefined ? null : retentionInDays,
  };

  return {
    appIdentifier: readDtoString(row, "appIdentifier"),
    allowedOrigins: readDtoStringArray(row, "allowedOrigins"),
    policy: policy,
    publishedRecorderVersion: readNullableString("publishedRecorderVersion"),
    lastConfigFetchAt: readNullableString("lastConfigFetchAt"),
    lastChunkReceivedAt: readNullableString("lastChunkReceivedAt"),
    lastSessionStartedAt: readNullableString("lastSessionStartedAt"),
    budgetExceededAt: readNullableString("budgetExceededAt"),
    sessionsLast24h: readNullableNumber("sessionsLast24h"),
    playableSessionsLast24h: readNullableNumber("playableSessionsLast24h"),
    refusalsLast24h: refusals,
    projectBytesUsedToday: readNullableNumber("projectBytesUsedToday"),
    dailyByteLimit: readDtoNumber(row, "dailyByteLimit"),
    applicationBytesUsedThisMonth: readNullableNumber(
      "applicationBytesUsedThisMonth",
    ),
    monthlyBudgetInGB: readNullableNumber("monthlyBudgetInGB"),
  };
}

/* The most frequent refusal reason, or null when nothing was refused. */
export function getTopRefusal(
  refusals: Array<SessionReplayRefusalCount> | null,
): SessionReplayRefusalCount | null {
  if (refusals === null || refusals.length === 0) {
    return null;
  }

  let top: SessionReplayRefusalCount | null = null;

  for (const refusal of refusals) {
    if (top === null || refusal.count > top.count) {
      top = refusal;
    }
  }

  return top;
}

interface RefusalCopy {
  /* Short, human: replaces the kebab-case reason in the title. */
  label: string;
  /* Says what to do about it, or why nothing in the product can. */
  detail: string;
  action?: RecordingHealthAction;
}

/*
 * One entry per gate reason, so the title never shows the bare reason
 * code. Deployment-level causes (ingest switched off, no artifact, Redis
 * down) have no action: nothing on a settings page fixes them, and
 * offering a link that cannot help is worse than saying so.
 */
const REFUSAL_COPY: Record<SessionReplayRefusalReason, RefusalCopy> = {
  "ingest-disabled": {
    label: "ingest is switched off on this deployment",
    detail:
      "SESSION_REPLAY_INGEST_ENABLED is false on the server, so every chunk is refused. Only the operator of this deployment can change that.",
  },
  "instance-not-offering-replay": {
    label: "this deployment publishes no recorder",
    detail:
      "No recorder artifact is built on this deployment, so chunks from a cached recorder are refused. Only the operator of this deployment can change that.",
  },
  "policy-unavailable": {
    label: "the policy lookup failed",
    detail:
      "The server could not load this application's replay policy and refused rather than guess. This clears on its own once the database is reachable.",
  },
  "not-enabled": {
    label: "replay was switched off when they arrived",
    detail:
      "Chunks arrived while the application or project had session replay switched off.",
    action: { label: "Check the switch", target: "app-settings" },
  },
  "origin-not-allowed": {
    label: "origin not allowed",
    detail: "Requests came from an origin that is not in your allowed origins.",
    action: { label: "Edit allowed origins", target: "allowed-origins" },
  },
  "session-chunk-cap": {
    label: "sessions hit the chunk cap",
    detail:
      "Some sessions reached the per-session chunk cap and stopped uploading; the recording up to that point is kept.",
  },
  "not-sampled": {
    label: "not sampled",
    detail:
      "The server's sampling draw refused chunks the recorder sent, which happens when the sample percentage was lowered while sessions were live.",
    action: { label: "Review sampling", target: "app-settings" },
  },
  "rate-limited": {
    label: "rate limited",
    detail:
      "Uploads exceeded the per-application rate limit and were refused. A burst of page loads clears on its own.",
  },
  "rate-counter-unavailable": {
    label: "the rate counter was unreachable",
    detail:
      "The server could not reach its rate counter and refused rather than guess. This clears on its own once the counter store is reachable.",
  },
  "budget-exhausted": {
    label: "the project's daily budget is spent",
    detail: "This project used its daily byte budget for session replay.",
    action: { label: "Review the budget", target: "budget" },
  },
  "budget-counter-unavailable": {
    label: "the budget counter was unreachable",
    detail:
      "The server could not reach its budget counter and refused rather than guess. This clears on its own once the counter store is reachable.",
  },
  "app-monthly-budget-exhausted": {
    label: "the monthly budget is spent",
    detail: "This application used its monthly byte budget for session replay.",
    action: { label: "Raise the budget", target: "budget" },
  },
};

function action(
  label: string,
  target: RecordingHealthActionTarget,
): RecordingHealthAction {
  return { label: label, target: target };
}

/* "for acme-web" when the identifier is known, "" otherwise. */
function appSuffix(status: RecordingHealthStatus): string {
  return status.appIdentifier ? ` for ${status.appIdentifier}` : "";
}

/*
 * What keeps a loaded recorder from ever uploading, read off the policy
 * alone. Ordered by how absolute the block is: sampling at 0% records
 * nothing at all; consent gates every upload until the page grants it;
 * the error/frustration trigger uploads nothing on a quiet day. When
 * none applies, the generic explanation points at the request path.
 */
function explainLoadedNeverUploaded(status: RecordingHealthStatus): {
  detail: string;
  action: RecordingHealthAction;
} {
  const policy: RecordingHealthPolicy = status.policy;

  if (policy.samplePercentage <= 0) {
    return {
      detail:
        "Your sample percentage is 0%, so no session is recorded. Raise it to record the next visitor.",
      action: action("Set sampling to 100%", "app-settings"),
    };
  }

  if (policy.consentMode === SessionReplayConsentMode.RequireExplicit) {
    return {
      detail:
        "Waiting for consent: the page has not called OneUptimeReplay.grantConsent(), and nothing uploads until it does.",
      action: action("How consent works", "docs-consent"),
    };
  }

  if (
    policy.captureTrigger === SessionReplayCaptureTrigger.OnErrorOrFrustration
  ) {
    return {
      detail:
        "Uploads only start when an error or frustration signal fires; a quiet day looks like nothing. Switch the trigger to Always to record every session.",
      action: action("Record every session", "app-settings"),
    };
  }

  return {
    detail:
      "The policy fetch succeeds but no chunk has arrived. Uploads flush every 15s, so a request is being blocked on the way: check the browser console for a CSP or ad-blocker refusal of the ingest URL.",
    action: action("Allow the recorder through your CSP", "docs-csp"),
  };
}

function isDailyBudgetSpent(status: RecordingHealthStatus): boolean {
  return (
    status.projectBytesUsedToday !== null &&
    status.dailyByteLimit > 0 &&
    status.projectBytesUsedToday >= status.dailyByteLimit
  );
}

/*
 * budgetExceededAt is a stamp, not a live flag. When the month's usage is
 * known and sits under the budget, the stamp is from a previous month and
 * uploads are flowing again; only then is it ignored.
 */
function isMonthlyBudgetPaused(status: RecordingHealthStatus): boolean {
  if (status.budgetExceededAt === null) {
    return false;
  }

  if (
    status.applicationBytesUsedThisMonth !== null &&
    status.monthlyBudgetInGB !== null &&
    status.monthlyBudgetInGB > 0 &&
    status.applicationBytesUsedThisMonth <
      status.monthlyBudgetInGB * 1024 * 1024 * 1024
  ) {
    return false;
  }

  return true;
}

/* "143 sessions in 24h (120 playable)", with unknown counters said so. */
function describeSessions(status: RecordingHealthStatus): string {
  const sessions: string = formatCountForCopy(status.sessionsLast24h);

  if (status.sessionsLast24h === null) {
    return "sessions in 24h: unknown";
  }

  const playable: string =
    status.playableSessionsLast24h === null
      ? ""
      : ` (${formatCountForCopy(status.playableSessionsLast24h)} playable)`;

  return `${sessions} session${status.sessionsLast24h === 1 ? "" : "s"} in 24h${playable}`;
}

/*
 * The diagnosis. Strict priority, first match wins:
 *
 *   disabled-project > disabled-app > budget-paused > refusing >
 *   never-loaded > loaded-never-uploaded > stale > healthy-quiet > healthy
 *
 * and "unknown" when there is no status to read. The order is the order
 * in which a fix has to happen: a switched-off project makes every later
 * signal moot, a spent budget explains any refusal, a refusal explains a
 * missing chunk, and only a recorder that is loading and uploading can be
 * stale or healthy.
 */
export function diagnoseRecordingHealth(
  status: RecordingHealthStatus | null,
  nowUnixMs: number,
): RecordingHealthDiagnosis {
  if (status === null) {
    return {
      state: "unknown",
      severity: "info",
      title: "Recording health is unknown",
      detail:
        "The health status could not be loaded, so nothing here says whether recording works. Reload to try again.",
    };
  }

  const policy: RecordingHealthPolicy = status.policy;

  if (!policy.isProjectEnabled) {
    return {
      state: "disabled-project",
      severity: "error",
      title: "Session replay is switched off for this project",
      detail:
        "Nothing is recorded for any application while the project switch is off, whatever the application settings say.",
      action: action("Turn it on", "project-settings"),
    };
  }

  if (!policy.isApplicationEnabled) {
    return {
      state: "disabled-app",
      severity: "error",
      title: `Session replay is switched off${appSuffix(status)}`,
      detail:
        "Recorders on this application's pages fetch a disabled policy and record nothing.",
      action: action("Turn it on", "app-settings"),
    };
  }

  if (isMonthlyBudgetPaused(status)) {
    const since: number | null = parseHealthTimestamp(status.budgetExceededAt);
    const sinceCopy: string =
      since === null ? "" : ` ${formatRelativeAge(since, nowUnixMs)}`;
    const budgetCopy: string =
      status.monthlyBudgetInGB === null
        ? "its monthly budget"
        : `its ${status.monthlyBudgetInGB} GB monthly budget`;

    return {
      state: "budget-paused",
      severity: "error",
      title: `Uploads paused${sinceCopy}`,
      detail: `This application used ${budgetCopy}. Uploads resume next month, or as soon as the budget is raised.`,
      action: action("Raise the budget", "budget"),
    };
  }

  if (isDailyBudgetSpent(status)) {
    return {
      state: "budget-paused",
      severity: "error",
      title: "Uploads paused for today",
      detail: `This project used its ${formatBytesForCopy(status.dailyByteLimit)} daily budget for session replay (${formatBytesForCopy(status.projectBytesUsedToday as number)} used). Uploads resume tomorrow.`,
      action: action("Review the budget", "budget"),
    };
  }

  const topRefusal: SessionReplayRefusalCount | null = getTopRefusal(
    status.refusalsLast24h,
  );

  if (
    topRefusal !== null &&
    topRefusal.count >= SESSION_REPLAY_REFUSAL_ALERT_THRESHOLD
  ) {
    const copy: RefusalCopy = REFUSAL_COPY[topRefusal.reason];

    return {
      state: "refusing",
      severity: "warning",
      title: `${formatCountForCopy(topRefusal.count)} uploads refused in 24h: ${copy.label}`,
      detail: copy.detail,
      ...(copy.action && { action: copy.action }),
    };
  }

  const lastConfigFetchUnixMs: number | null = parseHealthTimestamp(
    status.lastConfigFetchAt,
  );
  const lastChunkUnixMs: number | null = parseHealthTimestamp(
    status.lastChunkReceivedAt,
  );

  /*
   * Both null, not just the config stamp: an older server never sends
   * lastConfigFetchAt, and a recorder that has delivered a chunk has
   * self-evidently loaded.
   */
  if (lastConfigFetchUnixMs === null && lastChunkUnixMs === null) {
    return {
      state: "never-loaded",
      severity: "warning",
      title: `The recorder has never loaded${appSuffix(status)}`,
      detail:
        "No page has fetched this application's replay policy and no chunk has arrived. Add the script tag to your site, then reload a page that uses it.",
      action: action("Open the setup guide", "setup-guide"),
    };
  }

  if (lastChunkUnixMs === null) {
    const explanation: { detail: string; action: RecordingHealthAction } =
      explainLoadedNeverUploaded(status);

    return {
      state: "loaded-never-uploaded",
      severity: "warning",
      title: `The recorder loaded ${formatRelativeAge(lastConfigFetchUnixMs as number, nowUnixMs)} but nothing has been uploaded`,
      detail: explanation.detail,
      action: explanation.action,
    };
  }

  const chunkAgeMs: number = nowUnixMs - lastChunkUnixMs;
  const isRecorderStillLoading: boolean =
    lastConfigFetchUnixMs !== null &&
    nowUnixMs - lastConfigFetchUnixMs <=
      SESSION_REPLAY_RECORDER_ACTIVE_WINDOW_MS;

  if (chunkAgeMs > SESSION_REPLAY_STALE_CHUNK_MS && isRecorderStillLoading) {
    const explanation: { detail: string; action: RecordingHealthAction } =
      explainLoadedNeverUploaded(status);

    return {
      state: "stale",
      severity: "warning",
      title: `No chunk for ${formatDurationForCopy(chunkAgeMs)} while the recorder keeps loading`,
      detail: `The recorder last fetched its policy ${formatRelativeAge(lastConfigFetchUnixMs as number, nowUnixMs)}, but the last chunk arrived ${formatRelativeAge(lastChunkUnixMs, nowUnixMs)}. ${explanation.detail}`,
      action: explanation.action,
    };
  }

  if (chunkAgeMs > SESSION_REPLAY_STALE_CHUNK_MS) {
    const loadedCopy: string =
      lastConfigFetchUnixMs === null
        ? "when the recorder last loaded is unknown"
        : `the recorder last loaded ${formatRelativeAge(lastConfigFetchUnixMs, nowUnixMs)}`;

    return {
      state: "healthy-quiet",
      severity: "info",
      title: `No session recorded in the past ${formatDurationForCopy(chunkAgeMs)}`,
      detail: `The last chunk arrived ${formatRelativeAge(lastChunkUnixMs, nowUnixMs)} and ${loadedCopy}; the policy is healthy (sampling ${policy.samplePercentage}%). This looks like quiet traffic rather than a broken install.`,
    };
  }

  return {
    state: "healthy",
    severity: "ok",
    title: "Recording healthy",
    detail: `Last chunk ${formatRelativeAge(lastChunkUnixMs, nowUnixMs)} - ${describeSessions(status)} - sampling ${policy.samplePercentage}%.`,
  };
}
