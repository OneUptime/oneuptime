import RunnerAuthorization from "../Middleware/RunnerAuthorization";
import { RunnerExpressRequest } from "../Types/Request";
import RunbookJobVariables, {
  PreparedJobVariables,
} from "../Utils/JobVariables";
import RunnerService, {
  Service as RunnerServiceClass,
} from "Common/Server/Services/RunnerService";
import RunnerJobService from "Common/Server/Services/RunnerJobService";
import RunbookExecutionService from "Common/Server/Services/RunbookExecutionService";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import CodeRepositoryRunnerChoice from "Common/Server/Utils/AI/CodeFix/CodeRepositoryRunnerChoice";
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
import {
  RUNNER_FEATURE_KUBECTL_SCRIPT,
  readRunnerFeatures,
} from "Common/Types/Runbook/RunnerFeatures";
import { REMOVED_RUNBOOK_CREDENTIAL_STEP_MESSAGE } from "Common/Types/Runbook/RunbookLegacySteps";
import {
  RunbookVariableReference,
  RunbookVariableScope,
} from "Common/Types/Runbook/RunbookVariableReference";
import { RunbookVariableAccess } from "Common/Server/Utils/Runbook/RunbookVariableResolver";
import {
  GLOBAL_RUNNER_STEP_TYPES,
  canGlobalRunnersRunStepType,
} from "Common/Types/Runner/GlobalRunnerWork";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";

// What a claimed job's run hands its step besides the script.
export interface RunInputsForJob {
  inputs: JSONObject;
  trigger: string | null;
}

export default class RunnerIngressAPI {
  public router!: ExpressRouter;

  /*
   * Why a kubectl step that takes a script was not run on a Runner that
   * did not say it can run one (RunnerFeatures): a Runner older than
   * kubectl scripts would fail it with a confusing error of its own. (A
   * step moved from a Kubernetes action was handed to such a Runner as that
   * action, with its runbook credential, until runbook credentials were
   * removed.)
   */
  public static readonly KUBECTL_SCRIPT_NEEDS_NEWER_RUNNER: string =
    "This kubectl step runs a script, and this Runner is too old to run one, so it was not run. Update the Runner to your server's version (pull its image again and restart it), then run the runbook again.";

  /*
   * Why a runbook step's job that names a runbook credential is failed:
   * runbook credentials were removed (the step was written with one
   * through the API and never moved to variables). Its Steps page turns it
   * into the script step that does the same.
   */
  public static readonly REMOVED_CREDENTIAL_STEP_REFUSAL: string =
    REMOVED_RUNBOOK_CREDENTIAL_STEP_MESSAGE;

  /*
   * Why a command OneUptime AI composed with a runbook credential - an SSH
   * command, or kubectl through a Runner outside its cluster - is failed:
   * it was queued before runbook credentials were removed.
   */
  public static readonly REMOVED_CREDENTIAL_COMMAND_REFUSAL: string =
    "OneUptime AI composed this command to run with a runbook credential, and runbook credentials were removed, so it was not run. A host or Kubernetes cluster is fixed through its own AI agent now.";

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
     * The in-cluster Runner older kubernetes-agent charts install has no
     * dashboard-issued id and key. It presents the project's telemetry
     * ingestion key (the same one the agent ships telemetry with) and the
     * cluster's name, and is handed a Runner identity bound to that cluster
     * — unless the cluster's Kubernetes AI agent is online, which replaces
     * it: then it is refused with superseded_by_ai_agent (a 403 carrying
     * retryAfterSeconds and Retry-After, since it clears on its own when
     * the agent stops, e.g. after a helm rollback).
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
       * that clears on its own (previous_instance_online, or
       * superseded_by_ai_agent while the cluster's Kubernetes AI agent is
       * online — each with when to try again) from one that needs an
       * operator. The generic error body is `{ message }` only.
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

