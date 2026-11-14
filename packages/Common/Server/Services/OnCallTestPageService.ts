import { IsBillingEnabled } from "../EnvironmentConfig";
import GlobalCache from "../Infrastructure/GlobalCache";
import QueryHelper from "../Types/Database/QueryHelper";
import CallerPermission from "../Utils/Permission/CallerPermission";
import logger from "../Utils/Logger";
import ProjectMembership from "../Utils/TeamMember/ProjectMembership";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OnCallTestPageEvents from "../Utils/OnCall/OnCallTestPageEvents";
import AlertSeverityService from "./AlertSeverityService";
import BaseService from "./BaseService";
import IncidentSeverityService from "./IncidentSeverityService";
import OnCallDutyPolicyEscalationRuleScheduleService from "./OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleService, {
  AwayOverride,
} from "./OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "./OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "./OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyExecutionLogService, {
  OnCallDirectPageRun,
} from "./OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "./OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyScheduleService, {
  CurrentOnCallInSchedule,
  NextInRotationInSchedule,
} from "./OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import ProjectCallSMSConfigService from "./ProjectCallSMSConfigService";
import ProjectService from "./ProjectService";
import SmsLogService from "./SmsLogService";
import TeamMemberService from "./TeamMemberService";
import UserNotificationRuleService, {
  FallbackRule,
} from "./UserNotificationRuleService";
import UserOnCallLogService from "./UserOnCallLogService";
import UserOnCallLogTimelineService from "./UserOnCallLogTimelineService";
import UserService from "./UserService";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicyExecutionLog from "../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import Project from "../../Models/DatabaseModels/Project";
import SmsLog from "../../Models/DatabaseModels/SmsLog";
import User from "../../Models/DatabaseModels/User";
import UserNotificationRule from "../../Models/DatabaseModels/UserNotificationRule";
import UserOnCallLogTimeline from "../../Models/DatabaseModels/UserOnCallLogTimeline";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import TwilioConfig from "../../Types/CallAndSMS/TwilioConfig";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";
import NotificationRuleType from "../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  OnCallPageChannel,
  getOnCallPageChannelsOf,
} from "../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  ON_CALL_TEST_PAGES_PER_PROJECT_PER_HOUR,
  ON_CALL_TEST_PAGE_LIMIT_UNREADABLE_MESSAGE,
  ON_CALL_TEST_PAGE_PERSON_INTERVAL_IN_SECONDS,
  ON_CALL_TEST_PAGE_POLICY_INTERVAL_IN_SECONDS,
  ON_CALL_TEST_PAGE_PROJECT_LIMIT_MESSAGE,
  OnCallTestPageCost,
  OnCallTestPageDelivery,
  OnCallTestPageKind,
  OnCallTestPageNotPaged,
  OnCallTestPageNotPagedCode,
  OnCallTestPagePreview,
  OnCallTestPagePreviewLevel,
  OnCallTestPagePreviewMethod,
  OnCallTestPagePreviewPerson,
  OnCallTestPageLine,
  OnCallTestPageReachedThrough,
  OnCallTestPageReachedThroughCode,
  OnCallTestPageRecordKind,
  OnCallTestPageResult,
  OnCallTestPageStatus,
  OnCallTestPageStep,
  OnCallTestPageStepStatus,
  OnCallTestPageWarning,
  OnCallTestPageWarningCode,
  canAcknowledgeOnCallTestPageBy,
  getOnCallTestPageCost,
  getOnCallTestPageDeliveryStatus,
  getOnCallTestPageEndsAt,
  getOnCallTestPageFix,
  getOnCallTestPagePersonTooSoonMessage,
  getOnCallTestPagePolicyTooSoonMessage,
  getOnCallTestPageRuleType,
  getOnCallTestPageWalkStart,
  isOnCallTestPage,
  isOnCallTestPageRecordKind,
  isOnCallTestPageWalkLevelReached,
  sortRulesAsAPageReachesThem,
} from "../../Types/OnCallDutyPolicy/OnCallTestPage";
import {
  readOnCallTestPageDeliveryLine,
  readOnCallTestPageRunLine,
  readOnCallTestPageStepLine,
} from "../../Types/OnCallDutyPolicy/OnCallTestPageLine";
import Permission from "../../Types/Permission";
import SmsStatus from "../../Types/SmsStatus";
import UserNotificationStatus from "../../Types/UserNotification/UserNotificationStatus";
import {
  ProjectNotificationChannel,
  getProjectNotificationChannelOffMessage,
} from "../../Utils/Project/NotificationChannels";
import { TwilioMessageKind } from "../../Utils/Project/TwilioAccount";
import { SAMPLE_PROJECT_REFUSALS } from "../../Types/SampleProject/SampleProject";
import crypto from "crypto";

/*
 * SENDING A TEST PAGE, AND READING WHAT BECAME OF IT (OnCallTestPage).
 *
 * The one place a test page starts, so who may send it and how often are
 * asked the same way wherever it is offered - User Settings, On-Call >
 * Readiness, an on-call policy, a guided setup:
 *
 *   - "Send me a test page": any member, to themselves;
 *   - a test page to a member: whoever may send them a setup reminder
 *     (ON_CALL_TEST_PAGE_FOR_MEMBER_PERMISSIONS) - an act on somebody else,
 *     under the project's name;
 *   - "Test this policy": whoever may edit the policy, team blocks, labels
 *     and owned scope counted (the API asks TestSendAccess.
 *     assertMaySendTestOfSetting before it comes here) - a test pages real
 *     people.
 *
 * And how often (ON_CALL_TEST_PAGE_*): one test page to a person every two
 * minutes, one test of a policy every five, twenty tests in a project an
 * hour - counted in the shared cache across every server. A test is refused
 * while the cache cannot be read, rather than sent without a limit.
 *
 * What a test will send is answered first (getPreview), and what became of
 * it after (getResult), each from the same records a real page writes.
 */

/*
 * Who may send a test page to a member: who may send them a setup reminder
 * (OnCallReadinessAPI's SETUP_REMINDER_PERMISSIONS) - the two project roles,
 * the on-call admin, and whoever may change who gets paged.
 */
export const ON_CALL_TEST_PAGE_FOR_MEMBER_PERMISSIONS: ReadonlyArray<Permission> =
  [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.OnCallAdmin,
    Permission.EditProjectOnCallDutyPolicy,
  ];

/*
 * Who may read a test's result besides who sent it and who it paged: who
 * may read the project's on-call execution logs, where a test run is listed.
 */
export const ON_CALL_TEST_PAGE_RESULT_READ_PERMISSIONS: ReadonlyArray<Permission> =
  [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.OnCallAdmin,
    Permission.OnCallMember,
    Permission.OnCallViewer,
    Permission.ReadProjectOnCallDutyPolicyExecutionLog,
  ];

// The words a refusal of someone who may not do this says, as the routes' do.
export const ON_CALL_TEST_PAGE_NOT_AUTHORIZED_MESSAGE: string =
  "You are not authorized to access this project's data.";

const PERSON_LIMIT_NAMESPACE: string = "oncall-test-page-person";
const POLICY_LIMIT_NAMESPACE: string = "oncall-test-page-policy";
const PROJECT_LIMIT_NAMESPACE: string = "oncall-test-page-project";

/*
 * The prices a test's cost is estimated with: the Notification service's
 * own (its Config.ts reads the same settings), in US cents.
 */
export const MESSAGING_PRICE_SETTINGS: {
  sms: string;
  callPerMinute: string;
  whatsApp: string;
  telegram: string;
} = {
  sms: "SMS_DEFAULT_COST_IN_CENTS",
  callPerMinute: "CALL_DEFAULT_COST_IN_CENTS_PER_MINUTE",
  whatsApp: "WHATSAPP_TEXT_DEFAULT_COST_IN_CENTS",
  telegram: "TELEGRAM_TEXT_DEFAULT_COST_IN_CENTS",
};

