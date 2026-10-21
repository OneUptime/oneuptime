import KubernetesAiAgentAuthorization from "../Middleware/KubernetesAiAgentAuthorization";
import { KubernetesAiAgentExpressRequest } from "../Types/Request";
import KubernetesAiAgentService, {
  KubernetesAiAgentRegistrationRefusedException,
  KubernetesAiAgentRegistrationResult,
} from "Common/Server/Services/KubernetesAiAgentService";
import KubernetesAiAgentJobService from "Common/Server/Services/KubernetesAiAgentJobService";
import RunnerJobService from "Common/Server/Services/RunnerJobService";
import TelemetryIngest, {
  TelemetryRequest,
} from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import KubernetesAiAgent from "Common/Models/DatabaseModels/KubernetesAiAgent";
import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import StatusCode from "Common/Types/API/StatusCode";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";

/*
 * The Kubernetes AI agent's API, mounted at /kubernetes-ai-agent-ingest.
 *
 * The agent (image oneuptime/kubernetes-ai-agent, installed by the
 * kubernetes-agent chart) registers with the project's telemetry ingestion
 * key and its cluster's name, gets its own id and key, and then heartbeats,
 * claims the kubectl jobs targeted at it and reports their results — with
 * that id and key, never the ingestion key. It is not a Runner: its identity
 * is a KubernetesAiAgent row, and it is only ever served AI kubectl jobs of
 * its own cluster, never a credential.
 *
 * Every route is a POST with a JSON body and a JSON answer; the wire shapes
 * are the contract with agents/KubernetesAIAgent and must not drift:
 *
 *   /register              { agentId, agentKey, clusterId }
 *                          | 403 { message, reason, retryAfterSeconds? }
 *   /heartbeat             { status: "ok" }
 *   /claim-next-job        { job: null } | { job: { jobId, origin, stepId,
 *                          stepType, timeoutInMs, leaseExpiresAt, payload } }
 *   /job/:jobId/heartbeat  { status: "ok" } | 404 { message }
 *   /job/:jobId/result     { accepted }
 *   /disconnect            { status: "ok" }
 *
 * and every authenticated route answers 401 { message } for an id/key pair
 * that is not (or no longer) valid.
 */
export default class KubernetesAiAgentIngressAPI {
  public router!: ExpressRouter;

  // Why a claimed job is failed instead of served (see getClaimRefusal).
  public static readonly CREDENTIAL_REFUSAL: string =
    "This kubectl command names a Kubernetes credential, and the Kubernetes AI agent runs kubectl only with its own ServiceAccount. It was not run.";

  public static readonly CLUSTER_MISMATCH_REFUSAL: string =
    "This kubectl command is for a different cluster than this Kubernetes AI agent's, so it was not run.";

  public static readonly MISSING_CLUSTER_IDENTIFIER_REFUSAL: string =
    "This kubectl command does not name the cluster it is for, so the Kubernetes AI agent did not run it.";

  public static readonly MISSING_ARGS_REFUSAL: string =
    "This kubectl command has nothing to run, so the Kubernetes AI agent did not run it.";

