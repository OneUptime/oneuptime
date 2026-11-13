import {
  ON_CALL_POLICY_NAME,
  ON_CALL_SETUP_COPY,
  OnCallPolicyRecord,
  PolicyLevel,
  ReachMethod,
  ResponderReach,
} from "./OnCallSetup";
import {
  EnabledProjectChannels,
  ProjectNotificationChannel,
  ProjectNotificationChannelColumn,
  getProjectNotificationChannel,
  readEnabledProjectChannels,
} from "../../NotificationMethods/ProjectNotificationChannelsCopy";
import {
  ProjectBalanceAccess,
  getProjectBalanceAccess,
} from "../../ProjectBalance/ProjectBalanceAccess";
import { mayAddEveryNewEventRules } from "../../OnCallPolicy/UseEveryNewEventRulesOffer";
import {
  SetupReminderStatuses,
  requestSetupReminders,
} from "../../OnCallPolicy/EscalationRule/EscalationRuleReadiness";
import {
  READINESS_STATUS_NOT_REACHABLE,
  ReadinessMethodWire,
  ReadinessSummaryWire,
  UserReadinessWire,
  getVerifiedMethods,
  parseReadinessPage,
  parseReadinessSummary,
} from "../../OnCallPolicy/Readiness/ReadinessTypes";
import AlertOnCallRule from "Common/Models/DatabaseModels/AlertOnCallRule";
import IncidentOnCallRule from "Common/Models/DatabaseModels/IncidentOnCallRule";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import Project from "Common/Models/DatabaseModels/Project";
import UserCall from "Common/Models/DatabaseModels/UserCall";
import UserSMS from "Common/Models/DatabaseModels/UserSMS";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  EVERY_NEW_ALERT_RULE_DESCRIPTION,
  EVERY_NEW_INCIDENT_RULE_DESCRIPTION,
  PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY,
  getEveryNewAlertRuleName,
  getEveryNewIncidentRuleName,
} from "Common/Types/OnCallDutyPolicy/EveryNewEventRules";
import { DEFAULT_ESCALATE_AFTER_IN_MINUTES } from "Common/Types/OnCallDutyPolicy/EscalationRuleDefaults";
import { getOnCallPolicyRepeatsAllowed } from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyRepeat";
import Phone from "Common/Types/Phone";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { ProjectBalanceType } from "Common/Utils/Project/ProjectBalance";
import { announceModelSwitchSaved } from "Common/UI/Components/ModelSwitch/ModelSwitchEvents";
import { APP_API_URL, BILLING_ENABLED } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";

/*
 * THE RECORDS THE ON-CALL GUIDED SETUP READS AND WRITES (issue #6805),
 * through the same model API and routes the normal pages use, so every
 * permission, plan limit and check the server applies to Notification
 * Methods, Create On-Call Policy, Escalation Rules and On-Call Readiness
 * applies here too. No route of its own.
 */

// How a page reaches the signed-in person, as On-Call Readiness says.
export interface MyReach {
  isReachable: boolean;
  methods: Array<ReachMethod>;
}

// The project's SMS and call switches and its balance.
export interface ProjectPhoneFacts {
  isSmsOn: boolean | null;
  isCallOn: boolean | null;
  balanceInUSDCents: number | null;
}

// The project's policies, and what this person may do with them.
export interface PolicyChoiceFacts {
  policies: Array<{ id: string; name: string }>;
  mayCreatePolicy: boolean;
  mayAddRules: boolean;
  mayEditLevels: boolean;
}

// A number just added: verified at once (a call proven by SMS), or not.
export interface AddedNumber {
  id: string;
  isVerified: boolean;
}

/*
 * The project switches the step reads and turns on: SMS and calls, by the
 * channels' one definition (NotificationMethods/ProjectNotificationChannelsCopy).
 */
const PHONE_CHANNELS: ReadonlyArray<ProjectNotificationChannel> = [
  ProjectNotificationChannel.SMS,
  ProjectNotificationChannel.Call,
];

const getPhoneChannelColumns: () => Array<ProjectNotificationChannelColumn> =
  (): Array<ProjectNotificationChannelColumn> => {
    return PHONE_CHANNELS.map(
      (
        channel: ProjectNotificationChannel,
      ): ProjectNotificationChannelColumn => {
        return getProjectNotificationChannel(channel).column;
      },
    );
  };

const READINESS_ROUTE: string = "/on-call-readiness";
// The readiness route's documented maximum page.
const READINESS_LIMIT: number = 500;

