import { AgentLogger } from "../../Logger";
import {
  CloudHttpRequest,
  CloudHttpResponse,
  CloudTransport,
  CloudTransportError,
  MAX_CLOUD_RESPONSE_BYTES,
  describeCloudError,
} from "./CloudHttp";
import {
  CloudAgentSettings,
  carriesRequiredTag,
  formatRequiredTag,
} from "./CloudSettings";
import {
  CLOUD_CATALOG_PROVIDER_NAMES,
  CloudCatalogProvider,
  CloudResourceKindSpec,
  ParsedCloudCommand,
  getCloudIntegerFlag,
  getCloudResourceKind,
} from "../../Common/Utils/AiRemediation/Resource/CloudOperationCatalog";

/*
 * What every cloud's operations share: the per-command run (its time
 * budget, the reads before the change, the ONE change call), the two ways
 * a command fails, the bounds of a scale and the required tag.
 *
 * A command fails in one of two ways, and the difference is what the
 * server needs to know (did it change anything?):
 *
 *   CloudNotRunError  nothing was changed: a refusal (bounds, the tag, the
 *                     resource's state), missing credentials, a read before
 *                     the change that failed. Reported with no exit code
 *                     and no output — "never ran".
 *   CloudChangeError  the change call itself failed after it was sent, or
 *                     may have been: an error answer (exit code 1), or no
 *                     answer in time (it may still have landed). Reported
 *                     with output — "ran" — so it is never forgotten or
 *                     repeated blindly.
 */

// The clock, waits and transport every call goes through (tests fake all three).
export interface CloudRuntime {
  transport: CloudTransport;
  nowMs: () => number;
  sleep: (ms: number) => Promise<void>;
  logger: AgentLogger;
  userAgent: string;
}

/*
 * A cloud API's error answer (4xx or 5xx), already read and described:
 * the description names the call, what the cloud said and — for a refusal
 * of the agent's identity — the permission it lacks.
 */
export class CloudApiError extends Error {
  public readonly status: number;
  // The cloud's own error code (AccessDenied, AuthorizationFailed, PERMISSION_DENIED).
  public readonly code: string | null;
  // Whether the cloud refused the agent's identity (it lacks a permission).
  public readonly isAccessDenied: boolean;

  public constructor(data: {
    status: number;
    code: string | null;
    description: string;
    isAccessDenied: boolean;
  }) {
    super(data.description);
    this.name = "CloudApiError";
    this.status = data.status;
    this.code = data.code;
    this.isAccessDenied = data.isAccessDenied;
  }
}

/*
 * Nothing was changed; the message says why, for an operator. A refusal is
 * the agent's own decision (bounds, the tag, the resource's state) and is
 * reported as "Refused by the Cloud AI agent: ..."; anything else (a
 * credential, a read that failed) is reported as it is.
 */
export class CloudNotRunError extends Error {
  public readonly isRefusal: boolean;

  public constructor(message: string, isRefusal: boolean = false) {
    super(message);
    this.name = "CloudNotRunError";
    this.isRefusal = isRefusal;
  }
}

// The change call failed after it was (or may have been) sent.
export class CloudChangeError extends Error {
  // The cloud answered with an error (exit code 1).
  public readonly answered: boolean;
  // No answer within the budget (reported as "Killed (timeout …)").
  public readonly timedOut: boolean;

  public constructor(data: {
    message: string;
    answered: boolean;
    timedOut: boolean;
  }) {
    super(data.message);
    this.name = "CloudChangeError";
    this.answered = data.answered;
    this.timedOut = data.timedOut;
  }
}

// What a change reports once its call was accepted: the lines after the replaced value.
export interface CloudChangeOutcome {
  lines: Array<string>;
}

/*
 * Each call gives up after this long at most, and the run stops this long
 * before its budget, so the result is reported before the job loop or the
 * server gives up on the command.
 */
export const MAX_CLOUD_CALL_MS: number = 20_000;
export const CLOUD_RUN_HEADROOM_MS: number = 1_500;

// How often a long-running operation is asked about, and how many times at most.
export const DEFAULT_CLOUD_POLL_INTERVAL_MS: number = 2_000;
export const MAX_CLOUD_POLL_INTERVAL_MS: number = 10_000;
export const MAX_CLOUD_POLLS: number = 15;

// A resource id as output shows it (see CloudCommandRun.shownResourceId).
export function showCloudId(
  provider: CloudCatalogProvider,
  id: string,
): string {
  return provider === "azure" ? id.toLowerCase() : id;
}

// Names that take "an": a vowel, or an initialism read with one (RDS, SQS).
const AN_PATTERN: RegExp = /^(?:[AEIOUaeiou]|RDS\b|SQS\b)/;

// "an ECS service", "a virtual machine", "an SQS queue".
export function withArticle(name: string): string {
  return `${AN_PATTERN.test(name) ? "an" : "a"} ${name}`;
}

