import type AlertModel from "Common/Models/DatabaseModels/Alert.js";
import type AlertEpisodeModel from "Common/Models/DatabaseModels/AlertEpisode.js";
import type AlertFeedModel from "Common/Models/DatabaseModels/AlertFeed.js";
import type AlertSeverityModel from "Common/Models/DatabaseModels/AlertSeverity.js";
import type AlertStateModelClass from "Common/Models/DatabaseModels/AlertState.js";
import type AlertStateTimelineModel from "Common/Models/DatabaseModels/AlertStateTimeline.js";
import type IncidentModel from "Common/Models/DatabaseModels/Incident.js";
import type IncidentEpisodeModel from "Common/Models/DatabaseModels/IncidentEpisode.js";
import type IncidentEpisodeInternalNoteModel from "Common/Models/DatabaseModels/IncidentEpisodeInternalNote.js";
import type IncidentFeedModel from "Common/Models/DatabaseModels/IncidentFeed.js";
import type IncidentSeverityModel from "Common/Models/DatabaseModels/IncidentSeverity.js";
import type IncidentStateModelClass from "Common/Models/DatabaseModels/IncidentState.js";
import type IncidentStateTimelineModel from "Common/Models/DatabaseModels/IncidentStateTimeline.js";
import type MonitorModel from "Common/Models/DatabaseModels/Monitor.js";
import type OnCallDutyPolicyModel from "Common/Models/DatabaseModels/OnCallDutyPolicy.js";
import type OnCallDutyPolicyEscalationRuleModel from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule.js";
import type OnCallDutyPolicyScheduleModel from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule.js";
import type ProjectModel from "Common/Models/DatabaseModels/Project.js";
import type TeamModel from "Common/Models/DatabaseModels/Team.js";
import type SecurityCaseModelClass from "Common/Models/DatabaseModels/SecurityCase.js";
import type SecurityCasePriorityModelClass from "Common/Models/DatabaseModels/SecurityCasePriority.js";
import type SecurityCaseStatusModelClass from "Common/Models/DatabaseModels/SecurityCaseStatus.js";
import type SecurityPlaybookRunModelClass from "Common/Models/DatabaseModels/SecurityPlaybookRun.js";

type Alert = InstanceType<typeof AlertModel>;
type AlertEpisode = InstanceType<typeof AlertEpisodeModel>;
type AlertFeed = InstanceType<typeof AlertFeedModel>;
type AlertSeverity = InstanceType<typeof AlertSeverityModel>;
type AlertStateModel = InstanceType<typeof AlertStateModelClass>;
type AlertStateTimeline = InstanceType<typeof AlertStateTimelineModel>;
type Incident = InstanceType<typeof IncidentModel>;
type IncidentEpisode = InstanceType<typeof IncidentEpisodeModel>;
type IncidentEpisodeInternalNote = InstanceType<
  typeof IncidentEpisodeInternalNoteModel
>;
type IncidentFeed = InstanceType<typeof IncidentFeedModel>;
type IncidentSeverity = InstanceType<typeof IncidentSeverityModel>;
type IncidentStateModel = InstanceType<typeof IncidentStateModelClass>;
type IncidentStateTimeline = InstanceType<typeof IncidentStateTimelineModel>;
type Monitor = InstanceType<typeof MonitorModel>;
type OnCallDutyPolicy = InstanceType<typeof OnCallDutyPolicyModel>;
type OnCallDutyPolicyEscalationRule = InstanceType<
  typeof OnCallDutyPolicyEscalationRuleModel
>;
type OnCallDutyPolicySchedule = InstanceType<
  typeof OnCallDutyPolicyScheduleModel
>;
type Project = InstanceType<typeof ProjectModel>;
type Team = InstanceType<typeof TeamModel>;
type SecurityCaseModel = InstanceType<typeof SecurityCaseModelClass>;
type SecurityCasePriorityModel = InstanceType<
  typeof SecurityCasePriorityModelClass
>;
type SecurityCaseStatusModel = InstanceType<
  typeof SecurityCaseStatusModelClass
