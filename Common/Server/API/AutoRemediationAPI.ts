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
import { Indigo500 } from "../../Types/BrandColors";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import AutoRemediationSuggestion from "../../Models/DatabaseModels/AutoRemediationSuggestion";
import RunbookExecution from "../../Models/DatabaseModels/RunbookExecution";
import AlertFeedService from "../Services/AlertFeedService";
import AutoRemediationSuggestionService from "../Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../Services/IncidentFeedService";
import RunbookRuleEngineService from "../Services/RunbookRuleEngineService";
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

      if (!suggestion.runbookId || !suggestion.projectId) {
        throw new BadDataException("This suggestion has no runbook to start.");
      }

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

      const execution: RunbookExecution | null =
        await RunbookRuleEngineService.startRunbookFor({
          projectId: suggestion.projectId,
          runbookId: suggestion.runbookId,
          linkage: runbookLinkage,
          triggeredByUserId: props.userId!,
        });

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
          "The proposed runbook could not be started — it may have been disabled or deleted, or it has no steps.",
        );
      }

      await AutoRemediationSuggestionService.updateOneById({
        id: suggestion.id!,
        data: {
          runbookExecutionId: execution.id!,
        },
        props: { isRoot: true },
      });

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

      await postFeedItem({
        suggestion,
        markdown: `⚡ **Auto-remediation suggestion dismissed** — runbook "${suggestion.runbookNameSnapshot || "(not yet picked)"}" will not be run.`,
        userId: props.userId!,
        pingWorkspace: false,
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
