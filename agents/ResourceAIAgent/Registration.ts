import AgentStatus from "./AgentStatus";
import { AgentConfig } from "./Config";
import IngestClient, {
  AgentCredentials,
  CANCELLED_REQUEST_SETTLE_MS,
  IngestResponse,
} from "./IngestClient";
import Logger from "./Logger";
import {
  AgentPosture,
  REGISTRATION_HOLD_RETRY_MS,
  describeRegistrationHold,
} from "./Posture";
import { SleepFunction, sleep as defaultSleep, waitAtMost } from "./Sleep";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  ALL_AI_RESOURCE_TYPES,
  isAiResourceType,
} from "./Common/Types/ResourceAiAgent/AiResourceType";
import {
  RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
  RESOURCE_AI_AGENT_API_KEY_ENVS,
  RESOURCE_AI_AGENT_IMAGE_REPOSITORY,
  RESOURCE_AI_AGENT_RESOURCE_NAME_ENV,
  RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV,
  isTransientResourceAiAgentRegistrationRefusal,
} from "./Common/Types/ResourceAiAgent/ResourceAiAccess";

/*
 * The agent's identity with OneUptime, and how it gets one.
 *
 * The agent registers with the collector's ingestion key, its resource type
 * and the resource's identity (the one the collector reports); the server
 * answers with an agent id and a key that authenticate every later call,
 * and the OneUptime resource it resolved. Registration is retried FOREVER —
 * a server that is restarting, an older server without this API, a refusal
 * an operator has to fix — because the agent has nothing else to do, and
 * exiting would only turn a readable log line into a restart loop.
 *
 * Only the key issued last is kept, in memory, and sent as previousAgentKey
 * on the next registration: the proof of continuity that lets this process
 * re-register while its own row still looks online. A new container has no
 * such key and is admitted once the previous one signed off or went quiet.
 */

// Transient failures: 30s, then 60s, then every 60s.
export const TRANSIENT_RETRY_BASE_MS: number = 30_000;
export const TRANSIENT_RETRY_MAX_MS: number = 60_000;

/*
 * A refusal that clears on its own (previous_instance_online: the old
 * container is still heartbeating) is retried at the server's Retry-After,
 * else every 20s — never with a growing backoff, because it is admitted on
 * a known schedule. A server hint is honoured up to a minute.
 */
export const TRANSIENT_REFUSAL_RETRY_MS: number = 20_000;
export const MAX_SERVER_RETRY_HINT_MS: number = 60_000;

// A 429's Retry-After is honoured up to this long.
export const MAX_RATE_LIMIT_WAIT_MS: number = 5 * 60_000;

/*
 * A refusal only an operator can fix (a bad or pinned key, an invalid
 * resource type or identity, the agent cap) — retrying fast only hammers
 * the server; a slow fixed interval still picks the fix up within minutes,
 * and restarting the container picks it up at once.
 */
export const OPERATOR_ACTION_RETRY_MS: number = 5 * 60_000;

/*
 * How long previous_instance_online may last before it is no restart. An
 * old container that stopped without signing off is admitted once the
 * server has not heard from it for RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES;
 * a refusal that outlasts twice that means another live agent registers as
 * the same resource (two installs sharing one identity, e.g. the
 * collector's default name). Only an operator fixes that, so from then on
 * the agent says so as an error and asks every OPERATOR_ACTION_RETRY_MS:
 * every attempt spends the ingestion key's registration budget, which the
 * key's other agents need too.
 */
export const DUPLICATE_AGENT_AFTER_MS: number =
  2 * RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES * 60_000;

// An older OneUptime without this API: checked again every 5 minutes.
export const API_MISSING_RETRY_MS: number = 5 * 60_000;

/*
 * Consecutive rejections of the current identity (heartbeat or claim
 * answered 401/403, or like a server without the API) before the agent
 * drops it and registers again. The server rejects an identity that was
 * reset by an admin or replaced; a few in a row rule out a one-off.
 */
export const REREGISTER_AFTER_REJECTIONS: number = 3;

/*
 * How long stop() waits, by default, for a registration already on the
 * wire. The agent's shutdown passes its own grace instead (Agent.ts).
 */
export const REGISTRATION_STOP_MAX_WAIT_MS: number = 5_000;

export const API_MISSING_MESSAGE: string = `This OneUptime server does not have the resource AI agent API (it needs the same OneUptime version as this agent, or newer). Upgrade OneUptime, or run the ${RESOURCE_AI_AGENT_IMAGE_REPOSITORY} image version that matches your server.`;

