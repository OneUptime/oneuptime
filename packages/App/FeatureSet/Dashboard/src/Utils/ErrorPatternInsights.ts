import OneUptimeDate from "Common/Types/Date";
import {
  ErrorPatternCoOccurrenceRow,
  ErrorPatternCorrelation,
  ErrorPatternResourceRow,
  ErrorPatternTimelinePoint,
  ErrorPatternTrend,
  SharedAttribute,
  TopErrorPatternRow,
} from "./LogsInsights";

/*
 * "What is this error, and what should I do about it?" — computed from the
 * evidence the error drawer already fetched.
 *
 * Two layers, both deterministic:
 *
 *  - a CLASSIFICATION of the message against the error families that
 *    dominate production logs (timeouts, refused connections, DNS, TLS,
 *    auth, rate limits, OOM, disk, connection pools, null dereferences),
 *    each carrying the causes worth suspecting and the checks worth
 *    running;
 *  - FINDINGS over the correlation: did a deploy land just before it
 *    started, is it rising, is it confined to one host, does every
 *    occurrence share an attribute, does something else fire alongside it.
 *
 * Modelled on Utils/InvestigationFindings, and for the same reason: an
 * answer the user can point at beats an answer they have to trust. Every
 * finding names the evidence it came from, nothing here calls a model, and
 * the whole thing works on a project with no AI provider configured. The
 * model gets involved only when the user asks it to — through
 * buildErrorPatternPrompt, which hands Ask AI the entire evidence pack so
 * the user never has to re-describe the problem.
 *
 * Pure, so App/Tests can pin every rule without a renderer.
 */

// --- Classification ---

export interface ErrorPatternClassification {
  /** Stable id, for tests and for keying UI. */
  id: string;
  /** "Timed-out operation" — what family this message belongs to. */
  title: string;
  /** One sentence on what this family of error usually means. */
  summary: string;
  /** Ranked causes worth suspecting first. */
  likelyCauses: Array<string>;
  /** Concrete next steps, in the order worth doing them. */
  whatToCheck: Array<string>;
}

interface ClassificationRule extends ErrorPatternClassification {
  /*
   * Lowercased needles. Matching on substrings rather than regexes keeps
   * the table readable and cheap; the ordering below is what resolves a
   * message that hits more than one family.
   */
  needles: Array<string>;
  /*
   * HTTP status codes that name this family.
   *
   * Kept apart from `needles` because they cannot be matched the same way. A
   * bare "429" as a substring matches any digit run containing it — a
   * request id, a duration, a byte count, an epoch-millisecond timestamp, a
   * port, a line number — and this table is scanned against the RAW log body
   * (the normalized pattern has every number rewritten to a placeholder, so
   * a code can only ever match raw text). "Unhandled exception processing
   * request 0HMQ9A4292BC" classified as "Rate limited", with three checks
   * about retry loops and quotas, and the Ask AI prompt told the model the
   * same thing.
   *
   * These are matched only by matchesStatusCode below, and only after every
   * textual needle in the whole table has been tried.
   */
  statusCodes?: Array<number> | undefined;
}

/*
 * Ordered most-specific first. A message reading "connection timed out"
 * belongs with the timeouts, not with the generic connection failures, so
 * the narrower families are matched before the broader ones.
 */
