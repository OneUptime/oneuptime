import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import AutoRemediationSuggestionStatus from "../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import {
  AiRemediationCommand,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
} from "../../Types/AutoRemediation/AiRemediationCommandPlan";
import { DEFAULT_VERIFICATION_WINDOW_MINUTES } from "../Services/AutoRemediationRuleEngineService";
import RunbookStepType from "../../Types/Runbook/RunbookStepType";
import {
  KubernetesAiAccessGap,
  KubernetesClusterAiAccessStatus,
  getKubernetesAiAccessTargetKind,
  isKubernetesAgentRunnerName,
  isKubernetesAgentRunnerPosture,
  parseKubernetesRunnerPosture,
} from "../../Types/Kubernetes/KubernetesClusterAiAccess";
/*
 * Approving starts a runbook execution, so reading the suggestion is not
 * authority enough — the caller must hold a permission from
 * RunbookExecution's own create ACL. Without this, the read-check-as-gate
 * idiom would let anyone who can see the suggestion run infrastructure
 * scripts. Shared with the runbook routes so the two surfaces can never
 * disagree about who may start an execution.
 */
import { assertCanExecuteRunbooks } from "../Utils/Runbook/RunbookExecutePermission";
import { Indigo500 } from "../../Types/BrandColors";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import AutoRemediationSuggestion from "../../Models/DatabaseModels/AutoRemediationSuggestion";
import RunbookExecution from "../../Models/DatabaseModels/RunbookExecution";
import Project from "../../Models/DatabaseModels/Project";
import Runner from "../../Models/DatabaseModels/Runner";
import ProjectService from "../Services/ProjectService";
import AlertFeedService from "../Services/AlertFeedService";
import AutoRemediationSuggestionService from "../Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../Services/IncidentFeedService";
import RunbookRuleEngineService from "../Services/RunbookRuleEngineService";
import RunnerService from "../Services/RunnerService";
import KubernetesClusterAiAccessService from "../Services/KubernetesClusterAiAccessService";
import CommandPlanExecutor from "../Utils/AutoRemediation/CommandPlanExecutor";
import RemediationCommandToolkit from "../Utils/AI/Remediation/RemediationCommandTools";
import { isClusterRemediationRound } from "../Utils/AI/Remediation/RemediationExecutionRunner";
import logger from "../Utils/Logger";

const router: ExpressRouter = Express.getRouter();

/*
 * Human-action endpoints for auto-remediation suggestions. Suggestion rows
 * are server-authored (empty create/update table permissions) — humans act
 * on them only through these routes: one-click Approve (starts the proposed
 * runbook under the approver's identity) and Dismiss. Each route
 * access-checks the suggestion under the USER's permissions first (project
 * membership + the read ACL), then the service performs the root write —
 * the AIInsightAPI idiom. State transitions are CAS-guarded so two
 * concurrent approvals can never double-start a runbook.
 */

async function getLoggedInProps(
  req: ExpressRequest,
): Promise<DatabaseCommonInteractionProps> {
  const props: DatabaseCommonInteractionProps =
    await CommonAPI.getDatabaseCommonInteractionProps(req);

  CommonAPI.assertAuthenticatedUser(props);

  return props;
}

/*
 * Access check under the USER's permissions: a null result means "does not
 * exist OR not yours", reported identically so the route never leaks
 * whether an id exists in another project.
 */
async function findAccessibleSuggestion(
  req: ExpressRequest,
  props: DatabaseCommonInteractionProps,
): Promise<ObjectID> {
  const suggestionIdString: string | undefined = req.body["suggestionId"] as
    | string
    | undefined;

  if (!suggestionIdString) {
    throw new BadDataException("suggestionId is required.");
  }

  const suggestion: AutoRemediationSuggestion | null =
    await AutoRemediationSuggestionService.findOneById({
      id: new ObjectID(suggestionIdString),
      select: { _id: true },
      props,
    });

  if (!suggestion || !suggestion.id) {
    throw new BadDataException(
      "Auto-remediation suggestion not found (or you do not have access to it).",
    );
  }

  return suggestion.id;
}

