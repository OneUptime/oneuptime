import http from "http";
import AgentStatus from "./AgentStatus";
import { AgentConfig, ParsedConfig, parseConfig } from "./Config";
import { startHealthServer } from "./Health";
import HeartbeatLoop from "./Heartbeat";
import IngestClient, { IngestResponse } from "./IngestClient";
import JobLoop, { JobTimings } from "./JobLoop";
import KubectlExecutor from "./KubectlExecutor";
import Logger from "./Logger";
import {
  AgentPosture,
  DEFAULT_SERVICE_ACCOUNT_PATHS,
  KubectlVersionProbe,
  ServiceAccountPaths,
  buildPosture,
  resolvePodNamespace,
} from "./Posture";
import {
  ProxySetup,
  describeProxyEnvironment,
  enableProxyFromEnvironment,
} from "./Proxy";
import { AgentIdentity, AgentSession } from "./Registration";
import { SleepFunction } from "./Sleep";
import { KUBERNETES_AI_AGENT_DISPLAY_NAME } from "./Common/Types/Kubernetes/KubernetesClusterAiAccess";

/*
 * The Kubernetes AI agent, start to finish.
 *
 * Start-up, in this order:
 *   1. the health server, first, so the pod reports live and ready whatever
 *      happens next;
 *   2. remove the private kubectl directories a previous life of the pod
 *      left behind (an OOM kill or node drain runs no cleanup);
 *   3. stop here, logging what is missing, when a required setting is not
 *      set — the pod stays up and says so, it never crash-loops;
 *   4. register with OneUptime (retried forever), then heartbeat and claim
 *      kubectl jobs.
 *
 * Shutdown (SIGTERM on a rollout or helm upgrade): stop claiming jobs,
 * heartbeating and registering, all at once; wait for the job in progress
 * to finish and report, and for any heartbeat or registration already on
 * the wire to be answered — one shared grace of ~20s, not one after the
 * other — THEN tell OneUptime the agent is gone (/disconnect). In that
 * order, so nothing the server processes after the sign-off marks the
 * agent connected again and locks the replacement pod out for minutes.
 * Finally remove the kubectl directories.
 */

/*
 * How long shutdown waits for the job in progress to finish and report,
 * and for a heartbeat or registration on the wire to be answered.
 */
export const DEFAULT_SHUTDOWN_GRACE_MS: number = 20_000;

// How long the sign-off may take.
export const DISCONNECT_TIMEOUT_MS: number = 5_000;

/*
 * Index.ts exits after this long whatever shutdown is doing: inside the
 * pod's default 30s between SIGTERM and SIGKILL, and after the grace, a
 * cancelled call settling and the sign-off, so a slow shutdown still signs
 * off before it is cut short.
 */
export const FORCE_EXIT_AFTER_MS: number = 27_000;

export interface AgentOptions {
  env: NodeJS.ProcessEnv;
  serviceAccount?: ServiceAccountPaths | undefined;
  kubectlBinary?: string | undefined;
  // Parent of the private kubectl job directories (os.tmpdir() by default).
  tmpDir?: string | undefined;
  // Overrides PORT (tests listen on 0).
  healthPort?: number | undefined;
  healthHost?: string | undefined;
  sleep?: SleepFunction | undefined;
  jobTimings?: Partial<JobTimings> | undefined;
  shutdownGraceMs?: number | undefined;
  /*
   * Switch on proxy support for fetch from the environment (the default).
   * Tests that run several agents in one process turn it off.
   */
  enableProxy?: boolean | undefined;
}

export default class KubernetesAiAgent {
  public readonly status: AgentStatus = new AgentStatus();
  public readonly config: AgentConfig;
  public readonly problems: Array<string>;
  public readonly warnings: Array<string>;

  private readonly serviceAccount: ServiceAccountPaths;
  private readonly executor: KubectlExecutor;
  private readonly kubectlVersion: KubectlVersionProbe;
  private client: IngestClient | null = null;
  private session: AgentSession | null = null;
  private heartbeat: HeartbeatLoop | null = null;
  private jobLoop: JobLoop | null = null;
  private healthServer: http.Server | null = null;
  private shuttingDown: Promise<void> | null = null;

