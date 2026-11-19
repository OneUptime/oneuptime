import ProjectReferencesService from "./ProjectReferencesService";
import OnCallDutyPolicyExecutionLogService from "./OnCallDutyPolicyExecutionLogService";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import OnCallDutyPolicyStatus from "../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { ON_CALL_RUN_SCHEDULED_MESSAGE } from "../../Types/OnCallDutyPolicy/OnCallRunStart";
import { OnCallPolicyAiHoldOutcome } from "../../Types/OnCallDutyPolicy/OnCallPolicyAiHold";
import UserNotificationEventType from "../../Types/UserNotification/UserNotificationEventType";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import DatabaseConfig from "../DatabaseConfig";
import URL from "../../Types/API/URL";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OnCallDutyPolicySchedule from "../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleService from "./OnCallDutyPolicyScheduleService";
import TeamService from "./TeamService";
import Team from "../../Models/DatabaseModels/Team";
import OnCallDutyPolicyEscalationRuleUser from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicyEscalationRuleUserService from "./OnCallDutyPolicyEscalationRuleUserService";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OnCallDutyPolicyEscalationRuleTeam from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleTeamService from "./OnCallDutyPolicyEscalationRuleTeamService";
import QueryHelper from "../Types/Database/QueryHelper";
import OnCallDutyPolicyEscalationRuleSchedule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleScheduleService from "./OnCallDutyPolicyEscalationRuleScheduleService";
import OnDutyPoliciesCache from "../Utils/OnCall/OnDutyPoliciesCache";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import NotificationRuleWorkspaceChannel from "../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import WorkspaceNotificationRuleService, {
  MessageBlocksByWorkspaceType,
  WorkspaceChannelsCreated,
} from "./WorkspaceNotificationRuleService";
import ChannelMembersNotAddedNotice from "../Utils/Workspace/LiveMessages/ChannelMembersNotAddedNotice";
import logger, { LogAttributes } from "../Utils/Logger";
import ProductAnalytics from "../Utils/ProductAnalytics";
import OnCallDutyPolicyWorkspaceMessages from "../Utils/Workspace/WorkspaceMessages/OnCallDutyPolicy";
import OnCallDutyPolicyFeedService from "./OnCallDutyPolicyFeedService";
import { OnCallDutyPolicyFeedEventType } from "../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import { Green500 } from "../../Types/BrandColors";
import OnCallDutyPolicyLabelRuleEngineService from "./OnCallDutyPolicyLabelRuleEngineService";
import OnCallDutyPolicyOwnerRuleEngineService from "./OnCallDutyPolicyOwnerRuleEngineService";
import OnCallDutyPolicyEscalationRuleService from "./OnCallDutyPolicyEscalationRuleService";
import TeamMemberService from "./TeamMemberService";
import CreateBy from "../Types/Database/CreateBy";
import CreatePermission from "../Types/Database/Permissions/CreatePermission";
import BasePermission from "../Types/Database/Permissions/BasePermission";
import OwnedScopePermission from "../Types/Database/Permissions/OwnedScopePermission";
import DatabaseService, { PendingRecord } from "./DatabaseService";
import { resolveReferenceIds } from "../Utils/Database/ProjectScopedReferenceRefusal";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import OwnerRuleAssignment from "../Utils/Rules/OwnerRuleAssignment";
import OnCallDutyPolicyEscalationRule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PositiveNumber from "../../Types/PositiveNumber";
import { JSONObject } from "../../Types/JSON";
import { DEFAULT_ESCALATE_AFTER_IN_MINUTES } from "../../Types/OnCallDutyPolicy/EscalationRuleDefaults";
import {
  getEveryNewAlertRuleDescription,
  getEveryNewAlertRuleName,
  getEveryNewIncidentRuleDescription,
  getEveryNewIncidentRuleName,
  readEveryNewEventRulesLanguage,
  readPageForEveryNewIncidentAndAlert,
} from "../../Types/OnCallDutyPolicy/EveryNewEventRules";
import { Translator } from "../../Types/Translator";
import { getRecordWordsTranslator } from "../Utils/ServerTranslation";
import UserLanguage from "../Utils/Notification/UserLanguage";
import IncidentOnCallRule from "../../Models/DatabaseModels/IncidentOnCallRule";
import AlertOnCallRule from "../../Models/DatabaseModels/AlertOnCallRule";
import IncidentOnCallRuleService from "./IncidentOnCallRuleService";
import AlertOnCallRuleService from "./AlertOnCallRuleService";
import {
  FIRST_RESPONDER_KEYS,
  FirstResponderIds,
  FirstResponderKey,
  readFirstResponderIds,
} from "../../Types/OnCallDutyPolicy/FirstResponders";
import FeedMarkdown, { mdText } from "../../Utils/Markdown/FeedMarkdown";
import UpdateBy from "../Types/Database/UpdateBy";
import { getOnCallAcknowledgementTimeoutRefusal } from "../../Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
import ColumnRuleCheck, { ColumnRule } from "../Utils/Database/ColumnRuleCheck";
import {
  ON_CALL_POLICY_REPEAT_COLUMNS,
  getOnCallPolicyRepeatRefusal,
} from "../../Types/OnCallDutyPolicy/OnCallDutyPolicyRepeat";
import UniqueNameInProject, {
  UniqueNameRules,
} from "../Utils/Database/UniqueNameInProject";
import {
  ARCHIVED_ON_CALL_POLICY_NAME_TAKEN_REFUSAL,
  ON_CALL_POLICIES_RENAMED_TOGETHER_REFUSAL,
  ON_CALL_POLICY_NAME_TAKEN_REFUSAL,
  getNameTakenRefusalText,
} from "../../Types/Database/UniqueName";
import SortOrder from "../../Types/BaseDatabase/SortOrder";

// A join row of a new policy's first escalation rule, and its model.
interface FirstResponderJoin {
  modelType: { new (): BaseModel };
  row: BaseModel;
}

/*
 * A policy that says it repeats starts again at least once: the switch on
 * with 0 times is refused however it is saved, as the Repeat Policy card
 * never makes it (Types/OnCallDutyPolicy/OnCallDutyPolicyRepeat).
 */
export const ON_CALL_POLICY_REPEAT_RULE: ColumnRule = {
  columns: ON_CALL_POLICY_REPEAT_COLUMNS,
  getRefusal: (values: Record<string, unknown>): string | null => {
    return getOnCallPolicyRepeatRefusal(values);
  },
};

/*
 * The escalation rules that page someone in a project, by kind: their own,
 * their teams' and their schedules' (getOnCallPoliciesWhereUserIsOnCallDuty).
 */
export interface OnDutyPolicies {
  escalationRulesByUser: Array<OnCallDutyPolicyEscalationRuleUser>;
  escalationRulesByTeam: Array<OnCallDutyPolicyEscalationRuleTeam>;
  escalationRulesBySchedule: Array<OnCallDutyPolicyEscalationRuleSchedule>;
}