/*
 * One approval reads each cluster's AI access status at most once: the
 * Runner loop reads it to recognise the Kubernetes AI agent, and the kubectl
 * re-check reuses the same answer.
 */
type ClusterStatusCache = Map<string, KubernetesClusterAiAccessStatus | null>;

async function getClusterStatusOnce(data: {
  clusterId: string;
  projectId: ObjectID;
  statusByClusterId: ClusterStatusCache;
}): Promise<KubernetesClusterAiAccessStatus | null> {
  if (data.statusByClusterId.has(data.clusterId)) {
    return data.statusByClusterId.get(data.clusterId) || null;
  }

  const status: KubernetesClusterAiAccessStatus | null =
    await KubernetesClusterAiAccessService.getStatusForCluster({
      clusterId: new ObjectID(data.clusterId),
      projectId: data.projectId,
    });

  data.statusByClusterId.set(data.clusterId, status);

  return status;
}

/*
 * The cluster status whose access target is the Kubernetes AI agent this
 * plan names as `runnerId`, or null when `runnerId` is not the resolved AI
 * agent of any cluster its kubectl commands target. Only a Kubectl command
 * can reach the agent, and only the cluster's current status (not the plan)
 * says what the target is — so a Runner id never passes for the agent, and
 * an agent that is no longer the cluster's target falls back to the Runner
 * re-read, which refuses it.
 */
async function findAiAgentTargetStatus(data: {
  plan: AiRemediationCommandPlan;
  runnerId: string;
  projectId: ObjectID;
  statusByClusterId: ClusterStatusCache;
}): Promise<KubernetesClusterAiAccessStatus | null> {
  for (const command of data.plan.commands) {
    if (
      command.stepType !== RunbookStepType.Kubectl ||
      command.runnerId !== data.runnerId ||
      !command.kubernetesClusterId
    ) {
      continue;
    }

    const status: KubernetesClusterAiAccessStatus | null =
      await getClusterStatusOnce({
        clusterId: command.kubernetesClusterId,
        projectId: data.projectId,
        statusByClusterId: data.statusByClusterId,
      });

    if (
      status?.runner &&
      getKubernetesAiAccessTargetKind(status.runner) === "ai_agent" &&
      status.runner.id === data.runnerId
    ) {
      return status;
    }
  }

  return null;
}

/*
 * The AI agent's side of the Runner consent re-check. The agent is not a
 * Runner row, so there is no canRunAiCommands flag to re-read — the chart
 * that installed it is its consent. What can still have changed is whether
 * it is connected, and it only ever runs Kubectl steps, so a Bash or SSH
 * step aimed at it fails the click for the same reason as on the legacy
 * in-cluster Runner.
 */
function assertAiAgentCanRunPlan(data: {
  plan: AiRemediationCommandPlan;
  runnerId: string;
  status: KubernetesClusterAiAccessStatus;
}): void {
  const hostStep: AiRemediationCommand | undefined = data.plan.commands.find(
    (command: AiRemediationCommand) => {
      return (
        command.runnerId === data.runnerId &&
        command.stepType !== RunbookStepType.Kubectl
      );
    },
  );

  if (hostStep) {
    throw new BadDataException(
      `Command ${hostStep.sequence} is a ${hostStep.stepType} step on the Kubernetes AI agent of cluster "${data.status.clusterName}", which runs only Kubectl steps. The plan cannot be run — dismiss it and let a new suggestion be composed.`,
    );
  }

  if (!data.status.runner?.isOnline) {
    throw new BadDataException(
      `The Kubernetes AI agent of cluster "${data.status.clusterName}" is offline, so this plan cannot be run. Check the agent on the cluster's AI agent page (AI → Agent) and approve again, or dismiss the suggestion.`,
    );
  }
}