  public constructor(private readonly options: AgentOptions) {
    const parsed: ParsedConfig = parseConfig(options.env);

    this.config = parsed.config;
    this.problems = parsed.problems;
    this.warnings = parsed.warnings;
    this.serviceAccount =
      options.serviceAccount || DEFAULT_SERVICE_ACCOUNT_PATHS;
    this.kubectlVersion = new KubectlVersionProbe({
      binary: options.kubectlBinary,
      path: options.env["PATH"],
    });

    this.executor = new KubectlExecutor({
      clusterName: this.config.clusterName,
      allowWrites: this.config.allowWrites,
      allowWritesSetting: this.config.allowWritesSetting,
      allowNodeOperations: this.config.allowNodeOperations,
      allowNodeOperationsSetting: this.config.allowNodeOperationsSetting,
      writeNamespaces: this.config.writeNamespaces,
      podNamespace: resolvePodNamespace({
        configured: this.config.podNamespace,
        serviceAccount: this.serviceAccount,
      }),
      env: options.env,
      serviceAccount: this.serviceAccount,
      kubectlBinary: options.kubectlBinary,
      tmpDir: options.tmpDir,
    });

    this.status.clusterName = this.config.clusterName || null;
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

  public getExecutor(): KubectlExecutor {
    return this.executor;
  }

  public async getPosture(): Promise<AgentPosture> {
    return buildPosture({
      config: this.config,
      env: this.options.env,
      serviceAccount: this.serviceAccount,
      kubectlVersion: await this.kubectlVersion.detect(),
    });
  }

  public async start(): Promise<void> {
    Logger.info(`Starting the ${KUBERNETES_AI_AGENT_DISPLAY_NAME}`, {
      cluster: this.config.clusterName || null,
      oneuptimeUrl: this.config.oneuptimeUrl || null,
      agentVersion: this.config.agentVersion,
      chartVersion: this.config.chartVersion,
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
      host: this.options.healthHost,
    });

    const swept: number = this.executor.sweepOrphanedJobDirs();

    if (swept > 0) {
      Logger.info("Removed kubectl directories a previous run left behind", {
        removed: swept,
      });
    }

    this.status.ready = true;

    if (this.problems.length > 0) {
      this.status.phase = "misconfigured";
      this.status.configProblems = [...this.problems];

      for (const problem of this.problems) {
        Logger.error(problem);
      }

      Logger.error(
        "The Kubernetes AI agent cannot start until the settings above are fixed. It stays up (so the chart's rollout does not fail) but does nothing.",
      );
      return;
    }

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

  private async runShutdown(reason: string): Promise<void> {
    Logger.info("Shutting down", { reason });
    this.status.phase = "stopping";

    const graceMs: number =
      this.options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;

    /*
     * All three stop sending at once and share the grace. The heartbeat is
     * not needed while a job finishes (the server counts an agent online
     * for minutes after its last one), and stopping it now gives a
     * heartbeat already on the wire the whole grace to be answered instead
     * of whatever is left after the job — so the sign-off below always
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
        "A kubectl job was still running at shutdown; OneUptime will time it out.",
      );
    }

    if (!heartbeatAnswered || !registrationAnswered) {
      Logger.warn(
        "OneUptime had not answered the agent's last call at shutdown, so it was cancelled. If OneUptime still handles it, the next agent pod can take up to 5 minutes to connect.",
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

    this.executor.removeAllJobDirs();

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
        "The proxy settings are not valid, so the agent connects to OneUptime directly. Fix HTTPS_PROXY / HTTP_PROXY in aiAgent.extraEnv.",
        { ...settings, error: setup.error },
      );
      return;
    }

    if (setup.support === "unsupported") {
      Logger.warn(
        "A proxy is configured but this Node.js cannot use it for fetch. Run the oneuptime/kubernetes-ai-agent image, or set NODE_USE_ENV_PROXY=1.",
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
    Logger.info("Cluster access", {
      inCluster: posture.inCluster,
      writes: posture.allowWrites
        ? posture.writeNamespaces.length > 0
          ? posture.writeNamespaces.join(",")
          : "whole cluster"
        : "off (read-only)",
      nodeOperations: posture.allowNodeOperations,
      podNamespace: posture.podNamespace || null,
      kubectl: posture.kubectlVersion || null,
    });

    if (!posture.inCluster) {
      Logger.warn(
        "This agent is not running as a pod with a mounted ServiceAccount token (KUBERNETES_SERVICE_HOST/PORT or the token is missing), so it will refuse every kubectl command. Run it through the Kubernetes agent chart.",
      );
    }

    if (!posture.kubectlVersion) {
      Logger.warn(
        "kubectl was not found on PATH; every kubectl command will fail. Use the oneuptime/kubernetes-ai-agent image.",
      );
    }
  }
}