export function kindName(
  provider: CloudCatalogProvider,
  kind: string | null,
): string {
  const known: CloudResourceKindSpec | null = getCloudResourceKind(
    provider,
    kind,
  );

  return known ? known.displayName : "resource";
}

// One command being run: its budget, its reads and its one change.
export class CloudCommandRun {
  // The value the change replaces, set right before the change call.
  public replaced: Record<string, string> | null = null;
  public changeStarted: boolean = false;
  public readonly startedAtMs: number;
  public readonly deadlineMs: number;

  public constructor(
    public readonly runtime: CloudRuntime,
    public readonly command: ParsedCloudCommand,
    public readonly settings: CloudAgentSettings,
    public readonly timeoutInMs: number,
  ) {
    this.startedAtMs = runtime.nowMs();
    this.deadlineMs = this.startedAtMs + timeoutInMs - CLOUD_RUN_HEADROOM_MS;
  }

  public get provider(): CloudCatalogProvider {
    return this.command.provider;
  }

  public get cloudName(): string {
    return CLOUD_CATALOG_PROVIDER_NAMES[this.command.provider];
  }

  // "ECS service", "virtual machine".
  public get kindName(): string {
    return kindName(
      this.command.provider,
      this.command.resource ? this.command.resource.kind : null,
    );
  }

  public get resourceId(): string {
    return this.command.resource ? this.command.resource.id : "";
  }

  /*
   * The id as messages show it: an Azure id lowercased (Azure compares ids
   * without case). The output's redactor reads a camel-cased Azure id —
   * "…e9f0/resourceGroups/prod/providers/Microsoft" — as base64 and masks
   * it; lowercased, it stays readable.
   */
  public get shownResourceId(): string {
    return showCloudId(this.command.provider, this.resourceId);
  }

  // A part the resource id carries (cluster, name, zone, ...); "" when it has none.
  public part(name: string): string {
    return this.command.resource ? this.command.resource.parts[name] || "" : "";
  }

  public remainingMs(): number {
    return this.deadlineMs - this.runtime.nowMs();
  }

  // Nothing changed: say why.
  public refuse(reason: string): never {
    throw new CloudNotRunError(reason, true);
  }

  /*
   * One request within what is left of the budget (at most
   * MAX_CLOUD_CALL_MS). A budget already spent refuses before sending.
   */
  public async send(
    request: Omit<CloudHttpRequest, "timeoutInMs" | "maxResponseBytes">,
  ): Promise<CloudHttpResponse> {
    const remaining: number = this.remainingMs();

    if (remaining <= 0) {
      throw new CloudTransportError({
        kind: "connect",
        message: `the command's time budget (${this.timeoutInMs}ms) ran out before the call`,
      });
    }

    return await this.runtime.transport({
      ...request,
      timeoutInMs: Math.max(1, Math.min(MAX_CLOUD_CALL_MS, remaining)),
      maxResponseBytes: MAX_CLOUD_RESPONSE_BYTES,
    });
  }

