import http from "http";
import os from "os";
import AgentStatus from "./AgentStatus";
import {
  AgentConfig,
  ParsedConfig,
  describeDefaultIdentity,
  parseConfig,
} from "./Config";
import {
  ExecutorFactoryFunction,
  createExecutor,
} from "./Executors/ExecutorFactory";
import { getAgentDisplayName } from "./Executors/PrepareGuard";
import {
  ExecutorOptions,
  ResourceExecutor,
  SpawnFunction,
} from "./Executors/ResourceExecutor";
import { startHealthServer } from "./Health";
import HeartbeatLoop from "./Heartbeat";
import IngestClient, { IngestResponse } from "./IngestClient";
import JobLoop, { JobTimings } from "./JobLoop";
import Logger from "./Logger";
import {
  AgentPosture,
  NormalizedProbe,
  PostureProbe,
  buildPosture,
} from "./Posture";
import {
  ProxySetup,
  describeProxyEnvironment,
  enableProxyFromEnvironment,
} from "./Proxy";
import { AgentIdentity, AgentSession } from "./Registration";
import { SleepFunction, sleep as defaultSleep } from "./Sleep";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  AiResourceTypeInfo,
} from "./Common/Types/ResourceAiAgent/AiResourceType";
import {
  MAX_POSTURE_STRING_LENGTH,
  RESOURCE_AI_AGENT_IMAGE_REPOSITORY,
  RESOURCE_AI_AGENT_RESOURCE_NAME_ENV,
} from "./Common/Types/ResourceAiAgent/ResourceAiAccess";

/*
 * The resource AI agent, start to finish. One process serves ONE resource
 * (ONEUPTIME_AI_AGENT_RESOURCE_TYPE and the collector's identity variable)
 * through ONE executor (ExecutorFactory).
 *
 * Start-up, in this order:
 *   1. the health server, first, so the container reports live and ready
 *      whatever happens next;
 *   2. remove the private job directories a previous life left behind (an
 *      OOM kill or a `docker kill` runs no cleanup);
 *   3. stop here, logging what is missing, when a required setting is not
 *      set — the container stays up and says so, it never restarts in a
 *      loop;
 *   4. a Host without HOST_NAME asks its executor for the host's own name
 *      — and, when that fails (nsenter slow or failing at boot), stays
 *      misconfigured and asks again, backing off, until it gets one;
 *   5. register with OneUptime (retried forever), then heartbeat and claim
 *      commands.
 *
 * Shutdown (SIGTERM on `docker stop` or `docker compose up` replacing the
 * container): stop claiming commands, heartbeating and registering, all at
 * once; wait for the command in progress to finish and report, and for any
 * heartbeat or registration already on the wire to be answered — one
 * shared grace, not one after the other — THEN tell OneUptime the agent is
 * gone (/disconnect). In that order, so nothing the server processes after
 * the sign-off marks the agent connected again and locks the replacement
 * container out for minutes. Finally remove the job directories.
 */

/*
 * Docker gives a container 10 seconds between SIGTERM and SIGKILL unless
 * the compose file sets stop_grace_period. Everything below fits inside
 * that default, so the sign-off always goes out: the grace for the command
 * in progress (and any call on the wire), a cancelled call settling, the
 * sign-off itself, then the forced exit.
 */
export const DOCKER_DEFAULT_STOP_TIMEOUT_MS: number = 10_000;

/*
 * How long shutdown waits for the command in progress to finish and report,
 * and for a heartbeat or registration on the wire to be answered. A longer
 * command is left to OneUptime to time out.
 */
export const DEFAULT_SHUTDOWN_GRACE_MS: number = 6_000;

// How long the sign-off may take.
export const DISCONNECT_TIMEOUT_MS: number = 2_000;

/*
 * When the executor could not read the resource's own name at start-up,
 * how long until it is asked again: doubling from the first wait up to the
 * last, for as long as the agent runs.
 */
export const IDENTITY_RETRY_INITIAL_MS: number = 5_000;
export const IDENTITY_RETRY_MAX_MS: number = 5 * 60_000;

