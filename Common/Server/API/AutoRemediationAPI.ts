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
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import AutoRemediationSuggestionStatus from "../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import {
  AiRemediationCommand,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
} from "../../Types/AutoRemediation/AiRemediationCommandPlan";
import { DEFAULT_VERIFICATION_WINDOW_MINUTES } from "../Services/AutoRemediationRuleEngineService";
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
import CommandPlanExecutor from "../Utils/AutoRemediation/CommandPlanExecutor";
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

  if (!props.userId) {
    throw new NotAuthorizedException("A logged-in user session is required.");
  }

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
         * Re-check the project opt-in at approval time. The plan may have
         * been composed hours ago; an operator who has since turned AI
         * command execution off expects that switch to stop pending plans
         * too, not just new ones.
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
          project.enableAutoRemediation === false ||
          project.enableAiCommandExecution !== true
        ) {
          throw new BadDataException(
            "AI command execution is disabled for this project, so this plan cannot be run. Re-enable it in Project Settings → AI, or dismiss the suggestion.",
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
         * than a plan that half-runs into claim timeouts.
         */
        const runnerIds: Array<string> = Array.from(
          new Set(
            plan.commands.map((command: AiRemediationCommand) => {
              return command.runnerId;
            }),
          ),
        );

        for (const runnerId of runnerIds) {
          const runner: Runner | null = await RunnerService.findOneBy({
            query: {
              _id: runnerId,
              projectId: suggestion.projectId,
              canRunAiCommands: true,
            },
            select: { _id: true },
            props: { isRoot: true },
          });

          if (!runner) {
            throw new BadDataException(
              "A Runner this plan targets no longer accepts AI commands (or was deleted). The plan cannot be run — dismiss it and let a new suggestion be composed.",
            );
          }
        }

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