>;
type SecurityPlaybookRunModel = InstanceType<
  typeof SecurityPlaybookRunModelClass
>;

type RequiredModelFields<T, K extends keyof T> = {
  [P in K]-?: NonNullable<T[P]>;
};

export interface ListResponse<T> {
  data: T[];
  count: number;
  skip: number;
  limit: number;
}

export interface ColorField {
  r: number;
  g: number;
  b: number;
}

type NamedEntityFromCommon = RequiredModelFields<Project, "_id" | "name">;

export type NamedEntity = NamedEntityFromCommon;

type NamedEntityWithColorFromCommon = RequiredModelFields<
  IncidentStateModel,
  "_id" | "name"
>;

export interface NamedEntityWithColor extends NamedEntityWithColorFromCommon {
  color: ColorField;
}

export type ProjectItem = RequiredModelFields<
  Project,
  "_id" | "name" | "slug"
> & {
  requireSsoForLogin?: boolean;
};

type IncidentItemFromCommon = RequiredModelFields<
  Incident,
  | "_id"
  | "title"
  | "incidentNumber"
  | "incidentNumberWithPrefix"
  | "description"
  | "declaredAt"
  | "createdAt"
>;

export interface IncidentItem
  extends Omit<
    IncidentItemFromCommon,
    | "declaredAt"
    | "createdAt"
    | "currentIncidentState"
    | "incidentSeverity"
    | "monitors"
    | "projectId"
  > {
  rootCause?: string;
  declaredAt: string;
  createdAt: string;
  currentIncidentState: NamedEntityWithColor;
  incidentSeverity: NamedEntityWithColor &
    RequiredModelFields<IncidentSeverity, "_id" | "name">;
  monitors: Array<NamedEntity & RequiredModelFields<Monitor, "_id" | "name">>;
  projectId?: string;
}

type AlertItemFromCommon = RequiredModelFields<
  Alert,
  | "_id"
  | "title"
  | "alertNumber"
  | "alertNumberWithPrefix"
  | "description"
  | "createdAt"
>;

export interface AlertItem
  extends Omit<
    AlertItemFromCommon,
    | "createdAt"
    | "currentAlertState"
    | "alertSeverity"
    | "monitor"
    | "projectId"
  > {
  rootCause?: string;
  createdAt: string;
  currentAlertState: NamedEntityWithColor;
  alertSeverity: NamedEntityWithColor &
    RequiredModelFields<AlertSeverity, "_id" | "name">;
  monitor: NamedEntity | null;
  projectId?: string;
}

export interface IncidentState
  extends RequiredModelFields<
    IncidentStateModel,
    | "_id"
    | "name"
    | "isResolvedState"
    | "isAcknowledgedState"
    | "isCreatedState"
    | "order"
  > {
  color: ColorField;
}

export interface AlertState
  extends RequiredModelFields<
    AlertStateModel,
    | "_id"
    | "name"
    | "isResolvedState"
    | "isAcknowledgedState"
    | "isCreatedState"
    | "order"
  > {
  color: ColorField;
}

type IncidentStateTimelineFromCommon = RequiredModelFields<
  IncidentStateTimeline,
  "_id" | "createdAt"
>;

export interface StateTimelineItem
  extends Omit<IncidentStateTimelineFromCommon, "createdAt" | "incidentState"> {
  createdAt: string;
  incidentState?: NamedEntityWithColor;
  alertState?: NamedEntityWithColor &
    RequiredModelFields<AlertStateTimeline, "_id">;
}

type IncidentEpisodeItemFromCommon = RequiredModelFields<
  IncidentEpisode,
  | "_id"
  | "title"
  | "episodeNumber"
  | "episodeNumberWithPrefix"
  | "description"
  | "createdAt"
  | "declaredAt"
  | "incidentCount"
>;

export interface IncidentEpisodeItem
  extends Omit<
    IncidentEpisodeItemFromCommon,
    | "createdAt"
    | "declaredAt"
    | "currentIncidentState"
    | "incidentSeverity"
    | "projectId"
  > {
  rootCause?: string;
  createdAt: string;
  declaredAt: string;
  incidentCount: number;
  currentIncidentState: NamedEntityWithColor;
  incidentSeverity: NamedEntityWithColor &
    RequiredModelFields<IncidentSeverity, "_id" | "name">;
  projectId?: string;
}

