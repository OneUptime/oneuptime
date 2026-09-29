import { AgentPosture } from "./Posture";
import AiResourceType from "./Common/Types/ResourceAiAgent/AiResourceType";

/*
 * What the agent knows about itself right now, for GET /status: the first
 * place to look (with `docker logs`) when the resource's AI agent page says
 * the agent is not connected. Written by the loops, read by the health
 * server. Never holds the agent key or the API key.
 */

export type AgentPhase =
  // Starting up; nothing sent yet.
  | "starting"
  // A required setting is missing; the agent does nothing until fixed.
  | "misconfigured"
  // Trying to register (or re-register) with OneUptime.
  | "registering"
  // Registered: heartbeating and taking commands.
  | "connected"
  // Shutting down.
  | "stopping";

export interface AgentStatusSnapshot {
  phase: AgentPhase;
  registered: boolean;
  agentId: string | null;
  resourceType: AiResourceType | null;
  resourceIdentifier: string | null;
  // The OneUptime resource this agent was registered for, once known.
  resourceId: string | null;
  resourceName: string | null;
  agentVersion: string | null;
  lastRegisteredAt: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  // OneUptime answered like a server without the resource AI agent API.
  apiMissing: boolean;
  configProblems: Array<string>;
  allowWrites: boolean | null;
  writeTargets: Array<string> | null;
  protectedTargets: Array<string> | null;
  toolVersion: string | null;
  reachable: boolean | null;
  reachError: string | null;
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
  public resourceType: AiResourceType | null = null;
  public resourceIdentifier: string | null = null;
  public resourceId: string | null = null;
  public resourceName: string | null = null;
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

  public recordRegistered(data: {
    agentId: string;
    resourceId?: string | null | undefined;
    resourceName?: string | null | undefined;
    at?: Date | undefined;
  }): void {
    this.phase = "connected";
    this.agentId = data.agentId;
    this.resourceId = data.resourceId ?? null;
    this.resourceName = data.resourceName ?? null;
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
      resourceType: this.resourceType,
      resourceIdentifier: this.resourceIdentifier,
      resourceId: this.resourceId,
      resourceName: this.resourceName,
      agentVersion: this.agentVersion,
      lastRegisteredAt: toIso(this.lastRegisteredAt),
      lastHeartbeatAt: toIso(this.lastHeartbeatAt),
      lastError: this.lastError,
      lastErrorAt: toIso(this.lastErrorAt),
      apiMissing: this.apiMissing,
      configProblems: [...this.configProblems],
      allowWrites: this.posture ? this.posture.allowWrites : null,
      writeTargets: this.posture ? [...this.posture.writeTargets] : null,
      protectedTargets: this.posture
        ? [...this.posture.protectedTargets]
        : null,
      toolVersion: this.posture?.toolVersion || null,
      reachable: this.posture ? this.posture.reachable : null,
      reachError: this.posture?.reachError || null,
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
