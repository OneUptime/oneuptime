import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import CloudCostRecommendation from "../../../Models/DatabaseModels/CloudCostRecommendation";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import CloudSavingsAction from "../../../Models/DatabaseModels/CloudSavingsAction";
import Label from "../../../Models/DatabaseModels/Label";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import { CloudSavingKind } from "../../../Types/Cloud/CloudCost";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CloudResourceEnvironmentReading,
  getCloudResourceEnvironment,
} from "../../../Types/Cloud/CloudResourceEnvironment";
import {
  CLOUD_COMMITMENT_PURCHASE_URLS,
  CloudSavingsActionOrigin,
  CloudSavingsActionPlan,
  CloudSavingsActionPlanResult,
  CloudSavingsActionStatus,
  CloudSavingsActionUndo,
  CloudSavingsActionsAccess,
  getCloudSavingsActionPlan,
  getCloudSavingsActionUndo,
  getCloudSavingsActionsAccess,
  isCloudSavingsActionAllowed,
  isCloudSavingsActionInEffect,
} from "../../../Types/Cloud/CloudSavingsAction";
import {
  CloudSavingsActionResult,
  CloudSavingsConnectionState,
  CloudSavingsDeclaredCode,
  CloudSavingsOffer,
} from "../../../Types/Cloud/CloudSavingsApiTypes";
import { SAVINGS_ACTIONS_FIELD_KEY } from "../../../Types/CloudConnection/CloudConnectionCatalog";
import ColumnLength from "../../../Types/Database/ColumnLength";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  DeclaredCode,
  readDeclaredCode,
} from "../../../Utils/AiRemediation/DeclaredCodeChange";
import CloudAccountService from "../../Services/CloudAccountService";
import CloudConnectionService from "../../Services/CloudConnectionService";
import CloudCostRecommendationService from "../../Services/CloudCostRecommendationService";
import CloudResourceService from "../../Services/CloudResourceService";
import CloudSavingsActionService from "../../Services/CloudSavingsActionService";
import ProjectService from "../../Services/ProjectService";
import CloudAiTargets from "../AI/ResourceAccess/CloudAiTargets";
import DeclaredCodeOwner, {
  DeclaredCodeOwnerCandidate,
  getRepositoryFullName,
} from "../AI/Remediation/DeclaredCodeOwner";
import logger from "../Logger";
import CloudSavingsActionRunner, {
  CLOUD_SAVINGS_STEP_LEASE_MS,
  CloudSavingsRunnerOptions,
  clampText,
} from "./CloudSavingsActionRunner";
import {
  CloudSavingsFeedEvent,
  writeCloudSavingsFeed,
} from "./CloudSavingsFeed";
import CloudSavingsOwners, { CloudResourceOwners } from "./CloudSavingsOwners";

/*
 * ACTING ON A SAVING FROM ONEUPTIME (#11010): what the Savings page's
 * Apply does, and its approval card's Approve, Dismiss and Undo.
 *
 *   - offer: what Apply would do, for its dialog - the change, what it
 *     saves, whether it can be undone, who must approve it, and whether the
 *     person asking may; or why it cannot be made from here (the saving is
 *     a commitment, or more than one step; the connection does not allow
 *     it), and, for a resource declared in code, the pull request instead.
 *   - apply: asks for it. Someone who may approve it - an owner of the
 *     resource, or a project admin for a resource nobody owns - makes it at
 *     once, as themself; anyone else's waits on an approval card for an
 *     owner. A change that cannot be undone takes two people's approvals
 *     where the project asks for two (Require Two Approvals for Riskier
 *     Fixes).
 *   - approve, dismiss (with a reason), undo: by an owner (or an admin, for
 *     a resource nobody owns), or by whoever asked or approved it.
 *
 * Every change of state is a claim (CloudSavingsActionService.attempt
 * Transition): of two presses at once exactly one acts. What is made is
 * made through the account's cloud connection, read again at every step
 * (CloudSavingsActionRunner), and is on the resource's and the account's
 * timelines with who approved it and how to undo it.
 */

export const CLOUD_SAVINGS_DISMISS_REASON_REQUIRED: string =
  "Say why the change is dismissed: the owners and the timeline see it.";

// The statuses a change of a saving is still waiting or under way in.
const OPEN_STATUSES: Array<CloudSavingsActionStatus> = [
  CloudSavingsActionStatus.Proposed,
  CloudSavingsActionStatus.Applying,
  CloudSavingsActionStatus.Undoing,
];