/*
 * What to do about a write-scope refusal, three ways by who runs kubectl for
 * the cluster — the same split as RemediationCommandToolkit
 * .getRunnerScopeSettings, which words the refusal itself:
 *
 * - the Kubernetes AI agent: its chart values; after a helm upgrade the
 *   same agent serves the cluster, so the plan can be approved again;
 * - the chart's previous in-cluster Runner: the chart no longer ships it,
 *   so the way to widen its scope is to upgrade to the AI agent — which
 *   replaces the Runner, so this plan (composed for the Runner) cannot be
 *   approved again and a new one is needed;
 * - any other Runner (a credential Runner): no chart configures it, its
 *   scope is set where it runs.
 */
export function getScopeRefusalNextStep(
  runner: KubernetesClusterAiAccessStatus["runner"],
): string {
  if (getKubernetesAiAccessTargetKind(runner) === "ai_agent") {
    return "Dismiss the suggestion and let a new plan be composed, or change the AI agent's write access (aiAgent.remediation.*) on the Kubernetes agent chart and approve again.";
  }

  if (
    isKubernetesAgentRunnerName(runner?.name) ||
    isKubernetesAgentRunnerPosture(runner?.posture)
  ) {
    return "Dismiss the suggestion and let a new plan be composed. To allow changes like this, upgrade the Kubernetes agent chart to the AI agent and set aiAgent.remediation.*.";
  }

  return "Dismiss the suggestion and let a new plan be composed, or change the Runner's write scope on the Runner's host and approve again.";
}

/*
 * Approval-time re-check of a Kubectl command's cluster. The plan named the
 * cluster, the Runner and the credential it was composed for; any of them
 * can have changed since (the operator turned remediation off on the
 * cluster's AI agent page, re-pointed it at another Runner, swapped or
 * removed the credential, the agent went offline). CommandPlanExecutor
 * hard-stops on the same conditions right before each command runs — this
 * makes the Approve click fail up front, with the first blocking gap named,
 * instead of claiming the plan and having it stop one command in. Each
 * cluster is checked once however many commands target it.
 */
async function assertKubectlCommandsStillRunnable(data: {
  plan: AiRemediationCommandPlan;
  projectId: ObjectID;
  statusByClusterId: ClusterStatusCache;
}): Promise<void> {
  for (const command of data.plan.commands) {
    if (command.stepType !== RunbookStepType.Kubectl) {
      continue;
    }

    const clusterLabel: string =
      command.kubernetesClusterNameSnapshot ||
      command.kubernetesClusterId ||
      "cluster";

    if (!command.kubernetesClusterId) {
      throw new BadDataException(
        `Command ${command.sequence} is a kubectl command with no cluster, so this plan cannot be run. Dismiss it and let a new suggestion be composed.`,
      );
    }

    const status: KubernetesClusterAiAccessStatus | null =
      await getClusterStatusOnce({
        clusterId: command.kubernetesClusterId,
        projectId: data.projectId,
        statusByClusterId: data.statusByClusterId,
      });

    if (!status) {
      throw new BadDataException(
        `Cluster "${clusterLabel}" (command ${command.sequence}) no longer exists in this project, so this plan cannot be run. Dismiss it and let a new suggestion be composed.`,
      );
    }

    if (!status.isRemediationReady) {
      const gap: KubernetesAiAccessGap | undefined = status.gaps.find(
        (candidate: KubernetesAiAccessGap) => {
          return candidate.blocks !== "investigation";
        },
      );

      throw new BadDataException(
        `Cluster "${status.clusterName}" (command ${command.sequence}) no longer allows AI remediation${
          gap ? `: ${gap.title} — ${gap.nextStep}` : ""
        }. Fix that on the cluster's AI agent page (AI → Agent) and approve again, or dismiss the suggestion.`,
      );
    }

    if (!status.runner || status.runner.id !== command.runnerId) {
      throw new BadDataException(
        `Cluster "${status.clusterName}" (command ${command.sequence}) is no longer reached through Runner "${command.runnerNameSnapshot}", which this plan was composed for${
          status.runner ? ` — it now uses "${status.runner.name}"` : ""
        }. Dismiss the suggestion and let a new plan be composed for the current Runner.`,
      );
    }

    if (
      (status.credentialId || undefined) !== (command.credentialId || undefined)
    ) {
      throw new BadDataException(
        `Cluster "${status.clusterName}" (command ${command.sequence}) is no longer reached with the credential this plan was composed for. Dismiss the suggestion and let a new plan be composed with the current credential.`,
      );
    }

    /*
     * The Runner's write scope as it reports it now (its chart's write
     * namespaces, its own namespace, node operations): a command or rollback
     * it would refuse fails the click with the reason, instead of claiming
     * the plan and being refused one command in — or, for a rollback, only
     * when verification fails and the change has to be undone.
     */
    const parts: Array<{ label: string; text: string | undefined }> = [
      { label: "", text: command.command },
      { label: "'s rollback", text: command.rollbackCommand },
    ];

    for (const part of parts) {
      if (!part.text) {
        continue;
      }

      const scopeRefusal: string | null =
        RemediationCommandToolkit.getRunnerScopeRefusal({
          cluster: status,
          command: part.text,
        });

      if (scopeRefusal) {
        throw new BadDataException(
          `Command ${command.sequence}${part.label} cannot run on cluster "${status.clusterName}": ${scopeRefusal} Nothing ran. ${getScopeRefusalNextStep(status.runner)}`,
        );
      }
    }
  }
}