// A project's answers are kept and handed back by its id, lower-cased.
const projectKeyOf: (projectId: ObjectID) => string = (
  projectId: ObjectID,
): string => {
  return projectId.toString().toLowerCase();
};

// What a project where nothing pages the person answers.
const noOnDutyPolicies: () => OnDutyPolicies = (): OnDutyPolicies => {
  return {
    escalationRulesByUser: [],
    escalationRulesByTeam: [],
    escalationRulesBySchedule: [],
  };
};

export class Service extends ProjectReferencesService<OnCallDutyPolicy> {
  public constructor() {
    super(OnCallDutyPolicy);
  }

  /*
   * WHO GETS PAGED FIRST.
   *
   * A policy created with first responders in its misc data (the create
   * form's "Who gets paged first?", or an API caller) gets its first
   * escalation rule straight away: Level 1, paging them, waiting 30 minutes
   * for an acknowledgement before the next level - what adding that rule on
   * the Escalation Rules page would have made. With nobody to page, nothing
   * changes: the policy is created without rules, as it always was.
   *
   * The rule is added after the whole create, not in onCreateSuccess: by then
   * the creator owns the policy (DatabaseService.create adds them as an owner
   * after the success hook), so a teammate whose access is limited to the
   * policies they own may add its rules - the rule is created as them, with
   * the same checks, plan limits and notifications as adding it by hand.
   *
   * What can be checked before anything is saved is checked first: the
   * picks' shape, whether the caller may add escalation rules and those
   * responders, and whether every responder belongs to this project. A
   * refused pick refuses the create, so nobody gets a policy that pages
   * nobody when they asked for someone. What fails after the policy is
   * saved is logged, and the policy is kept: it shows on its Escalation
   * Rules page that it has no rules yet.
   */
  @CaptureSpan()
  public override async create(
    createBy: CreateBy<OnCallDutyPolicy>,
  ): Promise<OnCallDutyPolicy> {
    const firstResponders: FirstResponderIds | null = createBy.props.ignoreHooks
      ? null
      : readFirstResponderIds(createBy.miscDataProps);

    const pageForEveryNewIncidentAndAlert: boolean = createBy.props.ignoreHooks
      ? false
      : readPageForEveryNewIncidentAndAlert(createBy.miscDataProps);

    if (firstResponders) {
      await this.checkFirstRespondersCanBePaged({
        responders: firstResponders,
        projectId: createBy.props.tenantId || createBy.data.projectId,
        props: createBy.props,
        policy: createBy.data,
      });
    }

    if (pageForEveryNewIncidentAndAlert) {
      this.checkEveryNewEventRulesCanBeAdded({
        projectId: createBy.props.tenantId || createBy.data.projectId,
        props: createBy.props,
      });
    }

    const createdPolicy: OnCallDutyPolicy = await super.create(createBy);

    if (firstResponders) {
      await this.addFirstEscalationRule({
        policy: createdPolicy,
        responders: firstResponders,
        props: createBy.props,
      });
    }

    if (pageForEveryNewIncidentAndAlert) {
      await this.addEveryNewEventRules({
        policy: createdPolicy,
        props: createBy.props,
        translator: getRecordWordsTranslator(
          await this.readEveryNewEventRulesLanguage(createBy),
        ),
      });
    }

    return createdPolicy;
  }

  /*
   * THE LANGUAGE THE TWO RULES ARE WORDED IN (#7995): the one the create
   * says it was made in (EVERY_NEW_EVENT_RULES_LANGUAGE_KEY - the language
   * the Dashboard is read in, or Ask AI's request's), else the creator's
   * saved language (User.language), else English. A language OneUptime does
   * not write in is not one: the saved one, or English, stands. A read that
   * fails is English: a policy is never held back for its rules' words.
   */
  public async readEveryNewEventRulesLanguage(
    createBy: Pick<CreateBy<OnCallDutyPolicy>, "miscDataProps" | "props">,
  ): Promise<string> {
    const requested: string | undefined = readEveryNewEventRulesLanguage(
      createBy.miscDataProps,
    );

    if (requested) {
      return requested;
    }

    return await UserLanguage.getLanguage(createBy.props.userId);
  }

  /*
   * PAGE IT FOR EVERY NEW INCIDENT AND ALERT (EveryNewEventRules).
   *
   * Refuses, before the policy is saved, a caller who asked for the two
   * on-call rules but may not add them: the same check each rule's own
   * create runs first. Nobody gets a policy that pages nobody when they
   * asked for it to be paged. Root and master admin callers pass. Throws;
   * returns nothing.
   */
  public checkEveryNewEventRulesCanBeAdded(data: {
    projectId: ObjectID | undefined | null;
    props: DatabaseCommonInteractionProps;
  }): void {
    if (!data.projectId) {
      throw new BadDataException(
        "A project is required to page a new on-call policy for every incident and alert.",
      );
    }

    const projectId: ObjectID = new ObjectID(data.projectId.toString());
    // Not known yet; any id checks the same column permissions.
    const placeholder: OnCallDutyPolicy = new OnCallDutyPolicy();
    placeholder.id = ObjectID.getZeroObjectID();

    CreatePermission.checkCreatePermissions(
      IncidentOnCallRule,
      this.getEveryNewIncidentRule({
        projectId: projectId,
        policy: placeholder,
      }),
      data.props,
    );

    CreatePermission.checkCreatePermissions(
      AlertOnCallRule,
      this.getEveryNewAlertRule({
        projectId: projectId,
        policy: placeholder,
      }),
      data.props,
    );
  }

  /*
   * The incident on-call rule that pages `policy` for every new incident,
   * named and described by `translator` (English without one).
   */
  private getEveryNewIncidentRule(data: {
    projectId: ObjectID;
    policy: OnCallDutyPolicy;
    translator?: Translator | undefined;
  }): IncidentOnCallRule {
    const rule: IncidentOnCallRule = new IncidentOnCallRule();
    rule.projectId = data.projectId;
    rule.name = getEveryNewIncidentRuleName(data.policy.name, data.translator);
    rule.description = getEveryNewIncidentRuleDescription(data.translator);
    rule.isEnabled = true;
    // No monitors, severities, labels or patterns: it matches every incident.
    rule.onCallDutyPolicies = [this.getPolicyReference(data.policy)];

    return rule;
  }

  // The alert on-call rule that pages `policy` for every new alert.
  private getEveryNewAlertRule(data: {
    projectId: ObjectID;
    policy: OnCallDutyPolicy;
    translator?: Translator | undefined;
  }): AlertOnCallRule {
    const rule: AlertOnCallRule = new AlertOnCallRule();
    rule.projectId = data.projectId;
    rule.name = getEveryNewAlertRuleName(data.policy.name, data.translator);
    rule.description = getEveryNewAlertRuleDescription(data.translator);
    rule.isEnabled = true;
    rule.onCallDutyPolicies = [this.getPolicyReference(data.policy)];

    return rule;
  }