type AlertEpisodeItemFromCommon = RequiredModelFields<
  AlertEpisode,
  | "_id"
  | "title"
  | "episodeNumber"
  | "episodeNumberWithPrefix"
  | "description"
  | "createdAt"
  | "alertCount"
>;

export interface AlertEpisodeItem
  extends Omit<
    AlertEpisodeItemFromCommon,
    "createdAt" | "currentAlertState" | "alertSeverity" | "projectId"
  > {
  rootCause?: string;
  createdAt: string;
  alertCount: number;
  currentAlertState: NamedEntityWithColor;
  alertSeverity: NamedEntityWithColor &
    RequiredModelFields<AlertSeverity, "_id" | "name">;
  projectId?: string;
}

type NoteItemFromCommon = RequiredModelFields<
  IncidentEpisodeInternalNote,
  "_id" | "note" | "createdAt"
>;

export interface NoteItem
  extends Omit<NoteItemFromCommon, "createdAt" | "createdByUser"> {
  createdAt: string;
  createdByUser: {
    _id: string;
    // API values are serialized data, never Common's Name class instance.
    name: string | { _type: "Name"; value: string };
  } | null;
}

type FeedItemFromCommon = RequiredModelFields<
  AlertFeed | IncidentFeed,
  "_id" | "feedInfoInMarkdown" | "createdAt"
>;

export interface FeedItem
  extends Omit<FeedItemFromCommon, "createdAt" | "displayColor" | "postedAt"> {
  feedInfoInMarkdown: string;
  moreInformationInMarkdown?: string;
  displayColor: ColorField;
  postedAt?: string;
  createdAt: string;
}

export interface WithProject<T> {
  item: T;
  projectId: string;
  projectName: string;
}

export type ProjectIncidentItem = WithProject<IncidentItem>;
export type ProjectAlertItem = WithProject<AlertItem>;
export type ProjectIncidentEpisodeItem = WithProject<IncidentEpisodeItem>;
export type ProjectAlertEpisodeItem = WithProject<AlertEpisodeItem>;

export interface MonitorItem {
  _id: string;
  name: string;
  description?: string;
  monitorType?: string;
  currentMonitorStatus?: NamedEntityWithColor & {
    isOperationalState?: boolean;
  };
  disableActiveMonitoring?: boolean;
  createdAt: string;
  projectId?: string;
}

export type ProjectMonitorItem = WithProject<MonitorItem>;

export interface MonitorStatusItem {
  _id: string;
  name: string;
  color: ColorField;
  isOperationalState?: boolean;
  isOfflineState?: boolean;
  priority?: number;
}

interface OnCallPolicyRef
  extends RequiredModelFields<OnCallDutyPolicy, "name"> {
  _id?: string;
  id?: string;
}

interface OnCallEscalationRuleRef
  extends RequiredModelFields<OnCallDutyPolicyEscalationRule, "name"> {
  _id?: string;
  id?: string;
}

interface TeamRef extends RequiredModelFields<Team, "name"> {
  _id?: string;
  id?: string;
}

interface OnCallScheduleRef
  extends RequiredModelFields<OnCallDutyPolicySchedule, "name"> {
  _id?: string;
  id?: string;
}

export interface OnCallDutyEscalationRuleUserItem {
  onCallDutyPolicy?: OnCallPolicyRef;
  onCallDutyPolicyEscalationRule?: OnCallEscalationRuleRef;
}

export interface OnCallDutyEscalationRuleTeamItem {
  onCallDutyPolicy?: OnCallPolicyRef;
  onCallDutyPolicyEscalationRule?: OnCallEscalationRuleRef;
  team?: TeamRef;
}

export interface OnCallDutyEscalationRuleScheduleItem {
  onCallDutyPolicy?: OnCallPolicyRef;
  onCallDutyPolicyEscalationRule?: OnCallEscalationRuleRef;
  onCallDutyPolicySchedule?: OnCallScheduleRef;
}