/*
 * A cluster's in-cluster kubectl agent (the Runner a kubernetes-agent chart
 * registers) claims Kubectl jobs only. A Bash or SSH step aimed at it would
 * sit unclaimed until its claim timeout, fail, and skip the rest of the
 * plan AFTER the approver clicked — so it fails the click instead. A
 * Kubectl step legitimately names that same Runner (it is how the cluster
 * is reached), so the check is per step type, not per Runner.
 */
function assertNotHostStepOnKubernetesAgent(data: {
  plan: AiRemediationCommandPlan;
  runnerId: string;
  runner: Runner;
}): void {
  const isAgent: boolean =
    isKubernetesAgentRunnerName(data.runner.name) ||
    isKubernetesAgentRunnerPosture(
      parseKubernetesRunnerPosture(data.runner.hostInfo),
    );

  if (!isAgent) {
    return;
  }

  const hostStep: AiRemediationCommand | undefined = data.plan.commands.find(
    (command: AiRemediationCommand) => {
      return (
        command.runnerId === data.runnerId &&
        command.stepType !== RunbookStepType.Kubectl
      );
    },
  );

  if (hostStep) {
    throw new BadDataException(
      `Command ${hostStep.sequence} is a ${hostStep.stepType} step on Runner "${
        data.runner.name || hostStep.runnerNameSnapshot
      }", a Kubernetes cluster's in-cluster kubectl agent, which runs only Kubectl steps. The plan cannot be run — dismiss it and let a new suggestion be composed.`,
    );
  }
}

async function loadSuggestionAsRoot(
  suggestionId: ObjectID,
): Promise<AutoRemediationSuggestion> {
  const suggestion: AutoRemediationSuggestion | null =
    await AutoRemediationSuggestionService.findOneById({
      id: suggestionId,
      select: {
        _id: true,
        projectId: true,
        status: true,
        incidentId: true,
        alertId: true,
        runbookId: true,
        runbookNameSnapshot: true,
        ruleNameSnapshot: true,
        verificationWindowMinutes: true,
        suggestionType: true,
        commandPlan: true,
        /*
         * Which lane composed a command plan: a cluster round (a cluster,
         * no rule) does not need the project's AI command execution opt-in,
         * a rule round does (isClusterRemediationRound).
         */
        kubernetesClusterId: true,
        autoRemediationRuleId: true,
      },
      props: { isRoot: true },
    });

  if (!suggestion) {
    throw new BadDataException("Auto-remediation suggestion not found.");
  }

  return suggestion;
}