  // The policy as a rule names it: its id alone.
  private getPolicyReference(policy: OnCallDutyPolicy): OnCallDutyPolicy {
    const reference: OnCallDutyPolicy = new OnCallDutyPolicy();
    reference.id = new ObjectID(policy.id!.toString());

    return reference;
  }

  /*
   * Adds the two on-call rules of a policy just created: one paging it for
   * every new incident, one for every new alert. Each is created as the
   * caller, with the same checks as adding it on its Rules page, and on
   * its own: one that fails is logged and the other still added. Never
   * throws: the policy is saved already, and it shows on the Rules pages
   * whether it is paged. Named and described by `translator`, in the
   * creator's language (readEveryNewEventRulesLanguage); English without.
   */
  @CaptureSpan()
  public async addEveryNewEventRules(data: {
    policy: OnCallDutyPolicy;
    props: DatabaseCommonInteractionProps;
    translator?: Translator | undefined;
  }): Promise<void> {
    const policyId: ObjectID | null | undefined = data.policy.id;
    const projectId: ObjectID | undefined = data.policy.projectId;

    if (!policyId || !projectId) {
      logger.error(
        "Error adding the on-call rules of a new on-call policy in OnCallDutyPolicyService.addEveryNewEventRules: the new on-call policy has no id or project.",
      );
      return;
    }

    const logAttributes: LogAttributes = {
      projectId: projectId.toString(),
      onCallDutyPolicyId: policyId.toString(),
    } as LogAttributes;

    try {
      await IncidentOnCallRuleService.create({
        data: this.getEveryNewIncidentRule({
          projectId: new ObjectID(projectId.toString()),
          policy: data.policy,
          translator: data.translator,
        }),
        props: data.props,
      });
    } catch (error) {
      logger.error(
        `Error adding the incident on-call rule of a new on-call policy in OnCallDutyPolicyService.addEveryNewEventRules: ${error}`,
        logAttributes,
      );
    }

    try {
      await AlertOnCallRuleService.create({
        data: this.getEveryNewAlertRule({
          projectId: new ObjectID(projectId.toString()),
          policy: data.policy,
          translator: data.translator,
        }),
        props: data.props,
      });
    } catch (error) {
      logger.error(
        `Error adding the alert on-call rule of a new on-call policy in OnCallDutyPolicyService.addEveryNewEventRules: ${error}`,
        logAttributes,
      );
    }
  }

  /*
   * Refuses first responders that could not be paged, before the policy is
   * saved. `policy` is the policy as it will be saved: the rule and its
   * responders are held to the labels, blocks with labels and Owned scope
   * of the caller's permissions to add them by the labels it is created
   * with. Throws; returns nothing.
   */
  @CaptureSpan()
  public async checkFirstRespondersCanBePaged(data: {
    responders: FirstResponderIds;
    projectId: ObjectID | undefined | null;
    props: DatabaseCommonInteractionProps;
    policy?: OnCallDutyPolicy | undefined;
  }): Promise<void> {
    if (!data.projectId) {
      throw new BadDataException(
        "A project is required to page someone from a new on-call policy.",
      );
    }

    const projectId: ObjectID = new ObjectID(data.projectId.toString());

    /*
     * The caller adds the rule and its responders themselves, so they need
     * the permissions adding them by hand needs. The same check the rule's
     * own create runs first (OnCallDutyPolicyChildService), made now so a
     * refusal saves nothing. It passes root and master admin callers through
     * itself.
     */
    const rule: OnCallDutyPolicyEscalationRule = this.getFirstEscalationRule({
      projectId: projectId,
      // Not known yet; any id checks the same column permissions.
      onCallDutyPolicyId: ObjectID.getZeroObjectID(),
    });

    CreatePermission.checkCreatePermissions(
      OnCallDutyPolicyEscalationRule,
      rule,
      data.props,
    );

    for (const key of FIRST_RESPONDER_KEYS) {
      if (data.responders[key].length === 0) {
        continue;
      }

      const join: FirstResponderJoin = this.getFirstResponderJoin({
        key: key,
        projectId: projectId,
      });

      CreatePermission.checkCreatePermissions(
        join.modelType,
        join.row,
        data.props,
      );
    }

    /*
     * An escalation rule is read through its policy: adding one needs a
     * permission to read on-call policies, as adding it by hand does.
     */
    if (!data.props.isRoot && !data.props.isMasterAdmin) {
      BasePermission.isHeldToParentRead(
        OnCallDutyPolicyEscalationRule,
        OnCallDutyPolicy,
        data.props,
        DatabaseRequestType.Create,
      );
    }

    // Every responder must be this project's own.
    await this.checkFirstRespondersAreInProject({
      responders: data.responders,
      projectId: projectId,
    });

    /*
     * And the policy as it will be saved is one the caller's permissions to
     * add the rule and its responders reach.
     */
    const labelIds: Array<string> = resolveReferenceIds(
      data.policy?.labels,
    ).map((labelId: ObjectID | string): string => {
      return labelId.toString();
    });

    const pending: PendingRecord = {
      modelType: OnCallDutyPolicy,
      // Not saved yet: the rule names it by a placeholder id.
      id: ObjectID.generate(),
      labelIds: labelIds,
      ownedByCreator:
        Boolean(data.props.userId) &&
        OwnedScopePermission.hasOwnerTables(OnCallDutyPolicy),
    };

    await this.checkFirstRuleCreateScope({
      policyId: pending.id,
      projectId: projectId,
      responders: data.responders,
      props: data.props,
      pending: pending,
    });
  }

  /*
   * Whether the caller's permissions to add an escalation rule and its
   * responders reach the first rule of `policyId`: their labels, blocks
   * with labels and Owned scope (DatabaseService.checkCreateScopeOf) - each
   * on-call schedule by its own labels. `pending` is the policy while it is
   * not saved yet. Root and master admin callers add any. Throws a
   * CreateScopeException; returns nothing.
   */
  private async checkFirstRuleCreateScope(data: {
    policyId: ObjectID;
    projectId: ObjectID;
    responders: FirstResponderIds;
    props: DatabaseCommonInteractionProps;
    pending?: PendingRecord | undefined;
  }): Promise<void> {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    await OnCallDutyPolicyEscalationRuleService.checkCreateScopeOf({
      row: this.getFirstEscalationRule({
        projectId: data.projectId,
        onCallDutyPolicyId: data.policyId,
      }),
      props: data.props,
      pending: data.pending,
    });

    for (const key of FIRST_RESPONDER_KEYS) {
      if (data.responders[key].length === 0) {
        continue;
      }

      // Each schedule carries labels of its own; people and teams carry none.
      const responderIds: Array<string | null> =
        key === "onCallSchedules" ? data.responders[key] : [null];

      for (const responderId of responderIds) {
        const join: FirstResponderJoin = this.getFirstResponderJoin({
          key: key,
          projectId: data.projectId,
        });

        join.row.setColumnValue("onCallDutyPolicyId", data.policyId);

        if (responderId) {
          join.row.setColumnValue(
            "onCallDutyPolicyScheduleId",
            new ObjectID(responderId),
          );
        }

        await this.getFirstResponderService(key).checkCreateScopeOf({
          row: join.row,
          props: data.props,
          pending: data.pending,
        });
      }
    }
  }

