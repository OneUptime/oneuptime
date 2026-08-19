import DatabaseConfig from "../DatabaseConfig";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import Query from "../Types/Database/Query";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import TenantPermission from "../Types/Database/Permissions/TenantPermission";
import Markdown, { MarkdownContentType } from "../Types/Markdown";
import CallService from "./CallService";
import DatabaseService from "./DatabaseService";
import IncidentService from "./IncidentService";
import IncidentSeverityService from "./IncidentSeverityService";
import MailService from "./MailService";
import ProjectCallSMSConfigService from "./ProjectCallSMSConfigService";
import ShortLinkService from "./ShortLinkService";
import SmsService from "./SmsService";
import TelegramService from "./TelegramService";
import WebhookService from "./WebhookService";
import WhatsAppService from "./WhatsAppService";
import UserEmailService from "./UserEmailService";
import UserCallService from "./UserCallService";
import UserPushService from "./UserPushService";
import UserSmsService from "./UserSmsService";
import UserTelegramService from "./UserTelegramService";
import UserWebhookService from "./UserWebhookService";
import UserWhatsAppService from "./UserWhatsAppService";
import ProjectService from "./ProjectService";
import UserNotificationRuleAdminService, {
  RuleColumnCarrier,
  NotificationMethodReference,
} from "./UserNotificationRuleAdminService";
import OnCallReadinessService, {
  ReadinessMethod,
  ReadinessMethodType,
  ReadinessStatus,
  ResponderSource,
  UserReadiness,
} from "./OnCallReadinessService";
import UserOnCallLogService from "./UserOnCallLogService";
import UserOnCallLogTimelineService from "./UserOnCallLogTimelineService";
import { AppApiRoute } from "../../ServiceRoute";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import AuditLogAction from "../../Types/AuditLog/AuditLogAction";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CallRequest from "../../Types/Call/CallRequest";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import QueryHelper from "../Types/Database/QueryHelper";
import Sort from "../Types/Database/Sort";
import Dictionary from "../../Types/Dictionary";
import Email from "../../Types/Email";
import EmailMessage from "../../Types/Email/EmailMessage";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import NotificationRuleType from "../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../Types/ObjectID";
import PushDeviceType from "../../Types/PushNotification/PushDeviceType";
import Phone from "../../Types/Phone";
import SMS from "../../Types/SMS/SMS";
import TelegramMessage from "../../Types/Telegram/TelegramMessage";
import TwilioConfig from "../../Types/CallAndSMS/TwilioConfig";
import WhatsAppMessage from "../../Types/WhatsApp/WhatsAppMessage";
import {
  renderWhatsAppTemplate,
  WhatsAppTemplateIds,
  WhatsAppTemplateLanguage,
  WhatsAppTemplateId,
} from "../../Types/WhatsApp/WhatsAppTemplates";
import UserNotificationEventType from "../../Types/UserNotification/UserNotificationEventType";
import UserNotificationExecutionStatus from "../../Types/UserNotification/UserNotificationExecutionStatus";
import UserNotificationStatus from "../../Types/UserNotification/UserNotificationStatus";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../Models/DatabaseModels/Monitor";
import Project from "../../Models/DatabaseModels/Project";
import ShortLink from "../../Models/DatabaseModels/ShortLink";
import UserCall from "../../Models/DatabaseModels/UserCall";
import UserEmail from "../../Models/DatabaseModels/UserEmail";
import UserPush from "../../Models/DatabaseModels/UserPush";
import UserSMS from "../../Models/DatabaseModels/UserSMS";
import UserTelegram from "../../Models/DatabaseModels/UserTelegram";
import UserWebhook from "../../Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "../../Models/DatabaseModels/UserWhatsApp";
import Model from "../../Models/DatabaseModels/UserNotificationRule";
import UserOnCallLog from "../../Models/DatabaseModels/UserOnCallLog";
import UserOnCallLogTimeline from "../../Models/DatabaseModels/UserOnCallLogTimeline";
import Alert from "../../Models/DatabaseModels/Alert";
import AlertService from "./AlertService";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import AlertSeverityService from "./AlertSeverityService";
import AlertEpisode from "../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeService from "./AlertEpisodeService";
import AlertEpisodeMember from "../../Models/DatabaseModels/AlertEpisodeMember";
import AlertEpisodeMemberService from "./AlertEpisodeMemberService";
import IncidentEpisode from "../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeService from "./IncidentEpisodeService";
import IncidentEpisodeMember from "../../Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodeMemberService from "./IncidentEpisodeMemberService";
import WorkspaceNotificationRule from "../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceNotificationRuleService from "./WorkspaceNotificationRuleService";
import PushNotificationService from "./PushNotificationService";
import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleWorkspaceChannel from "../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import PushNotificationUtil from "../Utils/PushNotificationUtil";
import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";
import logger, { LogAttributes } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export interface NotificationMethodDescriptor {
  userEmailId?: ObjectID;
  userSmsId?: ObjectID;
  userCallId?: ObjectID;
  userWhatsAppId?: ObjectID;
  userTelegramId?: ObjectID;
  userPushId?: ObjectID;
  userWebhookId?: ObjectID;
}

/*
 * Everything a single delivery attempt needs to know about the page it is
 * carrying: which project, which entity fired it, which escalation produced it,
 * and which UserOnCallLog row it must reconcile against. This used to be an
 * inline object literal on executeNotificationRuleItem; it is named here because
 * the fallback path (executeFallbackNotification) hands the very same bundle to
 * the very same delivery code, and because callers outside this file now need to
 * be able to type a variable against it.
 */
export interface ExecuteNotificationRuleOptions {
  projectId: ObjectID;
  triggeredByIncidentId?: ObjectID | undefined;
  triggeredByAlertId?: ObjectID | undefined;
  triggeredByAlertEpisodeId?: ObjectID | undefined;
  triggeredByIncidentEpisodeId?: ObjectID | undefined;
  userNotificationEventType: UserNotificationEventType;
  onCallPolicyExecutionLogId?: ObjectID | undefined;
  onCallPolicyId: ObjectID | undefined;
  onCallPolicyEscalationRuleId?: ObjectID | undefined;
  userNotificationLogId: ObjectID;
  userBelongsToTeamId?: ObjectID | undefined;
  onCallDutyPolicyExecutionLogTimelineId?: ObjectID | undefined;
  onCallScheduleId?: ObjectID | undefined;
}

export interface ExecuteFallbackNotificationOptions
  extends ExecuteNotificationRuleOptions {
  userId: ObjectID;
  userOnCallLogId: ObjectID;
  ruleType: NotificationRuleType;
  // Only used to explain, in prose, which severity had no rule configured.
  severityName: string;
}

/*
 * Why the fallback returns an outcome and not just a boolean.
 *
 * Its caller (UserOnCallLogService.onCreateSuccess) has to pick a
 * UserNotificationExecutionStatus out of the answer, and
 * UserNotificationExecutionStatus.Error is TERMINAL — ExecutePendingExecutions
 * selects Executing and TimeoutStuckExecutions selects Started, so nothing
 * anywhere re-selects an Error log. That makes the two ways of not notifying
 * somebody opposites rather than synonyms: "this responder has nothing we can
 * page them on" is a real, permanent misconfiguration worth burning the log
 * for, while "the send raised" is a bad minute that a terminal status would
 * turn into a permanently dropped page. Both are `notified: false`, so the
 * difference has to survive the return or the caller cannot act on it.
 */
export enum FallbackNotificationOutcome {
  /*
   * A page was handed to at least one sender. Nothing below observes what the
   * sender then did with it — every send in deliverNotificationForRule is
   * fire-and-forget — so this means dispatched, not received.
   */
  Delivered = "Delivered",

  /*
   * There was nothing to try. The responder has no verified method the
   * fallback may use and no webhook, or the only paid channels they have are
   * switched off at the project level. Permanent: a retry finds the same
   * nothing, and only a human adding a notification method changes it.
   */
  NoUsableNotificationMethod = "NoUsableNotificationMethod",

  /*
   * There was something to try and none of it went out: a send raised, or a
   * chosen channel had no template for this event type, or another run already
   * holds the fallback claim on this log and owns the outcome. All three are
   * transient from the caller's point of view — none of them is evidence that
   * the responder is unreachable, so none of them justifies a terminal status.
   */
  DeliveryFailed = "DeliveryFailed",
}

export interface FallbackNotificationResult {
  outcome: FallbackNotificationOutcome;
  /*
   * Mirror of `outcome === FallbackNotificationOutcome.Delivered`, kept because
   * most read sites only want the yes/no and re-deriving the comparison at each
   * one is how a caller ends up asserting the wrong half of the enum.
   */
  notified: boolean;
  channelsUsed: Array<string>;
}

/*
 * The fallback is not tied to any UserNotificationRule row — there is no rule,
 * which is the whole reason it runs — so it claims the on-call log under this
 * reserved literal instead of a rule id. `executedNotificationRules` is a jsonb
 * map keyed by arbitrary text, so the literal sits beside real rule uuids and
 * can never collide with one.
 */
export const FALLBACK_NOTIFICATION_CLAIM_KEY: string = "__fallback__";

/*
 * ---------------------------------------------------------------------------
 * DELETION IMPACT — "what would I lose by deleting this?", asked BEFORE the
 * delete.
 *
 * Two writes a responder makes about their own configuration can take away the
 * only thing standing between a page and nobody hearing it, and neither one
 * looks like that from the screen it is made on:
 *
 *   - Deleting a RULE can remove the LAST rule covering one
 *     (ruleType x severity) cell. The rule table is a list of rows, not a
 *     coverage grid, so "this is the only thing left for Sev1 incidents" is
 *     visible nowhere at the moment somebody clicks delete.
 *
 *   - Deleting a METHOD CASCADES. Every method foreign key on
 *     UserNotificationRule is onDelete: "CASCADE" — and each method service
 *     deletes the rows in its own onBeforeDelete as well, so the cascade
 *     happens whether or not the database does it — which means removing one
 *     phone number destroys every rule that pointed at it. The delete dialog
 *     for a phone number mentions notification rules nowhere at all. This is
 *     the more dangerous of the two by a distance, because the loss is not even
 *     the thing being deleted.
 *
 * Everything here is ADVISORY and is deliberately shaped as a QUESTION the
 * caller asks first, not as a hook that throws. The deletion still goes through
 * the ordinary CRUD path afterwards and nothing below can stop it, for two
 * reasons. The first is that this is the user's own configuration and they are
 * entitled to it — turning "I do not want to be woken by Sev4 alerts" into
 * something a human needs permission for is a worse product than the accident
 * it prevents. The second is that a throwing hook would break the LEGITIMATE
 * deletes too: a user leaving a project, an admin retiring a decommissioned
 * number, a team cleaning up after a migration. The goal is not that nobody
 * does this. It is that nobody does it by accident.
 *
 * "Is this person on call anywhere" is answered by OnCallReadinessService and
 * is never re-derived here. A second answer to that question that disagreed
 * with the readiness page would be worse than no answer: an admin who is told
 * "you are not on call" by a delete dialog and "NotReachable on 3 policies" by
 * the readiness table has no way to know which one to believe, and will end up
 * believing the reassuring one.
 * ---------------------------------------------------------------------------
 */

/*
 * The channel vocabulary is ReadinessMethodType, re-exported under the name the
 * deletion API uses. Sharing one enum with readiness (which in turn shares its
 * literals with the fallback's `channelsUsed`) means an operator reading
 * "Telegram" in a delete warning, "Telegram" in the readiness table and
 * "notified via fallback (Telegram)" in an execution log is reading the same
 * word about the same thing. It is also what lets a notification-method service
 * name its own channel without importing the readiness module.
 */
export { ReadinessMethodType as NotificationMethodChannel };

/**
 * One (ruleType x severity) cell that has at least one rule now and would have
 * none after the deletion.
 *
 * A cell that merely loses SOME of its rules is not here. That is deliberate
 * and it matches the coverage model readiness renders: a cell with two rules on
 * two different methods is covered, a cell with one rule is covered, and only a
 * cell with zero is a gap. Reporting "you will be paged on one fewer channel"
 * with the same weight as "you will not be paged at all" is how a warning
 * surface trains people to click through it.
 */
export interface CoverageLossCell {
  ruleType: NotificationRuleType;
  /**
   * Undefined only for the two handoff rule types, which carry no severity.
   * Those are reported separately (handoffNotificationsLost), so in practice
   * every cell in `coverageLost` has one.
   */
  severityId?: ObjectID | undefined;
  severityName?: string | undefined;
  /** How many rules this deletion takes out of this cell. Always >= 1. */
  rulesRemoved: number;
}

/**
 * Whether anything will still be able to page this user once the deletion has
 * happened.
 *
 * Four values rather than a boolean because two of the four are things this
 * preview knows FOR CERTAIN and two are not, and collapsing them would mean
 * either inventing a false green or crying wolf at everybody.
 *
 * The certainty comes from one structural fact: a method must be verified to be
 * used at all, and of the seven channels, Push, Email and Webhook have no
 * project switch that can turn them off (see OnCallReadinessService.
 * isChannelEnabled — the first two are zero-cost and the third is somebody
 * else's endpoint). So "no verified method survives" is definitely unreachable,
 * and "a verified Push/Email/Webhook survives" is definitely reachable. What is
 * left over — a user whose surviving methods are all on the four paid channels
 * — depends on project settings this preview does not read, and says so.
 */
export enum PostDeletionReachability {
  /** A verified method on a channel no project setting can disable survives. */
  Reachable = "Reachable",

  /**
   * Verified methods survive, but every one of them is on a paid channel
   * (SMS, Call, WhatsApp, Telegram) that the project can switch off. Whether
   * this user can still be paged is a project setting, and the readiness page
   * is the surface that knows.
   */
  DependsOnProjectSettings = "DependsOnProjectSettings",

  /**
   * Nothing verified survives. This deletion is the one that takes away the
   * last way of reaching this person — no rule, and no fallback either, since
   * the fallback needs a verified method too.
   */
  NotReachable = "NotReachable",

  /**
   * They could not be paged before this deletion either. Worth its own value
   * rather than being folded into NotReachable: the sentence an admin needs is
   * "this was already broken", not "you are about to break it".
   */
  AlreadyNotReachable = "AlreadyNotReachable",

  /**
   * Readiness had no answer — the user is not a member of this project, or has
   * no User row. Never guessed at, because a guess here is exactly the false
   * green this whole feature exists to prevent.
   */
  Unknown = "Unknown",
}

export interface NotificationDeletionImpact {
  projectId: ObjectID;
  userId: ObjectID;

  /**
   * Whether this user is reachable by ANY on-call policy in the project, and by
   * which doors. Straight from OnCallReadinessService, never re-derived.
   */
  isOnCallResponder: boolean;
  reachedVia: Array<ResponderSource>;

  /** How many UserNotificationRule rows this deletion would remove in total. */
  rulesDeletedCount: number;

  coverageLost: Array<CoverageLossCell>;

  /**
   * The shift-change notifications ("you are now on call") that would stop.
   * Kept apart from coverageLost because nobody is waiting on one of these and
   * mixing them in would put a missed Sev1 page and a missed courtesy note in
   * the same list at the same weight.
   */
  handoffNotificationsLost: Array<NotificationRuleType>;

  reachability: PostDeletionReachability;

  /** Verified methods that would remain. Zero is what makes NotReachable true. */
  verifiedMethodCountAfterDeletion: number;

  /**
   * Whether a page with no matching rule still falls back to this user's
   * verified methods. It decides whether losing a cell means "the page arrives
   * on the wrong channel" or "the page is dropped", which is the difference
   * between an annoyance and an outage.
   */
  isFallbackEnabled: boolean;

  /**
   * TRUE means this answer is INCOMPLETE — the read of this user's rules hit
   * its page ceiling. Reported rather than swallowed because the two directions
   * it can be wrong in are not symmetric: unread rules that would have SURVIVED
   * make this over-warn (harmless), unread rules that would have been DELETED
   * make it under-warn, which is the failure mode that matters.
   */
  isTruncated: boolean;

  /**
   * Sentences to show the human, most consequential first. Each one names a
   * specific thing that is lost and what happens because of it — the same
   * contract as OnCallReadinessService's `reasons`, because these two surfaces
   * are read by the same person about the same configuration and must not
   * sound like two different products.
   */
  warnings: Array<string>;
}

/** The notification method row a deletion preview is about, once resolved. */
interface DeletedNotificationMethod {
  methodType: ReadinessMethodType;
  userId: ObjectID;
  /**
   * Whether the row being deleted was itself usable. An unverified method is
   * never used by anything, so deleting one cannot change reachability — and
   * counting it as a loss would put a scary sentence in front of somebody
   * cleaning up a typo'd phone number they never confirmed.
   */
  isVerified: boolean;
}

/** One (ruleType x severity) cell while the before/after picture is built. */
interface DeletionCellState {
  ruleType: NotificationRuleType;
  severityKind: SeverityKind;
  severityId: string;
  rulesBefore: number;
  rulesRemoved: number;
  /**
   * Whether an opt-out row for this cell SURVIVES the deletion. A surviving
   * opt-out means the silence is deliberate and losing the last rule is not a
   * gap; an opt-out that is itself being deleted must not suppress the warning,
   * because after the write there is neither a rule nor a stated intention.
   */
  hasOptOut: boolean;
}

/** The same before/after picture for a rule type that carries no severity. */
interface DeletionHandoffState {
  rulesBefore: number;
  rulesRemoved: number;
  hasOptOut: boolean;
}

/** A severity's display name and its position in the project's own ordering. */
interface DeletionSeverityRef {
  name: string;
  rank: number;
}

enum SeverityKind {
  Incident = "Incident",
  Alert = "Alert",
}

interface PagingRuleTypeScope {
  ruleType: NotificationRuleType;
  severityKind: SeverityKind;
  severityColumn: "incidentSeverityId" | "alertSeverityId";
  /** Plural noun for the warning sentence: "no rule covers Sev1 incidents". */
  subjectNoun: string;
}

/*
 * Which severity column scopes which rule type. This is the same table
 * OnCallReadinessService keeps as RULE_TYPE_SCOPES and it has to stay in
 * agreement with it: an alert rule matched against an incident severity id
 * matches nothing at runtime, so a preview that paired them would report a cell
 * as covered by a rule that can never fire — the exact shape of Gap G, where
 * episode rules were written with a NULL severity and were unreachable and
 * invisible at the same time. The severity is always taken from the column the
 * RULE TYPE dictates, never from whichever one happens to be populated.
 */
const PAGING_RULE_TYPE_SCOPES: Array<PagingRuleTypeScope> = [
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    severityKind: SeverityKind.Incident,
    severityColumn: "incidentSeverityId",
    subjectNoun: "incidents",
  },
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    severityKind: SeverityKind.Incident,
    severityColumn: "incidentSeverityId",
    subjectNoun: "incident episodes",
  },
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    severityKind: SeverityKind.Alert,
    severityColumn: "alertSeverityId",
    subjectNoun: "alerts",
  },
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    severityKind: SeverityKind.Alert,
    severityColumn: "alertSeverityId",
    subjectNoun: "alert episodes",
  },
];

/*
 * The two rule types that are about the user's shift rather than about anything
 * that fired. They carry no severity, so they are one cell each.
 */
const HANDOFF_RULE_TYPES: Array<NotificationRuleType> = [
  NotificationRuleType.WHEN_USER_GOES_ON_CALL,
  NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
];

type ChannelListFunction = () => Array<string>;

/**
 * The three channels no project setting can switch off. Push and Email are
 * zero-cost and Webhook is somebody else's endpoint, so nothing gates them —
 * which is what makes "a verified one of these survives" a CERTAIN answer to
 * "can this person still be paged" rather than a hopeful one. Kept in step with
 * OnCallReadinessService.isChannelEnabled, which returns true for exactly these
 * three unconditionally.
 *
 * A FUNCTION rather than a module-level constant, and that is load-bearing
 * rather than stylistic: this module and OnCallReadinessService import each
 * other, so whichever one is loaded second sees the other's exports still
 * empty. Reading ReadinessMethodType while this module is being evaluated
 * therefore throws on ONE of the two load orders and not the other — a crash
 * that depends on which file some unrelated caller happened to import first,
 * which is about the worst possible failure to debug. Read on call, both orders
 * are long since settled. The same rule applies to every enum below that comes
 * from OnCallReadinessService.
 */
const channelsWithNoProjectSwitch: ChannelListFunction = (): Array<string> => {
  return [
    ReadinessMethodType.Push,
    ReadinessMethodType.Email,
    ReadinessMethodType.Webhook,
  ];
};

type ResponderSourceProseFunction = (source: ResponderSource) => string;

/**
 * How each responder source reads in a sentence. The enum values are single
 * words chosen for a chip; a warning has room to say what they mean, and
 * "Override" on its own tells a user nothing about why they are on call.
 *
 * The map is built inside the call for the module-evaluation reason above —
 * a computed key is read at definition time, so a module-level Record would
 * carry exactly the same load-order crash. Typed as a full Record so that a new
 * ResponderSource fails to compile here rather than rendering as a blank.
 */
const responderSourceProse: ResponderSourceProseFunction = (
  source: ResponderSource,
): string => {
  const prose: Record<ResponderSource, string> = {
    [ResponderSource.Direct]: "directly on an escalation rule",
    [ResponderSource.Team]: "through a team",
    [ResponderSource.Schedule]: "through a schedule",
    [ResponderSource.Override]: "through an override",
  };

  return prose[source];
};

/*
 * Rows per page for the rule read, and a ceiling on how many pages one preview
 * may take. LIMIT_PER_PROJECT is the largest read the database layer will
 * serve, so it is the biggest page that survives a round trip. One user's rules
 * are bounded by (rule types x severities x methods) and land far below one
 * page in any real project; the loop exists so that the one project where that
 * is not true gets a truthful answer instead of a silently truncated one.
 */