// Best-effort feed note on the suggestion's subject — never throws.
async function postFeedItem(data: {
  suggestion: AutoRemediationSuggestion;
  markdown: string;
  userId: ObjectID;
  pingWorkspace: boolean;
}): Promise<void> {
  try {
    if (data.suggestion.incidentId && data.suggestion.projectId) {
      await IncidentFeedService.createIncidentFeedItem({
        incidentId: data.suggestion.incidentId,
        projectId: data.suggestion.projectId,
        incidentFeedEventType: IncidentFeedEventType.AutoRemediation,
        displayColor: Indigo500,
        feedInfoInMarkdown: data.markdown,
        userId: data.userId,
        workspaceNotification: {
          sendWorkspaceNotification: data.pingWorkspace,
        },
      });
    } else if (data.suggestion.alertId && data.suggestion.projectId) {
      await AlertFeedService.createAlertFeedItem({
        alertId: data.suggestion.alertId,
        projectId: data.suggestion.projectId,
        alertFeedEventType: AlertFeedEventType.AutoRemediation,
        displayColor: Indigo500,
        feedInfoInMarkdown: data.markdown,
        userId: data.userId,
        workspaceNotification: {
          sendWorkspaceNotification: data.pingWorkspace,
        },
      });
    }
  } catch (error) {
    logger.error(`AutoRemediationAPI: failed to create feed item: ${error}`);
  }
}