  // The service that writes the join rows of one kind of first responder.
  private getFirstResponderService(
    key: FirstResponderKey,
  ): DatabaseService<BaseModel> {
    if (key === "onCallSchedules") {
      return OnCallDutyPolicyEscalationRuleScheduleService as unknown as DatabaseService<BaseModel>;
    }

    if (key === "teams") {
      return OnCallDutyPolicyEscalationRuleTeamService as unknown as DatabaseService<BaseModel>;
    }

    return OnCallDutyPolicyEscalationRuleUserService as unknown as DatabaseService<BaseModel>;
  }

  /*
   * A join row of the first rule as the rule service writes it for one kind
   * of responder (addUser, addTeam, addOnCallSchedules), with placeholder
   * ids: what the permission check reads is which columns are written.
   *
   * Without its creator: who created a row is OneUptime's to stamp, after
   * the create's permission checks (DatabaseService.sanitizeCreateOrUpdate),
   * and a create made as a person takes out any creator its row names
   * before they are asked (UserAttribution), so its checks never ask about
   * the column. Asked here, it would be refused to everyone: nobody may
   * give a new record its creator.
   */
  private getFirstResponderJoin(data: {
    key: FirstResponderKey;
    projectId: ObjectID;
  }): FirstResponderJoin {
    const placeholderId: ObjectID = ObjectID.getZeroObjectID();

    let join: FirstResponderJoin;

    if (data.key === "onCallSchedules") {
      const row: OnCallDutyPolicyEscalationRuleSchedule =
        new OnCallDutyPolicyEscalationRuleSchedule();
      row.onCallDutyPolicyScheduleId = placeholderId;
      join = { modelType: OnCallDutyPolicyEscalationRuleSchedule, row };
    } else if (data.key === "teams") {
      const row: OnCallDutyPolicyEscalationRuleTeam =
        new OnCallDutyPolicyEscalationRuleTeam();
      row.teamId = placeholderId;
      join = { modelType: OnCallDutyPolicyEscalationRuleTeam, row };
    } else {
      const row: OnCallDutyPolicyEscalationRuleUser =
        new OnCallDutyPolicyEscalationRuleUser();
      row.userId = placeholderId;
      join = { modelType: OnCallDutyPolicyEscalationRuleUser, row };
    }

    join.row.setColumnValue("projectId", data.projectId);
    join.row.setColumnValue("onCallDutyPolicyId", placeholderId);
    join.row.setColumnValue("onCallDutyPolicyEscalationRuleId", placeholderId);

    return join;
  }

