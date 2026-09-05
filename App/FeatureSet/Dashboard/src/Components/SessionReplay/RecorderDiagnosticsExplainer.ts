/*
 * RecorderDiagnosticsExplainer: plain sentences for the JSON a customer
 * pastes from OneUptimeReplay.getDiagnostics().
 *
 * The recorder is silent by design - every gate fails closed without a
 * console line - so its diagnostics ring is the only record of WHY a page
 * recorded nothing. Each record carries a stable kebab-case `code`
 * (App/FeatureSet/BrowserRecorder/src/Debug.ts calls it "part of the
 * contract in a way the prose message is not"). This module maps every code
 * the recorder emits today to a sentence a customer can act on, picks the
 * one record that explains the outcome, and reports codes it does not know
 * rather than guessing at them.
 *
 * Pure: no React, no DOM, no fetch. The paste box on the health card and
 * the installation test both call explainRecorderDiagnostics(text).
 *
 * The code table below is the recorder's ACTUAL vocabulary, read from the
 * debugLog/debugWarn call sites across Index.ts, Loader.ts, Config.ts,
 * Recorder.ts and Transport.ts. Adding a code to the recorder without
 * adding it here makes it fall through to the unknown-code copy, which
 * App/Tests/Dashboard/RecorderDiagnosticsExplainer.test.ts pins.
 */

export type RecorderDebugLevel = "info" | "warn";

export interface RecorderDebugCodeCopy {
  /* What happened, in the customer's terms. */
  explanation: string;
  /* What to do about it. Absent for records that need no action. */
  action?: string;
  /*
   * True for a code that, on its own, explains why nothing recorded or
   * uploaded. The headline is built from the LAST such record.
   */
  isOutcome?: boolean;
}