const RECOMMENDATION_SELECT: { [key: string]: true } = {
  _id: true,
  projectId: true,
  cloudAccountId: true,
  cloudResourceId: true,
  provider: true,
  recommendationId: true,
  region: true,
  resourceId: true,
  resourceType: true,
  resourceName: true,
  kind: true,
  action: true,
  currentConfiguration: true,
  recommendedConfiguration: true,
  monthlySavings: true,
  currency: true,
};

// Everything about a saving its change is decided on.
export interface CloudSavingContext {
  recommendation: CloudCostRecommendation;
  account: CloudAccount;
  connection: CloudConnection | null;
  resource: CloudResource | null;
  planResult: CloudSavingsActionPlanResult;
  environment: CloudResourceEnvironmentReading;
  access: CloudSavingsActionsAccess;
  connectionState: CloudSavingsConnectionState;
}

export default class CloudSavingsActions {
  /*
   * A saving and everything its change is decided on, read as OneUptime:
   * the person asking may read savings, not connections.
   */
  public static async readSaving(data: {
    projectId: ObjectID;
    cloudCostRecommendationId: ObjectID;
  }): Promise<CloudSavingContext> {
    const recommendation: CloudCostRecommendation | null =
      await CloudCostRecommendationService.findOneBy({
        query: {
          _id: data.cloudCostRecommendationId,
          projectId: data.projectId,
        },
        select: RECOMMENDATION_SELECT,
        props: { isRoot: true },
      });

    if (!recommendation?.id || !recommendation.cloudAccountId) {
      throw new NotFoundException(
        "This saving was not found: the recommender may no longer make it. Refresh the page.",
      );
    }

    return await CloudSavingsActions.readSavingOf({
      projectId: data.projectId,
      recommendation,
    });
  }

  public static async readSavingOf(data: {
    projectId: ObjectID;
    recommendation: CloudCostRecommendation;
    // Accounts and connections already read, by id: the engine reads many savings.
    accounts?: Map<string, CloudAccount> | undefined;
    connections?: Map<string, CloudConnection | null> | undefined;
  }): Promise<CloudSavingContext> {
    const recommendation: CloudCostRecommendation = data.recommendation;
    const accountKey: string = recommendation.cloudAccountId!.toString();
    let account: CloudAccount | null | undefined =
      data.accounts?.get(accountKey);

    if (!account) {
      account = await CloudAccountService.findOneBy({
        query: {
          _id: recommendation.cloudAccountId!,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          name: true,
          accountId: true,
          provider: true,
          environment: true,
          cloudConnectionId: true,
        },
        props: { isRoot: true },
      });
      data.accounts?.set(accountKey, account!);
    }

    if (!account?.id) {
      throw new NotFoundException("The saving's cloud account was not found.");
    }

    const connectionKey: string = account.cloudConnectionId?.toString() || "";
    let connection: CloudConnection | null = null;

    if (connectionKey) {
      if (data.connections?.has(connectionKey)) {
        connection = data.connections.get(connectionKey) || null;
      } else {
        connection = await CloudConnectionService.findOneBy({
          query: { _id: account.cloudConnectionId!, projectId: data.projectId },
          select: { _id: true, config: true, isEnabled: true },
          props: { isRoot: true },
        });
        data.connections?.set(connectionKey, connection);
      }
    }

    const resource: CloudResource | null = recommendation.cloudResourceId
      ? await CloudResourceService.findOneBy({
          query: {
            _id: recommendation.cloudResourceId,
            projectId: data.projectId,
          },
          select: {
            _id: true,
            name: true,
            cloudTags: true,
            providerResourceId: true,
            labels: { name: true },
          },
          props: { isRoot: true },
        })
      : null;

    const planResult: CloudSavingsActionPlanResult = getCloudSavingsActionPlan({
      provider: recommendation.provider,
      kind: recommendation.kind,
      action: recommendation.action,
      resourceId: recommendation.resourceId,
      region: recommendation.region,
      currentConfiguration: recommendation.currentConfiguration,
      recommendedConfiguration: recommendation.recommendedConfiguration,
      accountId: account.accountId,
    });
    const environment: CloudResourceEnvironmentReading =
      getCloudResourceEnvironment({
        tags: resource?.cloudTags,
        accountEnvironment: account.environment,
        labelNames: (resource?.labels || []).map(
          (label: Label): string | undefined => {
            return label.name;
          },
        ),
      });
    const access: CloudSavingsActionsAccess = getCloudSavingsActionsAccess(
      connection?.config
        ? connection.config[SAVINGS_ACTIONS_FIELD_KEY]
        : undefined,
    );

    return {
      recommendation,
      account,
      connection,
      resource,
      planResult,
      environment,
      access,
      connectionState: CloudSavingsActions.getConnectionState({
        connectionId: account.cloudConnectionId,
        connection,
        access,
        plan: planResult.plan,
      }),
    };
  }

