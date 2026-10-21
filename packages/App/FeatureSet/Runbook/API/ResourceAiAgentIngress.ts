import ResourceAiAgentAuthorization from "../Middleware/ResourceAiAgentAuthorization";
import { ResourceAiAgentExpressRequest } from "../Types/Request";
import ResourceAiAgentService, {
  ResourceAiAgentRegistrationRefusedException,
  ResourceAiAgentRegistrationResult,
} from "Common/Server/Services/ResourceAiAgentService";
import ResourceAiAgentJobService from "Common/Server/Services/ResourceAiAgentJobService";
import RunnerJobService from "Common/Server/Services/RunnerJobService";
import TelemetryIngest, {
  TelemetryRequest,
} from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import ResourceAiAgent from "Common/Models/DatabaseModels/ResourceAiAgent";
import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import StatusCode from "Common/Types/API/StatusCode";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  isAiResourceType,
} from "Common/Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "Common/Types/ResourceAiAgent/ResourceAiAccess";
import { renderResourceDisplayCommand } from "Common/Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import logger from "Common/Server/Utils/Logger";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";

/*
 * The resource AI agent's API, mounted at /resource-ai-agent-ingest.
 *
 * The agent (image oneuptime/resource-ai-agent, installed next to a Docker
 * or Podman host's, a Docker Swarm, Proxmox or Ceph cluster's, a vCenter's,
 * a database server's or a host's telemetry collector) registers with the
 * project's telemetry ingestion key, its resource type and the resource's
 * identity, gets its own id and key, and then heartbeats, claims the
 * resource commands targeted at it and reports their results — with that id
 * and key, never the ingestion key. It is not a Runner: its identity is a
 * ResourceAiAgent row, and it is only ever served AI resource commands of
 * its own resource, never a credential.
 *
 * Every route is a POST with a JSON body and a JSON answer; the wire shapes
 * are the contract with agents/ResourceAIAgent (see ResourceAiAccess.ts)
 * and must not drift:
 *
 *   /register              { agentId, agentKey, resourceId, resourceName }
 *                          | 403 { message, reason, retryAfterSeconds? }
 *   /heartbeat             { status: "ok" }
 *   /claim-next-job        { job: null } | { job: { jobId, origin, stepId,
 *                          stepType, timeoutInMs, leaseExpiresAt, payload:
 *                          ResourceCommandJobPayload } }
 *   /job/:jobId/heartbeat  { status: "ok" } | 404 { message }
 *   /job/:jobId/result     { accepted }
 *   /disconnect            { status: "ok" }
 *
 * and every authenticated route answers 401 { message } for an id/key pair
 * that is not (or no longer) valid.
 */
export default class ResourceAiAgentIngressAPI {
  public router!: ExpressRouter;

  // Why a claimed job is failed instead of served (see getClaimRefusal).
  public static readonly CREDENTIAL_REFUSAL: string =
    "This command carries a credential, and a resource AI agent runs commands only with the credentials of its own environment. It was not run.";

  public static readonly RESOURCE_MISMATCH_REFUSAL: string =
    "This command is for a different resource than this resource AI agent's, so it was not run.";

  public static readonly MISSING_RESOURCE_IDENTIFIER_REFUSAL: string =
    "This command does not name the resource it is for, so the resource AI agent did not run it.";

  public static readonly RESOURCE_IDENTIFIER_MISMATCH_REFUSAL: string =
    "This command names the resource by another identity than the one this resource AI agent registered with, so it was not run.";

  public static readonly MISSING_COMMAND_REFUSAL: string =
    "This command has nothing to run (a program and its arguments), so the resource AI agent did not run it.";

  public static readonly PROGRAM_REFUSAL: string =
    "This command starts with a program this resource AI agent does not run, so it was not run.";

  public static readonly TIER_REFUSAL: string =
    "This command carries no tier the resource AI agent may run (Read, SafeWrite or RiskyWrite), so it was not run.";

