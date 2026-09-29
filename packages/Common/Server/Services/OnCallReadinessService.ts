import AlertSeverityService from "./AlertSeverityService";
import IncidentSeverityService from "./IncidentSeverityService";
import OnCallDutyPolicyEscalationRuleScheduleService from "./OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleTeamService from "./OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "./OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyScheduleLayerUserService from "./OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import OnCallDutyPolicyUserOverrideService from "./OnCallDutyPolicyUserOverrideService";
import ProjectService from "./ProjectService";
import TeamMemberService from "./TeamMemberService";
import TeamService from "./TeamService";
import UserCallService from "./UserCallService";
import UserEmailService from "./UserEmailService";
import UserNotificationRuleService from "./UserNotificationRuleService";
import UserPushService from "./UserPushService";
import UserService from "./UserService";
import UserSmsService from "./UserSmsService";
import UserTelegramService from "./UserTelegramService";
import UserSlackService from "./UserSlackService";
import UserMicrosoftTeamsService from "./UserMicrosoftTeamsService";
import UserWebhookService from "./UserWebhookService";
import UserWhatsAppService from "./UserWhatsAppService";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import FindBy from "../Types/Database/FindBy";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import Sort from "../Types/Database/Sort";
import logger from "../Utils/Logger";
import Includes from "../../Types/BaseDatabase/Includes";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import NotificationRuleType from "../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../Types/ObjectID";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRuleSchedule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicyScheduleLayerUser from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import OnCallDutyPolicyUserOverride from "../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import Project from "../../Models/DatabaseModels/Project";
import Team from "../../Models/DatabaseModels/Team";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import User from "../../Models/DatabaseModels/User";
import UserCall from "../../Models/DatabaseModels/UserCall";
import UserEmail from "../../Models/DatabaseModels/UserEmail";
import UserNotificationRule from "../../Models/DatabaseModels/UserNotificationRule";
import UserPush from "../../Models/DatabaseModels/UserPush";
import UserSMS from "../../Models/DatabaseModels/UserSMS";
import UserTelegram from "../../Models/DatabaseModels/UserTelegram";
import UserSlack from "../../Models/DatabaseModels/UserSlack";
import UserMicrosoftTeams from "../../Models/DatabaseModels/UserMicrosoftTeams";
import UserWebhook from "../../Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "../../Models/DatabaseModels/UserWhatsApp";

/*
 * "Can this responder actually be paged?" — computed, not configured.
 *
 * This is the single place that answers that question, and every readiness surface in
 * the product renders what it returns. It exists because the question was previously
 * answered by TeamComplianceService, which answered it wrongly in seven separate ways —
 * each of which is a real defect with a real missed page behind it, and each of which is
 * fixed here deliberately rather than incidentally:
 *
 *   1. It was opt-in per team and OFF by default, so the common case was no answer at
 *      all. Readiness here is always computed; there is nothing to switch on.
 *   2. It was TEAM-SCOPED. A user attached directly to an escalation rule, reached
 *      through a schedule layer, or substituted in by a user override was never checked —
 *      which is to say the three ways a responder most often gets paged were invisible.
 *      resolveResponders below is the union of all four, and the union is the point.
 *   3. It capped members and users at a bare `limit: 100`, silently truncating a large
 *      project into a comfortable lie. NOTHING here is capped: every read goes through
 *      readEveryPage, which pages until the table is exhausted. See the essay on that
 *      method for why raising the cap instead would have been the same bug with a bigger
 *      number — a responder who falls off the end of a page is reported in no count, no
 *      list and no summary, which is indistinguishable from a responder who is fine.
 *   4. It ignored `ruleType`, so a "when I go off call" rule counted as incident
 *      coverage. Coverage below is keyed on (userId, ruleType, severityId); a rule for
 *      the wrong ruleType covers nothing.
 *   5. It counted only call/SMS/email/push, so a responder whose only method was
 *      Telegram, WhatsApp or Webhook was reported non-compliant while being perfectly
 *      reachable. All seven channels count here.
 *   6. It ran one findBy per severity per user. Every read below is batched with
 *      Includes(userIds); the query count is constant in the number of responders and
 *      in the number of severities. It grows only with the number of PAGES of rows that
 *      come back, which is the unavoidable price of not truncating.
 *
 * The seventh defect was that it was read-only prose. This service does not fix that on
 * its own, but everything it returns is shaped to be acted on: `reasons` are sentences
 * naming a specific missing thing, and `coverage` is a grid an admin can fix cell by
 * cell.
 */

/**
 * Ready — every coverage cell either has a rule or is explicitly muted.
 * PartiallyReady — reachable, but at least one cell falls back.
 * NotReachable — zero USABLE notification methods; nothing will reach this person.
 */
export enum ReadinessStatus {
  Ready = "Ready",
  PartiallyReady = "PartiallyReady",
  NotReachable = "NotReachable",
}

/**
 * WHY a user is on this policy. A user reached two ways carries both sources, because
 * removing them from one attachment does not stop them being paged through the other —
 * an admin looking at an unreachable responder needs to know every door they came in by.
 */
export enum ResponderSource {
  Direct = "Direct",
  Team = "Team",
  Schedule = "Schedule",
  Override = "Override",
}

/**
 * The nine channels a page can be delivered on. These strings are the same literals the
 * fallback uses for `channelsUsed` (UserNotificationRuleService.chooseFallbackChannels),
 * deliberately: an operator reading "notified via fallback (Push, Email)" in an execution
 * log and "Push, Email" in the readiness table must not have to translate between two
 * vocabularies for the same thing.
 */
export enum ReadinessMethodType {
  Push = "Push",
  Email = "Email",
  SMS = "SMS",
  Call = "Call",
  WhatsApp = "WhatsApp",
  Telegram = "Telegram",
  Slack = "Slack",
  MicrosoftTeams = "Microsoft Teams",
  Webhook = "Webhook",
}

export interface ReadinessMethod {
  /**
   * The id of the METHOD ROW itself — UserSMS._id, UserEmail._id and so on — which is
   * exactly what UserNotificationRule.userSmsId / userEmailId / ... reference.
   *
   * It is here so that an administrator can POINT A RULE AT a method without READING that
   * method's row, which is the whole difficulty. The seven method models are scoped to
   * their owner: nobody but the owner may read a UserSMS, and that is deliberate, because
   * the columns behind it are the raw phone number, the webhook bearer url, the push
   * device token, the telegram chat id and the verification code. Widening that scope so
   * an admin could populate a dropdown was tried, and the exposure it opened could not be
   * contained; this field is what replaces it.
   *
   * A foreign key is not a secret. It is already stored in plain sight on every rule its
   * owner has created, and it addresses nothing on its own — you cannot page a uuid.
   * Carrying it alongside the mask is therefore the entire trick: the rule form renders
   * "SMS ending 4821" and submits userSmsId, and the number itself never leaves the
   * server for a caller who is not its owner.
   *
   * Which is also why NOTHING ELSE about the row belongs on this interface. Every field
   * added here is a field that ships to every administrator of the project.
   */
  methodId: ObjectID;
  methodType: string;
  /**
   * ALWAYS masked, by construction — see maskIdentifier. Never the raw value.
   */
  maskedIdentifier: string;
  isVerified: boolean;
}

export interface ReadinessCoverageCell {
  ruleType: NotificationRuleType;
  /**
   * Undefined for the two go-on/off-call rule types, which are about the user's shift
   * rather than about anything that fired and so legitimately carry no severity. This
   * service currently emits cells only for the four ON_CALL_EXECUTED_* types, all of
   * which are severity-scoped, so in practice this is always set — the optionality is
   * kept so a later surface can add handoff cells without changing the contract.
   */
  severityId?: ObjectID | undefined;
  severityName?: string | undefined;
  hasRule: boolean;
  isOptOut: boolean;
}

/**
 * One team that routes pages to a responder.
 *
 * "Routes pages to" is narrower than "is a member of", and the difference is the whole
 * point. A project team with no escalation rule attached to it does not page anybody, so
 * naming it here would let an admin filter the readiness table down to a team and read a
 * clean answer about people that team cannot actually reach. Every team named on a
 * responder is a team that (a) they belong to and (b) is attached to an escalation rule in
 * the scope being computed — which is exactly the set that makes `reachedVia` contain
 * `Team`.
 */
export interface ReadinessTeam {
  _id: ObjectID;
  name: string;
}

export interface UserReadiness {
  userId: ObjectID;
  userName: string;
  /**
   * The LOGIN email, not a notification method, and deliberately not masked: it is
   * already admin-readable everywhere a user is listed in the product, and masking it
   * here would make the readiness table the one place an admin cannot tell two people
   * called "J. Smith" apart. The notification email in `methods` IS masked — those are
   * different values with different exposure, even when they happen to be equal.
   */
  userEmail: string;
  userProfilePictureId?: ObjectID | undefined;
  status: ReadinessStatus;
  methods: Array<ReadinessMethod>;
  coverage: Array<ReadinessCoverageCell>;
  reasons: Array<string>;
  reachedVia: Array<ResponderSource>;
  /**
   * The teams that page this responder, in name order. Empty whenever `reachedVia` does
   * not contain `Team` — a responder attached directly or through a schedule is reached
   * without a team being involved, and saying otherwise would put them under a team
   * filter they are not answerable to.
   */
  teams: Array<ReadinessTeam>;
}

export interface ReadinessSummary {
  projectId: ObjectID;
  onCallDutyPolicyId?: ObjectID | undefined;
  readyCount: number;
  partiallyReadyCount: number;
  notReachableCount: number;
  /**
   * Whether a page with no matching rule falls back to the responder's verified methods,
   * or is dropped on the floor.
   *
   * On the wire because the UI has to stop promising "those pages still reach them
   * through the fallback, so nothing is dropped" for a project that has
   * `disableOnCallNotificationFallback` set. That sentence is comforting and, for such a
   * project, false — and it is shown at the exact moment an admin is deciding whether a
   * PartiallyReady responder is worth chasing. The per-user `reasons` already say it in
   * prose; this is the same fact as a boolean, so a chip or a banner can render it
   * without parsing English.
   */
  isFallbackEnabled: boolean;
  /**
   * TRUE means this summary is INCOMPLETE — at least one read behind it hit its page
   * ceiling, so responders, methods or rules may be missing from it.
   *
   * It exists because "we truncated" must never be indistinguishable from "everyone is
   * fine". A responder dropped by a truncated read appears in no count, no list and no
   * "needs attention" section; without this flag the summary would state, with total
   * confidence, that a project is healthier than it is. Every surface that renders a
   * count should say so out loud when this is set.
   */
  isTruncated: boolean;
  users: Array<UserReadiness>;
}

/*
 * The bullet used for every redaction. A single shared constant so a test can assert on
 * the mask without hard-coding a character that is easy to typo into a look-alike (there
 * are several bullet-ish code points and they are indistinguishable on screen).
 */
export const IDENTIFIER_MASK: string = "•••";

/**
 * What SHAPE an identifier has, which is all masking needs to know. Kept separate from
 * ReadinessMethodType because five of the seven channels mask identically — a phone is a
 * phone whether it rings, texts or WhatsApps — and collapsing them here means a new
 * channel cannot arrive with no masking rule at all.
 */
export enum MaskedIdentifierKind {
  Email = "Email",
  Phone = "Phone",
  Handle = "Handle",
}

export type MaskIdentifierFunction = (
  value: string | undefined | null,
  kind: MaskedIdentifierKind,
) => string;

/*
 * How many trailing digits of a phone number are revealed, and the shortest value that
 * may have them revealed. The two are deliberately different numbers: revealing the last
 * four digits of a four-digit value reveals the value, and revealing the last four of a
 * FIVE-digit value would be a mask in name only. A number has to be longer than what the
 * mask keeps for the mask to be hiding anything at all, so the floor is "more digits than
 * we reveal".
 */
