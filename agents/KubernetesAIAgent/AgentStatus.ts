import { AgentPosture } from "./Posture";

/*
 * What the agent knows about itself right now, for GET /status: the first
 * place to look (with `kubectl logs -l component=ai-agent`) when the
 * cluster's AI agent page says the agent is not connected. Written by the
 * loops, read by the health server. Never holds the agent key or the API
 * key.
 */

export type AgentPhase =
  // Starting up; nothing sent yet.
  | "starting"
  // A required setting is missing; the agent does nothing until fixed.
  | "misconfigured"
  // Trying to register (or re-register) with OneUptime.
  | "registering"
  // Registered: heartbeating and taking kubectl jobs.
  | "connected"
  // Shutting down.
  | "stopping";

export interface AgentStatusSnapshot {
  phase: AgentPhase;
  registered: boolean;
  agentId: string | null;
  clusterName: string | null;
  agentVersion: string | null;
  lastRegisteredAt: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  // OneUptime answered like a server without the Kubernetes AI agent API.
  apiMissing: boolean;
  configProblems: Array<string>;
  inCluster: boolean | null;
  allowWrites: boolean | null;
  allowNodeOperations: boolean | null;
  writeNamespaces: Array<string> | null;
  podNamespace: string | null;
  kubectlVersion: string | null;
  runningJobId: string | null;
  jobsRun: number;
  lastJobAt: string | null;
  uptimeSeconds: number;
}

function toIso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

export default class AgentStatus {
  public phase: AgentPhase = "starting";
  public agentId: string | null = null;
  public clusterName: string | null = null;
  public agentVersion: string | null = null;
  public lastRegisteredAt: Date | null = null;
  public lastHeartbeatAt: Date | null = null;
  public lastError: string | null = null;
  public lastErrorAt: Date | null = null;
  public apiMissing: boolean = false;
  public configProblems: Array<string> = [];
  public posture: AgentPosture | null = null;
  public runningJobId: string | null = null;
  public jobsRun: number = 0;
  public lastJobAt: Date | null = null;
  /*
   * Set once the health server listens and start-up housekeeping is done.
   * Readiness never waits for registration.
   */
  public ready: boolean = false;

  public constructor(private readonly startedAt: Date = new Date()) {}

  public recordError(message: string, at: Date = new Date()): void {
    this.lastError = message;
    this.lastErrorAt = at;
  }

  public recordRegistered(data: { agentId: string; at?: Date }): void {
    this.phase = "connected";
    this.agentId = data.agentId;
    this.lastRegisteredAt = data.at || new Date();
    this.apiMissing = false;
    this.lastError = null;
    this.lastErrorAt = null;
  }

  public snapshot(now: Date = new Date()): AgentStatusSnapshot {
    return {
      phase: this.phase,
      registered: this.phase === "connected",
      agentId: this.agentId,
      clusterName: this.clusterName,
      agentVersion: this.agentVersion,
      lastRegisteredAt: toIso(this.lastRegisteredAt),
      lastHeartbeatAt: toIso(this.lastHeartbeatAt),
      lastError: this.lastError,
      lastErrorAt: toIso(this.lastErrorAt),
      apiMissing: this.apiMissing,
      configProblems: [...this.configProblems],
      inCluster: this.posture ? this.posture.inCluster : null,
      allowWrites: this.posture ? this.posture.allowWrites : null,
      allowNodeOperations: this.posture
        ? this.posture.allowNodeOperations
        : null,
      writeNamespaces: this.posture ? [...this.posture.writeNamespaces] : null,
      podNamespace: this.posture?.podNamespace || null,
      kubectlVersion: this.posture?.kubectlVersion || null,
      runningJobId: this.runningJobId,
      jobsRun: this.jobsRun,
      lastJobAt: toIso(this.lastJobAt),
      uptimeSeconds: Math.max(
        0,
        Math.round((now.getTime() - this.startedAt.getTime()) / 1000),
      ),
    };
  }
}