const CLASSIFICATION_RULES: Array<ClassificationRule> = [
  {
    id: "oom",
    title: "Out of memory",
    summary:
      "The process (or its container) asked for more memory than it was allowed to have and was killed or refused.",
    needles: [
      "out of memory",
      "oomkilled",
      "oom killed",
      "enomem",
      "cannot allocate memory",
      "javascript heap out of memory",
      "outofmemoryerror",
      "memoryerror",
    ],
    likelyCauses: [
      "A memory limit set below what the workload actually needs",
      "A leak — memory that grows with uptime or with request volume rather than settling",
      "One oversized request, payload, or query result being held entirely in memory",
    ],
    whatToCheck: [
      "Compare the process memory metric against its limit over a window several times longer than this one — a leak slopes, a spike steps",
      "Check whether the restart count for this workload moved at the same time",
      "Look for an unbounded fetch, an unpaginated query, or a full-file read on the code path in the trace",
    ],
  },
  {
    id: "disk-full",
    title: "Out of disk space",
    summary: "A write failed because the filesystem or volume is full.",
    needles: [
      "no space left on device",
      "enospc",
      "disk full",
      "disk quota exceeded",
      "insufficient disk",
    ],
    likelyCauses: [
      "Logs, temp files, or an upload directory growing without rotation",
      "A volume sized for yesterday's throughput",
      "Retained artifacts — old builds, cores, database WAL — never collected",
    ],
    whatToCheck: [
      "Check disk usage on the hosts named below, and which directory is carrying the growth",
      "Confirm log rotation and temp-file cleanup are actually running on those hosts",
      "Check whether the fill rate is steady (sizing) or stepped (one runaway writer)",
    ],
  },
  {
    id: "rate-limited",
    title: "Rate limited",
    summary:
      "A dependency rejected the request because too many were sent in too short a window.",
    needles: [
      "too many requests",
      "rate limit",
      "ratelimit",
      "quota exceeded",
      "throttl",
    ],
    statusCodes: [429],
    likelyCauses: [
      "A retry loop amplifying a transient failure into a burst",
      "Traffic growth past a quota nobody re-negotiated",
      "A batch job running against the same quota as live traffic",
    ],
    whatToCheck: [
      "Check whether the call rate to that dependency stepped up at the moment below",
      "Look for retries without backoff and jitter on the failing path",
      "Confirm whether batch work and live traffic share the same credential or quota",
    ],
  },
  {
    id: "timeout",
    title: "Timed out",
    summary:
      "An operation was abandoned because a dependency did not answer inside its deadline.",
    needles: [
      "timeout",
      "timed out",
      "deadline exceeded",
      "context deadline",
      "etimedout",
      "esockettimedout",
      "read timed out",
      "socket hang up",
    ],
    likelyCauses: [
      "The dependency slowed down — its own latency, not this service's",
      "A client deadline shorter than the dependency's realistic worst case",
      "Connection-pool or thread starvation, where time is spent waiting for a slot rather than for the dependency",
    ],
    whatToCheck: [
      "Compare this service's p95 against the dependency's p95 over the same window — the one that moved first is the cause",
      "Open one of the traces below and find which span consumed the deadline",
      "Check pool saturation and queue depth on the failing path before touching the timeout value",
    ],
  },
  {
    id: "connection-refused",
    title: "Connection refused or reset",
    summary:
      "The target accepted no connection, or dropped one mid-flight — nothing was listening, or it went away.",
    needles: [
      "econnrefused",
      "connection refused",
      "econnreset",
      "connection reset",
      "epipe",
      "broken pipe",
      "ehostunreach",
      "no route to host",
      "connection closed",
    ],
    likelyCauses: [
      "The dependency is restarting, rescheduled, or scaled to zero",
      "A port, service name, or network policy changed",
      "A load balancer or sidecar draining connections faster than clients notice",
    ],
    whatToCheck: [
      "Check whether the dependency restarted or was redeployed in this window",
      "Confirm the address being dialled is still the right one — a rename or a port change reads exactly like this",
      "Check network policy and security-group changes against the first-seen time below",
    ],
  },
  {
    id: "dns",
    title: "Name resolution failed",
    summary: "A hostname could not be resolved to an address.",
    needles: [
      "enotfound",
      "eai_again",
      "no such host",
      "name resolution",
      "name or service not known",
      "dns lookup",
      "getaddrinfo",
      "servfail",
      "nxdomain",
    ],
    likelyCauses: [
      "A typo or stale hostname in configuration",
      "The cluster or host DNS resolver being unhealthy or rate limited",
      "A service that no longer exists under that name after a rename or namespace move",
    ],
    whatToCheck: [
      "Resolve the name from one of the hosts below — the failure is usually reproducible in one command",
      "Check the DNS resolver's own health and query rate in this window",
      "Compare the hostname in config against what the dependency is actually registered as",
    ],
  },
  {
    id: "tls",
    title: "TLS or certificate failure",
    summary:
      "The connection was refused during the TLS handshake or certificate validation.",
    needles: [
      "certificate",
      "x509",
      "ssl handshake",
      "tls handshake",
      "self signed",
      "self-signed",
      "unable to verify",
      "cert_has_expired",
      "unknown authority",
      "handshake failure",
    ],
    likelyCauses: [
      "A certificate that expired, or one renewed without the client trusting the new chain",
      "A missing intermediate certificate in the served chain",
      "A hostname that does not match any SAN on the certificate",
    ],
    whatToCheck: [
      "Check the certificate's expiry against the first-seen time below — expiries produce a sharp, permanent onset",
      "Verify the full chain the server presents, not just the leaf",
      "Confirm the hostname being dialled appears in the certificate's SANs",
    ],
  },
  {
    id: "auth",
    title: "Authentication or authorization failure",
    summary: "The request was rejected because of who it claimed to be.",
    needles: [
      "unauthorized",
      "unauthenticated",
      "forbidden",
      "permission denied",
      "access denied",
      "invalid token",
      "expired token",
      "invalid credentials",
      "signature",
      "eacces",
    ],
    statusCodes: [401, 403],
    likelyCauses: [
      "A rotated or expired credential that one caller never picked up",
      "A scope, role, or policy narrowed by a recent change",
      "Clock skew invalidating signed tokens",
    ],
    whatToCheck: [
      "Check whether a credential or key was rotated near the first-seen time below",
      "Compare the failing caller's scopes against what the endpoint now requires",
      "Check clock drift on the hosts below if the tokens are time-signed",
    ],
  },
  {
    id: "db-capacity",
    title: "Database capacity or contention",
    summary:
      "The database refused work, or work waited on another transaction long enough to be abandoned.",
    needles: [
      "too many connections",
      "connection pool",
      "pool exhausted",
      "deadlock detected",
      "lock wait timeout",
      "could not obtain lock",
      "max_connections",
      "sorry, too many clients",
      "connection limit",
    ],
    likelyCauses: [
      "More client instances than the connection limit was sized for",
      "Connections held open past the work that needed them",
      "Two code paths taking the same locks in different orders",
    ],
    whatToCheck: [
      "Compare active connections against the server's limit across every client of that database",
      "Look for long-running or idle-in-transaction sessions in this window",
      "For deadlocks, find the two statements involved and settle a single lock ordering",
    ],
  },
  {
    id: "upstream-5xx",
    title: "Upstream returned a server error",
    summary:
      "A dependency answered, and what it answered with was a failure of its own.",
    needles: [
      "bad gateway",
      "service unavailable",
      "gateway timeout",
      "upstream connect error",
      "internal server error",
    ],
    statusCodes: [502, 503, 504, 500],
    likelyCauses: [
      "The dependency is itself failing or overloaded",
      "A proxy or ingress with no healthy backend to route to",
      "A deploy of the dependency that has not finished rolling",
    ],
    whatToCheck: [
      "Look at the dependency's own error rate over this window before changing anything here",
      "Check its rollout and readiness state around the first-seen time below",
      "Confirm this service degrades rather than amplifies when that dependency fails",
    ],
  },
  {
    id: "null-dereference",
    title: "Missing or malformed value",
    summary:
      "Code read something that was not there — a null, an undefined, or a field of the wrong shape.",
    needles: [
      "nullpointerexception",
      "cannot read property",
      "cannot read properties",
      "undefined is not",
      "is not a function",
      "nonetype",
      "nil pointer",
      "unwrapped an optional",
      "index out of range",
      "keyerror",
      "typeerror",
    ],
    likelyCauses: [
      "A payload or response that stopped carrying a field the code assumed",
      "A code path reached with state it was never written for",
      "A schema or API version change on either side of the boundary",
    ],
    whatToCheck: [
      "Open a trace below and read the actual payload the failing span received",
      "Check whether the producer of that field deployed in this window",
      "Look at the attributes below — a value present on every occurrence usually names the input that triggers it",
    ],
  },
  {
    id: "parse",
    title: "Parse or deserialization failure",
    summary: "Input did not have the shape the parser expected.",
    needles: [
      "unexpected token",
      "json parse",
      "jsondecodeerror",
      "invalid character",
      "unmarshal",
      "deserializ",
      "malformed",
      "invalid json",
      "parse error",
      "syntaxerror",
    ],
    likelyCauses: [
      "An error page or redirect being parsed as the expected format",
      "A content-type or encoding change on the producing side",
      "Truncated input from a connection that ended early",
    ],
    whatToCheck: [
      "Look at the first bytes of the failing payload — an HTML error page is the most common answer",
      "Check the response status and content-type on the failing call, not just its body",
      "Check whether the producer changed serialization format in this window",
    ],
  },
  {
    id: "not-found",
    title: "Resource not found",
    summary: "A path, key, or record the code expected did not exist.",
    needles: [
      "enoent",
      "no such file",
      "not found",
      "does not exist",
      "filenotfound",
      "nosuchkey",
    ],
    statusCodes: [404],
    likelyCauses: [
      "A path or key built from configuration that changed",
      "A record deleted or never created by an earlier step that failed quietly",
      "A race — reading before the write that creates it has landed",
    ],
    whatToCheck: [
      "Check whether the missing identifier is constant across occurrences or different every time — the attributes below answer this",
      "Trace back to the step that should have created it and confirm it succeeded",
      "Check for a config or bucket/prefix change near the first-seen time below",
    ],
  },
  {
    id: "crash",
    title: "Unhandled failure",
    summary:
      "The process reached an error nothing was prepared to handle and stopped that unit of work.",
    needles: [
      "panic:",
      "segmentation fault",
      "sigsegv",
      "unhandled exception",
      "unhandled rejection",
      "uncaught exception",
      "fatal error",
      "stack overflow",
      "assertion failed",
    ],
    likelyCauses: [
      "A code path with no error handling reached by input it was not written for",
      "A dependency failure surfacing as a crash instead of a handled error",
      "Recursion or allocation that exceeds a runtime limit",
    ],
    whatToCheck: [
      "Read the stack in the sample lines below and find the frame that belongs to your code",
      "Check what deployed near the first-seen time below",
      "Confirm the work is retried or dead-lettered rather than silently lost",
    ],
  },
];