const DELETION_IMPACT_PAGE_SIZE: number = LIMIT_PER_PROJECT;
const MAX_DELETION_IMPACT_PAGES: number = 50;

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async executeNotificationRuleItem(
    userNotificationRuleId: ObjectID,
    options: ExecuteNotificationRuleOptions,
  ): Promise<void> {
    /*
     * Atomically claim this rule for this on-call log BEFORE sending, so two
     * overlapping cron runs cannot both mark the rule un-executed and both
     * notify — double-paging the responder for one escalation (audit F7). The
     * previous read-check-then-blind-save was a non-atomic TOCTOU. If the claim
     * was already taken (or the log is gone), skip.
     */
    const claimedRuleExecution: boolean =
      await UserOnCallLogService.claimNotificationRuleExecution({
        userOnCallLogId: options.userNotificationLogId,
        userNotificationRuleId: userNotificationRuleId,
      });

    if (!claimedRuleExecution) {
      // already executed by this or a concurrent run.
      return;
    }

    // find notification rule item.
    const notificationRuleItem: Model | null = await this.findOneById({
      id: userNotificationRuleId!,
      select: {
        _id: true,
        userId: true,
        /*
         * Every method relation also selects its OWN userId, which none of the
         * channel blocks below read. It is here for the ownership check that
         * runs before delivery: the address a page is sent to comes from these
         * relations, while whose page it is comes from the rule's userId, and
         * nothing in the ORM ever compares the two. See
         * getNotificationMethodsNotOwnedByRuleOwner.
         */
        userCall: {
          phone: true,
          isVerified: true,
          userId: true,
        },
        userSms: {
          phone: true,
          isVerified: true,
          userId: true,
        },
        userWhatsApp: {
          phone: true,
          isVerified: true,
          userId: true,
        },
        userTelegram: {
          telegramChatId: true,
          telegramUserHandle: true,
          isVerified: true,
          userId: true,
        },
        userWebhook: {
          webhookUrl: true,
          name: true,
          secret: true,
          userId: true,
        },
        userEmail: {
          email: true,
          isVerified: true,
          userId: true,
        },
        userPush: {
          deviceToken: true,
          deviceType: true,
          isVerified: true,
          userId: true,
          /*
           * Whether this handset asked to be rung through silent mode. Unselected
           * it reads as undefined, which Boolean()s to false further down - the
           * page still goes out, just quietly, which is the wrong outcome for the
           * one channel a sleeping responder relies on. It is selected here so
           * that cannot happen.
           */
          isCriticalAlertEnabled: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!notificationRuleItem) {
      throw new BadDataException("Notification rule item not found.");
    }

    /*
     * The last line of defence, and the only one that survives every write path
     * — including ones that do not exist yet.
     *
     * The write-side guards in UserNotificationRuleAdminService stop a rule
     * whose ownership column and method relation name different people from
     * being SAVED. This stops one that somehow exists from being ACTED ON: a
     * row written before those guards landed, one written by internal code
     * running as root, or one written through a path a future change forgets to
     * route through them. Without it, a single bad row silently redirects a
     * responder's pages for as long as nobody thinks to compare two columns
     * that no screen shows side by side.
     */
    const mismatchedChannels: Array<string> =
      this.getNotificationMethodsNotOwnedByRuleOwner(notificationRuleItem);

    if (mismatchedChannels.length > 0) {
      await this.recordMismatchedNotificationMethod(
        notificationRuleItem,
        options,
        mismatchedChannels,
      );

      return;
    }

    await this.deliverNotificationForRule(notificationRuleItem, options);
  }

  /*
   * Which of a rule's method relations are owned by somebody other than the
   * rule itself.
   *
   * Only a method whose userId was actually LOADED and actually DISAGREES is
   * reported. An unselected column arrives as `undefined`, and reading absence
   * as disagreement would turn this guard into a page-dropping machine on every
   * caller that does not select userId — precisely the failure this whole epic
   * exists to eliminate. Silence here means "no evidence of a mismatch", which
   * is the only safe default for a check that can suppress a page.
   */
  private getNotificationMethodsNotOwnedByRuleOwner(
    notificationRuleItem: Model,
  ): Array<string> {
    const ruleOwnerUserId: ObjectID | undefined = notificationRuleItem.userId;

    if (!ruleOwnerUserId) {
      /*
       * An unowned rule cannot be paged for anybody in the first place — the
       * caller found it by id, not by owner — so there is no owner to compare
       * against and nothing to report.
       */
      return [];
    }

    const methodOwners: Array<{
      label: string;
      ownerUserId: ObjectID | undefined;
    }> = [
      { label: "Email", ownerUserId: notificationRuleItem.userEmail?.userId },
      { label: "SMS", ownerUserId: notificationRuleItem.userSms?.userId },
      { label: "Call", ownerUserId: notificationRuleItem.userCall?.userId },
      {
        label: "WhatsApp",
        ownerUserId: notificationRuleItem.userWhatsApp?.userId,
      },
      {
        label: "Telegram",
        ownerUserId: notificationRuleItem.userTelegram?.userId,
      },
      { label: "Push", ownerUserId: notificationRuleItem.userPush?.userId },
      {
        label: "Webhook",
        ownerUserId: notificationRuleItem.userWebhook?.userId,
      },
    ];

    const mismatched: Array<string> = [];

    for (const methodOwner of methodOwners) {
      if (
        methodOwner.ownerUserId &&
        methodOwner.ownerUserId.toString() !== ruleOwnerUserId.toString()
      ) {
        mismatched.push(methodOwner.label);
      }
    }

    return mismatched;
  }

  /*
   * Refuse the whole rule, not merely the offending channel.
   *
   * A rule with a foreign method on it is not a rule with one bad field; it is
   * a row somebody wrote to redirect a page, and delivering its other channels
   * would let the row keep working well enough to escape notice. The timeline
   * row is the point: it is the surface a responder and an operator both read,
   * and it names the channel so the mismatch can be found and repaired rather
   * than merely felt as a page that never arrived.
   */
  private async recordMismatchedNotificationMethod(
    notificationRuleItem: Model,
    options: ExecuteNotificationRuleOptions,
    mismatchedChannels: Array<string>,
  ): Promise<void> {
    logger.error(
      `Notification rule ${notificationRuleItem.id?.toString()} was not executed: its ${mismatchedChannels.join(
        ", ",
      )} notification method does not belong to the user the rule belongs to (${notificationRuleItem.userId?.toString()}).`,
    );

    const logTimelineItem: UserOnCallLogTimeline = this.buildLogTimelineItem(
      notificationRuleItem,
      options,
    );

    logTimelineItem.status = UserNotificationStatus.Error;
    logTimelineItem.statusMessage = `Notification not sent because the ${mismatchedChannels.join(
      ", ",
    )} notification method on this rule belongs to a different user. Please review this notification rule.`;

    await UserOnCallLogTimelineService.create({
      data: logTimelineItem,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * Build the timeline row every channel block stamps its status onto.
   *
   * Callers keep ONE instance and mutate it, because after the first create()
   * the instance carries an _id and a second create() with it UPDATEs the row
   * it already wrote instead of inserting a new one. Anything that needs a row
   * genuinely independent of the delivery attempts (the fell-through guard
   * below) must therefore call this again for a fresh instance rather than
   * reuse the one the channel blocks have been writing to.
   */
  private buildLogTimelineItem(
    notificationRuleItem: Model,
    options: ExecuteNotificationRuleOptions,
  ): UserOnCallLogTimeline {
    const logTimelineItem: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    logTimelineItem.projectId = options.projectId;
    logTimelineItem.userNotificationLogId = options.userNotificationLogId;
    logTimelineItem.userId = notificationRuleItem.userId!;
    logTimelineItem.userNotificationEventType =
      options.userNotificationEventType;

    /*
     * The fallback delivers through rules it builds in memory and never saves,
     * so there is not always a rule id to point the row at.
     */
    if (notificationRuleItem.id) {
      logTimelineItem.userNotificationRuleId = notificationRuleItem.id;
    }

    if (options.userBelongsToTeamId) {
      logTimelineItem.userBelongsToTeamId = options.userBelongsToTeamId;
    }

    if (options.onCallPolicyId) {
      logTimelineItem.onCallDutyPolicyId = options.onCallPolicyId;
    }

    if (options.onCallPolicyEscalationRuleId) {
      logTimelineItem.onCallDutyPolicyEscalationRuleId =
        options.onCallPolicyEscalationRuleId;
    }

    if (options.onCallPolicyExecutionLogId) {
      logTimelineItem.onCallDutyPolicyExecutionLogId =
        options.onCallPolicyExecutionLogId;
    }

    if (options.triggeredByIncidentId) {
      logTimelineItem.triggeredByIncidentId = options.triggeredByIncidentId;
    }

    if (options.triggeredByAlertId) {
      logTimelineItem.triggeredByAlertId = options.triggeredByAlertId;
    }

    if (options.triggeredByAlertEpisodeId) {
      logTimelineItem.triggeredByAlertEpisodeId =
        options.triggeredByAlertEpisodeId;
    }

    if (options.triggeredByIncidentEpisodeId) {
      logTimelineItem.triggeredByIncidentEpisodeId =
        options.triggeredByIncidentEpisodeId;
    }

    if (options.onCallDutyPolicyExecutionLogTimelineId) {
      logTimelineItem.onCallDutyPolicyExecutionLogTimelineId =
        options.onCallDutyPolicyExecutionLogTimelineId;
    }

    return logTimelineItem;
  }

  /*
   * The delivery half of executeNotificationRuleItem: given a rule that is
   * already loaded with its method relations, decide what to send on which
   * channel and hand it to the senders.
   *
   * It is split out from the public method so executeFallbackNotification can
   * reuse it with a rule it assembled in memory and never persisted. The claim
   * and the rule lookup that the public method does first are meaningless for a
   * rule that does not exist in the database; everything from here down is
   * exactly what the fallback needs.
   *
   * Returns whether a page was actually handed to a sender, which the fallback
   * needs and the normal path ignores. Resolving without throwing is NOT the
   * same as having sent something: a rule whose channel has no block for this
   * event type falls all the way through to the guard at the bottom, writes an
   * Error row and sends nothing. A caller that read "did not throw" as "paged"
   * would name a channel the responder never heard from.
   */
  private async deliverNotificationForRule(
    notificationRuleItem: Model,
    options: ExecuteNotificationRuleOptions,
  ): Promise<boolean> {
    /*
     * If the project has a default Twilio config set, use it for all
     * team-member SMS and Calls in this rule. Otherwise the global config
     * is used by the notification service.
     */
    const projectTwilioConfig: TwilioConfig | undefined =
      await ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
        options.projectId,
      );

    const logTimelineItem: UserOnCallLogTimeline = this.buildLogTimelineItem(
      notificationRuleItem,
      options,
    );

    /*
     * Which channels this rule could actually deliver on, and whether any block
     * below matched the event type. If a channel is contactable but no branch
     * claimed the event, the page vanishes without a trace — the guard at the
     * end of this method turns that into a visible Error row.
     */
    const contactableChannels: Array<string> =
      this.getContactableChannelNames(notificationRuleItem);
    let deliveryAttempted: boolean = false;

    // add status and status message and save.

    let incident: Incident | null = null;
    let alert: Alert | null = null;
    let alertEpisode: AlertEpisode | null = null;

    if (
      options.userNotificationEventType ===
        UserNotificationEventType.IncidentCreated &&
      options.triggeredByIncidentId
    ) {
      incident = await IncidentService.findOneById({
        id: options.triggeredByIncidentId!,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          title: true,
          description: true,
          projectId: true,
          project: {
            name: true,
          },
          currentIncidentState: {
            name: true,
          },
          incidentSeverity: {
            name: true,
          },
          rootCause: true,
          incidentNumber: true,
          incidentNumberWithPrefix: true,
        },
      });
    }

    if (
      options.userNotificationEventType ===
        UserNotificationEventType.AlertCreated &&
      options.triggeredByAlertId
    ) {
      alert = await AlertService.findOneById({
        id: options.triggeredByAlertId!,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          title: true,
          description: true,
          projectId: true,
          project: {
            name: true,
          },
          currentAlertState: {
            name: true,
          },
          alertSeverity: {
            name: true,
          },
          alertNumber: true,
          alertNumberWithPrefix: true,
        },
      });
    }

    if (
      options.userNotificationEventType ===
        UserNotificationEventType.AlertEpisodeCreated &&
      options.triggeredByAlertEpisodeId
    ) {
      alertEpisode = await AlertEpisodeService.findOneById({
        id: options.triggeredByAlertEpisodeId!,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          title: true,
          description: true,
          projectId: true,
          project: {
            name: true,
          },
          currentAlertState: {
            name: true,
          },
          alertSeverity: {
            name: true,
          },
          episodeNumber: true,
          episodeNumberWithPrefix: true,
          rootCause: true,
        },
      });
    }

    let incidentEpisode: IncidentEpisode | null = null;

    if (
      options.userNotificationEventType ===
        UserNotificationEventType.IncidentEpisodeCreated &&
      options.triggeredByIncidentEpisodeId
    ) {
      incidentEpisode = await IncidentEpisodeService.findOneById({
        id: options.triggeredByIncidentEpisodeId!,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          title: true,
          description: true,
          projectId: true,
          project: {
            name: true,
          },
          currentIncidentState: {
            name: true,
          },
          incidentSeverity: {
            name: true,
          },
          episodeNumber: true,
          episodeNumberWithPrefix: true,
          rootCause: true,
        },
      });
    }

    if (!incident && !alert && !alertEpisode && !incidentEpisode) {
      throw new BadDataException(
        "Incident, Alert, Alert Episode, or Incident Episode not found.",
      );
    }

    if (
      notificationRuleItem.userEmail?.email &&
      notificationRuleItem.userEmail?.isVerified
    ) {
      // send email for alert.

      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertCreated &&
        alert
      ) {
        // create an error log.
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending email to ${notificationRuleItem.userEmail?.email.toString()}`;
        logTimelineItem.userEmailId = notificationRuleItem.userEmail.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const emailMessage: EmailMessage =
          await this.generateEmailTemplateForAlertCreated(
            notificationRuleItem.userEmail?.email,
            alert,
            updatedLog.id!,
          );

        // send email.

        MailService.sendMail(emailMessage, {
          userOnCallLogTimelineId: updatedLog.id!,
          projectId: options.projectId,
          alertId: alert.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending email.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      // send email for incident
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentCreated &&
        incident
      ) {
        // create an error log.
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending email to ${notificationRuleItem.userEmail?.email.toString()}`;
        logTimelineItem.userEmailId = notificationRuleItem.userEmail.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const emailMessage: EmailMessage =
          await this.generateEmailTemplateForIncidentCreated(
            notificationRuleItem.userEmail?.email,
            incident,
            updatedLog.id!,
          );

        // send email.

        MailService.sendMail(emailMessage, {
          userOnCallLogTimelineId: updatedLog.id!,
          projectId: options.projectId,
          incidentId: incident.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending email.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      // send email for alert episode
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertEpisodeCreated &&
        alertEpisode
      ) {
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending email to ${notificationRuleItem.userEmail?.email.toString()}`;
        logTimelineItem.userEmailId = notificationRuleItem.userEmail.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const emailMessage: EmailMessage =
          await this.generateEmailTemplateForAlertEpisodeCreated(
            notificationRuleItem.userEmail?.email,
            alertEpisode,
            updatedLog.id!,
          );

        MailService.sendMail(emailMessage, {
          userOnCallLogTimelineId: updatedLog.id!,
          projectId: options.projectId,
          alertEpisodeId: alertEpisode.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending email.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      // send email for incident episode
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentEpisodeCreated &&
        incidentEpisode
      ) {
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending email to ${notificationRuleItem.userEmail?.email.toString()}`;
        logTimelineItem.userEmailId = notificationRuleItem.userEmail.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const emailMessage: EmailMessage =
          await this.generateEmailTemplateForIncidentEpisodeCreated(
            notificationRuleItem.userEmail?.email,
            incidentEpisode,
            updatedLog.id!,
          );

        /*
         * No incidentEpisodeId is passed: MailService.sendMail accepts the key
         * in its options type but never serialises it onto the request body, so
         * passing it would look like a link that does not exist.
         */
        MailService.sendMail(emailMessage, {
          userOnCallLogTimelineId: updatedLog.id!,
          projectId: options.projectId,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending email.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }
    }

    // if you have an email but is not verified, then create a log.
    if (
      notificationRuleItem.userEmail?.email &&
      !notificationRuleItem.userEmail?.isVerified
    ) {
      // create an error log.
      logTimelineItem.status = UserNotificationStatus.Error;
      logTimelineItem.statusMessage = `Email notification not sent because email ${notificationRuleItem.userEmail?.email.toString()} is not verified.`;

      await UserOnCallLogTimelineService.create({
        data: logTimelineItem,
        props: {
          isRoot: true,
        },
      });
    }

    // send sms.
    if (
      notificationRuleItem.userSms?.phone &&
      notificationRuleItem.userSms?.isVerified
    ) {
      //send sms for alert
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertCreated &&
        alert
      ) {
        // create an error log.
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending SMS to ${notificationRuleItem.userSms?.phone.toString()}.`;
        logTimelineItem.userSmsId = notificationRuleItem.userSms.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const smsMessage: SMS = await this.generateSmsTemplateForAlertCreated(
          notificationRuleItem.userSms.phone,
          alert,
          updatedLog.id!,
        );

        // send sms.

        SmsService.sendSms(smsMessage, {
          projectId: alert.projectId,
          customTwilioConfig: projectTwilioConfig,
          userOnCallLogTimelineId: updatedLog.id!,
          alertId: alert.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending SMS.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      // send sms for incident
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentCreated &&
        incident
      ) {
        // create an error log.
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending SMS to ${notificationRuleItem.userSms?.phone.toString()}.`;
        logTimelineItem.userSmsId = notificationRuleItem.userSms.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const smsMessage: SMS =
          await this.generateSmsTemplateForIncidentCreated(
            notificationRuleItem.userSms.phone,
            incident,
            updatedLog.id!,
          );

        // send sms.

        SmsService.sendSms(smsMessage, {
          projectId: incident.projectId,
          customTwilioConfig: projectTwilioConfig,
          userOnCallLogTimelineId: updatedLog.id!,
          incidentId: incident.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending SMS.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      // send sms for alert episode
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertEpisodeCreated &&
        alertEpisode
      ) {
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending SMS to ${notificationRuleItem.userSms?.phone.toString()}.`;
        logTimelineItem.userSmsId = notificationRuleItem.userSms.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const smsMessage: SMS =
          await this.generateSmsTemplateForAlertEpisodeCreated(
            notificationRuleItem.userSms.phone,
            alertEpisode,
            updatedLog.id!,
          );

        SmsService.sendSms(smsMessage, {
          projectId: alertEpisode.projectId,
          customTwilioConfig: projectTwilioConfig,
          userOnCallLogTimelineId: updatedLog.id!,
          alertEpisodeId: alertEpisode.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending SMS.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      // send sms for incident episode
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentEpisodeCreated &&
        incidentEpisode
      ) {
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending SMS to ${notificationRuleItem.userSms?.phone.toString()}.`;
        logTimelineItem.userSmsId = notificationRuleItem.userSms.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const smsMessage: SMS =
          await this.generateSmsTemplateForIncidentEpisodeCreated(
            notificationRuleItem.userSms.phone,
            incidentEpisode,
            updatedLog.id!,
          );

        /*
         * SmsService accepts incidentEpisodeId but drops it on the floor when
         * building the request body, so it is deliberately not passed here.
         */
        SmsService.sendSms(smsMessage, {
          projectId: incidentEpisode.projectId,
          customTwilioConfig: projectTwilioConfig,
          userOnCallLogTimelineId: updatedLog.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending SMS.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }
    }

    if (
      notificationRuleItem.userSms?.phone &&
      !notificationRuleItem.userSms?.isVerified
    ) {
      // create a log.
      logTimelineItem.status = UserNotificationStatus.Error;
      logTimelineItem.statusMessage = `SMS not sent because phone ${notificationRuleItem.userSms?.phone.toString()} is not verified.`;

      await UserOnCallLogTimelineService.create({
        data: logTimelineItem,
        props: {
          isRoot: true,
        },
      });
    }

    if (
      notificationRuleItem.userWhatsApp?.phone &&
      notificationRuleItem.userWhatsApp?.isVerified
    ) {
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertCreated &&
        alert
      ) {
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending WhatsApp message to ${notificationRuleItem.userWhatsApp?.phone.toString()}.`;
        logTimelineItem.userWhatsAppId = notificationRuleItem.userWhatsApp.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const whatsAppMessage: WhatsAppMessage =
          await this.generateWhatsAppTemplateForAlertCreated(
            notificationRuleItem.userWhatsApp.phone,
            alert,
            updatedLog.id!,
          );

        WhatsAppService.sendWhatsAppMessage(whatsAppMessage, {
          projectId: alert.projectId,
          alertId: alert.id!,
          userOnCallLogTimelineId: updatedLog.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending WhatsApp message.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentCreated &&
        incident
      ) {
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending WhatsApp message to ${notificationRuleItem.userWhatsApp?.phone.toString()}.`;
        logTimelineItem.userWhatsAppId = notificationRuleItem.userWhatsApp.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const whatsAppMessage: WhatsAppMessage =
          await this.generateWhatsAppTemplateForIncidentCreated(
            notificationRuleItem.userWhatsApp.phone,
            incident,
            updatedLog.id!,
          );

        WhatsAppService.sendWhatsAppMessage(whatsAppMessage, {
          projectId: incident.projectId,
          incidentId: incident.id!,
          userOnCallLogTimelineId: updatedLog.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending WhatsApp message.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      // send WhatsApp for alert episode
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertEpisodeCreated &&
        alertEpisode
      ) {
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending WhatsApp message to ${notificationRuleItem.userWhatsApp?.phone.toString()}.`;
        logTimelineItem.userWhatsAppId = notificationRuleItem.userWhatsApp.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const whatsAppMessage: WhatsAppMessage =
          await this.generateWhatsAppTemplateForAlertEpisodeCreated(
            notificationRuleItem.userWhatsApp.phone,
            alertEpisode,
            updatedLog.id!,
          );

        WhatsAppService.sendWhatsAppMessage(whatsAppMessage, {
          projectId: alertEpisode.projectId,
          alertEpisodeId: alertEpisode.id!,
          userOnCallLogTimelineId: updatedLog.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending WhatsApp message.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      // send WhatsApp for incident episode
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentEpisodeCreated &&
        incidentEpisode
      ) {
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending WhatsApp message to ${notificationRuleItem.userWhatsApp?.phone.toString()}.`;
        logTimelineItem.userWhatsAppId = notificationRuleItem.userWhatsApp.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const whatsAppMessage: WhatsAppMessage =
          await this.generateWhatsAppTemplateForIncidentEpisodeCreated(
            notificationRuleItem.userWhatsApp.phone,
            incidentEpisode,
            updatedLog.id!,
          );

        /*
         * WhatsAppService accepts incidentEpisodeId but never writes it onto
         * the request body, so it is deliberately not passed here.
         */
        WhatsAppService.sendWhatsAppMessage(whatsAppMessage, {
          projectId: incidentEpisode.projectId,
          userOnCallLogTimelineId: updatedLog.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending WhatsApp message.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }
    }

    if (
      notificationRuleItem.userWhatsApp?.phone &&
      !notificationRuleItem.userWhatsApp?.isVerified
    ) {
      logTimelineItem.status = UserNotificationStatus.Error;
      logTimelineItem.statusMessage = `WhatsApp message not sent because phone ${notificationRuleItem.userWhatsApp?.phone.toString()} is not verified.`;
      logTimelineItem.userWhatsAppId = notificationRuleItem.userWhatsApp.id!;

      await UserOnCallLogTimelineService.create({
        data: logTimelineItem,
        props: {
          isRoot: true,
        },
      });
    }

    // send Telegram.
    if (
      notificationRuleItem.userTelegram?.telegramChatId &&
      notificationRuleItem.userTelegram?.isVerified
    ) {
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertCreated &&
        alert
      ) {
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending Telegram message.`;
        logTimelineItem.userTelegramId = notificationRuleItem.userTelegram.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const telegramMessage: TelegramMessage = {
          to: notificationRuleItem.userTelegram.telegramChatId,
          body: await this.generateTelegramBodyForAlertCreated(
            alert,
            updatedLog.id!,
          ),
          parseMode: "HTML",
          disableWebPagePreview: true,
        };

        TelegramService.sendTelegramMessage(telegramMessage, {
          projectId: alert.projectId,
          alertId: alert.id!,
          userOnCallLogTimelineId: updatedLog.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending Telegram message.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentCreated &&
        incident
      ) {
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending Telegram message.`;
        logTimelineItem.userTelegramId = notificationRuleItem.userTelegram.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const telegramMessage: TelegramMessage = {
          to: notificationRuleItem.userTelegram.telegramChatId,
          body: await this.generateTelegramBodyForIncidentCreated(
            incident,
            updatedLog.id!,
          ),
          parseMode: "HTML",
          disableWebPagePreview: true,
        };

        TelegramService.sendTelegramMessage(telegramMessage, {
          projectId: incident.projectId,
          incidentId: incident.id!,
          userOnCallLogTimelineId: updatedLog.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending Telegram message.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertEpisodeCreated &&
        alertEpisode
      ) {
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending Telegram message.`;
        logTimelineItem.userTelegramId = notificationRuleItem.userTelegram.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const telegramMessage: TelegramMessage = {
          to: notificationRuleItem.userTelegram.telegramChatId,
          body: await this.generateTelegramBodyForAlertEpisodeCreated(
            alertEpisode,
            updatedLog.id!,
          ),
          parseMode: "HTML",
          disableWebPagePreview: true,
        };

        TelegramService.sendTelegramMessage(telegramMessage, {
          projectId: alertEpisode.projectId,
          alertEpisodeId: alertEpisode.id!,
          userOnCallLogTimelineId: updatedLog.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending Telegram message.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentEpisodeCreated &&
        incidentEpisode
      ) {
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending Telegram message.`;
        logTimelineItem.userTelegramId = notificationRuleItem.userTelegram.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const telegramMessage: TelegramMessage = {
          to: notificationRuleItem.userTelegram.telegramChatId,
          body: await this.generateTelegramBodyForIncidentEpisodeCreated(
            incidentEpisode,
            updatedLog.id!,
          ),
          parseMode: "HTML",
          disableWebPagePreview: true,
        };

        /*
         * TelegramService accepts incidentEpisodeId but never writes it onto
         * the request body, so it is deliberately not passed here.
         */
        TelegramService.sendTelegramMessage(telegramMessage, {
          projectId: incidentEpisode.projectId,
          userOnCallLogTimelineId: updatedLog.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending Telegram message.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }
    }

    if (
      notificationRuleItem.userTelegram &&
      !notificationRuleItem.userTelegram?.isVerified
    ) {
      logTimelineItem.status = UserNotificationStatus.Error;
      logTimelineItem.statusMessage = `Telegram message not sent because the Telegram account is not verified.`;
      logTimelineItem.userTelegramId = notificationRuleItem.userTelegram.id!;

      await UserOnCallLogTimelineService.create({
        data: logTimelineItem,
        props: {
          isRoot: true,
        },
      });
    }

    // send webhook.
    if (notificationRuleItem.userWebhook?.webhookUrl) {
      const webhookUrl: string = notificationRuleItem.userWebhook.webhookUrl;
      const webhookSecret: string | undefined =
        notificationRuleItem.userWebhook.secret;
      const userWebhookId: ObjectID = notificationRuleItem.userWebhook.id!;

      const dispatchWebhook: (params: {
        eventType: string;
        payload: JSONObject;
        entityId?: ObjectID;
        entityKind: "alert" | "incident" | "alertEpisode" | "incidentEpisode";
      }) => Promise<void> = async (params: {
        eventType: string;
        payload: JSONObject;
        entityId?: ObjectID;
        entityKind: "alert" | "incident" | "alertEpisode" | "incidentEpisode";
      }): Promise<void> => {
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending webhook to ${webhookUrl}.`;
        logTimelineItem.userWebhookId = userWebhookId;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const callbacksByKind: {
          alert?: { alertId?: ObjectID };
          incident?: { incidentId?: ObjectID };
        } = {};
        if (params.entityKind === "alert" && params.entityId) {
          callbacksByKind.alert = { alertId: params.entityId };
        } else if (params.entityKind === "incident" && params.entityId) {
          callbacksByKind.incident = { incidentId: params.entityId };
        }

        WebhookService.sendWebhook(
          {
            url: webhookUrl,
            eventType: params.eventType,
            payload: params.payload,
            secret: webhookSecret,
          },
          {
            projectId: options.projectId,
            userOnCallLogTimelineId: updatedLog.id!,
            userId: notificationRuleItem.userId!,
            onCallPolicyId: options.onCallPolicyId,
            onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
            teamId: options.userBelongsToTeamId,
            onCallDutyPolicyExecutionLogTimelineId:
              options.onCallDutyPolicyExecutionLogTimelineId,
            onCallScheduleId: options.onCallScheduleId,
            ...callbacksByKind.alert,
            ...callbacksByKind.incident,
          },
        ).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending webhook.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      };

      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertCreated &&
        alert
      ) {
        await dispatchWebhook({
          eventType: "on-call.alert.created",
          entityKind: "alert",
          entityId: alert.id!,
          payload: {
            eventType: "on-call.alert.created",
            timestamp: new Date().toISOString(),
            projectId: alert.projectId?.toString() || "",
            userId: notificationRuleItem.userId!.toString(),
            alert: {
              id: alert.id?.toString() || "",
              title: alert.title || "",
              description: alert.description || "",
              alertNumber: alert.alertNumber || null,
              alertNumberWithPrefix: alert.alertNumberWithPrefix || null,
              severity: alert.alertSeverity?.name || null,
              state: alert.currentAlertState?.name || null,
            },
            onCallPolicyId: options.onCallPolicyId?.toString() || null,
            onCallPolicyEscalationRuleId:
              options.onCallPolicyEscalationRuleId?.toString() || null,
          },
        });
      }

      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentCreated &&
        incident
      ) {
        await dispatchWebhook({
          eventType: "on-call.incident.created",
          entityKind: "incident",
          entityId: incident.id!,
          payload: {
            eventType: "on-call.incident.created",
            timestamp: new Date().toISOString(),
            projectId: incident.projectId?.toString() || "",
            userId: notificationRuleItem.userId!.toString(),
            incident: {
              id: incident.id?.toString() || "",
              title: incident.title || "",
              description: incident.description || "",
              incidentNumber: incident.incidentNumber || null,
              incidentNumberWithPrefix:
                incident.incidentNumberWithPrefix || null,
              severity: incident.incidentSeverity?.name || null,
              state: incident.currentIncidentState?.name || null,
            },
            onCallPolicyId: options.onCallPolicyId?.toString() || null,
            onCallPolicyEscalationRuleId:
              options.onCallPolicyEscalationRuleId?.toString() || null,
          },
        });
      }

      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertEpisodeCreated &&
        alertEpisode
      ) {
        await dispatchWebhook({
          eventType: "on-call.alertEpisode.created",
          entityKind: "alertEpisode",
          payload: {
            eventType: "on-call.alertEpisode.created",
            timestamp: new Date().toISOString(),
            projectId: alertEpisode.projectId?.toString() || "",
            userId: notificationRuleItem.userId!.toString(),
            alertEpisode: {
              id: alertEpisode.id?.toString() || "",
              title: alertEpisode.title || "",
              description: alertEpisode.description || "",
              episodeNumber: alertEpisode.episodeNumber || null,
              episodeNumberWithPrefix:
                alertEpisode.episodeNumberWithPrefix || null,
              severity: alertEpisode.alertSeverity?.name || null,
              state: alertEpisode.currentAlertState?.name || null,
            },
            onCallPolicyId: options.onCallPolicyId?.toString() || null,
            onCallPolicyEscalationRuleId:
              options.onCallPolicyEscalationRuleId?.toString() || null,
          },
        });
      }

      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentEpisodeCreated &&
        incidentEpisode
      ) {
        await dispatchWebhook({
          eventType: "on-call.incidentEpisode.created",
          entityKind: "incidentEpisode",
          payload: {
            eventType: "on-call.incidentEpisode.created",
            timestamp: new Date().toISOString(),
            projectId: incidentEpisode.projectId?.toString() || "",
            userId: notificationRuleItem.userId!.toString(),
            incidentEpisode: {
              id: incidentEpisode.id?.toString() || "",
              title: incidentEpisode.title || "",
              description: incidentEpisode.description || "",
              episodeNumber: incidentEpisode.episodeNumber || null,
              episodeNumberWithPrefix:
                incidentEpisode.episodeNumberWithPrefix || null,
              severity: incidentEpisode.incidentSeverity?.name || null,
              state: incidentEpisode.currentIncidentState?.name || null,
            },
            onCallPolicyId: options.onCallPolicyId?.toString() || null,
            onCallPolicyEscalationRuleId:
              options.onCallPolicyEscalationRuleId?.toString() || null,
          },
        });
      }
    }

    // send call.
    if (
      notificationRuleItem.userCall?.phone &&
      notificationRuleItem.userCall?.isVerified
    ) {
      // send call for alert
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertCreated &&
        alert
      ) {
        // create an error log.
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Making a call to ${notificationRuleItem.userCall?.phone.toString()}.`;
        logTimelineItem.userCallId = notificationRuleItem.userCall.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const callRequest: CallRequest =
          await this.generateCallTemplateForAlertCreated(
            notificationRuleItem.userCall?.phone,
            alert,
            updatedLog.id!,
          );

        // send call.

        CallService.makeCall(callRequest, {
          projectId: alert.projectId,
          customTwilioConfig: projectTwilioConfig,
          userOnCallLogTimelineId: updatedLog.id!,
          alertId: alert.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error making call.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentCreated &&
        incident
      ) {
        // send call for incident
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Making a call to ${notificationRuleItem.userCall?.phone.toString()}.`;
        logTimelineItem.userCallId = notificationRuleItem.userCall.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const callRequest: CallRequest =
          await this.generateCallTemplateForIncidentCreated(
            notificationRuleItem.userCall?.phone,
            incident,
            updatedLog.id!,
          );

        // send call.

        CallService.makeCall(callRequest, {
          projectId: incident.projectId,
          customTwilioConfig: projectTwilioConfig,
          userOnCallLogTimelineId: updatedLog.id!,
          incidentId: incident.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error making call.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      // send call for alert episode
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertEpisodeCreated &&
        alertEpisode
      ) {
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Making a call to ${notificationRuleItem.userCall?.phone.toString()}.`;
        logTimelineItem.userCallId = notificationRuleItem.userCall.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const callRequest: CallRequest =
          await this.generateCallTemplateForAlertEpisodeCreated(
            notificationRuleItem.userCall?.phone,
            alertEpisode,
            updatedLog.id!,
          );

        CallService.makeCall(callRequest, {
          projectId: alertEpisode.projectId,
          customTwilioConfig: projectTwilioConfig,
          userOnCallLogTimelineId: updatedLog.id!,
          alertEpisodeId: alertEpisode.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error making call.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      // send call for incident episode
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentEpisodeCreated &&
        incidentEpisode
      ) {
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Making a call to ${notificationRuleItem.userCall?.phone.toString()}.`;
        logTimelineItem.userCallId = notificationRuleItem.userCall.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const callRequest: CallRequest =
          await this.generateCallTemplateForIncidentEpisodeCreated(
            notificationRuleItem.userCall?.phone,
            incidentEpisode,
            updatedLog.id!,
          );

        /*
         * CallService accepts incidentEpisodeId but never writes it onto the
         * request body, so it is deliberately not passed here.
         */
        CallService.makeCall(callRequest, {
          projectId: incidentEpisode.projectId,
          customTwilioConfig: projectTwilioConfig,
          userOnCallLogTimelineId: updatedLog.id!,
          userId: notificationRuleItem.userId!,
          onCallPolicyId: options.onCallPolicyId,
          onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
          teamId: options.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            options.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: options.onCallScheduleId,
        }).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error making call.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }
    }

    if (
      notificationRuleItem.userCall?.phone &&
      !notificationRuleItem.userCall?.isVerified
    ) {
      // create a log.
      logTimelineItem.status = UserNotificationStatus.Error;
      logTimelineItem.statusMessage = `Call not sent because phone ${notificationRuleItem.userCall?.phone.toString()} is not verified.`;

      await UserOnCallLogTimelineService.create({
        data: logTimelineItem,
        props: {
          isRoot: true,
        },
      });
    }

    // send push notification.
    if (
      notificationRuleItem.userPush?.deviceToken &&
      notificationRuleItem.userPush?.isVerified
    ) {
      /*
       * This is the on-call paging path - the notification that exists to wake
       * somebody at 3am - so it is the only push in the product allowed to
       * override the ringer switch, and then only for a device whose owner
       * turned the option on. Owner subscriptions and note-posted notifications
       * go out through UserNotificationSettingService and never set this.
       */
      const isCriticalAlert: boolean = Boolean(
        notificationRuleItem.userPush.isCriticalAlertEnabled,
      );
      // send push notification for alert
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertCreated &&
        alert
      ) {
        // create a log.
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending push notification to device.`;
        logTimelineItem.userPushId = notificationRuleItem.userPush.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createAlertCreatedNotification({
            alertTitle: alert.title!,
            projectName: alert.project?.name || "OneUptime",
            alertViewLink: (
              await AlertService.getAlertLinkInDashboard(
                alert.projectId!,
                alert.id!,
              )
            ).toString(),
            ...(alert.alertNumber !== undefined && {
              alertNumber: alert.alertNumber,
            }),
            ...(alert.alertNumberWithPrefix && {
              alertNumberWithPrefix: alert.alertNumberWithPrefix,
            }),
            alertId: alert.id!.toString(),
            projectId: alert.projectId!.toString(),
          });

        pushMessage.isCriticalAlert = isCriticalAlert;

        // send push notification.
        PushNotificationService.sendPushNotification(
          {
            devices: [
              {
                token: notificationRuleItem.userPush.deviceToken!,
                ...(notificationRuleItem.userPush.deviceName && {
                  name: notificationRuleItem.userPush.deviceName,
                }),
              },
            ],
            message: pushMessage,
            deviceType: notificationRuleItem.userPush
              .deviceType! as PushDeviceType,
          },
          {
            projectId: options.projectId,
            userOnCallLogTimelineId: updatedLog.id!,
            alertId: alert.id!,
            userId: notificationRuleItem.userId!,
            onCallPolicyId: options.onCallPolicyId,
            onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
            teamId: options.userBelongsToTeamId,
            onCallDutyPolicyExecutionLogTimelineId:
              options.onCallDutyPolicyExecutionLogTimelineId,
            onCallScheduleId: options.onCallScheduleId,
          },
        ).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending push notification.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      // send push notification for incident
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentCreated &&
        incident
      ) {
        // create a log.
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending push notification to device.`;
        logTimelineItem.userPushId = notificationRuleItem.userPush.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createIncidentCreatedNotification({
            incidentTitle: incident.title!,
            projectName: incident.project?.name || "OneUptime",
            incidentViewLink: (
              await IncidentService.getIncidentLinkInDashboard(
                incident.projectId!,
                incident.id!,
              )
            ).toString(),
            ...(incident.incidentNumber !== undefined && {
              incidentNumber: incident.incidentNumber,
            }),
            ...(incident.incidentNumberWithPrefix && {
              incidentNumberWithPrefix: incident.incidentNumberWithPrefix,
            }),
            incidentId: incident.id!.toString(),
            projectId: incident.projectId!.toString(),
          });

        pushMessage.isCriticalAlert = isCriticalAlert;

        // send push notification.
        PushNotificationService.sendPushNotification(
          {
            devices: [
              {
                token: notificationRuleItem.userPush.deviceToken!,
                ...(notificationRuleItem.userPush.deviceName && {
                  name: notificationRuleItem.userPush.deviceName,
                }),
              },
            ],
            message: pushMessage,
            deviceType: notificationRuleItem.userPush
              .deviceType! as PushDeviceType,
          },
          {
            projectId: options.projectId,
            userOnCallLogTimelineId: updatedLog.id!,
            incidentId: incident.id!,
            userId: notificationRuleItem.userId!,
            onCallPolicyId: options.onCallPolicyId,
            onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
            teamId: options.userBelongsToTeamId,
            onCallDutyPolicyExecutionLogTimelineId:
              options.onCallDutyPolicyExecutionLogTimelineId,
            onCallScheduleId: options.onCallScheduleId,
          },
        ).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending push notification.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      // send push notification for alert episode
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.AlertEpisodeCreated &&
        alertEpisode
      ) {
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending push notification to device.`;
        logTimelineItem.userPushId = notificationRuleItem.userPush.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createAlertEpisodeCreatedNotification({
            alertEpisodeTitle: alertEpisode.title!,
            projectName: alertEpisode.project?.name || "OneUptime",
            alertEpisodeViewLink: (
              await AlertEpisodeService.getEpisodeLinkInDashboard(
                alertEpisode.projectId!,
                alertEpisode.id!,
              )
            ).toString(),
            ...(alertEpisode.episodeNumber !== undefined && {
              episodeNumber: alertEpisode.episodeNumber,
            }),
            ...(alertEpisode.episodeNumberWithPrefix && {
              episodeNumberWithPrefix: alertEpisode.episodeNumberWithPrefix,
            }),
            alertEpisodeId: alertEpisode.id!.toString(),
            projectId: alertEpisode.projectId!.toString(),
          });

        pushMessage.isCriticalAlert = isCriticalAlert;

        PushNotificationService.sendPushNotification(
          {
            devices: [
              {
                token: notificationRuleItem.userPush.deviceToken!,
                ...(notificationRuleItem.userPush.deviceName && {
                  name: notificationRuleItem.userPush.deviceName,
                }),
              },
            ],
            message: pushMessage,
            deviceType: notificationRuleItem.userPush
              .deviceType! as PushDeviceType,
          },
          {
            projectId: options.projectId,
            userOnCallLogTimelineId: updatedLog.id!,
            alertEpisodeId: alertEpisode.id!,
            userId: notificationRuleItem.userId!,
            onCallPolicyId: options.onCallPolicyId,
            onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
            teamId: options.userBelongsToTeamId,
            onCallDutyPolicyExecutionLogTimelineId:
              options.onCallDutyPolicyExecutionLogTimelineId,
            onCallScheduleId: options.onCallScheduleId,
          },
        ).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending push notification.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }

      // send push notification for incident episode
      if (
        options.userNotificationEventType ===
          UserNotificationEventType.IncidentEpisodeCreated &&
        incidentEpisode
      ) {
        deliveryAttempted = true;
        logTimelineItem.status = UserNotificationStatus.Sending;
        logTimelineItem.statusMessage = `Sending push notification to device.`;
        logTimelineItem.userPushId = notificationRuleItem.userPush.id!;

        const updatedLog: UserOnCallLogTimeline =
          await UserOnCallLogTimelineService.create({
            data: logTimelineItem,
            props: {
              isRoot: true,
            },
          });

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createIncidentEpisodeCreatedNotification({
            incidentEpisodeTitle: incidentEpisode.title!,
            projectName: incidentEpisode.project?.name || "OneUptime",
            incidentEpisodeViewLink: (
              await IncidentEpisodeService.getEpisodeLinkInDashboard(
                incidentEpisode.projectId!,
                incidentEpisode.id!,
              )
            ).toString(),
            ...(incidentEpisode.episodeNumber !== undefined && {
              episodeNumber: incidentEpisode.episodeNumber,
            }),
            ...(incidentEpisode.episodeNumberWithPrefix && {
              episodeNumberWithPrefix: incidentEpisode.episodeNumberWithPrefix,
            }),
            incidentEpisodeId: incidentEpisode.id!.toString(),
            projectId: incidentEpisode.projectId!.toString(),
          });

        pushMessage.isCriticalAlert = isCriticalAlert;

        PushNotificationService.sendPushNotification(
          {
            devices: [
              {
                token: notificationRuleItem.userPush.deviceToken!,
                ...(notificationRuleItem.userPush.deviceName && {
                  name: notificationRuleItem.userPush.deviceName,
                }),
              },
            ],
            message: pushMessage,
            deviceType: notificationRuleItem.userPush
              .deviceType! as PushDeviceType,
          },
          {
            projectId: options.projectId,
            userOnCallLogTimelineId: updatedLog.id!,
            userId: notificationRuleItem.userId!,
            onCallPolicyId: options.onCallPolicyId,
            onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
            teamId: options.userBelongsToTeamId,
            onCallDutyPolicyExecutionLogTimelineId:
              options.onCallDutyPolicyExecutionLogTimelineId,
            onCallScheduleId: options.onCallScheduleId,
          },
        ).catch(async (err: Error) => {
          await UserOnCallLogTimelineService.updateOneById({
            id: updatedLog.id!,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: err.message || "Error sending push notification.",
            },
            props: {
              isRoot: true,
            },
          });
        });
      }
    }

    if (
      notificationRuleItem.userPush?.deviceToken &&
      !notificationRuleItem.userPush?.isVerified
    ) {
      // create a log.
      logTimelineItem.status = UserNotificationStatus.Error;
      logTimelineItem.statusMessage = `Push notification not sent because device is not verified.`;

      await UserOnCallLogTimelineService.create({
        data: logTimelineItem,
        props: {
          isRoot: true,
        },
      });
    }

    /*
     * The fell-through guard.
     *
     * Gap F was a whole class of lost pages: a contactable channel, an event
     * type that no block in that channel branched on, and therefore neither a
     * send nor an error row — the responder was simply never told, and nothing
     * anywhere recorded that. Rather than trust that every future event type
     * gets wired into all seven blocks, make the omission loud.
     *
     * The row is built fresh instead of reusing logTimelineItem: that instance
     * picks up an _id as soon as any block has created a row with it, and a
     * second create() with it would UPDATE that row rather than insert this one.
     */
    if (contactableChannels.length > 0 && !deliveryAttempted) {
      const statusMessage: string = `No notification template for ${options.userNotificationEventType} on ${contactableChannels.join(", ")}.`;

      const fellThroughRow: UserOnCallLogTimeline = this.buildLogTimelineItem(
        notificationRuleItem,
        options,
      );
      fellThroughRow.status = UserNotificationStatus.Error;
      fellThroughRow.statusMessage = statusMessage;

      await UserOnCallLogTimelineService.create({
        data: fellThroughRow,
        props: {
          isRoot: true,
        },
      });

      logger.error(
        `${statusMessage} User on-call log: ${options.userNotificationLogId.toString()}`,
      );
    }

    return deliveryAttempted;
  }

  /*
   * The channels this rule could actually reach the user on, by display name.
   *
   * These are the same gates each channel block opens with, so an empty list
   * means "this rule can contact nobody" — a rule whose method was
   * cascade-deleted, say — and a non-empty one means a page was expected to go
   * out. Webhooks have no verification concept at all (UserWebhook has no
   * isVerified column), so presence of a URL is the whole gate there.
   */
  private getContactableChannelNames(
    notificationRuleItem: Model,
  ): Array<string> {
    const channels: Array<string> = [];

    if (
      notificationRuleItem.userEmail?.email &&
      notificationRuleItem.userEmail?.isVerified
    ) {
      channels.push("Email");
    }

    if (
      notificationRuleItem.userSms?.phone &&
      notificationRuleItem.userSms?.isVerified
    ) {
      channels.push("SMS");
    }

    if (
      notificationRuleItem.userWhatsApp?.phone &&
      notificationRuleItem.userWhatsApp?.isVerified
    ) {
      channels.push("WhatsApp");
    }

    if (
      notificationRuleItem.userTelegram?.telegramChatId &&
      notificationRuleItem.userTelegram?.isVerified
    ) {
      channels.push("Telegram");
    }

    if (notificationRuleItem.userWebhook?.webhookUrl) {
      channels.push("Webhook");
    }

    if (
      notificationRuleItem.userCall?.phone &&
      notificationRuleItem.userCall?.isVerified
    ) {
      channels.push("Call");
    }

    if (
      notificationRuleItem.userPush?.deviceToken &&
      notificationRuleItem.userPush?.isVerified
    ) {
      channels.push("Push");
    }

    return channels;
  }

  /*
   * Page a responder who has NO notification rule matching what just fired.
   *
   * Zero matching rules is indistinguishable from "never configured" unless the
   * user said otherwise, so the caller (UserOnCallLogService.onCreateSuccess)
   * checks for an explicit opt-out row first and only reaches here when the
   * silence looks accidental. Reaching a human on whatever they have verified
   * beats honouring a configuration they never made.
   *
   * Nothing here observes delivery success: every send below is fire-and-forget
   * (see deliverNotificationForRule), so `notified` means "a page was handed to
   * the sender", not "a phone rang".
   *
   * The three ways this can end are spelled out in FallbackNotificationOutcome,
   * and the caller must branch on them rather than on `notified` alone: only
   * NoUsableNotificationMethod describes a responder who cannot be reached, and
   * only that one is safe to record as a terminal status.
   */
  @CaptureSpan()
  public async executeFallbackNotification(
    options: ExecuteFallbackNotificationOptions,
  ): Promise<FallbackNotificationResult> {
    /*
     * Claim the log under the reserved fallback key before doing anything, so
     * two overlapping cron ticks cannot both fall back and double-page the same
     * responder for one escalation.
     */
    const claimed: boolean =
      await UserOnCallLogService.claimNotificationExecution({
        userOnCallLogId: options.userOnCallLogId,
        claimKey: FALLBACK_NOTIFICATION_CLAIM_KEY,
      });

    if (!claimed) {
      /*
       * A concurrent run already fell back for this log; it owns everything
       * that happens next, including the log's final status. Reported as the
       * transient outcome rather than as "no usable method", because the
       * caller's response to the latter is a terminal Error — which would
       * stamp "this responder is unreachable" over a page that is in flight.
       */
      return {
        outcome: FallbackNotificationOutcome.DeliveryFailed,
        notified: false,
        channelsUsed: [],
      };
    }

    const fallbackRules: Array<{ channelName: string; rule: Model }> =
      await this.chooseFallbackChannels(options);

    if (fallbackRules.length === 0) {
      logger.warn(
        `On-call fallback found no usable notification method for user ${options.userId.toString()} in project ${options.projectId.toString()} (${options.severityName} ${options.ruleType}). The page cannot be delivered.`,
      );

      return {
        outcome: FallbackNotificationOutcome.NoUsableNotificationMethod,
        notified: false,
        channelsUsed: [],
      };
    }

    const channelsUsed: Array<string> = [];
    let anAttemptFailed: boolean = false;

    /*
     * One delivery call per channel, never a loop inside one call: the timeline
     * row is a single mutable object inside deliverNotificationForRule, and a
     * second create() with it would UPDATE the row the first channel wrote
     * instead of inserting a second one — the second page would vanish from the
     * timeline and, worse, overwrite the first one's status.
     */
    for (const fallbackRule of fallbackRules) {
      try {
        const dispatched: boolean = await this.deliverNotificationForRule(
          fallbackRule.rule,
          options,
        );

        /*
         * Only a genuine dispatch earns a place in channelsUsed. The channel
         * names in here are read back to the operator as "notified via fallback
         * (Push, Email)", so a name added merely because the call resolved is a
         * lie in the one place somebody looks to find out whether the responder
         * was reached — and deliverNotificationForRule resolves perfectly
         * happily when no block claimed the event type.
         */
        if (dispatched) {
          channelsUsed.push(fallbackRule.channelName);
        } else {
          anAttemptFailed = true;

          logger.error(
            `On-call fallback dispatched nothing on ${fallbackRule.channelName} for user ${options.userId.toString()}: no notification template matched ${options.userNotificationEventType}.`,
          );
        }
      } catch (err) {
        anAttemptFailed = true;

        logger.error(
          `On-call fallback failed to deliver on ${fallbackRule.channelName} for user ${options.userId.toString()}.`,
        );
        logger.error(err);
      }
    }

    if (channelsUsed.length > 0) {
      return {
        outcome: FallbackNotificationOutcome.Delivered,
        notified: true,
        channelsUsed: channelsUsed,
      };
    }

    /*
     * There were channels to try and not one of them carried a page. That is
     * emphatically not the "responder has no notification method" case —
     * chooseFallbackChannels returns only verified, project-enabled methods, so
     * the responder is reachable and today simply failed to be reached.
     *
     * anAttemptFailed is necessarily true on this line, since every path
     * through the loop that does not push a channel sets it. It is read rather
     * than assumed so that a future channel that can finish without either
     * dispatching or failing degrades into the transient outcome instead of
     * silently telling the operator the responder has nothing configured.
     */
    return {
      outcome: anAttemptFailed
        ? FallbackNotificationOutcome.DeliveryFailed
        : FallbackNotificationOutcome.NoUsableNotificationMethod,
      notified: false,
      channelsUsed: [],
    };
  }

  /*
   * Pick what to page the user on, and build an unsaved rule for each choice.
   *
   * Zero-cost channels win: push and email reach the most people for no money
   * and no billing surprise, and there is no reason to pick between them, so a
   * user who has both gets both. Only a user with neither is worth spending on,
   * and then just once, in escalating-intrusiveness order.
   *
   * Paid channels are additionally gated on the project's own enable flags.
   * SmsService and CallService enforce those at send time, but WhatsApp and
   * Telegram only check them when a method is created — so a project that
   * switched WhatsApp off would still be billed by a fallback that did not look.
   */
  private async chooseFallbackChannels(
    options: ExecuteFallbackNotificationOptions,
  ): Promise<Array<{ channelName: string; rule: Model }>> {
    const chosen: Array<{ channelName: string; rule: Model }> = [];

    const userPush: UserPush | null = await UserPushService.findOneBy({
      query: {
        projectId: options.projectId,
        userId: options.userId,
        isVerified: true,
      },
      select: {
        _id: true,
        deviceToken: true,
        deviceType: true,
        isVerified: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (userPush) {
      const rule: Model = this.buildUnsavedFallbackRule(options);
      rule.userPush = userPush;
      rule.userPushId = userPush.id!;
      chosen.push({ channelName: "Push", rule: rule });
    }

    const userEmail: UserEmail | null = await UserEmailService.findOneBy({
      query: {
        projectId: options.projectId,
        userId: options.userId,
        isVerified: true,
      },
      select: {
        _id: true,
        email: true,
        isVerified: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (userEmail) {
      const rule: Model = this.buildUnsavedFallbackRule(options);
      rule.userEmail = userEmail;
      rule.userEmailId = userEmail.id!;
      chosen.push({ channelName: "Email", rule: rule });
    }

    if (chosen.length > 0) {
      return chosen;
    }

    const project: Project | null = await ProjectService.findOneById({
      id: options.projectId,
      select: {
        enableSmsNotifications: true,
        enableCallNotifications: true,
        enableWhatsAppNotifications: true,
        enableTelegramNotifications: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (project?.enableSmsNotifications) {
      const userSms: UserSMS | null = await UserSmsService.findOneBy({
        query: {
          projectId: options.projectId,
          userId: options.userId,
          isVerified: true,
        },
        select: {
          _id: true,
          phone: true,
          isVerified: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (userSms) {
        const rule: Model = this.buildUnsavedFallbackRule(options);
        rule.userSms = userSms;
        rule.userSmsId = userSms.id!;

        return [{ channelName: "SMS", rule: rule }];
      }
    }

    if (project?.enableCallNotifications) {
      const userCall: UserCall | null = await UserCallService.findOneBy({
        query: {
          projectId: options.projectId,
          userId: options.userId,
          isVerified: true,
        },
        select: {
          _id: true,
          phone: true,
          isVerified: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (userCall) {
        const rule: Model = this.buildUnsavedFallbackRule(options);
        rule.userCall = userCall;
        rule.userCallId = userCall.id!;

        return [{ channelName: "Call", rule: rule }];
      }
    }

    if (project?.enableWhatsAppNotifications) {
      const userWhatsApp: UserWhatsApp | null =
        await UserWhatsAppService.findOneBy({
          query: {
            projectId: options.projectId,
            userId: options.userId,
            isVerified: true,
          },
          select: {
            _id: true,
            phone: true,
            isVerified: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (userWhatsApp) {
        const rule: Model = this.buildUnsavedFallbackRule(options);
        rule.userWhatsApp = userWhatsApp;
        rule.userWhatsAppId = userWhatsApp.id!;

        return [{ channelName: "WhatsApp", rule: rule }];
      }
    }

    if (project?.enableTelegramNotifications) {
      const userTelegram: UserTelegram | null =
        await UserTelegramService.findOneBy({
          query: {
            projectId: options.projectId,
            userId: options.userId,
            isVerified: true,
          },
          select: {
            _id: true,
            telegramChatId: true,
            telegramUserHandle: true,
            isVerified: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (userTelegram) {
        const rule: Model = this.buildUnsavedFallbackRule(options);
        rule.userTelegram = userTelegram;
        rule.userTelegramId = userTelegram.id!;

        return [{ channelName: "Telegram", rule: rule }];
      }
    }

    /*
     * A webhook costs the project nothing and has no verification concept at
     * all (UserWebhook has no isVerified column), so its presence is the whole
     * test, and there is no project flag to consult.
     */
    const userWebhook: UserWebhook | null = await UserWebhookService.findOneBy({
      query: {
        projectId: options.projectId,
        userId: options.userId,
      },
      select: {
        _id: true,
        webhookUrl: true,
        name: true,
        secret: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (userWebhook) {
      const rule: Model = this.buildUnsavedFallbackRule(options);
      rule.userWebhook = userWebhook;
      rule.userWebhookId = userWebhook.id!;

      return [{ channelName: "Webhook", rule: rule }];
    }

    return chosen;
  }

  /*
   * A UserNotificationRule that exists only for the length of one delivery.
   *
   * It is never saved: the user did not ask for this rule, and persisting it
   * would silently rewrite their configuration behind their back. The method
   * relation is populated as a loaded entity rather than just its FK because
   * deliverNotificationForRule reads the relation (userEmail.email,
   * userEmail.isVerified) and never dereferences the id.
   */
  private buildUnsavedFallbackRule(
    options: ExecuteFallbackNotificationOptions,
  ): Model {
    const rule: Model = new Model();
    rule.projectId = options.projectId;
    rule.userId = options.userId;
    rule.ruleType = options.ruleType;
    rule.notifyAfterMinutes = 0;

    return rule;
  }

  @CaptureSpan()
  public async generateCallTemplateForAlertCreated(
    to: Phone,
    alert: Alert,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<CallRequest> {
    const host: Hostname = await DatabaseConfig.getHost();

    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const alertIdentifier: string =
      alert.alertNumber !== undefined
        ? `Alert number ${alert.alertNumber}, ${alert.title || "Alert"}`
        : alert.title || "Alert";

    const callRequest: CallRequest = {
      to: to,
      data: [
        {
          sayMessage: "This is a call from One Uptime",
        },
        {
          sayMessage: "A new alert has been created",
        },
        {
          sayMessage: alertIdentifier,
        },
        {
          introMessage: "To acknowledge this alert press 1",
          numDigits: 1,
          timeoutInSeconds: 10,
          noInputMessage: "You have not entered any input. Good bye",
          onInputCallRequest: {
            "1": {
              sayMessage: "You have acknowledged this alert. Good bye",
            },
            default: {
              sayMessage: "Invalid input. Good bye",
            },
          },
          responseUrl: new URL(
            httpProtocol,
            host,
            new Route(AppApiRoute.toString())
              .addRoute(new UserOnCallLogTimeline().crudApiPath!)
              .addRoute(
                "/call/gather-input/" + userOnCallLogTimelineId.toString(),
              ),
          ),
        },
      ],
    };

    return callRequest;
  }

  @CaptureSpan()
  public async generateCallTemplateForIncidentCreated(
    to: Phone,
    incident: Incident,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<CallRequest> {
    const host: Hostname = await DatabaseConfig.getHost();

    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const incidentIdentifier: string =
      incident.incidentNumber !== undefined
        ? `Incident number ${incident.incidentNumberWithPrefix || incident.incidentNumber}, ${incident.title || "Incident"}`
        : incident.title || "Incident";

    const callRequest: CallRequest = {
      to: to,
      data: [
        {
          sayMessage: "This is a call from One Uptime",
        },
        {
          sayMessage: "A new incident has been created",
        },
        {
          sayMessage: incidentIdentifier,
        },
        {
          introMessage: "To acknowledge this incident press 1",
          numDigits: 1,
          timeoutInSeconds: 10,
          noInputMessage: "You have not entered any input. Good bye",
          onInputCallRequest: {
            "1": {
              sayMessage: "You have acknowledged this incident. Good bye",
            },
            default: {
              sayMessage: "Invalid input. Good bye",
            },
          },
          responseUrl: new URL(
            httpProtocol,
            host,
            new Route(AppApiRoute.toString())
              .addRoute(new UserOnCallLogTimeline().crudApiPath!)
              .addRoute(
                "/call/gather-input/" + userOnCallLogTimelineId.toString(),
              ),
          ),
        },
      ],
    };

    return callRequest;
  }

  @CaptureSpan()
  public async generateCallTemplateForAlertEpisodeCreated(
    to: Phone,
    alertEpisode: AlertEpisode,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<CallRequest> {
    const host: Hostname = await DatabaseConfig.getHost();

    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const episodeIdentifier: string = alertEpisode.episodeNumberWithPrefix
      ? `Alert episode ${alertEpisode.episodeNumberWithPrefix}, ${alertEpisode.title || "Alert Episode"}`
      : alertEpisode.episodeNumber !== undefined
        ? `Alert episode number ${alertEpisode.episodeNumber}, ${alertEpisode.title || "Alert Episode"}`
        : alertEpisode.title || "Alert Episode";

    const callRequest: CallRequest = {
      to: to,
      data: [
        {
          sayMessage: "This is a call from One Uptime",
        },
        {
          sayMessage: "A new alert episode has been created",
        },
        {
          sayMessage: episodeIdentifier,
        },
        {
          introMessage: "To acknowledge this alert episode press 1",
          numDigits: 1,
          timeoutInSeconds: 10,
          noInputMessage: "You have not entered any input. Good bye",
          onInputCallRequest: {
            "1": {
              sayMessage: "You have acknowledged this alert episode. Good bye",
            },
            default: {
              sayMessage: "Invalid input. Good bye",
            },
          },
          responseUrl: new URL(
            httpProtocol,
            host,
            new Route(AppApiRoute.toString())
              .addRoute(new UserOnCallLogTimeline().crudApiPath!)
              .addRoute(
                "/call/gather-input/" + userOnCallLogTimelineId.toString(),
              ),
          ),
        },
      ],
    };

    return callRequest;
  }

  @CaptureSpan()
  public async generateCallTemplateForIncidentEpisodeCreated(
    to: Phone,
    incidentEpisode: IncidentEpisode,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<CallRequest> {
    const host: Hostname = await DatabaseConfig.getHost();

    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const episodeIdentifier: string = incidentEpisode.episodeNumberWithPrefix
      ? `Incident episode ${incidentEpisode.episodeNumberWithPrefix}, ${incidentEpisode.title || "Incident Episode"}`
      : incidentEpisode.episodeNumber !== undefined
        ? `Incident episode number ${incidentEpisode.episodeNumber}, ${incidentEpisode.title || "Incident Episode"}`
        : incidentEpisode.title || "Incident Episode";

    const callRequest: CallRequest = {
      to: to,
      data: [
        {
          sayMessage: "This is a call from One Uptime",
        },
        {
          sayMessage: "A new incident episode has been created",
        },
        {
          sayMessage: episodeIdentifier,
        },
        {
          introMessage: "To acknowledge this incident episode press 1",
          numDigits: 1,
          timeoutInSeconds: 10,
          noInputMessage: "You have not entered any input. Good bye",
          onInputCallRequest: {
            "1": {
              sayMessage:
                "You have acknowledged this incident episode. Good bye",
            },
            default: {
              sayMessage: "Invalid input. Good bye",
            },
          },
          responseUrl: new URL(
            httpProtocol,
            host,
            new Route(AppApiRoute.toString())
              .addRoute(new UserOnCallLogTimeline().crudApiPath!)
              .addRoute(
                "/call/gather-input/" + userOnCallLogTimelineId.toString(),
              ),
          ),
        },
      ],
    };

    return callRequest;
  }

  @CaptureSpan()
  public async generateSmsTemplateForAlertCreated(
    to: Phone,
    alert: Alert,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<SMS> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const shortUrl: ShortLink = await ShortLinkService.saveShortLinkFor(
      new URL(
        httpProtocol,
        host,
        new Route(AppApiRoute.toString())
          .addRoute(new UserOnCallLogTimeline().crudApiPath!)
          .addRoute("/acknowledge-page/" + userOnCallLogTimelineId.toString()),
      ),
    );
    const url: URL = await ShortLinkService.getShortenedUrl(shortUrl);

    const alertIdentifier: string =
      alert.alertNumber !== undefined
        ? `${alert.alertNumberWithPrefix || "#" + alert.alertNumber} (${alert.title || "Alert"})`
        : alert.title || "Alert";

    const sms: SMS = {
      to,
      message: `This is a message from OneUptime. A new alert has been created: ${alertIdentifier}. To acknowledge this alert, please click on the following link ${url.toString()}`,
    };

    return sms;
  }

  @CaptureSpan()
  public async generateSmsTemplateForIncidentCreated(
    to: Phone,
    incident: Incident,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<SMS> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const shortUrl: ShortLink = await ShortLinkService.saveShortLinkFor(
      new URL(
        httpProtocol,
        host,
        new Route(AppApiRoute.toString())
          .addRoute(new UserOnCallLogTimeline().crudApiPath!)
          .addRoute("/acknowledge-page/" + userOnCallLogTimelineId.toString()),
      ),
    );
    const url: URL = await ShortLinkService.getShortenedUrl(shortUrl);

    const incidentIdentifier: string =
      incident.incidentNumber !== undefined
        ? `${incident.incidentNumberWithPrefix || "#" + incident.incidentNumber} (${incident.title || "Incident"})`
        : incident.title || "Incident";

    const sms: SMS = {
      to,
      message: `This is a message from OneUptime. A new incident has been created: ${incidentIdentifier}. To acknowledge this incident, please click on the following link ${url.toString()}`,
    };

    return sms;
  }

  @CaptureSpan()
  public async generateSmsTemplateForAlertEpisodeCreated(
    to: Phone,
    alertEpisode: AlertEpisode,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<SMS> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const shortUrl: ShortLink = await ShortLinkService.saveShortLinkFor(
      new URL(
        httpProtocol,
        host,
        new Route(AppApiRoute.toString())
          .addRoute(new UserOnCallLogTimeline().crudApiPath!)
          .addRoute("/acknowledge-page/" + userOnCallLogTimelineId.toString()),
      ),
    );
    const url: URL = await ShortLinkService.getShortenedUrl(shortUrl);

    const episodeIdentifier: string = alertEpisode.episodeNumberWithPrefix
      ? `${alertEpisode.episodeNumberWithPrefix} (${alertEpisode.title || "Alert Episode"})`
      : alertEpisode.episodeNumber !== undefined
        ? `#${alertEpisode.episodeNumber} (${alertEpisode.title || "Alert Episode"})`
        : alertEpisode.title || "Alert Episode";

    const sms: SMS = {
      to,
      message: `This is a message from OneUptime. A new alert episode has been created: ${episodeIdentifier}. To acknowledge this alert episode, please click on the following link ${url.toString()}`,
    };

    return sms;
  }

  @CaptureSpan()
  public async generateSmsTemplateForIncidentEpisodeCreated(
    to: Phone,
    incidentEpisode: IncidentEpisode,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<SMS> {
    const url: URL = await this.buildOnCallAcknowledgeShortUrl(
      userOnCallLogTimelineId,
    );

    const episodeIdentifier: string = incidentEpisode.episodeNumberWithPrefix
      ? `${incidentEpisode.episodeNumberWithPrefix} (${incidentEpisode.title || "Incident Episode"})`
      : incidentEpisode.episodeNumber !== undefined
        ? `#${incidentEpisode.episodeNumber} (${incidentEpisode.title || "Incident Episode"})`
        : incidentEpisode.title || "Incident Episode";

    const sms: SMS = {
      to,
      message: `This is a message from OneUptime. A new incident episode has been created: ${episodeIdentifier}. To acknowledge this incident episode, please click on the following link ${url.toString()}`,
    };

    return sms;
  }

  private async buildOnCallAcknowledgeShortUrl(
    userOnCallLogTimelineId: ObjectID,
  ): Promise<URL> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const shortUrl: ShortLink = await ShortLinkService.saveShortLinkFor(
      new URL(
        httpProtocol,
        host,
        new Route(AppApiRoute.toString())
          .addRoute(new UserOnCallLogTimeline().crudApiPath!)
          .addRoute("/acknowledge-page/" + userOnCallLogTimelineId.toString()),
      ),
    );
    return await ShortLinkService.getShortenedUrl(shortUrl);
  }

  /*
   * Telegram's HTML parse_mode supports <b>, <i>, <a>, <code>. Only <, >, and &
   * need escaping inside those tags' text content.
   */
  private escapeTelegramHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  @CaptureSpan()
  public async generateTelegramBodyForAlertCreated(
    alert: Alert,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<string> {
    const ackUrl: URL = await this.buildOnCallAcknowledgeShortUrl(
      userOnCallLogTimelineId,
    );

    const alertIdentifier: string =
      alert.alertNumber !== undefined
        ? `${alert.alertNumberWithPrefix || "#" + alert.alertNumber} — ${alert.title || "Alert"}`
        : alert.title || "Alert";

    const lines: Array<string> = [
      "🚨 <b>New alert assigned to you</b>",
      "",
      `📋 <b>${this.escapeTelegramHtml(alertIdentifier)}</b>`,
      "",
      "👤 You're getting this because you're on call.",
    ];

    if (alert.projectId && alert.id) {
      const dashboardUrl: URL = await AlertService.getAlertLinkInDashboard(
        alert.projectId,
        alert.id,
      );
      lines.push(
        "",
        `🔎 <a href="${this.escapeTelegramHtml(dashboardUrl.toString())}">View alert in OneUptime</a>`,
      );
    }

    lines.push(
      "",
      `✅ <a href="${this.escapeTelegramHtml(ackUrl.toString())}">Tap to acknowledge</a>`,
    );

    return lines.join("\n");
  }

  @CaptureSpan()
  public async generateTelegramBodyForIncidentCreated(
    incident: Incident,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<string> {
    const ackUrl: URL = await this.buildOnCallAcknowledgeShortUrl(
      userOnCallLogTimelineId,
    );

    const incidentIdentifier: string =
      incident.incidentNumber !== undefined
        ? `${incident.incidentNumberWithPrefix || "#" + incident.incidentNumber} — ${incident.title || "Incident"}`
        : incident.title || "Incident";

    const lines: Array<string> = [
      "🔥 <b>New incident assigned to you</b>",
      "",
      `📋 <b>${this.escapeTelegramHtml(incidentIdentifier)}</b>`,
      "",
      "👤 You're getting this because you're on call.",
    ];

    if (incident.projectId && incident.id) {
      const dashboardUrl: URL =
        await IncidentService.getIncidentLinkInDashboard(
          incident.projectId,
          incident.id,
        );
      lines.push(
        "",
        `🔎 <a href="${this.escapeTelegramHtml(dashboardUrl.toString())}">View incident in OneUptime</a>`,
      );
    }

    lines.push(
      "",
      `✅ <a href="${this.escapeTelegramHtml(ackUrl.toString())}">Tap to acknowledge</a>`,
    );

    return lines.join("\n");
  }

  @CaptureSpan()
  public async generateTelegramBodyForAlertEpisodeCreated(
    alertEpisode: AlertEpisode,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<string> {
    const ackUrl: URL = await this.buildOnCallAcknowledgeShortUrl(
      userOnCallLogTimelineId,
    );

    const episodeIdentifier: string = alertEpisode.episodeNumberWithPrefix
      ? `${alertEpisode.episodeNumberWithPrefix} — ${alertEpisode.title || "Alert Episode"}`
      : alertEpisode.episodeNumber !== undefined
        ? `#${alertEpisode.episodeNumber} — ${alertEpisode.title || "Alert Episode"}`
        : alertEpisode.title || "Alert Episode";

    const lines: Array<string> = [
      "🔔 <b>New alert episode assigned to you</b>",
      "",
      `📋 <b>${this.escapeTelegramHtml(episodeIdentifier)}</b>`,
      "",
      "👤 You're getting this because you're on call.",
    ];

    if (alertEpisode.projectId && alertEpisode.id) {
      const dashboardUrl: URL =
        await AlertEpisodeService.getEpisodeLinkInDashboard(
          alertEpisode.projectId,
          alertEpisode.id,
        );
      lines.push(
        "",
        `🔎 <a href="${this.escapeTelegramHtml(dashboardUrl.toString())}">View alert episode in OneUptime</a>`,
      );
    }

    lines.push(
      "",
      `✅ <a href="${this.escapeTelegramHtml(ackUrl.toString())}">Tap to acknowledge</a>`,
    );

    return lines.join("\n");
  }

  @CaptureSpan()
  public async generateTelegramBodyForIncidentEpisodeCreated(
    incidentEpisode: IncidentEpisode,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<string> {
    const ackUrl: URL = await this.buildOnCallAcknowledgeShortUrl(
      userOnCallLogTimelineId,
    );

    const episodeIdentifier: string = incidentEpisode.episodeNumberWithPrefix
      ? `${incidentEpisode.episodeNumberWithPrefix} — ${incidentEpisode.title || "Incident Episode"}`
      : incidentEpisode.episodeNumber !== undefined
        ? `#${incidentEpisode.episodeNumber} — ${incidentEpisode.title || "Incident Episode"}`
        : incidentEpisode.title || "Incident Episode";

    const lines: Array<string> = [
      "🔥 <b>New incident episode assigned to you</b>",
      "",
      `📋 <b>${this.escapeTelegramHtml(episodeIdentifier)}</b>`,
      "",
      "👤 You're getting this because you're on call.",
    ];

    if (incidentEpisode.projectId && incidentEpisode.id) {
      const dashboardUrl: URL =
        await IncidentEpisodeService.getEpisodeLinkInDashboard(
          incidentEpisode.projectId,
          incidentEpisode.id,
        );
      lines.push(
        "",
        `🔎 <a href="${this.escapeTelegramHtml(dashboardUrl.toString())}">View incident episode in OneUptime</a>`,
      );
    }

    lines.push(
      "",
      `✅ <a href="${this.escapeTelegramHtml(ackUrl.toString())}">Tap to acknowledge</a>`,
    );

    return lines.join("\n");
  }

  @CaptureSpan()
  public async generateWhatsAppTemplateForAlertCreated(
    to: Phone,
    alert: Alert,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<WhatsAppMessage> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const acknowledgeShortLink: ShortLink =
      await ShortLinkService.saveShortLinkFor(
        new URL(
          httpProtocol,
          host,
          new Route(AppApiRoute.toString())
            .addRoute(new UserOnCallLogTimeline().crudApiPath!)
            .addRoute(
              "/acknowledge-page/" + userOnCallLogTimelineId.toString(),
            ),
        ),
      );

    const acknowledgeUrl: URL =
      await ShortLinkService.getShortenedUrl(acknowledgeShortLink);

    const alertLinkOnDashboard: string =
      alert.projectId && alert.id
        ? (
            await AlertService.getAlertLinkInDashboard(
              alert.projectId,
              alert.id,
            )
          ).toString()
        : acknowledgeUrl.toString();

    const templateKey: WhatsAppTemplateId = WhatsAppTemplateIds.AlertCreated;
    const templateVariables: Record<string, string> = {
      project_name: alert.project?.name || "OneUptime",
      alert_title: alert.title || "",
      acknowledge_url: acknowledgeUrl.toString(),
      alert_number:
        alert.alertNumber !== undefined ? alert.alertNumber.toString() : "",
      alert_link: alertLinkOnDashboard,
    };

    const body: string = renderWhatsAppTemplate(templateKey, templateVariables);

    return {
      to,
      body,
      templateKey,
      templateVariables,
      templateLanguageCode: WhatsAppTemplateLanguage[templateKey],
    };
  }

  @CaptureSpan()
  public async generateWhatsAppTemplateForIncidentCreated(
    to: Phone,
    incident: Incident,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<WhatsAppMessage> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const acknowledgeShortLink: ShortLink =
      await ShortLinkService.saveShortLinkFor(
        new URL(
          httpProtocol,
          host,
          new Route(AppApiRoute.toString())
            .addRoute(new UserOnCallLogTimeline().crudApiPath!)
            .addRoute(
              "/acknowledge-page/" + userOnCallLogTimelineId.toString(),
            ),
        ),
      );

    const acknowledgeUrl: URL =
      await ShortLinkService.getShortenedUrl(acknowledgeShortLink);

    const incidentLinkOnDashboard: string =
      incident.projectId && incident.id
        ? (
            await IncidentService.getIncidentLinkInDashboard(
              incident.projectId,
              incident.id,
            )
          ).toString()
        : acknowledgeUrl.toString();

    const templateKey: WhatsAppTemplateId = WhatsAppTemplateIds.IncidentCreated;
    const templateVariables: Record<string, string> = {
      project_name: incident.project?.name || "OneUptime",
      incident_title: incident.title || "",
      acknowledge_url: acknowledgeUrl.toString(),
      incident_number:
        incident.incidentNumber !== undefined
          ? incident.incidentNumber.toString()
          : "",
      incident_link: incidentLinkOnDashboard,
    };

    const body: string = renderWhatsAppTemplate(templateKey, templateVariables);

    return {
      to,
      body,
      templateKey,
      templateVariables,
      templateLanguageCode: WhatsAppTemplateLanguage[templateKey],
    };
  }

  @CaptureSpan()
  public async generateWhatsAppTemplateForAlertEpisodeCreated(
    to: Phone,
    alertEpisode: AlertEpisode,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<WhatsAppMessage> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const acknowledgeShortLink: ShortLink =
      await ShortLinkService.saveShortLinkFor(
        new URL(
          httpProtocol,
          host,
          new Route(AppApiRoute.toString())
            .addRoute(new UserOnCallLogTimeline().crudApiPath!)
            .addRoute(
              "/acknowledge-page/" + userOnCallLogTimelineId.toString(),
            ),
        ),
      );

    const acknowledgeUrl: URL =
      await ShortLinkService.getShortenedUrl(acknowledgeShortLink);

    const episodeLinkOnDashboard: string =
      alertEpisode.projectId && alertEpisode.id
        ? (
            await AlertEpisodeService.getEpisodeLinkInDashboard(
              alertEpisode.projectId,
              alertEpisode.id,
            )
          ).toString()
        : acknowledgeUrl.toString();

    const templateKey: WhatsAppTemplateId =
      WhatsAppTemplateIds.AlertEpisodeCreated;
    const templateVariables: Record<string, string> = {
      project_name: alertEpisode.project?.name || "OneUptime",
      episode_title: alertEpisode.title || "",
      acknowledge_url: acknowledgeUrl.toString(),
      episode_number:
        alertEpisode.episodeNumberWithPrefix ||
        (alertEpisode.episodeNumber !== undefined
          ? alertEpisode.episodeNumber.toString()
          : ""),
      episode_link: episodeLinkOnDashboard,
    };

    const body: string = renderWhatsAppTemplate(templateKey, templateVariables);

    return {
      to,
      body,
      templateKey,
      templateVariables,
      templateLanguageCode: WhatsAppTemplateLanguage[templateKey],
    };
  }

  @CaptureSpan()
  public async generateWhatsAppTemplateForIncidentEpisodeCreated(
    to: Phone,
    incidentEpisode: IncidentEpisode,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<WhatsAppMessage> {
    const acknowledgeUrl: URL = await this.buildOnCallAcknowledgeShortUrl(
      userOnCallLogTimelineId,
    );

    const episodeLinkOnDashboard: string =
      incidentEpisode.projectId && incidentEpisode.id
        ? (
            await IncidentEpisodeService.getEpisodeLinkInDashboard(
              incidentEpisode.projectId,
              incidentEpisode.id,
            )
          ).toString()
        : acknowledgeUrl.toString();

    const templateKey: WhatsAppTemplateId =
      WhatsAppTemplateIds.IncidentEpisodeCreated;
    const templateVariables: Record<string, string> = {
      project_name: incidentEpisode.project?.name || "OneUptime",
      episode_title: incidentEpisode.title || "",
      acknowledge_url: acknowledgeUrl.toString(),
      episode_number:
        incidentEpisode.episodeNumberWithPrefix ||
        (incidentEpisode.episodeNumber !== undefined
          ? incidentEpisode.episodeNumber.toString()
          : ""),
      episode_link: episodeLinkOnDashboard,
    };

    const body: string = renderWhatsAppTemplate(templateKey, templateVariables);

    return {
      to,
      body,
      templateKey,
      templateVariables,
      templateLanguageCode: WhatsAppTemplateLanguage[templateKey],
    };
  }

  @CaptureSpan()
  public async generateEmailTemplateForAlertCreated(
    to: Email,
    alert: Alert,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<EmailMessage> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const alertNumber: string =
      alert.alertNumberWithPrefix ||
      (alert.alertNumber ? `#${alert.alertNumber}` : "");

    const vars: Dictionary<string> = {
      alertTitle: alert.title!,
      alertNumber: alertNumber,
      projectName: alert.project!.name!,
      currentState: alert.currentAlertState!.name!,
      alertDescription: await Markdown.convertToHTML(
        alert.description! || "",
        MarkdownContentType.Email,
      ),
      alertSeverity: alert.alertSeverity!.name!,
      alertViewLink: (
        await AlertService.getAlertLinkInDashboard(alert.projectId!, alert.id!)
      ).toString(),
      acknowledgeAlertLink: new URL(
        httpProtocol,
        host,
        new Route(AppApiRoute.toString())
          .addRoute(new UserOnCallLogTimeline().crudApiPath!)
          .addRoute("/acknowledge-page/" + userOnCallLogTimelineId.toString()),
      ).toString(),
    };

    const emailMessage: EmailMessage = {
      toEmail: to!,
      templateType: EmailTemplateType.AcknowledgeAlert,
      vars: vars,
      subject: `ACTION REQUIRED: Alert ${alertNumber} created - ${alert.title!}`,
    };

    return emailMessage;
  }

  @CaptureSpan()
  public async generateEmailTemplateForIncidentCreated(
    to: Email,
    incident: Incident,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<EmailMessage> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const incidentNumber: string =
      incident.incidentNumberWithPrefix ||
      (incident.incidentNumber ? `#${incident.incidentNumber}` : "");

    const vars: Dictionary<string> = {
      incidentTitle: incident.title!,
      incidentNumber: incidentNumber,
      projectName: incident.project!.name!,
      currentState: incident.currentIncidentState!.name!,
      incidentDescription: await Markdown.convertToHTML(
        incident.description! || "",
        MarkdownContentType.Email,
      ),
      incidentSeverity: incident.incidentSeverity!.name!,
      rootCause:
        incident.rootCause || "No root cause identified for this incident",
      incidentViewLink: (
        await IncidentService.getIncidentLinkInDashboard(
          incident.projectId!,
          incident.id!,
        )
      ).toString(),
      acknowledgeIncidentLink: new URL(
        httpProtocol,
        host,
        new Route(AppApiRoute.toString())
          .addRoute(new UserOnCallLogTimeline().crudApiPath!)
          .addRoute("/acknowledge-page/" + userOnCallLogTimelineId.toString()),
      ).toString(),
    };

    const emailMessage: EmailMessage = {
      toEmail: to!,
      templateType: EmailTemplateType.AcknowledgeIncident,
      vars: vars,
      subject: `ACTION REQUIRED: Incident ${incidentNumber} created - ${incident.title!}`,
    };

    return emailMessage;
  }

  @CaptureSpan()
  public async generateEmailTemplateForAlertEpisodeCreated(
    to: Email,
    alertEpisode: AlertEpisode,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<EmailMessage> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    // Fetch alerts that are members of this episode
    const episodeMembers: Array<AlertEpisodeMember> =
      await AlertEpisodeMemberService.findBy({
        query: {
          alertEpisodeId: alertEpisode.id!,
        },
        select: {
          alertId: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    // Get the alert IDs
    const alertIds: Array<ObjectID> = episodeMembers
      .map((member: AlertEpisodeMember) => {
        return member.alertId;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return id !== undefined;
      });

    // Fetch full alert data with monitors
    const alerts: Array<Alert> =
      alertIds.length > 0
        ? await AlertService.findBy({
            query: {
              _id: QueryHelper.any(alertIds),
            },
            select: {
              _id: true,
              title: true,
              alertNumber: true,
              alertNumberWithPrefix: true,
              monitor: {
                _id: true,
                name: true,
              },
            },
            props: {
              isRoot: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
          })
        : [];

    // Get unique monitors (resources affected)
    const monitorNames: Set<string> = new Set();
    for (const alert of alerts) {
      if (alert.monitor?.name) {
        monitorNames.add(alert.monitor.name);
      }
    }

    const resourcesAffected: string =
      monitorNames.size > 0
        ? Array.from(monitorNames).join(", ")
        : "No resources identified";

    // Build alerts list HTML with proper email styling
    let alertsListHtml: string = "";
    if (alerts.length > 0) {
      const alertRows: string[] = [];
      for (const alert of alerts) {
        const alertTitle: string = alert.title || "Untitled Alert";
        const alertNumber: string =
          alert.alertNumberWithPrefix ||
          (alert.alertNumber ? `#${alert.alertNumber}` : "");
        const alertLink: string = (
          await AlertService.getAlertLinkInDashboard(
            alertEpisode.projectId!,
            alert.id!,
          )
        ).toString();
        const monitorName: string = alert.monitor?.name || "";

        alertRows.push(`
            <tr>
              <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0;">
                <table cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td style="vertical-align: middle;">
                      <span style="display: inline-block; background-color: #dbeafe; color: #1e40af; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 4px; margin-right: 8px;">${alertNumber}</span>
                      <a href="${alertLink}" style="color: #2563eb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; font-weight: 500; text-decoration: none;">${alertTitle}</a>
                      ${monitorName ? `<span style="display: block; color: #64748b; font-size: 12px; margin-top: 4px;">Monitor: ${monitorName}</span>` : ""}
                    </td>
                    <td style="text-align: right; vertical-align: middle;">
                      <a href="${alertLink}" style="color: #2563eb; font-size: 12px; text-decoration: none;">View →</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          `);
      }
      if (alertRows.length > 0) {
        alertsListHtml = `
          <table cellpadding="0" cellspacing="0" width="100%" style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-radius: 8px; border: 1px solid #e2e8f0; margin: 8px 0 16px 0;">
            <tbody>
              ${alertRows.join("")}
            </tbody>
          </table>
        `;
      }
    }

    const episodeNumber: string =
      alertEpisode.episodeNumberWithPrefix ||
      (alertEpisode.episodeNumber ? `#${alertEpisode.episodeNumber}` : "");

    const vars: Dictionary<string> = {
      alertEpisodeTitle: alertEpisode.title!,
      episodeNumber: episodeNumber,
      projectName: alertEpisode.project!.name!,
      currentState: alertEpisode.currentAlertState!.name!,
      alertEpisodeDescription: await Markdown.convertToHTML(
        alertEpisode.description! || "",
        MarkdownContentType.Email,
      ),
      alertEpisodeSeverity: alertEpisode.alertSeverity!.name!,
      resourcesAffected: resourcesAffected,
      rootCause:
        alertEpisode.rootCause ||
        "No root cause identified for this alert episode",
      alertsList: alertsListHtml,
      alertsCount: alerts.length.toString(),
      alertEpisodeViewLink: (
        await AlertEpisodeService.getEpisodeLinkInDashboard(
          alertEpisode.projectId!,
          alertEpisode.id!,
        )
      ).toString(),
      acknowledgeAlertEpisodeLink: new URL(
        httpProtocol,
        host,
        new Route(AppApiRoute.toString())
          .addRoute(new UserOnCallLogTimeline().crudApiPath!)
          .addRoute("/acknowledge-page/" + userOnCallLogTimelineId.toString()),
      ).toString(),
    };

    const emailMessage: EmailMessage = {
      toEmail: to!,
      templateType: EmailTemplateType.AcknowledgeAlertEpisode,
      vars: vars,
      subject: `ACTION REQUIRED: Alert Episode ${episodeNumber} created - ${alertEpisode.title!}`,
    };

    return emailMessage;
  }

  @CaptureSpan()
  public async generateEmailTemplateForIncidentEpisodeCreated(
    to: Email,
    incidentEpisode: IncidentEpisode,
    userOnCallLogTimelineId: ObjectID,
  ): Promise<EmailMessage> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    // Fetch incidents that are members of this episode
    const episodeMembers: Array<IncidentEpisodeMember> =
      await IncidentEpisodeMemberService.findBy({
        query: {
          incidentEpisodeId: incidentEpisode.id!,
        },
        select: {
          incidentId: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    // Get the incident IDs
    const incidentIds: Array<ObjectID> = episodeMembers
      .map((member: IncidentEpisodeMember) => {
        return member.incidentId;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return id !== undefined;
      });

    // Fetch full incident data with monitors
    const incidents: Array<Incident> =
      incidentIds.length > 0
        ? await IncidentService.findBy({
            query: {
              _id: QueryHelper.any(incidentIds),
            },
            select: {
              _id: true,
              title: true,
              incidentNumber: true,
              incidentNumberWithPrefix: true,
              monitors: {
                _id: true,
                name: true,
              },
            },
            props: {
              isRoot: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
          })
        : [];

    /*
     * Unique monitors across every incident in the episode. An incident carries
     * a list of monitors (unlike an alert, which has exactly one), so this
     * flattens rather than reading a single relation.
     */
    const monitorNames: Set<string> = new Set();
    for (const incident of incidents) {
      for (const monitor of incident.monitors || []) {
        if (monitor.name) {
          monitorNames.add(monitor.name);
        }
      }
    }

    const resourcesAffected: string =
      monitorNames.size > 0
        ? Array.from(monitorNames).join(", ")
        : "No resources identified";

    // Build incidents list HTML with proper email styling
    let incidentsListHtml: string = "";
    if (incidents.length > 0) {
      const incidentRows: string[] = [];
      for (const incident of incidents) {
        const incidentTitle: string = incident.title || "Untitled Incident";
        const incidentNumber: string =
          incident.incidentNumberWithPrefix ||
          (incident.incidentNumber ? `#${incident.incidentNumber}` : "");
        const incidentLink: string = (
          await IncidentService.getIncidentLinkInDashboard(
            incidentEpisode.projectId!,
            incident.id!,
          )
        ).toString();
        const monitorName: string =
          (incident.monitors || [])
            .map((monitor: Monitor): string => {
              return monitor.name || "";
            })
            .filter((name: string): boolean => {
              return name.length > 0;
            })
            .join(", ") || "";

        incidentRows.push(`
            <tr>
              <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0;">
                <table cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td style="vertical-align: middle;">
                      <span style="display: inline-block; background-color: #fee2e2; color: #991b1b; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 4px; margin-right: 8px;">${incidentNumber}</span>
                      <a href="${incidentLink}" style="color: #2563eb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; font-weight: 500; text-decoration: none;">${incidentTitle}</a>
                      ${monitorName ? `<span style="display: block; color: #64748b; font-size: 12px; margin-top: 4px;">Monitor: ${monitorName}</span>` : ""}
                    </td>
                    <td style="text-align: right; vertical-align: middle;">
                      <a href="${incidentLink}" style="color: #2563eb; font-size: 12px; text-decoration: none;">View →</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          `);
      }
      if (incidentRows.length > 0) {
        incidentsListHtml = `
          <table cellpadding="0" cellspacing="0" width="100%" style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-radius: 8px; border: 1px solid #e2e8f0; margin: 8px 0 16px 0;">
            <tbody>
              ${incidentRows.join("")}
            </tbody>
          </table>
        `;
      }
    }

    const episodeNumber: string =
      incidentEpisode.episodeNumberWithPrefix ||
      (incidentEpisode.episodeNumber
        ? `#${incidentEpisode.episodeNumber}`
        : "");

    const vars: Dictionary<string> = {
      incidentEpisodeTitle: incidentEpisode.title!,
      episodeNumber: episodeNumber,
      projectName: incidentEpisode.project!.name!,
      currentState: incidentEpisode.currentIncidentState!.name!,
      incidentEpisodeDescription: await Markdown.convertToHTML(
        incidentEpisode.description! || "",
        MarkdownContentType.Email,
      ),
      incidentEpisodeSeverity: incidentEpisode.incidentSeverity!.name!,
      resourcesAffected: resourcesAffected,
      rootCause:
        incidentEpisode.rootCause ||
        "No root cause identified for this incident episode",
      incidentsList: incidentsListHtml,
      incidentsCount: incidents.length.toString(),
      incidentEpisodeViewLink: (
        await IncidentEpisodeService.getEpisodeLinkInDashboard(
          incidentEpisode.projectId!,
          incidentEpisode.id!,
        )
      ).toString(),
      acknowledgeIncidentEpisodeLink: new URL(
        httpProtocol,
        host,
        new Route(AppApiRoute.toString())
          .addRoute(new UserOnCallLogTimeline().crudApiPath!)
          .addRoute("/acknowledge-page/" + userOnCallLogTimelineId.toString()),
      ).toString(),
    };

    const emailMessage: EmailMessage = {
      toEmail: to!,
      templateType: EmailTemplateType.AcknowledgeIncidentEpisode,
      vars: vars,
      subject: `ACTION REQUIRED: Incident Episode ${episodeNumber} created - ${incidentEpisode.title!}`,
    };

    return emailMessage;
  }

  @CaptureSpan()
  public async startUserNotificationRulesExecution(
    userId: ObjectID,
    options: {
      projectId: ObjectID;
      triggeredByIncidentId?: ObjectID | undefined;
      triggeredByAlertId?: ObjectID | undefined;
      triggeredByAlertEpisodeId?: ObjectID | undefined;
      triggeredByIncidentEpisodeId?: ObjectID | undefined;
      userNotificationEventType: UserNotificationEventType;
      onCallPolicyExecutionLogId?: ObjectID | undefined;
      onCallPolicyId: ObjectID | undefined;
      onCallPolicyEscalationRuleId?: ObjectID | undefined;
      userBelongsToTeamId?: ObjectID | undefined;
      onCallDutyPolicyExecutionLogTimelineId?: ObjectID | undefined;
      onCallScheduleId?: ObjectID | undefined;
      overridedByUserId?: ObjectID | undefined;
    },
  ): Promise<void> {
    // add user notification log.
    const userOnCallLog: UserOnCallLog = new UserOnCallLog();

    userOnCallLog.userId = userId;
    userOnCallLog.projectId = options.projectId;

    if (options.triggeredByIncidentId) {
      userOnCallLog.triggeredByIncidentId = options.triggeredByIncidentId;
    }

    if (options.triggeredByAlertId) {
      userOnCallLog.triggeredByAlertId = options.triggeredByAlertId;
    }

    if (options.triggeredByAlertEpisodeId) {
      userOnCallLog.triggeredByAlertEpisodeId =
        options.triggeredByAlertEpisodeId;
    }

    if (options.triggeredByIncidentEpisodeId) {
      userOnCallLog.triggeredByIncidentEpisodeId =
        options.triggeredByIncidentEpisodeId;
    }

    userOnCallLog.userNotificationEventType = options.userNotificationEventType;

    if (options.onCallPolicyExecutionLogId) {
      userOnCallLog.onCallDutyPolicyExecutionLogId =
        options.onCallPolicyExecutionLogId;
    }

    if (options.onCallPolicyId) {
      userOnCallLog.onCallDutyPolicyId = options.onCallPolicyId;
    }

    if (options.onCallDutyPolicyExecutionLogTimelineId) {
      userOnCallLog.onCallDutyPolicyExecutionLogTimelineId =
        options.onCallDutyPolicyExecutionLogTimelineId;
    }

    if (options.onCallPolicyEscalationRuleId) {
      userOnCallLog.onCallDutyPolicyEscalationRuleId =
        options.onCallPolicyEscalationRuleId;
    }

    if (options.userBelongsToTeamId) {
      userOnCallLog.userBelongsToTeamId = options.userBelongsToTeamId;
    }

    if (options.onCallScheduleId) {
      userOnCallLog.onCallDutyScheduleId = options.onCallScheduleId;
    }

    userOnCallLog.status = UserNotificationExecutionStatus.Scheduled;
    userOnCallLog.statusMessage = "Scheduled";

    if (options.overridedByUserId) {
      userOnCallLog.overridedByUserId = options.overridedByUserId;
    }

    await UserOnCallLogService.create({
      data: userOnCallLog,
      props: {
        isRoot: true,
      },
    });

    // Alert workspace here. Invite users to channels for example. If they are not invited.

    this.runWorkspaceRulesForOnCallNotification({
      projectId: options.projectId,
      alertId: options.triggeredByAlertId,
      incidentId: options.triggeredByIncidentId,
      userId: userId,
    }).catch((error: Error) => {
      logger.error(error, {
        projectId: options.projectId?.toString(),
        userId: userId?.toString(),
      } as LogAttributes);
    });
  }

  @CaptureSpan()
  public async runWorkspaceRulesForOnCallNotification(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    userId: ObjectID;
  }): Promise<void> {
    // if alert and incidient are both present, then throw an error.
    if (data.incidentId && data.alertId) {
      throw new BadDataException("Either incidentId or alertId is required.");
    }

    // if none are present, then throw an error.

    if (!data.incidentId && !data.alertId) {
      throw new BadDataException("Either incidentId or alertId is required.");
    }

    // get notification rule where inviteOwners is true.
    const notificationRules: Array<WorkspaceNotificationRule> =
      await WorkspaceNotificationRuleService.getNotificationRulesWhereInviteOwnersIsTrue(
        {
          projectId: data.projectId!,
          notificationFor: {
            incidentId: data.incidentId,
            alertId: data.alertId,
          },
          notificationRuleEventType: data.incidentId
            ? NotificationRuleEventType.Incident
            : NotificationRuleEventType.Alert,
        },
      );

    let workspaceChannels: Array<NotificationRuleWorkspaceChannel> = [];

    if (data.incidentId) {
      workspaceChannels = await IncidentService.getWorkspaceChannelForIncident({
        incidentId: data.incidentId!,
      });
    }

    if (data.alertId) {
      workspaceChannels = await AlertService.getWorkspaceChannelForAlert({
        alertId: data.alertId!,
      });
    }

    WorkspaceNotificationRuleService.inviteUsersBasedOnRulesAndWorkspaceChannels(
      {
        notificationRules: notificationRules,
        projectId: data.projectId!,
        workspaceChannels: workspaceChannels,
        userIds: [data.userId],
      },
    ).catch((error: Error) => {
      logger.error(error, {
        projectId: data.projectId?.toString(),
        userId: data.userId?.toString(),
      } as LogAttributes);
    });
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const carrier: RuleColumnCarrier =
      createBy.data as unknown as RuleColumnCarrier;

    /*
     * THE OWNERSHIP COLUMN IS REDUCED TO ONE SPELLING BEFORE ANYTHING READS IT,
     * and it has to happen here, first, rather than inside the guard below.
     *
     * `userId` and `user` are two decorated members over one join column. Every
     * check from this line down — the roster check, the method-ownership check,
     * the create invariants, CreatePermission's own ownership gate, and the
     * audit line after the write — asks "who does this row belong to", and each
     * of them would otherwise have to answer it from two disagreeing sources.
     * A payload carrying `user: { _id: <somebody else> }` and no `userId` is
     * the concrete failure: the guard reads the scalar, finds nothing, falls
     * back to the actor and validates a self-write, while TypeORM writes the
     * relation's id and the row belongs to somebody else entirely.
     *
     * So: refuse a payload whose two spellings disagree, then fold the survivor
     * into the scalar. After these two lines `createBy.data.userId` is the
     * single, authoritative owner, and it is the value that will be persisted.
     *
     * Deliberately NOT behind the root short-circuit that guards the checks
     * below. This is a reduction of the payload rather than a permission
     * decision, and an internal caller writing an ambiguous row would be just
     * as ambiguous a row.
     */
    UserNotificationRuleAdminService.assertOneRuleOwner(carrier);
    UserNotificationRuleAdminService.collapseRuleOwnerRelationOnCreate(carrier);

    await this.assertWriteIsPermittedForRuleOwner(createBy);

    /*
     * Ambiguity is refused, then removed — in that order, and only after the
     * ownership guard above has had its say. A payload that names two different
     * methods for one channel is a payload nobody legitimately sends, and one
     * that names the same method twice is folded down to a single spelling so
     * that the invariants below, and the ORM after them, are reading the one
     * value that will actually be written.
     */
    UserNotificationRuleAdminService.assertOneMethodPerNotificationChannel(
      carrier,
    );
    UserNotificationRuleAdminService.collapseNotificationMethodRelationsOnCreate(
      carrier,
    );

    const hasNotificationMethod: boolean =
      UserNotificationRuleAdminService.carriesAnyNotificationMethod(carrier);

    this.assertRuleIsCoherent({
      isOptOut: Boolean(createBy.data.isOptOut),
      hasNotificationMethod: hasNotificationMethod,
    });

    return {
      createBy,
      carryForward: null,
    };
  }

  /**
   * The two invariants that decide whether a rule row means anything, enforced
   * from one place because create and update can each break both of them.
   *
   * An opt-out row is how a user says "deliberately do not page me for this rule
   * type at this severity". It carries the rule type and the severity and
   * nothing else — a method on it would be self-contradictory (reach me here;
   * also never reach me), and its whole purpose is to make silence explicit so
   * that every OTHER zero-rule case can be treated as misconfiguration and
   * rescued by the fallback. A rule that is NOT opt-out and names no method is
   * the mirror failure: it looks like coverage on every screen and delivers
   * nothing.
   *
   * The wording of both messages is load-bearing — the dashboard and the API
   * docs quote them — so they are written once here rather than once per path.
   */
  private assertRuleIsCoherent(data: {
    isOptOut: boolean;
    hasNotificationMethod: boolean;
  }): void {
    if (data.isOptOut && data.hasNotificationMethod) {
      throw new BadDataException(
        "An opt-out notification rule cannot have a notification method. Remove the notification method, or turn off opt-out.",
      );
    }

    if (!data.isOptOut && !data.hasNotificationMethod) {
      throw new BadDataException(
        "Call, SMS, WhatsApp, Telegram, Webhook, Email, or Push notification is required",
      );
    }
  }

  /**
   * The create-path half of the on-behalf-of guards (audit R1 and R3).
   *
   * CreatePermission.checkCreateOwnership decides WHETHER a caller may name
   * somebody else in the ownership column: CurrentUser-only callers may not, a
   * caller holding a real role permission in the model's create list may. That
   * check is deliberately permission-shaped and value-blind past that point —
   * it has no notion of a project roster and no notion of what the rest of the
   * row says. Both of those are checked here, because both of them are how the
   * widened permission turns into somebody else's pages.
   *
   * Root and master-admin writes are exempt, matching the short-circuit at the
   * top of CreatePermission. Every internal seeder (default rules on method
   * verification, invitation acceptance, migrations) builds the ownership
   * column and the method reference from one and the same userId, so the guard
   * could only ever cost them a query per row; and the delivery-time check in
   * executeNotificationRuleItem is the backstop that keeps even an internally
   * written bad row from being acted on.
   */
  private async assertWriteIsPermittedForRuleOwner(
    createBy: CreateBy<Model>,
  ): Promise<void> {
    if (createBy.props.isRoot || createBy.props.isMasterAdmin) {
      return;
    }

    /*
     * `createBy.data.userId` alone is enough HERE, and only because
     * onBeforeCreate has already folded the `user` relation into it. Read on
     * its own — before that reduction existed — this line was a bypass: a
     * payload spelling the owner as `user: { _id: <somebody else> }` left the
     * scalar empty, fell through to props.userId, and every check below was
     * answered about the actor while the row was written for the victim. If
     * that fold is ever moved or removed, this line becomes wrong again.
     *
     * The fallback to props.userId is a different thing and stays: an omitted
     * ownership column means "for myself". CreatePermission stamps props.userId
     * onto it, but it does so AFTER this hook has run, so the value is not on
     * the model yet and reading data.userId alone would treat every ordinary
     * self-service create as an unowned row.
     */
    const ruleOwnerUserId: ObjectID | undefined =
      createBy.data.userId || createBy.props.userId;

    if (!ruleOwnerUserId) {
      throw new BadDataException(
        "A notification rule must belong to a user. Sign in as the user this rule is for, or name the user the rule belongs to.",
      );
    }

    const actorUserId: ObjectID | undefined = createBy.props.userId;

    const isWritingForSomebodyElse: boolean =
      !actorUserId || actorUserId.toString() !== ruleOwnerUserId.toString();

    if (isWritingForSomebodyElse) {
      /*
       * R1. Holding an administrative permission is a claim about a PROJECT, so
       * it can only ever authorise writing for users of that project. Without
       * this, one throwaway project where the caller is an admin would license
       * writing notification rules for any user id in the installation.
       */
      await UserNotificationRuleAdminService.assertTargetUserIsProjectMember({
        targetUserId: ruleOwnerUserId,
        props: createBy.props,
      });
    }

    /*
     * R3, and note that it runs for a self-write too. "userId is me, but the
     * email row I am pointing at is yours" is the mirror image of the hijack —
     * it does not steal my pages, it copies them to your inbox — and it was
     * writable long before this phase widened anything.
     */
    const references: Array<NotificationMethodReference> =
      UserNotificationRuleAdminService.collectNotificationMethodReferences(
        createBy.data as unknown as RuleColumnCarrier,
      );

    await UserNotificationRuleAdminService.assertNotificationMethodsBelongToUser(
      {
        ownerUserId: ruleOwnerUserId,
        references: references,
      },
    );
  }

  /*
   * R6 for the create path.
   *
   * Keyed on the actor the SERVER resolved (props.userId) against the userId
   * the row was actually PERSISTED with — read off createdItem, after
   * CreatePermission has had its say and after the insert. Nothing in the
   * request body reaches this comparison, because the body is the thing being
   * audited.
   */
  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const actorUserId: ObjectID | undefined = onCreate.createBy.props.userId;
    const ruleOwnerUserId: ObjectID | undefined = createdItem.userId;

    if (
      actorUserId &&
      ruleOwnerUserId &&
      actorUserId.toString() !== ruleOwnerUserId.toString()
    ) {
      await UserNotificationRuleAdminService.recordAdminRuleChange({
        action: AuditLogAction.Create,
        actorUserId: actorUserId,
        ownerUserId: ruleOwnerUserId,
        projectId: createdItem.projectId || onCreate.createBy.props.tenantId,
        ruleId: createdItem.id,
        after: createdItem,
        notifyOwner: true,
        props: onCreate.createBy.props,
      });
    }

    return createdItem;
  }

  /**
   * Narrow a caller-supplied query to the rows that caller is actually entitled
   * to write, for use by the write hooks.
   *
   * WHY THIS EXISTS AT ALL. DatabaseService runs the hooks BEFORE the permission
   * layer: _updateBy calls onBeforeUpdate and only then
   * ModelPermission.checkUpdateQueryPermissions; _deleteBy calls onBeforeDelete
   * and only then checkDeleteQueryPermission. So a hook that reads
   * `updateBy.query` is reading the RAW request — no tenant predicate, no
   * ownership predicate — and the hooks below read it with `isRoot` props on
   * top, because the question they ask is a question about the database's state
   * rather than about the caller's visibility. Left there, a caller could point
   * the guard at rows in another project entirely: the guard would validate
   * against them, the audit trail would name their owners, and the write itself
   * would touch a completely different set.
   *
   * WHY NOT JUST CALL ModelPermission. That is the obvious fix and it is the
   * wrong one. checkUpdateQueryPermissions does two jobs — it narrows the query
   * AND it authorises the request — and running it here would run the second
   * job twice, moving every table- and column-level rejection into the hook and
   * duplicating the team lookups behind the tenant scope on every write. The
   * hook does not need to authorise anything; _updateBy authorises it a few
   * lines later and is the authority. What the hook needs is only that the row
   * set it reasons about is no wider than the row set the write can reach.
   *
   * WHAT IS REPRODUCED, AND WHY THAT IS THE WHOLE OF IT. For this model the
   * narrowing is exactly two predicates: the tenant column
   * (TenantPermission.addTenantScopeToQuery for a member,
   * PermissionUtil.addTenantScopeToQueryAsRoot on the delete path for root) and,
   * when Permission.CurrentUser is the ONLY thing letting the caller through,
   * the ownership column. Nothing else applies: UserNotificationRule declares no
   * access-control column, is not an operational resource and has no
   * @OwnedThrough, so addAccessControlIdsToQuery and addOwnedScopeToQuery are
   * both no-ops on it. IF ANY OF THAT CHANGES ON THE MODEL, THIS MUST CHANGE
   * WITH IT — a narrowing the permission layer applies and this does not is a
   * guard validating rows the write never touches.
   *
   * Root and master-admin queries are returned untouched. They are entitled to
   * every row, and narrowing them would make the guard read FEWER rows than the
   * write reaches, which is the one direction it must never be wrong in.
   */
  private narrowQueryToCallerEntitlement(
    query: Query<Model>,
    props: DatabaseCommonInteractionProps,
    requestType: DatabaseRequestType,
  ): Query<Model> {
    if (props.isRoot || props.isMasterAdmin) {
      return query;
    }

    const scopedQuery: Query<Model> = { ...query };

    const tenantColumn: string | null = this.getModel().getTenantColumn();

    if (tenantColumn && props.tenantId && !props.isMultiTenantRequest) {
      (scopedQuery as Dictionary<unknown>)[tenantColumn] = props.tenantId;
    }

    const userColumn: string | null = this.getModel().getUserColumn();

    if (
      userColumn &&
      props.userId &&
      TenantPermission.isAccessGrantedOnlyByCurrentUser(
        this.modelType,
        props,
        requestType,
      )
    ) {
      /*
       * Set rather than merged. A CurrentUser-only caller whose query names
       * somebody else is rejected outright by addCurrentUserScopeToQuery a
       * moment from now, so the only thing that matters here is that the guard
       * never reads rows that rejection would have protected.
       */
      (scopedQuery as Dictionary<unknown>)[userColumn] = props.userId;
    }

    return scopedQuery;
  }

  /**
   * The update-path half of R3, plus the read that R6 needs.
   *
   * The rule's owner is re-read FROM THE DATABASE here and never taken from
   * updateBy.data. That is the whole point of the hook: on update the caller
   * controls the body, so a userId in it is a claim ("this row is mine") made
   * by exactly the party the guard exists to doubt. The persisted value is the
   * only one that decides whose pages the row selects, so it is the only one
   * worth comparing a method's owner against.
   *
   * The lookup runs with isRoot rather than the caller's own props on purpose.
   * Scoping it to what the CALLER can READ would let a caller who cannot see a
   * row edit it unchecked — the query would simply return nothing and the loop
   * below would have nothing to reject. Read permission and write permission are
   * different lists, and it is the write one that decides what this hook has to
   * answer for.
   *
   * The QUERY, on the other hand, is narrowed first. Root props remove the
   * caller's visibility from the answer; they must not also remove the caller's
   * ENTITLEMENT from it, and this hook runs before ModelPermission has applied
   * either. See narrowQueryToCallerEntitlement for why the narrowing is
   * reproduced here rather than delegated.
   *
   * The rows are carried forward so onUpdateSuccess can audit against the
   * owner as it stood BEFORE the write, without a second read and without
   * trusting anything the request said.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const patch: RuleColumnCarrier =
      updateBy.data as unknown as RuleColumnCarrier;

    const references: Array<NotificationMethodReference> =
      UserNotificationRuleAdminService.collectNotificationMethodReferences(
        patch,
      );

    const isInternalWrite: boolean = Boolean(
      updateBy.props.isRoot || updateBy.props.isMasterAdmin,
    );

    /*
     * Three reasons to read the affected rows, and only one of them is R3. An
     * actor id means this write might be somebody editing somebody else's
     * configuration, which R6 has to be able to report on even when no method FK
     * is being touched; and a patch that touches `isOptOut` or any method column
     * can break a row-level invariant that is only visible once the patch is
     * laid over the row it is being applied to.
     */
    const touchesRuleCoherence: boolean =
      patch["isOptOut"] !== undefined ||
      UserNotificationRuleAdminService.mentionsAnyNotificationMethodColumn(
        patch,
      );

    const needsAffectedRules: boolean =
      (references.length > 0 && !isInternalWrite) ||
      touchesRuleCoherence ||
      Boolean(updateBy.props.userId);

    if (!needsAffectedRules) {
      return {
        updateBy,
        carryForward: null,
      };
    }

    const affectedRules: Array<Model> = await this.findBy({
      query: this.narrowQueryToCallerEntitlement(
        updateBy.query,
        updateBy.props,
        DatabaseRequestType.Update,
      ),
      select: {
        _id: true,
        userId: true,
        projectId: true,
        ruleType: true,
        notifyAfterMinutes: true,
        isOptOut: true,
        incidentSeverityId: true,
        alertSeverityId: true,
        userEmailId: true,
        userSmsId: true,
        userCallId: true,
        userWhatsAppId: true,
        userTelegramId: true,
        userPushId: true,
        userWebhookId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    if (references.length > 0 && !isInternalWrite) {
      /*
       * One validation per DISTINCT owner rather than per row. A bulk update
       * across twenty of one user's rules asks the same question twenty times,
       * and each question costs a lookup per referenced method.
       */
      const validatedOwnerIds: Set<string> = new Set<string>();

      for (const affectedRule of affectedRules) {
        const ownerKey: string = affectedRule.userId?.toString() || "";

        if (validatedOwnerIds.has(ownerKey)) {
          continue;
        }

        validatedOwnerIds.add(ownerKey);

        await UserNotificationRuleAdminService.assertNotificationMethodsBelongToUser(
          {
            ownerUserId: affectedRule.userId,
            references: references,
          },
        );
      }
    }

    /*
     * Ambiguity is refused here as it is on create, but NOT folded away. The
     * relation members are `update: []` on this model while the `*Id` members
     * are open to an administrator, so rewriting one spelling into the other
     * would smuggle a column write past the very ColumnPermission check that
     * runs immediately after this hook. Refusal leaves nothing for the ORM to
     * choose between without moving a value across a permission boundary.
     */
    UserNotificationRuleAdminService.assertOneMethodPerNotificationChannel(
      patch,
    );

    if (touchesRuleCoherence) {
      /*
       * The create-time invariants, re-checked per affected row.
       *
       * They were enforced only on create, which left update as a way to reach
       * the states create refuses: flip `isOptOut` on a rule that carries an
       * email and you have a row that says both "reach me here" and "never
       * reach me"; null the last method on a rule that is not opt-out and you
       * have a row that looks like coverage on every screen and delivers
       * nothing — indistinguishable, to the fallback, from a deliberate choice
       * to stay silent. Neither is visible from the patch alone, which is why
       * this waits until the affected rows have been read.
       */
      for (const affectedRule of affectedRules) {
        const methodIdsAfterPatch: Array<ObjectID> =
          UserNotificationRuleAdminService.getNotificationMethodIdsAfterPatch({
            patch: patch,
            currentRow: affectedRule as unknown as RuleColumnCarrier,
          });

        const isOptOutAfterPatch: boolean =
          patch["isOptOut"] !== undefined
            ? Boolean(patch["isOptOut"])
            : Boolean(affectedRule.isOptOut);

        this.assertRuleIsCoherent({
          isOptOut: isOptOutAfterPatch,
          hasNotificationMethod: methodIdsAfterPatch.length > 0,
        });
      }
    }

    return {
      updateBy,
      carryForward: {
        affectedRules: affectedRules,
      },
    };
  }

  /*
   * R6 for the update path.
   *
   * Every row whose PERSISTED owner is somebody other than the actor gets an
   * audit entry; the owner gets at most one mail no matter how many of their
   * rules one request touched, because twenty copies of "an admin changed your
   * rules" is a message people learn to delete rather than read.
   *
   * `updatedItemIds` is the set of rows the write ACTUALLY touched, and the
   * carried-forward rows are filtered down to it. The two can differ: the hook
   * read every row the (narrowed) query matched, while _updateBy applies the
   * caller's own skip/limit and drops rows that were hard-deleted between the
   * two. Reporting an unchanged row would put a change in the audit trail that
   * never happened and mail somebody about it.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const actorUserId: ObjectID | undefined = onUpdate.updateBy.props.userId;

    if (!actorUserId) {
      return onUpdate;
    }

    const affectedRules: Array<Model> =
      (onUpdate.carryForward?.affectedRules as Array<Model> | undefined) || [];

    const updatedIds: Set<string> = new Set<string>(
      updatedItemIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    );

    await this.reportAdministrativeChange({
      action: AuditLogAction.Update,
      actorUserId: actorUserId,
      rules: affectedRules.filter((rule: Model): boolean => {
        return Boolean(rule.id && updatedIds.has(rule.id.toString()));
      }),
      updatedFields: onUpdate.updateBy.data as unknown as JSONObject,
      props: onUpdate.updateBy.props,
    });

    return onUpdate;
  }

  /**
   * R6, factored out because create, update and delete all owe the same debt.
   *
   * One audit entry per ROW, because that is what an investigator reconstructs
   * a timeline from, and at most one mail per PERSON, because one request that
   * touches twenty of somebody's rules is still one thing that happened to
   * them.
   *
   * Rules the actor owns are skipped: configuring your own paging is not an
   * administrative act and does not need announcing to yourself.
   */
  private async reportAdministrativeChange(data: {
    action: AuditLogAction;
    actorUserId: ObjectID;
    rules: Array<Model>;
    updatedFields?: JSONObject | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const notifiedOwnerIds: Set<string> = new Set<string>();

    for (const rule of data.rules) {
      const ruleOwnerUserId: ObjectID | undefined = rule.userId;

      if (
        !ruleOwnerUserId ||
        ruleOwnerUserId.toString() === data.actorUserId.toString()
      ) {
        continue;
      }

      const ownerKey: string = ruleOwnerUserId.toString();
      const isFirstRuleForThisOwner: boolean = !notifiedOwnerIds.has(ownerKey);
      notifiedOwnerIds.add(ownerKey);

      await UserNotificationRuleAdminService.recordAdminRuleChange({
        action: data.action,
        actorUserId: data.actorUserId,
        ownerUserId: ruleOwnerUserId,
        projectId: rule.projectId || data.props.tenantId,
        ruleId: rule.id,
        before: rule,
        updatedFields: data.updatedFields,
        notifyOwner: isFirstRuleForThisOwner,
        props: data.props,
      });
    }
  }

  /**
   * The delete-path guard, and the reason it is a guard at all.
   *
   * Deleting somebody's notification rules is the most destructive of the three
   * write verbs and, until this hook existed, the only unguarded one: the model
   * opened `delete` to the administrative permissions, and nothing here noticed.
   * An admin — or anyone who had got hold of an admin session — could remove a
   * responder's entire paging configuration and leave no record and no warning.
   * The person it happened to would find out during an incident.
   *
   * What a delete guard can and cannot be. There is no R3 analogue: a deleted
   * row routes nothing anywhere, so there is no method-versus-owner pair left to
   * disagree. Nor is there an R1 analogue: refusing to delete the rules of
   * somebody who is no longer on the roster would block exactly the cleanup an
   * admin performs after a member leaves. What is left, and what actually
   * matters, is EVIDENTIARY — establish from the database who owned these rows
   * before they cease to exist, because after the write nothing can answer that
   * question and the request body was never allowed to.
   *
   * The rows must be read here rather than in onDeleteSuccess for the same
   * reason: _deleteBy hands the success hook only the ids it deleted, and by
   * then the rows are gone.
   *
   * The query is narrowed first. onBeforeDelete runs BEFORE
   * ModelPermission.checkDeleteQueryPermission, exactly as onBeforeUpdate runs
   * before its update counterpart, so the raw query carries neither the tenant
   * predicate nor the ownership predicate — see narrowQueryToCallerEntitlement.
   * Without it, a member could point this read at another project's rules and
   * have their owners written into the audit trail and mailed a warning about a
   * deletion that never touched them.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    if (!deleteBy.props.userId) {
      /*
       * No actor, nothing to attribute. Workers and migrations delete rules
       * (project teardown, method removal cascades) and an "an administrator
       * deleted your rules" mail for every one of those is how the message
       * that matters gets filtered away.
       */
      return {
        deleteBy,
        carryForward: null,
      };
    }

    const deletedRules: Array<Model> = await this.findBy({
      query: this.narrowQueryToCallerEntitlement(
        deleteBy.query,
        deleteBy.props,
        DatabaseRequestType.Delete,
      ),
      select: {
        _id: true,
        userId: true,
        projectId: true,
        ruleType: true,
        notifyAfterMinutes: true,
        isOptOut: true,
        incidentSeverityId: true,
        alertSeverityId: true,
        userEmailId: true,
        userSmsId: true,
        userCallId: true,
        userWhatsAppId: true,
        userTelegramId: true,
        userPushId: true,
        userWebhookId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    return {
      deleteBy,
      carryForward: {
        deletedRules: deletedRules,
      },
    };
  }

  /*
   * R6 for the delete path.
   *
   * Keyed the same way as the other two: the actor the SERVER resolved against
   * the owner the DATABASE recorded, read before the rows were removed. The
   * snapshot carried forward is now the only description of what those rules
   * were, so it is what the audit entry is built from.
   */
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    deletedItemIds: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const actorUserId: ObjectID | undefined = onDelete.deleteBy.props.userId;

    if (!actorUserId) {
      return onDelete;
    }

    const deletedRules: Array<Model> =
      (onDelete.carryForward?.deletedRules as Array<Model> | undefined) || [];

    const deletedIds: Set<string> = new Set<string>(
      deletedItemIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    );

    await this.reportAdministrativeChange({
      action: AuditLogAction.Delete,
      actorUserId: actorUserId,
      /*
       * Only rows the delete actually removed. The hook read every row the
       * narrowed query matched; _deleteBy then applied the caller's own
       * skip/limit on top, so the two sets are not always the same and a
       * warning about a rule that still exists is a false alarm.
       */
      rules: deletedRules.filter((rule: Model): boolean => {
        return Boolean(rule.id && deletedIds.has(rule.id.toString()));
      }),
      props: onDelete.deleteBy.props,
    });

    return onDelete;
  }

  @CaptureSpan()
  public async addDefaultNotificationRulesForVerifiedMethod(data: {
    projectId: ObjectID;
    userId: ObjectID;
    notificationMethod: NotificationMethodDescriptor;
  }): Promise<void> {
    const { projectId, userId, notificationMethod } = data;

    /*
     * Read each severity list once and reuse it for both rule types it drives.
     * Incident severities scope both ON_CALL_EXECUTED_INCIDENT and
     * ON_CALL_EXECUTED_INCIDENT_EPISODE; alert severities do the same for their
     * two.
     */
    const incidentSeverityIds: Array<ObjectID> =
      await this.getIncidentSeverityIds(projectId);
    const alertSeverityIds: Array<ObjectID> =
      await this.getAlertSeverityIds(projectId);

    await this.createSeverityScopedRules({
      projectId,
      userId,
      notificationMethod,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      severityIds: incidentSeverityIds,
      severityColumn: "incidentSeverityId",
    });

    await this.createSeverityScopedRules({
      projectId,
      userId,
      notificationMethod,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
      severityIds: alertSeverityIds,
      severityColumn: "alertSeverityId",
    });

    /*
     * The two episode rule types are severity-scoped as well, and used not to
     * be. UserOnCallLogService counts episode rules filtered by a concrete
     * severity id, and the episode rule pages in User Settings scope their
     * tables the same way — so a NULL-severity episode rule matched no page and
     * appeared in no table. Users got "defaults" that were unreachable and
     * invisible at the same time.
     */
    await this.createSeverityScopedRules({
      projectId,
      userId,
      notificationMethod,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
      severityIds: alertSeverityIds,
      severityColumn: "alertSeverityId",
    });

    await this.createSeverityScopedRules({
      projectId,
      userId,
      notificationMethod,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
      severityIds: incidentSeverityIds,
      severityColumn: "incidentSeverityId",
    });

    /*
     * These two are about the user's shift, not about anything that fired, so
     * they legitimately have no severity and stay single rules.
     */
    await this.createSingleRule(
      projectId,
      userId,
      notificationMethod,
      NotificationRuleType.WHEN_USER_GOES_ON_CALL,
    );
    await this.createSingleRule(
      projectId,
      userId,
      notificationMethod,
      NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
    );
  }

  private applyNotificationMethod(
    rule: Model,
    descriptor: NotificationMethodDescriptor,
  ): void {
    if (descriptor.userEmailId) {
      rule.userEmailId = descriptor.userEmailId;
    }
    if (descriptor.userSmsId) {
      rule.userSmsId = descriptor.userSmsId;
    }
    if (descriptor.userCallId) {
      rule.userCallId = descriptor.userCallId;
    }
    if (descriptor.userWhatsAppId) {
      rule.userWhatsAppId = descriptor.userWhatsAppId;
    }
    if (descriptor.userTelegramId) {
      rule.userTelegramId = descriptor.userTelegramId;
    }
    if (descriptor.userWebhookId) {
      rule.userWebhookId = descriptor.userWebhookId;
    }
    if (descriptor.userPushId) {
      rule.userPushId = descriptor.userPushId;
    }
  }

  private getNotificationMethodQuery(
    descriptor: NotificationMethodDescriptor,
  ): Record<string, ObjectID> {
    const query: Record<string, ObjectID> = {};
    if (descriptor.userEmailId) {
      query["userEmailId"] = descriptor.userEmailId;
    }
    if (descriptor.userSmsId) {
      query["userSmsId"] = descriptor.userSmsId;
    }
    if (descriptor.userCallId) {
      query["userCallId"] = descriptor.userCallId;
    }
    if (descriptor.userWhatsAppId) {
      query["userWhatsAppId"] = descriptor.userWhatsAppId;
    }
    if (descriptor.userTelegramId) {
      query["userTelegramId"] = descriptor.userTelegramId;
    }
    if (descriptor.userWebhookId) {
      query["userWebhookId"] = descriptor.userWebhookId;
    }
    if (descriptor.userPushId) {
      query["userPushId"] = descriptor.userPushId;
    }
    return query;
  }

  private async getIncidentSeverityIds(
    projectId: ObjectID,
  ): Promise<Array<ObjectID>> {
    const incidentSeverities: Array<IncidentSeverity> =
      await IncidentSeverityService.findBy({
        query: {
          projectId,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
        },
      });

    return incidentSeverities.map((severity: IncidentSeverity): ObjectID => {
      return severity.id!;
    });
  }

  private async getAlertSeverityIds(
    projectId: ObjectID,
  ): Promise<Array<ObjectID>> {
    const alertSeverities: Array<AlertSeverity> =
      await AlertSeverityService.findBy({
        query: {
          projectId,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
        },
      });

    return alertSeverities.map((severity: AlertSeverity): ObjectID => {
      return severity.id!;
    });
  }

  /*
   * Seed one rule per severity for a severity-scoped rule type, skipping any
   * (method, severity, ruleType) triple the user already has. The duplicate
   * check is keyed on the same columns the write sets, so re-verifying a method
   * never doubles a user's rules — and therefore never doubles their pages.
   */
  private async createSeverityScopedRules(data: {
    projectId: ObjectID;
    userId: ObjectID;
    notificationMethod: NotificationMethodDescriptor;
    ruleType: NotificationRuleType;
    severityIds: Array<ObjectID>;
    severityColumn: "incidentSeverityId" | "alertSeverityId";
  }): Promise<void> {
    for (const severityId of data.severityIds) {
      const existingRule: Model | null = await this.findOneBy({
        query: {
          projectId: data.projectId,
          userId: data.userId,
          ...this.getNotificationMethodQuery(data.notificationMethod),
          [data.severityColumn]: severityId,
          ruleType: data.ruleType,
        } as any,
        props: {
          isRoot: true,
        },
      });

      if (existingRule) {
        continue;
      }

      const rule: Model = new Model();
      rule.projectId = data.projectId;
      rule.userId = data.userId;
      this.applyNotificationMethod(rule, data.notificationMethod);
      rule[data.severityColumn] = severityId;
      rule.notifyAfterMinutes = 0;
      rule.ruleType = data.ruleType;

      await this.create({
        data: rule,
        props: {
          isRoot: true,
        },
      });
    }
  }

  private async createSingleRule(
    projectId: ObjectID,
    userId: ObjectID,
    notificationMethod: NotificationMethodDescriptor,
    ruleType: NotificationRuleType,
  ): Promise<void> {
    const existingRule: Model | null = await this.findOneBy({
      query: {
        projectId,
        userId,
        ...this.getNotificationMethodQuery(notificationMethod),
        ruleType,
      } as any,
      props: {
        isRoot: true,
      },
    });

    if (existingRule) {
      return;
    }

    const rule: Model = new Model();
    rule.projectId = projectId;
    rule.userId = userId;
    this.applyNotificationMethod(rule, notificationMethod);
    rule.notifyAfterMinutes = 0;
    rule.ruleType = ruleType;

    await this.create({
      data: rule,
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async addDefaultNotificationRuleForUser(
    projectId: ObjectID,
    userId: ObjectID,
    email: Email,
  ): Promise<void> {
    let userEmail: UserEmail | null = await UserEmailService.findOneBy({
      query: {
        projectId,
        userId,
        email,
      },
      props: {
        isRoot: true,
      },
    });

    if (!userEmail) {
      userEmail = new UserEmail();
      userEmail.projectId = projectId;
      userEmail.userId = userId;
      userEmail.email = email;
      userEmail.isVerified = true;

      userEmail = await UserEmailService.create({
        data: userEmail,
        props: {
          isRoot: true,
        },
      });
    }

    await this.addDefaultNotificationRulesForVerifiedMethod({
      projectId,
      userId,
      notificationMethod: {
        userEmailId: userEmail.id!,
      },
    });
  }

  /**
   * What this user would lose by deleting these notification rules.
   *
   * Ask this BEFORE deleting. It reads and returns; it writes nothing and
   * refuses nothing, and the caller is expected to go ahead and delete anyway
   * if that is what the human wants after reading it.
   *
   * The rule ids are INTERSECTED with the rules this user actually has in this
   * project rather than trusted — the read is scoped by (projectId, userId) in
   * the query itself, so an id belonging to somebody else, or to another
   * project, simply matches nothing and contributes nothing to the answer.
   * That is the only place row scoping can come from: a column access list
   * cannot restrict WHICH ROWS a caller sees, because Permission.CurrentUser is
   * auto-granted to every authenticated caller and so never means "only my own
   * row".
   *
   * An empty id list is legal and returns a zero-deletion impact, which is
   * still worth something: it carries this user's responder status, their
   * reachability and whether the project's fallback is on.
   *
   * ---------------------------------------------------------------------------
   * NOT WIRED TODAY. READ THIS BEFORE ASSUMING IT GUARDS ANYTHING.
   *
   * This method and getNotificationMethodDeletionImpact below have NO production
   * caller. The delete guard that actually ships is client-side, in
   * App/FeatureSet/Dashboard/src/Components/NotificationMethods/NotificationMethod.tsx
   * (useNotificationMethodDeleteGuard + DeletionImpactModal), and it computes the
   * same answer in the browser from the deleting user's OWN rules.
   *
   * That is adequate for the case that ships: a person deleting their own
   * notification method or their own rule can read all of their own rules, and
   * one user's rule set is small and bounded. It is NOT adequate for an
   * administrator computing the impact of deleting somebody ELSE's
   * configuration, which is what this exists for - and that is Phase 3, which is
   * not merged.
   *
   * So this is deliberately-retained, currently-unreachable code, kept because
   * the admin path needs exactly it and because it holds one thing the browser
   * copy cannot: it reads EVERY rule for the user rather than a page, and it
   * derives a rule's severity from the column its RULE TYPE dictates rather than
   * whichever column happens to be populated.
   *
   * Retaining unreachable code is a real cost and this comment is the price of
   * it: nothing here enforces anything server-side today. A deletion is not
   * validated, refused or even observed by this service. If you are reading this
   * because you assumed the server checked, it does not.
   * ---------------------------------------------------------------------------
   */
  @CaptureSpan()
  public async getRuleDeletionImpact(data: {
    projectId: ObjectID;
    userId: ObjectID;
    notificationRuleIds: Array<ObjectID>;
  }): Promise<NotificationDeletionImpact> {
    const targetRuleIds: Set<string> = new Set<string>(
      data.notificationRuleIds.map((ruleId: ObjectID): string => {
        return ruleId.toString();
      }),
    );

    return this.computeDeletionImpact({
      projectId: data.projectId,
      userId: data.userId,
      isBeingDeleted: (rule: Model): boolean => {
        return targetRuleIds.has(rule.id?.toString() || "");
      },
      deletedMethod: undefined,
    });
  }

  /**
   * What this user would lose by deleting one notification method.
   *
   * This is the dangerous one. Deleting a method is not a small write: every
   * method foreign key on UserNotificationRule is onDelete: "CASCADE", and each
   * method service deletes the same rows itself in onBeforeDelete, so removing
   * one phone number takes every rule that pointed at it with it. Somebody
   * tidying up an old number has no reason to expect that, and nothing on the
   * screen tells them.
   *
   * The method row is looked up scoped by projectId, and the userId comes from
   * the ROW rather than from the caller. Both matter: the projectId scope is
   * what stops a caller probing method ids from other projects, and taking the
   * userId from the row is what stops a caller asking for one user's method
   * under another user's name and getting an answer that belongs to neither.
   */
  @CaptureSpan()
  public async getNotificationMethodDeletionImpact(data: {
    projectId: ObjectID;
    methodType: ReadinessMethodType;
    methodId: ObjectID;
  }): Promise<NotificationDeletionImpact> {
    const method: DeletedNotificationMethod =
      await this.resolveNotificationMethod(data);

    return this.computeDeletionImpact({
      projectId: data.projectId,
      userId: method.userId,
      isBeingDeleted: (rule: Model): boolean => {
        return (
          this.getRuleMethodId(rule, data.methodType)?.toString() ===
          data.methodId.toString()
        );
      },
      deletedMethod: method,
    });
  }

  /**
   * Read the method row being deleted, scoped to the project, and reduce it to
   * the three things the preview needs: whose it is, which channel it is on,
   * and whether it was ever verified.
   *
   * Webhooks report isVerified: true with no column behind it. UserWebhook has
   * no verification concept at all — its presence IS the whole test, which is
   * how the fallback treats it and how readiness reports it — so calling it
   * unverified here would tell somebody that deleting the one channel
   * guaranteed to work costs them nothing.
   */
  private async resolveNotificationMethod(data: {
    projectId: ObjectID;
    methodType: ReadinessMethodType;
    methodId: ObjectID;
  }): Promise<DeletedNotificationMethod> {
    const query: {
      _id: ObjectID;
      projectId: ObjectID;
    } = {
      _id: data.methodId,
      projectId: data.projectId,
    };

    const props: { isRoot: boolean } = {
      isRoot: true,
    };

    type ResolvedRow = {
      userId?: ObjectID | undefined;
      isVerified?: boolean | undefined;
    } | null;

    let row: ResolvedRow = null;
    let isVerified: boolean = false;

    if (data.methodType === ReadinessMethodType.Email) {
      row = await UserEmailService.findOneBy({
        query: query,
        select: { _id: true, userId: true, isVerified: true },
        props: props,
      });
      isVerified = Boolean(row?.isVerified);
    } else if (data.methodType === ReadinessMethodType.SMS) {
      row = await UserSmsService.findOneBy({
        query: query,
        select: { _id: true, userId: true, isVerified: true },
        props: props,
      });
      isVerified = Boolean(row?.isVerified);
    } else if (data.methodType === ReadinessMethodType.Call) {
      row = await UserCallService.findOneBy({
        query: query,
        select: { _id: true, userId: true, isVerified: true },
        props: props,
      });
      isVerified = Boolean(row?.isVerified);
    } else if (data.methodType === ReadinessMethodType.Push) {
      row = await UserPushService.findOneBy({
        query: query,
        select: { _id: true, userId: true, isVerified: true },
        props: props,
      });
      isVerified = Boolean(row?.isVerified);
    } else if (data.methodType === ReadinessMethodType.WhatsApp) {
      row = await UserWhatsAppService.findOneBy({
        query: query,
        select: { _id: true, userId: true, isVerified: true },
        props: props,
      });
      isVerified = Boolean(row?.isVerified);
    } else if (data.methodType === ReadinessMethodType.Telegram) {
      row = await UserTelegramService.findOneBy({
        query: query,
        select: { _id: true, userId: true, isVerified: true },
        props: props,
      });
      isVerified = Boolean(row?.isVerified);
    } else if (data.methodType === ReadinessMethodType.Webhook) {
      row = await UserWebhookService.findOneBy({
        query: query,
        select: { _id: true, userId: true },
        props: props,
      });
      isVerified = Boolean(row);
    } else {
      throw new BadDataException(
        `${data.methodType} is not a notification method`,
      );
    }

    if (!row || !row.userId) {
      throw new BadDataException("Notification method not found");
    }

    return {
      methodType: data.methodType,
      userId: row.userId,
      isVerified: isVerified,
    };
  }

  /**
   * The foreign key a rule uses to point at a method of this channel. One
   * lookup table rather than seven inline comparisons, so a rule can never be
   * tested against the wrong column — which would report a WhatsApp rule as
   * surviving the deletion of the SMS number it does not use, or worse, the
   * reverse.
   */
  private getRuleMethodId(
    rule: Model,
    methodType: ReadinessMethodType,
  ): ObjectID | undefined {
    if (methodType === ReadinessMethodType.Email) {
      return rule.userEmailId;
    }

    if (methodType === ReadinessMethodType.SMS) {
      return rule.userSmsId;
    }

    if (methodType === ReadinessMethodType.Call) {
      return rule.userCallId;
    }

    if (methodType === ReadinessMethodType.Push) {
      return rule.userPushId;
    }

    if (methodType === ReadinessMethodType.WhatsApp) {
      return rule.userWhatsAppId;
    }

    if (methodType === ReadinessMethodType.Telegram) {
      return rule.userTelegramId;
    }

    if (methodType === ReadinessMethodType.Webhook) {
      return rule.userWebhookId;
    }

    return undefined;
  }

  /**
   * The before/after picture both entry points share.
   *
   * Deliberately shaped as "read every rule this user has, then ask a predicate
   * which of them go" rather than "count the rules that go". Coverage is a
   * property of what is LEFT, so the rules that survive are as load-bearing as
   * the ones that do not: a cell with two rules on two methods loses nothing
   * when one of them goes, and the only way to know that is to have read both.
   */
  private async computeDeletionImpact(data: {
    projectId: ObjectID;
    userId: ObjectID;
    isBeingDeleted: (rule: Model) => boolean;
    deletedMethod: DeletedNotificationMethod | undefined;
  }): Promise<NotificationDeletionImpact> {
    const cellStates: Map<string, DeletionCellState> = new Map<
      string,
      DeletionCellState
    >();
    const handoffStates: Map<NotificationRuleType, DeletionHandoffState> =
      new Map<NotificationRuleType, DeletionHandoffState>();

    let rulesDeletedCount: number = 0;

    type FoldRuleFunction = (rule: Model) => void;

    /*
     * Folded as each page arrives rather than accumulated and folded after.
     * Every rule collapses into one of a few dozen cells, so holding the rows
     * would mean carrying the whole table in memory to produce a map orders of
     * magnitude smaller — and the one project where that matters is exactly the
     * project where this read takes more than one page.
     */
    const foldRule: FoldRuleFunction = (rule: Model): void => {
      const isDeleted: boolean = data.isBeingDeleted(rule);

      if (isDeleted) {
        rulesDeletedCount++;
      }

      /*
       * `isOptOut === true`, never `=== false`. The column is nullable and was
       * added long after these rows started existing, so it is NULL on every
       * rule in every existing install; testing for false would classify all of
       * them as neither rules nor opt-outs and report a fully configured user
       * as having nothing to lose. This is the exact dual of the predicate
       * readiness folds with, and it has to stay that way.
       */
      const isOptOut: boolean = rule.isOptOut === true;

      const scope: PagingRuleTypeScope | undefined =
        PAGING_RULE_TYPE_SCOPES.find(
          (candidate: PagingRuleTypeScope): boolean => {
            return candidate.ruleType === rule.ruleType;
          },
        );

      if (scope) {
        const severityId: ObjectID | undefined = rule[scope.severityColumn];

        /*
         * A severity-scoped rule with a NULL severity matches no page at
         * runtime, so it covers no cell and losing it costs nothing. Counting
         * it would promise coverage that never existed.
         */
        if (!severityId) {
          return;
        }

        const key: string = `${scope.ruleType}|${severityId.toString()}`;

        const state: DeletionCellState = cellStates.get(key) || {
          ruleType: scope.ruleType,
          severityKind: scope.severityKind,
          severityId: severityId.toString(),
          rulesBefore: 0,
          rulesRemoved: 0,
          hasOptOut: false,
        };

        if (isOptOut) {
          /*
           * Only a SURVIVING opt-out makes the silence deliberate. Deleting the
           * opt-out along with the last rule leaves neither, and that cell is a
           * real gap however it was created.
           */
          if (!isDeleted) {
            state.hasOptOut = true;
          }
        } else {
          state.rulesBefore++;

          if (isDeleted) {
            state.rulesRemoved++;
          }
        }

        cellStates.set(key, state);

        return;
      }

      const handoffType: NotificationRuleType | undefined =
        HANDOFF_RULE_TYPES.find((candidate: NotificationRuleType): boolean => {
          return candidate === rule.ruleType;
        });

      if (!handoffType) {
        // Not a rule type anything pages on. It covers nothing, so it loses nothing.
        return;
      }

      const handoffState: DeletionHandoffState = handoffStates.get(
        handoffType,
      ) || {
        rulesBefore: 0,
        rulesRemoved: 0,
        hasOptOut: false,
      };

      if (isOptOut) {
        if (!isDeleted) {
          handoffState.hasOptOut = true;
        }
      } else {
        handoffState.rulesBefore++;

        if (isDeleted) {
          handoffState.rulesRemoved++;
        }
      }

      handoffStates.set(handoffType, handoffState);
    };

    const isTruncated: boolean = await this.readEveryNotificationRuleForUser({
      projectId: data.projectId,
      userId: data.userId,
      consume: (rows: Array<Model>): void => {
        for (const rule of rows) {
          foldRule(rule);
        }
      },
    });

    const lostCells: Array<DeletionCellState> = Array.from(
      cellStates.values(),
    ).filter((state: DeletionCellState): boolean => {
      return (
        state.rulesBefore > 0 &&
        state.rulesRemoved === state.rulesBefore &&
        !state.hasOptOut
      );
    });

    const handoffNotificationsLost: Array<NotificationRuleType> =
      HANDOFF_RULE_TYPES.filter((ruleType: NotificationRuleType): boolean => {
        const state: DeletionHandoffState | undefined =
          handoffStates.get(ruleType);

        return Boolean(
          state &&
            state.rulesBefore > 0 &&
            state.rulesRemoved === state.rulesBefore &&
            !state.hasOptOut,
        );
      });

    /*
     * Severity names are read only when something was actually lost. The common
     * case for this call is "nothing you care about goes", and that case should
     * not cost two extra round trips to name cells nobody will be shown.
     */
    const severityNames: Map<string, DeletionSeverityRef> =
      await this.loadSeverityNamesForCells(data.projectId, lostCells);

    const coverageLost: Array<CoverageLossCell> = this.buildCoverageLossCells(
      lostCells,
      severityNames,
    );

    /*
     * "Is this person on call anywhere" comes from OnCallReadinessService and
     * from nowhere else. getReadinessForUsers rather than getReadinessForUser
     * because the plural form OMITS a user who is not a member of the project
     * instead of throwing for them: somebody being removed from a project is
     * one of the perfectly legitimate reasons their methods are being deleted,
     * and that must produce an honest "unknown" rather than an exception in
     * front of an admin doing housekeeping.
     */
    const readinessList: Array<UserReadiness> =
      await OnCallReadinessService.getReadinessForUsers(
        [data.userId],
        data.projectId,
      );

    const readiness: UserReadiness | undefined = readinessList[0];

    const verifiedMethods: Array<ReadinessMethod> = (
      readiness?.methods || []
    ).filter((method: ReadinessMethod): boolean => {
      return method.isVerified;
    });

    const remainingVerifiedMethods: Array<ReadinessMethod> = [
      ...verifiedMethods,
    ];

    if (data.deletedMethod && data.deletedMethod.isVerified) {
      /*
       * Readiness returns one entry per method ROW, and the row being deleted is
       * identified by its CHANNEL rather than by its id. Removing exactly ONE
       * entry of that channel is what makes the count right for a user with two
       * verified SMS numbers who is deleting one of them: the other survives,
       * and so does the entry.
       *
       * ReadinessMethod does now carry methodId, so an exact match is available;
       * matching on the channel is kept because it is equivalent HERE and not
       * because the id is missing. The only consumer of this list is
       * resolveReachability, which reads its LENGTH and its methodTypes and
       * nothing else, so which of two same-channel entries is dropped cannot
       * change the answer. Anything added below that cares about a specific row
       * must match on methodId instead — this equivalence is a property of the
       * current consumer, not a licence.
       */
      const index: number = remainingVerifiedMethods.findIndex(
        (method: ReadinessMethod): boolean => {
          return method.methodType === data.deletedMethod?.methodType;
        },
      );

      if (index >= 0) {
        remainingVerifiedMethods.splice(index, 1);
      }
    }

    const reachability: PostDeletionReachability = this.resolveReachability(
      readiness,
      remainingVerifiedMethods,
    );

    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: {
        _id: true,
        disableOnCallNotificationFallback: true,
      },
      props: {
        isRoot: true,
      },
    });

    /*
     * Read exactly as readiness reads it, including what a missing project row
     * means. Agreeing with the readiness page matters more here than picking
     * the louder default independently would: two surfaces that disagree about
     * whether pages are dropped teach people to trust neither.
     */
    const isFallbackEnabled: boolean =
      !project?.disableOnCallNotificationFallback;

    return {
      projectId: data.projectId,
      userId: data.userId,
      isOnCallResponder: Boolean(readiness && readiness.reachedVia.length > 0),
      reachedVia: readiness?.reachedVia || [],
      rulesDeletedCount: rulesDeletedCount,
      coverageLost: coverageLost,
      handoffNotificationsLost: handoffNotificationsLost,
      reachability: reachability,
      verifiedMethodCountAfterDeletion: remainingVerifiedMethods.length,
      isFallbackEnabled: isFallbackEnabled,
      isTruncated: isTruncated,
      warnings: this.buildDeletionWarnings({
        deletedMethod: data.deletedMethod,
        rulesDeletedCount: rulesDeletedCount,
        readiness: readiness,
        reachability: reachability,
        remainingVerifiedMethods: remainingVerifiedMethods,
        coverageLost: coverageLost,
        handoffNotificationsLost: handoffNotificationsLost,
        isFallbackEnabled: isFallbackEnabled,
        isTruncated: isTruncated,
      }),
    };
  }

  /**
   * Every notification rule this user has in this project, one page at a time.
   *
   * Returns whether the read was TRUNCATED rather than throwing or silently
   * stopping. A truncated read here is not symmetric in its consequences:
   * unread rules that would have survived make this over-warn, which costs a
   * moment of an admin's attention, while unread rules that would have been
   * DELETED make it under-warn, which is the whole failure this feature exists
   * to prevent. Either way the caller is told.
   *
   * The sort is `_id` ascending because OFFSET paging over a query with no
   * total order can return one row twice and skip another — and the default
   * sort would be `createdAt DESC`, which is emphatically not unique for a
   * user whose default rules were all written in one transaction.
   */
  private async readEveryNotificationRuleForUser(data: {
    projectId: ObjectID;
    userId: ObjectID;
    consume: (rules: Array<Model>) => void;
  }): Promise<boolean> {
    let skip: number = 0;

    for (let page: number = 0; page < MAX_DELETION_IMPACT_PAGES; page++) {
      const rows: Array<Model> = await this.findBy({
        query: {
          projectId: data.projectId,
          userId: data.userId,
        },
        select: {
          _id: true,
          ruleType: true,
          incidentSeverityId: true,
          alertSeverityId: true,
          isOptOut: true,
          userEmailId: true,
          userSmsId: true,
          userCallId: true,
          userPushId: true,
          userWhatsAppId: true,
          userTelegramId: true,
          userWebhookId: true,
        },
        sort: {
          _id: SortOrder.Ascending,
        } as Sort<Model>,
        limit: DELETION_IMPACT_PAGE_SIZE,
        skip: skip,
        props: {
          isRoot: true,
        },
      });

      data.consume(rows);

      if (rows.length < DELETION_IMPACT_PAGE_SIZE) {
        return false;
      }

      skip += rows.length;
    }

    logger.error(
      `UserNotificationRuleService stopped reading notification rules for user ${data.userId.toString()} in project ${data.projectId.toString()} after ${MAX_DELETION_IMPACT_PAGES} pages of ${DELETION_IMPACT_PAGE_SIZE} rows. The deletion impact for this user is INCOMPLETE and may understate what the deletion removes.`,
    );

    return true;
  }

  /**
   * Display names for the severities of the cells that are actually lost, in
   * the project's own severity order.
   *
   * Not paged, unlike the rule read: severity lists are a handful of rows per
   * project by construction (they are a UI-managed enumeration, not user data),
   * and LIMIT_PER_PROJECT is three orders of magnitude past any of them.
   */
  private async loadSeverityNamesForCells(
    projectId: ObjectID,
    lostCells: Array<DeletionCellState>,
  ): Promise<Map<string, DeletionSeverityRef>> {
    const severityNames: Map<string, DeletionSeverityRef> = new Map<
      string,
      DeletionSeverityRef
    >();

    const needsIncident: boolean = lostCells.some(
      (cell: DeletionCellState): boolean => {
        return cell.severityKind === SeverityKind.Incident;
      },
    );

    const needsAlert: boolean = lostCells.some(
      (cell: DeletionCellState): boolean => {
        return cell.severityKind === SeverityKind.Alert;
      },
    );

    if (needsIncident) {
      const incidentSeverities: Array<IncidentSeverity> =
        await IncidentSeverityService.findBy({
          query: {
            projectId: projectId,
          },
          select: {
            _id: true,
            name: true,
          },
          sort: {
            order: SortOrder.Ascending,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

      incidentSeverities.forEach(
        (severity: IncidentSeverity, index: number): void => {
          if (!severity.id) {
            return;
          }

          severityNames.set(
            this.severityNameKey(SeverityKind.Incident, severity.id.toString()),
            {
              name: severity.name || "Unnamed Severity",
              rank: index,
            },
          );
        },
      );
    }

    if (needsAlert) {
      const alertSeverities: Array<AlertSeverity> =
        await AlertSeverityService.findBy({
          query: {
            projectId: projectId,
          },
          select: {
            _id: true,
            name: true,
          },
          sort: {
            order: SortOrder.Ascending,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

      alertSeverities.forEach(
        (severity: AlertSeverity, index: number): void => {
          if (!severity.id) {
            return;
          }

          severityNames.set(
            this.severityNameKey(SeverityKind.Alert, severity.id.toString()),
            {
              name: severity.name || "Unnamed Severity",
              rank: index,
            },
          );
        },
      );
    }

    return severityNames;
  }

  private severityNameKey(kind: SeverityKind, severityId: string): string {
    /*
     * Keyed by KIND as well as by id. Incident and alert severities are
     * different tables with independently generated ids, and a map keyed on the
     * id alone would let one name a cell of the other kind if the two ever
     * collided — a one-in-a-uuid event that would be indistinguishable from a
     * mislabelled warning if it happened.
     */
    return `${kind}|${severityId}`;
  }

  private buildCoverageLossCells(
    lostCells: Array<DeletionCellState>,
    severityNames: Map<string, DeletionSeverityRef>,
  ): Array<CoverageLossCell> {
    const ordered: Array<DeletionCellState> = [...lostCells].sort(
      (a: DeletionCellState, b: DeletionCellState): number => {
        const ruleTypeDifference: number =
          this.pagingRuleTypeRank(a.ruleType) -
          this.pagingRuleTypeRank(b.ruleType);

        if (ruleTypeDifference !== 0) {
          return ruleTypeDifference;
        }

        /*
         * Severity order, not alphabetical. "Sev1, Sev2, Sev3" happens to sort
         * both ways; "Critical, High, Low" does not, and a warning that lists
         * severities in an order the user has never seen them in reads as a
         * different set of severities.
         */
        return (
          this.severityRank(a, severityNames) -
          this.severityRank(b, severityNames)
        );
      },
    );

    return ordered.map((cell: DeletionCellState): CoverageLossCell => {
      const ref: DeletionSeverityRef | undefined = severityNames.get(
        this.severityNameKey(cell.severityKind, cell.severityId),
      );

      return {
        ruleType: cell.ruleType,
        severityId: new ObjectID(cell.severityId),
        severityName: ref?.name,
        rulesRemoved: cell.rulesRemoved,
      };
    });
  }

  private pagingRuleTypeRank(ruleType: NotificationRuleType): number {
    const index: number = PAGING_RULE_TYPE_SCOPES.findIndex(
      (scope: PagingRuleTypeScope): boolean => {
        return scope.ruleType === ruleType;
      },
    );

    return index < 0 ? PAGING_RULE_TYPE_SCOPES.length : index;
  }

  private severityRank(
    cell: DeletionCellState,
    severityNames: Map<string, DeletionSeverityRef>,
  ): number {
    const ref: DeletionSeverityRef | undefined = severityNames.get(
      this.severityNameKey(cell.severityKind, cell.severityId),
    );

    /*
     * A severity we could not name sorts last rather than first. It is the one
     * entry whose sentence will read "this severity", and burying it under the
     * ones that read properly costs nothing; leading with it looks like a bug.
     */
    return ref ? ref.rank : Number.MAX_SAFE_INTEGER;
  }

  private resolveReachability(
    readiness: UserReadiness | undefined,
    remainingVerifiedMethods: Array<ReadinessMethod>,
  ): PostDeletionReachability {
    if (!readiness) {
      return PostDeletionReachability.Unknown;
    }

    /*
     * Checked first, and it is not merely a nicety of wording. Readiness says
     * NotReachable when the user has no USABLE method — which includes the case
     * where every verified method they own is on a channel the project has
     * switched off — so this branch is also what keeps the branches below from
     * promising "still reachable" on the strength of a verified method that
     * nothing can send on.
     */
    if (readiness.status === ReadinessStatus.NotReachable) {
      return PostDeletionReachability.AlreadyNotReachable;
    }

    if (remainingVerifiedMethods.length === 0) {
      return PostDeletionReachability.NotReachable;
    }

    const unswitchableChannels: Array<string> = channelsWithNoProjectSwitch();

    const hasUnswitchableChannel: boolean = remainingVerifiedMethods.some(
      (method: ReadinessMethod): boolean => {
        return unswitchableChannels.includes(method.methodType);
      },
    );

    if (hasUnswitchableChannel) {
      return PostDeletionReachability.Reachable;
    }

    return PostDeletionReachability.DependsOnProjectSettings;
  }

  /**
   * The sentences a human reads in the confirmation dialog, most consequential
   * first.
   *
   * Every line names a specific thing that is lost AND what happens because of
   * it, which is the same contract OnCallReadinessService.buildReasons keeps
   * and for the same reason: "no rule for Sev4" is a shrug, "no rule for Sev4,
   * and those pages are dropped" is a decision. Nothing here says "are you
   * sure?" — the caller owns the question, and this owns the facts it is asked
   * about.
   */
  private buildDeletionWarnings(data: {
    deletedMethod: DeletedNotificationMethod | undefined;
    rulesDeletedCount: number;
    readiness: UserReadiness | undefined;
    reachability: PostDeletionReachability;
    remainingVerifiedMethods: Array<ReadinessMethod>;
    coverageLost: Array<CoverageLossCell>;
    handoffNotificationsLost: Array<NotificationRuleType>;
    isFallbackEnabled: boolean;
    isTruncated: boolean;
  }): Array<string> {
    const warnings: Array<string> = [];

    /*
     * The cascade goes first because it is the part nobody clicked. Everything
     * below is a consequence of it, and a list that started with the
     * consequences would read as though the notification rules were being
     * deleted for no reason at all.
     */
    if (data.deletedMethod && data.rulesDeletedCount > 0) {
      warnings.push(
        `Deleting this ${data.deletedMethod.methodType} notification method also deletes ${data.rulesDeletedCount} notification ${data.rulesDeletedCount === 1 ? "rule" : "rules"} that use it - a notification rule cannot outlive the method it sends on.`,
      );
    }

    if (data.reachability === PostDeletionReachability.NotReachable) {
      warnings.push(
        "This is the last verified notification method on this account - after it there is nothing left to page this user on, and the on-call fallback has nothing to fall back to either.",
      );
    }

    if (!data.readiness) {
      warnings.push(
        "Whether this user is on call could not be determined - they may no longer be a member of this project.",
      );
    } else if (data.readiness.reachedVia.length > 0) {
      const sources: Array<string> = data.readiness.reachedVia.map(
        (source: ResponderSource): string => {
          return responderSourceProse(source);
        },
      );

      warnings.push(
        `This user is on call in this project (${sources.join(", ")}), so anything lost here is a page that does not arrive.`,
      );
    } else {
      /*
       * Said out loud rather than left as silence. "Not on call" is the one
       * answer that makes this whole dialog safe to click through, and an admin
       * who has to infer it from the absence of a warning will infer it wrongly
       * at least once.
       */
      warnings.push(
        "This user is not on any on-call policy right now, so nothing here can cost a page today - it will if they are ever added to one.",
      );
    }

    for (const scope of PAGING_RULE_TYPE_SCOPES) {
      const severityNames: Array<string> = data.coverageLost
        .filter((cell: CoverageLossCell): boolean => {
          return cell.ruleType === scope.ruleType;
        })
        .map((cell: CoverageLossCell): string => {
          return cell.severityName || "this severity";
        });

      if (severityNames.length === 0) {
        continue;
      }

      /*
       * One sentence per rule type listing its severities, not one per cell. A
       * user deleting a method that carried all their default rules would
       * otherwise be handed one line per (rule type x severity) — sixteen
       * near-identical sentences that nobody reads to the end of.
       */
      const subject: string = `After this, no rule covers ${severityNames.join(", ")} ${scope.subjectNoun}`;

      if (data.isFallbackEnabled) {
        warnings.push(
          `${subject} - those pages fall back to whatever this user has verified, which is not what they configured`,
        );
      } else {
        warnings.push(
          `${subject} - those pages are dropped, because on-call fallback is disabled for this project`,
        );
      }
    }

    if (
      data.handoffNotificationsLost.includes(
        NotificationRuleType.WHEN_USER_GOES_ON_CALL,
      )
    ) {
      warnings.push("This user will no longer be told when they go on call.");
    }

    if (
      data.handoffNotificationsLost.includes(
        NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
      )
    ) {
      warnings.push("This user will no longer be told when they go off call.");
    }

    if (data.reachability === PostDeletionReachability.AlreadyNotReachable) {
      warnings.push(
        "This user already has no usable notification method, so nothing can page them today either - this deletion is not what breaks it.",
      );
    }

    if (
      data.reachability === PostDeletionReachability.DependsOnProjectSettings
    ) {
      const channels: Array<string> = [];

      for (const method of data.remainingVerifiedMethods) {
        if (!channels.includes(method.methodType)) {
          channels.push(method.methodType);
        }
      }

      warnings.push(
        `Every verified method left on this account is on a channel the project can switch off (${channels.join(", ")}) - check On-Call > Readiness to confirm this user can still be paged.`,
      );
    }

    if (data.isTruncated) {
      warnings.push(
        "This preview is incomplete - there are more notification rules on this account than it could read, so the real loss may be larger than what is listed here.",
      );
    }

    return warnings;
  }
}
export default new Service();