export const RECORDER_DEBUG_CODE_COPY: Record<string, RecorderDebugCodeCopy> = {
  /* ---- Debug.ts ---- */
  "debug-enabled": {
    explanation: "Diagnostics were switched on for this page.",
  },

  /* ---- Loader.ts ---- */
  "loader-start": { explanation: "The loader script ran on the page." },
  "init-options-missing": {
    explanation:
      "The loader found no usable init options: the script tag is missing data-oneuptime-token or data-oneuptime-app-identifier, or the init global is malformed.",
    action:
      "Compare the script tag on this page with the install snippet; both attributes are required.",
    isOutcome: true,
  },
  "artifact-requested": {
    explanation: "The loader asked for the recorder artifact.",
  },
  "artifact-load-failed": {
    explanation:
      "The recorder artifact failed to load. On a page with a Content-Security-Policy this is almost always script-src; otherwise an ad blocker or a proxy.",
    action:
      "Allow the OneUptime origin in script-src, then check the browser's Network tab for the recorder.js request.",
    isOutcome: true,
  },
  "artifact-api-missing": {
    explanation:
      "The artifact loaded but did not publish its API, so the loader could not start it. This is a recorder bug or a tampered script.",
    action: "Reload with cache disabled; if it persists, report it.",
    isOutcome: true,
  },
  "artifact-url-invalid": {
    explanation:
      "The policy named a recorder version this loader will not build a URL from, so no artifact was requested.",
    action:
      "The deployment is serving a bad recorder version; only the operator of this deployment can fix that.",
    isOutcome: true,
  },
  "directive-stop": {
    explanation:
      "The server told this recorder to stand down: the application or project is switched off, or its budget is spent.",
    action:
      "Check the recording switches and budgets on the application's Replay Policy page.",
    isOutcome: true,
  },
  "loader-threw": {
    explanation: "The loader threw an exception. This is a recorder bug.",
    action: "Report it with this diagnostics output.",
    isOutcome: true,
  },

  /* ---- Config.ts ---- */
  "init-options-read": { explanation: "Init options were read successfully." },
  "init-options-incomplete": {
    explanation:
      "One init source (script tag or init global) was missing a required field and was skipped.",
    action:
      "Only one complete source is needed; this matters when it was the only one.",
  },
  "config-fetch-start": {
    explanation: "The recorder requested this application's policy.",
  },
  "config-fetch-failed": {
    explanation:
      "The policy request never completed: a connect-src CSP rule, an ad blocker, or no network path to OneUptime.",
    action:
      "Allow the OneUptime origin in connect-src and check the Network tab for the /config request.",
    isOutcome: true,
  },
  "config-fetch-rejected": {
    explanation:
      "The policy endpoint refused the request: the ingestion token is wrong or revoked, or the origin is not allowed.",
    action:
      "Confirm the token under Project Settings > Telemetry Ingestion Keys and the origin allowlists on the key and the application.",
    isOutcome: true,
  },
  "config-body-unparseable": {
    explanation:
      "The policy endpoint answered, but not with JSON. A proxy, captive portal or CDN rule is answering instead of OneUptime.",
    action: "Open the /config URL in a browser tab and see who answers.",
    isOutcome: true,
  },
  "config-unparseable": {
    explanation:
      "The policy response was JSON but not an object. Something on the path rewrote it.",
    isOutcome: true,
  },
  "config-disabled": {
    explanation:
      "The server says session replay is off for this application or project, so nothing is recorded.",
    action:
      "Turn recording on for the application (Replay Policy) and the project (Settings > Session Replay).",
    isOutcome: true,
  },
  "config-recorder-version-invalid": {
    explanation:
      "The server named no published recorder version, so no artifact can load. This deployment does not build the recorder.",
    isOutcome: true,
  },
  "config-accepted": { explanation: "The policy was accepted." },
  "config-field-defaulted": {
    explanation:
      "The server sent no value for one policy field, so the product default was used.",
  },
  "config-value-unrecognised": {
    explanation:
      "This recorder build does not know a value the server sent and used the safest option instead. The recorder is older than the server.",
    action: "A cached recorder refreshes within its cache window.",
  },

  /* ---- Index.ts ---- */
  bootstrap: { explanation: "The recorder artifact started bootstrapping." },
  "bootstrap-already-started": {
    explanation:
      "A second start() on the same page was ignored; the first one is still in charge.",
  },
  "bootstrap-already-running": {
    explanation:
      "bootstrap() was called again while a recorder was running and was ignored.",
  },
  "bootstrap-cancelled": {
    explanation:
      "A queued revokeConsent() or stop() ran before start(), so no recorder was built.",
    action:
      "Remove the queued stop, or grant consent before the page starts the recorder.",
    isOutcome: true,
  },
  "privacy-signal": {
    explanation:
      "This browser sends Do Not Track or Global Privacy Control, and the policy respects it, so nothing is recorded on it.",
    action:
      "Expected for this visitor. Test from a browser without the signal.",
    isOutcome: true,
  },
  "start-stopped": {
    explanation:
      "start() had no usable policy and will not record anything. An earlier record says why the policy is missing.",
    isOutcome: true,
  },
  "command-queue-not-an-array": {
    explanation:
      "window.OneUptimeReplayQueue is not an array, so commands queued before the recorder loaded were ignored.",
    action: "Initialise the queue as an array, or remove the override.",
  },
  "command-queue-unknown-command": {
    explanation:
      "A queued command was not one the recorder knows and was dropped.",
    action:
      "Supported queue commands: grantConsent, revokeConsent, stop, captureSession, identify, track, setTags, addTag.",
  },
  "api-grant-consent": { explanation: "grantConsent() was called." },
  "api-revoke-consent": { explanation: "revokeConsent() was called." },
  "api-stop": { explanation: "stop() was called by the page." },
  "api-capture-session": { explanation: "captureSession() was called." },
  "api-no-recorder": {
    explanation:
      "The page called the recorder API while no recorder was running, so the call did nothing.",
    action:
      "Call the API after the recorder started, or use the command queue.",
  },

  /* ---- Recorder.ts ---- */
  "not-sampled": {
    explanation:
      "This session was not selected by the sample percentage, so it records nothing. That is sampling working, not a fault.",
    action: "Raise the sample percentage, or reload to draw a new session.",
    isOutcome: true,
  },
  recording: { explanation: "Recording started on this page." },
  trigger: {
    explanation:
      "A capture trigger fired (error, frustration or performance budget); this session may upload now.",
  },
  "upload-started": {
    explanation: "Uploading started; the buffered pre-roll was flushed.",
  },
  "upload-blocked-consent": {
    explanation:
      "A trigger fired but consent was never granted, so nothing was uploaded.",
    action: "Call OneUptimeReplay.grantConsent() once the visitor consents.",
    isOutcome: true,
  },
  "upload-blocked-transport": {
    explanation:
      "A trigger fired but uploading was already disabled for this page by an earlier refusal.",
    isOutcome: true,
  },
  "chunk-discarded-consent": {
    explanation:
      "A chunk was built but consent does not allow uploading, so it was discarded.",
    action: "Call OneUptimeReplay.grantConsent() once the visitor consents.",
    isOutcome: true,
  },
  "session-rotated": {
    explanation:
      "The session rolled over (30 minutes idle or the daily cap); a new recording starts here.",
  },
  "recorder-stopped": { explanation: "Recording stopped on this page." },
  "recorder-stopped-by-server": {
    explanation:
      "The server told this recorder to stop, and recording ended. The reason is in the directive record before it.",
    isOutcome: true,
  },
  "recorder-stopped-transport": {
    explanation: "Uploading failed for good, so recording stopped.",
    isOutcome: true,
  },
  "recorder-throttled-by-server": {
    explanation:
      "The server asked this recorder to slow down; uploads pause and resume on their own.",
  },
  "rrweb-did-not-start": {
    explanation:
      "The DOM recorder declined to start, so no screen was captured. This happens on pages that block MutationObserver or run in an unusual document.",
    isOutcome: true,
  },
  "rrweb-error": {
    explanation:
      "The DOM recorder reported an internal error; the recording may skip or freeze around this point.",
  },

  /* ---- Transport.ts ---- */
  "chunk-accepted": { explanation: "A chunk was accepted by the server." },
  "chunk-not-recorded": {
    explanation:
      "The server accepted the request but deliberately did not record the chunk (not sampled server-side, or a policy that no longer records).",
    isOutcome: true,
  },
  "chunk-refused": {
    explanation:
      "The server refused one chunk; recording continued without it. The reason code the server answered is in the record's detail.",
  },
  "chunk-refused-terminal": {
    explanation:
      "The server will refuse every chunk from this recorder, so uploading stopped. Usually a revoked token, a refused origin, or a switched-off application.",
    action:
      "Read the reason in the record's detail; it matches the refusal counters on the health card.",
    isOutcome: true,
  },
  "chunk-rejected-terminal": {
    explanation:
      "Uploading stopped for good: the server rejected this recorder outright.",
    isOutcome: true,
  },
  "chunk-post-failed": {
    explanation:
      "A chunk upload never reached the server: a connect-src CSP rule, an ad blocker, or the network.",
    action:
      "Allow the OneUptime origin in connect-src and check the Network tab for the chunk request.",
    isOutcome: true,
  },
  "chunk-post-server-error": {
    explanation:
      "The server could not accept a chunk (5xx); it will be retried.",
  },
  "chunk-throttled": {
    explanation:
      "Uploads were rate limited; they pause and resume on their own.",
  },
  "chunk-retry-scheduled": {
    explanation: "Uploading will be retried after a pause.",
  },
  "chunk-retry": { explanation: "Queued chunks were retried." },
  "chunk-abandoned": {
    explanation:
      "One chunk failed too many times and was dropped; uploading continued. The recording has a gap there.",
  },
  "final-chunk-carried-queue": {
    explanation:
      "Queued chunks were sent along with the final chunk on page exit.",
  },
  "final-chunk-too-large": {
    explanation:
      "The final chunk was over the browser's keepalive quota and was dropped; the last seconds before the page closed are missing.",
  },
  "server-directive": {
    explanation:
      "The server changed what this recorder should do (stop, throttle or continue). The directive and its reason are in the record's detail.",
  },
  "transport-disabled": {
    explanation: "Uploading stopped for good on this page.",
    action: "Fix the cause named in the records above, then reload.",
    isOutcome: true,
  },
};