  public constructor() {
    this.router = Express.getRouter();

    /*
     * The only route the ingestion key reaches. The surface's guard refuses
     * browser keys and keys pinned to one service, and rate-limits
     * registrations by default (TelemetryIngest).
     */
    this.router.post(
      `/register`,
      TelemetryIngest.forSurface(TelemetryIngestSurface.KubernetesAiAgent),
      this.register,
    );

    this.router.post(
      `/heartbeat`,
      KubernetesAiAgentAuthorization.isAuthorizedAgent,
      this.heartbeat,
    );

    this.router.post(
      `/claim-next-job`,
      KubernetesAiAgentAuthorization.isAuthorizedAgent,
      this.claimNextJob,
    );

    this.router.post(
      `/job/:jobId/heartbeat`,
      KubernetesAiAgentAuthorization.isAuthorizedAgent,
      this.heartbeatJob,
    );

    this.router.post(
      `/job/:jobId/result`,
      KubernetesAiAgentAuthorization.isAuthorizedAgent,
      this.submitJobResult,
    );

    /*
     * The agent signing off on a clean shutdown, so the pod that replaces
     * it (a helm upgrade, a rollout) is admitted at once instead of waiting
     * for the alive window to lapse.
     */
    this.router.post(
      `/disconnect`,
      KubernetesAiAgentAuthorization.isAuthorizedAgent,
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

      const result: KubernetesAiAgentRegistrationResult =
        await KubernetesAiAgentService.register({
          projectId,
          clusterName: body["clusterName"],
          agentVersion: KubernetesAiAgentIngressAPI.readString(
            body["agentVersion"],
          ),
          previousAgentKey: KubernetesAiAgentIngressAPI.readString(
            body["previousAgentKey"],
          ),
          posture: body["posture"],
          ingestionKeyId: telemetryRequest.ingestionKeyPolicy?.ingestionKeyId,
        });

      return Response.sendJsonObjectResponse(req, res, {
        agentId: result.agentId.toString(),
        agentKey: result.agentKey,
        clusterId: result.clusterId.toString(),
      });
    } catch (err) {
      if (err instanceof KubernetesAiAgentRegistrationRefusedException) {
        KubernetesAiAgentIngressAPI.sendRegistrationRefusal(req, res, err);
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
    refusal: KubernetesAiAgentRegistrationRefusedException,
  ): void {
    logger.warn(
      `Kubernetes AI agent ingress: refused a registration (${refusal.reason}): ${refusal.message}`,
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
    req: KubernetesAiAgentExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const agent: KubernetesAiAgent =
        KubernetesAiAgentIngressAPI.getAuthenticatedAgent(req);

      const body: JSONObject = (req.body as JSONObject) || {};

      await KubernetesAiAgentService.heartbeat({
        agent,
        agentVersion: KubernetesAiAgentIngressAPI.readString(
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
    req: KubernetesAiAgentExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const agent: KubernetesAiAgent =
        KubernetesAiAgentIngressAPI.getAuthenticatedAgent(req);

      if (!agent.projectId) {
        throw new BadDataException("Agent not found on request");
      }

      /*
       * Only jobs targeted at THIS agent, and only AI kubectl jobs: the
       * authenticated agent's own id is the only thing trusted here, so a
       * leaked agent key cannot lease another cluster's work.
       */
      const job: RunnerJob | null =
        await KubernetesAiAgentJobService.claimNextJob({
          projectId: agent.projectId,
          kubernetesAiAgentId: agent.id!,
        });

      if (!job) {
        return Response.sendJsonObjectResponse(req, res, { job: null });
      }

      const refusal: string | null =
        KubernetesAiAgentIngressAPI.getClaimRefusal({ job, agent });

      if (refusal) {
        /*
         * Failed, not left pending: a job this agent cannot run would
         * otherwise be claimed again on every poll until its deadline, and
         * the AI run waiting on it would learn nothing about why.
         */
        logger.warn(
          `Kubernetes AI agent ingress: failed job ${job.id?.toString()} at claim for agent ${agent.id?.toString()}: ${refusal}`,
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
        job: KubernetesAiAgentIngressAPI.toWireJob(job),
      });
    } catch (err) {
      next(err);
    }
  }

  public async heartbeatJob(
    req: KubernetesAiAgentExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const agent: KubernetesAiAgent =
        KubernetesAiAgentIngressAPI.getAuthenticatedAgent(req);

      const jobId: ObjectID = KubernetesAiAgentIngressAPI.getJobId(req);

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
    req: KubernetesAiAgentExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const agent: KubernetesAiAgent =
        KubernetesAiAgentIngressAPI.getAuthenticatedAgent(req);

      const jobId: ObjectID = KubernetesAiAgentIngressAPI.getJobId(req);

      const body: JSONObject = (req.body as JSONObject) || {};
      const output: unknown = body["output"];
      const exitCode: unknown = body["exitCode"];
      const errorMessage: unknown = body["errorMessage"];

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
      });

      return Response.sendJsonObjectResponse(req, res, { accepted });
    } catch (err) {
      next(err);
    }
  }

  public async disconnect(
    req: KubernetesAiAgentExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const agent: KubernetesAiAgent =
        KubernetesAiAgentIngressAPI.getAuthenticatedAgent(req);

      await KubernetesAiAgentService.markDisconnected({
        kubernetesAiAgentId: agent.id!,
      });

      return Response.sendJsonObjectResponse(req, res, { status: "ok" });
    } catch (err) {
      next(err);
    }
  }

  /*
   * Why a job the claim leased must be failed instead of served, or null
   * when it may be served. The enqueue chokepoint already refuses all of
   * these; this is the second line, at the moment the job leaves the
   * server:
   *
   *  - the agent runs kubectl with its own ServiceAccount only, so a job
   *    naming a credential is never served (the agent registers with the
   *    telemetry ingestion key; it must never be handed credential
   *    material, and it never is — credentials are not even resolved here);
   *  - that ServiceAccount reaches only the agent's own cluster, so the
   *    job's cluster must be the agent's cluster, by id;
   *  - the job must name its cluster (the agent re-checks the name against
   *    its own before running anything) and carry a command.
   */
  public static getClaimRefusal(data: {
    job: RunnerJob;
    agent: KubernetesAiAgent;
  }): string | null {
    const payload: JSONObject = (data.job.payload as JSONObject) || {};
    const credentialId: unknown = payload["credentialId"];

    if (
      credentialId !== undefined &&
      credentialId !== null &&
      credentialId !== ""
    ) {
      return KubernetesAiAgentIngressAPI.CREDENTIAL_REFUSAL;
    }

    const agentClusterId: string = (
      data.agent.kubernetesClusterId?.toString() || ""
    ).toLowerCase();

    const payloadClusterId: string =
      typeof payload["kubernetesClusterId"] === "string"
        ? (payload["kubernetesClusterId"] as string).trim().toLowerCase()
        : "";

    const rowClusterId: string = (
      data.job.kubernetesClusterId?.toString() || ""
    ).toLowerCase();

    if (
      !agentClusterId ||
      payloadClusterId !== agentClusterId ||
      (rowClusterId && rowClusterId !== agentClusterId)
    ) {
      return KubernetesAiAgentIngressAPI.CLUSTER_MISMATCH_REFUSAL;
    }

    const clusterIdentifier: unknown = payload["clusterIdentifier"];

    if (typeof clusterIdentifier !== "string" || !clusterIdentifier.trim()) {
      return KubernetesAiAgentIngressAPI.MISSING_CLUSTER_IDENTIFIER_REFUSAL;
    }

    const args: unknown = payload["args"];

    if (
      !Array.isArray(args) ||
      args.length === 0 ||
      !args.every((arg: unknown): boolean => {
        return typeof arg === "string";
      })
    ) {
      return KubernetesAiAgentIngressAPI.MISSING_ARGS_REFUSAL;
    }

    return null;
  }

  /*
   * The claimed job as the agent receives it. The payload is rebuilt from
   * the fields the contract names — never passed through — so nothing else
   * a payload might carry reaches the pod.
   */
  public static toWireJob(job: RunnerJob): JSONObject {
    const payload: JSONObject = (job.payload as JSONObject) || {};

    const wirePayload: JSONObject = {
      args: payload["args"] as Array<string>,
      kubernetesClusterId: String(payload["kubernetesClusterId"]),
      clusterIdentifier: String(payload["clusterIdentifier"]),
    };

    if (typeof payload["displayCommand"] === "string") {
      wirePayload["displayCommand"] = payload["displayCommand"];
    }

    if (typeof payload["tier"] === "string") {
      wirePayload["tier"] = payload["tier"];
    }

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
    req: KubernetesAiAgentExpressRequest,
  ): KubernetesAiAgent {
    const agent: KubernetesAiAgent | undefined = req.kubernetesAiAgent;

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