/*
 * The fallback. Not "we don't know" — the questions below are the ones worth
 * asking about ANY error, and the drawer's other sections answer several of
 * them directly, so an unclassified message still gets a route forward.
 */
const UNCLASSIFIED: ErrorPatternClassification = {
  id: "unclassified",
  title: "Unrecognized error",
  summary:
    "This message does not match a known failure family, so start from the shape of the occurrences rather than from the text.",
  likelyCauses: [
    "A behavior change from something that shipped inside this window",
    "A dependency degrading rather than failing outright",
    "A specific input or tenant reaching a path that only fails for it",
  ],
  whatToCheck: [
    "Check what the occurrences have in common below — an attribute on every one of them usually names the cause",
    "Check whether it is confined to one source or spread across many",
    "Open a trace below and read the request the error happened inside",
  ],
};

/**
 * Which failure family a message belongs to.
 *
 * Reads the sample body when there is one, falling back to the normalized
 * pattern: normalization replaces numbers and ids with placeholders, so a
 * pattern is a slightly worse needle-haystack than a real line.
 */
function present(rule: ClassificationRule): ErrorPatternClassification {
  return {
    id: rule.id,
    title: rule.title,
    summary: rule.summary,
    likelyCauses: rule.likelyCauses,
    whatToCheck: rule.whatToCheck,
  };
}