export interface CurrentOnDutyEscalationPoliciesResponse {
  escalationRulesByUser: OnCallDutyEscalationRuleUserItem[];
  escalationRulesByTeam: OnCallDutyEscalationRuleTeamItem[];
  escalationRulesBySchedule: OnCallDutyEscalationRuleScheduleItem[];
}

export type OnCallAssignmentType = "user" | "team" | "schedule";

export interface OnCallAssignmentItem {
  projectId: string;
  projectName: string;
  policyId?: string;
  policyName: string;
  escalationRuleName: string;
  assignmentType: OnCallAssignmentType;
  assignmentDetail: string;
}

export interface ProjectOnCallAssignments {
  projectId: string;
  projectName: string;
  assignments: OnCallAssignmentItem[];
}

/*
 * A person as the on-call screens need them: enough to render a row and to
 * compare against the signed-in user, and nothing more. The API hands back
 * `name` and `email` on a joined user; both are optional because a project
 * member who has never set a name has only the email.
 */
export interface OnCallUserRef {
  _id: string;
  name?: string;
  email?: string;
}

/**
 * A schedule with its persisted roster: who is on it now, who is next, and the
 * boundaries between them. Every date is nullable because a schedule with no
 * layers - or one whose rotation has run out - has no computed roster at all.
 */
export interface OnCallScheduleItem {
  _id: string;
  name: string;
  currentUserOnRoster: OnCallUserRef | null;
  nextUserOnRoster: OnCallUserRef | null;
  rosterStartAt: string | null;
  rosterHandoffAt: string | null;
  rosterNextStartAt: string | null;
  rosterNextHandoffAt: string | null;
}

export type ProjectOnCallScheduleItem = WithProject<OnCallScheduleItem>;

/**
 * A stretch of time the signed-in user is (or will be) the on-call person for
 * one schedule. Derived from `OnCallScheduleItem`, never fetched directly.
 */
export interface OnCallShift {
  scheduleId: string;
  scheduleName: string;
  projectId: string;
  projectName: string;
  status: "active" | "upcoming";
  startsAt: string | null;
  endsAt: string | null;
}

/**
 * A substitution: `overrideUser`'s pages go to `routeAlertsToUser` between
 * `startsAt` and `endsAt` - or, when `routeAlertsToUser` is null, a skip:
 * nobody is named, and each of their turns goes to the next person in the
 * rotation. `onCallDutyPolicy` is null for a project-wide override, which is
 * the kind the app creates - covering somebody for one policy while leaving
 * them paged by the rest is not what "cover for me" means to the person
 * asking for it.
 */
export interface OnCallOverrideItem {
  _id: string;
  projectId: string;
  projectName: string;
  overrideUser: OnCallUserRef | null;
  routeAlertsToUser: OnCallUserRef | null;
  onCallDutyPolicy: { _id?: string; name?: string } | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
}

export interface ProjectUserItem {
  userId: string;
  name: string;
  email: string;
}

/**
 * One page that was sent to the signed-in user, with what triggered it and
 * whether it was acknowledged. `status` is the server's
 * UserNotificationExecutionStatus, kept as a plain string because the app only
 * ever displays it.
 */
export interface OnCallPageItem {
  _id: string;
  projectId: string;
  projectName: string;
  createdAt: string;
  status?: string;
  statusMessage?: string;
  acknowledgedAt: string | null;
  policyName?: string;
  /*
   * A direct page: this person was paged with no on-call policy behind the
   * page - by a workflow's Page Users, Page a Team or Page Whoever Is On Call
   * step. It has no policy to name, and nothing about it is missing.
   */
  isDirectPage?: boolean;
  triggeredByIncident: { _id?: string; title?: string } | null;
  triggeredByAlert: { _id?: string; title?: string } | null;
  triggeredByIncidentEpisode: { _id?: string; title?: string } | null;
  triggeredByAlertEpisode: { _id?: string; title?: string } | null;
}