  /*
   * Payload fields that would carry a credential or point the agent at
   * something other than its resource: the agent refuses a job carrying
   * any of them (JobLoop's JOB_CREDENTIAL_FIELDS and
   * PAYLOAD_CREDENTIAL_FIELDS), and so does the server, before serving it.
   */
  public static readonly CREDENTIAL_PAYLOAD_FIELDS: ReadonlyArray<string> = [
    "credential",
    "credentialId",
    "kubernetesCredential",
    "kubernetesCredentialId",
    "kubernetesClusterId",
    "apiServerUrl",
    "token",
    "apiToken",
    "apiKey",
    "password",
    "secret",
    "privateKey",
    "caCertificate",
    "kubeconfig",
    "keyring",
    "connectionString",
  ];

  // The tiers a served job may carry: never Denied.
  private static readonly SERVABLE_TIERS: ReadonlyArray<string> = [
    ResourceCommandTier.Read,
    ResourceCommandTier.SafeWrite,
    ResourceCommandTier.RiskyWrite,
  ];

  public constructor() {
    this.router = Express.getRouter();

    /*
     * The only route the ingestion key reaches. The surface's guard refuses
     * browser keys and keys pinned to one service, and rate-limits
     * registrations by default (TelemetryIngest).
     */
    this.router.post(
      `/register`,
      TelemetryIngest.forSurface(TelemetryIngestSurface.ResourceAiAgent),
      this.register,
    );

    this.router.post(
      `/heartbeat`,
      ResourceAiAgentAuthorization.isAuthorizedAgent,
      this.heartbeat,
    );

    this.router.post(
      `/claim-next-job`,
      ResourceAiAgentAuthorization.isAuthorizedAgent,
      this.claimNextJob,
    );

    this.router.post(
      `/job/:jobId/heartbeat`,
      ResourceAiAgentAuthorization.isAuthorizedAgent,
      this.heartbeatJob,
    );

    this.router.post(
      `/job/:jobId/result`,
      ResourceAiAgentAuthorization.isAuthorizedAgent,
      this.submitJobResult,
    );

    /*
     * The agent signing off on a clean shutdown, so the container that
     * replaces it is admitted at once instead of waiting for the alive
     * window to lapse.
     */
    this.router.post(
      `/disconnect`,
      ResourceAiAgentAuthorization.isAuthorizedAgent,
      this.disconnect,
    );
  }