/*
 * Words that mean the number beside them is an HTTP status rather than a
 * duration, an id or a byte count.
 */
const STATUS_CONTEXT: RegExp =
  /\b(status|statuscode|status_code|status code|http|https|responded|response code|resp code|returned|code)\b/;

/*
 * The canonical reason phrase for each code, so a line that spells the
 * status out ("502 Bad Gateway") is recognized even with no status keyword.
 */
const STATUS_REASON_PHRASES: Record<number, string> = {
  400: "bad request",
  401: "unauthorized",
  403: "forbidden",
  404: "not found",
  429: "too many requests",
  500: "internal server error",
  502: "bad gateway",
  503: "service unavailable",
  504: "gateway timeout",
};

/**
 * Whether `haystack` really names this HTTP status code.
 *
 * Two conditions, both required. The digits must stand alone — a digit on
 * either side means the match is part of a longer number, which is what let
 * a request id decide an error's family. And the line must give some reason
 * to read those digits as a status: either a status-ish word nearby, or the
 * code's own reason phrase immediately after it.
 *
 * Exported for tests: this predicate is the whole fix, and it is far easier
 * to pin directly than through the classifier's ordering.
 */
export function matchesStatusCode(haystack: string, code: number): boolean {
  const digits: string = String(code);
  const standsAlone: RegExp = new RegExp(`(^|[^0-9])${digits}([^0-9]|$)`);

  if (!standsAlone.test(haystack)) {
    return false;
  }

  const reason: string | undefined = STATUS_REASON_PHRASES[code];

  if (reason) {
    const withReason: RegExp = new RegExp(
      `(^|[^0-9])${digits}[^a-z0-9]{0,3}${reason}`,
    );

    if (withReason.test(haystack)) {
      return true;
    }
  }

  return STATUS_CONTEXT.test(haystack);
}