/*
 * Index.ts exits after this long whatever shutdown is doing: inside
 * Docker's default stop timeout, and after the grace, a cancelled call
 * settling and the sign-off.
 */
export const FORCE_EXIT_AFTER_MS: number = 9_500;

export interface AgentOptions {
  env: NodeJS.ProcessEnv;
  // Parent of the private job directories (os.tmpdir() by default).
  tmpDir?: string | undefined;
  // Overrides PORT (tests listen on 0).
  healthPort?: number | undefined;
  // Overrides ONEUPTIME_AI_AGENT_HEALTH_HOST.
  healthHost?: string | undefined;
  sleep?: SleepFunction | undefined;
  jobTimings?: Partial<JobTimings> | undefined;
  shutdownGraceMs?: number | undefined;
  /*
   * Switch on proxy support for fetch from the environment (the default).
   * Tests that run several agents in one process turn it off.
   */
  enableProxy?: boolean | undefined;
  // Builds the executor (ExecutorFactory.createExecutor by default).
  createExecutor?: ExecutorFactoryFunction | undefined;
  // Handed to the executor (tests inject a fake spawn).
  spawnImpl?: SpawnFunction | undefined;
  // How long a posture probe's answer is reused, and how long one may take.
  probeRefreshMs?: number | undefined;
  probeTimeoutMs?: number | undefined;
}

// Why the agent could not name its resource, and whether asking again could help.
interface IdentityFailure {
  problem: string;
  retry: boolean;
}

export default class ResourceAiAgent {
  public readonly status: AgentStatus = new AgentStatus();
  public readonly config: AgentConfig;
  public readonly problems: Array<string>;
  public readonly warnings: Array<string>;

  private readonly executor: ResourceExecutor;
  private readonly postureProbe: PostureProbe;
  private client: IngestClient | null = null;
  private session: AgentSession | null = null;
  private heartbeat: HeartbeatLoop | null = null;
  private jobLoop: JobLoop | null = null;
  private healthServer: http.Server | null = null;
  private shuttingDown: Promise<void> | null = null;
  // Asking the executor for the resource's name again, after a failure.
  private identityRetry: Promise<void> | null = null;
  private readonly identityRetryAbort: AbortController = new AbortController();

  public constructor(private readonly options: AgentOptions) {
    const parsed: ParsedConfig = parseConfig(options.env);

    this.config = parsed.config;
    this.problems = parsed.problems;
    this.warnings = parsed.warnings;

    const executorOptions: ExecutorOptions = {
      config: this.config,
      env: options.env,
      tmpDir: options.tmpDir || os.tmpdir(),
      logger: Logger,
      spawnImpl: options.spawnImpl,
    };

    this.executor = (options.createExecutor || createExecutor)(executorOptions);
    this.postureProbe = new PostureProbe({
      executor: this.executor,
      refreshMs: options.probeRefreshMs,
      timeoutMs: options.probeTimeoutMs,
    });

    this.status.resourceType = this.config.resourceType;
    this.status.resourceIdentifier = this.config.resourceIdentifier;
    this.status.agentVersion = this.config.agentVersion;
  }

  public getHealthServer(): http.Server | null {
    return this.healthServer;
  }

  public getSession(): AgentSession | null {
    return this.session;
  }

  public getHeartbeat(): HeartbeatLoop | null {
    return this.heartbeat;
  }

  public getJobLoop(): JobLoop | null {
    return this.jobLoop;
  }

  public getExecutor(): ResourceExecutor {
    return this.executor;
  }

  // "Docker AI agent", "Ceph AI agent", ... ("resource AI agent" when unknown).
  public getDisplayName(): string {
    return getAgentDisplayName(this.config.resourceType);
  }

  /*
   * The posture as sent on registration and every heartbeat. Only once the
   * agent knows which resource it serves (after start() got past its
   * checks).
   */
  public async getPosture(): Promise<AgentPosture> {
    const resourceType: AiResourceType | null = this.config.resourceType;
    const resourceIdentifier: string | null = this.config.resourceIdentifier;

    if (!resourceType || !resourceIdentifier) {
      throw new Error("The agent does not know which resource it serves.");
    }

    const probe: NormalizedProbe = await this.postureProbe.get();

    return buildPosture({
      config: this.config,
      resourceType,
      resourceIdentifier,
      probe,
    });
  }

