import { AgentConfig } from "./Config";
import { mergeTargets } from "./Executors/PrepareGuard";
import {
  ResourceExecutor,
  ResourcePostureProbe,
} from "./Executors/ResourceExecutor";
import AiResourceType from "./Common/Types/ResourceAiAgent/AiResourceType";
import {
  MAX_POSTURE_LIST_ENTRIES,
  MAX_POSTURE_STRING_LENGTH,
  ResourceAiAgentPosture,
} from "./Common/Types/ResourceAiAgent/ResourceAiAccess";

/*
 * What the agent tells OneUptime about itself, on registration and on every
 * heartbeat: which resource it serves, whether it runs writes and where,
 * what it never changes, and what its executor last saw of the resource
 * (version, reachable or not and why). The server enforces the same write
 * scope with it, so it never enqueues a write this agent said it would
 * refuse, and the resource's AI agent page describes the agent that is
 * actually running.
 *
 * The executor's probe can be slow (a resource that does not answer), so it
 * is bounded by a timeout and its answer is reused for a while: a heartbeat
 * never waits minutes for it.
 */

export type AgentPosture = ResourceAiAgentPosture;

// How long a probe's answer is reused before the executor is asked again.
export const DEFAULT_PROBE_REFRESH_MS: number = 60_000;
// How long one probe may take before the resource counts as unreachable.
export const DEFAULT_PROBE_TIMEOUT_MS: number = 15_000;

// A probe's answer with every field present and bounded.
export interface NormalizedProbe {
  toolVersion: string | null;
  reachable: boolean;
  reachError: string | null;
  details: Record<string, string | number | boolean | null>;
  protectedTargets: Array<string>;
}

function capString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed: string = value.trim();

  return trimmed ? trimmed.slice(0, MAX_POSTURE_STRING_LENGTH) : null;
}

function readDetails(
  value: unknown,
): Record<string, string | number | boolean | null> {
  const details: Record<string, string | number | boolean | null> = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return details;
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (
      Object.keys(details).length >= MAX_POSTURE_LIST_ENTRIES ||
      !key ||
      key.length > MAX_POSTURE_STRING_LENGTH
    ) {
      continue;
    }

    if (typeof entry === "string") {
      details[key] = entry.slice(0, MAX_POSTURE_STRING_LENGTH);
    } else if (
      (typeof entry === "number" && Number.isFinite(entry)) ||
      typeof entry === "boolean" ||
      entry === null
    ) {
      details[key] = entry;
    }
  }

  return details;
}

/*
 * An executor's probe answer, read defensively: whatever it returned, the
 * posture gets well-formed fields. Anything but reachable === true is
 * unreachable.
 */