/**
 * Which failure family a message belongs to.
 *
 * Reads the sample body when there is one, falling back to the normalized
 * pattern: normalization replaces numbers and ids with placeholders, so a
 * pattern is a slightly worse needle-haystack than a real line.
 *
 * Two passes, and the order between them matters more than the order within
 * either. EVERY textual needle in the table is tried before ANY status code,
 * because a line that says what went wrong in words is describing itself,
 * while a three-digit number is at best circumstantial. "panic: runtime
 * error at offset 4040404" is a crash, not a 404.
 */
export function classifyErrorPattern(
  text: string,
  sampleBody?: string | undefined,
): ErrorPatternClassification {
  const haystack: string = `${sampleBody || ""} ${text || ""}`.toLowerCase();

  if (haystack.trim().length === 0) {
    return UNCLASSIFIED;
  }

  for (const rule of CLASSIFICATION_RULES) {
    for (const needle of rule.needles) {
      if (haystack.includes(needle)) {
        return present(rule);
      }
    }
  }

  for (const rule of CLASSIFICATION_RULES) {
    for (const code of rule.statusCodes || []) {
      if (matchesStatusCode(haystack, code)) {
        return present(rule);
      }
    }
  }

  return UNCLASSIFIED;
}

// --- Findings ---

export type ErrorPatternEventKind = "change" | "incident" | "alert";

export interface ErrorPatternEvent {
  kind: ErrorPatternEventKind;
  label: string;
  timeMs: number;
}

/*
 * Event markers reach the UI as chart reference lines, whose only surviving
 * type information is the label prefix the marker builder stamped on
 * ("Incident: ", "Alert: ", or a change-event verb). Reading the kind back
 * out of that prefix keeps the classification in one tested place rather
 * than inline in each surface that consumes the markers.
 */
export function readEventKindFromLabel(label: string): ErrorPatternEventKind {
  const text: string = typeof label === "string" ? label : "";

  if (text.startsWith("Incident:")) {
    return "incident";
  }

  if (text.startsWith("Alert:")) {
    return "alert";
  }

  return "change";
}

export interface ErrorPatternEvidence {
  pattern: TopErrorPatternRow;
  correlation: ErrorPatternCorrelation;
  trend: ErrorPatternTrend;
  sharedAttributes: Array<SharedAttribute>;
  /** Occurrences the correlation itself accounts for. */
  occurrenceTotal: number;
  windowStartMs: number;
  windowEndMs: number;
  /** Deploys, incidents and alerts inside the window. */
  events: Array<ErrorPatternEvent>;
  /** Resolves a resource id to a name, for readable findings. */
  resourceLabel: (resourceId: string) => string;
}

export type ErrorPatternFindingSeverity = "info" | "warning" | "critical";

export interface ErrorPatternFinding {
  severity: ErrorPatternFindingSeverity;
  text: string;
}

/*
 * A change event counts as "just before this started" when it lands inside
 * this much of the first occurrence. Wide enough to catch a rollout that
 * takes a few minutes to reach every replica, narrow enough that an
 * unrelated deploy an hour earlier is reported as context rather than as
 * cause.
 */
const CHANGE_PROXIMITY_MS: number = 15 * 60 * 1000;

