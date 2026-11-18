import AlertSeverityService from "./AlertSeverityService";
import BaseService from "./BaseService";
import DatabaseService from "./DatabaseService";
import IncidentSeverityService from "./IncidentSeverityService";
import ProjectService from "./ProjectService";
import UserCallService from "./UserCallService";
import UserEmailService from "./UserEmailService";
import UserMattermostService from "./UserMattermostService";
import UserMicrosoftTeamsService from "./UserMicrosoftTeamsService";
import UserNotificationRuleAdminService, {
  NotificationMethodReference,
} from "./UserNotificationRuleAdminService";
import UserNotificationRuleService from "./UserNotificationRuleService";
import UserPushService from "./UserPushService";
import UserSlackService from "./UserSlackService";
import UserSmsService from "./UserSmsService";
import UserTelegramService from "./UserTelegramService";
import UserWebhookService from "./UserWebhookService";
import UserWhatsAppService from "./UserWhatsAppService";
import CallerPermission from "../Utils/Permission/CallerPermission";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import Project from "../../Models/DatabaseModels/Project";
import UserNotificationRule from "../../Models/DatabaseModels/UserNotificationRule";
import AuditLogAction from "../../Types/AuditLog/AuditLogAction";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../Types/JSON";
import NotificationRuleType from "../../Types/NotificationRule/NotificationRuleType";
import {
  PagingLadderCell,
  PagingLadderPlan,
  PagingLadderRule,
  PagingLadderRuleToCreate,
  PagingLadderRuleUpdate,
  PagingLadderStep,
  PagingMethodColumn,
  getChannelForPagingMethodColumn,
  getPagingLadderCells,
  getPagingLadderMethodKey,
  getPagingLadderStepsProblem,
  planPagingLadderSave,
  readPagingId,
  readPagingLadder,
  readPagingLadderKeptCells,
  readPagingLadderSteps,
} from "../../Types/NotificationRule/PagingLadder";
import {
  PAGING_LADDER_ADMIN_PERMISSIONS,
  PagingLadderDefaultMemberResult,
  PagingLadderDefaultOutcome,
  PagingLadderDefaultStep,
  PagingLadderFromDefault,
  PagingLadderMethodReference,
  describePagingLadderDefaultResult,
  getChannelsOfPagingLadderSteps,
  getPagingLadderFromDefault,
  readPagingLadderDefault,
} from "../../Types/NotificationRule/PagingLadderDefault";
import ObjectID from "../../Types/ObjectID";
import { OnCallPageChannel } from "../../Types/OnCallDutyPolicy/OnCallPageChannel";
import Permission from "../../Types/Permission";

/*
 * SAVING A PAGING LADDER (#6820, Types/NotificationRule/PagingLadder).
 *
 * A ladder is saved as the grid's own rows: one UserNotificationRule per
 * step in every live card. This is the one place that writes them for a
 * ladder - a person's own page, an admin's view of a member, and the
 * project's default ladder applied to members - in one request, so:
 *
 *   - the rows are planned from what the DATABASE holds (the person's rules
 *     and the project's severities), never from what the page last read;
 *   - rows that already hold a step are kept, and the new rows are written
 *     before the old ones go, so the person is never left with no rule for
 *     a moment in between;
 *   - an admin changing a member's ladder is recorded once per row in the
 *     audit log and tells the member once, not once per card.
 *
 * The writes are made as OneUptime (root), because the checks the rule
 * service's hooks make one write at a time are made here, once, for the
 * whole ladder, with the same code:
 *
 *   - who may: the person themselves, or someone holding the permissions
 *     that may change anybody's rules (the model's own write list);
 *   - R1: the person is a member of the project
 *     (UserNotificationRuleAdminService.assertTargetUserIsProjectMember);
 *   - R3: every method is the person's own, in this project, verified
 *     (webhooks have no verification), or a custom channel that may be used
 *     (assertNotificationMethodsBelongToUser);
 *   - archived severities are never written: the plan leaves them out.
 */

/*
 * Who, besides the person, may change their rules: the write list of
 * UserNotificationRule (ADMIN_WRITE_PERMISSIONS there) without CurrentUser,
 * which every signed-in caller holds. PagingLadderService.test pins the two
 * lists to each other.
 */
export const PAGING_LADDER_ADMIN_WRITE_PERMISSIONS: ReadonlyArray<Permission> =
  PAGING_LADDER_ADMIN_PERMISSIONS;

