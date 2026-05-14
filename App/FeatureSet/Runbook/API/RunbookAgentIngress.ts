import RunbookAgentAuthorization from "../Middleware/RunbookAgentAuthorization";
import { RunbookAgentExpressRequest } from "../Types/Request";
import RunbookAgentService from "Common/Server/Services/RunbookAgentService";
import RunbookAgentJobService from "Common/Server/Services/RunbookAgentJobService";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import ObjectID from "Common/Types/ObjectID";
import Version from "Common/Types/Version";
import { JSONObject } from "Common/Types/JSON";
import RunbookAgent from "Common/Models/DatabaseModels/RunbookAgent";
import RunbookAgentJob from "Common/Models/DatabaseModels/RunbookAgentJob";
import Express, {
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";

export default class RunbookAgentIngressAPI {
  public router!: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();

    this.router.post(
      `/heartbeat`,
      RunbookAgentAuthorization.isAuthorizedAgent,
      this.heartbeat,
    );

    this.router.post(
      `/claim-next-job`,
      RunbookAgentAuthorization.isAuthorizedAgent,
      this.claimNextJob,
    );

    this.router.post(
      `/job/:jobId/heartbeat`,
      RunbookAgentAuthorization.isAuthorizedAgent,
      this.heartbeatJob,
    );

    this.router.post(
      `/job/:jobId/result`,
      RunbookAgentAuthorization.isAuthorizedAgent,
      this.submitJobResult,
    );
  }

  public async heartbeat(
    req: RunbookAgentExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const agent: RunbookAgent | undefined = req.runbookAgent;
      if (!agent || !agent.id) {
        throw new BadDataException("Agent not found on request");
      }

      const body: JSONObject = (req.body as JSONObject) || {};
      const versionRaw: unknown = body["agentVersion"];
      const hostInfoRaw: unknown = body["hostInfo"];

      const versionValue: Version | undefined =
        typeof versionRaw === "string" && versionRaw.length > 0
          ? new Version(versionRaw)
          : undefined;

      const hostInfoValue: JSONObject | undefined =
        hostInfoRaw && typeof hostInfoRaw === "object"
          ? (hostInfoRaw as JSONObject)
          : undefined;

      await RunbookAgentService.heartbeat({
        agentId: agent.id,
        ...(versionValue ? { agentVersion: versionValue } : {}),
        ...(hostInfoValue ? { hostInfo: hostInfoValue } : {}),
      });

      return Response.sendJsonObjectResponse(req, res, { status: "ok" });
    } catch (err) {
      next(err);
    }
  }

  public async claimNextJob(
    req: RunbookAgentExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const agent: RunbookAgent | undefined = req.runbookAgent;
      if (!agent || !agent.id || !agent.projectId) {
        throw new BadDataException("Agent not found on request");
      }

      /*
       * Authoritative source of truth for an agent's tags is the DB row,
       * not what the agent claims in the request. This prevents a leaked
       * key from being used to claim jobs the agent isn't tagged for.
       */
      const rawTags: unknown = agent.tags;
      const tags: Array<string> = Array.isArray(rawTags)
        ? rawTags.filter((t: unknown): t is string => {
            return typeof t === "string" && t.length > 0;
          })
        : [];

      if (tags.length === 0) {
        return Response.sendJsonObjectResponse(req, res, { job: null });
      }

      const job: RunbookAgentJob | null =
        await RunbookAgentJobService.claimNextJob({
          agentId: agent.id,
          projectId: agent.projectId,
          agentTags: tags,
        });

      if (!job) {
        return Response.sendJsonObjectResponse(req, res, { job: null });
      }

      return Response.sendJsonObjectResponse(req, res, {
        job: {
          jobId: job.id?.toString(),
          runbookExecutionId: job.runbookExecutionId?.toString(),
          stepId: job.stepId,
          stepType: job.stepType,
          script: job.script,
          timeoutInMs: job.timeoutInMs,
          leaseExpiresAt: job.leaseExpiresAt?.toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  }

  public async heartbeatJob(
    req: RunbookAgentExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const agent: RunbookAgent | undefined = req.runbookAgent;
      if (!agent || !agent.id) {
        throw new BadDataException("Agent not found on request");
      }
      const jobIdRaw: string | undefined = req.params["jobId"];
      if (!jobIdRaw) {
        throw new BadDataException("jobId is required");
      }

      const stillOurs: boolean = await RunbookAgentJobService.heartbeatJob({
        jobId: new ObjectID(jobIdRaw),
        agentId: agent.id,
      });

      if (!stillOurs) {
        // Tell the agent to stop executing; lease was revoked.
        throw new NotFoundException(
          "Job is no longer owned by this agent (lease expired or job terminated).",
        );
      }

      return Response.sendJsonObjectResponse(req, res, { status: "ok" });
    } catch (err) {
      next(err);
    }
  }

  public async submitJobResult(
    req: RunbookAgentExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const agent: RunbookAgent | undefined = req.runbookAgent;
      if (!agent || !agent.id) {
        throw new BadDataException("Agent not found on request");
      }
      const jobIdRaw: string | undefined = req.params["jobId"];
      if (!jobIdRaw) {
        throw new BadDataException("jobId is required");
      }

      const body: JSONObject = (req.body as JSONObject) || {};
      const success: boolean = body["success"] === true;
      const outputRaw: unknown = body["output"];
      const exitCodeRaw: unknown = body["exitCode"];
      const errorMessageRaw: unknown = body["errorMessage"];

      const accepted: boolean = await RunbookAgentJobService.submitResult({
        jobId: new ObjectID(jobIdRaw),
        agentId: agent.id,
        success,
        ...(typeof outputRaw === "string" ? { output: outputRaw } : {}),
        ...(typeof exitCodeRaw === "number" ? { exitCode: exitCodeRaw } : {}),
        ...(typeof errorMessageRaw === "string"
          ? { errorMessage: errorMessageRaw }
          : {}),
      });

      return Response.sendJsonObjectResponse(req, res, {
        accepted,
      });
    } catch (err) {
      next(err);
    }
  }
}