  /*
   * Teams and on-call schedules of this project, and people who are members
   * of it (a TeamMember row of the project, the list the picker offers). An
   * id that is not - another project's team, a stranger, a deleted schedule
   * - refuses the create rather than page someone outside the project.
   */
  private async checkFirstRespondersAreInProject(data: {
    responders: FirstResponderIds;
    projectId: ObjectID;
  }): Promise<void> {
    const { responders, projectId } = data;

    if (responders.teams.length > 0) {
      const teamsInProject: PositiveNumber = await TeamService.countBy({
        query: {
          _id: QueryHelper.any(responders.teams),
          projectId: projectId,
        },
        props: {
          isRoot: true,
        },
      });

      if (teamsInProject.toNumber() !== responders.teams.length) {
        throw new BadDataException(
          "Some of the teams picked to be paged first are not in this project.",
        );
      }
    }

    if (responders.onCallSchedules.length > 0) {
      const schedulesInProject: PositiveNumber =
        await OnCallDutyPolicyScheduleService.countBy({
          query: {
            _id: QueryHelper.any(responders.onCallSchedules),
            projectId: projectId,
          },
          props: {
            isRoot: true,
          },
        });

      if (schedulesInProject.toNumber() !== responders.onCallSchedules.length) {
        throw new BadDataException(
          "Some of the on-call schedules picked to be paged first are not in this project.",
        );
      }
    }

    if (responders.users.length > 0) {
      const memberships: Array<TeamMember> = await TeamMemberService.findBy({
        query: {
          userId: QueryHelper.any(responders.users),
          projectId: projectId,
        },
        select: {
          userId: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      const members: Set<string> = new Set<string>(
        memberships
          .map((membership: TeamMember): string => {
            return membership.userId?.toString().toLowerCase() || "";
          })
          .filter(Boolean),
      );

      const strangers: Array<string> = responders.users.filter(
        (userId: string): boolean => {
          return !members.has(userId);
        },
      );

      if (strangers.length > 0) {
        throw new BadDataException(
          "Some of the people picked to be paged first are not members of this project.",
        );
      }
    }
  }

  // The first rule as it is created: what the Add Escalation Rule dialog sends.
  private getFirstEscalationRule(data: {
    projectId: ObjectID;
    onCallDutyPolicyId: ObjectID;
  }): OnCallDutyPolicyEscalationRule {
    const rule: OnCallDutyPolicyEscalationRule =
      new OnCallDutyPolicyEscalationRule();

    rule.projectId = data.projectId;
    rule.onCallDutyPolicyId = data.onCallDutyPolicyId;
    rule.escalateAfterInMinutes = DEFAULT_ESCALATE_AFTER_IN_MINUTES;

    /*
     * No name and no order: the rule service puts it first and calls it
     * after its level, "Level 1" - as it does any rule created without them.
     */
    return rule;
  }

  /*
   * Adds the first escalation rule of a policy just created, paging the
   * first responders. Never throws: the policy is saved already.
   *
   * The rule is created as the caller. Whether they may add escalation
   * rules and page those responders - the permissions, their labels and
   * blocks with labels - was asked before the policy was saved
   * (checkFirstRespondersCanBePaged). One refusal is then not theirs to fix:
   * an escalation rule is read through its policy, and their read of
   * policies may not reach the policy they made a moment ago
   * (UnreadableReferenceException, refused before the rule is saved). For
   * that refusal alone, while the policy has no rule yet, OneUptime creates
   * the rule for them (root, naming them), as it writes a new monitor's
   * first status row - once it is checked against their own permissions to
   * add the rule and its responders on everything but that read. Any other
   * refusal is logged.
   */
  @CaptureSpan()
  public async addFirstEscalationRule(data: {
    policy: OnCallDutyPolicy;
    responders: FirstResponderIds;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const policyId: ObjectID | null | undefined = data.policy.id;
    const projectId: ObjectID | undefined = data.policy.projectId;

    try {
      if (!policyId || !projectId) {
        throw new BadDataException(
          "The new on-call policy has no id or project.",
        );
      }

      try {
        await this.createFirstEscalationRule({
          policyId: policyId,
          projectId: projectId,
          responders: data.responders,
          props: data.props,
        });
      } catch (error) {
        if (data.props.isRoot || !OwnerRuleAssignment.isOutOfReach(error)) {
          throw error;
        }

        // A rule saved before the refusal is not added a second time.
        const rules: PositiveNumber =
          await OnCallDutyPolicyEscalationRuleService.countBy({
            query: {
              onCallDutyPolicyId: policyId,
            },
            props: {
              isRoot: true,
            },
          });

        if (rules.toNumber() > 0) {
          throw error;
        }

        // Everything but the creator's read of their new policy still holds.
        await this.checkFirstRuleCreateScope({
          policyId: policyId,
          projectId: projectId,
          responders: data.responders,
          props: data.props,
        });

        logger.info(
          "The first escalation rule of a new on-call policy is added by OneUptime for its creator: the new policy is outside what their own permissions reach.",
          {
            projectId: projectId.toString(),
            onCallDutyPolicyId: policyId.toString(),
          } as LogAttributes,
        );

        await this.createFirstEscalationRule({
          policyId: policyId,
          projectId: projectId,
          responders: data.responders,
          props: {
            isRoot: true,
            userId: data.props.userId,
          },
        });
      }
    } catch (error) {
      logger.error(
        `Error adding the first escalation rule of a new on-call policy in OnCallDutyPolicyService.addFirstEscalationRule: ${error}`,
        {
          projectId: projectId?.toString(),
          onCallDutyPolicyId: policyId?.toString(),
        } as LogAttributes,
      );
    }
  }

  // The first escalation rule, as addFirstEscalationRule creates it.
  private async createFirstEscalationRule(data: {
    policyId: ObjectID;
    projectId: ObjectID;
    responders: FirstResponderIds;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    /*
     * The responders go to the rule as its own create takes them: the
     * rule's create hook turns these lists into its join rows.
     */
    const miscDataProps: JSONObject = {
      onCallSchedules: data.responders.onCallSchedules.map(
        (id: string): ObjectID => {
          return new ObjectID(id);
        },
      ),
      teams: data.responders.teams.map((id: string): ObjectID => {
        return new ObjectID(id);
      }),
      users: data.responders.users.map((id: string): ObjectID => {
        return new ObjectID(id);
      }),
    };

    await OnCallDutyPolicyEscalationRuleService.create({
      data: this.getFirstEscalationRule({
        projectId: new ObjectID(data.projectId.toString()),
        onCallDutyPolicyId: new ObjectID(data.policyId.toString()),
      }),
      miscDataProps: miscDataProps,
      props: data.props,
    });
  }

  /*
   * The acknowledgement timeout is empty (off) or a whole number of minutes
   * in its range (OnCallAcknowledgementTimeout), and a policy that repeats
   * starts again at least once (ON_CALL_POLICY_REPEAT_RULE) - from the
   * Dashboard, the API, Terraform or a workflow alike. Checked before
   * anything else is looked up: the values alone decide (with, for an
   * update of the repeat, the policy's own stored values).
   */
  protected override async checkCreateBeforeReferences(
    createBy: CreateBy<OnCallDutyPolicy>,
  ): Promise<void> {
    Service.assertAcknowledgementTimeout(createBy.data);
    ColumnRuleCheck.checkCreate(createBy.data, ON_CALL_POLICY_REPEAT_RULE);
  }

  protected override async checkUpdateBeforeReferences(
    updateBy: UpdateBy<OnCallDutyPolicy>,
  ): Promise<void> {
    Service.assertAcknowledgementTimeout(updateBy.data);
    await ColumnRuleCheck.checkUpdate({
      service: this,
      updateBy: updateBy,
      rule: ON_CALL_POLICY_REPEAT_RULE,
    });
  }

  /*
   * A POLICY'S NAME IS ONE POLICY'S IN ITS PROJECT (#9742), as a team's is
   * (#9674): a policy is picked by its name alone - an incident or alert
   * on-call rule's policies, a monitor criteria's, a workflow that pages
   * one, Readiness, the Slack and Microsoft Teams commands - so two policies
   * called "Primary" could not be told apart in any of them. Compared as it
   * reads, whatever its case or spacing (Types/Database/UniqueName).
   *
   * Asked of a person's or an API key's create and rename - the Dashboard,
   * the API, Terraform, a workflow, an import - once they may make it
   * (UniqueNameInProject). OneUptime's own writes are trusted. An archived
   * policy keeps its name, and the refusal says where to unarchive it:
   * unarchived, it would be a twin of the new one. Policies that already
   * share a name keep it, can still be edited, and are marked on the list
   * so they can be renamed apart.
   */
  private getUniqueNameRules(): UniqueNameRules<OnCallDutyPolicy> {
    return {
      service: this,
      takenRefusal: ON_CALL_POLICY_NAME_TAKEN_REFUSAL,
      renamedTogetherRefusal: ON_CALL_POLICIES_RENAMED_TOGETHER_REFUSAL,
      clashSelect: {
        isArchived: true,
      },
      // A policy in service is named before an archived one.
      clashSort: {
        isArchived: SortOrder.Ascending,
      },
      describeClash: (data: {
        clash: OnCallDutyPolicy;
        name: string;
      }): string | null => {
        return data.clash.isArchived
          ? getNameTakenRefusalText(
              ARCHIVED_ON_CALL_POLICY_NAME_TAKEN_REFUSAL,
              data.name,
            )
          : null;
      },
    };
  }

  @CaptureSpan()
  protected override async onBeforeCreateUniqueCheck(
    createBy: CreateBy<OnCallDutyPolicy>,
  ): Promise<void> {
    await UniqueNameInProject.refuseCreateClash({
      rules: this.getUniqueNameRules(),
      createBy: createBy,
    });
  }

  @CaptureSpan()
  protected override async onBeforeUpdateUniqueCheck(
    updateBy: UpdateBy<OnCallDutyPolicy>,
  ): Promise<void> {
    await UniqueNameInProject.refuseRenameClash({
      rules: this.getUniqueNameRules(),
      updateBy: updateBy,
    });
  }

  // Refuses a write whose acknowledgement timeout cannot be one.
  public static assertAcknowledgementTimeout(data: unknown): void {
    if (!data || typeof data !== "object") {
      return;
    }

    const refusal: string | null = getOnCallAcknowledgementTimeoutRefusal(
      (data as Record<string, unknown>)["acknowledgementTimeoutInMinutes"],
    );

    if (refusal) {
      throw new BadDataException(refusal);
    }
  }

  protected override async onCreateSuccess(
    onCreate: OnCreate<OnCallDutyPolicy>,
    createdItem: OnCallDutyPolicy,
  ): Promise<OnCallDutyPolicy> {
    if (!createdItem.id) {
      throw new BadDataException("The new on-call policy has no ID.");
    }

    // Activation event for marketing funnels.
    ProductAnalytics.captureForUser({
      userId: onCreate.createBy.props.userId || createdItem.createdByUserId,
      event: "server/on_call_policy_created",
      properties: {
        project_id: createdItem.projectId?.toString() || "",
      },
    });

    if (createdItem.projectId) {
      try {
        await OnCallDutyPolicyLabelRuleEngineService.applyRulesToOnCallDutyPolicy(
          createdItem,
        );
        await OnCallDutyPolicyOwnerRuleEngineService.applyRulesToOnCallDutyPolicy(
          createdItem,
        );
      } catch (error) {
        logger.error(
          `Error applying on-call policy rules in OnCallDutyPolicyService.onCreateSuccess: ${error}`,
          {
            projectId: createdItem.projectId?.toString(),
            onCallDutyPolicyId: createdItem.id?.toString(),
          } as LogAttributes,
        );
      }
    }

    const onCallPolicy: OnCallDutyPolicy | null = await this.findOneById({
      id: createdItem.id,
      select: {
        projectId: true,
        name: true,
        description: true,
        labels: {
          name: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!onCallPolicy) {
      throw new BadDataException(
        "The new on-call policy was not found. It may have been deleted.",
      );
    }

    const createdByUserId: ObjectID | undefined | null =
      createdItem.createdByUserId || createdItem.createdByUser?.id;

    let feedInfoInMarkdown: string = mdText`#### 📞 On-Call Policy Created: 
              
**${onCallPolicy.name || "No name provided."}**:
    
${FeedMarkdown.asMarkdown(onCallPolicy.description || "No description provided.")}
        
`.toString();

    if (onCallPolicy?.labels && onCallPolicy.labels.length > 0) {
      feedInfoInMarkdown += `🏷️ **Labels**:\n`;

      for (const label of onCallPolicy.labels) {
        feedInfoInMarkdown += mdText`- ${label.name}\n`;
      }

      feedInfoInMarkdown += `\n\n`;
    }

    // send message to workspaces - slack, teams,   etc.
    const workspaceResult: WorkspaceChannelsCreated | null =
      await OnCallDutyPolicyWorkspaceMessages.createChannelsAndInviteUsersToChannels(
        {
          projectId: onCallPolicy.projectId!,
          onCallDutyPolicyId: onCallPolicy.id!,
          onCallDutyPolicyName: onCallPolicy.name!,
        },
      );

    /*
     * The new channels are on the policy already: the rule service stores
     * them before it invites anybody, so whoever joins the policy while they
     * are set up is invited too (WorkspaceNotificationRuleService
     * .createChannelsAndInviteUsersToChannelsBasedOnRules).
     */

    const onCallDutyPolicyCreateMessageBlocks: Array<MessageBlocksByWorkspaceType> =
      await OnCallDutyPolicyWorkspaceMessages.getOnCallDutyPolicyCreateMessageBlocks(
        {
          onCallDutyPolicyId: createdItem.id!,
          projectId: createdItem.projectId!,
        },
      );

    await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
      onCallDutyPolicyId: createdItem.id!,
      projectId: createdItem.projectId!,
      onCallDutyPolicyFeedEventType:
        OnCallDutyPolicyFeedEventType.OnCallDutyPolicyCreated,
      displayColor: Green500,
      feedInfoInMarkdown: feedInfoInMarkdown,
      userId: createdByUserId || undefined,
      workspaceNotification: {
        appendMessageBlocks: onCallDutyPolicyCreateMessageBlocks,
        sendWorkspaceNotification: true,
      },
    });

    // Under "On Call Policy Created": who could not be added to the new channels.
    await ChannelMembersNotAddedNotice.noteAll({
      projectId: createdItem.projectId,
      membersNotAdded: workspaceResult?.membersNotAdded,
    });

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<OnCallDutyPolicy>,
  ): Promise<OnDelete<OnCallDutyPolicy>> {
    /*
     * A delete that names one policy by its id - the policy's own Delete -
     * archives the policy's workspace channels. A delete that names no
     * single policy, such as a cleanup of several, archives none, and is
     * left as it is.
     */
    if (!Service.getOneRowIdNamedBy(deleteBy.query)) {
      return { deleteBy, carryForward: null };
    }

    /*
     * The policy, and the delete held to it. Its channels are found through
     * it, so they are archived before it is gone.
     */
    const found: { row: OnCallDutyPolicy | null; deletesMore: boolean } =
      await this.findOneRowAndHoldDeleteToIt(deleteBy, {
        _id: true,
        projectId: true,
      });

    const policy: OnCallDutyPolicy | null = found.row;

    if (!policy || !policy.id || !policy.projectId) {
      return { deleteBy, carryForward: null };
    }

    try {
      await WorkspaceNotificationRuleService.archiveWorkspaceChannels({
        projectId: policy.projectId,
        notificationFor: {
          onCallDutyPolicyId: policy.id,
        },
        sendMessageBeforeArchiving: {
          _type: "WorkspacePayloadMarkdown",
          text: `🗑️ This on-call policy is deleted. The channel is being archived.`,
        },
      });
    } catch (error) {
      logger.error(
        `Error while archiving workspace channels for onCallDutyPolicy ${policy.id.toString()}: ${error}`,
        { projectId: policy.projectId.toString() } as LogAttributes,
      );
    }

    // Its project, for the people on duty for it (onDeleteSuccess).
    return { deleteBy, carryForward: { projectId: policy.projectId } };
  }

  /*
   * A policy deleted takes its escalation rules with it, by the database's
   * own cascade: nobody is on duty for it any more (OnDutyPoliciesCache).
   */
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<OnCallDutyPolicy>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<OnCallDutyPolicy>> {
    await OnDutyPoliciesCache.forgetProjects([
      (onDelete.carryForward as { projectId?: ObjectID } | null)?.projectId,
      onDelete.deleteBy.props.tenantId,
    ]);

    return onDelete;
  }

  @CaptureSpan()
  public async getWorkspaceChannelForOnCallDutyPolicy(data: {
    onCallDutyPolicyId: ObjectID;
    workspaceType?: WorkspaceType | null;
  }): Promise<Array<NotificationRuleWorkspaceChannel>> {
    const onCallDutyPolicy: OnCallDutyPolicy | null = await this.findOneById({
      id: data.onCallDutyPolicyId,
      select: {
        postUpdatesToWorkspaceChannels: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!onCallDutyPolicy) {
      throw new BadDataException("OnCallDutyPolicy not found.");
    }

    return (onCallDutyPolicy.postUpdatesToWorkspaceChannels || []).filter(
      (channel: NotificationRuleWorkspaceChannel) => {
        if (!data.workspaceType) {
          return true;
        }

        return channel.workspaceType === data.workspaceType;
      },
    );
  }

  @CaptureSpan()
  public async getOnCallDutyPolicyLinkInDashboard(
    projectId: ObjectID,
    onCallDutyPolicyId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/on-call-duty/policies/${onCallDutyPolicyId.toString()}`,
    );
  }

  @CaptureSpan()
  public async getOnCallDutyPolicyName(data: {
    onCallDutyPolicyId: ObjectID;
  }): Promise<string | null> {
    const { onCallDutyPolicyId } = data;

    const onCallDutyPolicy: OnCallDutyPolicy | null = await this.findOneById({
      id: onCallDutyPolicyId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    return onCallDutyPolicy && onCallDutyPolicy.name
      ? onCallDutyPolicy.name.toString()
      : null;
  }

  /*
   * Runs an on-call policy for an incident, an alert or an episode: its
   * execution log is created, and the log service pages its first
   * escalation rule from there.
   *
   * With pagingStartsAt later than now, the run is held instead
   * (OnCallDutyPolicyRunWait): it is created Waiting, pages nobody, and the
   * worker starts it at its first escalation rule when that moment comes -
   * or ends it there, unpaged, if its record was acknowledged or resolved
   * or the policy archived in the meantime. An on-call rule that pages only
   * during working hours holds the runs it starts outside them
   * (OnCallRulePagingHold); waitingStatusMessage is what the run says until
   * then ("Waiting for working hours: paging starts at 09:00
   * (Europe/London)."). Left out, or not later than now, the run pages
   * straight away, as it always has.
   */
  @CaptureSpan()
  public async executePolicy(
    policyId: ObjectID,
    options: {
      triggeredByIncidentId?: ObjectID | undefined;
      triggeredByAlertId?: ObjectID | undefined;
      triggeredByAlertEpisodeId?: ObjectID | undefined;
      triggeredByIncidentEpisodeId?: ObjectID | undefined;
      userNotificationEventType: UserNotificationEventType;
      pagingStartsAt?: Date | undefined;
      waitingStatusMessage?: string | undefined;
      // Held while OneUptime AI works (OnCallPolicyAiHold).
      isAiHold?: boolean | undefined;
      /*
       * Pages its people as observers (OnCallObserverPage): kept informed,
       * and answering only says they have seen it. Left out, they are paged
       * as responders, as every run always was.
       */
      isObserverPage?: boolean | undefined;
    },
  ): Promise<void> {
    // execute this policy

    if (
      UserNotificationEventType.IncidentCreated ===
        options.userNotificationEventType &&
      !options.triggeredByIncidentId
    ) {
      throw new BadDataException(
        "An on-call policy run for a new incident must name the incident.",
      );
    }

    if (
      UserNotificationEventType.AlertCreated ===
        options.userNotificationEventType &&
      !options.triggeredByAlertId
    ) {
      throw new BadDataException(
        "An on-call policy run for a new alert must name the alert.",
      );
    }

    if (
      UserNotificationEventType.AlertEpisodeCreated ===
        options.userNotificationEventType &&
      !options.triggeredByAlertEpisodeId
    ) {
      throw new BadDataException(
        "An on-call policy run for a new alert episode must name the episode.",
      );
    }

    if (
      UserNotificationEventType.IncidentEpisodeCreated ===
        options.userNotificationEventType &&
      !options.triggeredByIncidentEpisodeId
    ) {
      throw new BadDataException(
        "An on-call policy run for a new incident episode must name the episode.",
      );
    }

    const policy: OnCallDutyPolicy | null = await this.findOneById({
      id: policyId,
      select: {
        _id: true,
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!policy) {
      throw new BadDataException(
        `The on-call policy ${policyId.toString()} no longer exists. It may have been deleted.`,
      );
    }

    /*
     * The policy's execution log. An archived policy pages no one: the log
     * service's create writes its log as not executed, with the reason, and
     * starts nothing after it - for this execution as for every other way
     * one is asked for (OnCallDutyPolicyArchive) - so the incident's on-call
     * tab says why nobody was paged instead of showing nothing.
     */
    const log: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();

    log.projectId = policy.projectId!;
    log.onCallDutyPolicyId = policyId;
    log.userNotificationEventType = options.userNotificationEventType;
    log.statusMessage = ON_CALL_RUN_SCHEDULED_MESSAGE;
    log.status = OnCallDutyPolicyStatus.Scheduled;

    // Held until later: created waiting, as the log service checks again.
    if (
      options.pagingStartsAt &&
      OneUptimeDate.isAfter(
        options.pagingStartsAt,
        OneUptimeDate.getCurrentDate(),
      )
    ) {
      log.status = OnCallDutyPolicyStatus.Waiting;
      log.pagingStartsAt = options.pagingStartsAt;
      log.statusMessage = options.waitingStatusMessage || "";

      if (options.isAiHold) {
        log.aiHoldOutcome = OnCallPolicyAiHoldOutcome.Holding;
      }
    }

    if (options.triggeredByIncidentId) {
      log.triggeredByIncidentId = options.triggeredByIncidentId;
    }

    if (options.triggeredByAlertId) {
      log.triggeredByAlertId = options.triggeredByAlertId;
    }

    if (options.triggeredByAlertEpisodeId) {
      log.triggeredByAlertEpisodeId = options.triggeredByAlertEpisodeId;
    }

    if (options.triggeredByIncidentEpisodeId) {
      log.triggeredByIncidentEpisodeId = options.triggeredByIncidentEpisodeId;
    }

    if (options.isObserverPage) {
      log.isObserverPage = true;
    }

    await OnCallDutyPolicyExecutionLogService.create({
      data: log,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * The escalation rules that page the person in the project: by their own
   * name, through a team they are in, or through a schedule whose roster
   * they are on (a rule that pages the next person in a schedule's rotation
   * does not page its on-call person). The dashboard's header asks it on
   * every page.
   *
   * Kept a minute per person and project, and built again at once when a
   * change can change it (OnDutyPoliciesCache says which). The three kinds
   * of rule are read side by side, each after what it needs: the person's
   * own rules at once, their teams' after their teams, their schedules'
   * after their schedules - two round trips, where five reads used to run
   * one after another. A team or schedule list that is empty reads no
   * rules.
   *
   * The answer is shared between requests and must not be changed.
   */
  public async getOnCallPoliciesWhereUserIsOnCallDuty(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<OnDutyPolicies> {
    const answers: Map<string, OnDutyPolicies> =
      await this.getOnCallPoliciesWhereUserIsOnCallDutyInProjects({
        projectIds: [data.projectId],
        userId: data.userId,
      });

    return answers.get(projectKeyOf(data.projectId)) || noOnDutyPolicies();
  }

  /*
   * The same in each of the projects, by lower-cased project id - every
   * project asked for has an answer, empty where nothing pages the person.
   * My On-Call Policies asks it for every project the person may open, in
   * one request (#8124). The projects whose answers are kept are answered
   * from them; the rest are read together, by the same five reads one
   * project takes - by the person and any of the projects, then by their
   * teams' and schedules' ids - whatever the number of projects, where each
   * project used to cost a request of its own. Each answer is then kept as
   * the project's own request keeps it.
   */
  public async getOnCallPoliciesWhereUserIsOnCallDutyInProjects(data: {
    projectIds: Array<ObjectID>;
    userId: ObjectID;
  }): Promise<Map<string, OnDutyPolicies>> {
    if (data.projectIds.length === 0) {
      return new Map<string, OnDutyPolicies>();
    }

    return await OnDutyPoliciesCache.getOrBuildMany<OnDutyPolicies>({
      projectIds: data.projectIds,
      userId: data.userId,
      build: (
        projectIds: Array<ObjectID>,
      ): Promise<Map<string, OnDutyPolicies>> => {
        return this.readOnCallPoliciesWhereUserIsOnCallDuty({
          projectIds: projectIds,
          userId: data.userId,
        });
      },
    });
  }

  private async readOnCallPoliciesWhereUserIsOnCallDuty(data: {
    projectIds: Array<ObjectID>;
    userId: ObjectID;
  }): Promise<Map<string, OnDutyPolicies>> {
    const [
      escalationRulesByUser,
      escalationRulesByTeam,
      escalationRulesBySchedule,
    ]: [
      Array<OnCallDutyPolicyEscalationRuleUser>,
      Array<OnCallDutyPolicyEscalationRuleTeam>,
      Array<OnCallDutyPolicyEscalationRuleSchedule>,
    ] = await Promise.all([
      this.readEscalationRulesOfUser(data),
      TeamService.getTeamsUserIsAPartOf({
        userId: data.userId,
        projectIds: data.projectIds,
      }).then((teams: Array<Team>) => {
        return this.readEscalationRulesOfTeams({
          projectIds: data.projectIds,
          teams,
        });
      }),
      OnCallDutyPolicyScheduleService.getOnCallSchedulesWhereUserIsOnCallDuty(
        data,
      ).then((onCallSchedules: Array<OnCallDutyPolicySchedule>) => {
        return this.readEscalationRulesOfSchedules({
          projectIds: data.projectIds,
          onCallSchedules,
        });
      }),
    ]);

    const answers: Map<string, OnDutyPolicies> = new Map<
      string,
      OnDutyPolicies
    >();

    for (const projectId of data.projectIds) {
      answers.set(projectKeyOf(projectId), noOnDutyPolicies());
    }

    /*
     * A row goes to the project it was read in: the one asked for, or -
     * across several - the one it names.
     */
    const answerOf: (row: BaseModel) => OnDutyPolicies | undefined = (
      row: BaseModel,
    ): OnDutyPolicies | undefined => {
      if (data.projectIds.length === 1) {
        return answers.get(projectKeyOf(data.projectIds[0]!));
      }

      const projectId: unknown = (row as { projectId?: unknown }).projectId;

      return projectId
        ? answers.get(String(projectId).toLowerCase())
        : undefined;
    };

    for (const rule of escalationRulesByUser) {
      answerOf(rule)?.escalationRulesByUser.push(rule);
    }

    for (const rule of escalationRulesByTeam) {
      answerOf(rule)?.escalationRulesByTeam.push(rule);
    }

    for (const rule of escalationRulesBySchedule) {
      // The rotation's next person is paged by it, not its on-call person.
      if (!rule.pageNextInRotation) {
        answerOf(rule)?.escalationRulesBySchedule.push(rule);
      }
    }

    return answers;
  }

  // The rules that page the person by their own name.
  private async readEscalationRulesOfUser(data: {
    projectIds: Array<ObjectID>;
    userId: ObjectID;
  }): Promise<Array<OnCallDutyPolicyEscalationRuleUser>> {
    return await OnCallDutyPolicyEscalationRuleUserService.findBy({
      query: {
        userId: data.userId!,
        projectId: QueryHelper.any(data.projectIds),
      },
      select: {
        projectId: true,
        onCallDutyPolicyEscalationRule: {
          name: true,
          _id: true,
          order: true,
        },
        onCallDutyPolicy: {
          name: true,
          _id: true,
        },
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  // The rules that page one of these teams; none read for no team.
  private async readEscalationRulesOfTeams(data: {
    projectIds: Array<ObjectID>;
    teams: Array<Team>;
  }): Promise<Array<OnCallDutyPolicyEscalationRuleTeam>> {
    if (data.teams.length === 0) {
      return [];
    }

    return await OnCallDutyPolicyEscalationRuleTeamService.findBy({
      query: {
        teamId: QueryHelper.any(
          data.teams.map((team: Team) => {
            return team.id!;
          }),
        ),
        projectId: QueryHelper.any(data.projectIds),
      },
      select: {
        projectId: true,
        onCallDutyPolicy: {
          name: true,
          _id: true,
        },
        onCallDutyPolicyEscalationRule: {
          name: true,
          _id: true,
          order: true,
        },
        team: {
          name: true,
          _id: true,
        },
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * The rules that page whoever is on call in one of these schedules (and
   * the ones that page the next person in a rotation, filtered out by the
   * caller); none read for no schedule.
   */
  private async readEscalationRulesOfSchedules(data: {
    projectIds: Array<ObjectID>;
    onCallSchedules: Array<OnCallDutyPolicySchedule>;
  }): Promise<Array<OnCallDutyPolicyEscalationRuleSchedule>> {
    if (data.onCallSchedules.length === 0) {
      return [];
    }

    return await OnCallDutyPolicyEscalationRuleScheduleService.findBy({
      query: {
        onCallDutyPolicyScheduleId: QueryHelper.any(
          data.onCallSchedules.map((schedule: OnCallDutyPolicySchedule) => {
            return schedule.id!;
          }),
        ),
        projectId: QueryHelper.any(data.projectIds),
      },
      select: {
        projectId: true,
        onCallDutyPolicy: {
          name: true,
          _id: true,
        },
        onCallDutyPolicyEscalationRule: {
          name: true,
          _id: true,
          order: true,
        },
        onCallDutyPolicySchedule: {
          name: true,
          _id: true,
        },
        pageNextInRotation: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }
}
export default new Service();