/*
 * ---------------------------------------------------------------------------
 * On-call calendar feeds (`/api/on-call-calendar/...`)
 *
 * These shapes mirror the server's JSON contract verbatim: dates are ISO
 * strings, optional keys are simply absent. Nothing here is derived from a
 * Common model because the feed routes are custom endpoints, not CRUD.
 * ---------------------------------------------------------------------------
 */

/**
 * The three ways a calendar app can be pointed at one feed. `webcal` is the
 * link on the webcal:// scheme (servers before the Google Calendar fix sent
 * webcals://, which iOS does not open, so the app rebuilds it); `googleAdd`
 * is the Google Calendar "add by URL" deep link, which only works from a
 * browser.
 */
export interface OnCallCalendarFeedUrls {
  https: string;
  webcal: string;
  googleAdd: string;
}

export interface OnCallCalendarFeedSettings {
  includeCoveringShifts?: boolean;
  includeCoverageGaps?: boolean;
  minimumGapMinutes?: number;
  pastDays: number;
  futureDays: number;
  rotateWhenMemberLeaves?: boolean;
}

/**
 * What the server knows about one feed - personal, per-schedule or
 * project-wide, the payload is the same. `exists` false means nothing has been
 * generated yet; `urls` is null in that case and whenever the server cannot
 * decrypt the token (then `needsRegeneration` is true and the only way forward
 * is a new link).
 */
export interface OnCallCalendarFeedStatus {
  exists: boolean;
  feedId: string | null;
  isEnabled: boolean;
  needsRegeneration: boolean;
  tokenHint: string | null;
  rotatedAt: string | null;
  previousTokenExpiresAt: string | null;
  lastFetchedAt: string | null;
  lastFetchedClient: string | null;
  fetchCount: number;
  lastRenderTruncated: boolean;
  settings: OnCallCalendarFeedSettings;
  urls: OnCallCalendarFeedUrls | null;

  /* Set when the server's HOST is empty or localhost - its links are unusable. */
  hostWarning: string | null;

  /* Set when the server is served over plain http - the link travels in clear. */
  protocolWarning: string | null;
}

/**
 * Present on a shift that exists because of an override: the signed-in user
 * is covering for `originalUserName`. `onCallDutyPolicyId` is set when the
 * override was scoped to one policy.
 */
export interface MyOnCallShiftOverride {
  originalUserId: string;
  originalUserName: string;
  overrideStartsAt: string;
  overrideEndsAt: string;
  onCallDutyPolicyId?: string;
}

/**
 * A shift that only exists inside one escalation policy's context - a
 * policy-scoped override made this user the on-call person for that policy
 * while `globalUserId` still holds the schedule everywhere else.
 */
export interface MyOnCallShiftPolicyVariant {
  policyId: string;
  policyName: string;
  globalUserId: string;
}

export interface MyOnCallShiftPolicy {
  policyId: string;
  policyName: string;
  ruleId: string;
  ruleName: string;
  ruleOrder: number;
}

/**
 * One materialized shift from `GET /api/on-call-calendar/my-shifts` - the
 * server's own expansion of the schedule, with overrides applied, so unlike
 * `OnCallShift` it is not limited to "current and next" per schedule.
 */
export interface MyOnCallShift {
  shiftKey: string;
  contentHash: string;
  projectId: string;
  projectName?: string;
  scheduleId: string;
  scheduleName: string;
  scheduleTimezone: string | null;
  userId: string;
  userName: string;
  start: string;
  end: string;
  coverageSeconds: number;
  layerId?: string;
  layerName?: string;
  override?: MyOnCallShiftOverride;
  policyVariantOf?: MyOnCallShiftPolicyVariant;
  policies: MyOnCallShiftPolicy[];
  isPast: boolean;
  lastModifiedAt: string;
  shiftConfigVersion: number;
}

export interface MyOnCallShiftsResponse {
  shifts: MyOnCallShift[];

  /* True when the server hit its expansion cap and the list is incomplete. */
  truncated: boolean;

  generatedAt: string;
}