export const UNKNOWN_RECORDER_DEBUG_CODE_COPY: string =
  "This code is newer than this dashboard's explanations. The troubleshooting docs list every code.";

export interface ExplainedRecorderRecord {
  code: string;
  level: RecorderDebugLevel;
  atUnixMs: number | null;
  /* The recorder's own short message, kept beside the explanation. */
  message: string;
  explanation: string;
  action: string | null;
  isKnown: boolean;
  detail: Record<string, string | number | boolean | null>;
}

export interface ExplainedRecorderFact {
  label: string;
  value: string;
}

export interface RecorderDiagnosticsExplanation {
  /* One sentence: what the recorder concluded on that page. */
  headline: string;
  /* Version, session, state, stop reason, decisions. */
  facts: Array<ExplainedRecorderFact>;
  records: Array<ExplainedRecorderRecord>;
  unknownCodes: Array<string>;
  capabilities: Array<string>;
  warnCount: number;
}

export type RecorderDiagnosticsResult =
  | { ok: true; explanation: RecorderDiagnosticsExplanation }
  | { ok: false; error: string };

/* Explain one code. Unknown codes fall back, never throw. */
export function explainRecorderDebugCode(code: string): {
  explanation: string;
  action: string | null;
  isKnown: boolean;
} {
  const copy: RecorderDebugCodeCopy | undefined =
    Object.prototype.hasOwnProperty.call(RECORDER_DEBUG_CODE_COPY, code)
      ? RECORDER_DEBUG_CODE_COPY[code]
      : undefined;

  if (!copy) {
    return {
      explanation: UNKNOWN_RECORDER_DEBUG_CODE_COPY,
      action: null,
      isKnown: false,
    };
  }

  return {
    explanation: copy.explanation,
    action: copy.action ?? null,
    isKnown: true,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(row: Record<string, unknown>, key: string): string | null {
  const value: unknown = row[key];

  return typeof value === "string" && value.length > 0 ? value : null;
}

/*
 * The detail map is what the recorder redacted to primitives; we keep only
 * primitives again so a hand-edited paste cannot smuggle an object into
 * the DOM through it.
 */
function readDetail(
  value: unknown,
): Record<string, string | number | boolean | null> {
  const row: Record<string, unknown> | null = asRecord(value);
  const detail: Record<string, string | number | boolean | null> = {};

  if (!row) {
    return detail;
  }

  for (const key of Object.keys(row)) {
    const entry: unknown = row[key];

    if (
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean"
    ) {
      detail[key] = entry;
    }
  }

  return detail;
}

function explainRecord(value: unknown): ExplainedRecorderRecord | null {
  const row: Record<string, unknown> | null = asRecord(value);

  if (!row) {
    return null;
  }

  const code: string | null = readString(row, "code");

  if (!code) {
    return null;
  }

  const explained: {
    explanation: string;
    action: string | null;
    isKnown: boolean;
  } = explainRecorderDebugCode(code);
  const at: unknown = row["atUnixMs"];

  return {
    code: code,
    level: row["level"] === "warn" ? "warn" : "info",
    atUnixMs: typeof at === "number" && Number.isFinite(at) ? at : null,
    message: readString(row, "message") ?? "",
    explanation: explained.explanation,
    action: explained.action,
    isKnown: explained.isKnown,
    detail: readDetail(row["detail"]),
  };
}

/*
 * The headline is the last OUTCOME record, because a long-lived tab's most
 * recent decision is the one that explains what it is doing now (Debug.ts
 * drops the oldest records for the same reason). When no outcome record
 * exists the recorder's own state fields decide.
 */
function buildHeadline(
  root: Record<string, unknown>,
  records: Array<ExplainedRecorderRecord>,
): string {
  for (let index: number = records.length - 1; index >= 0; index--) {
    const record: ExplainedRecorderRecord = records[
      index
    ] as ExplainedRecorderRecord;
    const copy: RecorderDebugCodeCopy | undefined =
      RECORDER_DEBUG_CODE_COPY[record.code];

    if (copy?.isOutcome) {
      return record.explanation;
    }
  }

  if (root["isUploading"] === true) {
    return "The recorder is recording and uploading on this page.";
  }

  if (root["isRecording"] === true) {
    return "The recorder is recording on this page; nothing has triggered an upload yet.";
  }

  const bootstrapDecision: string | null = readString(
    root,
    "bootstrapDecision",
  );

  if (bootstrapDecision === "not-started") {
    return "The recorder artifact never started on this page; the loader's records above say where it stopped.";
  }

  const stopReason: string | null = readString(root, "stopReason");

  if (stopReason) {
    return `The recorder stopped (${stopReason}).`;
  }

  return "No outcome record was found; the records below list what the recorder did.";
}

function describeDecisions(value: unknown): Array<ExplainedRecorderFact> {
  const decisions: Record<string, unknown> | null = asRecord(value);

  if (!decisions) {
    return [
      {
        label: "Decisions",
        value: "none yet: no recorder object was built on this page",
      },
    ];
  }

  const facts: Array<ExplainedRecorderFact> = [];

  if (typeof decisions["isSampled"] === "boolean") {
    facts.push({
      label: "Sampled",
      value: decisions["isSampled"]
        ? "yes"
        : "no: this session records nothing",
    });
  }

  const trigger: string | null = readString(decisions, "captureTrigger");

  if (trigger) {
    facts.push({ label: "Capture trigger", value: trigger });
  }

  const consentMode: string | null = readString(decisions, "consentMode");
  const consentState: string | null = readString(decisions, "consentState");

  if (consentMode) {
    facts.push({
      label: "Consent",
      value: consentState ? `${consentMode} (${consentState})` : consentMode,
    });
  }

  if (typeof decisions["uploadsAllowed"] === "boolean") {
    const blockedBy: string | null = readString(decisions, "uploadBlockedBy");

    facts.push({
      label: "Uploads",
      value: decisions["uploadsAllowed"]
        ? "allowed"
        : `blocked${blockedBy ? ` by ${blockedBy}` : ""}`,
    });
  }

  const lastDirective: string | null = readString(decisions, "lastDirective");

  if (lastDirective) {
    const reason: string | null = readString(decisions, "lastDirectiveReason");

    facts.push({
      label: "Last server directive",
      value: reason ? `${lastDirective} (${reason})` : lastDirective,
    });
  }

  const startDecision: string | null = readString(decisions, "startDecision");

  if (startDecision) {
    facts.push({ label: "Start decision", value: startDecision });
  }

  return facts;
}

/*
 * Accepts the whole getDiagnostics() object, or just its `records` array,
 * or a JSON string of either. Never throws: malformed input is reported as
 * an error the paste box can print.
 */
export function explainRecorderDiagnostics(
  input: string | unknown,
): RecorderDiagnosticsResult {
  let parsed: unknown = input;

  if (typeof input === "string") {
    const trimmed: string = input.trim();

    if (trimmed.length === 0) {
      return {
        ok: false,
        error:
          "Nothing to explain yet. Paste the output of OneUptimeReplay.getDiagnostics() from the page's console.",
      };
    }

    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return {
        ok: false,
        error:
          "That is not JSON. In the console run copy(JSON.stringify(OneUptimeReplay.getDiagnostics())) and paste the result here.",
      };
    }
  }

  let root: Record<string, unknown> = {};
  let rawRecords: unknown = null;

  if (Array.isArray(parsed)) {
    rawRecords = parsed;
  } else {
    const object: Record<string, unknown> | null = asRecord(parsed);

    if (!object) {
      return {
        ok: false,
        error:
          "Expected the getDiagnostics() object or its records array, got something else.",
      };
    }

    root = object;
    rawRecords = object["records"];
  }

  if (!Array.isArray(rawRecords)) {
    return {
      ok: false,
      error:
        "No records array found. getDiagnostics() always returns one, even when diagnostics were never switched on.",
    };
  }

  const records: Array<ExplainedRecorderRecord> = [];
  const unknownCodes: Array<string> = [];

  for (const entry of rawRecords) {
    const explained: ExplainedRecorderRecord | null = explainRecord(entry);

    if (!explained) {
      continue;
    }

    records.push(explained);

    if (!explained.isKnown && !unknownCodes.includes(explained.code)) {
      unknownCodes.push(explained.code);
    }
  }

  const facts: Array<ExplainedRecorderFact> = [];
  const version: string | null = readString(root, "version");

  if (version) {
    facts.push({ label: "Recorder version", value: version });
  }

  const sessionId: string | null = readString(root, "sessionId");

  facts.push({
    label: "Session",
    value: sessionId ?? "none: no session was started on this page",
  });

  const state: string | null = readString(root, "state");

  if (state) {
    facts.push({ label: "State", value: state });
  }

  const stopReason: string | null = readString(root, "stopReason");

  if (stopReason) {
    facts.push({ label: "Stop reason", value: stopReason });
  }

  const bootstrapDecision: string | null = readString(
    root,
    "bootstrapDecision",
  );

  if (bootstrapDecision) {
    facts.push({ label: "Bootstrap", value: bootstrapDecision });
  }

  const triggerReason: string | null = readString(root, "triggerReason");

  if (triggerReason) {
    facts.push({ label: "Upload trigger", value: triggerReason });
  }

  if ("decisions" in root) {
    facts.push(...describeDecisions(root["decisions"]));
  }

  const capabilities: Array<string> = Array.isArray(root["capabilities"])
    ? (root["capabilities"] as Array<unknown>).filter(
        (entry: unknown): entry is string => {
          return typeof entry === "string";
        },
      )
    : [];

  return {
    ok: true,
    explanation: {
      headline: buildHeadline(root, records),
      facts: facts,
      records: records,
      unknownCodes: unknownCodes,
      capabilities: capabilities,
      warnCount: records.filter((record: ExplainedRecorderRecord): boolean => {
        return record.level === "warn";
      }).length,
    },
  };
}
