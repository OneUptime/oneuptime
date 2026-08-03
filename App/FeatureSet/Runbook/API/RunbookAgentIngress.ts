import RunbookAgentAuthorization from "../Middleware/RunbookAgentAuthorization";
import { RunbookAgentExpressRequest } from "../Types/Request";
import RunbookSecretsUtil from "../Utils/Secrets";
import RunbookCredentialsUtil from "../Utils/Credentials";
import RunbookAgentService from "Common/Server/Services/RunbookAgentService";
import RunbookAgentJobService from "Common/Server/Services/RunbookAgentJobService";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import ObjectID from "Common/Types/ObjectID";
import Version from "Common/Types/Version";
import { JSONObject } from "Common/Types/JSON";
import RunbookAgent from "Common/Models/DatabaseModels/RunbookAgent";
import RunbookAgentJob from "Common/Models/DatabaseModels/RunbookAgentJob";
import RunbookSecret from "Common/Models/DatabaseModels/RunbookSecret";
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

      /*
       * Hand the Runner back the capabilities this project granted it. The
       * dashboard is the control plane: toggling a capability off here stops
       * the Runner starting that loop on its next boot, and the claim path
       * rejects it in the meantime — so an operator never has to touch the
       * container to revoke one.
       */
      return Response.sendJsonObjectResponse(req, res, {
        status: "ok",
        capabilities: {
          canRunRunbooks: agent.canRunRunbooks !== false,
          canRunCodeFixTasks: agent.canRunCodeFixTasks === true,
        },
      });
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
       * The dashboard's runbook capability toggle, enforced here so revoking
       * it actually stops the Runner from taking work — the container's own
       * env var is the Runner's opinion, this row is the project's. Claiming
       * is the only gate: heartbeats and in-flight job reporting stay open so
       * a revoke mid-run still lands its result instead of stranding the step.
       *
       * Answered as "no work for you" rather than an error: a Runner started
       * before the capability was revoked polls every few seconds, and a
       * rejection would turn that into an error-level log flood on both
       * sides. It picks the revocation up from the heartbeat on its next
       * restart; until then it simply never receives a job.
       */
      if (agent.canRunRunbooks === false) {
        return Response.sendJsonObjectResponse(req, res, { job: null });
      }

      /*
       * Steps now target a specific agent by ID. The authenticated agent's
       * own ID is the only thing we trust here — a leaked key cannot be used
       * to claim work targeted at a different agent.
       */
      const job: RunbookAgentJob | null =
        await RunbookAgentJobService.claimNextJob({
          agentId: agent.id,
          projectId: agent.projectId,
        });

      if (!job) {
        return Response.sendJsonObjectResponse(req, res, { job: null });
      }

      /*
       * Substitute {{runbookSecrets.NAME}} placeholders in the script with
       * the agent's assigned secret values. Secrets are loaded per claim so
       * a freshly-rotated value reaches the next run without redeploying
       * the agent, and the stored script row never holds plaintext values.
       */
      let scriptToSend: string = job.script ?? "";
      if (scriptToSend) {
        const secrets: Array<RunbookSecret> =
          await RunbookSecretsUtil.loadForAgent(agent.id);
        scriptToSend = RunbookSecretsUtil.populateInScript({
          script: scriptToSend,
          secrets,
        });
      }

      /*
       * Steps that act on other systems carry structured instructions plus a
       * credential reference. The credential is resolved HERE, scoped to this
       * Runner and this project, so its secret material exists on the wire
       * only in the response to the Runner that was targeted — never on the
       * job row, and never readable through the CRUD API.
       */
      let credential: JSONObject | null = null;
      const payload: JSONObject = (job.payload as JSONObject) || {};
      const credentialId: unknown = payload["credentialId"];

      if (typeof credentialId === "string" && credentialId) {
        credential = await RunbookCredentialsUtil.resolveForJob({
          credentialId,
          agentId: agent.id,
          projectId: agent.projectId,
        });

        if (!credential) {
          /*
           * Fail the job rather than handing over a step it cannot run: a
           * Runner that silently no-ops looks identical to one that worked.
           */
          await RunbookAgentJobService.submitResult({
            jobId: job.id!,
            agentId: agent.id,
            success: false,
            errorMessage:
              "The credential this step references is not available to this Runner. Check that it exists and that this Runner is assigned to it.",
          });

          return Response.sendJsonObjectResponse(req, res, { job: null });
        }
      }

      return Response.sendJsonObjectResponse(req, res, {
        job: {
          jobId: job.id?.toString(),
          runbookExecutionId: job.runbookExecutionId?.toString(),
          stepId: job.stepId,
          stepType: job.stepType,
          script: scriptToSend,
          timeoutInMs: job.timeoutInMs,
          leaseExpiresAt: job.leaseExpiresAt?.toISOString(),
          ...(job.payload ? { payload: job.payload } : {}),
          ...(credential ? { credential } : {}),
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
