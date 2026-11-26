import NotificationRuleType from "../NotificationRule/NotificationRuleType";
import ObjectID from "../ObjectID";

/*
 * What OnCallReadinessService answers: whether each responder of a project
 * or a policy can be paged, and how. In Common/Types, not in the service, so
 * that the Dashboard reads the same types
 * (src/Components/OnCallPolicy/Readiness/ReadinessTypes.ts) without reading
 * the service: TypeScript puts in a program the file a type comes from, even
 * through `import type`, and the service's file brings every service, model
 * and migration with it. Read from the service, these types held the
 * Dashboard's type check, and ee's Dashboard and UI tests', to most of
 * Common/Server, and ran ee's UI tests out of Node's default heap on the
 * 17.3.0 release. OnCallReadinessService still exports every one of them.
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
  Mattermost = "Mattermost",
  Webhook = "Webhook",
  // A custom channel (CustomNotificationChannel): CUSTOM_CHANNEL_METHOD_LABEL.
  CustomChannel = "Custom Channel",
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
  /*
   * When the team was made: tells two teams of one name apart in the
   * page's team filter (#10314). Missing when its row did not say.
   */
  createdAt?: Date | undefined;
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
  /*
   * The project asks people on call for a phone method (#7449) and this
   * member has no verified SMS, phone call or WhatsApp number
   * (isMissingRequiredPhoneMethod). Their status says nothing of it - they
   * are paged as before - so the Readiness page, Setup health and the
   * setup reminder read it here. Absent from an older server's answer.
   */
  isMissingPhoneMethod?: boolean | undefined;
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