router.post(
  "/auto-remediation/approve",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      const suggestionId: ObjectID = await findAccessibleSuggestion(req, props);

      const suggestion: AutoRemediationSuggestion =
        await loadSuggestionAsRoot(suggestionId);

      if (suggestion.status !== AutoRemediationSuggestionStatus.Suggested) {
        throw new BadDataException(
          `Only suggested remediations can be approved — this one is ${suggestion.status}.`,
        );
      }

      if (!suggestion.projectId) {
        throw new BadDataException("This suggestion has no project.");
      }

      /*
       * CommandPlan suggestions approve the AI-composed command plan
       * instead of starting a runbook. Same permission bar: executing
       * commands on a Runner is at least as sensitive as starting a
       * runbook on one.
       */
      if (
        suggestion.suggestionType === AutoRemediationSuggestionType.CommandPlan
      ) {
        assertCanExecuteRunbooks(props, suggestion.projectId);

        /*
         * Re-check the project switches at approval time. The plan may have
         * been composed hours ago; an operator who has since turned AI,
         * auto-remediation or AI command execution off expects that switch
         * to stop pending plans too, not just new ones. The command
         * execution opt-in covers rule rounds only — the same line
         * RemediationExecutionRunner.checkProjectGates draws — and is keyed
         * on the round, never on the plan's step types: a rule's
         * all-kubectl plan still needs it. A cluster round's consent is the
         * cluster's own, re-checked per kubectl command below.
         */
        const project: Project | null = await ProjectService.findOneById({
          id: suggestion.projectId,
          select: {
            _id: true,
            enableAi: true,
            enableAutoRemediation: true,
            enableAiCommandExecution: true,
          },
          props: { isRoot: true },
        });

        if (
          !project ||
          project.enableAi === false ||
          project.enableAutoRemediation === false
        ) {
          throw new BadDataException(
            "AI or auto-remediation is disabled for this project, so this plan cannot be run. Re-enable it in Project Settings → AI Features, or dismiss the suggestion.",
          );
        }

        if (
          !isClusterRemediationRound(suggestion) &&
          project.enableAiCommandExecution !== true
        ) {
          throw new BadDataException(
            "AI command execution is disabled for this project, so this plan cannot be run. Re-enable it in Project Settings → AI Features, or dismiss the suggestion.",
          );
        }

        const plan: AiRemediationCommandPlan | null =
          AiRemediationCommandPlanUtil.parse(suggestion.commandPlan);

        if (!plan || plan.commands.length === 0) {
          throw new BadDataException(
            "This suggestion has no valid command plan to run.",
          );
        }

        /*
         * Fail fast if a target Runner lost its AI-commands consent (or was
         * deleted) since the plan was composed — better a clear error now
         * than a plan that half-runs into claim timeouts. Each Runner is
         * read once, however many commands target it.
         */
        const runnerIds: Array<string> = Array.from(
          new Set(
            plan.commands.map((command: AiRemediationCommand) => {
              return command.runnerId;
            }),
          ),
        );

        const statusByClusterId: ClusterStatusCache = new Map<
          string,
          KubernetesClusterAiAccessStatus | null
        >();

        for (const runnerId of runnerIds) {
          /*
           * A kubectl command composed for a cluster's Kubernetes AI agent
           * names the agent's id where a Runner id would be. The agent is
           * not a Runner row — re-reading the Runner table would refuse
           * every agent plan — so it is recognised from the cluster's
           * status instead, and must be connected.
           */
          const aiAgentStatus: KubernetesClusterAiAccessStatus | null =
            await findAiAgentTargetStatus({
              plan,
              runnerId,
              projectId: suggestion.projectId,
              statusByClusterId,
            });

          if (aiAgentStatus) {
            assertAiAgentCanRunPlan({
              plan,
              runnerId,
              status: aiAgentStatus,
            });
            continue;
          }

          const runner: Runner | null = await RunnerService.findOneBy({
            query: {
              _id: runnerId,
              projectId: suggestion.projectId,
              canRunAiCommands: true,
            },
            select: { _id: true, name: true, hostInfo: true },
            props: { isRoot: true },
          });

          if (!runner) {
            throw new BadDataException(
              "A Runner this plan targets no longer accepts AI commands (or was deleted). The plan cannot be run — dismiss it and let a new suggestion be composed.",
            );
          }

          assertNotHostStepOnKubernetesAgent({
            plan,
            runnerId,
            runner,
          });
        }

        /*
         * Same idea for kubectl: the cluster's AI access is re-read at
         * approval time, so a cluster whose remediation was switched off,
         * re-bound to another Runner or re-credentialed since the plan was
         * composed fails the click rather than the first command.
         */
        await assertKubectlCommandsStillRunnable({
          plan,
          projectId: suggestion.projectId,
          statusByClusterId,
        });

        const claimedPlan: number =
          await AutoRemediationSuggestionService.attemptStatusTransition({
            suggestionId: suggestion.id!,
            fromStatus: AutoRemediationSuggestionStatus.Suggested,
            set: {
              status: AutoRemediationSuggestionStatus.Approved,
              approvedByUserId: props.userId!.toString(),
              approvedAt: OneUptimeDate.getCurrentDate(),
              verificationStatus: AutoRemediationVerificationStatus.Pending,
              verificationDeadlineAt: OneUptimeDate.addRemoveMinutes(
                OneUptimeDate.getCurrentDate(),
                suggestion.verificationWindowMinutes ||
                  DEFAULT_VERIFICATION_WINDOW_MINUTES,
              ),
            },
          });

        if (claimedPlan === 0) {
          throw new BadDataException(
            "This suggestion was just actioned by someone else. Refresh to see its current state.",
          );
        }

        /*
         * Detached on purpose: the plan can legitimately take minutes. The
         * executor persists per-command progress, and the verifier judges a
         * plan that never completes inside the window — so a pod death here
         * is recorded, not silent.
         */
        CommandPlanExecutor.executeApprovedPlan({
          suggestionId: suggestion.id!,
        }).catch((error: unknown) => {
          logger.error(
            `AutoRemediationAPI: detached command-plan execution failed: ${error}`,
          );
        });

        await postFeedItem({
          suggestion,
          markdown: `⚡ **AI command plan approved** — ${plan.commands.length} command(s) are being executed. Verification will watch the monitors for recovery.`,
          userId: props.userId!,
          pingWorkspace: true,
        });

        Response.sendJsonObjectResponse(req, res, {
          suggestionId: suggestion.id!.toString(),
          status: AutoRemediationSuggestionStatus.Approved,
          suggestionType: AutoRemediationSuggestionType.CommandPlan,
        });
        return;
      }

      if (!suggestion.runbookId) {
        throw new BadDataException("This suggestion has no runbook to start.");
      }

      assertCanExecuteRunbooks(props, suggestion.projectId);

      /*
       * Claim the approval FIRST (CAS Suggested -> Approved), then start
       * the runbook. Two concurrent approvals race on this transition and
       * exactly one wins — the loser gets a clean "already actioned" error
       * instead of a double-started runbook.
       */
      const claimed: number =
        await AutoRemediationSuggestionService.attemptStatusTransition({
          suggestionId: suggestion.id!,
          fromStatus: AutoRemediationSuggestionStatus.Suggested,
          set: {
            status: AutoRemediationSuggestionStatus.Approved,
            approvedByUserId: props.userId!.toString(),
            approvedAt: OneUptimeDate.getCurrentDate(),
            /*
             * The runbook starts next — the outcome verifier watches for
             * monitor recovery until this deadline.
             */
            verificationStatus: AutoRemediationVerificationStatus.Pending,
            verificationDeadlineAt: OneUptimeDate.addRemoveMinutes(
              OneUptimeDate.getCurrentDate(),
              suggestion.verificationWindowMinutes ||
                DEFAULT_VERIFICATION_WINDOW_MINUTES,
            ),
          },
        });

      if (claimed === 0) {
        throw new BadDataException(
          "This suggestion was just actioned by someone else. Refresh to see its current state.",
        );
      }

      /*
       * startRunbookFor re-validates everything (project ownership,
       * isEnabled, non-empty steps) and records the approver as the
       * triggering user.
       */
      const runbookLinkage: { incidentId?: ObjectID; alertId?: ObjectID } = {};
      if (suggestion.incidentId) {
        runbookLinkage.incidentId = suggestion.incidentId;
      }
      if (suggestion.alertId) {
        runbookLinkage.alertId = suggestion.alertId;
      }

      /*
       * A throw here (transient DB error inside startRunbookFor) must roll
       * the claim back exactly like the null return — otherwise the
       * suggestion is stranded in Approved, a terminal state, with no
       * execution and no way to retry.
       */
      let execution: RunbookExecution | null = null;
      try {
        execution = await RunbookRuleEngineService.startRunbookFor({
          projectId: suggestion.projectId,
          runbookId: suggestion.runbookId,
          linkage: runbookLinkage,
          triggeredByUserId: props.userId!,
        });
      } catch (error) {
        logger.error(
          `AutoRemediationAPI: startRunbookFor threw during approve: ${error}`,
        );
        execution = null;
      }

      if (!execution) {
        // Roll the claim back so the suggestion stays actionable.
        await AutoRemediationSuggestionService.attemptStatusTransition({
          suggestionId: suggestion.id!,
          fromStatus: AutoRemediationSuggestionStatus.Approved,
          set: {
            status: AutoRemediationSuggestionStatus.Suggested,
          },
        });
        throw new BadDataException(
          "The proposed runbook could not be started — it may have been disabled or deleted, or it has no steps. Please try again.",
        );
      }

      /*
       * The runbook IS running at this point — a failure to persist the
       * execution link must not 500 the request (best-effort, logged).
       */
      try {
        await AutoRemediationSuggestionService.updateOneById({
          id: suggestion.id!,
          data: {
            runbookExecutionId: execution.id!,
          },
          props: { isRoot: true },
        });
      } catch (error) {
        logger.error(
          `AutoRemediationAPI: failed to persist runbookExecutionId after approve: ${error}`,
        );
      }

      await postFeedItem({
        suggestion,
        markdown: `⚡ **Auto-remediation suggestion approved** — runbook "${suggestion.runbookNameSnapshot || "Runbook"}" was started.`,
        userId: props.userId!,
        pingWorkspace: true,
      });

      Response.sendJsonObjectResponse(req, res, {
        suggestionId: suggestion.id!.toString(),
        status: AutoRemediationSuggestionStatus.Approved,
        runbookExecutionId: execution.id!.toString(),
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

router.post(
  "/auto-remediation/dismiss",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      const suggestionId: ObjectID = await findAccessibleSuggestion(req, props);

      const suggestion: AutoRemediationSuggestion =
        await loadSuggestionAsRoot(suggestionId);

      /*
       * Both Suggested and still-Planning suggestions can be dismissed —
       * dismissing a Planning one cancels the proposal before the AI
       * finishes (the planner's own CAS then loses and writes nothing).
       */
      let dismissed: number =
        await AutoRemediationSuggestionService.attemptStatusTransition({
          suggestionId: suggestion.id!,
          fromStatus: AutoRemediationSuggestionStatus.Suggested,
          set: {
            status: AutoRemediationSuggestionStatus.Dismissed,
            dismissedByUserId: props.userId!.toString(),
            dismissedAt: OneUptimeDate.getCurrentDate(),
          },
        });

      if (dismissed === 0) {
        dismissed =
          await AutoRemediationSuggestionService.attemptStatusTransition({
            suggestionId: suggestion.id!,
            fromStatus: AutoRemediationSuggestionStatus.Planning,
            set: {
              status: AutoRemediationSuggestionStatus.Dismissed,
              dismissedByUserId: props.userId!.toString(),
              dismissedAt: OneUptimeDate.getCurrentDate(),
            },
          });
      }

      if (dismissed === 0) {
        throw new BadDataException(
          `Only suggested or planning remediations can be dismissed — this one is ${suggestion.status}.`,
        );
      }

      /*
       * A FullAuto run may already have executed commands by the time a
       * human dismisses its still-Planning suggestion. Saying "will not be
       * run" would be a lie about the state of their infrastructure, so
       * count what the plan records and say so — and ping the workspace,
       * because those changes are now outside the verification/rollback
       * loop and only a human can decide what to do about them.
       */
      const dismissedPlan: AiRemediationCommandPlan | null =
        suggestion.suggestionType === AutoRemediationSuggestionType.CommandPlan
          ? AiRemediationCommandPlanUtil.parse(suggestion.commandPlan)
          : null;

      const alreadyExecutedCount: number = (
        dismissedPlan?.commands || []
      ).filter((command: AiRemediationCommand) => {
        return command.execution !== undefined;
      }).length;

      let dismissMarkdown: string;
      if (alreadyExecutedCount > 0) {
        dismissMarkdown = `⚠️ **Auto-remediation suggestion dismissed — but ${alreadyExecutedCount} command(s) had ALREADY run.** No further commands will run and nothing was rolled back automatically. Review the executed commands and their output on the suggestion.`;
      } else if (
        suggestion.suggestionType === AutoRemediationSuggestionType.CommandPlan
      ) {
        dismissMarkdown = `⚡ **Auto-remediation suggestion dismissed** — the AI-composed command plan will not be run.`;
      } else {
        dismissMarkdown = `⚡ **Auto-remediation suggestion dismissed** — runbook "${suggestion.runbookNameSnapshot || "(not yet picked)"}" will not be run.`;
      }

      await postFeedItem({
        suggestion,
        markdown: dismissMarkdown,
        userId: props.userId!,
        pingWorkspace: alreadyExecutedCount > 0,
      });

      Response.sendJsonObjectResponse(req, res, {
        suggestionId: suggestion.id!.toString(),
        status: AutoRemediationSuggestionStatus.Dismissed,
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

export default router;