const readinessUrl: (route: string, refresh: boolean) => URL = (
  route: string,
  refresh: boolean,
): URL => {
  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
    `${READINESS_ROUTE}${route}`,
  );

  if (refresh) {
    url.addQueryParam("refresh", "true");
  }

  return url;
};

const toReachMethods: (
  methods: ReadonlyArray<ReadinessMethodWire>,
) => Array<ReachMethod> = (
  methods: ReadonlyArray<ReadinessMethodWire>,
): Array<ReachMethod> => {
  return methods.map((method: ReadinessMethodWire): ReachMethod => {
    return {
      methodType: method.methodType,
      maskedIdentifier: method.maskedIdentifier,
      isVerified: Boolean(method.isVerified),
    };
  });
};

// A responder as the setup shows them: reachable or not, and by what.
export const toResponderReach: (user: UserReadinessWire) => ResponderReach = (
  user: UserReadinessWire,
): ResponderReach => {
  const channels: Array<string> = [];

  for (const method of getVerifiedMethods(user)) {
    if (!channels.includes(method.methodType)) {
      channels.push(method.methodType);
    }
  }

  return {
    userId: user.userId,
    name: user.userName || user.userEmail || "",
    isReachable: user.status !== READINESS_STATUS_NOT_REACHABLE,
    channels: channels,
  };
};

// The id a create answered with, or "" when it answered none.
const createdId: (response: unknown) => string = (
  response: unknown,
): string => {
  const data: { id?: { toString: () => string } | undefined } | undefined = (
    response as { data?: { id?: { toString: () => string } } } | undefined
  )?.data;

  return data?.id?.toString() || "";
};

const currentProjectId: () => ObjectID = (): ObjectID => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    throw new Error("No project is selected.");
  }

  return projectId;
};

/*
 * Whether this project may add a second escalation rule to a policy: not on
 * OneUptime Cloud's Free plan, which allows one per policy
 * (OnCallDutyPolicyEscalationRuleService). An unknown plan is allowed: the
 * server has the last word.
 */
export const maySecondEscalationLevel: () => boolean = (): boolean => {
  if (!BILLING_ENABLED) {
    return true;
  }

  return ProjectUtil.getCurrentPlan() !== PlanType.Free;
};

export default class OnCallSetupApi {
  // The signed-in person's methods, as a page to them would find them.
  public static async loadMyReach(refresh: boolean): Promise<MyReach> {
    const userId: string = UserUtil.getUserId()?.toString() || "";

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: readinessUrl(`/user/${userId}`, refresh),
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    // The per-user route answers with one UserReadiness: read as a summary.
    const summary: ReadinessSummaryWire = parseReadinessSummary({
      users: [response.data],
    } as JSONObject);
    const user: UserReadinessWire | undefined = summary.users[0];

    if (!user) {
      throw new Error("Could not read your notification methods.");
    }

    return {
      isReachable: user.status !== READINESS_STATUS_NOT_REACHABLE,
      methods: toReachMethods(user.methods),
    };
  }

  /*
   * The project's SMS and call switches and its balance. Every member may
   * read them; a read that fails says nothing (the server decides).
   */
  public static async loadProjectPhoneFacts(): Promise<ProjectPhoneFacts> {
    try {
      const select: Select<Project> = {};

      for (const column of getPhoneChannelColumns()) {
        select[column] = true;
      }

      select.smsOrCallCurrentBalanceInUSDCents = true;

      const project: Project | null = await ModelAPI.getItem<Project>({
        modelType: Project,
        id: currentProjectId(),
        select: select,
      });

      if (!project) {
        return { isSmsOn: null, isCallOn: null, balanceInUSDCents: null };
      }

      const balance: unknown = project.smsOrCallCurrentBalanceInUSDCents;
      const enabled: EnabledProjectChannels =
        readEnabledProjectChannels(project);

      return {
        isSmsOn: enabled[ProjectNotificationChannel.SMS],
        isCallOn: enabled[ProjectNotificationChannel.Call],
        balanceInUSDCents:
          typeof balance === "number" && Number.isFinite(balance)
            ? balance
            : balance === null || balance === undefined
              ? 0
              : Number(balance) || 0,
      };
    } catch {
      return { isSmsOn: null, isCallOn: null, balanceInUSDCents: null };
    }
  }