const REVEALED_PHONE_DIGITS: number = 4;

/**
 * Redact an identifier down to just enough for its owner to recognise it.
 *
 * Exported as a free function, and used by this service for every single identifier it
 * emits, for two reasons. The first is that masking is the one rule in this file that
 * must never be got wrong even slightly, and a pure function of (string, kind) is
 * directly unit-testable in a way that "call the service and inspect the summary" is
 * not. The second is structural: because the ONLY way an identifier reaches a
 * ReadinessMethod is through this function, the API layer has no unmasked value
 * available to leak by accident. Bypassing the masking would require deliberately
 * writing a second query, not merely forgetting a call.
 *
 *   Email  jane@example.com  -> j•••@example.com
 *   Phone  +14155554821      -> +1 ••• ••• 4821
 *   Handle @jamesbond        -> @ja•••
 *
 * The phone rule keeps everything before the last ten digits as the country code, which
 * is a heuristic rather than a parse — national numbers are ~10 digits nearly
 * everywhere, so "+1" and "+44" both come out right, and a country whose numbering plan
 * disagrees loses a cosmetic digit and leaks nothing. Correctness here is measured in
 * what is HIDDEN, and the last four digits plus the country code is the same disclosure
 * every bank confirmation screen makes.
 */
export const maskIdentifier: MaskIdentifierFunction = (
  value: string | undefined | null,
  kind: MaskedIdentifierKind,
): string => {
  const trimmed: string = (value || "").trim();

  if (!trimmed) {
    /*
     * Nothing to mask and nothing to reveal. Returning the bare mask rather than an
     * empty string keeps the UI cell from collapsing into blank space that reads as
     * "no method" when a method demonstrably exists.
     */
    return IDENTIFIER_MASK;
  }

  if (kind === MaskedIdentifierKind.Email) {
    const atIndex: number = trimmed.lastIndexOf("@");

    /*
     * An address with no "@" is not an address. Rather than guess, fall through to the
     * handle rule, which is strictly more conservative than the email rule (it reveals
     * two characters and no domain).
     */
    if (atIndex <= 0) {
      return maskIdentifier(trimmed, MaskedIdentifierKind.Handle);
    }

    const localPart: string = trimmed.substring(0, atIndex);
    const domain: string = trimmed.substring(atIndex + 1);

    return `${localPart.substring(0, 1)}${IDENTIFIER_MASK}@${domain}`;
  }

  if (kind === MaskedIdentifierKind.Phone) {
    const digits: string = trimmed.replace(/\D/g, "");

    /*
     * Note the <=, not <. At exactly four digits the "last four" IS the whole value, so
     * the old strict comparison handed the number back in full while looking, on the
     * screen and in a code review, exactly like a mask. Anything at or below the number
     * of digits we reveal is therefore masked entirely: a value we cannot hide half of
     * is a value we do not show.
     */
    if (digits.length <= REVEALED_PHONE_DIGITS) {
      return IDENTIFIER_MASK;
    }

    const lastFour: string = digits.substring(
      digits.length - REVEALED_PHONE_DIGITS,
    );
    const countryCode: string =
      digits.length > 10 ? digits.substring(0, digits.length - 10) : "";
    const prefix: string = countryCode ? `+${countryCode} ` : "";

    return `${prefix}${IDENTIFIER_MASK} ${IDENTIFIER_MASK} ${lastFour}`;
  }

  /*
   * Handles cover Telegram handles, push device names and webhook names. Two characters
   * is enough for the owner to say "yes, that is my phone" and not enough for anyone
   * else to say whose phone it is.
   */
  const hasLeadingAt: boolean = trimmed.startsWith("@");
  const body: string = hasLeadingAt ? trimmed.substring(1) : trimmed;

  return `${hasLeadingAt ? "@" : ""}${body.substring(0, 2)}${IDENTIFIER_MASK}`;
};

/*
 * Which severity list scopes which rule type, and the noun to use when telling an admin
 * about it. Incident and incident-episode pages are severity-scoped by IncidentSeverity;
 * alert and alert-episode by AlertSeverity. Getting this pairing wrong is not a cosmetic
 * error — an alert rule matched against an incident severity id matches nothing at all,
 * which is exactly the shape of Gap G, where episode default rules were written with a
 * NULL severity and were therefore invisible and unreachable at the same time.
 */
enum SeverityKind {
  Incident = "Incident",
  Alert = "Alert",
}

interface RuleTypeScope {
  ruleType: NotificationRuleType;
  severityKind: SeverityKind;
  /** Plural noun for the reason sentence: "No rules for Sev4 incidents - ...". */
  subjectNoun: string;
}

/*
 * The four rule types a PAGE can arrive under. The two handoff types
 * (WHEN_USER_GOES_ON_CALL / WHEN_USER_GOES_OFF_CALL) are deliberately absent: they are
 * courtesy notifications about a shift change, nobody is waiting on them, and counting a
 * missing one as "not ready" would flood the amber state with users whose paging is
 * perfectly healthy. Readiness is about pages.
 */
const RULE_TYPE_SCOPES: Array<RuleTypeScope> = [
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    severityKind: SeverityKind.Incident,
    subjectNoun: "incidents",
  },
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    severityKind: SeverityKind.Incident,
    subjectNoun: "incident episodes",
  },
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    severityKind: SeverityKind.Alert,
    subjectNoun: "alerts",
  },
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    severityKind: SeverityKind.Alert,
    subjectNoun: "alert episodes",
  },
];

/*
 * Display order for `methods`, and simultaneously the order the fallback would try them
 * in. Sharing one order means the first entry in the list an admin looks at is the
 * channel a fallback page would actually arrive on.
 */
const METHOD_DISPLAY_ORDER: Array<ReadinessMethodType> = [
  ReadinessMethodType.Push,
  ReadinessMethodType.Email,
  ReadinessMethodType.Slack,
  ReadinessMethodType.MicrosoftTeams,
  ReadinessMethodType.SMS,
  ReadinessMethodType.Call,
  ReadinessMethodType.WhatsApp,
  ReadinessMethodType.Telegram,
  ReadinessMethodType.Webhook,
];

const RESPONDER_SOURCE_ORDER: Array<ResponderSource> = [
  ResponderSource.Direct,
  ResponderSource.Team,
  ResponderSource.Schedule,
  ResponderSource.Override,
];

/*
 * Most-broken-first. The readiness table is read by somebody looking for a problem, so
 * the problems sort to the top and the healthy majority sorts out of the way.
 */
const STATUS_SORT_RANK: Record<ReadinessStatus, number> = {
  [ReadinessStatus.NotReachable]: 0,
  [ReadinessStatus.PartiallyReady]: 1,
  [ReadinessStatus.Ready]: 2,
};

/*
 * 60 seconds, the same window ProjectService.currentPlanCache uses and for the same
 * reason: this is computed on page load and on every responder chip render, the inputs
 * (escalation rules, notification rules, verified methods) change on a human timescale,
 * and a minute of staleness on "this person has no SMS rule" costs nothing. There is no
 * cross-process invalidation — each replica holds its own copy — so the TTL is the only
 * guarantee, which is why it is short.
 */
const READINESS_CACHE_TTL_IN_MS: number = 60 * 1000;

/*
 * Rows per page. LIMIT_PER_PROJECT is the largest read the database layer will serve
 * (DatabaseService clamps anything above it), so it is the biggest page that survives a
 * round trip, and a bigger page means fewer round trips for the same total.
 */
const READ_PAGE_SIZE: number = LIMIT_PER_PROJECT;

/*
 * A ceiling on the number of pages ONE read may take, so a fetcher that keeps returning
 * full pages — a paging bug, a query whose sort is not total, a table that is genuinely
 * growing faster than we can read it — cannot spin this service forever holding a
 * connection. Five million rows is far past any real project; a read that hits it is a
 * bug report, not a big customer, which is why hitting it is logged as an error AND
 * reported as isTruncated rather than quietly stopping.
 */
const MAX_PAGES_PER_READ: number = 500;

/** The state of one (user, ruleType, severity) cell while it is being accumulated. */
interface CoverageState {
  hasRule: boolean;
  isOptOut: boolean;
}

/** A severity reduced to what coverage needs, in display order. */
interface SeverityRef {
  id: ObjectID;
  name: string;
}

/*
 * Whether every read behind one answer actually reached the end of its table. Threaded
 * through every loader as one mutable object rather than returned by each of them,
 * because a truncation anywhere — responders, methods, rules — invalidates the whole
 * answer equally, and an accumulator that any layer can set is much harder to forget to
 * propagate than a boolean that has to be OR-ed at fifteen call sites.
 */
interface ReadCompleteness {
  isTruncated: boolean;
}

/*
 * Everything the resolution pass learns about ONE responder, and the only channel between
 * "who is on this policy" and buildUserReadiness.
 *
 * It used to be a bare `Set<ResponderSource>`, which was enough while the answer to "how
 * is this person reached?" was a four-value enum. It stopped being enough the moment the
 * readiness table needed to be filtered by team: the resolution pass reads the exact
 * TeamMember rows that would answer that, then threw the team id away and kept only the
 * fact that SOME team was involved. Carrying the ids costs one extra selected column on a
 * read that already happens, and keeps the "reached via Team" chip and the team filter
 * derived from the same pass rather than from two that can disagree.
 *
 * Ids, not names. Names are resolved once per scope in loadTeamNames, because a team on an
 * escalation rule is shared by every one of its members and reading its name per member is
 * the N+1 this service was written to eliminate.
 */
interface ResponderAttachment {
  sources: Set<ResponderSource>;
  /** Team ids as strings, so a user on the same team twice dedupes for free. */
  teamIds: Set<string>;
}

/*
 * The project-level switches that decide what a page with no matching rule actually
 * does, AND which channels can carry a page at all. Read once per summary, never per
 * user.
 */
interface ProjectNotificationSettings {
  isFallbackDisabled: boolean;
  enableSmsNotifications: boolean;
  enableCallNotifications: boolean;
  enableWhatsAppNotifications: boolean;
  enableTelegramNotifications: boolean;
}

/** Everything the per-user pass needs, loaded once for the whole responder set. */
interface ReadinessInputs {
  users: Array<User>;
  methodsByUserId: Map<string, Array<ReadinessMethod>>;
  coverageByKey: Map<string, CoverageState>;
  incidentSeverities: Array<SeverityRef>;
  alertSeverities: Array<SeverityRef>;
  projectSettings: ProjectNotificationSettings;
}

/**
 * The result of the batch entry point, plus the one fact a single-user caller needs that
 * the list itself cannot carry: WHICH of the requested users turned out to be members of
 * the project. "Not a member" and "member with no User row" are different errors with
 * different fixes, and an empty array cannot tell them apart.
 */
interface UserReadinessBatch {
  readiness: Array<UserReadiness>;
  memberUserIds: Set<string>;
}

/**
 * The shape of a service this file can page over. Structural rather than
 * `DatabaseService<TModel>` so that readEveryPage does not drag the whole base class
 * into its signature, and so a test double is assignable without pretending to be one.
 */
interface PagedReadService<TModel extends DatabaseBaseModel> {
  findBy(findBy: FindBy<TModel>): Promise<Array<TModel>>;
}

/**
 * The two ids every notification-method row has to hand over: its OWN, which is what a
 * rule points at, and its OWNER's, which is whose readiness it counts towards.
 *
 * Structural rather than a union of the seven models so that loadMethods can take both
 * out of any of them without seven overloads — and so that an eighth channel cannot be
 * added without supplying both, which is the pair that makes a method both listable and
 * selectable.
 */