/* A rise smaller than this is drift, not an escalation worth leading with. */
const NOTABLE_RISE_PERCENT: number = 50;

/* A bucket carrying at least this share of the occurrences is a burst. */
const BURST_SHARE: number = 0.6;

/* A co-occurring error at this share of the primary's volume is a partner. */
const CO_OCCURRENCE_SHARE: number = 0.5;

/* Below this many occurrences, shape-based findings are reading noise. */
const MIN_OCCURRENCES_FOR_SHAPE: number = 5;

function formatRelativeToEvent(eventMs: number, referenceMs: number): string {
  const minutes: number = Math.round(Math.abs(referenceMs - eventMs) / 60000);

  if (minutes === 0) {
    return "at the same moment as";
  }

  const unit: string = minutes === 1 ? "minute" : "minutes";

  return eventMs <= referenceMs
    ? `${minutes} ${unit} before`
    : `${minutes} ${unit} after`;
}

/**
 * The ranked findings for one error pattern.
 *
 * Order is by how much a finding narrows the search: a change event that
 * landed as the error appeared comes first because deploys are the most
 * common cause of a new error; then the error's own shape (new, rising,
 * bursting); then where it lives and what it shares; then what it fires
 * alongside; then the incidents and alerts that were open at the time.
 */
export function buildErrorPatternFindings(
  evidence: ErrorPatternEvidence,
): Array<ErrorPatternFinding> {
  const findings: Array<ErrorPatternFinding> = [];

  const firstSeenMs: number | null =
    evidence.pattern.firstSeenAt instanceof Date &&
    !isNaN(evidence.pattern.firstSeenAt.getTime())
      ? evidence.pattern.firstSeenAt.getTime()
      : null;

  const occurrences: number =
    evidence.occurrenceTotal || evidence.pattern.count || 0;

  // 1. Something shipped as this error appeared.
  const changeEvents: Array<ErrorPatternEvent> = (evidence.events || []).filter(
    (event: ErrorPatternEvent): boolean => {
      return event.kind === "change";
    },
  );

  const nearbyChanges: Array<ErrorPatternEvent> =
    firstSeenMs === null
      ? []
      : changeEvents.filter((event: ErrorPatternEvent): boolean => {
          return Math.abs(event.timeMs - firstSeenMs) <= CHANGE_PROXIMITY_MS;
        });

  for (const change of nearbyChanges) {
    findings.push({
      severity: "critical",
      text: `${change.label} landed ${formatRelativeToEvent(change.timeMs, firstSeenMs as number)} this error was first seen — deployments and config changes are the most common cause of a new error.`,
    });
  }

  /*
   * A change inside the window but NOT next to the onset is context, not a
   * lead. Saying so is still worth a line: it is the thing the user would
   * otherwise go looking for by hand.
   */
  for (const change of changeEvents) {
    if (nearbyChanges.includes(change)) {
      continue;
    }

    findings.push({
      severity: "info",
      text: `${change.label} also landed inside this window, though not close to when the error started.`,
    });
  }

  // 2. The error's own shape.
  if (evidence.trend.previousCount === 0 && evidence.trend.recentCount > 0) {
    findings.push({
      severity: "warning",
      text: `New in this window: every one of the ${evidence.trend.recentCount.toLocaleString()} occurrences landed in its second half, with none before.`,
    });
  } else if (
    evidence.trend.direction === "rising" &&
    evidence.trend.changePercent >= NOTABLE_RISE_PERCENT
  ) {
    findings.push({
      severity: "warning",
      text: `Getting worse: ${evidence.trend.changePercent}% more occurrences in the second half of the window than the first (${evidence.trend.previousCount.toLocaleString()} → ${evidence.trend.recentCount.toLocaleString()}).`,
    });
  } else if (evidence.trend.direction === "falling") {
    findings.push({
      severity: "info",
      text: `Easing off: ${Math.abs(evidence.trend.changePercent)}% fewer occurrences in the second half of the window than the first — if you changed something, it is working.`,
    });
  }

  const timeline: Array<ErrorPatternTimelinePoint> =
    evidence.correlation.timeline || [];

  /*
   * A single occupied bucket is the strongest burst there is — 100% of the
   * occurrences in one bucket — so it must not be excluded for having
   * "only one point". The timeline has no zero-fill, so that is exactly what
   * a sharp spike looks like coming back from the database.
   */
  const canReadShape: boolean =
    occurrences >= MIN_OCCURRENCES_FOR_SHAPE && timeline.length >= 1;

  if (canReadShape) {
    let peak: ErrorPatternTimelinePoint | null = null;

    for (const point of timeline) {
      if (!peak || point.count > peak.count) {
        peak = point;
      }
    }

    if (peak && peak.count >= occurrences * BURST_SHARE) {
      const share: number = Math.round((peak.count / occurrences) * 100);
      const at: string = peak.time
        ? OneUptimeDate.getDateAsLocalFormattedString(peak.time)
        : "one bucket";

      findings.push({
        severity: "warning",
        text: `Bursty, not steady: ${share}% of the occurrences landed in a single ${evidence.correlation.bucketSizeInMinutes}-minute bucket at ${at} — look for one event rather than an ongoing condition.`,
      });
    }
  }

  // 3. Where it lives.
  const resources: Array<ErrorPatternResourceRow> =
    evidence.correlation.resources || [];

  if (resources.length === 1 && occurrences >= MIN_OCCURRENCES_FOR_SHAPE) {
    findings.push({
      severity: "warning",
      text: `Confined to one source, ${evidence.resourceLabel(resources[0]!.resourceId)} — that points at that instance or host rather than at the code path itself.`,
    });
  } else if (resources.length >= 3) {
    findings.push({
      severity: "info",
      text: `Spread across ${resources.length} sources — a shared dependency or a common code path, not one bad instance.`,
    });
  }

  // 4. What every occurrence has in common.
  const universal: SharedAttribute | undefined = (
    evidence.sharedAttributes || []
  ).find((attribute: SharedAttribute): boolean => {
    return attribute.isUniversal;
  });

  if (universal) {
    findings.push({
      severity: "warning",
      text: `Every occurrence carries ${universal.key} = ${universal.value} — the strongest single clue on this page about which input or path triggers it.`,
    });
  }

  // 5. What it fires alongside.
  const partner: ErrorPatternCoOccurrenceRow | undefined = (evidence.correlation
    .coOccurringPatterns || [])[0];

  if (
    partner &&
    occurrences > 0 &&
    partner.count >= occurrences * CO_OCCURRENCE_SHARE
  ) {
    findings.push({
      severity: "info",
      text: `Fires alongside "${partner.sampleBody || partner.pattern}" (${partner.count.toLocaleString()} times in the same buckets) — the two probably share a cause.`,
    });
  }

  // 6. Whether there is request context to work with at all.
  if (evidence.pattern.traceCount === 0) {
    findings.push({
      severity: "info",
      text: "None of these logs carry a trace id, so there is no request context to open — instrumenting this path with tracing would make the next occurrence far easier to explain.",
    });
  }

  // 7. Incidents and alerts open at the time.
  for (const event of evidence.events || []) {
    if (event.kind === "change") {
      continue;
    }

    findings.push({
      severity: "info",
      text: `${event.label} was open inside this window — it may share this root cause.`,
    });
  }

  if (findings.length === 0) {
    /*
     * Only claim "steady, spread out" when the shape rules could actually
     * read the shape. Asserting it over a timeline too sparse to judge told
     * the user the opposite of the truth for the sharpest spikes — and the
     * claim was forwarded to the model in the Ask AI prompt as well.
     */
    findings.push({
      severity: "info",
      text: canReadShape
        ? "Nothing about this error's shape stands out — it is steady, spread out, and shares no attribute across every occurrence. Widening the window, or opening one of its traces, is the next move."
        : "There is not enough of this error in the window to read its shape. Widening the window, or opening one of its traces, is the next move.",
    });
  }

  return findings;
}