const readPrice: (setting: string) => number = (setting: string): number => {
  const value: number = parseInt(process.env[setting] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
};

// One target a test of a policy's level pages: who, and why them.
interface PolicyLevelTarget {
  userId: ObjectID;
  // In English: "Team Platform".
  reachedThrough?: string | undefined;
  // As a code, with its name (#7015).
  reachedThroughCode?: OnCallTestPageReachedThrough | undefined;
}

// One level of a policy, as a test reads it: who it pages, and who it can't reach.
export interface PolicyLevel {
  targets: Array<PolicyLevelTarget>;
  notPaged: Array<string>;
  notPagedCodes: Array<OnCallTestPageNotPaged>;
}

// Why a target reaches nobody, before its English sentence is added.
type NotPagedValues = Omit<OnCallTestPageNotPaged, "message">;

// The escalation rule of a level, by its order: 1 for the first.
function getRuleOfOrder(
  rules: Array<OnCallDutyPolicyEscalationRule>,
  order: number,
): OnCallDutyPolicyEscalationRule | undefined {
  return rules.find((rule: OnCallDutyPolicyEscalationRule): boolean => {
    return rule.order === order;
  });
}

// Why them, when there is a name to say it with.
function reachedThroughOf(
  code: OnCallTestPageReachedThroughCode,
  name: string,
): OnCallTestPageReachedThrough | undefined {
  return name ? { code: code, name: name } : undefined;
}

// A person's preview, with why the level pages them - or with no reason.
function withReachedThrough(
  person: OnCallTestPagePreviewPerson,
  target: {
    reachedThrough?: string | undefined;
    reachedThroughCode?: OnCallTestPageReachedThrough | undefined;
  },
): OnCallTestPagePreviewPerson {
  const next: OnCallTestPagePreviewPerson = { ...person };
  const text: string | undefined = target.reachedThroughCode
    ? getReachedThroughText(target.reachedThroughCode)
    : target.reachedThrough;

  delete next.reachedThrough;
  delete next.reachedThroughCode;

  if (text) {
    next.reachedThrough = text;
  }

  if (target.reachedThroughCode) {
    next.reachedThroughCode = target.reachedThroughCode;
  }

  return next;
}

// The reasons, with their English sentences, as a preview carries them.
function toNotPagedLists(values: Array<NotPagedValues>): {
  notPaged: Array<string>;
  notPagedCodes: Array<OnCallTestPageNotPaged>;
} {
  const notPagedCodes: Array<OnCallTestPageNotPaged> = values.map(
    (value: NotPagedValues): OnCallTestPageNotPaged => {
      return { ...value, message: getNotPagedMessage(value) };
    },
  );

  return {
    notPaged: notPagedCodes.map((notPaged: OnCallTestPageNotPaged): string => {
      return notPaged.message;
    }),
    notPagedCodes: notPagedCodes,
  };
}

export class OnCallTestPageService extends BaseService {
  public constructor() {
    super();
  }

  /*
   * Whether a caller may send a test page to somebody other than
   * themselves. Master admins may; everybody else holds one of
   * ON_CALL_TEST_PAGE_FOR_MEMBER_PERMISSIONS in the project.
   */
  public assertMaySendToMember(props: DatabaseCommonInteractionProps): void {
    if (props.isMasterAdmin) {
      return;
    }

    if (
      !CallerPermission.holdsAnyOf(props, [
        ...ON_CALL_TEST_PAGE_FOR_MEMBER_PERMISSIONS,
      ])
    ) {
      throw new NotAuthorizedException(
        ON_CALL_TEST_PAGE_NOT_AUTHORIZED_MESSAGE,
      );
    }
  }

  // A person the test pages must be a member of the project.
  public async assertIsProjectMember(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<void> {
    const isMember: boolean = await ProjectMembership.isMember({
      projectId: data.projectId,
      userId: data.userId,
    });

    if (!isMember) {
      throw new NotAuthorizedException(
        ON_CALL_TEST_PAGE_NOT_AUTHORIZED_MESSAGE,
      );
    }
  }

  /*
   * The severity a test stands in for must be one of the project's, of the
   * kind it tests. Returns its name.
   */
  public async readSeverity(data: {
    projectId: ObjectID;
    recordKind: OnCallTestPageRecordKind;
    severityId: ObjectID;
  }): Promise<string> {
    const severity: IncidentSeverity | AlertSeverity | null =
      data.recordKind === OnCallTestPageRecordKind.Alert
        ? await AlertSeverityService.findOneBy({
            query: {
              _id: data.severityId.toString(),
              projectId: data.projectId,
            },
            select: {
              name: true,
            },
            props: {
              isRoot: true,
            },
          })
        : await IncidentSeverityService.findOneBy({
            query: {
              _id: data.severityId.toString(),
              projectId: data.projectId,
            },
            select: {
              name: true,
            },
            props: {
              isRoot: true,
            },
          });

    if (!severity) {
      throw new BadDataException(
        data.recordKind === OnCallTestPageRecordKind.Alert
          ? "Pick one of this project's alert severities."
          : "Pick one of this project's incident severities.",
      );
    }

    return severity.name?.toString() || "";
  }

  // A policy of the project, read as OneUptime once the caller may test it.
  public async readPolicy(data: {
    projectId: ObjectID;
    policyId: ObjectID;
  }): Promise<OnCallDutyPolicy> {
    const policy: OnCallDutyPolicy | null =
      await OnCallDutyPolicyService.findOneBy({
        query: {
          _id: data.policyId.toString(),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          name: true,
          isArchived: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!policy) {
      throw new BadDataException("On-call policy not found.");
    }

    return policy;
  }

  /*
   * SENDS A TEST PAGE TO ONE PERSON: the caller themselves, or a member the
   * caller may send one to (the API checks which). Limited to one a person
   * every two minutes and twenty a project an hour. Returns the run.
   */
  /*
   * A sample project (issue #6808) sends nothing, a test page included:
   * refused before anything is claimed or written, with where to send one
   * from instead. What a test would send can still be read (getPreview).
   */
  public async assertNotSampleProject(projectId: ObjectID): Promise<void> {
    if (await ProjectService.isSampleProject(projectId)) {
      throw new BadDataException(SAMPLE_PROJECT_REFUSALS.testPage);
    }
  }

  @CaptureSpan()
  public async sendToPerson(data: {
    projectId: ObjectID;
    targetUserId: ObjectID;
    sentByUserId: ObjectID;
    recordKind: OnCallTestPageRecordKind;
    severityId: ObjectID;
  }): Promise<OnCallDirectPageRun> {
    await this.assertNotSampleProject(data.projectId);

    await this.assertIsProjectMember({
      projectId: data.projectId,
      userId: data.targetUserId,
    });

    await this.readSeverity({
      projectId: data.projectId,
      recordKind: data.recordKind,
      severityId: data.severityId,
    });

    await this.claimLimits({
      projectId: data.projectId,
      key: {
        namespace: PERSON_LIMIT_NAMESPACE,
        id: data.targetUserId,
        intervalInSeconds: ON_CALL_TEST_PAGE_PERSON_INTERVAL_IN_SECONDS,
        tooSoonMessage: getOnCallTestPagePersonTooSoonMessage(
          ON_CALL_TEST_PAGE_PERSON_INTERVAL_IN_SECONDS,
        ),
      },
    });

    const run: OnCallDirectPageRun =
      await OnCallDutyPolicyExecutionLogService.startTestPage({
        projectId: data.projectId,
        userIds: [data.targetUserId],
        recordKind: data.recordKind,
        severityId: data.severityId,
        startedByUserId: data.sentByUserId,
      });

    OnCallTestPageEvents.onTestPageSent({
      projectId: data.projectId,
      executionLogId: run.executionLogId,
      sentByUserId: data.sentByUserId,
      kind:
        data.targetUserId.toString() === data.sentByUserId.toString()
          ? OnCallTestPageKind.Self
          : OnCallTestPageKind.Member,
      recordKind: data.recordKind,
    });

    return run;
  }

  /*
   * TESTS AN ON-CALL POLICY: its first escalation level, or every level
   * with short waits. The caller may edit the policy (the API asks).
   * Limited to one test of a policy every five minutes and twenty tests a
   * project an hour. Returns the run's id.
   */
  @CaptureSpan()
  public async testPolicy(data: {
    projectId: ObjectID;
    policyId: ObjectID;
    sentByUserId: ObjectID;
    recordKind: OnCallTestPageRecordKind;
    severityId: ObjectID;
    walksEscalation: boolean;
  }): Promise<ObjectID> {
    await this.assertNotSampleProject(data.projectId);

    await this.readPolicy({
      projectId: data.projectId,
      policyId: data.policyId,
    });

    await this.readSeverity({
      projectId: data.projectId,
      recordKind: data.recordKind,
      severityId: data.severityId,
    });

    await this.claimLimits({
      projectId: data.projectId,
      key: {
        namespace: POLICY_LIMIT_NAMESPACE,
        id: data.policyId,
        intervalInSeconds: ON_CALL_TEST_PAGE_POLICY_INTERVAL_IN_SECONDS,
        tooSoonMessage: getOnCallTestPagePolicyTooSoonMessage(
          ON_CALL_TEST_PAGE_POLICY_INTERVAL_IN_SECONDS,
        ),
      },
    });

    const executionLogId: ObjectID =
      await OnCallDutyPolicyExecutionLogService.startPolicyTest({
        projectId: data.projectId,
        onCallDutyPolicyId: data.policyId,
        recordKind: data.recordKind,
        severityId: data.severityId,
        walksEscalation: data.walksEscalation,
        startedByUserId: data.sentByUserId,
      });

    OnCallTestPageEvents.onTestPageSent({
      projectId: data.projectId,
      executionLogId: executionLogId,
      sentByUserId: data.sentByUserId,
      kind: OnCallTestPageKind.Policy,
      recordKind: data.recordKind,
    });

    return executionLogId;
  }

  /*
   * HOW OFTEN TESTS ARE SENT: the person's or policy's own window first -
   * claimed with SET NX, so two clicks on two servers send once - then the
   * project's hour. A test the project's hour refuses hands its window
   * back. Throws TooManyRequestsException with the words to show; refuses
   * while the cache cannot be read.
   */
  public async claimLimits(data: {
    projectId: ObjectID;
    key: {
      namespace: string;
      id: ObjectID;
      intervalInSeconds: number;
      tooSoonMessage: string;
    };
    now?: Date | undefined;
  }): Promise<void> {
    const token: string = crypto.randomUUID();
    const windowKey: string = `${data.projectId.toString()}:${data.key.id.toString()}`;

    let claimed: boolean;

    try {
      claimed = await GlobalCache.setStringIfNotExists(
        data.key.namespace,
        windowKey,
        token,
        {
          expiresInSeconds: data.key.intervalInSeconds,
        },
      );
    } catch (err) {
      logger.error(
        `Could not read how often test pages are sent in project ${data.projectId.toString()}: ${err}`,
      );
      throw new TooManyRequestsException(
        ON_CALL_TEST_PAGE_LIMIT_UNREADABLE_MESSAGE,
      );
    }

    if (!claimed) {
      throw new TooManyRequestsException(data.key.tooSoonMessage);
    }

    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const hour: number = Math.floor(now.getTime() / (60 * 60 * 1000));

    let count: number | null;

    try {
      count = await GlobalCache.incrementIfBelow(
        PROJECT_LIMIT_NAMESPACE,
        `${data.projectId.toString()}:${hour}`,
        {
          limit: ON_CALL_TEST_PAGES_PER_PROJECT_PER_HOUR,
          expiresInSeconds: 60 * 60,
        },
      );
    } catch (err) {
      logger.error(
        `Could not count the test pages of project ${data.projectId.toString()}: ${err}`,
      );
      await this.releaseWindow(data.key.namespace, windowKey, token);
      throw new TooManyRequestsException(
        ON_CALL_TEST_PAGE_LIMIT_UNREADABLE_MESSAGE,
      );
    }

    if (count === null) {
      await this.releaseWindow(data.key.namespace, windowKey, token);
      throw new TooManyRequestsException(
        ON_CALL_TEST_PAGE_PROJECT_LIMIT_MESSAGE,
      );
    }
  }

  private async releaseWindow(
    namespace: string,
    key: string,
    token: string,
  ): Promise<void> {
    try {
      await GlobalCache.deleteKeyIfValue(namespace, key, token);
    } catch (err) {
      logger.error(err as Error);
    }
  }

  /*
   * WHAT A TEST WILL SEND, before it is sent: for one person, their methods
   * for the test's severity in the order a real page reaches them - or,
   * with no rule for it, the ones the project's fallback picks (#7262) -
   * and where to, for the person themselves; for a policy, the people its
   * first level pages right now, each with theirs - and the levels after it
   * that a test walking every level pages before it ends (#7016). With what
   * it costs on OneUptime Cloud: the first level's, and a walk's at most.
   */
  @CaptureSpan()
  public async getPreview(data: {
    projectId: ObjectID;
    callerUserId: ObjectID;
    recordKind: OnCallTestPageRecordKind;
    severityId: ObjectID;
    targetUserId?: ObjectID | undefined;
    policyId?: ObjectID | undefined;
  }): Promise<OnCallTestPagePreview> {
    await this.readSeverity({
      projectId: data.projectId,
      recordKind: data.recordKind,
      severityId: data.severityId,
    });

    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: {
        enableSmsNotifications: true,
        enableCallNotifications: true,
        enableWhatsAppNotifications: true,
        enableTelegramNotifications: true,
        disableOnCallNotificationFallback: true,
      },
      props: {
        isRoot: true,
      },
    });

    // Each person's methods are read once, however many levels page them.
    const previews: Map<string, Promise<OnCallTestPagePreviewPerson>> = new Map<
      string,
      Promise<OnCallTestPagePreviewPerson>
    >();

    const previewPeople: (
      targets: Array<PolicyLevelTarget>,
    ) => Promise<Array<OnCallTestPagePreviewPerson>> = async (
      targets: Array<PolicyLevelTarget>,
    ): Promise<Array<OnCallTestPagePreviewPerson>> => {
      const people: Array<OnCallTestPagePreviewPerson> = [];

      for (const target of targets) {
        const key: string = target.userId.toString().toLowerCase();
        let preview: Promise<OnCallTestPagePreviewPerson> | undefined =
          previews.get(key);

        if (!preview) {
          preview = this.getPersonPreview({
            projectId: data.projectId,
            userId: target.userId,
            recordKind: data.recordKind,
            severityId: data.severityId,
            showAddresses:
              target.userId.toString() === data.callerUserId.toString(),
            project: project,
            // With no rule, what the fallback sends them is listed, and priced (#7262).
            readsFallbackMethods: true,
          });

          previews.set(key, preview);
        }

        people.push(withReachedThrough(await preview, target));
      }

      return people;
    };

    if (!data.policyId) {
      const targetUserId: ObjectID = data.targetUserId || data.callerUserId;

      const people: Array<OnCallTestPagePreviewPerson> = await previewPeople([
        { userId: targetUserId },
      ]);

      const [cost]: Array<OnCallTestPageCost> = await this.getCosts({
        projectId: data.projectId,
        peopleOfEach: [people],
      });

      return {
        kind:
          targetUserId.toString() === data.callerUserId.toString()
            ? OnCallTestPageKind.Self
            : OnCallTestPageKind.Member,
        people: people,
        notPaged: [],
        notPagedCodes: [],
        cost: cost!,
      };
    }

    const rules: Array<OnCallDutyPolicyEscalationRule> =
      await this.readEscalationRules({
        projectId: data.projectId,
        policyId: data.policyId,
      });

    const first: PolicyLevel & { levelCount: number } =
      await this.readFirstLevelOf({
        projectId: data.projectId,
        policyId: data.policyId,
        rules: rules,
      });

    const people: Array<OnCallTestPagePreviewPerson> = await previewPeople(
      first.targets,
    );

    /*
     * The walk: each level after the first, in order, while it starts
     * before the test ends - its people read only then.
     */
    const walkLevels: Array<OnCallTestPagePreviewLevel> = [];
    let walkUnreachedLevelCount: number = 0;
    let previous: {
      rule: OnCallDutyPolicyEscalationRule | undefined;
      startsAfterMinutes: number;
      pagesAnybody: boolean;
    } = {
      rule: getRuleOfOrder(rules, 1),
      startsAfterMinutes: 0,
      pagesAnybody: people.length > 0,
    };

    if (previous.rule) {
      for (let order: number = 2; ; order++) {
        const rule: OnCallDutyPolicyEscalationRule | undefined = getRuleOfOrder(
          rules,
          order,
        );

        if (!rule || !rule.id) {
          break;
        }

        const startsAfterMinutes: number = getOnCallTestPageWalkStart({
          previousStartsAfterMinutes: previous.startsAfterMinutes,
          previousWaitInMinutes: previous.rule?.escalateAfterInMinutes,
          previousPagesAnybody: previous.pagesAnybody,
        });

        if (!isOnCallTestPageWalkLevelReached(startsAfterMinutes)) {
          break;
        }

        const level: PolicyLevel = await this.readLevel({
          projectId: data.projectId,
          policyId: data.policyId,
          ruleId: rule.id,
          order: order,
        });

        const levelPeople: Array<OnCallTestPagePreviewPerson> =
          await previewPeople(level.targets);

        walkLevels.push({
          order: order,
          startsAfterMinutes: startsAfterMinutes,
          people: levelPeople,
          notPaged: level.notPaged,
          notPagedCodes: level.notPagedCodes,
        });

        previous = {
          rule: rule,
          startsAfterMinutes: startsAfterMinutes,
          pagesAnybody: levelPeople.length > 0,
        };
      }

      walkUnreachedLevelCount = Math.max(
        0,
        rules.filter((rule: OnCallDutyPolicyEscalationRule): boolean => {
          return typeof rule.order === "number" && rule.order > 1;
        }).length - walkLevels.length,
      );
    }

    const [cost, walkCost]: Array<OnCallTestPageCost> = await this.getCosts({
      projectId: data.projectId,
      peopleOfEach: [
        people,
        [
          ...people,
          ...walkLevels.flatMap(
            (
              level: OnCallTestPagePreviewLevel,
            ): Array<OnCallTestPagePreviewPerson> => {
              return level.people;
            },
          ),
        ],
      ],
    });

    return {
      kind: OnCallTestPageKind.Policy,
      people: people,
      notPaged: first.notPaged,
      notPagedCodes: first.notPagedCodes,
      levelCount: first.levelCount,
      cost: cost!,
      walkLevels: walkLevels,
      walkUnreachedLevelCount: walkUnreachedLevelCount,
      walkCost: walkCost!,
    };
  }

  // What a test costs the project, from its people's methods.
  public async getCost(data: {
    projectId: ObjectID;
    people: Array<OnCallTestPagePreviewPerson>;
  }): Promise<OnCallTestPageCost> {
    const [cost]: Array<OnCallTestPageCost> = await this.getCosts({
      projectId: data.projectId,
      peopleOfEach: [data.people],
    });

    return cost!;
  }

  /*
   * What each of several tests costs - a policy's first level, and its walk
   * - with the project's own Twilio accounts read once.
   */
  public async getCosts(data: {
    projectId: ObjectID;
    peopleOfEach: Array<Array<OnCallTestPagePreviewPerson>>;
  }): Promise<Array<OnCallTestPageCost>> {
    const smsConfig: TwilioConfig | undefined =
      await ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
        data.projectId,
        TwilioMessageKind.SMS,
      );

    const callConfig: TwilioConfig | undefined =
      await ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
        data.projectId,
        TwilioMessageKind.Call,
      );

    return data.peopleOfEach.map(
      (people: Array<OnCallTestPagePreviewPerson>): OnCallTestPageCost => {
        return getOnCallTestPageCost({
          people: people,
          isBillingEnabled: IsBillingEnabled,
          hasOwnTwilioForSms: Boolean(smsConfig),
          hasOwnTwilioForCalls: Boolean(callConfig),
          prices: {
            smsInCents: readPrice(MESSAGING_PRICE_SETTINGS.sms),
            callPerMinuteInCents: readPrice(
              MESSAGING_PRICE_SETTINGS.callPerMinute,
            ),
            whatsAppInCents: readPrice(MESSAGING_PRICE_SETTINGS.whatsApp),
            telegramInCents: readPrice(MESSAGING_PRICE_SETTINGS.telegram),
          },
        });
      },
    );
  }

  /*
   * One person's methods for the test's severity: the rules a real page of
   * it runs (UserOnCallLogService.getPagingRulesQuery), in the order a page
   * reaches them. With none, whether they opted out, and whether the
   * project falls back to their verified methods - and, read for a test's
   * preview (readsFallbackMethods), the methods the fallback picks
   * (UserNotificationRuleService.getFallbackRules), each marked isFallback,
   * so the preview lists what the test sends them and prices it (#7262).
   */
  public async getPersonPreview(data: {
    projectId: ObjectID;
    userId: ObjectID;
    recordKind: OnCallTestPageRecordKind;
    severityId: ObjectID;
    showAddresses: boolean;
    // Why a policy's level pages them: its English, or as a code.
    reachedThrough?: string | undefined;
    reachedThroughCode?: OnCallTestPageReachedThrough | undefined;
    project: Project | null;
    /*
     * Whether a person with no rule is previewed with what the fallback
     * picks. A test's preview reads it; the view of who would be told
     * (WhoIsToldService) reads every verified method of a person itself.
     */
    readsFallbackMethods?: boolean | undefined;
  }): Promise<OnCallTestPagePreviewPerson> {
    const ruleType: NotificationRuleType = getOnCallTestPageRuleType(
      data.recordKind,
    );

    const incidentSeverityId: ObjectID | undefined =
      data.recordKind === OnCallTestPageRecordKind.Incident
        ? data.severityId
        : undefined;
    const alertSeverityId: ObjectID | undefined =
      data.recordKind === OnCallTestPageRecordKind.Alert
        ? data.severityId
        : undefined;

    const rules: Array<UserNotificationRule> =
      await UserNotificationRuleService.findBy({
        query: UserOnCallLogService.getPagingRulesQuery({
          userId: data.userId,
          projectId: data.projectId,
          ruleType: ruleType,
          incidentSeverityId: incidentSeverityId,
          alertSeverityId: alertSeverityId,
        }),
        select: {
          _id: true,
          notifyAfterMinutes: true,
          userEmail: { email: true, isVerified: true },
          userSms: { phone: true, isVerified: true },
          userCall: { phone: true, isVerified: true },
          userWhatsApp: { phone: true, isVerified: true },
          userTelegram: { telegramUserHandle: true, isVerified: true },
          userSlack: { slackUserName: true, isVerified: true },
          userMicrosoftTeams: {
            microsoftTeamsUserName: true,
            isVerified: true,
          },
          userMattermost: { mattermostUserName: true, isVerified: true },
          userPush: { deviceName: true, isVerified: true },
          userWebhook: { name: true },
          customNotificationChannel: { name: true, isEnabled: true },
        },
        sort: {
          notifyAfterMinutes: SortOrder.Ascending,
          createdAt: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const user: User | null = await UserService.findOneById({
      id: data.userId,
      select: {
        name: true,
        email: true,
      },
      props: {
        isRoot: true,
      },
    });

    const methods: Array<OnCallTestPagePreviewMethod> = [];

    for (const rule of sortRulesAsAPageReachesThem(rules)) {
      methods.push(
        ...getPreviewMethodsOfRule({
          rule: rule,
          showAddresses: data.showAddresses,
        }),
      );
    }

    let isOptedOut: boolean = false;

    if (rules.length === 0) {
      const optOut: UserNotificationRule | null =
        await UserNotificationRuleService.findOneBy({
          query: {
            userId: data.userId,
            projectId: data.projectId,
            ruleType: ruleType,
            incidentSeverityId: incidentSeverityId,
            alertSeverityId: alertSeverityId,
            isOptOut: true,
          },
          select: {
            _id: true,
          },
          props: {
            isRoot: true,
          },
        });

      isOptedOut = Boolean(optOut);
    }

    /*
     * No rule, not opted out, and a project that falls back: a real page -
     * so the test - goes to what the fallback picks of their methods, read
     * by the fallback's own reader (#7262).
     */
    const readsFallbackMethods: boolean = Boolean(
      data.readsFallbackMethods &&
        rules.length === 0 &&
        !isOptedOut &&
        !data.project?.disableOnCallNotificationFallback,
    );

    if (readsFallbackMethods) {
      const fallbackRules: Array<FallbackRule> =
        await UserNotificationRuleService.getFallbackRules({
          projectId: data.projectId,
          userId: data.userId,
          ruleType: ruleType,
        });

      for (const fallback of fallbackRules) {
        methods.push(
          ...getPreviewMethodsOfRule({
            rule: fallback.rule,
            showAddresses: data.showAddresses,
          }).map(
            (
              method: OnCallTestPagePreviewMethod,
            ): OnCallTestPagePreviewMethod => {
              return { ...method, isFallback: true };
            },
          ),
        );
      }
    }

    const warningCodes: Array<OnCallTestPageWarning> = getPreviewWarningCodes({
      methods: methods,
      project: data.project,
      hasNoRule: rules.length === 0,
      isOptedOut: isOptedOut,
      readsFallbackMethods: readsFallbackMethods,
    });

    return withReachedThrough(
      {
        userId: data.userId.toString(),
        userName: user?.name?.toString() || user?.email?.toString() || "",
        methods: methods,
        hasNoRule: rules.length === 0,
        isOptedOut: isOptedOut,
        warnings: warningCodes.map((warning: OnCallTestPageWarning): string => {
          return warning.message;
        }),
        warningCodes: warningCodes,
      },
      data,
    );
  }

  /*
   * Who a policy's first level pages right now, as readLevel reads it, and
   * how many levels the policy has. What the view of who would be told
   * (WhoIsToldService) reads of each policy.
   */
  public async readFirstLevel(data: {
    projectId: ObjectID;
    policyId: ObjectID;
  }): Promise<PolicyLevel & { levelCount: number }> {
    return await this.readFirstLevelOf({
      projectId: data.projectId,
      policyId: data.policyId,
      rules: await this.readEscalationRules(data),
    });
  }

  // A policy's escalation levels, in order, with each one's wait.
  public async readEscalationRules(data: {
    projectId: ObjectID;
    policyId: ObjectID;
  }): Promise<Array<OnCallDutyPolicyEscalationRule>> {
    return await OnCallDutyPolicyEscalationRuleService.findBy({
      query: {
        projectId: data.projectId,
        onCallDutyPolicyId: data.policyId,
      },
      select: {
        _id: true,
        order: true,
        escalateAfterInMinutes: true,
      },
      sort: {
        order: SortOrder.Ascending,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });
  }

  // The first level of these escalation rules: the one a run starts with.
  private async readFirstLevelOf(data: {
    projectId: ObjectID;
    policyId: ObjectID;
    rules: Array<OnCallDutyPolicyEscalationRule>;
  }): Promise<PolicyLevel & { levelCount: number }> {
    const firstRule: OnCallDutyPolicyEscalationRule | undefined =
      getRuleOfOrder(data.rules, 1);

    if (!firstRule || !firstRule.id) {
      return {
        targets: [],
        ...toNotPagedLists([
          { code: OnCallTestPageNotPagedCode.PolicyHasNoLevels },
        ]),
        levelCount: data.rules.length,
      };
    }

    return {
      ...(await this.readLevel({
        projectId: data.projectId,
        policyId: data.policyId,
        ruleId: firstRule.id,
        order: 1,
      })),
      levelCount: data.rules.length,
    };
  }

  /*
   * Who one level of a policy pages right now: its people, each team's
   * accepted members and whoever is on call in its schedules - a user
   * override sending a person's page to who covers them, or skipping them
   * while they are away - and nobody twice; with the targets that will
   * reach nobody, and why. Read as a real run reads a level when it starts
   * it (OnCallDutyPolicyEscalationRuleService.pageTargets), without paging.
   */
  public async readLevel(data: {
    projectId: ObjectID;
    policyId: ObjectID;
    ruleId: ObjectID;
    order: number;
  }): Promise<PolicyLevel> {
    const notPaged: Array<NotPagedValues> = [];
    const candidates: Array<{
      userId: ObjectID;
      reachedThroughCode?: OnCallTestPageReachedThrough | undefined;
      appliesOverride: boolean;
    }> = [];

    const teams: Array<OnCallDutyPolicyEscalationRuleTeam> =
      await OnCallDutyPolicyEscalationRuleTeamService.findBy({
        query: { onCallDutyPolicyEscalationRuleId: data.ruleId },
        select: { teamId: true, team: { name: true } },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

    for (const teamRow of teams) {
      if (!teamRow.teamId) {
        continue;
      }

      const members: Array<User> = await TeamMemberService.getUsersInTeams(
        [teamRow.teamId],
        { acceptedOnly: true },
      );

      const teamName: string = teamRow.team?.name?.toString() || "";

      if (members.length === 0) {
        notPaged.push({
          code: OnCallTestPageNotPagedCode.TeamHasNoMembers,
          teamName: teamName,
        });
      }

      for (const member of members) {
        if (member.id) {
          candidates.push({
            userId: member.id,
            reachedThroughCode: reachedThroughOf(
              OnCallTestPageReachedThroughCode.Team,
              teamName,
            ),
            appliesOverride: true,
          });
        }
      }
    }

    const users: Array<OnCallDutyPolicyEscalationRuleUser> =
      await OnCallDutyPolicyEscalationRuleUserService.findBy({
        query: { onCallDutyPolicyEscalationRuleId: data.ruleId },
        select: { userId: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

    for (const userRow of users) {
      if (userRow.userId) {
        candidates.push({ userId: userRow.userId, appliesOverride: true });
      }
    }

    const schedules: Array<OnCallDutyPolicyEscalationRuleSchedule> =
      await OnCallDutyPolicyEscalationRuleScheduleService.findBy({
        query: { onCallDutyPolicyEscalationRuleId: data.ruleId },
        select: {
          onCallDutyPolicyScheduleId: true,
          onCallDutyPolicySchedule: { name: true },
          pageNextInRotation: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

    for (const scheduleRow of schedules) {
      if (!scheduleRow.onCallDutyPolicyScheduleId) {
        continue;
      }

      const scheduleName: string =
        scheduleRow.onCallDutyPolicySchedule?.name?.toString() || "";

      if (scheduleRow.pageNextInRotation) {
        const next: NextInRotationInSchedule | null =
          await OnCallDutyPolicyScheduleService.getNextInRotationInSchedule(
            scheduleRow.onCallDutyPolicyScheduleId,
            { onCallDutyPolicyId: data.policyId },
          );

        if (!next || !next.nextUserId) {
          notPaged.push({
            code: OnCallTestPageNotPagedCode.NobodyNextInRotation,
            scheduleName: scheduleName,
          });
          continue;
        }

        candidates.push({
          userId: next.nextUserId,
          reachedThroughCode: reachedThroughOf(
            OnCallTestPageReachedThroughCode.ScheduleNextInRotation,
            scheduleName,
          ),
          appliesOverride: false,
        });

        continue;
      }

      const onCall: CurrentOnCallInSchedule | null =
        await OnCallDutyPolicyScheduleService.getCurrentOnCallInSchedule(
          scheduleRow.onCallDutyPolicyScheduleId,
          { onCallDutyPolicyId: data.policyId },
        );

      if (!onCall) {
        notPaged.push({
          code: OnCallTestPageNotPagedCode.NobodyOnCall,
          scheduleName: scheduleName,
        });
        continue;
      }

      // The schedule applied its overrides already.
      candidates.push({
        userId: onCall.userId,
        reachedThroughCode: reachedThroughOf(
          OnCallTestPageReachedThroughCode.Schedule,
          scheduleName,
        ),
        appliesOverride: false,
      });
    }

    const targets: Array<PolicyLevelTarget> = [];
    const seen: Set<string> = new Set<string>();

    const memberUserIds: Set<string> = await ProjectMembership.getMemberUserIds(
      {
        projectId: data.projectId,
        userIds: candidates.map((candidate: { userId: ObjectID }): ObjectID => {
          return candidate.userId;
        }),
      },
    );

    for (const candidate of candidates) {
      let userId: ObjectID = candidate.userId;
      let reachedThroughCode: OnCallTestPageReachedThrough | undefined =
        candidate.reachedThroughCode;

      if (candidate.appliesOverride) {
        const away: AwayOverride | null =
          await OnCallDutyPolicyEscalationRuleService.getAwayOverride({
            userId: candidate.userId,
            onCallDutyPolicyId: data.policyId,
            projectId: data.projectId,
          });

        if (away && !away.coverUserId) {
          notPaged.push({
            code: OnCallTestPageNotPagedCode.AwayWithNobodyCovering,
            userName: await this.readName(candidate.userId),
            awayUntil: OneUptimeDate.fromString(away.endsAt).toISOString(),
          });
          continue;
        }

        if (away?.coverUserId) {
          reachedThroughCode = reachedThroughOf(
            OnCallTestPageReachedThroughCode.CoveringFor,
            await this.readName(candidate.userId),
          );
          userId = away.coverUserId;
        }
      }

      const key: string = userId.toString().toLowerCase();

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      if (
        !memberUserIds.has(key) &&
        !(await ProjectMembership.isMember({
          projectId: data.projectId,
          userId: userId,
        }))
      ) {
        notPaged.push({
          code: OnCallTestPageNotPagedCode.NotProjectMember,
          userName: await this.readName(userId),
        });
        continue;
      }

      targets.push({
        userId: userId,
        ...(reachedThroughCode
          ? {
              reachedThrough: getReachedThroughText(reachedThroughCode),
              reachedThroughCode: reachedThroughCode,
            }
          : {}),
      });
    }

    if (teams.length === 0 && users.length === 0 && schedules.length === 0) {
      notPaged.push({
        code: OnCallTestPageNotPagedCode.LevelNamesNobody,
        levelOrder: data.order,
      });
    }

    return {
      targets: targets,
      ...toNotPagedLists(notPaged),
    };
  }

  private async readName(userId: ObjectID): Promise<string> {
    const user: User | null = await UserService.findOneById({
      id: userId,
      select: { name: true, email: true },
      props: { isRoot: true },
    });

    return user?.name?.toString() || user?.email?.toString() || "Someone";
  }

  /*
   * WHAT BECAME OF A TEST: the chain as it happened (OnCallTestPageResult) -
   * its run, each line of its timeline (a person paged, a target that
   * reached nobody) and each message to each person, with what its log
   * says and where a message that did not go out is fixed. Read by who sent
   * it, who it paged, and who may read the project's execution logs.
   */
  @CaptureSpan()
  public async getResult(data: {
    projectId: ObjectID;
    executionLogId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<OnCallTestPageResult> {
    const run: OnCallDutyPolicyExecutionLog | null =
      await OnCallDutyPolicyExecutionLogService.findOneBy({
        query: {
          _id: data.executionLogId.toString(),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          projectId: true,
          status: true,
          statusMessage: true,
          createdAt: true,
          userNotificationEventType: true,
          testPageRecordKind: true,
          testPageSeverityId: true,
          testPageWalksEscalation: true,
          // Who sent it: the person its run was created for.
          createdByUserId: true,
          acknowledgedAt: true,
          acknowledgedByUserId: true,
          acknowledgedByUser: {
            name: true,
            email: true,
          },
          onCallDutyPolicyId: true,
          onCallDutyPolicy: {
            name: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

    if (!run || !isOnCallTestPage(run)) {
      throw new BadDataException("Test page not found.");
    }

    const lines: Array<OnCallDutyPolicyExecutionLogTimeline> =
      await OnCallDutyPolicyExecutionLogTimelineService.findBy({
        query: {
          onCallDutyPolicyExecutionLogId: run.id!,
        },
        select: {
          _id: true,
          status: true,
          statusMessage: true,
          createdAt: true,
          alertSentToUserId: true,
          alertSentToUser: { name: true, email: true },
          userBelongsToTeam: { name: true },
          onCallDutySchedule: { name: true },
          overridedByUser: { name: true, email: true },
          onCallDutyPolicyEscalationRule: { name: true, order: true },
          isAcknowledged: true,
        },
        sort: {
          createdAt: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    this.assertMayReadResult({
      run: run,
      lines: lines,
      props: data.props,
    });

    const deliveries: Array<UserOnCallLogTimeline> =
      await UserOnCallLogTimelineService.findBy({
        query: {
          onCallDutyPolicyExecutionLogId: run.id!,
        },
        select: {
          _id: true,
          userId: true,
          onCallDutyPolicyExecutionLogTimelineId: true,
          status: true,
          statusMessage: true,
          createdAt: true,
          acknowledgedAt: true,
          isAcknowledged: true,
          userCallId: true,
          userSmsId: true,
          userWhatsAppId: true,
          userTelegramId: true,
          userPushId: true,
          userEmailId: true,
          userSlackId: true,
          userMicrosoftTeamsId: true,
          userMattermostId: true,
          userWebhookId: true,
          customNotificationChannelId: true,
          userEmail: { email: true },
          userSms: { phone: true },
          userCall: { phone: true },
          userWhatsApp: { phone: true },
          userPush: { deviceName: true },
          userTelegram: { telegramUserHandle: true },
          userSlack: { slackUserName: true },
          userMicrosoftTeams: { microsoftTeamsUserName: true },
          userMattermost: { mattermostUserName: true },
          userWebhook: { name: true },
          customNotificationChannel: { name: true },
        },
        sort: {
          createdAt: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const deliveredSmsIds: Set<string> =
      await this.readDeliveredSms(deliveries);

    const severityName: string = await this.readSeverityNameOf(run);

    const steps: Array<OnCallTestPageStep> = lines.map(
      (line: OnCallDutyPolicyExecutionLogTimeline): OnCallTestPageStep => {
        return this.toStep({
          line: line,
          deliveries: deliveries.filter(
            (delivery: UserOnCallLogTimeline): boolean => {
              return (
                delivery.onCallDutyPolicyExecutionLogTimelineId?.toString() ===
                line.id?.toString()
              );
            },
          ),
          deliveredSmsIds: deliveredSmsIds,
        });
      },
    );

    const acknowledgedFrom: UserOnCallLogTimeline | undefined =
      this.getFirstAcknowledgedDelivery({
        deliveries: deliveries,
        acknowledgedByUserId: run.acknowledgedByUserId,
      });

    const startedAt: Date = run.createdAt
      ? OneUptimeDate.fromString(run.createdAt)
      : OneUptimeDate.getCurrentDate();

    const result: OnCallTestPageResult = {
      executionLogId: run.id!.toString(),
      kind: this.getKindOf({ run: run, lines: lines }),
      ...(run.onCallDutyPolicyId
        ? {
            policyId: run.onCallDutyPolicyId.toString(),
            policyName: run.onCallDutyPolicy?.name?.toString() || "",
          }
        : {}),
      recordKind: isOnCallTestPageRecordKind(run.testPageRecordKind)
        ? run.testPageRecordKind
        : OnCallTestPageRecordKind.Incident,
      severityName: severityName,
      walksEscalation: Boolean(run.testPageWalksEscalation),
      status: getResultStatus(run),
      statusMessage: run.statusMessage || "",
      startedAt: startedAt.toISOString(),
      endsAt: getOnCallTestPageEndsAt(startedAt).toISOString(),
      steps: steps,
    };

    // What the run's line says, as a code the Dashboard words (#7260).
    const runLine: OnCallTestPageLine | null = readOnCallTestPageRunLine(
      run.statusMessage,
    );

    if (runLine) {
      result.statusMessageCode = runLine;
    }

    if (run.acknowledgedAt) {
      result.acknowledgedByName =
        run.acknowledgedByUser?.name?.toString() ||
        run.acknowledgedByUser?.email?.toString() ||
        "";

      const channel: OnCallPageChannel | undefined = acknowledgedFrom
        ? getOnCallPageChannelsOf(acknowledgedFrom)[0]
        : undefined;

      if (channel) {
        result.acknowledgedChannel = channel;
      }

      if (acknowledgedFrom?.createdAt) {
        result.acknowledgedAfterSeconds = Math.max(
          0,
          Math.round(
            (OneUptimeDate.fromString(run.acknowledgedAt).getTime() -
              OneUptimeDate.fromString(acknowledgedFrom.createdAt).getTime()) /
              1000,
          ),
        );
      }
    }

    return result;
  }

  /*
   * Who may read a test's result: who sent it, who it paged - their own
   * messages are in it - and who may read the project's execution logs.
   */
  private assertMayReadResult(data: {
    run: OnCallDutyPolicyExecutionLog;
    lines: Array<OnCallDutyPolicyExecutionLogTimeline>;
    props: DatabaseCommonInteractionProps;
  }): void {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    const userId: string | undefined = data.props.userId?.toString();

    if (userId && data.run.createdByUserId?.toString() === userId) {
      return;
    }

    if (
      userId &&
      data.lines.some((line: OnCallDutyPolicyExecutionLogTimeline): boolean => {
        return line.alertSentToUserId?.toString() === userId;
      })
    ) {
      return;
    }

    if (
      CallerPermission.holdsAnyOf(data.props, [
        ...ON_CALL_TEST_PAGE_RESULT_READ_PERMISSIONS,
      ])
    ) {
      return;
    }

    throw new NotAuthorizedException(ON_CALL_TEST_PAGE_NOT_AUTHORIZED_MESSAGE);
  }

  // Who a test was for: a policy's levels, the sender, or a member.
  private getKindOf(data: {
    run: OnCallDutyPolicyExecutionLog;
    lines: Array<OnCallDutyPolicyExecutionLogTimeline>;
  }): OnCallTestPageKind {
    if (data.run.onCallDutyPolicyId) {
      return OnCallTestPageKind.Policy;
    }

    const senderId: string | undefined = data.run.createdByUserId?.toString();

    const pagedSomebodyElse: boolean = data.lines.some(
      (line: OnCallDutyPolicyExecutionLogTimeline): boolean => {
        return (
          Boolean(line.alertSentToUserId) &&
          line.alertSentToUserId!.toString() !== senderId
        );
      },
    );

    return pagedSomebodyElse
      ? OnCallTestPageKind.Member
      : OnCallTestPageKind.Self;
  }

  private async readSeverityNameOf(
    run: OnCallDutyPolicyExecutionLog,
  ): Promise<string> {
    if (!run.testPageSeverityId) {
      return "";
    }

    try {
      const severity: IncidentSeverity | AlertSeverity | null =
        run.testPageRecordKind === OnCallTestPageRecordKind.Alert
          ? await AlertSeverityService.findOneById({
              id: run.testPageSeverityId,
              select: { name: true },
              props: { isRoot: true },
            })
          : await IncidentSeverityService.findOneById({
              id: run.testPageSeverityId,
              select: { name: true },
              props: { isRoot: true },
            });

      return severity?.name?.toString() || "";
    } catch (err) {
      logger.error(err as Error);
      return "";
    }
  }

  // The SMS of a test whose provider said they reached the phone.
  private async readDeliveredSms(
    deliveries: Array<UserOnCallLogTimeline>,
  ): Promise<Set<string>> {
    const smsIds: Array<ObjectID> = deliveries
      .filter((delivery: UserOnCallLogTimeline): boolean => {
        return Boolean(delivery.userSmsId && delivery.id);
      })
      .map((delivery: UserOnCallLogTimeline): ObjectID => {
        return delivery.id!;
      });

    if (smsIds.length === 0) {
      return new Set<string>();
    }

    try {
      const logs: Array<SmsLog> = await SmsLogService.findBy({
        query: {
          userOnCallLogTimelineId: QueryHelper.any(smsIds),
          status: SmsStatus.Delivered,
        },
        select: {
          userOnCallLogTimelineId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

      return new Set<string>(
        logs
          .map((log: SmsLog): string => {
            return log.userOnCallLogTimelineId?.toString() || "";
          })
          .filter(Boolean),
      );
    } catch (err) {
      logger.error(err as Error);
      return new Set<string>();
    }
  }

  // The message the test was first acknowledged from, by who acknowledged it.
  private getFirstAcknowledgedDelivery(data: {
    deliveries: Array<UserOnCallLogTimeline>;
    acknowledgedByUserId: ObjectID | undefined;
  }): UserOnCallLogTimeline | undefined {
    const acknowledged: Array<UserOnCallLogTimeline> = data.deliveries
      .filter((delivery: UserOnCallLogTimeline): boolean => {
        return (
          Boolean(delivery.isAcknowledged) &&
          (!data.acknowledgedByUserId ||
            delivery.userId?.toString() ===
              data.acknowledgedByUserId.toString())
        );
      })
      .sort((a: UserOnCallLogTimeline, b: UserOnCallLogTimeline): number => {
        return (
          new Date(a.acknowledgedAt || 0).getTime() -
          new Date(b.acknowledgedAt || 0).getTime()
        );
      });

    return acknowledged[0];
  }

  // One line of the chain, with its messages.
  private toStep(data: {
    line: OnCallDutyPolicyExecutionLogTimeline;
    deliveries: Array<UserOnCallLogTimeline>;
    deliveredSmsIds: Set<string>;
  }): OnCallTestPageStep {
    const line: OnCallDutyPolicyExecutionLogTimeline = data.line;

    const step: OnCallTestPageStep = {
      id: line.id?.toString() || "",
      status: getStepStatus(line.status),
      statusMessage: line.statusMessage || "",
      deliveries: data.deliveries.map(
        (delivery: UserOnCallLogTimeline): OnCallTestPageDelivery => {
          return toDelivery({
            delivery: delivery,
            isDelivered: data.deliveredSmsIds.has(
              delivery.id?.toString() || "",
            ),
          });
        },
      ),
    };

    if (line.onCallDutyPolicyEscalationRule?.order) {
      step.levelOrder = line.onCallDutyPolicyEscalationRule.order;
      step.levelName =
        line.onCallDutyPolicyEscalationRule.name?.toString() || undefined;
    }

    if (line.alertSentToUserId) {
      step.userId = line.alertSentToUserId.toString();
      step.userName =
        line.alertSentToUser?.name?.toString() ||
        line.alertSentToUser?.email?.toString() ||
        "";
    }

    if (line.userBelongsToTeam?.name) {
      step.teamName = line.userBelongsToTeam.name.toString();
    }

    if (line.onCallDutySchedule?.name) {
      step.scheduleName = line.onCallDutySchedule.name.toString();
    }

    if (line.overridedByUser) {
      step.coveringForName =
        line.overridedByUser.name?.toString() ||
        line.overridedByUser.email?.toString() ||
        undefined;
    }

    // What the line says, as a code with the name it is about (#7260).
    const stepLine: OnCallTestPageLine | null = readOnCallTestPageStepLine({
      statusMessage: step.statusMessage,
      userName: step.userName,
      teamName: step.teamName,
      scheduleName: step.scheduleName,
    });

    if (stepLine) {
      step.statusMessageCode = stepLine;
    }

    return step;
  }
}

/*
 * Where a test stands, from its run: acknowledged once somebody did,
 * paging while the run is, failed on an error, ended otherwise.
 */
export function getResultStatus(run: {
  status?: OnCallDutyPolicyStatus | undefined;
  acknowledgedAt?: Date | undefined;
}): OnCallTestPageStatus {
  if (run.acknowledgedAt) {
    return OnCallTestPageStatus.Acknowledged;
  }

  switch (run.status) {
    case OnCallDutyPolicyStatus.Scheduled:
    case OnCallDutyPolicyStatus.Started:
    case OnCallDutyPolicyStatus.Executing:
    case OnCallDutyPolicyStatus.Waiting:
      return OnCallTestPageStatus.Paging;
    case OnCallDutyPolicyStatus.Error:
      return OnCallTestPageStatus.Failed;
    default:
      return OnCallTestPageStatus.Ended;
  }
}

// What became of one line of the chain, from the run's line status.
export function getStepStatus(
  status: OnCallDutyExecutionLogTimelineStatus | undefined,
): OnCallTestPageStepStatus {
  switch (status) {
    case OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged:
      return OnCallTestPageStepStatus.Acknowledged;
    case OnCallDutyExecutionLogTimelineStatus.Skipped:
      return OnCallTestPageStepStatus.Skipped;
    case OnCallDutyExecutionLogTimelineStatus.Error:
      return OnCallTestPageStepStatus.Failed;
    default:
      return OnCallTestPageStepStatus.Paged;
  }
}

// One message of the test, as its result shows it.
export function toDelivery(data: {
  delivery: UserOnCallLogTimeline;
  isDelivered: boolean;
}): OnCallTestPageDelivery {
  const delivery: UserOnCallLogTimeline = data.delivery;
  const channel: OnCallPageChannel | null =
    getOnCallPageChannelsOf(delivery)[0] || null;

  const status: ReturnType<typeof getOnCallTestPageDeliveryStatus> =
    getOnCallTestPageDeliveryStatus({
      status: delivery.status,
      isAcknowledged: delivery.isAcknowledged,
      isDelivered: data.isDelivered,
    });

  const result: OnCallTestPageDelivery = {
    id: delivery.id?.toString() || "",
    channel: channel,
    status: status,
    statusMessage: delivery.statusMessage || "",
    canAcknowledge: channel ? canAcknowledgeOnCallTestPageBy(channel) : false,
    sentAt: delivery.createdAt
      ? OneUptimeDate.fromString(delivery.createdAt).toISOString()
      : "",
  };

  const address: string | undefined = getDeliveryAddress(delivery);

  if (address) {
    result.address = address;
  }

  // What its log says, as a code the Dashboard words (#7260).
  const line: OnCallTestPageLine | null = readOnCallTestPageDeliveryLine({
    statusMessage: delivery.statusMessage,
    channel: channel,
  });

  if (line) {
    result.statusMessageCode = line;
  }

  if (
    delivery.status === UserNotificationStatus.Error ||
    delivery.status === UserNotificationStatus.Skipped
  ) {
    const fix: ReturnType<typeof getOnCallTestPageFix> = getOnCallTestPageFix(
      delivery.statusMessage,
    );

    if (fix) {
      result.fix = fix;
    }
  }

  if (delivery.acknowledgedAt) {
    result.acknowledgedAt = OneUptimeDate.fromString(
      delivery.acknowledgedAt,
    ).toISOString();
  }

  return result;
}

// Where a message went: its method's address, number or name.
export function getDeliveryAddress(
  delivery: UserOnCallLogTimeline,
): string | undefined {
  return (
    delivery.userEmail?.email?.toString() ||
    delivery.userSms?.phone?.toString() ||
    delivery.userCall?.phone?.toString() ||
    delivery.userWhatsApp?.phone?.toString() ||
    delivery.userPush?.deviceName?.toString() ||
    delivery.userTelegram?.telegramUserHandle?.toString() ||
    delivery.userSlack?.slackUserName?.toString() ||
    delivery.userMicrosoftTeams?.microsoftTeamsUserName?.toString() ||
    delivery.userMattermost?.mattermostUserName?.toString() ||
    delivery.userWebhook?.name?.toString() ||
    delivery.customNotificationChannel?.name?.toString() ||
    undefined
  );
}

// The methods one rule pages by, as a preview lists them.
export function getPreviewMethodsOfRule(data: {
  rule: UserNotificationRule;
  showAddresses: boolean;
}): Array<OnCallTestPagePreviewMethod> {
  const rule: UserNotificationRule = data.rule;
  const notifyAfterMinutes: number = rule.notifyAfterMinutes || 0;

  const candidates: Array<{
    channel: OnCallPageChannel;
    isPresent: boolean;
    address?: string | undefined;
    isVerified: boolean;
  }> = [
    {
      channel: OnCallPageChannel.Email,
      isPresent: Boolean(rule.userEmail),
      address: rule.userEmail?.email?.toString(),
      isVerified: Boolean(rule.userEmail?.isVerified),
    },
    {
      channel: OnCallPageChannel.SMS,
      isPresent: Boolean(rule.userSms),
      address: rule.userSms?.phone?.toString(),
      isVerified: Boolean(rule.userSms?.isVerified),
    },
    {
      channel: OnCallPageChannel.WhatsApp,
      isPresent: Boolean(rule.userWhatsApp),
      address: rule.userWhatsApp?.phone?.toString(),
      isVerified: Boolean(rule.userWhatsApp?.isVerified),
    },
    {
      channel: OnCallPageChannel.Telegram,
      isPresent: Boolean(rule.userTelegram),
      address: rule.userTelegram?.telegramUserHandle?.toString(),
      isVerified: Boolean(rule.userTelegram?.isVerified),
    },
    {
      channel: OnCallPageChannel.Slack,
      isPresent: Boolean(rule.userSlack),
      address: rule.userSlack?.slackUserName?.toString(),
      isVerified: Boolean(rule.userSlack?.isVerified),
    },
    {
      channel: OnCallPageChannel.MicrosoftTeams,
      isPresent: Boolean(rule.userMicrosoftTeams),
      address: rule.userMicrosoftTeams?.microsoftTeamsUserName?.toString(),
      isVerified: Boolean(rule.userMicrosoftTeams?.isVerified),
    },
    {
      channel: OnCallPageChannel.Mattermost,
      isPresent: Boolean(rule.userMattermost),
      address: rule.userMattermost?.mattermostUserName?.toString(),
      isVerified: Boolean(rule.userMattermost?.isVerified),
    },
    {
      channel: OnCallPageChannel.Webhook,
      isPresent: Boolean(rule.userWebhook),
      address: rule.userWebhook?.name?.toString(),
      // A webhook needs no verification.
      isVerified: true,
    },
    {
      channel: OnCallPageChannel.Call,
      isPresent: Boolean(rule.userCall),
      address: rule.userCall?.phone?.toString(),
      isVerified: Boolean(rule.userCall?.isVerified),
    },
    {
      channel: OnCallPageChannel.CustomChannel,
      isPresent: Boolean(rule.customNotificationChannel),
      address: rule.customNotificationChannel?.name?.toString(),
      isVerified: Boolean(rule.customNotificationChannel?.isEnabled),
    },
    {
      channel: OnCallPageChannel.Push,
      isPresent: Boolean(rule.userPush),
      address: rule.userPush?.deviceName?.toString(),
      isVerified: Boolean(rule.userPush?.isVerified),
    },
  ];

  return candidates
    .filter((candidate: { isPresent: boolean }): boolean => {
      return candidate.isPresent;
    })
    .map(
      (candidate: {
        channel: OnCallPageChannel;
        address?: string | undefined;
        isVerified: boolean;
      }): OnCallTestPagePreviewMethod => {
        const method: OnCallTestPagePreviewMethod = {
          channel: candidate.channel,
          notifyAfterMinutes: notifyAfterMinutes,
          isVerified: candidate.isVerified,
          canAcknowledge: canAcknowledgeOnCallTestPageBy(candidate.channel),
        };

        if (data.showAddresses && candidate.address) {
          method.address = candidate.address;
        }

        return method;
      },
    );
}

// The project's preview of a person: the switches its warnings read.
type PreviewProject = Pick<
  Project,
  | "enableSmsNotifications"
  | "enableCallNotifications"
  | "enableWhatsAppNotifications"
  | "enableTelegramNotifications"
  | "disableOnCallNotificationFallback"
> | null;

// What a preview warns about before anything is sent, in English.
export function getPreviewWarnings(data: {
  methods: Array<OnCallTestPagePreviewMethod>;
  project: PreviewProject;
  hasNoRule: boolean;
  isOptedOut: boolean;
  readsFallbackMethods?: boolean | undefined;
}): Array<string> {
  return getPreviewWarningCodes(data).map(
    (warning: OnCallTestPageWarning): string => {
      return warning.message;
    },
  );
}

/*
 * What a preview warns about before anything is sent, as codes with their
 * English sentences (#7015): the Dashboard words each code itself. A person
 * with no rule, read with what the fallback picks (readsFallbackMethods,
 * #7262), is said to fall back to the methods listed - or, when it picks
 * none, to be sent nothing.
 */
export function getPreviewWarningCodes(data: {
  methods: Array<OnCallTestPagePreviewMethod>;
  project: PreviewProject;
  hasNoRule: boolean;
  isOptedOut: boolean;
  // Whether `methods` are what the fallback picks for a person with no rule.
  readsFallbackMethods?: boolean | undefined;
}): Array<OnCallTestPageWarning> {
  const warnings: Array<OnCallTestPageWarning> = [];

  if (data.isOptedOut) {
    warnings.push({
      code: OnCallTestPageWarningCode.OptedOut,
      message:
        "Opted out of pages of this severity, so the test sends nothing.",
    });
  } else if (data.hasNoRule) {
    warnings.push(getNoRuleWarning(data));
  }

  const offChannels: Array<{
    channel: OnCallPageChannel;
    projectChannel: ProjectNotificationChannel;
    isOn: boolean | undefined;
  }> = [
    {
      channel: OnCallPageChannel.SMS,
      projectChannel: ProjectNotificationChannel.SMS,
      isOn: data.project?.enableSmsNotifications,
    },
    {
      channel: OnCallPageChannel.Call,
      projectChannel: ProjectNotificationChannel.Call,
      isOn: data.project?.enableCallNotifications,
    },
    {
      channel: OnCallPageChannel.WhatsApp,
      projectChannel: ProjectNotificationChannel.WhatsApp,
      isOn: data.project?.enableWhatsAppNotifications,
    },
    {
      channel: OnCallPageChannel.Telegram,
      projectChannel: ProjectNotificationChannel.Telegram,
      isOn: data.project?.enableTelegramNotifications,
    },
  ];

  for (const off of offChannels) {
    if (
      data.project &&
      off.isOn === false &&
      data.methods.some((method: OnCallTestPagePreviewMethod): boolean => {
        return method.channel === off.channel;
      })
    ) {
      warnings.push({
        code: OnCallTestPageWarningCode.ChannelOff,
        channel: off.channel,
        message: getProjectNotificationChannelOffMessage(off.projectChannel),
      });
    }
  }

  for (const method of data.methods) {
    if (!method.isVerified) {
      warnings.push({
        code: OnCallTestPageWarningCode.MethodNotVerified,
        channel: method.channel,
        message: `This ${method.channel === OnCallPageChannel.CustomChannel ? "custom channel is turned off" : `${method.channel} method is not verified`}, so the test can't use it.`,
      });
    }
  }

  return warnings;
}

/*
 * What a preview says of a person with no rule for the severity: that the
 * project does not fall back; or, read with what the fallback picks
 * (#7262), that the test falls back to the method - or methods - listed,
 * or that it has none it may use; or, read without, that it goes to every
 * verified method.
 */
function getNoRuleWarning(data: {
  methods: Array<OnCallTestPagePreviewMethod>;
  project: PreviewProject;
  readsFallbackMethods?: boolean | undefined;
}): OnCallTestPageWarning {
  if (data.project?.disableOnCallNotificationFallback) {
    return {
      code: OnCallTestPageWarningCode.NoRuleNoFallback,
      message:
        "No on-call rule covers this severity, and this project does not fall back to verified methods: the test sends nothing.",
    };
  }

  if (!data.readsFallbackMethods) {
    return {
      code: OnCallTestPageWarningCode.NoRuleFallsBack,
      message:
        "No on-call rule covers this severity: like a real page, the test goes to every verified method instead.",
    };
  }

  const fallbackMethodCount: number = data.methods.filter(
    (method: OnCallTestPagePreviewMethod): boolean => {
      return Boolean(method.isFallback);
    },
  ).length;

  /*
   * Most often the fallback picks one method - the email address every
   * member verifies when they join - so the sentence names "the method
   * above" then, as the Dashboard's own wording of the code does.
   */
  return fallbackMethodCount > 0
    ? {
        code: OnCallTestPageWarningCode.NoRuleFallsBackToListed,
        message:
          fallbackMethodCount === 1
            ? "No on-call rule covers this severity: like a real page, the test falls back to the method above."
            : "No on-call rule covers this severity: like a real page, the test falls back to the methods above.",
      }
    : {
        code: OnCallTestPageWarningCode.NoRuleNothingToFallBackTo,
        message:
          "No on-call rule covers this severity, and no verified method can be used instead: the test sends nothing.",
      };
}

// Why a policy's test pages a person, in English: "Team Platform".
export function getReachedThroughText(
  reachedThrough: OnCallTestPageReachedThrough,
): string {
  switch (reachedThrough.code) {
    case OnCallTestPageReachedThroughCode.Team:
      return `Team ${reachedThrough.name}`;
    case OnCallTestPageReachedThroughCode.Schedule:
      return `Schedule ${reachedThrough.name}`;
    case OnCallTestPageReachedThroughCode.ScheduleNextInRotation:
      return `Schedule ${reachedThrough.name} (next in rotation)`;
    case OnCallTestPageReachedThroughCode.CoveringFor:
      return `Covering for ${reachedThrough.name}`;
  }
}

// Why a target of a policy's level reaches nobody, in English.
export function getNotPagedMessage(notPaged: NotPagedValues): string {
  switch (notPaged.code) {
    case OnCallTestPageNotPagedCode.PolicyHasNoLevels:
      return "This policy has no escalation rules yet, so a test pages nobody.";
    case OnCallTestPageNotPagedCode.LevelNamesNobody:
      return notPaged.levelOrder && notPaged.levelOrder > 1
        ? `Escalation rule ${notPaged.levelOrder} pages nobody yet. Add people, a team or a schedule to it.`
        : "The first escalation rule pages nobody yet. Add people, a team or a schedule to it.";
    case OnCallTestPageNotPagedCode.TeamHasNoMembers:
      return `Team ${notPaged.teamName || ""} has no members.`;
    case OnCallTestPageNotPagedCode.NobodyNextInRotation:
      return `Nobody is next in the rotation of schedule ${notPaged.scheduleName || ""}.`;
    case OnCallTestPageNotPagedCode.NobodyOnCall:
      return `Nobody is on call in schedule ${notPaged.scheduleName || ""} now.`;
    case OnCallTestPageNotPagedCode.AwayWithNobodyCovering:
      return `${notPaged.userName || "Someone"} is away until ${
        notPaged.awayUntil
          ? OneUptimeDate.getDateAsUserFriendlyFormattedString(
              OneUptimeDate.fromString(notPaged.awayUntil),
            )
          : ""
      }, with nobody covering.`;
    case OnCallTestPageNotPagedCode.NotProjectMember:
      return `${notPaged.userName || "Someone"} is not a member of this project.`;
  }
}

export default new OnCallTestPageService();