  public async register(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const telemetryRequest: TelemetryRequest = req as TelemetryRequest;
      const projectId: ObjectID | undefined = telemetryRequest.projectId;

      if (!projectId) {
        throw new BadDataException("Project could not be resolved.");
      }

      const body: JSONObject = (req.body as JSONObject) || {};

      const result: ResourceAiAgentRegistrationResult =
        await ResourceAiAgentService.register({
          projectId,
          resourceType: body["resourceType"],
          resourceIdentifier: body["resourceIdentifier"],
          resourceId: ResourceAiAgentIngressAPI.readString(body["resourceId"]),
          agentVersion: ResourceAiAgentIngressAPI.readString(
            body["agentVersion"],
          ),
          previousAgentKey: ResourceAiAgentIngressAPI.readString(
            body["previousAgentKey"],
          ),
          posture: body["posture"],
          ingestionKeyId: telemetryRequest.ingestionKeyPolicy?.ingestionKeyId,
        });

      return Response.sendJsonObjectResponse(req, res, {
        agentId: result.agentId.toString(),
        agentKey: result.agentKey,
        resourceId: result.resourceId.toString(),
        resourceName: result.resourceName,
      });
    } catch (err) {
      if (err instanceof ResourceAiAgentRegistrationRefusedException) {
        ResourceAiAgentIngressAPI.sendRegistrationRefusal(req, res, err);
        return;
      }

      next(err);
    }
  }

  /*
   * The 403 a refused registration answers with: the message, the
   * machine-readable reason and, for a refusal that clears on its own, when
   * to try again — in the body (retryAfterSeconds) and as a Retry-After
   * header. The generic error body is { message } only, which would leave
   * the agent unable to tell "wait" from "needs an operator".
   */
  public static sendRegistrationRefusal(
    req: ExpressRequest,
    res: ExpressResponse,
    refusal: ResourceAiAgentRegistrationRefusedException,
  ): void {
    logger.warn(
      `Resource AI agent ingress: refused a registration (${refusal.reason}): ${refusal.message}`,
    );

    const body: JSONObject = {
      message: refusal.message,
      reason: refusal.reason,
    };

    if (refusal.retryAfterSeconds !== undefined) {
      body["retryAfterSeconds"] = refusal.retryAfterSeconds;
      res.set("Retry-After", String(refusal.retryAfterSeconds));
    }

    Response.sendJsonObjectResponse(req, res, body, {
      statusCode: new StatusCode(403),
    });
  }

  public async heartbeat(
    req: ResourceAiAgentExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const agent: ResourceAiAgent =
        ResourceAiAgentIngressAPI.getAuthenticatedAgent(req);

      const body: JSONObject = (req.body as JSONObject) || {};

      await ResourceAiAgentService.heartbeat({
        agent,
        agentVersion: ResourceAiAgentIngressAPI.readString(
          body["agentVersion"],
        ),
        posture: body["posture"],
      });

      return Response.sendJsonObjectResponse(req, res, { status: "ok" });
    } catch (err) {
      next(err);
    }
  }

  public async claimNextJob(
    req: ResourceAiAgentExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const agent: ResourceAiAgent =
        ResourceAiAgentIngressAPI.getAuthenticatedAgent(req);

      if (!agent.projectId) {
        throw new BadDataException("Agent not found on request");
      }

      /*
       * Only jobs targeted at THIS agent, and only AI resource commands:
       * the authenticated agent's own id is the only thing trusted here, so
       * a leaked agent key cannot lease another resource's work.
       */
      const job: RunnerJob | null =
        await ResourceAiAgentJobService.claimNextJob({
          projectId: agent.projectId,
          resourceAiAgentId: agent.id!,
        });

      if (!job) {
        return Response.sendJsonObjectResponse(req, res, { job: null });
      }

      const refusal: string | null = ResourceAiAgentIngressAPI.getClaimRefusal({
        job,
        agent,
      });

      if (refusal) {
        /*
         * Failed, not left pending: a job this agent cannot run would
         * otherwise be claimed again on every poll until its deadline, and
         * the AI run waiting on it would learn nothing about why.
         */
        logger.warn(
          `Resource AI agent ingress: failed job ${job.id?.toString()} at claim for agent ${agent.id?.toString()}: ${refusal}`,
        );

        await RunnerJobService.submitResult({
          jobId: job.id!,
          agentId: agent.id!,
          success: false,
          errorMessage: refusal,
        });

        return Response.sendJsonObjectResponse(req, res, { job: null });
      }

      return Response.sendJsonObjectResponse(req, res, {
        job: ResourceAiAgentIngressAPI.toWireJob(job),
      });
    } catch (err) {
      next(err);
    }
  }

  public async heartbeatJob(
    req: ResourceAiAgentExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const agent: ResourceAiAgent =
        ResourceAiAgentIngressAPI.getAuthenticatedAgent(req);

      const jobId: ObjectID = ResourceAiAgentIngressAPI.getJobId(req);

      const stillOurs: boolean = await RunnerJobService.heartbeatJob({
        jobId,
        agentId: agent.id!,
      });

      if (!stillOurs) {
        // The agent must stop: the lease moved on or the job ended.
        throw new NotFoundException(
          "This job is no longer this agent's (its lease expired or it already ended).",
        );
      }

      return Response.sendJsonObjectResponse(req, res, { status: "ok" });
    } catch (err) {
      next(err);
    }
  }

  public async submitJobResult(
    req: ResourceAiAgentExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const agent: ResourceAiAgent =
        ResourceAiAgentIngressAPI.getAuthenticatedAgent(req);

      const jobId: ObjectID = ResourceAiAgentIngressAPI.getJobId(req);

      const body: JSONObject = (req.body as JSONObject) || {};
      const output: unknown = body["output"];
      const exitCode: unknown = body["exitCode"];
      const errorMessage: unknown = body["errorMessage"];

      /*
       * Which program produced the output, so the server redacts it with
       * that tool's rules too (docker inspect env values, Proxmox and govc
       * secrets, database literals, Ceph keys) whatever the agent did.
       */
      const resourceCommand:
        | { resourceType: AiResourceType; program: string }
        | undefined = await ResourceAiAgentIngressAPI.getResourceCommandOf({
        jobId,
        agent,
      });

      // Only the agent holding the lease can write it (assignedAgentId).
      const accepted: boolean = await RunnerJobService.submitResult({
        jobId,
        agentId: agent.id!,
        success: body["success"] === true,
        ...(typeof output === "string" ? { output } : {}),
        ...(typeof exitCode === "number" && Number.isFinite(exitCode)
          ? { exitCode }
          : {}),
        ...(typeof errorMessage === "string" ? { errorMessage } : {}),
        ...(resourceCommand ? { resourceCommand } : {}),
      });

      return Response.sendJsonObjectResponse(req, res, { accepted });
    } catch (err) {
      next(err);
    }
  }

  public async disconnect(
    req: ResourceAiAgentExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const agent: ResourceAiAgent =
        ResourceAiAgentIngressAPI.getAuthenticatedAgent(req);

      await ResourceAiAgentService.markDisconnected({
        resourceAiAgentId: agent.id!,
      });

      return Response.sendJsonObjectResponse(req, res, { status: "ok" });
    } catch (err) {
      next(err);
    }
  }

  /*
   * The resource type and program of a job this agent holds, for the
   * result's redaction; undefined when the agent row names no resource
   * type. A job the agent does not hold (the lease moved on) still gets the
   * agent's type — submitResult will not store anything for it anyway.
   */
  public static async getResourceCommandOf(data: {
    jobId: ObjectID;
    agent: ResourceAiAgent;
  }): Promise<{ resourceType: AiResourceType; program: string } | undefined> {
    const resourceType: unknown = data.agent.resourceType;

    if (!isAiResourceType(resourceType)) {
      return undefined;
    }

    const job: RunnerJob | null = await RunnerJobService.findOneBy({
      query: {
        _id: data.jobId.toString(),
        assignedAgentId: data.agent.id!,
      },
      select: { payload: true },
      props: { isRoot: true },
    });

    const payload: JSONObject = (job?.payload as JSONObject) || {};
    const program: unknown = payload["program"];

    return {
      resourceType,
      program: typeof program === "string" ? program.trim() : "",
    };
  }

  /*
   * Why a job the claim leased must be failed instead of served, or null
   * when it may be served. The enqueue chokepoint already refuses all of
   * these; this is the second line, at the moment the job leaves the
   * server (the agent itself is the third):
   *
   *  - the agent runs commands with the credentials of its own environment
   *    only, so a job carrying a credential (or pointing at a Kubernetes
   *    cluster) is never served — credentials are not even resolved here;
   *  - those credentials reach only the agent's own resource, so the job's
   *    resource must be the agent's, by type and id (payload and row);
   *  - the job must name the resource by the identity the agent registered
   *    with (the agent re-checks it against its own before running
   *    anything), and carry a command: a program this resource type runs,
   *    an argv of strings and a tier that is not Denied.
   */
  public static getClaimRefusal(data: {
    job: RunnerJob;
    agent: ResourceAiAgent;
  }): string | null {
    const payload: JSONObject = (data.job.payload as JSONObject) || {};

    const carriesCredential: boolean =
      ResourceAiAgentIngressAPI.CREDENTIAL_PAYLOAD_FIELDS.some(
        (field: string): boolean => {
          const value: unknown = payload[field];
          return value !== undefined && value !== null && value !== "";
        },
      );

    if (carriesCredential) {
      return ResourceAiAgentIngressAPI.CREDENTIAL_REFUSAL;
    }

    const agentResourceType: unknown = data.agent.resourceType;
    const agentResourceId: string = (
      data.agent.resourceId?.toString() || ""
    ).toLowerCase();

    const payloadResourceId: string =
      typeof payload["resourceId"] === "string"
        ? (payload["resourceId"] as string).trim().toLowerCase()
        : "";

    const rowResourceId: string = (
      data.job.resourceId?.toString() || ""
    ).toLowerCase();

    if (
      !isAiResourceType(agentResourceType) ||
      !agentResourceId ||
      payload["resourceType"] !== agentResourceType ||
      payloadResourceId !== agentResourceId ||
      (data.job.resourceType !== undefined &&
        data.job.resourceType !== null &&
        data.job.resourceType !== agentResourceType) ||
      (rowResourceId && rowResourceId !== agentResourceId) ||
      Boolean(data.job.kubernetesClusterId)
    ) {
      return ResourceAiAgentIngressAPI.RESOURCE_MISMATCH_REFUSAL;
    }

    const resourceIdentifier: unknown = payload["resourceIdentifier"];

    if (typeof resourceIdentifier !== "string" || !resourceIdentifier.trim()) {
      return ResourceAiAgentIngressAPI.MISSING_RESOURCE_IDENTIFIER_REFUSAL;
    }

    const agentIdentifier: string = (data.agent.resourceIdentifier || "")
      .trim()
      .toLowerCase();

    if (
      agentIdentifier &&
      resourceIdentifier.trim().toLowerCase() !== agentIdentifier
    ) {
      return ResourceAiAgentIngressAPI.RESOURCE_IDENTIFIER_MISMATCH_REFUSAL;
    }

    const program: unknown = payload["program"];
    const args: unknown = payload["args"];

    if (
      typeof program !== "string" ||
      !program.trim() ||
      !Array.isArray(args) ||
      !args.every((arg: unknown): boolean => {
        return typeof arg === "string";
      })
    ) {
      return ResourceAiAgentIngressAPI.MISSING_COMMAND_REFUSAL;
    }

    if (!AI_RESOURCE_TYPE_INFO[agentResourceType].programs.includes(program)) {
      return ResourceAiAgentIngressAPI.PROGRAM_REFUSAL;
    }

    const tier: unknown = payload["tier"];

    if (
      typeof tier !== "string" ||
      !ResourceAiAgentIngressAPI.SERVABLE_TIERS.includes(tier)
    ) {
      return ResourceAiAgentIngressAPI.TIER_REFUSAL;
    }

    return null;
  }

  /*
   * The claimed job as the agent receives it. The payload is rebuilt from
   * the fields the contract names (ResourceCommandJobPayload) — never
   * passed through — so nothing else a payload might carry reaches the
   * agent. Only called for a job getClaimRefusal let through.
   */
  public static toWireJob(job: RunnerJob): JSONObject {
    const payload: JSONObject = (job.payload as JSONObject) || {};
    const program: string = String(payload["program"]);
    const args: Array<string> = (payload["args"] as Array<string>).slice();

    const wirePayload: JSONObject = {
      resourceType: String(payload["resourceType"]),
      resourceId: String(payload["resourceId"]),
      resourceIdentifier: String(payload["resourceIdentifier"]),
      program,
      args,
      displayCommand:
        typeof payload["displayCommand"] === "string" &&
        payload["displayCommand"].trim()
          ? payload["displayCommand"]
          : renderResourceDisplayCommand([program, ...args]),
      tier: String(payload["tier"]),
    };

    return {
      jobId: job.id!.toString(),
      origin: job.origin!,
      stepId: job.stepId!,
      stepType: job.stepType!,
      timeoutInMs: job.timeoutInMs!,
      leaseExpiresAt: job.leaseExpiresAt
        ? job.leaseExpiresAt.toISOString()
        : null,
      payload: wirePayload,
    };
  }

  private static getAuthenticatedAgent(
    req: ResourceAiAgentExpressRequest,
  ): ResourceAiAgent {
    const agent: ResourceAiAgent | undefined = req.resourceAiAgent;

    if (!agent || !agent.id) {
      throw new BadDataException("Agent not found on request");
    }

    return agent;
  }

  /*
   * The :jobId of a job route. Every id the agent has came from a claim, so
   * one that is not a UUID is a misbuilt client: a 400 that says so, rather
   * than a database error.
   */
  private static getJobId(req: ExpressRequest): ObjectID {
    const jobId: string | undefined = req.params["jobId"];

    if (!jobId || !ObjectID.isValidUUID(jobId)) {
      throw new BadDataException("jobId is not a valid job id.");
    }

    return new ObjectID(jobId);
  }

  // A non-empty string from the body, else undefined.
  private static readString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }
}