// --- The Ask AI hand-off ---

function describeWindow(evidence: ErrorPatternEvidence): string {
  return `${OneUptimeDate.getDateAsFormattedString(new Date(evidence.windowStartMs))} — ${OneUptimeDate.getDateAsFormattedString(new Date(evidence.windowEndMs))}`;
}

/** How many of each list the prompt carries. Enough to reason from, short enough to read. */
const PROMPT_LIST_LIMIT: number = 5;

/**
 * The prepared prompt for the Ask AI panel: this error, restated with every
 * piece of evidence the drawer gathered, and a clear question.
 *
 * The point is that the user never re-describes the problem. The issue
 * behind this asked for exactly that — "without needing to separately open
 * Ask AI and re-describe the problem" — so the prompt carries the message,
 * the window, the volume and trend, where it happens, what the occurrences
 * share, what fires alongside it, what shipped, and the findings already
 * computed above. It pre-fills the input rather than sending: the user reads
 * and edits before anything is asked.
 */
export function buildErrorPatternPrompt(
  evidence: ErrorPatternEvidence,
  findings: Array<ErrorPatternFinding>,
  classification: ErrorPatternClassification,
): string {
  const lines: Array<string> = [];

  lines.push(
    `I'm investigating an error in my logs over the window ${describeWindow(evidence)}.`,
    "",
    "Error message:",
    evidence.pattern.sampleBody || evidence.pattern.pattern,
    "",
  );

  lines.push(
    `It occurred ${(evidence.occurrenceTotal || evidence.pattern.count).toLocaleString()} times across ${evidence.pattern.resourceCount} source(s).`,
  );

  if (evidence.trend.direction !== "unknown") {
    lines.push(
      `Trend across the window: ${evidence.trend.direction} (${evidence.trend.previousCount.toLocaleString()} occurrences in the first half, ${evidence.trend.recentCount.toLocaleString()} in the second).`,
    );
  }

  if (classification.id !== "unclassified") {
    lines.push(
      `It looks like a "${classification.title}" failure by its message alone.`,
    );
  }

  const resources: Array<ErrorPatternResourceRow> = (
    evidence.correlation.resources || []
  ).slice(0, PROMPT_LIST_LIMIT);

  if (resources.length > 0) {
    lines.push("", "Where it happens:");
    for (const resource of resources) {
      lines.push(
        `- ${evidence.resourceLabel(resource.resourceId)}: ${resource.count.toLocaleString()}`,
      );
    }
  }

  const attributes: Array<SharedAttribute> = (
    evidence.sharedAttributes || []
  ).slice(0, PROMPT_LIST_LIMIT);

  if (attributes.length > 0) {
    lines.push("", "Attributes the occurrences share:");
    for (const attribute of attributes) {
      lines.push(
        `- ${attribute.key} = ${attribute.value} (on ${attribute.coveragePercent}% of them)`,
      );
    }
  }

  const partners: Array<ErrorPatternCoOccurrenceRow> = (
    evidence.correlation.coOccurringPatterns || []
  ).slice(0, PROMPT_LIST_LIMIT);

  if (partners.length > 0) {
    lines.push("", "Other errors in the same time buckets:");
    for (const partner of partners) {
      lines.push(
        `- (${partner.count.toLocaleString()}x) ${partner.sampleBody || partner.pattern}`,
      );
    }
  }

  const events: Array<ErrorPatternEvent> = (evidence.events || []).slice(
    0,
    PROMPT_LIST_LIMIT,
  );

  if (events.length > 0) {
    lines.push("", "What else happened in this window:");
    for (const event of events) {
      lines.push(
        `- ${event.label} at ${OneUptimeDate.getDateAsFormattedString(new Date(event.timeMs))}`,
      );
    }
  }

  const samples: Array<string> = (evidence.correlation.samples || [])
    .slice(0, 3)
    .map((sample: { body: string }): string => {
      return sample.body;
    })
    .filter((body: string): boolean => {
      return typeof body === "string" && body.trim().length > 0;
    });

  if (samples.length > 0) {
    lines.push("", "Sample log lines:");
    for (const sample of samples) {
      lines.push(`- ${sample}`);
    }
  }

  if (findings.length > 0) {
    lines.push("", "What already stands out:");
    for (const finding of findings) {
      lines.push(`- ${finding.text}`);
    }
  }

  lines.push(
    "",
    "What is the most likely root cause, and what should I check or change next?",
  );

  return lines.join("\n");
}