interface MethodRowRef {
  id: ObjectID | null;
  userId?: ObjectID | undefined;
}

type CoverageKeyFunction = (
  userId: string,
  ruleType: NotificationRuleType,
  severityId: string,
) => string;

/*
 * Pipe-separated because none of the three components can contain a pipe: user and
 * severity ids are uuids, and NotificationRuleType's values are fixed English sentences.
 */
const buildCoverageKey: CoverageKeyFunction = (
  userId: string,
  ruleType: NotificationRuleType,
  severityId: string,
): string => {
  return `${userId}|${ruleType}|${severityId}`;
};

export default class OnCallReadinessService {
  private static summaryCache: InMemoryTTLCache<ReadinessSummary> =
    new InMemoryTTLCache(10_000);

  private static userCache: InMemoryTTLCache<UserReadiness> =
    new InMemoryTTLCache(10_000);

  /**
   * Readiness for every responder a single policy can reach — the union of its direct
   * users, its teams' members, its schedules' layer users, and anyone an override routes
   * pages to.
   */
  public static async getReadinessForPolicy(
    policyId: ObjectID,
    projectId: ObjectID,
  ): Promise<ReadinessSummary> {
    const cacheKey: string = `${projectId.toString()}:policy:${policyId.toString()}`;
    const cached: ReadinessSummary | undefined =
      this.summaryCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    /*
     * Look the policy up rather than letting a bad id fall through. Every query below is
     * scoped by projectId, so a policy id from another project would return zero
     * responders — and a summary that says "0 responders, nothing wrong" is the most
     * dangerous possible answer to "is this policy safe to rely on?".
     */
    const policy: OnCallDutyPolicy | null =
      await OnCallDutyPolicyService.findOneById({
        id: policyId,
        select: {
          _id: true,
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!policy || policy.projectId?.toString() !== projectId.toString()) {
      throw new BadDataException("On-call duty policy not found");
    }

    const summary: ReadinessSummary = await this.computeSummary(
      projectId,
      policyId,
    );

    this.summaryCache.set(cacheKey, summary, READINESS_CACHE_TTL_IN_MS);

    return summary;
  }

  /**
   * Readiness for every responder reachable through ANY policy in the project. Same
   * resolution as the per-policy call with the policy filter dropped, so a user who is
   * ready on one policy and unreachable on another appears exactly once, with the union
   * of their sources.
   */
  public static async getReadinessForProject(
    projectId: ObjectID,
  ): Promise<ReadinessSummary> {
    const cacheKey: string = `${projectId.toString()}:project`;
    const cached: ReadinessSummary | undefined =
      this.summaryCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const summary: ReadinessSummary = await this.computeSummary(
      projectId,
      undefined,
    );

    this.summaryCache.set(cacheKey, summary, READINESS_CACHE_TTL_IN_MS);

    return summary;
  }

  /**
   * Readiness for a SET of users, at the cost of one user.
   *
   * This is the entry point every list-shaped caller must use — a team roster, a
   * responder table, a page of chips. It exists because the obvious alternative,
   * `Promise.all(userIds.map(getReadinessForUser))`, is not a small inefficiency but a
   * different order of cost: each of those calls used to resolve the ENTIRE project's
   * responder set (six heavy reads) purely to work out one user's `reachedVia`, so a
   * forty-member team issued several hundred queries where a handful would do, and one
   * rejected promise threw the whole page away.
   *
   * The query count here is constant in the number of users asked about: every read is
   * `Includes(userIds)` over the whole set, and the membership resolution is targeted at
   * exactly those users rather than at the project. One user and five hundred users cost
   * the same round trips — the only thing that grows is the number of PAGES each read
   * takes, which is a function of how many rows exist, not of how many users were asked
   * about, and is the price of never truncating.
   *
   * Users that are not members of the project are OMITTED rather than thrown for: a
   * roster read races with somebody being removed from a team, and one departed member
   * must not blank out the readiness of the other thirty-nine. A caller that needs to
   * know about the omission should compare the returned userIds with the ones it asked
   * for.
   */
  public static async getReadinessForUsers(
    userIds: Array<ObjectID>,
    projectId: ObjectID,
  ): Promise<Array<UserReadiness>> {
    if (userIds.length === 0) {
      return [];
    }

    const batch: UserReadinessBatch = await this.computeReadinessForUsers(
      userIds,
      projectId,
    );

    return batch.readiness;
  }

  /**
   * Readiness for one user, whether or not they are on a policy at all.
   *
   * The "whether or not" matters: this is what the add-responder modal calls BEFORE the
   * user has been attached to anything, which is the only moment at which the mistake is
   * cheap to fix. Such a user has an empty `reachedVia` and a status computed exactly as
   * it would be once they are attached.
   *
   * A thin wrapper over getReadinessForUsers, deliberately: one code path computes
   * readiness for a set, and "one" is a set of size one. The only thing this adds is
   * turning the two ways of getting nothing back — not a member of the project, member
   * with no User row — into the two different exceptions callers have always seen.
   */
  public static async getReadinessForUser(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<UserReadiness> {
    const batch: UserReadinessBatch = await this.computeReadinessForUsers(
      [userId],
      projectId,
    );

    /*
     * User is a GLOBAL model — it is not scoped by project — so without this check any
     * caller holding a project's credentials could ask for the readiness of an arbitrary
     * user id and get their name and login email back. Team membership is what "in this
     * project" means, so that is what is checked, and it is checked BEFORE any other
     * read is issued (see computeReadinessForUsers), so a caller probing arbitrary user
     * ids learns nothing at all.
     */
    if (!batch.memberUserIds.has(userId.toString())) {
      throw new BadDataException("User is not a member of this project");
    }

    const readiness: UserReadiness | undefined = batch.readiness[0];

    if (!readiness) {
      throw new BadDataException("User not found");
    }

    return readiness;
  }

  /**
   * Throw away every cached answer in this process.
   *
   * Deliberately coarse — it does not take a projectId — because the cache is keyed
   * three different ways (project, policy, user) and a write to one notification rule
   * can invalidate all three at once: the rule's owner, every policy that reaches them,
   * and the project roll-up. Working out the affected key set would be more code than
   * the saving is worth when the entries expire in sixty seconds anyway, and a
   * too-clever invalidation that misses a key is indistinguishable from the stale
   * readiness this whole service exists to eliminate.
   *
   * This is PUBLIC and must actually be CALLED. Until it is, a "Recheck" button re-reads
   * the same sixty-second-old answer and redraws it unchanged, which reads to an admin
   * who has just fixed something as "my fix did not work". The exact call sites, all of
   * which currently do not call it:
   *
   *   - UserNotificationRuleService — on create and on delete of a rule (this is the
   *     write the Recheck button is nearly always chasing).
   *   - The seven notification-method services (UserEmailService, UserSmsService,
   *     UserCallService, UserPushService, UserWhatsAppService, UserTelegramService,
   *     UserWebhookService) — on create, on delete, and on VERIFICATION, which is the
   *     write that flips a responder from NotReachable to Ready.
   *   - OnCallDutyPolicyEscalationRuleUserService / ...TeamService / ...ScheduleService
   *     and OnCallDutyPolicyScheduleLayerUserService — on create and delete, because
   *     they change who the responder set even contains.
   *   - OnCallDutyPolicyUserOverrideService — on create, update and delete.
   *   - TeamMemberService — on create and delete, for the same reason.
   *   - ProjectService — on any update that touches disableOnCallNotificationFallback or
   *     the four enable*Notifications switches, since those change every user's status
   *     at once.
   *   - IncidentSeverityService / AlertSeverityService — on create and delete, which add
   *     and remove whole columns of the coverage grid.
   *   - OnCallReadinessAPI — on an explicit refresh request, so "Recheck" means recheck.
   *
   * Note that each replica holds its own copy and clears only its own; the TTL remains
   * the only cross-process guarantee.
   */
  public static clearCache(): void {
    this.summaryCache.clear();
    this.userCache.clear();
  }

  private static async computeSummary(
    projectId: ObjectID,
    onCallDutyPolicyId: ObjectID | undefined,
  ): Promise<ReadinessSummary> {
    const completeness: ReadCompleteness = this.newReadCompleteness();

    /*
     * Loaded here rather than inside the per-user pass because the summary itself has to
     * report isFallbackEnabled even when the responder set is empty — a project with no
     * responders and the fallback switched off is exactly the project somebody is about
     * to attach a responder to.
     */
    const projectSettings: ProjectNotificationSettings =
      await this.loadProjectSettings(projectId);

    const responders: Map<string, ResponderAttachment> =
      await this.resolveResponders(projectId, onCallDutyPolicyId, completeness);

    const users: Array<UserReadiness> = await this.buildReadiness({
      projectId: projectId,
      responders: responders,
      projectSettings: projectSettings,
      completeness: completeness,
    });

    let readyCount: number = 0;
    let partiallyReadyCount: number = 0;
    let notReachableCount: number = 0;

    for (const user of users) {
      if (user.status === ReadinessStatus.Ready) {
        readyCount++;
      } else if (user.status === ReadinessStatus.PartiallyReady) {
        partiallyReadyCount++;
      } else {
        notReachableCount++;
      }
    }

    return {
      projectId: projectId,
      onCallDutyPolicyId: onCallDutyPolicyId,
      readyCount: readyCount,
      partiallyReadyCount: partiallyReadyCount,
      notReachableCount: notReachableCount,
      isFallbackEnabled: !projectSettings.isFallbackDisabled,
      isTruncated: completeness.isTruncated,
      users: users,
    };
  }

  /**
   * The batch computation both public user-shaped entry points share.
   *
   * Membership is resolved FIRST and everything else is filtered to the members it
   * found, which does three jobs with one read: it is the cross-project guard, it is the
   * source of each user's team list (which is how the Team source is resolved without
   * expanding the whole project), and it is what makes "user removed mid-request" a
   * quiet omission rather than an exception.
   */
  private static async computeReadinessForUsers(
    userIds: Array<ObjectID>,
    projectId: ObjectID,
  ): Promise<UserReadinessBatch> {
    const requestedUserIds: Array<ObjectID> = this.distinctIds(userIds);

    const readiness: Array<UserReadiness> = [];
    const memberUserIds: Set<string> = new Set<string>();
    const uncachedUserIds: Array<ObjectID> = [];

    for (const userId of requestedUserIds) {
      const cached: UserReadiness | undefined = this.userCache.get(
        this.userCacheKey(projectId, userId),
      );

      if (cached) {
        /*
         * Only members are ever written to this cache, so a hit answers the membership
         * question too. That matters: re-issuing the membership read for a cached user
         * would make a cache hit cost a round trip, which is most of what the cache is
         * for.
         */
        memberUserIds.add(userId.toString());
        readiness.push(cached);
        continue;
      }

      uncachedUserIds.push(userId);
    }

    if (uncachedUserIds.length === 0) {
      return {
        readiness: this.sortReadiness(readiness),
        memberUserIds: memberUserIds,
      };
    }

    const completeness: ReadCompleteness = this.newReadCompleteness();

    const teamIdsByUserId: Map<
      string,
      Array<ObjectID>
    > = await this.loadProjectMembership(
      projectId,
      uncachedUserIds,
      completeness,
    );

    const memberIds: Array<ObjectID> = uncachedUserIds.filter(
      (userId: ObjectID): boolean => {
        return teamIdsByUserId.has(userId.toString());
      },
    );

    for (const memberId of memberIds) {
      memberUserIds.add(memberId.toString());
    }

    if (memberIds.length === 0) {
      return {
        readiness: this.sortReadiness(readiness),
        memberUserIds: memberUserIds,
      };
    }

    const projectSettings: ProjectNotificationSettings =
      await this.loadProjectSettings(projectId);

    const responders: Map<string, ResponderAttachment> =
      await this.resolveRespondersForUsers({
        projectId: projectId,
        userIds: memberIds,
        teamIdsByUserId: teamIdsByUserId,
        completeness: completeness,
      });

    const computed: Array<UserReadiness> = await this.buildReadiness({
      projectId: projectId,
      responders: responders,
      projectSettings: projectSettings,
      completeness: completeness,
    });

    for (const one of computed) {
      /*
       * A truncated read can only make a user look WORSE here — a rule that did not
       * arrive reads as a missing rule, a method that did not arrive as a missing method
       * — so the answer is safe to RETURN. It is not safe to cache for a minute, and the
       * reason is the asymmetry with the summary: ReadinessSummary carries isTruncated,
       * so a cached truncated summary is still telling the truth about itself, whereas
       * UserReadiness carries no such field and a cached one would be an unlabelled false
       * amber sitting on somebody's card for sixty seconds. Recomputing is cheap next to
       * teaching admins that amber means nothing.
       */
      if (!completeness.isTruncated) {
        this.userCache.set(
          this.userCacheKey(projectId, one.userId),
          one,
          READINESS_CACHE_TTL_IN_MS,
        );
      }

      readiness.push(one);
    }

    return {
      readiness: this.sortReadiness(readiness),
      memberUserIds: memberUserIds,
    };
  }

  private static userCacheKey(projectId: ObjectID, userId: ObjectID): string {
    return `${projectId.toString()}:user:${userId.toString()}`;
  }

  private static newReadCompleteness(): ReadCompleteness {
    return {
      isTruncated: false,
    };
  }

  /**
   * Read a whole table, one page at a time, folding each page as it arrives.
   *
   * This is the single most important method in the file, because the alternative it
   * replaces — one findBy capped at LIMIT_PER_PROJECT — is not a performance choice but
   * a correctness one, and it fails in the worst available direction. UserNotificationRule
   * rows grow as users x (2 x incidentSeverities + 2 x alertSeverities) x verified
   * methods, so a five thousand responder project with eight severities of each kind and
   * two methods each holds around 340,000 of them. A single capped read returns the first
   * 10,000 — roughly a hundred and fifty users' worth, in whatever order the database
   * felt like — and every other responder is then scored against ZERO rules. The same
   * shape on a responder-producing read (team member expansion, schedule layers) is worse
   * still: those users never enter the map at all, so they appear in no count, no list and
   * no "needs attention" section. The feature reports them as though they do not exist.
   *
   * Raising the cap does not fix that; it moves it to a slightly larger project and makes
   * it harder to notice. Paging does fix it, at the cost of one round trip per full page,
   * which is a price worth paying to never quietly lie about who can be paged.
   *
   * Three details that are load-bearing rather than incidental:
   *
   *   - Pages are folded by the CALLER as they arrive, not accumulated and returned. The
   *     coverage read would otherwise materialise all 340,000 rows at once purely to
   *     collapse them into a map of a few thousand entries.
   *   - Every read is sorted, with `_id` ascending as the final tiebreak. OFFSET paging
   *     over an unordered — or non-totally-ordered — query may return the same row twice
   *     and skip another, and the default sort here would be `createdAt DESC`, which is
   *     emphatically not unique when a migration wrote a project's default rules in one
   *     transaction.
   *   - Hitting MAX_PAGES_PER_READ sets isTruncated AND logs an error. A truncation that
   *     is merely logged is invisible to the person reading the readiness table, and a
   *     truncation that is merely flagged is invisible to whoever has to work out why.
   */
  private static async readEveryPage<TModel extends DatabaseBaseModel>(data: {
    description: string;
    projectId: ObjectID;
    completeness: ReadCompleteness;
    service: PagedReadService<TModel>;
    query: Query<TModel>;
    select: Select<TModel>;
    sort?: Sort<TModel> | undefined;
    consumePage: (rows: Array<TModel>) => void;
  }): Promise<void> {
    const sort: Sort<TModel> = {
      ...(data.sort || {}),
      _id: SortOrder.Ascending,
    } as Sort<TModel>;

    let skip: number = 0;

    for (let page: number = 0; page < MAX_PAGES_PER_READ; page++) {
      const rows: Array<TModel> = await data.service.findBy({
        /*
         * A fresh shallow copy per page: findBy hands the query object to the permission
         * layer, which is free to add its own predicates to it, and a query that
         * accumulated them across pages would silently narrow as it went.
         */
        query: { ...data.query },
        select: data.select,
        sort: sort,
        limit: READ_PAGE_SIZE,
        skip: skip,
        props: {
          isRoot: true,
        },
      });

      data.consumePage(rows);

      if (rows.length < READ_PAGE_SIZE) {
        return;
      }

      skip += rows.length;
    }

    data.completeness.isTruncated = true;

    logger.error(
      `OnCallReadinessService stopped reading ${data.description} for project ${data.projectId.toString()} after ${MAX_PAGES_PER_READ} pages of ${READ_PAGE_SIZE} rows. The readiness answer for this project is INCOMPLETE: responders may be missing from it entirely, and its counts understate the number of people who cannot be paged.`,
    );
  }

  /**
   * The effective responder set, deduped on userId, with every source a user was reached
   * by.
   *
   * This mirrors OnCallDutyPolicyEscalationRuleService.startRuleExecution, which is the
   * runtime's own answer to "who does this page". Any divergence between the two is a
   * lie in the UI: a readiness table that omits a user the runtime pages is worse than
   * no table, because it actively certifies a gap as covered. Three deliberate
   * alignments with the runtime:
   *
   *   - Team members are NOT filtered by hasAcceptedInvitation, because
   *     TeamMemberService.getUsersInTeam does not filter either. A member who never
   *     accepted their invite still gets paged, so they still have to be checked.
   *   - Schedule layer users are taken WHOLE, not sampled for who is on call right now.
   *     Readiness is a property of the roster, not of this instant; a user in next
   *     week's rotation with no notification rule is a page that will be missed next
   *     week, and that is precisely what this is for.
   *   - Overrides contribute the user pages are ROUTED TO, not the user being covered
   *     for. During an override the covered user is not paged at all, while the
   *     substitute is — and the substitute may not be attached to the policy by any
   *     other means, which makes them the single most likely responder to be silently
   *     unreachable.
   */
  private static async resolveResponders(
    projectId: ObjectID,
    onCallDutyPolicyId: ObjectID | undefined,
    completeness: ReadCompleteness,
  ): Promise<Map<string, ResponderAttachment>> {
    const responders: Map<string, ResponderAttachment> = new Map<
      string,
      ResponderAttachment
    >();

    type AddResponderFunction = (
      userId: ObjectID | undefined,
      source: ResponderSource,
      teamId?: ObjectID | undefined,
    ) => void;

    const addResponder: AddResponderFunction = (
      userId: ObjectID | undefined,
      source: ResponderSource,
      teamId?: ObjectID | undefined,
    ): void => {
      if (!userId) {
        return;
      }

      const key: string = userId.toString();
      let existing: ResponderAttachment | undefined = responders.get(key);

      if (!existing) {
        existing = {
          sources: new Set<ResponderSource>(),
          teamIds: new Set<string>(),
        };
        responders.set(key, existing);
      }

      existing.sources.add(source);

      if (teamId) {
        existing.teamIds.add(teamId.toString());
      }
    };

    // 1. Users attached directly to an escalation rule.

    const directQuery: Query<OnCallDutyPolicyEscalationRuleUser> = {
      projectId: projectId,
    };

    if (onCallDutyPolicyId) {
      directQuery.onCallDutyPolicyId = onCallDutyPolicyId;
    }

    await this.readEveryPage<OnCallDutyPolicyEscalationRuleUser>({
      description: "escalation rule users",
      projectId: projectId,
      completeness: completeness,
      service: OnCallDutyPolicyEscalationRuleUserService,
      query: directQuery,
      select: {
        _id: true,
        userId: true,
      },
      consumePage: (rows: Array<OnCallDutyPolicyEscalationRuleUser>): void => {
        for (const row of rows) {
          addResponder(row.userId, ResponderSource.Direct);
        }
      },
    });

    // 2. Teams attached to an escalation rule, expanded to their members.

    const teamQuery: Query<OnCallDutyPolicyEscalationRuleTeam> = {
      projectId: projectId,
    };

    if (onCallDutyPolicyId) {
      teamQuery.onCallDutyPolicyId = onCallDutyPolicyId;
    }

    const escalationTeams: Array<OnCallDutyPolicyEscalationRuleTeam> = [];

    await this.readEveryPage<OnCallDutyPolicyEscalationRuleTeam>({
      description: "escalation rule teams",
      projectId: projectId,
      completeness: completeness,
      service: OnCallDutyPolicyEscalationRuleTeamService,
      query: teamQuery,
      select: {
        _id: true,
        teamId: true,
      },
      consumePage: (rows: Array<OnCallDutyPolicyEscalationRuleTeam>): void => {
        escalationTeams.push(...rows);
      },
    });

    const teamIds: Array<ObjectID> = this.distinctIds(
      escalationTeams.map(
        (team: OnCallDutyPolicyEscalationRuleTeam): ObjectID | undefined => {
          return team.teamId;
        },
      ),
    );

    if (teamIds.length > 0) {
      /*
       * ONE paged read for every team on the policy, not one per team. This is the N+1
       * that made TeamComplianceService unusable on a project of any size — and the page
       * loop is what keeps the fix from re-introducing the truncation it replaced, since
       * five thousand users across three teams is fifteen thousand membership rows and
       * the old single read returned ten thousand of them.
       */
      await this.readEveryPage<TeamMember>({
        description: "team members of escalation rule teams",
        projectId: projectId,
        completeness: completeness,
        service: TeamMemberService,
        query: {
          projectId: projectId,
          teamId: new Includes(teamIds),
        },
        select: {
          _id: true,
          userId: true,
          /*
           * WHICH team, not merely that a team was involved. One extra column on a read
           * that already runs, and it is what lets the readiness table be filtered down
           * to a team without a second pass that could disagree with this one about who
           * is on it.
           */
          teamId: true,
        },
        consumePage: (rows: Array<TeamMember>): void => {
          for (const row of rows) {
            addResponder(row.userId, ResponderSource.Team, row.teamId);
          }
        },
      });
    }

    // 3. Schedules attached to an escalation rule, expanded to their layer users.

    const scheduleQuery: Query<OnCallDutyPolicyEscalationRuleSchedule> = {
      projectId: projectId,
    };

    if (onCallDutyPolicyId) {
      scheduleQuery.onCallDutyPolicyId = onCallDutyPolicyId;
    }

    const escalationSchedules: Array<OnCallDutyPolicyEscalationRuleSchedule> =
      [];

    await this.readEveryPage<OnCallDutyPolicyEscalationRuleSchedule>({
      description: "escalation rule schedules",
      projectId: projectId,
      completeness: completeness,
      service: OnCallDutyPolicyEscalationRuleScheduleService,
      query: scheduleQuery,
      select: {
        _id: true,
        onCallDutyPolicyScheduleId: true,
      },
      consumePage: (
        rows: Array<OnCallDutyPolicyEscalationRuleSchedule>,
      ): void => {
        escalationSchedules.push(...rows);
      },
    });

    const scheduleIds: Array<ObjectID> = this.distinctIds(
      escalationSchedules.map(
        (
          schedule: OnCallDutyPolicyEscalationRuleSchedule,
        ): ObjectID | undefined => {
          return schedule.onCallDutyPolicyScheduleId;
        },
      ),
    );

    if (scheduleIds.length > 0) {
      /*
       * Going through the escalation-rule join even for the project-wide scope is
       * deliberate: a schedule that is not attached to any policy pages nobody, and
       * listing its members as unready responders would be noise an admin cannot act on.
       */
      await this.readEveryPage<OnCallDutyPolicyScheduleLayerUser>({
        description: "schedule layer users",
        projectId: projectId,
        completeness: completeness,
        service: OnCallDutyPolicyScheduleLayerUserService,
        query: {
          projectId: projectId,
          onCallDutyPolicyScheduleId: new Includes(scheduleIds),
        },
        select: {
          _id: true,
          userId: true,
        },
        consumePage: (rows: Array<OnCallDutyPolicyScheduleLayerUser>): void => {
          for (const row of rows) {
            addResponder(row.userId, ResponderSource.Schedule);
          }
        },
      });
    }

    // 4. Users that overrides route pages to.

    const overrideQuery: Query<OnCallDutyPolicyUserOverride> = {
      projectId: projectId,
      /*
       * An override that has already ended routes nothing, so it is not a reason anyone
       * is a responder. Future overrides ARE included: the substitute needs to be
       * reachable before their window opens, not discovered to be unreachable during it.
       */
      endsAt: QueryHelper.greaterThanEqualTo(OneUptimeDate.getCurrentDate()),
    };

    if (onCallDutyPolicyId) {
      /*
       * equalToOrNull, matching getRouteAlertToUserId exactly: an override with a NULL
       * policy id is a GLOBAL override and applies to this policy too. Filtering on
       * equality alone would drop every global override, which is the single most
       * commonly configured kind.
       */
      overrideQuery.onCallDutyPolicyId =
        QueryHelper.equalToOrNull(onCallDutyPolicyId);
    }

    await this.readEveryPage<OnCallDutyPolicyUserOverride>({
      description: "on-call user overrides",
      projectId: projectId,
      completeness: completeness,
      service: OnCallDutyPolicyUserOverrideService,
      query: overrideQuery,
      select: {
        _id: true,
        routeAlertsToUserId: true,
      },
      consumePage: (rows: Array<OnCallDutyPolicyUserOverride>): void => {
        for (const row of rows) {
          addResponder(row.routeAlertsToUserId, ResponderSource.Override);
        }
      },
    });

    return responders;
  }

  /**
   * The same four sources as resolveResponders, but asked the other way round: not "who
   * does this project page" but "how, if at all, does this project page THESE people".
   *
   * The difference is the entire fix for the amplified N+1. Answering `reachedVia` for a
   * forty-member team by resolving the whole project's responder set means reading every
   * escalation rule, every team's full membership and every schedule's full layer roster
   * — work proportional to the project, repeated per caller, to produce four booleans per
   * user. Every read here is keyed on the userIds actually asked about instead, and the
   * two that cannot be (which teams and which schedules are attached to a policy) are
   * keyed on just those users' teams and schedules.
   *
   * Users with no source at all stay in the map with an empty set, because a user who is
   * on no policy yet is exactly who the add-responder modal is asking about.
   */
  private static async resolveRespondersForUsers(data: {
    projectId: ObjectID;
    userIds: Array<ObjectID>;
    teamIdsByUserId: Map<string, Array<ObjectID>>;
    completeness: ReadCompleteness;
  }): Promise<Map<string, ResponderAttachment>> {
    const responders: Map<string, ResponderAttachment> = new Map<
      string,
      ResponderAttachment
    >();

    for (const userId of data.userIds) {
      responders.set(userId.toString(), {
        sources: new Set<ResponderSource>(),
        teamIds: new Set<string>(),
      });
    }

    type AddSourceFunction = (
      userId: ObjectID | undefined,
      source: ResponderSource,
      teamId?: ObjectID | undefined,
    ) => void;

    const addSource: AddSourceFunction = (
      userId: ObjectID | undefined,
      source: ResponderSource,
      teamId?: ObjectID | undefined,
    ): void => {
      if (!userId) {
        return;
      }

      /*
       * A row for somebody we were not asked about is dropped rather than added. The
       * reads are all filtered on the user set already; this is the guard that keeps a
       * future unfiltered read from silently widening the answer.
       */
      const attachment: ResponderAttachment | undefined = responders.get(
        userId.toString(),
      );

      if (!attachment) {
        return;
      }

      attachment.sources.add(source);

      if (teamId) {
        attachment.teamIds.add(teamId.toString());
      }
    };

    // 1. Attached directly to an escalation rule.

    await this.readEveryPage<OnCallDutyPolicyEscalationRuleUser>({
      description: "escalation rule users for a user set",
      projectId: data.projectId,
      completeness: data.completeness,
      service: OnCallDutyPolicyEscalationRuleUserService,
      query: {
        projectId: data.projectId,
        userId: new Includes(data.userIds),
      },
      select: {
        _id: true,
        userId: true,
      },
      consumePage: (rows: Array<OnCallDutyPolicyEscalationRuleUser>): void => {
        for (const row of rows) {
          addSource(row.userId, ResponderSource.Direct);
        }
      },
    });

    // 2. In a team that is attached to an escalation rule.

    const memberTeamIds: Array<ObjectID> = this.distinctIds(
      Array.from(data.teamIdsByUserId.values()).flat(),
    );

    const attachedTeamIds: Set<string> = new Set<string>();

    if (memberTeamIds.length > 0) {
      await this.readEveryPage<OnCallDutyPolicyEscalationRuleTeam>({
        description: "escalation rule teams for a user set",
        projectId: data.projectId,
        completeness: data.completeness,
        service: OnCallDutyPolicyEscalationRuleTeamService,
        query: {
          projectId: data.projectId,
          teamId: new Includes(memberTeamIds),
        },
        select: {
          _id: true,
          teamId: true,
        },
        consumePage: (
          rows: Array<OnCallDutyPolicyEscalationRuleTeam>,
        ): void => {
          for (const row of rows) {
            if (row.teamId) {
              attachedTeamIds.add(row.teamId.toString());
            }
          }
        },
      });
    }

    if (attachedTeamIds.size > 0) {
      for (const userId of data.userIds) {
        const teamIds: Array<ObjectID> =
          data.teamIdsByUserId.get(userId.toString()) || [];

        /*
         * Every matching team, not the first one and not a boolean. A user on two
         * attached teams is paged by both, so both belong on the row and both have to
         * match a team filter — the boolean this replaced could only ever have said
         * "some team", which is precisely the answer that made the team filter
         * impossible to build.
         */
        for (const teamId of teamIds) {
          if (attachedTeamIds.has(teamId.toString())) {
            addSource(userId, ResponderSource.Team, teamId);
          }
        }
      }
    }

    // 3. On a layer of a schedule that is attached to an escalation rule.

    const scheduleIdsByUserId: Map<string, Array<ObjectID>> = new Map<
      string,
      Array<ObjectID>
    >();

    await this.readEveryPage<OnCallDutyPolicyScheduleLayerUser>({
      description: "schedule layer users for a user set",
      projectId: data.projectId,
      completeness: data.completeness,
      service: OnCallDutyPolicyScheduleLayerUserService,
      query: {
        projectId: data.projectId,
        userId: new Includes(data.userIds),
      },
      select: {
        _id: true,
        userId: true,
        onCallDutyPolicyScheduleId: true,
      },
      consumePage: (rows: Array<OnCallDutyPolicyScheduleLayerUser>): void => {
        for (const row of rows) {
          if (!row.userId || !row.onCallDutyPolicyScheduleId) {
            continue;
          }

          const key: string = row.userId.toString();
          const existing: Array<ObjectID> | undefined =
            scheduleIdsByUserId.get(key);

          if (existing) {
            existing.push(row.onCallDutyPolicyScheduleId);
            continue;
          }

          scheduleIdsByUserId.set(key, [row.onCallDutyPolicyScheduleId]);
        }
      },
    });

    const memberScheduleIds: Array<ObjectID> = this.distinctIds(
      Array.from(scheduleIdsByUserId.values()).flat(),
    );

    const attachedScheduleIds: Set<string> = new Set<string>();

    if (memberScheduleIds.length > 0) {
      await this.readEveryPage<OnCallDutyPolicyEscalationRuleSchedule>({
        description: "escalation rule schedules for a user set",
        projectId: data.projectId,
        completeness: data.completeness,
        service: OnCallDutyPolicyEscalationRuleScheduleService,
        query: {
          projectId: data.projectId,
          onCallDutyPolicyScheduleId: new Includes(memberScheduleIds),
        },
        select: {
          _id: true,
          onCallDutyPolicyScheduleId: true,
        },
        consumePage: (
          rows: Array<OnCallDutyPolicyEscalationRuleSchedule>,
        ): void => {
          for (const row of rows) {
            if (row.onCallDutyPolicyScheduleId) {
              attachedScheduleIds.add(
                row.onCallDutyPolicyScheduleId.toString(),
              );
            }
          }
        },
      });
    }

    if (attachedScheduleIds.size > 0) {
      for (const userId of data.userIds) {
        const scheduleIds: Array<ObjectID> =
          scheduleIdsByUserId.get(userId.toString()) || [];

        const isOnAnAttachedSchedule: boolean = scheduleIds.some(
          (scheduleId: ObjectID): boolean => {
            return attachedScheduleIds.has(scheduleId.toString());
          },
        );

        if (isOnAnAttachedSchedule) {
          addSource(userId, ResponderSource.Schedule);
        }
      }
    }

    // 4. Substituted in by an override that has not ended.

    await this.readEveryPage<OnCallDutyPolicyUserOverride>({
      description: "on-call user overrides for a user set",
      projectId: data.projectId,
      completeness: data.completeness,
      service: OnCallDutyPolicyUserOverrideService,
      query: {
        projectId: data.projectId,
        routeAlertsToUserId: new Includes(data.userIds),
        endsAt: QueryHelper.greaterThanEqualTo(OneUptimeDate.getCurrentDate()),
      },
      select: {
        _id: true,
        routeAlertsToUserId: true,
      },
      consumePage: (rows: Array<OnCallDutyPolicyUserOverride>): void => {
        for (const row of rows) {
          addSource(row.routeAlertsToUserId, ResponderSource.Override);
        }
      },
    });

    return responders;
  }

  /**
   * Which teams each of these users belongs to in this project — and, by existing at
   * all, whether they belong to the project.
   *
   * One read doing both jobs is not a trick: team membership IS what "in this project"
   * means for a User, which is a global model. Reading the teamIds at the same time is
   * free and is what lets the Team responder source be resolved without expanding every
   * team in the project into its full membership.
   */
  private static async loadProjectMembership(
    projectId: ObjectID,
    userIds: Array<ObjectID>,
    completeness: ReadCompleteness,
  ): Promise<Map<string, Array<ObjectID>>> {
    const teamIdsByUserId: Map<string, Array<ObjectID>> = new Map<
      string,
      Array<ObjectID>
    >();

    await this.readEveryPage<TeamMember>({
      description: "project membership for a user set",
      projectId: projectId,
      completeness: completeness,
      service: TeamMemberService,
      query: {
        projectId: projectId,
        userId: new Includes(userIds),
      },
      select: {
        _id: true,
        userId: true,
        teamId: true,
      },
      consumePage: (rows: Array<TeamMember>): void => {
        for (const row of rows) {
          if (!row.userId) {
            continue;
          }

          const key: string = row.userId.toString();
          const existing: Array<ObjectID> | undefined =
            teamIdsByUserId.get(key);

          if (existing) {
            if (row.teamId) {
              existing.push(row.teamId);
            }

            continue;
          }

          teamIdsByUserId.set(key, row.teamId ? [row.teamId] : []);
        }
      },
    });

    return teamIdsByUserId;
  }

  /**
   * Turn a resolved responder set into per-user readiness. Every read here is batched
   * over the whole set; the number of queries does not grow with the number of users or
   * the number of severities.
   */
  private static async buildReadiness(data: {
    projectId: ObjectID;
    responders: Map<string, ResponderAttachment>;
    projectSettings: ProjectNotificationSettings;
    completeness: ReadCompleteness;
  }): Promise<Array<UserReadiness>> {
    const userIds: Array<ObjectID> = Array.from(data.responders.keys()).map(
      (userId: string): ObjectID => {
        return new ObjectID(userId);
      },
    );

    if (userIds.length === 0) {
      return [];
    }

    const inputs: ReadinessInputs = await this.loadInputs({
      projectId: data.projectId,
      userIds: userIds,
      projectSettings: data.projectSettings,
      completeness: data.completeness,
    });

    /*
     * ONE read for every team named anywhere in the responder set, rather than one per
     * responder. A team on an escalation rule is shared by every one of its members, so
     * the per-member read would be the same N+1 that made the report this service
     * replaced unusable — see readEveryPage.
     */
    const teamNamesById: Map<string, string> = await this.loadTeamNames({
      projectId: data.projectId,
      teamIds: this.distinctIds(
        Array.from(data.responders.values())
          .flatMap((attachment: ResponderAttachment): Array<string> => {
            return Array.from(attachment.teamIds);
          })
          .map((teamId: string): ObjectID => {
            return new ObjectID(teamId);
          }),
      ),
      completeness: data.completeness,
    });

    const readiness: Array<UserReadiness> = [];

    for (const user of inputs.users) {
      const userIdString: string = user.id?.toString() || "";
      const attachment: ResponderAttachment = data.responders.get(
        userIdString,
      ) || {
        sources: new Set<ResponderSource>(),
        teamIds: new Set<string>(),
      };

      readiness.push(
        this.buildUserReadiness(
          user,
          attachment,
          userIdString,
          inputs,
          teamNamesById,
        ),
      );
    }

    return this.sortReadiness(readiness);
  }

  /**
   * Team id -> team name, for every team that pages somebody in the responder set.
   *
   * A team whose row did not come back is simply absent from the map, and
   * buildUserReadiness then drops it from the responder's `teams` rather than rendering an
   * id or an empty chip. That is the right direction to fail in for a filter: an option
   * that cannot be labelled is an option nobody can choose deliberately, whereas a chip
   * reading a bare uuid is one an admin might act on.
   */
  private static async loadTeamNames(data: {
    projectId: ObjectID;
    teamIds: Array<ObjectID>;
    completeness: ReadCompleteness;
  }): Promise<Map<string, string>> {
    const teamNamesById: Map<string, string> = new Map<string, string>();

    if (data.teamIds.length === 0) {
      return teamNamesById;
    }

    await this.readEveryPage<Team>({
      description: "teams that page a responder",
      projectId: data.projectId,
      completeness: data.completeness,
      service: TeamService,
      query: {
        projectId: data.projectId,
        _id: new Includes(data.teamIds),
      },
      select: {
        _id: true,
        name: true,
      },
      consumePage: (rows: Array<Team>): void => {
        for (const row of rows) {
          if (row.id && row.name) {
            teamNamesById.set(row.id.toString(), row.name);
          }
        }
      },
    });

    return teamNamesById;
  }

  private static sortReadiness(
    readiness: Array<UserReadiness>,
  ): Array<UserReadiness> {
    readiness.sort((a: UserReadiness, b: UserReadiness): number => {
      const rankDifference: number =
        STATUS_SORT_RANK[a.status] - STATUS_SORT_RANK[b.status];

      if (rankDifference !== 0) {
        return rankDifference;
      }

      return a.userName.localeCompare(b.userName);
    });

    return readiness;
  }

  /*
   * Read the project's switches once. They are what decides whether "no rule for Sev4"
   * means "falls back to email" or "is dropped on the floor", and whether a verified SMS
   * number is a way to reach somebody or a decoration. A readiness surface that cannot
   * tell those apart is not diagnosing anything.
   */
  private static async loadProjectSettings(
    projectId: ObjectID,
  ): Promise<ProjectNotificationSettings> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        _id: true,
        disableOnCallNotificationFallback: true,
        enableSmsNotifications: true,
        enableCallNotifications: true,
        enableWhatsAppNotifications: true,
        enableTelegramNotifications: true,
      },
      props: {
        isRoot: true,
      },
    });

