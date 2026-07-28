/*
 * AI SRE — the crash-loop classifier.
 *
 * A PURE function that names why a container is crash-looping, from stored
 * Kubernetes state alone. No LLM, no I/O, no clock.
 *
 * This exists so that "exactly why is it CrashLoopBackOff" is answered by
 * code rather than by prose. The model's job downstream is to EXPLAIN a
 * conclusion and put it in context — not to derive it. That split matters
 * for two reasons:
 *
 *   1. Determinism. `reason=OOMKilled` and `exitCode=137` mean one thing.
 *      A classifier says so every time; a model hedges some of the time.
 *
 *   2. Injection resistance. Every input below except the exit code is
 *      attacker-influenceable — a container can print whatever it likes and
 *      an image can carry any label. Those strings can steer the prose the
 *      model writes around a finding, but they cannot steer a pure function's
 *      verdict. Keep it that way: never let a log line vote here.
 *
 * Rules are ordered most-specific-first and the first match wins. When
 * nothing matches we return Unknown rather than guessing — a wrong named
 * cause is worse than an honest "here is the evidence, you decide".
 */

export enum CrashLoopCause {
  OomKilled = "OomKilled",
  ConfigKeyMissing = "ConfigKeyMissing",
  ImagePullFailure = "ImagePullFailure",
  LivenessProbeKill = "LivenessProbeKill",
  CommandNotFound = "CommandNotFound",
  NotExecutable = "NotExecutable",
  ApplicationError = "ApplicationError",
  Unknown = "Unknown",
}

export enum CrashLoopConfidence {
  High = "high",
  Medium = "medium",
  Low = "low",
}

export interface CrashLoopProbeInput {
  type: string;
  initialDelaySeconds: number | null;
  periodSeconds: number | null;
  failureThreshold: number | null;
  httpPath: string;
  httpPort: string;
}

export interface CrashLoopEventInput {
  type: string;
  reason: string;
  note: string;
}

export interface CrashLoopClassifierInput {
  // The CURRENT state's reason, e.g. CrashLoopBackOff / CreateContainerConfigError.
  waitingReason?: string | undefined;
  // The current state's kubelet message — where the missing-key text lives.
  waitingMessage?: string | undefined;
  // The PREVIOUS incarnation's terminated reason, e.g. OOMKilled / Error.
  lastTerminatedReason?: string | undefined;
  lastTerminatedExitCode?: number | null | undefined;
  lastTerminatedSignal?: number | null | undefined;
  restartCount?: number | undefined;
  memoryLimitBytes?: number | null | undefined;
  memoryUsageBytes?: number | null | undefined;
  livenessProbe?: CrashLoopProbeInput | null | undefined;
  recentEvents?: Array<CrashLoopEventInput> | undefined;
}

export interface CrashLoopClassification {
  cause: CrashLoopCause;
  // One sentence naming the cause with whatever real numbers we have.
  headline: string;
  confidence: CrashLoopConfidence;
  // What the verdict was derived from, so a reader can check our work.
  evidence: Array<string>;
}

// 128 + 9. The kernel OOM killer's SIGKILL, as the kubelet reports it.
const EXIT_CODE_OOM: number = 137;

// Shell conventions: 127 = command not found, 126 = found but not executable.
const EXIT_CODE_COMMAND_NOT_FOUND: number = 127;
const EXIT_CODE_NOT_EXECUTABLE: number = 126;

const IMAGE_PULL_REASONS: ReadonlySet<string> = new Set([
  "ImagePullBackOff",
  "ErrImagePull",
  "InvalidImageName",
  "ImageInspectError",
  "ErrImageNeverPull",
  "RegistryUnavailable",
]);

const CONFIG_ERROR_REASONS: ReadonlySet<string> = new Set([
  "CreateContainerConfigError",
  "CreateContainerError",
]);

/*
 * The kubelet's phrasing when a container references a key that is not in
 * the ConfigMap or Secret it names. Capturing the key and the source is what
 * turns "a key is missing" into "you referenced DB_URL in ConfigMap
 * app-config" — which is the entire finding.
 */
const MISSING_KEY_PATTERN: RegExp =
  /couldn't find key (\S+) in (ConfigMap|Secret) (\S+)/i;

function formatMebibytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}Mi`;
}

function findEvent(
  events: Array<CrashLoopEventInput>,
  reason: string,
  noteSubstring?: string,
): CrashLoopEventInput | null {
  for (const event of events) {
    if (event.reason !== reason) {
      continue;
    }
    if (
      noteSubstring &&
      !(event.note || "").toLowerCase().includes(noteSubstring.toLowerCase())
    ) {
      continue;
    }
    return event;
  }
  return null;
}

function describeProbe(probe: CrashLoopProbeInput): string {
  const parts: Array<string> = [];

  if (probe.initialDelaySeconds !== null) {
    parts.push(`initialDelaySeconds=${probe.initialDelaySeconds}`);
  }
  if (probe.periodSeconds !== null) {
    parts.push(`periodSeconds=${probe.periodSeconds}`);
  }
  if (probe.failureThreshold !== null) {
    parts.push(`failureThreshold=${probe.failureThreshold}`);
  }

  const target: string =
    probe.type === "httpGet" && probe.httpPath
      ? ` on ${probe.httpPath}${probe.httpPort ? `:${probe.httpPort}` : ""}`
      : "";

  return parts.length > 0
    ? `${probe.type} probe${target} (${parts.join(", ")})`
    : `${probe.type} probe${target}`;
}

/**
 * Name the cause of a crash loop from stored Kubernetes state.
 *
 * Pure and total: same input, same output, no throw.
 */
export default function classifyCrashLoop(
  input: CrashLoopClassifierInput,
): CrashLoopClassification {
  const evidence: Array<string> = [];
  const events: Array<CrashLoopEventInput> = input.recentEvents || [];
  const waitingReason: string = input.waitingReason || "";
  const waitingMessage: string = input.waitingMessage || "";
  const lastReason: string = input.lastTerminatedReason || "";
  const exitCode: number | null =
    input.lastTerminatedExitCode === undefined
      ? null
      : input.lastTerminatedExitCode;

  if (waitingReason) {
    evidence.push(`waiting reason: ${waitingReason}`);
  }
  if (lastReason) {
    evidence.push(`last terminated reason: ${lastReason}`);
  }
  if (exitCode !== null) {
    evidence.push(`last exit code: ${exitCode}`);
  }
  if (input.restartCount !== undefined) {
    evidence.push(`restart count: ${input.restartCount}`);
  }

  /*
   * 1. OOMKilled. The kubelet reports the reason directly; exit 137 is the
   * same event seen through the shell's signal encoding, and is the fallback
   * for the runtimes that do not set the reason.
   */
  if (lastReason === "OOMKilled" || exitCode === EXIT_CODE_OOM) {
    let headline: string =
      "The container was OOMKilled — the kernel terminated it for exceeding its memory limit";

    if (input.memoryLimitBytes) {
      const limit: string = formatMebibytes(input.memoryLimitBytes);

      if (input.memoryUsageBytes) {
        const usage: string = formatMebibytes(input.memoryUsageBytes);
        const percent: number = Math.round(
          (input.memoryUsageBytes / input.memoryLimitBytes) * 100,
        );
        headline = `The container was OOMKilled at a ${limit} memory limit (last observed usage ${usage}, ${percent}% of limit)`;
        evidence.push(`memory limit ${limit}, last observed usage ${usage}`);
      } else {
        headline = `The container was OOMKilled at a ${limit} memory limit`;
        evidence.push(`memory limit ${limit}`);
      }
    }

    return {
      cause: CrashLoopCause.OomKilled,
      headline: headline,
      // The reason is definitive; inferring from exit 137 alone is nearly so.
      confidence:
        lastReason === "OOMKilled"
          ? CrashLoopConfidence.High
          : CrashLoopConfidence.Medium,
      evidence: evidence,
    };
  }

  /*
   * 2. A referenced ConfigMap/Secret key does not exist. The container never
   * starts, so there is no exit code at all — the whole answer is in the
   * kubelet's waiting message.
   */
  if (CONFIG_ERROR_REASONS.has(waitingReason)) {
    const configEvent: CrashLoopEventInput | null = findEvent(events, "Failed");
    const message: string = waitingMessage || configEvent?.note || "";
    const match: RegExpMatchArray | null = message.match(MISSING_KEY_PATTERN);

    if (message) {
      evidence.push(`kubelet message: ${message}`);
    }

    if (match && match[1] && match[2] && match[3]) {
      return {
        cause: CrashLoopCause.ConfigKeyMissing,
        headline: `The container references key "${match[1]}" in ${match[2]} "${match[3]}", which does not exist`,
        confidence: CrashLoopConfidence.High,
        evidence: evidence,
      };
    }

    return {
      cause: CrashLoopCause.ConfigKeyMissing,
      headline: message
        ? `The container could not be created from its configuration: ${message}`
        : "The container could not be created from its configuration (CreateContainerConfigError)",
      confidence: message
        ? CrashLoopConfidence.Medium
        : CrashLoopConfidence.Low,
      evidence: evidence,
    };
  }

  // 3. The image cannot be pulled. The registry's own error is in the event note.
  if (IMAGE_PULL_REASONS.has(waitingReason)) {
    const pullEvent: CrashLoopEventInput | null =
      findEvent(events, "Failed", "pull") || findEvent(events, "BackOff");
    const detail: string = pullEvent?.note || waitingMessage || "";

    if (detail) {
      evidence.push(`image pull error: ${detail}`);
    }

    return {
      cause: CrashLoopCause.ImagePullFailure,
      headline: detail
        ? `The container image could not be pulled (${waitingReason}): ${detail}`
        : `The container image could not be pulled (${waitingReason})`,
      confidence: CrashLoopConfidence.High,
      evidence: evidence,
    };
  }

  /*
   * 4. The liveness probe is killing a container that would otherwise be
   * fine. Checked before the generic exit-code rules because the kubelet
   * kills the process, so the exit code reflects the signal rather than the
   * application's own failure.
   */
  const unhealthyEvent: CrashLoopEventInput | null = findEvent(
    events,
    "Unhealthy",
    "Liveness probe failed",
  );

  if (unhealthyEvent) {
    evidence.push(`event: Unhealthy — ${unhealthyEvent.note}`);

    const probeDescription: string = input.livenessProbe
      ? describeProbe(input.livenessProbe)
      : "liveness probe";

    if (input.livenessProbe) {
      evidence.push(`liveness probe: ${describeProbe(input.livenessProbe)}`);
    }

    return {
      cause: CrashLoopCause.LivenessProbeKill,
      headline: `The kubelet is killing the container because its ${probeDescription} is failing — if the application needs longer to start than the probe allows, raise initialDelaySeconds or use a startup probe`,
      confidence: CrashLoopConfidence.High,
      evidence: evidence,
    };
  }

  // 5. Shell exit conventions — the entrypoint itself is wrong.
  if (exitCode === EXIT_CODE_COMMAND_NOT_FOUND) {
    return {
      cause: CrashLoopCause.CommandNotFound,
      headline:
        "The container exited 127 — its entrypoint or command was not found inside the image",
      confidence: CrashLoopConfidence.High,
      evidence: evidence,
    };
  }

  if (exitCode === EXIT_CODE_NOT_EXECUTABLE) {
    return {
      cause: CrashLoopCause.NotExecutable,
      headline:
        "The container exited 126 — its entrypoint was found but is not executable",
      confidence: CrashLoopConfidence.High,
      evidence: evidence,
    };
  }

  /*
   * 6. The application started and then failed on its own. We can say that
   * much definitively; WHY it failed is in the log tail, which the caller
   * passes to the model alongside this verdict.
   */
  if (exitCode !== null && exitCode > 0) {
    return {
      cause: CrashLoopCause.ApplicationError,
      headline: `The application started and exited with code ${exitCode} — the cause is in the previous container's log output, not in Kubernetes state`,
      confidence: CrashLoopConfidence.Medium,
      evidence: evidence,
    };
  }

  return {
    cause: CrashLoopCause.Unknown,
    headline:
      "The container is restarting, but stored Kubernetes state does not name a cause",
    confidence: CrashLoopConfidence.Low,
    evidence: evidence,
  };
}