  /*
   * Turns SMS and calls on for the project, in one save: the switches of
   * Notification Settings (a project owner, a Billing Admin or Manage
   * Billing). Every switch on screen hears it (ModelSwitchEvents).
   */
  public static async turnOnPhoneChannels(): Promise<void> {
    const projectId: ObjectID = currentProjectId();
    const columns: Array<ProjectNotificationChannelColumn> =
      getPhoneChannelColumns();
    const data: JSONObject = {};

    for (const column of columns) {
      data[column] = true;
    }

    await ModelAPI.updateById<Project>({
      modelType: Project,
      id: projectId,
      data: data,
    });

    for (const column of columns) {
      announceModelSwitchSaved({
        modelType: Project,
        modelId: projectId,
        column: column,
        value: true,
        source: "on-call-guided-setup",
      });
    }
  }

  /*
   * OneUptime Cloud: adds to the balance SMS and calls are paid from,
   * charged to the project's card - Notification Settings' Recharge Balance
   * (a project owner or Manage Billing; the server checks).
   */
  public static async rechargeBalance(amountInUSD: number): Promise<void> {
    /*
     * Asked first, as every recharge in the Dashboard is: the step offers
     * Add balance only to someone the server lets add to it, and nothing is
     * charged for anyone else, or while that is not known yet.
     */
    if (
      getProjectBalanceAccess(ProjectBalanceType.SmsOrCall) !==
      ProjectBalanceAccess.Yes
    ) {
      throw new Error(ON_CALL_SETUP_COPY.whoCanAddBalance);
    }

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          "/notification/recharge",
        ),
        data: {
          amount: amountInUSD,
          projectId: currentProjectId().toString(),
        },
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse || response.isFailure()) {
      throw new Error(API.getFriendlyMessage(response));
    }
  }

  // Adds the person's number for SMS: its code is texted (UserSmsService).
  public static async addSmsNumber(phone: string): Promise<AddedNumber> {
    const sms: UserSMS = new UserSMS();
    sms.projectId = currentProjectId();
    sms.userId = UserUtil.getUserId();
    sms.phone = new Phone(phone);

    const response: unknown = await ModelAPI.create<UserSMS>({
      model: sms,
      modelType: UserSMS,
    });

    const id: string = createdId(response);

    if (!id) {
      throw new Error("The number was added, but it can't be shown.");
    }

    return {
      id: id,
      isVerified: Boolean(
        (response as { data?: { isVerified?: boolean } }).data?.isVerified,
      ),
    };
  }

  /*
   * Adds the same number for calls, once it is verified for SMS: a number
   * proven by text is verified for calls with no second code
   * (UserCallService.isNumberVerifiedForSms).
   */
  public static async addCallNumber(phone: string): Promise<AddedNumber> {
    const call: UserCall = new UserCall();
    call.projectId = currentProjectId();
    call.userId = UserUtil.getUserId();
    call.phone = new Phone(phone);

    const response: unknown = await ModelAPI.create<UserCall>({
      model: call,
      modelType: UserCall,
    });

    return {
      id: createdId(response),
      isVerified: Boolean(
        (response as { data?: { isVerified?: boolean } }).data?.isVerified,
      ),
    };
  }

  // The project's policies, and whether this person may make or change one.
  public static async loadPolicyChoices(): Promise<PolicyChoiceFacts> {
    const policies: ListResult<OnCallDutyPolicy> =
      await ModelAPI.getList<OnCallDutyPolicy>({
        modelType: OnCallDutyPolicy,
        query: {},
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: { _id: true, name: true },
        sort: { name: SortOrder.Ascending },
      });

    return {
      policies: policies.data
        .filter((policy: OnCallDutyPolicy): boolean => {
          return Boolean(policy.id);
        })
        .map((policy: OnCallDutyPolicy): { id: string; name: string } => {
          return {
            id: policy.id!.toString(),
            name: policy.name || "",
          };
        }),
      mayCreatePolicy:
        PermissionGate.check(new OnCallDutyPolicy(), ModelAction.Create)
          .isAllowed &&
        PermissionGate.check(
          new OnCallDutyPolicyEscalationRule(),
          ModelAction.Create,
        ).isAllowed,
      mayAddRules: mayAddEveryNewEventRules(),
      mayEditLevels:
        PermissionGate.check(
          new OnCallDutyPolicyEscalationRule(),
          ModelAction.Create,
        ).isAllowed &&
        PermissionGate.check(
          new OnCallDutyPolicyEscalationRuleUser(),
          ModelAction.Create,
        ).isAllowed,
    };
  }

  /*
   * A new policy paging the people and teams picked first (its Level 1,
   * FirstResponders), with the two on-call rules that run it for every new
   * incident and alert when this person may add them (EveryNewEventRules).
   */
  public static async createPolicy(data: {
    userIds: Array<string>;
    teamIds: Array<string>;
    addRules: boolean;
  }): Promise<string> {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy.name = ON_CALL_POLICY_NAME;

    const miscDataProps: JSONObject = {
      users: data.userIds,
      teams: data.teamIds,
    };

    if (data.addRules) {
      miscDataProps[PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY] = true;
    }

    const id: string = createdId(
      await ModelAPI.create<OnCallDutyPolicy>({
        model: policy,
        modelType: OnCallDutyPolicy,
        miscDataProps: miscDataProps,
      }),
    );

    if (!id) {
      throw new Error("The on-call policy was made, but it can't be shown.");
    }

    return id;
  }

  /*
   * A policy as the setup shows it: its escalation rules in order, who each
   * pages, how often it repeats, and how many enabled on-call rules run it.
   * Null when it is gone.
   */
  public static async loadPolicy(
    id: string,
  ): Promise<OnCallPolicyRecord | null> {
    const policyId: ObjectID = new ObjectID(id);

    const policy: OnCallDutyPolicy | null =
      await ModelAPI.getItem<OnCallDutyPolicy>({
        modelType: OnCallDutyPolicy,
        id: policyId,
        select: {
          _id: true,
          name: true,
          repeatPolicyIfNoOneAcknowledges: true,
          repeatPolicyIfNoOneAcknowledgesNoOfTimes: true,
        },
      });

    if (!policy?.id) {
      return null;
    }

    const [rules, users, teams, schedules, incidentRules, alertRules]: [
      ListResult<OnCallDutyPolicyEscalationRule>,
      ListResult<OnCallDutyPolicyEscalationRuleUser>,
      ListResult<OnCallDutyPolicyEscalationRuleTeam>,
      ListResult<OnCallDutyPolicyEscalationRuleSchedule>,
      ListResult<IncidentOnCallRule>,
      ListResult<AlertOnCallRule>,
    ] = await Promise.all([
      ModelAPI.getList<OnCallDutyPolicyEscalationRule>({
        modelType: OnCallDutyPolicyEscalationRule,
        query: { onCallDutyPolicyId: policyId },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: { _id: true, order: true, escalateAfterInMinutes: true },
        sort: { order: SortOrder.Ascending },
      }),
      ModelAPI.getList<OnCallDutyPolicyEscalationRuleUser>({
        modelType: OnCallDutyPolicyEscalationRuleUser,
        query: { onCallDutyPolicyId: policyId },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          userId: true,
          onCallDutyPolicyEscalationRuleId: true,
          user: { name: true, email: true },
        },
        sort: {},
      }),
      ModelAPI.getList<OnCallDutyPolicyEscalationRuleTeam>({
        modelType: OnCallDutyPolicyEscalationRuleTeam,
        query: { onCallDutyPolicyId: policyId },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          onCallDutyPolicyEscalationRuleId: true,
          team: { name: true },
        },
        sort: {},
      }),
      ModelAPI.getList<OnCallDutyPolicyEscalationRuleSchedule>({
        modelType: OnCallDutyPolicyEscalationRuleSchedule,
        query: { onCallDutyPolicyId: policyId },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          onCallDutyPolicyEscalationRuleId: true,
          onCallDutyPolicySchedule: { name: true },
        },
        sort: {},
      }),
      ModelAPI.getList<IncidentOnCallRule>({
        modelType: IncidentOnCallRule,
        query: { isEnabled: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: { _id: true, onCallDutyPolicies: { _id: true } },
        sort: {},
      }),
      ModelAPI.getList<AlertOnCallRule>({
        modelType: AlertOnCallRule,
        query: { isEnabled: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: { _id: true, onCallDutyPolicies: { _id: true } },
        sort: {},
      }),
    ]);

    const levels: Array<PolicyLevel> = rules.data
      .filter((rule: OnCallDutyPolicyEscalationRule): boolean => {
        return Boolean(rule.id);
      })
      .map(
        (rule: OnCallDutyPolicyEscalationRule, index: number): PolicyLevel => {
          return {
            id: rule.id!.toString(),
            order: rule.order || index + 1,
            escalateAfterInMinutes:
              typeof rule.escalateAfterInMinutes === "number"
                ? rule.escalateAfterInMinutes
                : DEFAULT_ESCALATE_AFTER_IN_MINUTES,
            userIds: [],
            names: [],
            responderCount: 0,
          };
        },
      );

    const levelOf: (ruleId: unknown) => PolicyLevel | undefined = (
      ruleId: unknown,
    ): PolicyLevel | undefined => {
      const key: string = ruleId ? String(ruleId.toString()) : "";

      return levels.find((level: PolicyLevel): boolean => {
        return level.id === key;
      });
    };

    const addName: (level: PolicyLevel | undefined, name: string) => void = (
      level: PolicyLevel | undefined,
      name: string,
    ): void => {
      if (!level) {
        return;
      }

      level.responderCount++;

      if (name && !level.names.includes(name)) {
        level.names.push(name);
      }
    };

    for (const row of users.data) {
      const level: PolicyLevel | undefined = levelOf(
        row.onCallDutyPolicyEscalationRuleId,
      );

      if (level && row.userId) {
        level.userIds.push(row.userId.toString());
      }

      addName(
        level,
        row.user?.name?.toString() || row.user?.email?.toString() || "",
      );
    }

    for (const row of teams.data) {
      addName(
        levelOf(row.onCallDutyPolicyEscalationRuleId),
        row.team?.name || "",
      );
    }

    for (const row of schedules.data) {
      addName(
        levelOf(row.onCallDutyPolicyEscalationRuleId),
        row.onCallDutyPolicySchedule?.name || "",
      );
    }

    const namesPolicy: (
      rule: IncidentOnCallRule | AlertOnCallRule,
    ) => boolean = (rule: IncidentOnCallRule | AlertOnCallRule): boolean => {
      return (rule.onCallDutyPolicies || []).some(
        (named: OnCallDutyPolicy): boolean => {
          return (named.id || named._id)?.toString() === id;
        },
      );
    };

    return {
      id: policy.id.toString(),
      name: policy.name || ON_CALL_POLICY_NAME,
      levels: levels,
      repeatTimes: getOnCallPolicyRepeatsAllowed(policy),
      incidentRuleCount: incidentRules.data.filter(namesPolicy).length,
      alertRuleCount: alertRules.data.filter(namesPolicy).length,
    };
  }

  /*
   * Adds people and teams to a policy's first escalation rule, or makes
   * that rule when the policy has none (Level 1, FirstResponders' wait).
   */
  public static async addToFirstLevel(data: {
    policyId: string;
    firstLevelId: string | null;
    userIds: Array<string>;
    teamIds: Array<string>;
  }): Promise<void> {
    const projectId: ObjectID = currentProjectId();
    const policyId: ObjectID = new ObjectID(data.policyId);

    if (!data.firstLevelId) {
      const rule: OnCallDutyPolicyEscalationRule =
        new OnCallDutyPolicyEscalationRule();
      rule.projectId = projectId;
      rule.onCallDutyPolicyId = policyId;
      rule.escalateAfterInMinutes = DEFAULT_ESCALATE_AFTER_IN_MINUTES;

      await ModelAPI.create<OnCallDutyPolicyEscalationRule>({
        model: rule,
        modelType: OnCallDutyPolicyEscalationRule,
        miscDataProps: { users: data.userIds, teams: data.teamIds },
      });

      return;
    }

    const ruleId: ObjectID = new ObjectID(data.firstLevelId);

    for (const userId of data.userIds) {
      const row: OnCallDutyPolicyEscalationRuleUser =
        new OnCallDutyPolicyEscalationRuleUser();
      row.projectId = projectId;
      row.onCallDutyPolicyId = policyId;
      row.onCallDutyPolicyEscalationRuleId = ruleId;
      row.userId = new ObjectID(userId);

      await ModelAPI.create<OnCallDutyPolicyEscalationRuleUser>({
        model: row,
        modelType: OnCallDutyPolicyEscalationRuleUser,
      });
    }

    for (const teamId of data.teamIds) {
      const row: OnCallDutyPolicyEscalationRuleTeam =
        new OnCallDutyPolicyEscalationRuleTeam();
      row.projectId = projectId;
      row.onCallDutyPolicyId = policyId;
      row.onCallDutyPolicyEscalationRuleId = ruleId;
      row.teamId = new ObjectID(teamId);

      await ModelAPI.create<OnCallDutyPolicyEscalationRuleTeam>({
        model: row,
        modelType: OnCallDutyPolicyEscalationRuleTeam,
      });
    }
  }

  /*
   * The on-call rules that run a policy for every new incident and alert,
   * for the kinds no enabled rule runs it for yet - as Create On-Call Policy
   * adds them for a project's first policy (EveryNewEventRules).
   */
  public static async addEveryNewEventRules(data: {
    policyId: string;
    policyName: string;
    incident: boolean;
    alert: boolean;
  }): Promise<void> {
    const projectId: ObjectID = currentProjectId();
    const named: OnCallDutyPolicy = new OnCallDutyPolicy();
    named._id = data.policyId;

    if (data.incident) {
      const rule: IncidentOnCallRule = new IncidentOnCallRule();
      rule.projectId = projectId;
      rule.name = getEveryNewIncidentRuleName(data.policyName);
      rule.description = EVERY_NEW_INCIDENT_RULE_DESCRIPTION;
      rule.isEnabled = true;
      rule.onCallDutyPolicies = [named];

      await ModelAPI.create<IncidentOnCallRule>({
        model: rule,
        modelType: IncidentOnCallRule,
      });
    }

    if (data.alert) {
      const rule: AlertOnCallRule = new AlertOnCallRule();
      rule.projectId = projectId;
      rule.name = getEveryNewAlertRuleName(data.policyName);
      rule.description = EVERY_NEW_ALERT_RULE_DESCRIPTION;
      rule.isEnabled = true;
      rule.onCallDutyPolicies = [named];

      await ModelAPI.create<AlertOnCallRule>({
        model: rule,
        modelType: AlertOnCallRule,
      });
    }
  }

  // How long the first escalation rule waits for an acknowledgement.
  private static async setFirstLevelWait(data: {
    firstLevel: PolicyLevel;
    waitMinutes: number;
  }): Promise<void> {
    if (data.firstLevel.escalateAfterInMinutes === data.waitMinutes) {
      return;
    }

    await ModelAPI.updateById<OnCallDutyPolicyEscalationRule>({
      modelType: OnCallDutyPolicyEscalationRule,
      id: new ObjectID(data.firstLevel.id),
      data: { escalateAfterInMinutes: data.waitMinutes },
    });
  }

  /*
   * Someone else, after the wait: the first rule waits that long, and a
   * second rule pages the people and teams picked.
   */
  public static async addSecondLevel(data: {
    policyId: string;
    firstLevel: PolicyLevel;
    waitMinutes: number;
    userIds: Array<string>;
    teamIds: Array<string>;
  }): Promise<void> {
    await OnCallSetupApi.setFirstLevelWait(data);

    const rule: OnCallDutyPolicyEscalationRule =
      new OnCallDutyPolicyEscalationRule();
    rule.projectId = currentProjectId();
    rule.onCallDutyPolicyId = new ObjectID(data.policyId);
    rule.escalateAfterInMinutes = DEFAULT_ESCALATE_AFTER_IN_MINUTES;

    await ModelAPI.create<OnCallDutyPolicyEscalationRule>({
      model: rule,
      modelType: OnCallDutyPolicyEscalationRule,
      miscDataProps: { users: data.userIds, teams: data.teamIds },
    });
  }

  // The same people again, after the wait, this many more times at most.
  public static async setRepeat(data: {
    policyId: string;
    firstLevel: PolicyLevel;
    waitMinutes: number;
    times: number;
  }): Promise<void> {
    await OnCallSetupApi.setFirstLevelWait(data);

    await ModelAPI.updateById<OnCallDutyPolicy>({
      modelType: OnCallDutyPolicy,
      id: new ObjectID(data.policyId),
      data: {
        repeatPolicyIfNoOneAcknowledges: true,
        repeatPolicyIfNoOneAcknowledgesNoOfTimes: data.times,
      },
    });
  }

  // Whether a page reaches each person the policy pages (On-Call Readiness).
  public static async loadPolicyReadiness(data: {
    policyId: string;
    refresh: boolean;
  }): Promise<Array<ResponderReach>> {
    const url: URL = readinessUrl(`/policy/${data.policyId}`, data.refresh);
    url.addQueryParam("limit", String(READINESS_LIMIT));
    url.addQueryParam("skip", "0");

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: url,
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    return parseReadinessPage(response.data).summary.users.map(
      toResponderReach,
    );
  }

  // "Send setup reminder", as On-Call Readiness sends it.
  public static async sendSetupReminders(
    userIds: Array<string>,
  ): Promise<SetupReminderStatuses> {
    return requestSetupReminders(userIds);
  }
}