  /*
   * A read before the change. Any failure means nothing was changed, so it
   * becomes a CloudNotRunError; `what` says what the read was for.
   */
  public async read<T>(what: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err: unknown) {
      if (err instanceof CloudNotRunError) {
        throw err;
      }

      throw new CloudNotRunError(
        `The agent could not ask ${this.cloudName} ${what}, so nothing was changed: ${describeCloudError(err)}`,
      );
    }
  }

  /*
   * THE change call. `replaced` is what it replaces (the output's first
   * line). A connection that never opened changed nothing (not run); an
   * error answer or no answer did, or may have.
   */
  public async change<T>(
    replaced: Record<string, string>,
    call: () => Promise<T>,
  ): Promise<T> {
    this.replaced = { ...replaced };
    this.changeStarted = true;

    try {
      return await call();
    } catch (err: unknown) {
      if (err instanceof CloudNotRunError) {
        throw err;
      }

      if (err instanceof CloudTransportError && !err.mayHaveBeenSent) {
        throw new CloudNotRunError(
          `The change was not sent, so nothing was changed: ${err.message}`,
        );
      }

      if (err instanceof CloudApiError) {
        throw new CloudChangeError({
          message: err.message,
          answered: true,
          timedOut: false,
        });
      }

      const timedOut: boolean =
        err instanceof CloudTransportError && err.kind === "timeout";

      throw new CloudChangeError({
        message: `${
          timedOut
            ? `${this.cloudName} did not answer the change in time`
            : `The connection to ${this.cloudName} failed after the change was sent`
        } (${describeCloudError(err)}). It may still have been carried out: read the ${this.kindName}'s state before trying again.`,
        answered: false,
        timedOut,
      });
    }
  }

  // ---- Shared checks ---------------------------------------------------------------

  /*
   * The required tag (ONEUPTIME_AI_CLOUD_REQUIRED_TAG), on the tags the
   * resource carries — null when this kind cannot carry any. Refuses when
   * the setting is unreadable or the resource lacks the tag.
   */
  public checkRequiredTag(tags: Record<string, string> | null): void {
    if (this.settings.requiredTagProblem) {
      this.refuse(this.settings.requiredTagProblem);
    }

    const tag: CloudAgentSettings["requiredTag"] = this.settings.requiredTag;

    if (!tag) {
      return;
    }

    const shown: string = formatRequiredTag(tag);
    const word: string = this.provider === "gcp" ? "label" : "tag";

    if (tags === null) {
      this.refuse(
        `the agent only changes resources that carry the ${word} ${shown} (ONEUPTIME_AI_CLOUD_REQUIRED_TAG), and ${withArticle(this.kindName)} cannot carry one, so it does not change ${this.shownResourceId}`,
      );
    }

    if (
      !carriesRequiredTag({
        provider: this.provider,
        tag,
        tags: tags as Record<string, string>,
      })
    ) {
      this.refuse(
        `the agent only changes resources that carry the ${word} ${shown} (ONEUPTIME_AI_CLOUD_REQUIRED_TAG), and the ${this.kindName} ${this.shownResourceId} does not, so nothing was changed. Add the ${word} to the resource to let OneUptime AI change it.`,
      );
    }
  }

  /*
   * The --count a scale asks for, inside its bounds: above the current
   * count and within the maximum for scale-out (refused from zero when the
   * maximum is only the doubling rule), below it and not under the minimum
   * (never under 1) for scale-in.
   */
  public checkCount(bounds: CountBounds): number {
    const requested: number | null = getCloudIntegerFlag(this.command, "count");
    const current: number = bounds.current;
    const unit: string = bounds.unit;

    if (requested === null) {
      return this.refuse("the scale names no --count");
    }

    if (this.command.operation.name === "scale-out") {
      if (current <= 0 && !bounds.maximumIsPlatformLimit) {
        this.refuse(
          `the ${this.kindName}'s ${unit} is 0, and nothing bounds a scale out from zero (the agent never more than doubles a count the platform sets no maximum for), so nothing was changed: start it at the size it needs by hand`,
        );
      }

      if (requested <= current) {
        this.refuse(
          `--count ${requested} is not above the ${this.kindName}'s ${unit}, ${current}: scale-out raises it (scale-in lowers it), so nothing was changed`,
        );
      }

      if (requested > bounds.maximum) {
        this.refuse(
          `--count ${requested} is above ${bounds.maximum}, the most the ${this.kindName} may run (${bounds.maximumSource}), so nothing was changed`,
        );
      }

      return requested;
    }

    const minimum: number = Math.max(1, bounds.minimum);

    if (requested >= current) {
      this.refuse(
        `--count ${requested} is not below the ${this.kindName}'s ${unit}, ${current}: scale-in lowers it (scale-out raises it), so nothing was changed`,
      );
    }

    if (requested < minimum) {
      this.refuse(
        `--count ${requested} is below ${minimum}, the fewest the ${this.kindName} may run (${
          bounds.minimum >= 1 ? bounds.minimumSource : "never 0"
        }), so nothing was changed`,
      );
    }

    return requested;
  }

  // Waits between polls of a long-running operation, never past the budget.
  public async pause(ms: number): Promise<boolean> {
    const wait: number = Math.min(ms, this.remainingMs());

    if (wait <= 0) {
      return false;
    }

    await this.runtime.sleep(wait);
    return this.remainingMs() > 0;
  }
}

export interface CountBounds {
  current: number;
  // Before the floor of 1.
  minimum: number;
  minimumSource: string;
  maximum: number;
  maximumSource: string;
  // The maximum is the platform's own (a group's MaxSize), not the doubling rule.
  maximumIsPlatformLimit: boolean;
  // "desired count", "instance count", "minimum instances".
  unit: string;
}

/*
 * Bounds where the platform may set a maximum: its own when it does,
 * else at most double the current count.
 */
export function boundsOf(data: {
  current: number;
  unit: string;
  minimum?: number | null | undefined;
  minimumSource?: string | undefined;
  maximum?: number | null | undefined;
  maximumSource?: string | undefined;
}): CountBounds {
  const platformMaximum: boolean =
    typeof data.maximum === "number" && data.maximum > 0;

  return {
    current: data.current,
    unit: data.unit,
    minimum: typeof data.minimum === "number" ? data.minimum : 1,
    minimumSource: data.minimumSource || "never 0",
    maximum: platformMaximum
      ? (data.maximum as number)
      : Math.max(0, data.current * 2),
    maximumSource: platformMaximum
      ? data.maximumSource || "the platform's maximum"
      : `double its ${data.unit} of ${data.current}: no maximum is set, and the agent never more than doubles it`,
    maximumIsPlatformLimit: platformMaximum,
  };
}

// "a → b" for the output.
export function arrow(from: string | number, to: string | number): string {
  return `${from} → ${to}`;
}