/*
 * ---------------------------------------------------------------------------
 * Security cases (`/api/security-case/...`)
 *
 * The parts of Security Events a paged analyst works from a phone: the case,
 * its project's statuses and priorities, its timeline and notes, and the
 * playbook runs waiting for somebody to approve a step. Column names come
 * from Common's models, so a renamed column fails to compile here.
 * ---------------------------------------------------------------------------
 */

/*
 * A colour as the API hands it back: a Color serialized as { _type, value },
 * or already a hex string (utils/color reads both).
 */
export type SerializedColor =
  | ColorField
  | string
  | { _type?: string; value?: string }
  | null;

type SecurityCaseStatusFromCommon = RequiredModelFields<
  SecurityCaseStatusModel,
  "_id" | "name"
>;

export interface SecurityCaseStatusItem extends SecurityCaseStatusFromCommon {
  color?: SerializedColor;
  order?: number | string | null;
  createdAt?: string | null;
  isNewStatus?: boolean | null;
  isAcknowledgedStatus?: boolean | null;
  isContainedStatus?: boolean | null;
  isClosedStatus?: boolean | null;
  isArchived?: boolean | null;
}

type SecurityCasePriorityFromCommon = RequiredModelFields<
  SecurityCasePriorityModel,
  "_id" | "name"
>;

export interface SecurityCasePriorityItem
  extends SecurityCasePriorityFromCommon {
  color?: SerializedColor;
  order?: number | string | null;
  createdAt?: string | null;
  isCriticalPriority?: boolean | null;
  isHighPriority?: boolean | null;
  isMediumPriority?: boolean | null;
  isLowPriority?: boolean | null;
  isInformationalPriority?: boolean | null;
  isArchived?: boolean | null;
}

// A person on a case, as a relation read hands them back.
export interface SecurityCasePersonRef {
  _id: string;
  // API values are serialized data, never Common's Name or Email instances.
  name?: string | { _type?: string; value?: string } | null;
  email?: string | { _type?: string; value?: string } | null;
}

type SecurityCaseFromCommon = RequiredModelFields<
  SecurityCaseModel,
  "_id" | "title"
>;

export interface SecurityCaseItem extends SecurityCaseFromCommon {
  caseNumber?: number | null;
  caseNumberWithPrefix?: string | null;
  description?: string | null;
  securityCaseStatusId?: string | null;
  securityCaseStatus?: SecurityCaseStatusItem | null;
  securityCasePriorityId?: string | null;
  securityCasePriority?: SecurityCasePriorityItem | null;
  assignedToUserId?: string | null;
  assignedToUser?: SecurityCasePersonRef | null;
  assignedToTeamId?: string | null;
  assignedToTeam?: { _id: string; name?: string | null } | null;
  source?: string | null;
  entities?: unknown;
  detectionCount?: number | null;
  firstDetectedAt?: string | null;
  lastDetectedAt?: string | null;
  acknowledgedAt?: string | null;
  containedAt?: string | null;
  closedAt?: string | null;
  verdict?: string | null;
  closingNote?: string | null;
  aiVerdict?: string | null;
  aiSuggestedSecurityCasePriorityId?: string | null;
  aiTriageReport?: string | null;
  aiTriagedAt?: string | null;
  aiTriagePromptInjectionSuspected?: boolean | null;
  incidentId?: string | null;
  createdAt: string;
  projectId?: string;
}

export type ProjectSecurityCaseItem = WithProject<SecurityCaseItem>;

// One entry of a case's timeline, with what kind of event it records.
export interface SecurityCaseFeedItem extends FeedItem {
  securityCaseFeedEventType?: string | null;
}

type SecurityPlaybookRunFromCommon = RequiredModelFields<
  SecurityPlaybookRunModel,
  "_id"
>;

export interface SecurityPlaybookRunItem extends SecurityPlaybookRunFromCommon {
  securityCaseId?: string | null;
  playbookName?: string | null;
  status?: string | null;
  trigger?: string | null;
  steps?: unknown;
  stepResults?: unknown;
  currentStepIndex?: number | null;
  triggeredByUserId?: string | null;
  triggeredByUser?: SecurityCasePersonRef | null;
  startedAt?: string | null;
  createdAt?: string | null;
}