      return Response.sendJsonObjectResponse(
        req,
        res,
        RunnerIngressAPI.getHeartbeatAnswer(agent, {
          isPickedByACodeRepository:
            await RunnerIngressAPI.isPickedByACodeRepository(agent),
        }),
      );
    } catch (err) {
      next(err);
    }
  }

  /*
   * Whether a code repository of the Runner's project picks it (its Runner
   * setting in Code): what the code-fix capability its heartbeat is told
   * says. Not asked for a global Runner, which takes the code work of every
   * repository on the Global Runner (getHeartbeatAnswer), nor for an
   * in-cluster Runner the Kubernetes agent chart installed, which never
   * takes code work.
   */
  public static async isPickedByACodeRepository(
    agent: Runner,
  ): Promise<boolean> {
    if (
      agent.isGlobalRunner ||
      RunnerServiceClass.isKubernetesAgentRunnerRow(agent)
    ) {
      return false;
    }

    return await CodeRepositoryRunnerChoice.doesRunnerWorkInARepository(agent);
  }

  /*
   * What a heartbeat answers: the capabilities the Runner may use. The
   * dashboard is the control plane: toggling a capability off stops the
   * Runner starting that loop, and the claim path rejects it in the
   * meantime - so an operator never has to touch the container to revoke
   * one.
   *
   * AI code fixes are not a switch: the Runner takes code work while a code
   * repository of its project picks it (isPickedByACodeRepository), so a
   * repository that picks it starts its code-fix loop within a heartbeat,
   * and one that picks another stops it.
   *
   * A global Runner is told it is one: it runs every project's JavaScript
   * steps (a master admin may pause those with "Runs Runbooks") and the AI
   * code fixes of every repository on the Global Runner, never with the
   * repository's own commands. It then asks only for what global Runners
   * run, and refuses anything else it is handed. The server serves it no
   * other work whatever it asks for.
   */
  public static getHeartbeatAnswer(
    agent: Runner,
    data?: { isPickedByACodeRepository?: boolean | undefined } | undefined,
  ): JSONObject {
    if (agent.isGlobalRunner) {
      return {
        status: "ok",
        isGlobalRunner: true,
        globalStepTypes: [...GLOBAL_RUNNER_STEP_TYPES],
        capabilities: {
          canRunRunbooks: agent.canRunRunbooks !== false,
          canRunCodeFixTasks: true,
          canRunAiCommands: false,
        },
      };
    }

    return {
      status: "ok",
      capabilities: {
        canRunRunbooks: agent.canRunRunbooks !== false,
        canRunCodeFixTasks:
          data?.isPickedByACodeRepository === true &&
          !RunnerServiceClass.isKubernetesAgentRunnerRow(agent),
        canRunAiCommands: agent.canRunAiCommands === true,
      },
    };
  }

  public async claimNextJob(
    req: RunnerExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const agent: Runner | undefined = req.runner;
      if (!agent || !agent.id) {
        throw new BadDataException("Agent not found on request");
      }

      /*
       * A global Runner belongs to no project and takes the steps that wait
       * for any global Runner, from every project that uses them - and
       * nothing else (RunnerIngressAPI.claimGlobalJob).
       */
      if (agent.isGlobalRunner) {
        return Response.sendJsonObjectResponse(
          req,
          res,
          await RunnerIngressAPI.claimGlobalJob({
            agent,
            requestedStepTypes: RunnerIngressAPI.parseRequestedStepTypes(
              ((req.body as JSONObject) || {})["stepTypes"],
            ),
          }),
        );
      }

      if (!agent.projectId) {
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
       * A job that names a runbook credential - a step written with one
       * through the API and never moved to variables, or a command
       * OneUptime AI composed with one - was queued before runbook
       * credentials were removed: there is nothing to hand it, so it is
       * failed with what to do, never run.
       */
      const payload: JSONObject = (job.payload as JSONObject) || {};

      if (payload["credentialId"]) {
        await RunnerJobService.submitResult({
          jobId: job.id!,
          agentId: agent.id,
          success: false,
          errorMessage: RunnerIngressAPI.getRemovedCredentialRefusal(job),
        });

        return Response.sendJsonObjectResponse(req, res, { job: null });
      }

      /*
       * Fill in the runbook variables the step names - in its script, and
       * for an SSH or kubectl step in its host, user, key, password or
       * kubeconfig (RunbookJobVariables). Read per claim so a value changed
       * a moment ago reaches the next run, and the stored job row never
       * holds a value. A secret reaches only a Runner it lists; a step that
       * names one it may not have is failed with the reason, not run with a
       * placeholder in its script.
       *
       * NEVER for AI-composed commands: a human authored every runbook
       * step, but an AI-composed command is model output shaped by
       * attacker-influenceable telemetry. Filling in there would turn
       * `{{global.variables.X}}` into an exfiltration macro that reads
       * harmless on the approval card and expands to the plaintext secret
       * at claim time. AI commands are handed no secret at all.
       *
       * Never for a kubernetes-agent Runner either: its identity can be
       * minted with the project's telemetry ingestion key, so it is never
       * handed a secret (and it is served kubectl only, which has no script).
       */
      let scriptToSend: string = job.script ?? "";
      let payloadToSend: JSONObject | undefined =
        (job.payload as JSONObject | undefined) || undefined;
      let credential: JSONObject | null = null;
      let secretValues: Array<string> = [];

      if (
        !isAgentRunnerRow &&
        !AI_COMMAND_JOB_ORIGINS.includes(
          job.origin || RunnerJobOrigin.Runbook,
        ) &&
        RunbookJobVariables.usesVariables(job)
      ) {
        if (
          job.stepType === RunbookStepType.Kubernetes &&
          !readRunnerFeatures(body["features"]).includes(
            RUNNER_FEATURE_KUBECTL_SCRIPT,
          )
        ) {
          // A Runner older than kubectl scripts: it is failed, saying to update it.
          await RunnerJobService.submitResult({
            jobId: job.id!,
            agentId: agent.id,
            success: false,
            errorMessage: RunnerIngressAPI.KUBECTL_SCRIPT_NEEDS_NEWER_RUNNER,
          });

          return Response.sendJsonObjectResponse(req, res, { job: null });
        }

        const prepared: PreparedJobVariables =
          await RunnerIngressAPI.prepareJobVariables({
            job,
            projectId: agent.projectId,
            access: { kind: "project-runner", runnerId: agent.id },
          });

        if (prepared.isRefused) {
          await RunnerJobService.submitResult({
            jobId: job.id!,
            agentId: agent.id,
            success: false,
            errorMessage: prepared.refusal,
          });

          return Response.sendJsonObjectResponse(req, res, { job: null });
        }

        scriptToSend = prepared.script;
        payloadToSend = prepared.payload || payloadToSend;
        credential = prepared.credential || null;
        secretValues = prepared.secretValues;
      }

      /*
       * A Kubectl job is meant for an in-cluster Runner, which uses its own
       * ServiceAccount — and that ServiceAccount reaches only the cluster
       * the pod lives in. So it is served only to the in-cluster Runner OF
       * THE JOB'S CLUSTER: the Runner's posture must name the cluster the
       * payload names. A plain Runner would run kubectl against whatever its
       * host's kubeconfig points at, and the agent of another cluster would
       * run it against that other cluster. The payload's identifier was
       * stamped by the enqueue chokepoint from the cluster row; a job
       * without one fails closed.
       */
      if (job.stepType === RunbookStepType.Kubectl) {
        const jobClusterIdentifier: string =
          typeof payload["clusterIdentifier"] === "string"
            ? (payload["clusterIdentifier"] as string).trim()
            : "";

        const refusal: string | null =
          RunnerIngressAPI.getInClusterKubectlRefusal({
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

      const runInputs: RunInputsForJob | null =
        await RunnerIngressAPI.getRunInputsForJob({
          job,
          projectId: agent.projectId,
          isAgentRunnerRow,
        });

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
          ...(payloadToSend ? { payload: payloadToSend } : {}),
          ...(credential ? { credential } : {}),
          ...(secretValues.length > 0 ? { secretValues } : {}),
          ...(runInputs
            ? { inputs: runInputs.inputs, trigger: runInputs.trigger }
            : {}),
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /*
   * The runbook a job's step belongs to, read from its run - only when the
   * step names one of the runbook's own variables ({{local.variables.X}}),
   * so a claim that names none reads nothing more. Null when the job has no
   * run, or its run is not the project's.
   */
  public static async getRunbookIdForJob(data: {
    job: RunnerJob;
    projectId: ObjectID;
    references: Array<RunbookVariableReference>;
  }): Promise<ObjectID | null> {
    const namesLocal: boolean = data.references.some(
      (reference: RunbookVariableReference): boolean => {
        return reference.scope === RunbookVariableScope.Local;
      },
    );

    if (!namesLocal || !data.job.runbookExecutionId) {
      return null;
    }

    const execution: RunbookExecution | null =
      await RunbookExecutionService.findOneById({
        id: data.job.runbookExecutionId,
        select: { projectId: true, runbookId: true },
        props: { isRoot: true },
      });

    if (
      !execution ||
      !execution.runbookId ||
      execution.projectId?.toString() !== data.projectId.toString()
    ) {
      return null;
    }

    return execution.runbookId;
  }

  // A runbook step's variables, filled in for whoever took it.
  public static async prepareJobVariables(data: {
    job: RunnerJob;
    projectId: ObjectID;
    access: RunbookVariableAccess;
  }): Promise<PreparedJobVariables> {
    const runbookId: ObjectID | null =
      await RunnerIngressAPI.getRunbookIdForJob({
        job: data.job,
        projectId: data.projectId,
        references: RunbookJobVariables.getReferences(data.job),
      });

    return RunbookJobVariables.prepare({
      job: data.job,
      projectId: data.projectId,
      runbookId,
      access: data.access,
    });
  }

  /*
   * What a job that names a runbook credential is failed with: a runbook
   * step's tells how to fix the step; an AI command's that it was composed
   * before runbook credentials were removed.
   */
  public static getRemovedCredentialRefusal(job: RunnerJob): string {
    return AI_COMMAND_JOB_ORIGINS.includes(
      job.origin || RunnerJobOrigin.Runbook,
    )
      ? RunnerIngressAPI.REMOVED_CREDENTIAL_COMMAND_REFUSAL
      : RunnerIngressAPI.REMOVED_CREDENTIAL_STEP_REFUSAL;
  }

  /*
   * A claim by a global Runner: the next step that waits for any global
   * Runner (RunnerJobService.claimNextGlobalJob - only a runbook's own step,
   * only a type global Runners run, never of a project that turned them
   * off), handed over the way a project's own Runner is handed its step,
   * with everything read from the step's OWN project:
   *
   *   - its script, with the variables it names filled in: the plain ones,
   *     and the secrets of that project its people let global Runners use
   *     (RunbookJobVariables, with the global-runner access);
   *   - the inputs and trigger of the run it belongs to, from that project;
   *   - never a credential: a step that names a runbook credential is
   *     failed, not handed over (global Runners run no SSH or Kubernetes
   *     step, and the job could only carry one if something wrote it around
   *     the enqueue).
   *
   * A global Runner whose "Runs Runbooks" is off takes nothing.
   */
  public static async claimGlobalJob(data: {
    agent: Runner;
    requestedStepTypes: Array<RunbookStepType> | undefined;
  }): Promise<JSONObject> {
    const agent: Runner = data.agent;

    if (!agent.id || agent.canRunRunbooks === false) {
      return { job: null };
    }

    const allowedStepTypes: Array<RunbookStepType> = (
      data.requestedStepTypes || [...GLOBAL_RUNNER_STEP_TYPES]
    ).filter((stepType: RunbookStepType): boolean => {
      return canGlobalRunnersRunStepType(stepType);
    });

    if (allowedStepTypes.length === 0) {
      return { job: null };
    }

    const job: RunnerJob | null = await RunnerJobService.claimNextGlobalJob({
      agentId: agent.id,
      allowedStepTypes,
    });

    if (!job || !job.projectId) {
      return { job: null };
    }

    const payload: JSONObject = (job.payload as JSONObject) || {};

    if (payload["credentialId"]) {
      await RunnerJobService.submitResult({
        jobId: job.id!,
        agentId: agent.id,
        success: false,
        errorMessage: RunnerIngressAPI.getRemovedCredentialRefusal(job),
      });

      return { job: null };
    }

    let scriptToSend: string = job.script ?? "";
    let secretValues: Array<string> = [];

    if (scriptToSend) {
      /*
       * A variable the step names that global Runners may not have - a
       * secret not switched on for them, or one that does not exist - fails
       * the step, saying which and how to fix it, rather than running it
       * with the placeholder where the value should be.
       */
      const prepared: PreparedJobVariables =
        await RunnerIngressAPI.prepareJobVariables({
          job,
          projectId: job.projectId,
          access: { kind: "global-runner" },
        });

      if (prepared.isRefused) {
        await RunnerJobService.submitResult({
          jobId: job.id!,
          agentId: agent.id,
          success: false,
          errorMessage: prepared.refusal,
        });

        return { job: null };
      }

      scriptToSend = prepared.script;
      secretValues = prepared.secretValues;
    }

    const runInputs: RunInputsForJob | null =
      await RunnerIngressAPI.getRunInputsForJob({
        job,
        projectId: job.projectId,
        isAgentRunnerRow: false,
      });

    return {
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
        runsOnGlobalRunner: true,
        ...(secretValues.length > 0 ? { secretValues } : {}),
        ...(runInputs
          ? { inputs: runInputs.inputs, trigger: runInputs.trigger }
          : {}),
      },
    };
  }

  /*
   * The values the job's run was started with - the JSON body of the webhook
   * call that started it - and what started it, for the steps that take data
   * from outside: a Bash or kubectl step's environment and a JavaScript
   * step's args (Types/Runbook/RunbookInputs). Sent BESIDE the script, never
   * into it: the script the Runner gets is the one the runbook's author
   * wrote, so a value a caller sends cannot become a command.
   *
   * Only for a runbook's own Bash, JavaScript and kubectl steps (a kubectl
   * step that takes a script runs it with bash on the Runner, as a Bash step
   * does), read from the run the job belongs to in the Runner's own project.
   * Never for an SSH step, whose script runs on another machine; never for
   * an AI-composed command, nor for a kubernetes-agent Runner, which runs
   * kubectl only. Null when there is nothing to send.
   */
  public static async getRunInputsForJob(data: {
    job: RunnerJob;
    projectId: ObjectID;
    isAgentRunnerRow: boolean;
  }): Promise<RunInputsForJob | null> {
    const origin: RunnerJobOrigin = data.job.origin || RunnerJobOrigin.Runbook;

    const takesInputs: boolean =
      data.job.stepType === RunbookStepType.Bash ||
      data.job.stepType === RunbookStepType.JavaScript ||
      (data.job.stepType === RunbookStepType.Kubernetes &&
        RunbookJobVariables.usesVariables(data.job));

    if (
      data.isAgentRunnerRow ||
      origin !== RunnerJobOrigin.Runbook ||
      !data.job.runbookExecutionId ||
      !takesInputs
    ) {
      return null;
    }

    const execution: RunbookExecution | null =
      await RunbookExecutionService.findOneById({
        id: data.job.runbookExecutionId,
        select: { projectId: true, inputs: true, triggerType: true },
        props: { isRoot: true },
      });

    if (
      !execution ||
      execution.projectId?.toString() !== data.projectId.toString()
    ) {
      return null;
    }

    return {
      inputs:
        execution.inputs &&
        typeof execution.inputs === "object" &&
        !Array.isArray(execution.inputs)
          ? execution.inputs
          : {},
      trigger: execution.triggerType || null,
    };
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
      const jobId: ObjectID = new ObjectID(jobIdRaw);

      /*
       * The secrets the step was handed, hidden in what it printed before it
       * is stored (RunnerJobService.submitResult): this Runner hid them
       * already when it is new enough to, and an older one did not know to.
       */
      const secretValues: Array<string> =
        typeof outputRaw === "string" || typeof errorMessageRaw === "string"
          ? await RunnerJobService.getSecretValuesGivenToJob({
              jobId,
              agentId: agent.id,
            })
          : [];

      const accepted: boolean = await RunnerJobService.submitResult({
        jobId,
        agentId: agent.id,
        success,
        ...(typeof outputRaw === "string" ? { output: outputRaw } : {}),
        ...(typeof exitCodeRaw === "number" ? { exitCode: exitCodeRaw } : {}),
        ...(typeof errorMessageRaw === "string"
          ? { errorMessage: errorMessageRaw }
          : {}),
        ...(secretValues.length > 0 ? { secretValues } : {}),
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
   * Why a kubectl job may NOT be served to this Runner, or null when it
   * may. The one rule: only the in-cluster Runner of the job's own cluster
   * runs kubectl, with its ServiceAccount.
   */
  public static getInClusterKubectlRefusal(data: {
    posture: KubernetesRunnerPosture | undefined;
    jobClusterIdentifier: string;
  }): string | null {
    if (!data.posture?.inCluster) {
      return "This kubectl command can only run on the in-cluster Runner of its cluster, and this Runner is not one, so it was not run. OneUptime AI reaches a cluster through its Kubernetes AI agent, which the Kubernetes agent chart installs.";
    }

    if (!data.jobClusterIdentifier) {
      return "This kubectl command does not name the cluster it is for, so it cannot be matched to this in-cluster Runner. It was not run.";
    }

    if (
      !isInClusterPostureForCluster(data.posture, data.jobClusterIdentifier)
    ) {
      const reportedCluster: string =
        data.posture.clusterIdentifier?.trim() || "";

      return `This kubectl command is for cluster "${data.jobClusterIdentifier}" but this Runner is the in-cluster Runner of ${
        reportedCluster ? `cluster "${reportedCluster}"` : "an unnamed cluster"
      }, so it was not run. Install the Kubernetes AI agent on cluster "${data.jobClusterIdentifier}".`;
    }

    return null;
  }
}
