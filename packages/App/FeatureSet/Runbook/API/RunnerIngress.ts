import RunnerAuthorization from "../Middleware/RunnerAuthorization";
import { RunnerExpressRequest } from "../Types/Request";
import RunbookSecretsUtil from "../Utils/Secrets";
import RunbookCredentialsUtil from "../Utils/Credentials";
import RunnerService, {
  Service as RunnerServiceClass,
} from "Common/Server/Services/RunnerService";
import RunnerJobService from "Common/Server/Services/RunnerJobService";
import KubernetesClusterAiAccessService, {
  KubernetesAgentRegistrationRefusedException,
  RegisterKubernetesAgentRunnerResult,
} from "Common/Server/Services/KubernetesClusterAiAccessService";
import TelemetryIngest, {
  TelemetryRequest,
} from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import ObjectID from "Common/Types/ObjectID";
import RunnerJobOrigin, {
  AI_COMMAND_JOB_ORIGINS,
} from "Common/Types/Runbook/RunnerJobOrigin";
import RunbookStepType, {
  RUNNER_EXECUTED_STEP_TYPES,
} from "Common/Types/Runbook/RunbookStepType";
import {
  KubernetesRunnerPosture,
  isInClusterPostureForCluster,
  parseKubernetesRunnerPosture,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import StatusCode from "Common/Types/API/StatusCode";
import Version from "Common/Types/Version";
import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";
import Runner from "Common/Models/DatabaseModels/Runner";
import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import RunbookSecret from "Common/Models/DatabaseModels/RunbookSecret";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";

export default class RunnerIngressAPI {
  public router!: ExpressRouter;

  // Why a job naming a credential is failed for a kubernetes-agent Runner.
  public static readonly AGENT_RUNNER_CREDENTIAL_REFUSAL: string =
    "This step needs a credential, and this Runner is a cluster's in-cluster Runner: it runs kubectl with its own ServiceAccount only and is never given a credential. It was not run. Create a Runner under Project Settings → Runners, assign the credential to it and target that Runner instead.";

  public constructor() {
    this.router = Express.getRouter();

    this.router.post(
      `/heartbeat`,
      RunnerAuthorization.isAuthorizedAgent,
      this.heartbeat,
    );

    this.router.post(
      `/claim-next-job`,
      RunnerAuthorization.isAuthorizedAgent,
      this.claimNextJob,
    );

    this.router.post(
      `/job/:jobId/heartbeat`,
      RunnerAuthorization.isAuthorizedAgent,
      this.heartbeatJob,
    );

    this.router.post(
      `/job/:jobId/result`,
      RunnerAuthorization.isAuthorizedAgent,
      this.submitJobResult,
    );

    /*
     * A Runner signing off on a clean shutdown. For the kubernetes-agent
     * Runner this is what lets the replacement pod register immediately:
     * a registration may only re-key a Runner that is offline (or that
     * proves it holds the current key), so a pod that says goodbye spares
     * its successor the wait for the alive window to lapse.
     */
    this.router.post(
      `/disconnect`,
      RunnerAuthorization.isAuthorizedAgent,
      this.disconnect,
    );

    /*
     * The in-cluster Runner the kubernetes-agent chart installs has no
     * dashboard-issued id and key. It presents the project's telemetry
     * ingestion key (the same one the agent ships telemetry with) and the
     * cluster's name, and is handed a Runner identity bound to that cluster.
     */
    this.router.post(
      `/register-kubernetes-agent`,
      TelemetryIngest.forSurface(TelemetryIngestSurface.KubernetesAgentRunner),
      this.registerKubernetesAgentRunner,
    );
  }

  public async disconnect(
    req: RunnerExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const agent: Runner | undefined = req.runner;
      if (!agent || !agent.id) {
        throw new BadDataException("Agent not found on request");
      }

      await RunnerService.markDisconnected({ agentId: agent.id });

      return Response.sendJsonObjectResponse(req, res, { status: "ok" });
    } catch (err) {
      next(err);
    }
  }

  public async registerKubernetesAgentRunner(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const projectId: ObjectID | undefined = (req as TelemetryRequest)
        .projectId;

      if (!projectId) {
        throw new BadDataException("Project could not be resolved.");
      }

      const body: JSONObject = (req.body as JSONObject) || {};

      const clusterName: unknown = body["clusterName"];
      if (typeof clusterName !== "string" || !clusterName.trim()) {
        throw new BadDataException("clusterName is required.");
      }

      const agentVersion: string | undefined =
        typeof body["agentVersion"] === "string" && body["agentVersion"]
          ? (body["agentVersion"] as string)
          : undefined;

      /*
       * The key this Runner currently holds, if it still has one. Lets a
       * live Runner rotate its own key; a registration that cannot prove
       * continuity may only replace a Runner that is offline.
       */
      const previousRunnerKey: string | undefined =
        typeof body["previousRunnerKey"] === "string" &&
        body["previousRunnerKey"]
          ? (body["previousRunnerKey"] as string)
          : undefined;

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId,
          clusterIdentifier: clusterName.trim(),
          agentVersion,
          previousRunnerKey,
          posture: RunnerIngressAPI.parseRegistrationPosture(body),
        });

      return Response.sendJsonObjectResponse(req, res, {
        runnerId: result.runnerId.toString(),
        runnerKey: result.runnerKey,
        clusterId: result.clusterId.toString(),
        isBoundToCluster: result.isBoundToCluster,
        bindingState: result.bindingState,
        capabilities: {
          canRunRunbooks: false,
          canRunCodeFixTasks: false,
          canRunAiCommands: true,
        },
      });
    } catch (err) {
      /*
       * A refusal says WHICH refusal it is, so the Runner can tell a wait
       * that clears on its own (previous_instance_online, with when to try
       * again) from one that needs an operator — the generic error body is
       * `{ message }` only.
       */
      if (err instanceof KubernetesAgentRegistrationRefusedException) {
        RunnerIngressAPI.sendRegistrationRefusal(req, res, err);
        return;
      }

      next(err);
    }
  }

  /*
   * The 403 a refused registration answers with: the message, the
   * machine-readable reason and, for a refusal that clears on its own, when
   * to try again — in the body (retryAfterSeconds) and as a Retry-After
   * header, both of which the Runner honours.
   */
  public static sendRegistrationRefusal(
    req: ExpressRequest,
    res: ExpressResponse,
    refusal: KubernetesAgentRegistrationRefusedException,
  ): void {
    logger.warn(
      `Runner ingress: refused a kubernetes-agent registration (${refusal.reason}): ${refusal.message}`,
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

  /*
   * The posture a registering Runner reports about itself, read the way the
   * heartbeat's is (parseKubernetesRunnerPosture), so a registration stores
   * the same fields a heartbeat would — the write namespaces, the pod's own
   * namespace and whether node operations are allowed included — instead of
   * leaving them unknown until the first heartbeat. Which cluster, and that
   * it is in-cluster, the service sets itself.
   */
  public static parseRegistrationPosture(
    body: JSONObject,
  ): KubernetesRunnerPosture {
    const reported: KubernetesRunnerPosture =
      parseKubernetesRunnerPosture({ kubernetes: body }) || {};

    return {
      allowWrites: reported.allowWrites === true,
      kubectlVersion: reported.kubectlVersion,
      agentChartVersion: reported.agentChartVersion,
      writeNamespaces: reported.writeNamespaces,
      podNamespace: reported.podNamespace,
      allowNodeOperations: reported.allowNodeOperations,
    };
  }

  public async heartbeat(
    req: RunnerExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const agent: Runner | undefined = req.runner;
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

      await RunnerService.heartbeat({
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
          canRunAiCommands: agent.canRunAiCommands === true,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  public async claimNextJob(
    req: RunnerExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const agent: Runner | undefined = req.runner;
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
      const allowedOrigins: Array<RunnerJobOrigin> = [];
      if (agent.canRunRunbooks !== false) {
        allowedOrigins.push(RunnerJobOrigin.Runbook);
      }
      if (agent.canRunAiCommands === true) {
        // Remediation commands and read-only investigation kubectl alike.
        allowedOrigins.push(...AI_COMMAND_JOB_ORIGINS);
      }

      if (allowedOrigins.length === 0) {
        return Response.sendJsonObjectResponse(req, res, { job: null });
      }

      /*
       * Which step types this Runner may be handed. Two narrowings, both
       * optional and both intersecting the historical "every runner-executed
       * type":
       *
       *  - the Runner may declare its own list on the claim (`stepTypes`),
       *    which the kubernetes-agent Runner uses to ask for kubectl only;
       *  - a kubernetes-agent Runner is narrowed to kubectl by the server
       *    regardless, so an AI-composed Bash or SSH command can never be
       *    leased by the agent pod even by an older or misbuilt Runner
       *    binary. That pod exists to run policy-tiered kubectl; a shell
       *    inside it would bypass the tier policy and the read-only switch
       *    entirely.
       *
       * "Is an agent" is ONE rule for everything this claim decides — the
       * step types, the secret substitution and the credential refusal
       * (RunnerService.isKubernetesAgentRunnerRow): the row NAME marker,
       * which only registration writes (RunnerService refuses a non-root
       * rename into or out of it, compared case-insensitively), OR an agent
       * posture. The posture alone is not enough — the Runner rewrites
       * hostInfo on every heartbeat, so a Runner minted with the ingestion
       * key could drop it — and the name alone is not either: failing
       * closed on either fact costs an ordinary Runner nothing, since only
       * the kubernetes-agent binary reports an agent posture.
       */
      const body: JSONObject = (req.body as JSONObject) || {};
      const posture: KubernetesRunnerPosture | undefined =
        parseKubernetesRunnerPosture(agent.hostInfo);
      const isAgentRunnerRow: boolean =
        RunnerServiceClass.isKubernetesAgentRunnerRow(agent);

      let allowedStepTypes: Array<RunbookStepType> | undefined =
        RunnerIngressAPI.parseRequestedStepTypes(body["stepTypes"]);

      if (isAgentRunnerRow) {
        allowedStepTypes = (
          allowedStepTypes || RUNNER_EXECUTED_STEP_TYPES
        ).filter((stepType: RunbookStepType) => {
          return stepType === RunbookStepType.Kubectl;
        });
      }

      if (allowedStepTypes && allowedStepTypes.length === 0) {
        return Response.sendJsonObjectResponse(req, res, { job: null });
      }

      /*
       * Steps now target a specific agent by ID. The authenticated agent's
       * own ID is the only thing we trust here — a leaked key cannot be used
       * to claim work targeted at a different agent. The origins list keeps
       * each capability's revoke authoritative per job kind: a Runner whose
       * canRunAiCommands was just turned off stops being served AI command
       * jobs on its next claim, runbook work unaffected (and vice versa).
       */
      const job: RunnerJob | null = await RunnerJobService.claimNextJob({
        agentId: agent.id,
        projectId: agent.projectId,
        allowedOrigins,
        ...(allowedStepTypes ? { allowedStepTypes } : {}),
      });

      if (!job) {
        return Response.sendJsonObjectResponse(req, res, { job: null });
      }

      /*
       * Substitute {{runbookSecrets.NAME}} placeholders in the script with
       * the agent's assigned secret values. Secrets are loaded per claim so
       * a freshly-rotated value reaches the next run without redeploying
       * the agent, and the stored script row never holds plaintext values.
       *
       * NEVER for AI-composed commands: a human authored every runbook
       * script, but an AI-composed command is model output shaped by
       * attacker-influenceable telemetry. Substituting there would turn
       * `{{runbookSecrets.X}}` into an exfiltration macro that reads
       * harmless on the approval card and expands to the plaintext secret
       * at claim time. AI commands reach credentials only through the
       * credentialId path below, which never exposes the material to the
       * model.
       *
       * Never for a kubernetes-agent Runner either: its identity can be
       * minted with the project's telemetry ingestion key, so it is never
       * handed a secret (and it is served kubectl only, which has no script).
       */
      let scriptToSend: string = job.script ?? "";
      if (
        scriptToSend &&
        !isAgentRunnerRow &&
        !AI_COMMAND_JOB_ORIGINS.includes(job.origin || RunnerJobOrigin.Runbook)
      ) {
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

      /*
       * A Kubectl job without a credential is meant for an in-cluster
       * Runner, which uses its own ServiceAccount — and that ServiceAccount
       * reaches only the cluster the pod lives in. So it is served only to
       * the in-cluster Runner OF THE JOB'S CLUSTER: the Runner's posture
       * must name the cluster the payload names. A plain Runner would run
       * kubectl against whatever its host's kubeconfig points at, and the
       * agent of another cluster would run it against that other cluster.
       * The payload's identifier was stamped by the enqueue chokepoint from
       * the cluster row; a job without one fails closed.
       */
      if (
        job.stepType === RunbookStepType.Kubectl &&
        !(typeof credentialId === "string" && credentialId)
      ) {
        const jobClusterIdentifier: string =
          typeof payload["clusterIdentifier"] === "string"
            ? (payload["clusterIdentifier"] as string).trim()
            : "";

        const refusal: string | null =
          RunnerIngressAPI.getCredentialLessKubectlRefusal({
            posture,
            jobClusterIdentifier,
          });

        if (refusal) {
          await RunnerJobService.submitResult({
            jobId: job.id!,
            agentId: agent.id,
            success: false,
            errorMessage: refusal,
          });

          return Response.sendJsonObjectResponse(req, res, { job: null });
        }
      }

      if (typeof credentialId === "string" && credentialId) {
        /*
         * A kubernetes-agent Runner is NEVER handed credential material,
         * whatever is assigned to it. Its row is minted and re-keyed with
         * the project's telemetry ingestion key — a credential every
         * collector and CI job holds — so resolving a credential for it
         * would hand that credential to anyone holding the key. It runs
         * kubectl with its own ServiceAccount only. The job is failed with
         * the same refusal shape as the credential-less rule above, and the
         * credential is never resolved.
         */
        if (isAgentRunnerRow) {
          await RunnerJobService.submitResult({
            jobId: job.id!,
            agentId: agent.id,
            success: false,
            errorMessage: RunnerIngressAPI.AGENT_RUNNER_CREDENTIAL_REFUSAL,
          });

          return Response.sendJsonObjectResponse(req, res, { job: null });
        }

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
          await RunnerJobService.submitResult({
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
          ...(job.runbookExecutionId
            ? { runbookExecutionId: job.runbookExecutionId.toString() }
            : {}),
          origin: job.origin || RunnerJobOrigin.Runbook,
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
    req: RunnerExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const agent: Runner | undefined = req.runner;
      if (!agent || !agent.id) {
        throw new BadDataException("Agent not found on request");
      }
      const jobIdRaw: string | undefined = req.params["jobId"];
      if (!jobIdRaw) {
        throw new BadDataException("jobId is required");
      }

      const stillOurs: boolean = await RunnerJobService.heartbeatJob({
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
    req: RunnerExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const agent: Runner | undefined = req.runner;
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

      const accepted: boolean = await RunnerJobService.submitResult({
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

  /*
   * The optional `stepTypes` a Runner may send on a claim to narrow what it
   * is served. Absent means "no narrowing" (the historical contract). When
   * present it must be a list of runner-executed step types: a malformed
   * list is a misbuilt Runner, not a revocation, so it is answered with a
   * 400 that names the problem rather than a silent { job: null } the
   * Runner would poll against forever.
   */
  public static parseRequestedStepTypes(
    raw: unknown,
  ): Array<RunbookStepType> | undefined {
    if (raw === undefined || raw === null) {
      return undefined;
    }

    if (!Array.isArray(raw)) {
      throw new BadDataException(
        "stepTypes must be an array of runner step types.",
      );
    }

    const stepTypes: Array<RunbookStepType> = [];

    for (const item of raw) {
      if (
        typeof item !== "string" ||
        !RUNNER_EXECUTED_STEP_TYPES.includes(item as RunbookStepType)
      ) {
        throw new BadDataException(
          `stepTypes may only name runner step types (${RUNNER_EXECUTED_STEP_TYPES.join(
            ", ",
          )}); got ${JSON.stringify(item)}.`,
        );
      }

      if (!stepTypes.includes(item as RunbookStepType)) {
        stepTypes.push(item as RunbookStepType);
      }
    }

    return stepTypes;
  }

  /*
   * Why a credential-less kubectl job may NOT be served to this Runner, or
   * null when it may. The one rule: only the in-cluster Runner of the job's
   * own cluster runs kubectl with its ServiceAccount.
   */
  public static getCredentialLessKubectlRefusal(data: {
    posture: KubernetesRunnerPosture | undefined;
    jobClusterIdentifier: string;
  }): string | null {
    if (!data.posture?.inCluster) {
      return "This kubectl command has no Kubernetes credential and this Runner is not the in-cluster Runner. Select a Kubernetes credential for this Runner on the cluster's AI page.";
    }

    if (!data.jobClusterIdentifier) {
      return "This kubectl command has no Kubernetes credential and does not name the cluster it is for, so it cannot be matched to this in-cluster Runner. It was not run.";
    }

    if (
      !isInClusterPostureForCluster(data.posture, data.jobClusterIdentifier)
    ) {
      const reportedCluster: string =
        data.posture.clusterIdentifier?.trim() || "";

      return `This kubectl command is for cluster "${data.jobClusterIdentifier}" but this Runner is the in-cluster Runner of ${
        reportedCluster ? `cluster "${reportedCluster}"` : "an unnamed cluster"
      }, so it was not run. Install the in-cluster Runner on cluster "${data.jobClusterIdentifier}", or bind a Runner with a Kubernetes credential for it on the cluster's AI page.`;
    }

    return null;
  }
}