    /*
     * A missing project row reads as every paid channel OFF and the fallback ON, which
     * is the pairing that produces the loudest answer rather than the most convenient
     * one. Defaulting a switch to "on" would let a project we could not read certify
     * responders as reachable on channels that may be switched off.
     */
    return {
      isFallbackDisabled: Boolean(project?.disableOnCallNotificationFallback),
      enableSmsNotifications: Boolean(project?.enableSmsNotifications),
      enableCallNotifications: Boolean(project?.enableCallNotifications),
      enableWhatsAppNotifications: Boolean(
        project?.enableWhatsAppNotifications,
      ),
      enableTelegramNotifications: Boolean(
        project?.enableTelegramNotifications,
      ),
    };
  }

  private static async loadInputs(data: {
    projectId: ObjectID;
    userIds: Array<ObjectID>;
    projectSettings: ProjectNotificationSettings;
    completeness: ReadCompleteness;
  }): Promise<ReadinessInputs> {
    const users: Array<User> = [];

    await this.readEveryPage<User>({
      description: "responder user records",
      projectId: data.projectId,
      completeness: data.completeness,
      service: UserService,
      query: {
        _id: new Includes(data.userIds),
      },
      select: {
        _id: true,
        name: true,
        email: true,
        profilePictureId: true,
      },
      consumePage: (rows: Array<User>): void => {
        users.push(...rows);
      },
    });

    const methodsByUserId: Map<
      string,
      Array<ReadinessMethod>
    > = await this.loadMethods(data.projectId, data.userIds, data.completeness);

    const coverageByKey: Map<string, CoverageState> =
      await this.loadCoverageIndex(
        data.projectId,
        data.userIds,
        data.completeness,
      );

    const incidentSeverityModels: Array<IncidentSeverity> = [];

    await this.readEveryPage<IncidentSeverity>({
      description: "incident severities",
      projectId: data.projectId,
      completeness: data.completeness,
      service: IncidentSeverityService,
      query: {
        projectId: data.projectId,
      },
      select: {
        _id: true,
        name: true,
      },
      sort: {
        order: SortOrder.Ascending,
      },
      consumePage: (rows: Array<IncidentSeverity>): void => {
        incidentSeverityModels.push(...rows);
      },
    });

    const alertSeverityModels: Array<AlertSeverity> = [];

    await this.readEveryPage<AlertSeverity>({
      description: "alert severities",
      projectId: data.projectId,
      completeness: data.completeness,
      service: AlertSeverityService,
      query: {
        projectId: data.projectId,
      },
      select: {
        _id: true,
        name: true,
      },
      sort: {
        order: SortOrder.Ascending,
      },
      consumePage: (rows: Array<AlertSeverity>): void => {
        alertSeverityModels.push(...rows);
      },
    });

    return {
      users: users,
      methodsByUserId: methodsByUserId,
      coverageByKey: coverageByKey,
      incidentSeverities: this.toSeverityRefs(incidentSeverityModels),
      alertSeverities: this.toSeverityRefs(alertSeverityModels),
      projectSettings: data.projectSettings,
    };
  }

  /**
   * One paged read per method model, each over the whole responder set.
   *
   * All SEVEN channels are here. TeamComplianceService looked at four and therefore told
   * a responder whose only method was Telegram, WhatsApp or Webhook that they were
   * non-compliant while the runtime was quite happily paging them — a false alarm that
   * teaches admins to ignore the table, which is worse than the table not existing.
   */
  private static async loadMethods(
    projectId: ObjectID,
    userIds: Array<ObjectID>,
    completeness: ReadCompleteness,
  ): Promise<Map<string, Array<ReadinessMethod>>> {
    const methodsByUserId: Map<string, Array<ReadinessMethod>> = new Map<
      string,
      Array<ReadinessMethod>
    >();

    /*
     * The row goes in whole rather than as a userId, so that the id a rule will point at
     * and the identifier that gets masked provably come off the SAME row. Handing the two
     * in separately is how a caller ends up attaching one person's method id to another
     * person's mask, and a rule pointed at the wrong row pages the wrong human.
     */
    type AddMethodFunction = (
      row: MethodRowRef,
      method: Omit<ReadinessMethod, "methodId">,
    ) => void;

    const addMethod: AddMethodFunction = (
      row: MethodRowRef,
      method: Omit<ReadinessMethod, "methodId">,
    ): void => {
      const methodId: ObjectID | null = row.id;

      /*
       * A row with no owner, or no id of its own, is dropped. Neither is reachable while
       * every select below asks for `_id` and every method row is owned — a primary key
       * is not optional in the database — so this is a guard against a future select
       * being trimmed rather than a case that happens.
       *
       * It is a drop rather than a partial emit because the alternatives are both worse.
       * Emitting the method without an id would mean typing methodId as optional, which
       * pushes this impossible case out to every caller and gives the rule form an option
       * it cannot submit. Dropping errs towards reporting the responder as LESS reachable
       * than they are, which is the direction this service always errs in: a false amber
       * gets investigated, and a false green does not.
       */
      if (!row.userId || !methodId) {
        return;
      }

      const readinessMethod: ReadinessMethod = {
        methodId: methodId,
        ...method,
      };

      const key: string = row.userId.toString();
      const existing: Array<ReadinessMethod> | undefined =
        methodsByUserId.get(key);

      if (existing) {
        existing.push(readinessMethod);

        return;
      }

      methodsByUserId.set(key, [readinessMethod]);
    };

    await this.readEveryPage<UserPush>({
      description: "push notification methods",
      projectId: projectId,
      completeness: completeness,
      service: UserPushService,
      query: {
        projectId: projectId,
        userId: new Includes(userIds),
      },
      select: {
        _id: true,
        userId: true,
        deviceName: true,
        isVerified: true,
      },
      consumePage: (rows: Array<UserPush>): void => {
        for (const row of rows) {
          addMethod(row, {
            methodType: ReadinessMethodType.Push,
            maskedIdentifier: maskIdentifier(
              row.deviceName,
              MaskedIdentifierKind.Handle,
            ),
            isVerified: Boolean(row.isVerified),
          });
        }
      },
    });

    await this.readEveryPage<UserEmail>({
      description: "email notification methods",
      projectId: projectId,
      completeness: completeness,
      service: UserEmailService,
      query: {
        projectId: projectId,
        userId: new Includes(userIds),
      },
      select: {
        _id: true,
        userId: true,
        email: true,
        isVerified: true,
      },
      consumePage: (rows: Array<UserEmail>): void => {
        for (const row of rows) {
          addMethod(row, {
            methodType: ReadinessMethodType.Email,
            maskedIdentifier: maskIdentifier(
              row.email?.toString(),
              MaskedIdentifierKind.Email,
            ),
            isVerified: Boolean(row.isVerified),
          });
        }
      },
    });

    await this.readEveryPage<UserSMS>({
      description: "SMS notification methods",
      projectId: projectId,
      completeness: completeness,
      service: UserSmsService,
      query: {
        projectId: projectId,
        userId: new Includes(userIds),
      },
      select: {
        _id: true,
        userId: true,
        phone: true,
        isVerified: true,
      },
      consumePage: (rows: Array<UserSMS>): void => {
        for (const row of rows) {
          addMethod(row, {
            methodType: ReadinessMethodType.SMS,
            maskedIdentifier: maskIdentifier(
              row.phone?.toString(),
              MaskedIdentifierKind.Phone,
            ),
            isVerified: Boolean(row.isVerified),
          });
        }
      },
    });

    await this.readEveryPage<UserCall>({
      description: "call notification methods",
      projectId: projectId,
      completeness: completeness,
      service: UserCallService,
      query: {
        projectId: projectId,
        userId: new Includes(userIds),
      },
      select: {
        _id: true,
        userId: true,
        phone: true,
        isVerified: true,
      },
      consumePage: (rows: Array<UserCall>): void => {
        for (const row of rows) {
          addMethod(row, {
            methodType: ReadinessMethodType.Call,
            maskedIdentifier: maskIdentifier(
              row.phone?.toString(),
              MaskedIdentifierKind.Phone,
            ),
            isVerified: Boolean(row.isVerified),
          });
        }
      },
    });

    await this.readEveryPage<UserWhatsApp>({
      description: "WhatsApp notification methods",
      projectId: projectId,
      completeness: completeness,
      service: UserWhatsAppService,
      query: {
        projectId: projectId,
        userId: new Includes(userIds),
      },
      select: {
        _id: true,
        userId: true,
        phone: true,
        isVerified: true,
      },
      consumePage: (rows: Array<UserWhatsApp>): void => {
        for (const row of rows) {
          addMethod(row, {
            methodType: ReadinessMethodType.WhatsApp,
            maskedIdentifier: maskIdentifier(
              row.phone?.toString(),
              MaskedIdentifierKind.Phone,
            ),
            isVerified: Boolean(row.isVerified),
          });
        }
      },
    });

    await this.readEveryPage<UserTelegram>({
      description: "Telegram notification methods",
      projectId: projectId,
      completeness: completeness,
      service: UserTelegramService,
      query: {
        projectId: projectId,
        userId: new Includes(userIds),
      },
      /*
       * The handle only — never telegramChatId. The chat id is the addressable target a
       * bot sends to; the handle is the human-facing label, and it is the one a user can
       * recognise as theirs.
       */
      select: {
        _id: true,
        userId: true,
        telegramUserHandle: true,
        isVerified: true,
      },
      consumePage: (rows: Array<UserTelegram>): void => {
        for (const row of rows) {
          addMethod(row, {
            methodType: ReadinessMethodType.Telegram,
            maskedIdentifier: maskIdentifier(
              row.telegramUserHandle,
              MaskedIdentifierKind.Handle,
            ),
            isVerified: Boolean(row.isVerified),
          });
        }
      },
    });

    await this.readEveryPage<UserSlack>({
      description: "Slack notification methods",
      projectId: projectId,
      completeness: completeness,
      service: UserSlackService,
      query: {
        projectId: projectId,
        userId: new Includes(userIds),
      },
      /*
       * The username only — never slackUserId. The member id is the
       * addressable target the bot sends to; the username is the human-facing
       * label, and it is the one a user can recognise as theirs.
       */
      select: {
        _id: true,
        userId: true,
        slackUserName: true,
        isVerified: true,
      },
      consumePage: (rows: Array<UserSlack>): void => {
        for (const row of rows) {
          addMethod(row, {
            methodType: ReadinessMethodType.Slack,
            maskedIdentifier: maskIdentifier(
              row.slackUserName,
              MaskedIdentifierKind.Handle,
            ),
            isVerified: Boolean(row.isVerified),
          });
        }
      },
    });

    await this.readEveryPage<UserMicrosoftTeams>({
      description: "Microsoft Teams notification methods",
      projectId: projectId,
      completeness: completeness,
      service: UserMicrosoftTeamsService,
      query: {
        projectId: projectId,
        userId: new Includes(userIds),
      },
      /*
       * The display name only — never microsoftTeamsUserId. The Entra id is
       * the addressable target the bot sends to; the display name is the
       * human-facing label, and it is the one a user can recognise as theirs.
       */
      select: {
        _id: true,
        userId: true,
        microsoftTeamsUserName: true,
        isVerified: true,
      },
      consumePage: (rows: Array<UserMicrosoftTeams>): void => {
        for (const row of rows) {
          addMethod(row, {
            methodType: ReadinessMethodType.MicrosoftTeams,
            maskedIdentifier: maskIdentifier(
              row.microsoftTeamsUserName,
              MaskedIdentifierKind.Handle,
            ),
            isVerified: Boolean(row.isVerified),
          });
        }
      },
    });

    await this.readEveryPage<UserWebhook>({
      description: "webhook notification methods",
      projectId: projectId,
      completeness: completeness,
      service: UserWebhookService,
      query: {
        projectId: projectId,
        userId: new Includes(userIds),
      },
      /*
       * `name` ONLY. UserWebhook.webhookUrl is a bearer credential — anyone holding a
       * Slack/Discord/Teams hook URL can post as the integration — so it is never
       * selected here and never leaves the server on this path.
       * Common/UI/Utils/NotificationMethodUtil.ts documents the same rule for the rule
       * tables and reads only `name`; this follows it. The masked name is enough to
       * answer the only question readiness asks, which is whether a webhook exists.
       */
      select: {
        _id: true,
        userId: true,
        name: true,
      },
      consumePage: (rows: Array<UserWebhook>): void => {
        for (const row of rows) {
          /*
           * isVerified: true, with no isVerified column behind it. UserWebhook has no
           * verification concept at all — its presence IS the whole test, which is
           * exactly how the runtime fallback treats it. Reporting it as unverified would
           * paint the one channel that is guaranteed to work as the one channel that
           * will not.
           */
          addMethod(row, {
            methodType: ReadinessMethodType.Webhook,
            maskedIdentifier: maskIdentifier(
              row.name,
              MaskedIdentifierKind.Handle,
            ),
            isVerified: true,
          });
        }
      },
    });

    for (const methods of methodsByUserId.values()) {
      methods.sort((a: ReadinessMethod, b: ReadinessMethod): number => {
        return (
          METHOD_DISPLAY_ORDER.indexOf(a.methodType as ReadinessMethodType) -
          METHOD_DISPLAY_ORDER.indexOf(b.methodType as ReadinessMethodType)
        );
      });
    }

    return methodsByUserId;
  }

  /**
   * ONE paged read over UserNotificationRule for the whole responder set, folded into a
   * map keyed by (userId, ruleType, severityId).
   *
   * The folding happens per page rather than after the read for a reason that is not
   * about tidiness: this is by far the largest table this service touches — users x rule
   * types x severities x methods — so a project of a few thousand responders holds
   * hundreds of thousands of rows here, all of which collapse into at most a few cells
   * per user. Accumulating them first and folding second would hold the whole table in
   * memory to produce a map a thousand times smaller.
   *
   * Opt-out rows are read alongside real rules rather than filtered out in SQL, because
   * both halves are needed: a cell with an opt-out is Ready (deliberate silence) while a
   * cell with nothing at all is PartiallyReady (silence nobody chose), and telling those
   * apart is the entire reason the isOptOut column exists.
   *
   * The in-memory split is `isOptOut === true`, which is the exact dual of the
   * notOptOutRuleQuery predicate the paging path uses — deliberately NOT `isOptOut ===
   * false`. The column is nullable and was added long after these rows started existing,
   * so it is NULL on every rule in every existing install. Testing for false would
   * classify all of them as neither rules nor opt-outs, and this service would report a
   * fully-configured project as entirely unready.
   */
  private static async loadCoverageIndex(
    projectId: ObjectID,
    userIds: Array<ObjectID>,
    completeness: ReadCompleteness,
  ): Promise<Map<string, CoverageState>> {
    const coverageByKey: Map<string, CoverageState> = new Map<
      string,
      CoverageState
    >();

    await this.readEveryPage<UserNotificationRule>({
      description: "user notification rules",
      projectId: projectId,
      completeness: completeness,
      service: UserNotificationRuleService,
      query: {
        projectId: projectId,
        userId: new Includes(userIds),
      },
      select: {
        _id: true,
        userId: true,
        ruleType: true,
        incidentSeverityId: true,
        alertSeverityId: true,
        isOptOut: true,
      },
      consumePage: (rows: Array<UserNotificationRule>): void => {
        for (const rule of rows) {
          this.foldRuleIntoCoverage(rule, coverageByKey);
        }
      },
    });

    return coverageByKey;
  }

  private static foldRuleIntoCoverage(
    rule: UserNotificationRule,
    coverageByKey: Map<string, CoverageState>,
  ): void {
    const scope: RuleTypeScope | undefined = RULE_TYPE_SCOPES.find(
      (candidate: RuleTypeScope): boolean => {
        return candidate.ruleType === rule.ruleType;
      },
    );

    /*
     * Not one of the four paging rule types — a handoff rule, or something added later.
     * It covers no page, so it covers no cell. This is defect 4 of
     * TeamComplianceService, which matched on severity alone and let a
     * WHEN_USER_GOES_OFF_CALL rule certify incident coverage.
     */
    if (!scope) {
      return;
    }

    /*
     * Take the severity from the column the RULE TYPE dictates, never from whichever one
     * happens to be populated. An alert rule carrying a stray incidentSeverityId matches
     * no page at runtime, so it must not be allowed to satisfy a cell here.
     */
    const severityId: ObjectID | undefined =
      scope.severityKind === SeverityKind.Incident
        ? rule.incidentSeverityId
        : rule.alertSeverityId;

    /*
     * A severity-scoped rule with a NULL severity is the Gap G corpse: the paging path
     * counts episode rules filtered by a concrete severity id, so NULL matches nothing
     * and the rule is unreachable. Counting it as coverage would report exactly the
     * users worst affected by that bug as fully ready.
     */
    if (!severityId) {
      return;
    }

    const key: string = buildCoverageKey(
      rule.userId?.toString() || "",
      scope.ruleType,
      severityId.toString(),
    );

    const state: CoverageState = coverageByKey.get(key) || {
      hasRule: false,
      isOptOut: false,
    };

    if (rule.isOptOut === true) {
      state.isOptOut = true;
    } else {
      state.hasRule = true;
    }

    coverageByKey.set(key, state);
  }

  private static buildUserReadiness(
    user: User,
    attachment: ResponderAttachment,
    userIdString: string,
    inputs: ReadinessInputs,
    teamNamesById: Map<string, string>,
  ): UserReadiness {
    const sources: Set<ResponderSource> = attachment.sources;
    const methods: Array<ReadinessMethod> =
      inputs.methodsByUserId.get(userIdString) || [];

    const coverage: Array<ReadinessCoverageCell> = [];

    for (const scope of RULE_TYPE_SCOPES) {
      const severities: Array<SeverityRef> =
        scope.severityKind === SeverityKind.Incident
          ? inputs.incidentSeverities
          : inputs.alertSeverities;

      for (const severity of severities) {
        const state: CoverageState | undefined = inputs.coverageByKey.get(
          buildCoverageKey(
            userIdString,
            scope.ruleType,
            severity.id.toString(),
          ),
        );

        coverage.push({
          ruleType: scope.ruleType,
          severityId: severity.id,
          severityName: severity.name,
          hasRule: Boolean(state?.hasRule),
          isOptOut: Boolean(state?.isOptOut),
        });
      }
    }

    /*
     * Verified is necessary and not sufficient — webhooks are reported verified by
     * construction above, so this one predicate covers the "webhook counts without
     * verification" rule without a special case leaking into the status logic.
     */
    const verifiedMethods: Array<ReadinessMethod> = methods.filter(
      (method: ReadinessMethod): boolean => {
        return method.isVerified;
      },
    );

    /*
     * USABLE is verified AND on a channel the project has switched on. Status used to be
     * computed from verification alone, which meant a responder whose only verified
     * methods were SMS and Call, in a project with SMS and Call switched off, rendered
     * Ready and green while being completely unpageable — the exact false green this
     * service exists to make impossible. The project switches are already loaded, sit
     * two fields away, and the runtime consults them on every send, so ignoring them here
     * was never a judgement call.
     */
    const usableMethods: Array<ReadinessMethod> = verifiedMethods.filter(
      (method: ReadinessMethod): boolean => {
        return this.isChannelEnabled(method.methodType, inputs.projectSettings);
      },
    );

    const disabledChannels: Array<string> = this.distinctStrings(
      verifiedMethods
        .filter((method: ReadinessMethod): boolean => {
          return !this.isChannelEnabled(
            method.methodType,
            inputs.projectSettings,
          );
        })
        .map((method: ReadinessMethod): string => {
          return method.methodType;
        }),
    );

    const uncoveredCells: Array<ReadinessCoverageCell> = coverage.filter(
      (cell: ReadinessCoverageCell): boolean => {
        return !cell.hasRule && !cell.isOptOut;
      },
    );

    let status: ReadinessStatus = ReadinessStatus.Ready;

    if (usableMethods.length === 0) {
      status = ReadinessStatus.NotReachable;
    } else if (uncoveredCells.length > 0) {
      status = ReadinessStatus.PartiallyReady;
    }

    const reasons: Array<string> = this.buildReasons({
      status: status,
      methods: methods,
      verifiedMethods: verifiedMethods,
      usableMethods: usableMethods,
      disabledChannels: disabledChannels,
      uncoveredCells: uncoveredCells,
      projectSettings: inputs.projectSettings,
    });

    return {
      userId: user.id!,
      userName:
        user.name?.toString() || user.email?.toString() || "Unknown User",
      userEmail: user.email?.toString() || "",
      userProfilePictureId: user.profilePictureId,
      status: status,
      methods: methods,
      coverage: coverage,
      reasons: reasons,
      reachedVia: RESPONDER_SOURCE_ORDER.filter(
        (source: ResponderSource): boolean => {
          return sources.has(source);
        },
      ),
      /*
       * A fresh array per user, never a shared one. InMemoryTTLCache stores by reference
       * and hands the same object graph to every caller inside its TTL, so a list shared
       * between two responders would let a mutation anywhere downstream rewrite the
       * cached answer for both.
       *
       * Sorted by name so the column and the filter chip read the same way for every
       * responder, and so the order does not depend on which membership row the database
       * happened to return first.
       */
      teams: Array.from(attachment.teamIds)
        .map((teamId: string): ReadinessTeam | null => {
          const name: string | undefined = teamNamesById.get(teamId);

          return name ? { _id: new ObjectID(teamId), name: name } : null;
        })
        .filter((team: ReadinessTeam | null): team is ReadinessTeam => {
          return team !== null;
        })
        .sort((a: ReadinessTeam, b: ReadinessTeam): number => {
          return a.name.localeCompare(b.name);
        }),
    };
  }

  /**
   * Whether this project can send on this channel at all.
   *
   * Push, Email and Webhook have no project switch: the first two are zero-cost and the
   * third is somebody else's endpoint, so nothing gates them and they are always
   * available. The four paid channels do, and the runtime honours them — SmsService and
   * CallService refuse at send time, and the fallback checks all four before it picks a
   * channel to spend money on. Treating all four alike here is the conservative reading:
   * a responder marked unreachable because their project switched their only channel off
   * is an alarm somebody can act on, while the reverse mistake is a page nobody hears.
   */
  private static isChannelEnabled(
    methodType: string,
    settings: ProjectNotificationSettings,
  ): boolean {
    if (methodType === ReadinessMethodType.SMS) {
      return settings.enableSmsNotifications;
    }

    if (methodType === ReadinessMethodType.Call) {
      return settings.enableCallNotifications;
    }

    if (methodType === ReadinessMethodType.WhatsApp) {
      return settings.enableWhatsAppNotifications;
    }

    if (methodType === ReadinessMethodType.Telegram) {
      return settings.enableTelegramNotifications;
    }

    return true;
  }

  /**
   * Sentences an admin can act on, in the order they should act on them.
   *
   * Not status names, not rule-type enum values, not "non-compliant" — every line names
   * a specific missing thing and what happens because of it. The consequence clause is
   * the part that matters: "no rule for Sev4" is a shrug, "no rule for Sev4, pages are
   * dropped" is a ticket.
   */
  private static buildReasons(data: {
    status: ReadinessStatus;
    methods: Array<ReadinessMethod>;
    verifiedMethods: Array<ReadinessMethod>;
    usableMethods: Array<ReadinessMethod>;
    disabledChannels: Array<string>;
    uncoveredCells: Array<ReadinessCoverageCell>;
    projectSettings: ProjectNotificationSettings;
  }): Array<string> {
    const reasons: Array<string> = [];

    if (data.status === ReadinessStatus.NotReachable) {
      /*
       * Three ways to be unreachable, and they need three different sentences because
       * they need three different people to fix them: the user adds a method, the user
       * verifies a method, or an admin turns a channel back on. A single "cannot be
       * paged" line sends all three to the wrong place.
       */
      if (data.verifiedMethods.length > 0) {
        reasons.push("No usable notification method - cannot be paged");
        reasons.push(
          `Every method they have verified is on ${data.disabledChannels.join(", ")}, and this project has ${data.disabledChannels.length === 1 ? "that channel" : "those channels"} switched off - that is a project setting, not something this user can fix`,
        );

        return reasons;
      }

      reasons.push("No verified notification method - cannot be paged");

      /*
       * "They have nothing" and "they have something they never verified" look identical
       * in a status chip and could not be more different to fix: the second needs one
       * click from the user, not a conversation about how on-call works.
       */
      if (data.methods.length > 0) {
        const unverified: Array<string> = this.distinctStrings(
          data.methods.map((method: ReadinessMethod): string => {
            return method.methodType;
          }),
        );

        reasons.push(
          `Added ${unverified.join(", ")} but never verified - unverified methods are never used`,
        );
      } else {
        reasons.push(
          "Ask this user to add and verify a notification method in User Settings > Notification Methods",
        );
      }

      /*
       * Coverage is meaningless for someone nothing can reach. Listing their missing
       * rules underneath would bury the one sentence that matters under a dozen that do
       * not.
       */
      return reasons;
    }

    /*
     * Note what is deliberately NOT said here. A responder who still has one working
     * channel but also has, say, an SMS number the project has switched off is reachable,
     * and saying so on their row would put a warning sentence on every single user in a
     * project that has switched SMS off — a line nobody can act on, attached to people
     * who have nothing wrong with them, which is how a readiness surface teaches admins
     * to stop reading it. The stranded channel matters only when it is the reason nobody
     * can be reached, and that case is handled above.
     */
    if (data.uncoveredCells.length === 0) {
      return reasons;
    }

    const fallbackChannels: Array<string> = this.describeFallbackChannels(
      data.usableMethods,
      data.projectSettings,
    );

    /*
     * One sentence per rule type, listing its missing severities, rather than one per
     * cell. A project with four severities and no rules at all would otherwise produce
     * sixteen near-identical lines that nobody reads to the end of.
     */
    for (const scope of RULE_TYPE_SCOPES) {
      const severityNames: Array<string> = this.distinctStrings(
        data.uncoveredCells
          .filter((cell: ReadinessCoverageCell): boolean => {
            return cell.ruleType === scope.ruleType;
          })
          .map((cell: ReadinessCoverageCell): string => {
            return cell.severityName || "this severity";
          }),
      );

      if (severityNames.length === 0) {
        continue;
      }

      const subject: string = `No rules for ${severityNames.join(", ")} ${scope.subjectNoun}`;

      if (data.projectSettings.isFallbackDisabled) {
        reasons.push(
          `${subject} - pages are dropped because on-call fallback is disabled for this project`,
        );
      } else if (fallbackChannels.length === 0) {
        /*
         * Not reachable from here today — a usable method always yields a fallback
         * channel — but kept so that a future channel with no fallback path degrades
         * into an honest sentence instead of "pages fall back to " with nothing after
         * it.
         */
        reasons.push(`${subject} - pages cannot be delivered`);
      } else {
        reasons.push(
          `${subject} - pages fall back to ${fallbackChannels.join(", ")}`,
        );
      }
    }

    return reasons;
  }

  /**
   * The channels a fallback page would actually arrive on, so the reason sentences name
   * the real thing rather than a hopeful "some verified method".
   *
   * This mirrors UserNotificationRuleService.chooseFallbackChannels exactly, including
   * the project switches: zero-cost channels first and ALL of them if present, then one
   * paid channel in escalating-intrusiveness order, then webhook. If that function's
   * order ever changes, this one has to change with it — a readiness surface promising
   * "falls back to SMS" for a project that has SMS switched off is worse than saying
   * nothing. The switch checks are redundant with the usable-method filter upstream and
   * are kept anyway, because this function's whole value is being a line-by-line mirror
   * of the one that does the real thing.
   */
  private static describeFallbackChannels(
    usableMethods: Array<ReadinessMethod>,
    settings: ProjectNotificationSettings,
  ): Array<string> {
    type HasMethodFunction = (methodType: ReadinessMethodType) => boolean;

    const has: HasMethodFunction = (
      methodType: ReadinessMethodType,
    ): boolean => {
      return usableMethods.some((method: ReadinessMethod): boolean => {
        return method.methodType === methodType;
      });
    };

    const zeroCost: Array<string> = [];

    if (has(ReadinessMethodType.Push)) {
      zeroCost.push(ReadinessMethodType.Push);
    }

    if (has(ReadinessMethodType.Email)) {
      zeroCost.push(ReadinessMethodType.Email);
    }

    if (has(ReadinessMethodType.Slack)) {
      zeroCost.push(ReadinessMethodType.Slack);
    }

    if (has(ReadinessMethodType.MicrosoftTeams)) {
      zeroCost.push(ReadinessMethodType.MicrosoftTeams);
    }

    if (zeroCost.length > 0) {
      return zeroCost;
    }

    if (settings.enableSmsNotifications && has(ReadinessMethodType.SMS)) {
      return [ReadinessMethodType.SMS];
    }

    if (settings.enableCallNotifications && has(ReadinessMethodType.Call)) {
      return [ReadinessMethodType.Call];
    }

    if (
      settings.enableWhatsAppNotifications &&
      has(ReadinessMethodType.WhatsApp)
    ) {
      return [ReadinessMethodType.WhatsApp];
    }

    if (
      settings.enableTelegramNotifications &&
      has(ReadinessMethodType.Telegram)
    ) {
      return [ReadinessMethodType.Telegram];
    }

    if (has(ReadinessMethodType.Webhook)) {
      return [ReadinessMethodType.Webhook];
    }

    return [];
  }

  private static toSeverityRefs(
    severities: Array<IncidentSeverity | AlertSeverity>,
  ): Array<SeverityRef> {
    const refs: Array<SeverityRef> = [];

    for (const severity of severities) {
      if (!severity.id) {
        continue;
      }

      refs.push({
        id: severity.id,
        name: severity.name || "Unnamed Severity",
      });
    }

    return refs;
  }

  private static distinctIds(
    ids: Array<ObjectID | undefined>,
  ): Array<ObjectID> {
    const seen: Set<string> = new Set<string>();
    const distinct: Array<ObjectID> = [];

    for (const id of ids) {
      if (!id) {
        continue;
      }

      const key: string = id.toString();

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      distinct.push(id);
    }

    return distinct;
  }

  private static distinctStrings(values: Array<string>): Array<string> {
    const seen: Set<string> = new Set<string>();
    const distinct: Array<string> = [];

    for (const value of values) {
      if (seen.has(value)) {
        continue;
      }

      seen.add(value);
      distinct.push(value);
    }

    return distinct;
  }
}