export const PAGING_LADDER_NOT_ALLOWED_MESSAGE: string =
  "You can change your own ladder. To change a member's, ask a Project Admin, or someone who may edit members' notification rules.";

export const PAGING_LADDER_METHOD_NOT_USABLE_MESSAGE: string =
  "A step names a notification method that is not verified, or is not theirs in this project. Verify it in Notification Methods, or choose another method, then save.";

export const PAGING_LADDER_DEFAULT_NOT_ALLOWED_MESSAGE: string =
  "Only a Project Admin, or someone who may edit members' notification rules, can apply the project's default ladder to members.";

export const PAGING_LADDER_NO_DEFAULT_MESSAGE: string =
  "This project has no default ladder yet. Set one in Project Settings > Notifications > Notification Channels, then apply it.";

export const PAGING_LADDER_DEFAULT_FAILED_MESSAGE: string =
  "The default ladder could not be applied to this member. Try again, or open their How to Reach Me.";

// What a save did.
export interface PagingLadderSaveResult extends JSONObject {
  createdCount: number;
  updatedCount: number;
  deletedCount: number;
  unchangedCount: number;
}

interface OwnedMethodTable {
  column: PagingMethodColumn;
  service: DatabaseService<DatabaseBaseModel>;
  // Webhooks have no verification step, so every one of them is usable.
  hasVerification: boolean;
}

/*
 * The tables of the methods a person owns, by the rule column that points
 * at each. Custom channels are nobody's: the rule service's own check says
 * whether one may be used.
 */
const OWNED_METHOD_TABLES: ReadonlyArray<OwnedMethodTable> = [
  {
    column: "userEmailId",
    service: UserEmailService as unknown as DatabaseService<DatabaseBaseModel>,
    hasVerification: true,
  },
  {
    column: "userSmsId",
    service: UserSmsService as unknown as DatabaseService<DatabaseBaseModel>,
    hasVerification: true,
  },
  {
    column: "userCallId",
    service: UserCallService as unknown as DatabaseService<DatabaseBaseModel>,
    hasVerification: true,
  },
  {
    column: "userPushId",
    service: UserPushService as unknown as DatabaseService<DatabaseBaseModel>,
    hasVerification: true,
  },
  {
    column: "userWhatsAppId",
    service:
      UserWhatsAppService as unknown as DatabaseService<DatabaseBaseModel>,
    hasVerification: true,
  },
  {
    column: "userTelegramId",
    service:
      UserTelegramService as unknown as DatabaseService<DatabaseBaseModel>,
    hasVerification: true,
  },
  {
    column: "userSlackId",
    service: UserSlackService as unknown as DatabaseService<DatabaseBaseModel>,
    hasVerification: true,
  },
  {
    column: "userMicrosoftTeamsId",
    service:
      UserMicrosoftTeamsService as unknown as DatabaseService<DatabaseBaseModel>,
    hasVerification: true,
  },
  {
    column: "userMattermostId",
    service:
      UserMattermostService as unknown as DatabaseService<DatabaseBaseModel>,
    hasVerification: true,
  },
  {
    column: "userWebhookId",
    service:
      UserWebhookService as unknown as DatabaseService<DatabaseBaseModel>,
    hasVerification: false,
  },
];

// The columns a ladder reads off a rule.
const RULE_SELECT: JSONObject = {
  _id: true,
  userId: true,
  projectId: true,
  ruleType: true,
  incidentSeverityId: true,
  alertSeverityId: true,
  notifyAfterMinutes: true,
  isOptOut: true,
  pushNotificationLevel: true,
  repeatEveryMinutes: true,
  userEmailId: true,
  userSmsId: true,
  userCallId: true,
  userPushId: true,
  userWhatsAppId: true,
  userTelegramId: true,
  userSlackId: true,
  userMicrosoftTeamsId: true,
  userMattermostId: true,
  userWebhookId: true,
  customNotificationChannelId: true,
};

// The rule types a ladder writes: the grid's four kinds.
const LADDER_RULE_TYPES: ReadonlyArray<NotificationRuleType> = [
  NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
  NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
  NotificationRuleType.ON_CALL_EXECUTED_ALERT,
  NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
];

export class PagingLadderService extends BaseService {
  public constructor() {
    super();
  }