  public async start(): Promise<void> {
    Logger.info(`Starting the ${this.getDisplayName()}`, {
      resourceType: this.config.resourceType,
      resource: this.config.resourceIdentifier,
      identityFrom: this.config.identitySource,
      oneuptimeUrl: this.config.oneuptimeUrl || null,
      apiKeyFrom: this.config.apiKeySource,
      agentVersion: this.config.agentVersion,
    });

    for (const warning of this.warnings) {
      Logger.warn(warning);
    }

    if (this.options.enableProxy !== false) {
      this.setUpProxy();
    }

    this.healthServer = await startHealthServer({
      status: this.status,
      port: this.options.healthPort ?? this.config.port,
      host: this.options.healthHost ?? this.config.healthHost,
    });

    try {
      await this.executor.sweepOrphanedJobDirs();
    } catch (err: unknown) {
      Logger.warn("Could not clean up job directories from a previous run", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    this.status.ready = true;

    const resourceType: AiResourceType | null = this.config.resourceType;

    // (A missing resource type is always among the problems.)
    if (this.problems.length > 0 || !resourceType) {
      this.stayMisconfigured(this.problems);
      return;
    }

    if (!this.config.resourceIdentifier) {
      const failure: IdentityFailure | null =
        await this.resolveIdentity(resourceType);

      if (failure) {
        this.stayMisconfigured([failure.problem]);

        if (failure.retry) {
          this.identityRetry = this.retryIdentity(resourceType);
        }

        return;
      }
    }

    await this.startServing(resourceType);
  }

  /*
   * Register, heartbeat and claim commands: once the agent knows which
   * resource it serves.
   */
  private async startServing(resourceType: AiResourceType): Promise<void> {
    const posture: AgentPosture = await this.getPosture();
    this.status.posture = posture;
    this.logPosture(posture);

    this.client = new IngestClient({
      oneuptimeUrl: this.config.oneuptimeUrl,
      apiKey: this.config.apiKey,
      agentVersion: this.config.agentVersion,
    });

    const getPosture: () => Promise<AgentPosture> =
      (): Promise<AgentPosture> => {
        return this.getPosture();
      };

    this.session = new AgentSession({
      client: this.client,
      config: this.config,
      status: this.status,
      getPosture,
      sleep: this.options.sleep,
    });

    this.heartbeat = new HeartbeatLoop({
      client: this.client,
      session: this.session,
      status: this.status,
      getPosture,
      agentVersion: this.config.agentVersion,
      intervalMs: this.config.heartbeatIntervalMs,
    });

    this.jobLoop = new JobLoop({
      client: this.client,
      session: this.session,
      executor: this.executor,
      resourceType,
      status: this.status,
      pollIntervalMs: this.config.pollIntervalMs,
      timings: this.options.jobTimings,
      sleep: this.options.sleep,
    });

    void this.session.ensureRegistered();
    this.heartbeat.start();
    this.jobLoop.start();
  }

  // Idempotent: every caller shares the one shutdown.
  public shutdown(reason: string = "shutdown"): Promise<void> {
    if (!this.shuttingDown) {
      this.shuttingDown = this.runShutdown(reason);
    }

    return this.shuttingDown;
  }

  /*
   * Ask the executor for the resource's name again, waiting longer each
   * time (IDENTITY_RETRY_INITIAL_MS doubling to IDENTITY_RETRY_MAX_MS),
   * until it answers — then start serving — or the agent shuts down. A
   * slow or failing nsenter at boot must not leave a Host agent unusable
   * until someone restarts it: /status/live stays 200 throughout, so
   * nothing else would.
   */
  private async retryIdentity(resourceType: AiResourceType): Promise<void> {
    const sleep: SleepFunction = this.options.sleep || defaultSleep;
    const signal: AbortSignal = this.identityRetryAbort.signal;
    let delayMs: number = IDENTITY_RETRY_INITIAL_MS;
    let attempts: number = 1;

    try {
      while (!this.shuttingDown && !signal.aborted) {
        await sleep(delayMs, signal);

        if (this.shuttingDown || signal.aborted) {
          return;
        }

        attempts++;
        const failure: IdentityFailure | null = await this.resolveIdentity(
          resourceType,
          { quiet: true },
        );

        if (this.shuttingDown || signal.aborted) {
          return;
        }

        if (!failure) {
          this.status.configProblems = [];
          this.status.phase = "starting";
          Logger.info(
            `Read this ${AI_RESOURCE_TYPE_INFO[resourceType].displayName}'s name after ${attempts} attempts; starting.`,
          );
          await this.startServing(resourceType);
          return;
        }

        this.status.configProblems = [failure.problem];

        if (!failure.retry) {
          Logger.error(failure.problem);
          return;
        }

        delayMs = Math.min(delayMs * 2, IDENTITY_RETRY_MAX_MS);
      }
    } catch (err: unknown) {
      Logger.error("Could not start after reading the resource's name", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /*
   * The identity from the executor (a Host's own hostname), written into
   * the shared config so the executor and the posture see it too. Returns
   * the problem to report when there is none, and whether asking again
   * could help (the executor may answer next time; a name that is too long,
   * or an executor that cannot name the resource at all, will not change).
   */
  private async resolveIdentity(
    resourceType: AiResourceType,
    options: { quiet?: boolean } = {},
  ): Promise<IdentityFailure | null> {
    const info: AiResourceTypeInfo = AI_RESOURCE_TYPE_INFO[resourceType];
    const missing: string = `${info.identityEnvVars.join(" / ")} is not set, and the agent could not read this ${info.displayName}'s name itself. Set it (or ${RESOURCE_AI_AGENT_RESOURCE_NAME_ENV}) to the name the ${info.displayName}'s collector reports.`;

    if (typeof this.executor.resolveResourceIdentifier !== "function") {
      return { problem: missing, retry: false };
    }

    const retrying: string = `${missing} It asks again, less and less often, until it can.`;
    let resolved: string | null;

    try {
      resolved = await this.executor.resolveResourceIdentifier();
    } catch (err: unknown) {
      const details: Record<string, string> = {
        error: err instanceof Error ? err.message : String(err),
      };

      if (options.quiet) {
        Logger.debug(`Could not read this ${info.displayName}'s name`, details);
      } else {
        Logger.warn(`Could not read this ${info.displayName}'s name`, details);
      }

      return { problem: retrying, retry: true };
    }

    const identifier: string =
      typeof resolved === "string" ? resolved.trim() : "";

    if (!identifier) {
      return { problem: retrying, retry: true };
    }

    if (identifier.length > MAX_POSTURE_STRING_LENGTH) {
      return {
        problem: `This ${info.displayName}'s own name is ${identifier.length} characters long; OneUptime accepts at most ${MAX_POSTURE_STRING_LENGTH}. Set ${info.identityEnvVars.join(" / ")} (or ${RESOURCE_AI_AGENT_RESOURCE_NAME_ENV}) to a shorter name the collector also reports.`,
        retry: false,
      };
    }

    this.config.resourceIdentifier = identifier;
    this.config.identitySource = "executor";
    this.status.resourceIdentifier = identifier;

    Logger.info(
      `${info.identityEnvVars.join(" / ")} is not set; serving this ${info.displayName} under its own name "${identifier}". It must match the name the collector reports.`,
    );

    const placeholder: string | null = describeDefaultIdentity({
      type: resourceType,
      identifier,
      source: null,
    });

    if (placeholder) {
      Logger.warn(placeholder);
    }

    return null;
  }

  private stayMisconfigured(problems: Array<string>): void {
    this.status.phase = "misconfigured";
    this.status.configProblems = [...problems];

    for (const problem of problems) {
      Logger.error(problem);
    }

    Logger.error(
      `The ${this.getDisplayName()} cannot start until the settings above are fixed. It stays up (so the container does not restart in a loop) but does nothing.`,
    );
  }

  private async runShutdown(reason: string): Promise<void> {
    Logger.info("Shutting down", { reason });
    this.status.phase = "stopping";
    this.identityRetryAbort.abort();

    if (this.identityRetry) {
      await this.identityRetry;
    }

    const graceMs: number =
      this.options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;

    /*
     * All three stop sending at once and share the grace. The heartbeat is
     * not needed while a command finishes (the server counts an agent
     * online for minutes after its last one), and stopping it now gives a
     * heartbeat already on the wire the whole grace to be answered instead
     * of whatever is left after the command — so the sign-off below always
     * goes out before FORCE_EXIT_AFTER_MS.
     */
    const [jobFinished, heartbeatAnswered, registrationAnswered] =
      await Promise.all([
        this.jobLoop ? this.jobLoop.stop(graceMs) : Promise.resolve(true),
        this.heartbeat ? this.heartbeat.stop(graceMs) : Promise.resolve(true),
        this.session ? this.session.stop(graceMs) : Promise.resolve(true),
      ]);

    if (!jobFinished) {
      Logger.warn(
        "A command was still running at shutdown; OneUptime will time it out.",
      );
    }

    if (!heartbeatAnswered || !registrationAnswered) {
      Logger.warn(
        "OneUptime had not answered the agent's last call at shutdown, so it was cancelled. If OneUptime still handles it, the next agent container can take up to 5 minutes to connect.",
      );
    }

    const identity: AgentIdentity | null = this.session
      ? this.session.getIdentity()
      : null;

    if (this.client && identity) {
      const response: IngestResponse = await this.client.disconnect(
        identity,
        DISCONNECT_TIMEOUT_MS,
      );

      if (response.kind === "ok") {
        Logger.info("Signed off from OneUptime.");
      } else {
        Logger.warn(
          "Could not sign off from OneUptime; the agent shows offline once its heartbeats stop.",
          { answer: response.message },
        );
      }
    }

    try {
      await this.executor.removeAllJobDirs();
    } catch (err: unknown) {
      Logger.warn("Could not remove the job directories", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await this.closeHealthServer();
  }

  private closeHealthServer(): Promise<void> {
    const server: http.Server | null = this.healthServer;
    this.healthServer = null;

    if (!server) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve: () => void): void => {
      server.close((): void => {
        resolve();
      });
      server.closeAllConnections();
    });
  }

  private setUpProxy(): void {
    const setup: ProxySetup = enableProxyFromEnvironment(this.options.env);
    const settings: Record<string, string> = describeProxyEnvironment(
      this.options.env,
    );

    if (setup.support === "none") {
      return;
    }

    if (setup.support === "invalid") {
      Logger.error(
        "The proxy settings are not valid, so the agent connects to OneUptime directly. Fix HTTPS_PROXY / HTTP_PROXY in the agent's environment.",
        { ...settings, error: setup.error },
      );
      return;
    }

    if (setup.support === "unsupported") {
      Logger.warn(
        `A proxy is configured but this Node.js cannot use it for fetch. Run the ${RESOURCE_AI_AGENT_IMAGE_REPOSITORY} image, or set NODE_USE_ENV_PROXY=1.`,
        settings,
      );
      return;
    }

    Logger.info(
      "Connecting to OneUptime through the configured proxy",
      settings,
    );
  }

  private logPosture(posture: AgentPosture): void {
    const info: AiResourceTypeInfo =
      AI_RESOURCE_TYPE_INFO[posture.resourceType];

    Logger.info(`${info.displayName} access`, {
      resource: posture.resourceIdentifier,
      writes: posture.allowWrites
        ? posture.writeTargets.length > 0
          ? posture.writeTargets.join(",")
          : "any target except the protected ones"
        : "off (read-only)",
      protectedTargets: posture.protectedTargets,
      reachable: posture.reachable,
      version: posture.toolVersion || null,
    });

    if (!posture.reachable) {
      Logger.warn(
        `The agent cannot reach this ${info.displayName} right now, so its commands will fail: ${
          posture.reachError || "no reason was given"
        }`,
      );
    }
  }
}