  public static getConnectionState(data: {
    connectionId?: ObjectID | undefined;
    connection: CloudConnection | null;
    access: CloudSavingsActionsAccess;
    plan?: CloudSavingsActionPlan | undefined;
  }): CloudSavingsConnectionState {
    if (!data.connectionId) {
      return CloudSavingsConnectionState.NoConnection;
    }

    if (!data.connection?.id || data.connection.isEnabled === false) {
      return CloudSavingsConnectionState.ConnectionOff;
    }

    if (data.access === CloudSavingsActionsAccess.Off) {
      return CloudSavingsConnectionState.SavingsActionsOff;
    }

    if (
      data.plan &&
      !isCloudSavingsActionAllowed(data.access, data.plan.kind)
    ) {
      return CloudSavingsConnectionState.ResizeNotGranted;
    }

    return CloudSavingsConnectionState.Ready;
  }

  // Whether the project asks two approvals of a change that cannot be undone.
  public static async needsTwoApprovals(data: {
    projectId: ObjectID;
    undo: CloudSavingsActionUndo | undefined;
  }): Promise<boolean> {
    if (data.undo !== CloudSavingsActionUndo.Never) {
      return false;
    }

    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: { requireTwoApprovalsForRiskierFixes: true },
      props: { isRoot: true },
    });

    return Boolean(project?.requireTwoApprovalsForRiskierFixes);
  }

  // The change of a saving already waiting or under way, if there is one.
  public static async findOpenAction(data: {
    projectId: ObjectID;
    cloudAccountId: ObjectID;
    recommendationId: string;
  }): Promise<CloudSavingsAction | null> {
    return await CloudSavingsActionService.findOneBy({
      query: {
        projectId: data.projectId,
        cloudAccountId: data.cloudAccountId,
        recommendationId: data.recommendationId,
        status: new Includes(OPEN_STATUSES),
      },
      select: { _id: true, status: true },
      props: { isRoot: true },
    });
  }

  // A resource declared in code, and the repository a pull request would go to.
  public static async getDeclaredInCode(data: {
    projectId: ObjectID;
    resource: CloudResource | null;
  }): Promise<CloudSavingsDeclaredCode | undefined> {
    const managedAs: string | null = CloudAiTargets.getManagedAsCode(
      data.resource?.cloudTags,
    );
    const declared: DeclaredCode | null = readDeclaredCode(managedAs);

    if (!managedAs || !declared || !data.resource) {
      return undefined;
    }

    try {
      const best: DeclaredCodeOwnerCandidate | null = DeclaredCodeOwner.getBest(
        await DeclaredCodeOwner.findCandidates({
          projectId: data.projectId,
          declaredCode: declared,
          resource: {
            name: data.resource.name || "",
            tags: data.resource.cloudTags || {},
          },
        }),
      );

      return {
        managedAs,
        ...(best?.repository.id
          ? {
              codeRepositoryId: best.repository.id.toString(),
              codeRepositoryName: getRepositoryFullName(best.repository),
            }
          : {}),
      };
    } catch (error) {
      logger.error(
        `Cloud savings: the code that declares a resource could not be looked for: ${error}`,
      );
      return { managedAs };
    }
  }

  // What Apply would do, for the dialog that asks.
  public static async offer(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    cloudCostRecommendationId: ObjectID;
  }): Promise<CloudSavingsOffer> {
    const saving: CloudSavingContext = await CloudSavingsActions.readSaving({
      projectId: data.projectId,
      cloudCostRecommendationId: data.cloudCostRecommendationId,
    });
    const recommendation: CloudCostRecommendation = saving.recommendation;
    const plan: CloudSavingsActionPlan | undefined = saving.planResult.plan;
    const owners: CloudResourceOwners = await CloudSavingsOwners.getOwners({
      projectId: data.projectId,
      cloudResourceId: recommendation.cloudResourceId,
    });
    const undo: CloudSavingsActionUndo | undefined = plan
      ? getCloudSavingsActionUndo({
          kind: plan.kind,
          // The dialog starts with the final snapshot ticked.
          finalSnapshot: Boolean(plan.finalSnapshot),
        })
      : undefined;
    const open: CloudSavingsAction | null =
      await CloudSavingsActions.findOpenAction({
        projectId: data.projectId,
        cloudAccountId: saving.account.id!,
        recommendationId: recommendation.recommendationId || "",
      });
    const provider: CloudProvider = recommendation.provider as CloudProvider;

    return {
      cloudCostRecommendationId: recommendation.id!.toString(),
      provider,
      resourceName:
        saving.resource?.name ||
        recommendation.resourceName ||
        recommendation.resourceId ||
        "",
      resourceId: recommendation.resourceId || "",
      resourceType: recommendation.resourceType || "",
      region: recommendation.region || "",
      ...(recommendation.cloudResourceId
        ? { cloudResourceId: recommendation.cloudResourceId.toString() }
        : {}),
      monthlySavings: Number(recommendation.monthlySavings) || 0,
      currency: recommendation.currency || "USD",
      ...(plan
        ? {
            kind: plan.kind,
            from: plan.from,
            to: plan.to,
            restarts: plan.restarts,
            finalSnapshot: plan.finalSnapshot,
            undo,
          }
        : { notOffered: saving.planResult.notOffered }),
      ...(recommendation.kind === CloudSavingKind.Commitment
        ? { purchaseUrl: CLOUD_COMMITMENT_PURCHASE_URLS[provider] }
        : {}),
      connectionState: saving.connectionState,
      ...(saving.account.cloudConnectionId
        ? { cloudConnectionId: saving.account.cloudConnectionId.toString() }
        : {}),
      savingsActionsAccess: saving.access,
      environment: saving.environment.environment,
      environmentSource: saving.environment.source,
      owners: owners.users,
      ownerTeams: owners.teams,
      approvedBy: CloudSavingsOwners.hasOwners(owners) ? "owners" : "admins",
      canApprove: await CloudSavingsOwners.isApprover({
        props: data.props,
        owners,
        projectId: data.projectId,
        cloudResourceId: recommendation.cloudResourceId,
      }),
      canRequest: CloudSavingsOwners.canRequest({
        props: data.props,
        projectId: data.projectId,
      }),
      needsTwoApprovals: await CloudSavingsActions.needsTwoApprovals({
        projectId: data.projectId,
        undo,
      }),
      declaredInCode: plan
        ? await CloudSavingsActions.getDeclaredInCode({
            projectId: data.projectId,
            resource: saving.resource,
          })
        : undefined,
      ...(open?.id
        ? {
            openActionId: open.id.toString(),
            openActionStatus: open.status,
          }
        : {}),
    };
  }

  /*
   * The change a saving is, as a row: what was promised and what the
   * resource was, kept for after the recommender stops saying it.
   */
  public static buildAction(data: {
    projectId: ObjectID;
    saving: CloudSavingContext;
    origin: CloudSavingsActionOrigin;
    finalSnapshot: boolean;
    requestedByUserId?: ObjectID | undefined;
    rule?: { id?: string | undefined; name?: string | undefined } | undefined;
  }): CloudSavingsAction {
    const plan: CloudSavingsActionPlan = data.saving.planResult.plan!;
    const recommendation: CloudCostRecommendation = data.saving.recommendation;
    const action: CloudSavingsAction = new CloudSavingsAction();
    const finalSnapshot: boolean =
      plan.finalSnapshot === "always" ||
      (plan.finalSnapshot === "offered" && data.finalSnapshot);

    action.projectId = data.projectId;
    action.cloudAccountId = data.saving.account.id!;

    if (data.saving.account.cloudConnectionId) {
      action.cloudConnectionId = data.saving.account.cloudConnectionId;
    }

    if (recommendation.cloudResourceId) {
      action.cloudResourceId = recommendation.cloudResourceId;
    }

    action.recommendationId = clampText(
      recommendation.recommendationId || "",
      ColumnLength.LongText,
    );
    action.provider = recommendation.provider as CloudProvider;
    action.kind = plan.kind;
    action.status = CloudSavingsActionStatus.Proposed;
    action.origin = data.origin;
    action.environment = data.saving.environment.environment;
    action.resourceId = clampText(
      recommendation.resourceId || plan.target.id,
      ColumnLength.LongText,
    );
    action.resourceName = clampText(
      data.saving.resource?.name ||
        recommendation.resourceName ||
        plan.target.id,
      ColumnLength.ShortText,
    );
    action.resourceType = clampText(
      recommendation.resourceType || "",
      ColumnLength.ShortText,
    );
    action.region = clampText(
      recommendation.region || "",
      ColumnLength.ShortText,
    );
    action.fromConfiguration = clampText(
      plan.from || "",
      ColumnLength.ShortText,
    );
    action.toConfiguration = clampText(plan.to || "", ColumnLength.ShortText);
    action.finalSnapshot = finalSnapshot;
    action.undo = getCloudSavingsActionUndo({ kind: plan.kind, finalSnapshot });
    action.monthlySavings = Math.max(
      0,
      Number(recommendation.monthlySavings) || 0,
    );
    action.currency = recommendation.currency || "USD";
    action.target = plan.target as unknown as JSONObject;
    action.progress = {};
    action.undoProgress = {};

    if (data.requestedByUserId) {
      action.requestedByUserId = data.requestedByUserId;
    }

    if (data.rule?.id) {
      action.autoRemediationRuleId = new ObjectID(data.rule.id);
    }

    if (data.rule?.name) {
      action.autoRemediationRuleName = clampText(
        data.rule.name,
        ColumnLength.ShortText,
      );
    }

    return action;
  }

  /*
   * Apply, pressed on a saving: the change is asked for - and made at once
   * when the person may approve it and no second approval is needed.
   */
  public static async apply(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    cloudCostRecommendationId: ObjectID;
    finalSnapshot?: unknown;
    runner?: CloudSavingsRunnerOptions | undefined;
  }): Promise<CloudSavingsActionResult> {
    const userId: ObjectID | undefined = data.props.userId;

    if (!userId) {
      throw new NotAuthorizedException("Sign in to act on a saving.");
    }

    if (
      !CloudSavingsOwners.canRequest({
        props: data.props,
        projectId: data.projectId,
      })
    ) {
      throw new NotAuthorizedException(
        "You may not act on this project's savings: it takes permission to edit its cloud resources.",
      );
    }

    const saving: CloudSavingContext = await CloudSavingsActions.readSaving({
      projectId: data.projectId,
      cloudCostRecommendationId: data.cloudCostRecommendationId,
    });

    CloudSavingsActions.assertCanBeMade(saving);

    const open: CloudSavingsAction | null =
      await CloudSavingsActions.findOpenAction({
        projectId: data.projectId,
        cloudAccountId: saving.account.id!,
        recommendationId: saving.recommendation.recommendationId || "",
      });

    if (open?.id) {
      return { actionId: open.id.toString(), status: open.status! };
    }

    const action: CloudSavingsAction = CloudSavingsActions.buildAction({
      projectId: data.projectId,
      saving,
      origin: CloudSavingsActionOrigin.Person,
      finalSnapshot: data.finalSnapshot !== false,
      requestedByUserId: userId,
    });
    const created: CloudSavingsAction = await CloudSavingsActionService.create({
      data: action,
      props: { isRoot: true },
    });
    const owners: CloudResourceOwners = await CloudSavingsOwners.getOwners({
      projectId: data.projectId,
      cloudResourceId: created.cloudResourceId,
    });

    if (
      !(await CloudSavingsOwners.isApprover({
        props: data.props,
        owners,
        projectId: data.projectId,
        cloudResourceId: created.cloudResourceId,
      }))
    ) {
      await writeCloudSavingsFeed({
        event: CloudSavingsFeedEvent.Proposed,
        action: created,
        userId,
      });

      return {
        actionId: created.id!.toString(),
        status: CloudSavingsActionStatus.Proposed,
      };
    }

    return await CloudSavingsActions.approve({
      props: data.props,
      projectId: data.projectId,
      actionId: created.id!,
      runner: data.runner,
      owners,
    });
  }

  // Refused with why, before anything is asked of the cloud.
  public static assertCanBeMade(saving: CloudSavingContext): void {
    if (!saving.planResult.plan) {
      throw new BadDataException(
        "OneUptime cannot make this change from here. Make it in your cloud's console.",
      );
    }

    switch (saving.connectionState) {
      case CloudSavingsConnectionState.Ready:
        return;
      case CloudSavingsConnectionState.NoConnection:
        throw new BadDataException(
          "This account was found through no cloud connection, so OneUptime cannot change it.",
        );
      case CloudSavingsConnectionState.ConnectionOff:
        throw new BadDataException(
          "The account's cloud connection is gone or turned off, so OneUptime cannot change it.",
        );
      case CloudSavingsConnectionState.SavingsActionsOff:
        throw new BadDataException(
          'Turn on "Savings actions" on the account\'s cloud connection and run its updated setup command: it grants the narrow access this needs.',
        );
      case CloudSavingsConnectionState.ResizeNotGranted:
        throw new BadDataException(
          "Set the account's cloud connection's Savings actions to \"Stop, start, clean up and resize\" and run its updated setup command: resizing restarts the resource, so it is granted on its own.",
        );
    }
  }

  // The change, read for a person's approve, dismiss or undo.
  private static async readAction(data: {
    projectId: ObjectID;
    actionId: ObjectID;
  }): Promise<CloudSavingsAction> {
    const action: CloudSavingsAction | null =
      await CloudSavingsActionService.findOneBy({
        query: { _id: data.actionId, projectId: data.projectId },
        select: {
          _id: true,
          projectId: true,
          cloudAccountId: true,
          cloudResourceId: true,
          cloudOffHoursScheduleId: true,
          kind: true,
          status: true,
          origin: true,
          undo: true,
          resourceId: true,
          resourceName: true,
          monthlySavings: true,
          currency: true,
          requestedByUserId: true,
          approvedByUserId: true,
          firstApprovedByUserId: true,
          progress: true,
          autoRemediationRuleName: true,
        },
        props: { isRoot: true },
      });

    if (!action?.id) {
      throw new NotFoundException("This change was not found.");
    }

    return action;
  }

  private static refuseApprover(
    owners: CloudResourceOwners,
  ): NotAuthorizedException {
    return new NotAuthorizedException(
      CloudSavingsOwners.hasOwners(owners)
        ? "Only an owner of the resource can approve or undo this change."
        : "Nobody owns this resource, so only a Project Owner or Project Admin can approve or undo this change.",
    );
  }

  /*
   * An owner's approval: the change is made as them, at once - or, for a
   * change that cannot be undone where the project asks for two, recorded
   * as the first of two.
   */
  public static async approve(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    actionId: ObjectID;
    runner?: CloudSavingsRunnerOptions | undefined;
    owners?: CloudResourceOwners | undefined;
  }): Promise<CloudSavingsActionResult> {
    const userId: ObjectID | undefined = data.props.userId;
    const action: CloudSavingsAction =
      await CloudSavingsActions.readAction(data);

    if (action.status !== CloudSavingsActionStatus.Proposed) {
      throw new BadDataException(
        "This change is no longer waiting for an approval. Refresh the page.",
      );
    }

    const owners: CloudResourceOwners =
      data.owners ||
      (await CloudSavingsOwners.getOwners({
        projectId: data.projectId,
        cloudResourceId: action.cloudResourceId,
      }));

    if (
      !userId ||
      !CloudSavingsOwners.canApprove({
        props: data.props,
        owners,
        projectId: data.projectId,
      })
    ) {
      throw CloudSavingsActions.refuseApprover(owners);
    }

    await CloudSavingsOwners.assertMayChangeResource({
      props: data.props,
      projectId: data.projectId,
      cloudResourceId: action.cloudResourceId,
    });

    const now: Date = data.runner?.now || OneUptimeDate.getCurrentDate();
    const first: string = action.firstApprovedByUserId?.toString() || "";

    if (
      await CloudSavingsActions.needsTwoApprovals({
        projectId: data.projectId,
        undo: action.undo,
      })
    ) {
      if (!first) {
        const recorded: number =
          await CloudSavingsActionService.attemptTransition({
            actionId: action.id!,
            fromStatuses: [CloudSavingsActionStatus.Proposed],
            set: {
              status: CloudSavingsActionStatus.Proposed,
              firstApprovedByUserId: userId.toString(),
              firstApprovedAt: now,
            },
            whileFirstApprovedBy: null,
          });

        if (recorded === 0) {
          throw new BadDataException(
            "Someone else approved this change at the same moment. Refresh the page.",
          );
        }

        return {
          actionId: action.id!.toString(),
          status: CloudSavingsActionStatus.Proposed,
          waitsForSecondApproval: true,
        };
      }

      if (first === userId.toString()) {
        throw new BadDataException(
          "You approved this change already. It cannot be undone, so a second person must approve it too.",
        );
      }
    }

    const claimed: number = await CloudSavingsActionService.attemptTransition({
      actionId: action.id!,
      fromStatuses: [CloudSavingsActionStatus.Proposed],
      set: {
        status: CloudSavingsActionStatus.Applying,
        approvedByUserId: userId.toString(),
        approvedAt: now,
        nextStepAt: OneUptimeDate.addRemoveSeconds(
          now,
          CLOUD_SAVINGS_STEP_LEASE_MS / 1000,
        ),
      },
      ...(first ? { whileFirstApprovedBy: first } : {}),
    });

    if (claimed === 0) {
      throw new BadDataException(
        "Someone else acted on this change at the same moment. Refresh the page.",
      );
    }

    return await CloudSavingsActions.stepAndAnswer(action.id!, data.runner);
  }

  private static async stepAndAnswer(
    actionId: ObjectID,
    runner?: CloudSavingsRunnerOptions | undefined,
  ): Promise<CloudSavingsActionResult> {
    await CloudSavingsActionRunner.advance(actionId, runner || {});

    const after: CloudSavingsAction | null =
      await CloudSavingsActionService.findOneById({
        id: actionId,
        select: { status: true, summary: true, failureMessage: true },
        props: { isRoot: true },
      });

    return {
      actionId: actionId.toString(),
      status: after?.status || CloudSavingsActionStatus.Applying,
      summary:
        after?.status === CloudSavingsActionStatus.Failed
          ? after.failureMessage || undefined
          : after?.summary || undefined,
    };
  }

  // A person's no, with why: by an owner, or whoever asked for it.
  public static async dismiss(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    actionId: ObjectID;
    reason: unknown;
  }): Promise<CloudSavingsActionResult> {
    const userId: ObjectID | undefined = data.props.userId;
    const reason: string =
      typeof data.reason === "string" ? data.reason.trim() : "";

    if (!reason) {
      throw new BadDataException(CLOUD_SAVINGS_DISMISS_REASON_REQUIRED);
    }

    const action: CloudSavingsAction =
      await CloudSavingsActions.readAction(data);

    if (action.status !== CloudSavingsActionStatus.Proposed) {
      throw new BadDataException(
        "This change is no longer waiting for an approval. Refresh the page.",
      );
    }

    const owners: CloudResourceOwners = await CloudSavingsOwners.getOwners({
      projectId: data.projectId,
      cloudResourceId: action.cloudResourceId,
    });
    const asked: boolean =
      Boolean(userId) &&
      action.requestedByUserId?.toString() === userId!.toString();

    if (
      !userId ||
      (!asked &&
        !CloudSavingsOwners.canApprove({
          props: data.props,
          owners,
          projectId: data.projectId,
        }))
    ) {
      throw CloudSavingsActions.refuseApprover(owners);
    }

    const now: Date = OneUptimeDate.getCurrentDate();
    const dismissReason: string = clampText(reason, ColumnLength.LongText);
    const claimed: number = await CloudSavingsActionService.attemptTransition({
      actionId: action.id!,
      fromStatuses: [CloudSavingsActionStatus.Proposed],
      set: {
        status: CloudSavingsActionStatus.Dismissed,
        dismissedByUserId: userId.toString(),
        dismissedAt: now,
        dismissReason,
      },
    });

    if (claimed === 0) {
      throw new BadDataException(
        "Someone else acted on this change at the same moment. Refresh the page.",
      );
    }

    await writeCloudSavingsFeed({
      event: CloudSavingsFeedEvent.Dismissed,
      action: { ...action, dismissReason } as CloudSavingsAction,
      userId,
    });

    return {
      actionId: action.id!.toString(),
      status: CloudSavingsActionStatus.Dismissed,
    };
  }

  /*
   * Takes a change back: by an owner, or whoever approved it. What cannot
   * be undone says why.
   */
  public static async undo(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    actionId: ObjectID;
    runner?: CloudSavingsRunnerOptions | undefined;
  }): Promise<CloudSavingsActionResult> {
    const userId: ObjectID | undefined = data.props.userId;
    const action: CloudSavingsAction =
      await CloudSavingsActions.readAction(data);

    if (!isCloudSavingsActionInEffect(action.status)) {
      throw new BadDataException(
        "Only a change that was made and stands can be undone. Refresh the page.",
      );
    }

    if (action.undo === CloudSavingsActionUndo.Never) {
      throw new BadDataException(
        "This change cannot be undone: what it deleted or released is gone.",
      );
    }

    const owners: CloudResourceOwners = await CloudSavingsOwners.getOwners({
      projectId: data.projectId,
      cloudResourceId: action.cloudResourceId,
    });
    const approved: boolean =
      Boolean(userId) &&
      action.approvedByUserId?.toString() === userId!.toString();

    if (
      !userId ||
      (!approved &&
        !CloudSavingsOwners.canApprove({
          props: data.props,
          owners,
          projectId: data.projectId,
        }))
    ) {
      throw CloudSavingsActions.refuseApprover(owners);
    }

    await CloudSavingsOwners.assertMayChangeResource({
      props: data.props,
      projectId: data.projectId,
      cloudResourceId: action.cloudResourceId,
    });

    const now: Date = data.runner?.now || OneUptimeDate.getCurrentDate();
    const claimed: number = await CloudSavingsActionService.attemptTransition({
      actionId: action.id!,
      fromStatuses: [action.status!],
      set: {
        status: CloudSavingsActionStatus.Undoing,
        undoneByUserId: userId.toString(),
        undoProgress: { from: action.status! },
        nextStepAt: OneUptimeDate.addRemoveSeconds(
          now,
          CLOUD_SAVINGS_STEP_LEASE_MS / 1000,
        ),
      },
    });

    if (claimed === 0) {
      throw new BadDataException(
        "Someone else acted on this change at the same moment. Refresh the page.",
      );
    }

    return await CloudSavingsActions.stepAndAnswer(action.id!, data.runner);
  }

  /*
   * ---------------------------------------------------------------------------
   * What AI rules for savings propose and make (CloudSavingsAiEngine)
   * ---------------------------------------------------------------------------
   */

  /*
   * A proposal for an owner, from a rule (or the project's defaults), with
   * why it is proposed rather than made: the approval card shows it.
   */
  public static async propose(data: {
    projectId: ObjectID;
    saving: CloudSavingContext;
    rule?: { id?: string | undefined; name?: string | undefined } | undefined;
    reason?: string | undefined;
  }): Promise<CloudSavingsAction> {
    const action: CloudSavingsAction = CloudSavingsActions.buildAction({
      projectId: data.projectId,
      saving: data.saving,
      origin: CloudSavingsActionOrigin.Rule,
      finalSnapshot: true,
      rule: data.rule,
    });

    if (data.reason) {
      action.summary = clampText(data.reason, ColumnLength.LongText);
    }

    const created: CloudSavingsAction = await CloudSavingsActionService.create({
      data: action,
      props: { isRoot: true },
    });

    await writeCloudSavingsFeed({
      event: CloudSavingsFeedEvent.Proposed,
      action: created,
    });

    return created;
  }

  /*
   * A change an AI rule makes without asking: Applying from now, taken
   * through its steps by the worker - never in the read that found it. A
   * deleted disk always gets its final snapshot.
   */
  public static async makeWithoutAsking(data: {
    projectId: ObjectID;
    saving: CloudSavingContext;
    rule: { id?: string | undefined; name?: string | undefined };
    now: Date;
  }): Promise<CloudSavingsAction> {
    const action: CloudSavingsAction = CloudSavingsActions.buildAction({
      projectId: data.projectId,
      saving: data.saving,
      origin: CloudSavingsActionOrigin.Rule,
      finalSnapshot: true,
      rule: data.rule,
    });

    action.status = CloudSavingsActionStatus.Applying;
    action.nextStepAt = data.now;

    return await CloudSavingsActionService.create({
      data: action,
      props: { isRoot: true },
    });
  }

  /*
   * The proposals of an account's savings the recommender no longer makes -
   * done in the console, dismissed there, or no longer true - expire: there
   * is nothing to approve. A change already under way is left to finish.
   */
  public static async expireGone(data: {
    projectId: ObjectID;
    cloudAccountIds: Array<ObjectID>;
    currentRecommendationIds: Set<string>;
    now: Date;
  }): Promise<number> {
    if (data.cloudAccountIds.length === 0) {
      return 0;
    }

    const waiting: Array<CloudSavingsAction> =
      await CloudSavingsActionService.findBy({
        query: {
          projectId: data.projectId,
          cloudAccountId: new Includes(data.cloudAccountIds),
          status: CloudSavingsActionStatus.Proposed,
        },
        select: { _id: true, recommendationId: true },
        skip: 0,
        limit: 1000,
        props: { isRoot: true },
      });
    let expired: number = 0;

    for (const action of waiting) {
      if (
        !action.id ||
        !action.recommendationId ||
        data.currentRecommendationIds.has(action.recommendationId)
      ) {
        continue;
      }

      expired += await CloudSavingsActionService.attemptTransition({
        actionId: action.id,
        fromStatuses: [CloudSavingsActionStatus.Proposed],
        set: {
          status: CloudSavingsActionStatus.Expired,
          expiredAt: data.now,
          summary:
            "No longer needed: the recommender no longer makes this saving.",
        },
      });
    }

    return expired;
  }
}