export function normalizeProbe(raw: unknown): NormalizedProbe {
  const probe: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const reachable: boolean = probe["reachable"] === true;

  return {
    toolVersion: capString(probe["toolVersion"]),
    reachable,
    reachError: reachable
      ? null
      : capString(probe["reachError"]) ||
        "The agent could not tell whether it can reach the resource.",
    details: readDetails(probe["details"]),
    protectedTargets: mergeTargets(
      Array.isArray(probe["protectedTargets"])
        ? (probe["protectedTargets"] as Array<unknown>).filter(
            (entry: unknown): entry is string => {
              return (
                typeof entry === "string" &&
                entry.trim().length <= MAX_POSTURE_STRING_LENGTH
              );
            },
          )
        : [],
    ),
  };
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/*
 * Asks the executor what the resource looks like, at most once per
 * refreshMs (single flight: concurrent callers share one probe), within
 * timeoutMs. Never rejects: a probe that throws or takes too long is an
 * unreachable resource, with the reason.
 */
export class PostureProbe {
  private cached: NormalizedProbe | null = null;
  private cachedAtMs: number = 0;
  private inFlight: Promise<NormalizedProbe> | null = null;
  private readonly refreshMs: number;
  private readonly timeoutMs: number;
  private readonly nowMs: () => number;

  public constructor(
    private readonly options: {
      executor: ResourceExecutor;
      refreshMs?: number | undefined;
      timeoutMs?: number | undefined;
      nowMs?: (() => number) | undefined;
    },
  ) {
    this.refreshMs = options.refreshMs ?? DEFAULT_PROBE_REFRESH_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    this.nowMs =
      options.nowMs ||
      ((): number => {
        return Date.now();
      });
  }

  // The last answer, or null before the first probe finished.
  public getLast(): NormalizedProbe | null {
    return this.cached;
  }

  public get(): Promise<NormalizedProbe> {
    if (this.cached && this.nowMs() - this.cachedAtMs < this.refreshMs) {
      return Promise.resolve(this.cached);
    }

    if (!this.inFlight) {
      this.inFlight = this.probe().finally((): void => {
        this.inFlight = null;
      });
    }

    return this.inFlight;
  }

  // Forget the cached answer: the next get() probes again.
  public invalidate(): void {
    this.cached = null;
  }

  private async probe(): Promise<NormalizedProbe> {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const timedOut: Promise<NormalizedProbe> = new Promise<NormalizedProbe>(
      (resolve: (value: NormalizedProbe) => void): void => {
        timer = setTimeout((): void => {
          resolve(
            normalizeProbe({
              reachable: false,
              reachError: `Checking the resource took longer than ${
                this.timeoutMs >= 1000
                  ? `${Math.round(this.timeoutMs / 1000)}s`
                  : `${this.timeoutMs}ms`
              }, so it counts as unreachable for now.`,
            }),
          );
        }, this.timeoutMs);
      },
    );

    let answered: Promise<NormalizedProbe>;

    try {
      answered = this.options.executor.probePosture().then(
        (raw: ResourcePostureProbe): NormalizedProbe => {
          return normalizeProbe(raw);
        },
        (err: unknown): NormalizedProbe => {
          return normalizeProbe({
            reachable: false,
            reachError: `Checking the resource failed: ${describeError(err)}`,
          });
        },
      );
    } catch (err: unknown) {
      answered = Promise.resolve(
        normalizeProbe({
          reachable: false,
          reachError: `Checking the resource failed: ${describeError(err)}`,
        }),
      );
    }

    const result: NormalizedProbe = await Promise.race([answered, timedOut]);

    if (timer) {
      clearTimeout(timer);
    }

    this.cached = result;
    this.cachedAtMs = this.nowMs();
    return result;
  }
}

/*
 * The posture as sent on the wire. Writes are reported off — as the server
 * would read them — when the write switch is off, or when the protected or
 * write-target list is over the bounds the server accepts. Identity facts
 * from the configuration (databaseSystem, serverAddress, serverPort) win
 * over the executor's details of the same name: they are what the agent
 * registered with.
 */
export function buildPosture(data: {
  config: AgentConfig;
  resourceType: AiResourceType;
  resourceIdentifier: string;
  probe: NormalizedProbe;
  now?: Date | undefined;
}): AgentPosture {
  const protectedTargets: Array<string> = mergeTargets(
    data.config.protectedTargets,
    data.probe.protectedTargets,
  );
  const writeTargets: Array<string> = [...data.config.writeTargets];
  const withinBounds: boolean =
    protectedTargets.length <= MAX_POSTURE_LIST_ENTRIES &&
    writeTargets.length <= MAX_POSTURE_LIST_ENTRIES;

  const posture: AgentPosture = {
    resourceType: data.resourceType,
    resourceIdentifier: data.resourceIdentifier,
    allowWrites: data.config.allowWrites && withinBounds,
    writeTargets,
    protectedTargets: protectedTargets.slice(0, MAX_POSTURE_LIST_ENTRIES),
    reachable: data.probe.reachable,
    details: readDetails({
      ...data.probe.details,
      ...data.config.identityDetails,
    }),
    reportedAt: (data.now || new Date()).toISOString(),
    /*
     * What the .env lets OneUptime AI do here (or the agent's defaults, when
     * it names neither setting). OneUptime applies it to the resource and
     * the resource's AI agent page shows it read-only.
     */
    aiSettings: { ...data.config.aiSettings },
  };

  if (data.config.agentVersion) {
    posture.agentVersion = data.config.agentVersion;
  }

  if (data.config.allowWritesSetting !== null) {
    const setting: string | null = capString(data.config.allowWritesSetting);

    if (setting) {
      posture.allowWritesSetting = setting;
    }
  }

  if (data.probe.toolVersion) {
    posture.toolVersion = data.probe.toolVersion;
  }

  if (!data.probe.reachable && data.probe.reachError) {
    posture.reachError = data.probe.reachError;
  }

  return posture;
}

/*
 * How long an agent held back from registering (describeRegistrationHold)
 * waits before it looks again: one probe refresh, so every look is a fresh
 * probe.
 */
export const REGISTRATION_HOLD_RETRY_MS: number = DEFAULT_PROBE_REFRESH_MS;

/*
 * Why this agent must not register for its resource from where it runs, or
 * null. Registering makes an agent THE resource's AI agent, and the server
 * keeps it for as long as it heartbeats, refusing any other agent for the
 * resource. A Docker Swarm agent on a worker node can run nothing (node,
 * service and task commands only work on a manager), so if it registered —
 * say, because the collector's compose file runs on every node, or workers
 * came up first after a reboot — it would keep the manager's agent out and
 * leave the cluster with an AI agent that cannot reach it. It registers as
 * soon as the node is a manager. Only a definite "worker" holds it back: an
 * engine whose role the agent could not read registers, and says why it is
 * unreachable.
 */
export function describeRegistrationHold(posture: AgentPosture): string | null {
  if (
    posture.resourceType === AiResourceType.DockerSwarmCluster &&
    posture.details?.["swarmRole"] === "worker"
  ) {
    return `This node is a swarm worker, and the Docker Swarm AI agent only works on a manager, so it does not register for the cluster "${posture.resourceIdentifier}" from here: a registered agent that cannot run anything would keep the manager's agent out. It checks again every ${Math.round(
      REGISTRATION_HOLD_RETRY_MS / 1000,
    )}s and registers once this node is a manager. Run the AI agent on one manager node (install.sh leaves it out on the others).`;
  }

  return null;
}