  /*
   * Whether this caller may change this person's rules: their own always;
   * anybody else's with a permission that may change members' rules.
   */
  public assertMayChangeRulesOf(data: {
    props: DatabaseCommonInteractionProps;
    targetUserId: ObjectID;
  }): void {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    if (
      data.props.userId &&
      data.props.userId.toString() === data.targetUserId.toString()
    ) {
      return;
    }

    if (
      CallerPermission.holdsAnyOf(data.props, [
        ...PAGING_LADDER_ADMIN_WRITE_PERMISSIONS,
      ])
    ) {
      return;
    }

    throw new NotAuthorizedException(PAGING_LADDER_NOT_ALLOWED_MESSAGE);
  }

  // The grid's cards in this project, archived severities marked.
  @CaptureSpan()
  public async getCells(projectId: ObjectID): Promise<Array<PagingLadderCell>> {
    const [incidentSeverities, alertSeverities]: [
      Array<IncidentSeverity>,
      Array<AlertSeverity>,
    ] = await Promise.all([
      IncidentSeverityService.findBy({
        query: { projectId: projectId },
        select: { _id: true, name: true, isArchived: true },
        sort: { order: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      }),
      AlertSeverityService.findBy({
        query: { projectId: projectId },
        select: { _id: true, name: true, isArchived: true },
        sort: { order: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      }),
    ]);

    return getPagingLadderCells({
      incidentSeverities: incidentSeverities,
      alertSeverities: alertSeverities,
    });
  }

  // A person's rules of the grid's four kinds in this project.
  @CaptureSpan()
  public async getRules(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<Array<UserNotificationRule>> {
    const rules: Array<UserNotificationRule> = [];

    for (const ruleType of LADDER_RULE_TYPES) {
      const ofType: Array<UserNotificationRule> =
        await UserNotificationRuleService.findBy({
          query: {
            projectId: data.projectId,
            userId: data.userId,
            ruleType: ruleType,
          },
          select: RULE_SELECT as never,
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        });

      rules.push(...ofType);
    }

    return rules;
  }

  /*
   * The person's methods a rule may name, as "column:id": each one theirs,
   * in this project, and verified (every webhook, which has no
   * verification).
   */
  @CaptureSpan()
  public async getUsableMethodKeys(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<Set<string>> {
    const keys: Set<string> = new Set<string>();

    for (const method of await this.getUsableMethods(data)) {
      keys.add(getPagingLadderMethodKey(method));
    }

    return keys;
  }

  /*
   * The person's methods a rule may name, by column and id, in the order
   * the tables are read: each one theirs, in this project, and verified
   * (every webhook, which has no verification).
   */
  @CaptureSpan()
  public async getUsableMethods(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<Array<PagingLadderMethodReference>> {
    const byTable: Array<Array<PagingLadderMethodReference>> =
      await Promise.all(
        OWNED_METHOD_TABLES.map(
          async (
            table: OwnedMethodTable,
          ): Promise<Array<PagingLadderMethodReference>> => {
            const rows: Array<DatabaseBaseModel> = await table.service.findBy({
              query: {
                projectId: data.projectId,
                userId: data.userId,
                ...(table.hasVerification ? { isVerified: true } : {}),
              } as never,
              select: { _id: true } as never,
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: { isRoot: true },
            });

            const methods: Array<PagingLadderMethodReference> = [];

            for (const row of rows) {
              const id: string = readPagingId(row.id);

              if (id) {
                methods.push({ methodColumn: table.column, methodId: id });
              }
            }

            return methods;
          },
        ),
      );

    return byTable.flat();
  }

  /*
   * Refused unless every step's method may be named on this person's rule:
   * theirs, in the project, verified - or a custom channel that may be used.
   */
  @CaptureSpan()
  public async assertMethodsAreUsable(data: {
    projectId: ObjectID;
    userId: ObjectID;
    steps: ReadonlyArray<PagingLadderStep>;
  }): Promise<void> {
    const usable: Set<string> = await this.getUsableMethodKeys({
      projectId: data.projectId,
      userId: data.userId,
    });

    const references: Array<NotificationMethodReference> = [];

    for (const step of data.steps) {
      references.push({
        idColumn: step.methodColumn,
        suppliedColumn: step.methodColumn,
        label: getChannelForPagingMethodColumn(step.methodColumn),
        methodId: new ObjectID(step.methodId),
      });

      if (step.methodColumn === "customNotificationChannelId") {
        continue;
      }

      if (!usable.has(getPagingLadderMethodKey(step))) {
        throw new BadDataException(PAGING_LADDER_METHOD_NOT_USABLE_MESSAGE);
      }
    }

    // R3, as the rule service's hooks ask it of every rule written.
    await UserNotificationRuleAdminService.assertNotificationMethodsBelongToUser(
      {
        ownerUserId: data.userId,
        references: references,
      },
    );
  }

  /*
   * Saves a ladder as this person's rules: every live card holds its steps
   * and nothing else, but the cards `keepCards` names, which keep their own
   * rules (#8890). `steps` and `keepCards` are what the request sent,
   * checked here.
   */
  @CaptureSpan()
  public async applyLadder(data: {
    projectId: ObjectID;
    targetUserId: ObjectID;
    steps: unknown;
    keepCards?: unknown;
    props: DatabaseCommonInteractionProps;
  }): Promise<PagingLadderSaveResult> {
    const sentSteps: Array<unknown> = Array.isArray(data.steps)
      ? data.steps
      : [];

    const problem: string | null = getPagingLadderStepsProblem(sentSteps);

    if (problem) {
      throw new BadDataException(problem);
    }

    const keepCellKeys: Array<string> = readPagingLadderKeptCells(
      data.keepCards,
    );

    this.assertMayChangeRulesOf({
      props: data.props,
      targetUserId: data.targetUserId,
    });

    const actorUserId: ObjectID | undefined = data.props.userId;

    const isForSomebodyElse: boolean = Boolean(
      actorUserId && actorUserId.toString() !== data.targetUserId.toString(),
    );

    if (isForSomebodyElse) {
      // R1: their rules are written in a project they are a member of.
      await UserNotificationRuleAdminService.assertTargetUserIsProjectMember({
        targetUserId: data.targetUserId,
        props: { ...data.props, tenantId: data.projectId },
      });
    }

    const steps: Array<PagingLadderStep> = readPagingLadderSteps(sentSteps);

    await this.assertMethodsAreUsable({
      projectId: data.projectId,
      userId: data.targetUserId,
      steps: steps,
    });

    const [cells, rules]: [
      Array<PagingLadderCell>,
      Array<UserNotificationRule>,
    ] = await Promise.all([
      this.getCells(data.projectId),
      this.getRules({ projectId: data.projectId, userId: data.targetUserId }),
    ]);

    const plan: PagingLadderPlan = planPagingLadderSave({
      cells: cells,
      rules: rules as unknown as Array<PagingLadderRule>,
      steps: steps,
      keepCellKeys: keepCellKeys,
    });

    const rulesById: Map<string, UserNotificationRule> = new Map<
      string,
      UserNotificationRule
    >();

    for (const rule of rules) {
      rulesById.set(readPagingId(rule.id), rule);
    }

    const changes: Array<{
      action: AuditLogAction;
      ruleId: ObjectID | undefined;
      before?: UserNotificationRule | undefined;
      after?: UserNotificationRule | undefined;
      updatedFields?: JSONObject | undefined;
    }> = [];

    // New rows first, so the person is never without a rule in between.
    for (const toCreate of plan.create) {
      const created: UserNotificationRule =
        await UserNotificationRuleService.create({
          data: this.buildRule({
            projectId: data.projectId,
            userId: data.targetUserId,
            actorUserId: actorUserId,
            rule: toCreate,
          }),
          props: { isRoot: true },
        });

      changes.push({
        action: AuditLogAction.Create,
        ruleId: created.id || undefined,
        after: created,
      });
    }

    for (const update of plan.update) {
      const updatedFields: JSONObject = this.getUpdatedFields(update);

      await UserNotificationRuleService.updateOneById({
        id: new ObjectID(update.id),
        data: updatedFields as never,
        props: { isRoot: true },
      });

      changes.push({
        action: AuditLogAction.Update,
        ruleId: new ObjectID(update.id),
        before: rulesById.get(update.id),
        updatedFields: updatedFields,
      });
    }

    for (const ruleId of plan.delete) {
      await UserNotificationRuleService.deleteOneById({
        id: new ObjectID(ruleId),
        props: { isRoot: true },
      });

      changes.push({
        action: AuditLogAction.Delete,
        ruleId: new ObjectID(ruleId),
        before: rulesById.get(ruleId),
      });
    }

    if (isForSomebodyElse && actorUserId) {
      /*
       * One audit entry per row; one email to the member, however many of
       * their cards changed.
       */
      for (let i: number = 0; i < changes.length; i++) {
        const change: (typeof changes)[number] = changes[i]!;

        await UserNotificationRuleAdminService.recordAdminRuleChange({
          action: change.action,
          actorUserId: actorUserId,
          ownerUserId: data.targetUserId,
          projectId: data.projectId,
          ruleId: change.ruleId,
          before: change.before,
          after: change.after,
          updatedFields: change.updatedFields,
          notifyOwner: i === 0,
          props: { ...data.props, tenantId: data.projectId },
        });
      }
    }

    logger.debug(
      `Paging ladder saved for user ${data.targetUserId.toString()} in project ${data.projectId.toString()}: ${plan.create.length} created, ${plan.update.length} changed, ${plan.delete.length} deleted, ${plan.unchangedCount} kept.`,
    );

    return {
      createdCount: plan.create.length,
      updatedCount: plan.update.length,
      deletedCount: plan.delete.length,
      unchangedCount: plan.unchangedCount,
    };
  }

  /*
   * APPLYING THE PROJECT'S DEFAULT LADDER TO MEMBERS (#7450).
   *
   * Only someone who may change anybody's rules applies it - to anybody,
   * themselves included: it is an admin's action on the project's members,
   * never a member's own. Each member is a member of the project (R1),
   * their ladder is the default mapped to the methods they have verified
   * (getPagingLadderFromDefault: a channel they have not verified is left
   * out and named, and they keep their own steps in its place), and it is
   * saved through applyLadder: its checks once more, its audit entry per
   * row, and its one email to the member. A member who has verified none
   * of the default's channels is skipped, and nothing of theirs changes.
   */
  public assertMayApplyDefault(props: DatabaseCommonInteractionProps): void {
    if (props.isRoot || props.isMasterAdmin) {
      return;
    }

    if (
      CallerPermission.holdsAnyOf(props, [
        ...PAGING_LADDER_ADMIN_WRITE_PERMISSIONS,
      ])
    ) {
      return;
    }

    throw new NotAuthorizedException(PAGING_LADDER_DEFAULT_NOT_ALLOWED_MESSAGE);
  }

  // The project's default ladder, as it is kept; empty for none.
  @CaptureSpan()
  public async getProjectDefault(
    projectId: ObjectID,
  ): Promise<Array<PagingLadderDefaultStep>> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: { defaultPagingLadder: true },
      props: { isRoot: true },
    });

    return readPagingLadderDefault(project?.defaultPagingLadder);
  }

  // One member: the default, as far as their verified methods go.
  @CaptureSpan()
  public async applyDefaultLadder(data: {
    projectId: ObjectID;
    targetUserId: ObjectID;
    props: DatabaseCommonInteractionProps;
    // The project's default, when the caller has read it already.
    defaultSteps?: ReadonlyArray<PagingLadderDefaultStep> | undefined;
  }): Promise<PagingLadderDefaultMemberResult> {
    this.assertMayApplyDefault(data.props);

    const defaultSteps: ReadonlyArray<PagingLadderDefaultStep> =
      data.defaultSteps || (await this.getProjectDefault(data.projectId));

    if (defaultSteps.length === 0) {
      throw new BadDataException(PAGING_LADDER_NO_DEFAULT_MESSAGE);
    }

    // R1, for every member, the caller too: never applied to a non-member.
    await UserNotificationRuleAdminService.assertTargetUserIsProjectMember({
      targetUserId: data.targetUserId,
      props: { ...data.props, tenantId: data.projectId },
    });

    const [methods, cells, rules]: [
      Array<PagingLadderMethodReference>,
      Array<PagingLadderCell>,
      Array<UserNotificationRule>,
    ] = await Promise.all([
      this.getUsableMethods({
        projectId: data.projectId,
        userId: data.targetUserId,
      }),
      this.getCells(data.projectId),
      this.getRules({ projectId: data.projectId, userId: data.targetUserId }),
    ]);

    const fromDefault: PagingLadderFromDefault = getPagingLadderFromDefault({
      defaultSteps: defaultSteps,
      methods: methods,
      currentSteps: readPagingLadder({
        cells: cells,
        rules: rules as unknown as Array<PagingLadderRule>,
      }).steps,
    });

    const keptChannels: Array<OnCallPageChannel> =
      getChannelsOfPagingLadderSteps(fromDefault.keptSteps);

    if (fromDefault.steps.length === 0) {
      return {
        userId: data.targetUserId.toString(),
        outcome: PagingLadderDefaultOutcome.Skipped,
        appliedSteps: [],
        leftOutChannels: fromDefault.leftOutChannels,
        keptChannels: [],
        changedRuleCount: 0,
        message: describePagingLadderDefaultResult({
          outcome: PagingLadderDefaultOutcome.Skipped,
          leftOutChannels: fromDefault.leftOutChannels,
          keptChannels: [],
        }),
      };
    }

    const saved: PagingLadderSaveResult = await this.applyLadder({
      projectId: data.projectId,
      targetUserId: data.targetUserId,
      steps: fromDefault.steps,
      props: data.props,
    });

    return {
      userId: data.targetUserId.toString(),
      outcome: PagingLadderDefaultOutcome.Applied,
      appliedSteps: fromDefault.appliedSteps,
      leftOutChannels: fromDefault.leftOutChannels,
      keptChannels: keptChannels,
      changedRuleCount:
        saved.createdCount + saved.updatedCount + saved.deletedCount,
      message: describePagingLadderDefaultResult({
        outcome: PagingLadderDefaultOutcome.Applied,
        leftOutChannels: fromDefault.leftOutChannels,
        keptChannels: keptChannels,
      }),
    };
  }

  /*
   * Several members, one after another, each on their own: one refused or
   * failing never stops the rest, and is answered for in its own words.
   * Refused as a whole, before anything is read, for a caller who may not
   * apply the default, or a project that has none.
   */
  @CaptureSpan()
  public async applyDefaultLadderToMembers(data: {
    projectId: ObjectID;
    userIds: ReadonlyArray<ObjectID>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<PagingLadderDefaultMemberResult>> {
    this.assertMayApplyDefault(data.props);

    const defaultSteps: Array<PagingLadderDefaultStep> =
      await this.getProjectDefault(data.projectId);

    if (defaultSteps.length === 0) {
      throw new BadDataException(PAGING_LADDER_NO_DEFAULT_MESSAGE);
    }

    const results: Array<PagingLadderDefaultMemberResult> = [];

    for (const userId of data.userIds) {
      try {
        results.push(
          await this.applyDefaultLadder({
            projectId: data.projectId,
            targetUserId: userId,
            props: data.props,
            defaultSteps: defaultSteps,
          }),
        );
      } catch (err) {
        const isExplained: boolean =
          err instanceof BadDataException ||
          err instanceof NotAuthorizedException;

        if (!isExplained) {
          logger.error(err);
        }

        results.push({
          userId: userId.toString(),
          outcome: PagingLadderDefaultOutcome.Failed,
          appliedSteps: [],
          leftOutChannels: [],
          keptChannels: [],
          changedRuleCount: 0,
          message:
            isExplained && (err as Error).message
              ? (err as Error).message
              : PAGING_LADDER_DEFAULT_FAILED_MESSAGE,
        });
      }
    }

    return results;
  }

  // The rule a planned row is, ready to create.
  public buildRule(data: {
    projectId: ObjectID;
    userId: ObjectID;
    actorUserId?: ObjectID | undefined;
    rule: PagingLadderRuleToCreate;
  }): UserNotificationRule {
    const rule: UserNotificationRule = new UserNotificationRule();

    rule.projectId = data.projectId;
    rule.userId = data.userId;
    rule.ruleType = data.rule.ruleType;
    rule.setColumnValue(
      data.rule.severityColumn,
      new ObjectID(data.rule.severityId),
    );
    rule.setColumnValue(
      data.rule.methodColumn,
      new ObjectID(data.rule.methodId),
    );
    rule.notifyAfterMinutes = data.rule.notifyAfterMinutes;
    rule.repeatEveryMinutes = data.rule.repeatEveryMinutes;

    if (data.rule.pushNotificationLevel) {
      rule.pushNotificationLevel = data.rule.pushNotificationLevel;
    }

    if (data.actorUserId) {
      rule.createdByUserId = data.actorUserId;
    }

    return rule;
  }

  // What changes on a row: only what differs.
  public getUpdatedFields(update: PagingLadderRuleUpdate): JSONObject {
    const fields: JSONObject = {};

    if (update.notifyAfterMinutes !== undefined) {
      fields["notifyAfterMinutes"] = update.notifyAfterMinutes;
    }

    if (update.pushNotificationLevel !== undefined) {
      fields["pushNotificationLevel"] = update.pushNotificationLevel;
    }

    if (update.repeatEveryMinutes !== undefined) {
      fields["repeatEveryMinutes"] = update.repeatEveryMinutes;
    }

    return fields;
  }
}

export default new PagingLadderService();