export interface AgentIdentity extends AgentCredentials {
  // The OneUptime resource the server registered this agent for.
  resourceId: string | null;
  resourceName: string | null;
}

export type RegistrationFailureCategory =
  // No usable answer: network, timeout, 408, 429, 5xx.
  | "transient"
  // A refusal that clears on its own.
  | "waiting"
  // A refusal an operator has to act on.
  | "refused"
  // The server has no resource AI agent API.
  | "api_missing";

export interface RegistrationRetryPlan {
  category: RegistrationFailureCategory;
  delayMs: number;
  // What to tell the operator.
  message: string;
  // The server's refusal reason, when it sent one.
  reason: string | null;
  // What exactly came back, when the message above is a summary.
  detail: string | null;
}

/*
 * What the messages may name: the resource type, and the variables the
 * identity and the key came from. Every field is optional; the messages
 * fall back to naming every candidate.
 */
export interface RegistrationContext {
  resourceType?: AiResourceType | null | undefined;
  identitySource?: string | null | undefined;
  apiKeySource?: string | null | undefined;
  // The identity the agent registers with.
  resourceIdentifier?: string | null | undefined;
}

function readString(
  body: Record<string, unknown> | null,
  key: string,
): string | null {
  const value: unknown = body ? body[key] : null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function describeResourceTypes(): string {
  return ALL_AI_RESOURCE_TYPES.map((type: AiResourceType): string => {
    return AI_RESOURCE_TYPE_INFO[type].agentAlias;
  }).join(", ");
}

function describeResource(context: RegistrationContext): string {
  return context.resourceType && isAiResourceType(context.resourceType)
    ? AI_RESOURCE_TYPE_INFO[context.resourceType].displayName
    : "resource";
}

function describeIdentityVariable(context: RegistrationContext): string {
  if (context.identitySource) {
    return context.identitySource;
  }

  if (context.resourceType && isAiResourceType(context.resourceType)) {
    return [
      ...AI_RESOURCE_TYPE_INFO[context.resourceType].identityEnvVars,
      RESOURCE_AI_AGENT_RESOURCE_NAME_ENV,
    ].join(" / ");
  }

  return RESOURCE_AI_AGENT_RESOURCE_NAME_ENV;
}

/*
 * A 403 that is not the registration service's refusal came from the
 * ingest middleware in front of it: a revoked, browser-only or
 * service-pinned key. Point at the one setting that fixes those.
 */
function describeRefusal(
  response: IngestResponse,
  reason: string | null,
  context: RegistrationContext,
): string {
  const serverMessage: string = response.message;

  if (reason === "resource_type_invalid") {
    return `OneUptime refused the registration: ${serverMessage} Set ${RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV} to one of: ${describeResourceTypes()}.`;
  }

  if (reason === "resource_identifier_invalid") {
    return `OneUptime refused the registration: ${serverMessage} Fix ${describeIdentityVariable(context)} on the agent.`;
  }

  if (reason === "resource_not_found") {
    return `OneUptime refused the registration: ${serverMessage} Check ${describeIdentityVariable(context)}: it must name a ${describeResource(context)} of the project this key belongs to.`;
  }

  if (reason === "agent_cap_reached") {
    return `OneUptime refused the registration: ${serverMessage}`;
  }

  if (response.status === 401 || response.status === 403) {
    return `OneUptime refused the agent's API key: ${serverMessage} Check ${
      context.apiKeySource || RESOURCE_AI_AGENT_API_KEY_ENVS.join(" / ")
    } — it must be an unpinned telemetry ingestion key of this project.`;
  }

  return `OneUptime refused the registration: ${serverMessage}`;
}

// A refusal that clears on its own (previous_instance_online).
export function isWaitingRefusal(response: IngestResponse): boolean {
  return (
    response.kind === "auth" &&
    response.status === 403 &&
    isTransientResourceAiAgentRegistrationRefusal(
      readString(response.body, "reason"),
    )
  );
}

function describeDuplicateAgent(context: RegistrationContext): string {
  const resource: string = describeResource(context);
  const identity: string = context.resourceIdentifier
    ? ` ("${context.resourceIdentifier}")`
    : "";

  return `Another AI agent has been online as this ${resource}${identity} for over ${Math.round(
    DUPLICATE_AGENT_AFTER_MS / 60_000,
  )} minutes, so OneUptime keeps refusing this one: two agents register with the same identity. Give each ${resource} its own ${describeIdentityVariable(
    context,
  )} (on the collector and the agent alike), or stop the other agent. Retrying every ${Math.round(
    OPERATOR_ACTION_RETRY_MS / 60_000,
  )} minutes.`;
}

/*
 * How long to wait after a failed registration, and what to say. Pure, for
 * tests: consecutiveFailures counts this failure too (1 for the first), and
 * waitingForMs is how long the agent has been refused as a resource whose
 * previous agent is online (0 for the first such refusal).
 */
export function planRegistrationRetry(data: {
  response: IngestResponse;
  consecutiveFailures: number;
  context?: RegistrationContext | undefined;
  waitingForMs?: number | undefined;
}): RegistrationRetryPlan {
  const response: IngestResponse = data.response;
  const context: RegistrationContext = data.context || {};
  const reason: string | null = readString(response.body, "reason");

  if (response.kind === "api_missing") {
    return {
      category: "api_missing",
      delayMs: API_MISSING_RETRY_MS,
      message: API_MISSING_MESSAGE,
      reason,
      detail: response.message,
    };
  }

  if (response.kind === "transient") {
    const doubling: number = Math.min(
      TRANSIENT_RETRY_BASE_MS *
        Math.pow(2, Math.max(0, data.consecutiveFailures - 1)),
      TRANSIENT_RETRY_MAX_MS,
    );
    const hintMs: number =
      response.status === 429 && response.retryAfterSeconds !== null
        ? Math.min(response.retryAfterSeconds * 1000, MAX_RATE_LIMIT_WAIT_MS)
        : 0;

    return {
      category: "transient",
      delayMs: Math.max(doubling, hintMs),
      message: response.message,
      reason,
      detail: null,
    };
  }

  if (isWaitingRefusal(response)) {
    if ((data.waitingForMs ?? 0) >= DUPLICATE_AGENT_AFTER_MS) {
      return {
        category: "refused",
        delayMs: OPERATOR_ACTION_RETRY_MS,
        message: describeDuplicateAgent(context),
        reason,
        detail: response.message,
      };
    }

    const hintMs: number | null =
      response.retryAfterSeconds === null
        ? null
        : Math.min(
            Math.max(1_000, Math.ceil(response.retryAfterSeconds) * 1000),
            MAX_SERVER_RETRY_HINT_MS,
          );

    return {
      category: "waiting",
      delayMs: hintMs ?? TRANSIENT_REFUSAL_RETRY_MS,
      message: `Waiting for this ${describeResource(context)}'s previous AI agent to go offline: ${response.message}`,
      reason,
      detail: null,
    };
  }

  if (response.kind === "ok") {
    return {
      category: "refused",
      delayMs: OPERATOR_ACTION_RETRY_MS,
      message:
        "OneUptime accepted the registration but did not send an agent id and key. Upgrade OneUptime to the version that matches this agent.",
      reason,
      detail: null,
    };
  }

  return {
    category: "refused",
    delayMs: OPERATOR_ACTION_RETRY_MS,
    message: describeRefusal(response, reason, context),
    reason,
    detail: null,
  };
}

// The identity in a 200 answer, or null when it is not all there.
export function parseRegistration(
  body: Record<string, unknown> | null,
): AgentIdentity | null {
  const agentId: string | null = readString(body, "agentId");
  const agentKey: string | null = readString(body, "agentKey");

  if (!agentId || !agentKey) {
    return null;
  }

  return {
    agentId,
    agentKey,
    resourceId: readString(body, "resourceId"),
    resourceName: readString(body, "resourceName"),
  };
}

export interface AgentSessionDependencies {
  client: IngestClient;
  config: AgentConfig;
  status: AgentStatus;
  getPosture: () => Promise<AgentPosture>;
  sleep?: SleepFunction | undefined;
  // The clock, in milliseconds (Date.now by default).
  now?: (() => number) | undefined;
}

export type RegistrationAttempt =
  | { identity: AgentIdentity }
  | { identity: null; plan: RegistrationRetryPlan };

export class AgentSession {
  private identity: AgentIdentity | null = null;
  // The key issued last, sent as previousAgentKey on the next registration.
  private lastIssuedKey: string | null = null;
  private registration: Promise<AgentIdentity | null> | null = null;
  private attemptInFlight: Promise<unknown> | null = null;
  private rejectionsInARow: number = 0;
  private failuresInARow: number = 0;
  /*
   * When the current run of previous_instance_online refusals began, or
   * null outside one. A transient failure (a 429, a 5xx) in between does
   * not end the run; any other answer does.
   */
  private waitingSinceMs: number | null = null;
  private stopped: boolean = false;
  // Ends a wait between attempts at once when stop() is called.
  private readonly stopController: AbortController = new AbortController();
  // Cancels the attempt on the wire when stop() gives up waiting for it.
  private readonly requestController: AbortController = new AbortController();
  /*
   * Messages already logged at warn/error level since the last successful
   * registration: the same refusal again is logged at debug, so an agent
   * waiting for an operator says what to do once instead of every few
   * minutes forever.
   */
  private readonly loggedMessages: Set<string> = new Set<string>();
  private readonly sleep: SleepFunction;
  private readonly now: () => number;

  public constructor(private readonly deps: AgentSessionDependencies) {
    this.sleep = deps.sleep || defaultSleep;
    this.now =
      deps.now ||
      ((): number => {
        return Date.now();
      });
  }

  public getIdentity(): AgentIdentity | null {
    return this.identity;
  }

  public isStopped(): boolean {
    return this.stopped;
  }

  /*
   * Register, retrying forever with the schedule above; resolves with the
   * identity, or null once stop() is called. Single-flight: every caller
   * shares the one registration in progress.
   */
  public ensureRegistered(): Promise<AgentIdentity | null> {
    if (this.identity) {
      return Promise.resolve(this.identity);
    }

    if (this.stopped) {
      return Promise.resolve(null);
    }

    if (!this.registration) {
      this.deps.status.phase = "registering";
      this.registration = this.registerUntilDone().finally((): void => {
        this.registration = null;
      });
    }

    return this.registration;
  }

  /*
   * One registration attempt, without waiting; null when the session was
   * stopped before the request went out (nothing is ever sent after stop()).
   * Public for tests.
   */
  public async attemptRegistration(): Promise<RegistrationAttempt | null> {
    const posture: AgentPosture = await this.deps.getPosture();

    if (this.stopped) {
      return null;
    }

    this.deps.status.posture = posture;

    /*
     * An agent that cannot serve its resource from where it runs must not
     * take the resource's place (describeRegistrationHold): nothing is
     * sent, and it looks again after a fresh probe.
     */
    const hold: string | null = describeRegistrationHold(posture);

    if (hold) {
      return {
        identity: null,
        plan: {
          category: "waiting",
          delayMs: REGISTRATION_HOLD_RETRY_MS,
          message: hold,
          reason: null,
          detail: null,
        },
      };
    }

    const request: Promise<IngestResponse> = this.deps.client.register(
      {
        resourceType: posture.resourceType,
        resourceIdentifier: posture.resourceIdentifier,
        resourceId: this.deps.config.resourceId || undefined,
        agentVersion: this.deps.config.agentVersion || undefined,
        previousAgentKey: this.lastIssuedKey || undefined,
        posture,
      },
      { signal: this.requestController.signal },
    );

    this.attemptInFlight = request;

    let response: IngestResponse;
    try {
      response = await request;
    } finally {
      this.attemptInFlight = null;
    }

    const identity: AgentIdentity | null =
      response.kind === "ok" ? parseRegistration(response.body) : null;

    if (identity) {
      this.failuresInARow = 0;
      this.waitingSinceMs = null;
      return { identity };
    }

    this.failuresInARow++;

    const nowMs: number = this.now();

    if (isWaitingRefusal(response)) {
      this.waitingSinceMs = this.waitingSinceMs ?? nowMs;
    } else if (response.kind !== "transient") {
      this.waitingSinceMs = null;
    }

    return {
      identity: null,
      plan: planRegistrationRetry({
        response,
        consecutiveFailures: this.failuresInARow,
        waitingForMs:
          this.waitingSinceMs === null
            ? 0
            : Math.max(0, nowMs - this.waitingSinceMs),
        context: {
          resourceType: this.deps.config.resourceType,
          identitySource: this.deps.config.identitySource,
          apiKeySource: this.deps.config.apiKeySource,
          resourceIdentifier: posture.resourceIdentifier,
        },
      }),
    };
  }

  /*
   * The result of a call made with this identity was accepted: the run of
   * rejections is over.
   */
  public recordAccepted(identity: AgentIdentity): void {
    if (identity === this.identity) {
      this.rejectionsInARow = 0;
    }
  }

  /*
   * A call made with this identity was rejected (401/403) or answered like
   * a server without this API. After REREGISTER_AFTER_REJECTIONS in a row
   * the identity is dropped — nothing is sent with it again — and the agent
   * registers anew. A rejection of an identity that has already been
   * replaced is ignored, so two loops can never rotate the key twice.
   */
  public recordRejected(
    identity: AgentIdentity,
    response: IngestResponse,
  ): void {
    if (identity !== this.identity || this.stopped) {
      return;
    }

    this.rejectionsInARow++;
    this.deps.status.recordError(response.message);

    if (response.kind === "api_missing") {
      this.deps.status.apiMissing = true;
    }

    if (this.rejectionsInARow < REREGISTER_AFTER_REJECTIONS) {
      return;
    }

    Logger.warn(
      `OneUptime rejected this agent's identity ${this.rejectionsInARow} times in a row (it was reset or replaced); registering again.`,
      { lastAnswer: response.message },
    );

    this.identity = null;
    this.rejectionsInARow = 0;
    this.deps.status.agentId = null;
    void this.ensureRegistered();
  }

  /*
   * Stop for good: no attempt is sent after this, a wait in progress ends
   * at once, and an attempt already on the wire is waited for, up to
   * maxWaitMs — so no registration the server processes after the agent's
   * /disconnect can mark it online again. One still unanswered after
   * maxWaitMs is cancelled, so the wait never outlasts the container's
   * stop timeout.
   *
   * Resolves true when nothing was left unanswered.
   */
  public async stop(
    maxWaitMs: number = REGISTRATION_STOP_MAX_WAIT_MS,
  ): Promise<boolean> {
    this.stopped = true;
    this.stopController.abort();

    const inFlight: Promise<unknown> | null = this.attemptInFlight;

    if (await waitAtMost(inFlight, maxWaitMs)) {
      return true;
    }

    this.requestController.abort();
    // The cancelled request settles at once (post never throws).
    await waitAtMost(inFlight, CANCELLED_REQUEST_SETTLE_MS);
    return false;
  }

  private async registerUntilDone(): Promise<AgentIdentity | null> {
    while (!this.stopped) {
      const attempt: RegistrationAttempt | null =
        await this.attemptRegistration();

      if (!attempt) {
        break;
      }

      if (attempt.identity) {
        /*
         * Stopped while the attempt was on the wire: keep the identity
         * anyway, so the /disconnect that follows carries the key the
         * server just issued.
         */
        this.adopt(attempt.identity);
        return this.stopped ? null : attempt.identity;
      }

      // Stopped while the attempt was on the wire: nothing left to report.
      if (this.stopped) {
        break;
      }

      this.report(attempt.plan);
      await this.sleep(attempt.plan.delayMs, this.stopController.signal);
    }

    return null;
  }

  private adopt(identity: AgentIdentity): void {
    this.identity = identity;
    this.lastIssuedKey = identity.agentKey;
    this.rejectionsInARow = 0;
    this.loggedMessages.clear();
    this.deps.status.recordRegistered({
      agentId: identity.agentId,
      resourceId: identity.resourceId,
      resourceName: identity.resourceName,
    });

    Logger.info(
      `Connected to OneUptime as this ${this.describeResource()}'s AI agent.`,
      {
        agentId: identity.agentId,
        resourceType: this.deps.config.resourceType,
        resourceIdentifier: this.deps.config.resourceIdentifier,
        resourceId: identity.resourceId,
        resourceName: identity.resourceName,
      },
    );
  }

  private describeResource(): string {
    return describeResource({ resourceType: this.deps.config.resourceType });
  }

  private report(plan: RegistrationRetryPlan): void {
    this.deps.status.recordError(plan.message);
    this.deps.status.apiMissing = plan.category === "api_missing";

    const extra: Record<string, unknown> = {
      retryInSeconds: Math.round(plan.delayMs / 1000),
      ...(plan.reason ? { reason: plan.reason } : {}),
      ...(plan.detail ? { detail: plan.detail } : {}),
    };

    if (plan.category === "transient") {
      Logger.warn(`Could not register with OneUptime: ${plan.message}`, extra);
      return;
    }

    const key: string = `${plan.category}:${plan.message}`;

    if (this.loggedMessages.has(key)) {
      Logger.debug(plan.message, extra);
      return;
    }

    this.loggedMessages.add(key);

    if (plan.category === "waiting") {
      Logger.info(plan.message, extra);
    } else {
      Logger.error(plan.message, extra);
    }
  }
}
