import { formatNameList } from "../AiAccess/AiAccessModes";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  OPSGENIE_REGION_EU,
  OPSGENIE_REGION_US,
  PAGERDUTY_REGION_EU,
  PAGERDUTY_REGION_US,
} from "Common/Types/ToolImport/ToolImportCatalog";
import {
  ToolImportNote,
  ToolImportNoteCode,
  ToolImportNoteValue,
} from "Common/Types/ToolImport/ToolImportNote";
import {
  ToolImportAction,
  ToolImportItemSummary,
  ToolImportOutcome,
} from "Common/Types/ToolImport/ToolImportPlan";
import ToolImportResourceKind, {
  isToolImportResourceKind,
} from "Common/Types/ToolImport/ToolImportResourceKind";
import ToolImportRunStatus from "Common/Types/ToolImport/ToolImportRunStatus";
import ToolImportSource from "Common/Types/ToolImport/ToolImportSource";
import {
  composedValue,
  PluralTemplate,
  TemplateValue,
  TemplateValues,
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * EVERY WORD THE IMPORT PAGE SAYS ABOUT A TOOL, AN ITEM OR A RUN.
 *
 * The server says what happened as codes and values (ToolImportNote), never
 * as sentences; this module words them. Each template is a whole sentence
 * with {{placeholders}}, looked up as one key (translateTemplate), so a
 * language puts each value where its grammar wants it. Constants are wrapped
 * in translationKey, and plurals are plain { one, other } literals, so
 * `npm run i18n:extract` finds every one of them.
 *
 * React-free: the App tests read it, and hold every note code, kind, action,
 * outcome, status and tool to a sentence here.
 */

// A section's title: what the kind is called in OneUptime.
export const TOOL_IMPORT_KIND_TITLES: Record<ToolImportResourceKind, string> = {
  [ToolImportResourceKind.Person]: translationKey("People"),
  [ToolImportResourceKind.Team]: translationKey("Teams"),
  [ToolImportResourceKind.Service]: translationKey("Services"),
  [ToolImportResourceKind.IncidentSeverity]: translationKey(
    "Incident Severities",
  ),
  [ToolImportResourceKind.IncidentState]: translationKey("Incident States"),
  [ToolImportResourceKind.IncidentRole]: translationKey("Incident Roles"),
  [ToolImportResourceKind.IncidentCustomField]: translationKey(
    "Incident Custom Fields",
  ),
  [ToolImportResourceKind.OnCallSchedule]: translationKey("On-Call Schedules"),
  [ToolImportResourceKind.OnCallPolicy]: translationKey("On-Call Policies"),
  [ToolImportResourceKind.Monitor]: translationKey("Monitors"),
  [ToolImportResourceKind.StatusPage]: translationKey("Status Pages"),
  [ToolImportResourceKind.StatusPageSubscriber]: translationKey("Subscribers"),
};

/*
 * The kind in the middle of a sentence ("The API key cannot read on-call
 * schedules"), passed as a translatableTerm so it is cased the reader's way.
 */
export const TOOL_IMPORT_KIND_TERMS: Record<ToolImportResourceKind, string> = {
  [ToolImportResourceKind.Person]: translationKey("people"),
  [ToolImportResourceKind.Team]: translationKey("teams"),
  [ToolImportResourceKind.Service]: translationKey("services"),
  [ToolImportResourceKind.IncidentSeverity]: translationKey(
    "incident severities",
  ),
  [ToolImportResourceKind.IncidentState]: translationKey("incident states"),
  [ToolImportResourceKind.IncidentRole]: translationKey("incident roles"),
  [ToolImportResourceKind.IncidentCustomField]: translationKey(
    "incident custom fields",
  ),
  [ToolImportResourceKind.OnCallSchedule]: translationKey("on-call schedules"),
  [ToolImportResourceKind.OnCallPolicy]: translationKey("on-call policies"),
  [ToolImportResourceKind.Monitor]: translationKey("monitors"),
  [ToolImportResourceKind.StatusPage]: translationKey("status pages"),
  [ToolImportResourceKind.StatusPageSubscriber]: translationKey("subscribers"),
};

// One line under a section's title: what each item becomes in OneUptime.
export const TOOL_IMPORT_KIND_DESCRIPTIONS: Record<
  ToolImportResourceKind,
  string
> = {
  [ToolImportResourceKind.Person]: translationKey(
    "Matched by email address. Anyone who is not in this project yet is invited to it.",
  ),
  [ToolImportResourceKind.Team]: translationKey(
    "Created with their members. A team whose name OneUptime already has is used as it is.",
  ),
  [ToolImportResourceKind.Service]: translationKey(
    "Created in the service catalog, owned by their team when the tool names one.",
  ),
  [ToolImportResourceKind.IncidentSeverity]: translationKey(
    "Created when OneUptime has none of the same name.",
  ),
  [ToolImportResourceKind.IncidentState]: translationKey(
    "Statuses an incident is worked in are created between Acknowledged and Resolved.",
  ),
  [ToolImportResourceKind.IncidentRole]: translationKey(
    "The lead role is matched to OneUptime's Incident Commander. Other roles are created.",
  ),
  [ToolImportResourceKind.IncidentCustomField]: translationKey(
    "Created with their type and options.",
  ),
  [ToolImportResourceKind.OnCallSchedule]: translationKey(
    "Each rotation becomes a layer with the same people, turns and hours.",
  ),
  [ToolImportResourceKind.OnCallPolicy]: translationKey(
    "Each step becomes an escalation rule that pages the same schedules, people and teams.",
  ),
  [ToolImportResourceKind.Monitor]: translationKey(
    "Each check becomes a monitor of the same type, checked by your project's probes with the same rules for up and down.",
  ),
  [ToolImportResourceKind.StatusPage]: translationKey(
    "Created with their groups and the monitors they show.",
  ),
  [ToolImportResourceKind.StatusPageSubscriber]: translationKey(
    "People who get a status page's updates by email. They start unticked: tick them only if you may move their subscriptions.",
  ),
};

// What each monitor type an import creates is called.
export const TOOL_IMPORT_MONITOR_TYPE_LABELS: Partial<
  Record<MonitorType, string>
> = {
  [MonitorType.Website]: translationKey("Website"),
  [MonitorType.API]: translationKey("API"),
  [MonitorType.Ping]: translationKey("Ping"),
  [MonitorType.Port]: translationKey("Port"),
  [MonitorType.SSLCertificate]: translationKey("SSL Certificate"),
  [MonitorType.DNS]: translationKey("DNS"),
  [MonitorType.IncomingRequest]: translationKey("Incoming Request"),
  [MonitorType.Manual]: translationKey("Manual"),
};

// The badge on an item in the preview.
export const TOOL_IMPORT_ACTION_LABELS: Record<ToolImportAction, string> = {
  [ToolImportAction.Create]: translationKey("New"),
  [ToolImportAction.Invite]: translationKey("Invite"),
  [ToolImportAction.Match]: translationKey("Already in OneUptime"),
  [ToolImportAction.AlreadyImported]: translationKey("Imported before"),
  [ToolImportAction.Skip]: translationKey("Not brought over"),
};

// The badge on an item in the report, and the counts at its top.
export const TOOL_IMPORT_OUTCOME_LABELS: Record<ToolImportOutcome, string> = {
  [ToolImportOutcome.Created]: translationKey("Created"),
  [ToolImportOutcome.Invited]: translationKey("Invited"),
  [ToolImportOutcome.Matched]: translationKey("Already in OneUptime"),
  [ToolImportOutcome.AlreadyImported]: translationKey("Imported before"),
  [ToolImportOutcome.Skipped]: translationKey("Not brought over"),
  [ToolImportOutcome.Failed]: translationKey("Failed"),
};

export const TOOL_IMPORT_STATUS_LABELS: Record<ToolImportRunStatus, string> = {
  [ToolImportRunStatus.Reading]: translationKey("Reading"),
  [ToolImportRunStatus.ReadyToReview]: translationKey("Waiting for review"),
  [ToolImportRunStatus.Importing]: translationKey("Importing"),
  [ToolImportRunStatus.Completed]: translationKey("Done"),
  [ToolImportRunStatus.Failed]: translationKey("Failed"),
  [ToolImportRunStatus.Cancelled]: translationKey("Discarded"),
  [ToolImportRunStatus.Expired]: translationKey("Expired"),
};

// The custom field types an import creates, as the page names them.
export const TOOL_IMPORT_FIELD_TYPE_LABELS: Partial<
  Record<CustomFieldType, string>
> = {
  [CustomFieldType.Text]: translationKey("Text"),
  [CustomFieldType.Number]: translationKey("Number"),
  [CustomFieldType.Dropdown]: translationKey("Dropdown"),
  [CustomFieldType.MultiSelectDropdown]: translationKey(
    "Multi-select dropdown",
  ),
};

/*
 * Every note, as a whole sentence. {{tool}} is the tool's name; {{kind}} a
 * kind in the middle of a sentence; {{date}} a date written the reader's
 * way; the rest are names, numbers and the tool's own words.
 */
export const TOOL_IMPORT_NOTE_TEMPLATES: Record<ToolImportNoteCode, string> = {
  [ToolImportNoteCode.PersonNoEmail]: translationKey(
    "They have no email address in {{tool}}, so they cannot be invited.",
  ),
  [ToolImportNoteCode.PersonDeactivated]: translationKey(
    "They are deactivated in {{tool}}.",
  ),
  [ToolImportNoteCode.PersonNotInvited]: translationKey(
    "Not invited: there is no team you may add new people to.",
  ),
  [ToolImportNoteCode.NoPermission]: translationKey(
    "You do not have permission to bring this over.",
  ),
  [ToolImportNoteCode.NeedsPlan]: translationKey(
    "Bringing this over needs the {{plan}} plan.",
  ),
  [ToolImportNoteCode.OverLimit]: translationKey(
    "One import brings over at most {{limit}} of these. Run the import again for the rest.",
  ),
  [ToolImportNoteCode.NothingToPage]: translationKey(
    "It pages nobody who is being brought over.",
  ),
  [ToolImportNoteCode.PolicyTemplated]: translationKey(
    "It is built from an escalation path template, which {{tool}}'s API does not return. Create it in OneUptime.",
  ),
  [ToolImportNoteCode.StateNotNeeded]: translationKey(
    "OneUptime has no state for {{tool}}'s {{category}} statuses.",
  ),
  [ToolImportNoteCode.RoleReporter]: translationKey(
    "OneUptime records who declared each incident, so it needs no role for it.",
  ),
  [ToolImportNoteCode.CustomFieldFromCatalog]: translationKey(
    "Its options come from {{tool}}'s catalog, which OneUptime does not have.",
  ),
  [ToolImportNoteCode.CustomFieldTypeNotSupported]: translationKey(
    "OneUptime has no custom field of this type.",
  ),
  [ToolImportNoteCode.NotSelected]: translationKey("It was not ticked."),
  [ToolImportNoteCode.StoppedPartWay]: translationKey(
    "The import stopped while creating this. Check it in OneUptime.",
  ),
  [ToolImportNoteCode.PersonAlreadyMember]: translationKey(
    "They are already in this project.",
  ),
  [ToolImportNoteCode.NameExists]: translationKey(
    "OneUptime already has {{name}}, so it is used as it is.",
  ),
  [ToolImportNoteCode.TeamNameExists]: translationKey(
    "OneUptime already has a team of this name. It is used as it is, and its members are left as they are.",
  ),
  [ToolImportNoteCode.AlreadyImported]: translationKey(
    "An earlier import brought this over.",
  ),
  [ToolImportNoteCode.StateMatchedToCreated]: translationKey(
    "OneUptime starts every incident in {{state}}.",
  ),
  [ToolImportNoteCode.StateMatchedToResolved]: translationKey(
    "Matched to {{state}}, where incidents are resolved in OneUptime.",
  ),
  [ToolImportNoteCode.RoleMatchedToPrimary]: translationKey(
    "Matched to {{role}}, who leads every incident in OneUptime.",
  ),
  [ToolImportNoteCode.ImportedBeforeDeletedSince]: translationKey(
    "An earlier import brought this over and it was deleted since, so it will be created again.",
  ),
  [ToolImportNoteCode.TurnedOffInSource]: translationKey(
    "It is turned off in {{tool}}, so it starts unticked.",
  ),
  [ToolImportNoteCode.NotOnAnything]: translationKey(
    "They are not on any team, schedule or policy being brought over, so they start unticked.",
  ),
  [ToolImportNoteCode.ScheduleSplit]: translationKey(
    "People in its rotations are on call at the same time, and a OneUptime schedule has one person on call at a time. It becomes {{count}} schedules, and every policy that pages it pages all of them.",
  ),
  [ToolImportNoteCode.TimezoneUnknown]: translationKey(
    "OneUptime does not know the time zone {{timezone}}, so the schedule uses UTC.",
  ),
  [ToolImportNoteCode.RotationEnded]: translationKey(
    "{{rotation}} ended on {{date}}, so it is left out.",
  ),
  [ToolImportNoteCode.RotationEnds]: translationKey(
    "{{rotation}} ends on {{date}} in {{tool}}. Layers in OneUptime do not end, so remove it then.",
  ),
  [ToolImportNoteCode.RotationNotStarted]: translationKey(
    "{{rotation}} starts on {{date}}.",
  ),
  [ToolImportNoteCode.RotationGaps]: translationKey(
    "{{rotation}} has turns where nobody is on call. They are left out, so turns come round sooner.",
  ),
  [ToolImportNoteCode.RotationNonPersonTurns]: translationKey(
    "{{rotation}} has turns taken by a team or an escalation, which a layer in OneUptime cannot have. They are left out.",
  ),
  [ToolImportNoteCode.RotationUnevenShifts]: translationKey(
    "{{rotation}} has shifts of different lengths. Every shift takes the length of the first.",
  ),
  [ToolImportNoteCode.RotationScheduledChange]: translationKey(
    "A change to {{rotation}} scheduled for {{date}} is not brought over.",
  ),
  [ToolImportNoteCode.RotationLayers]: translationKey(
    "{{rotation}} has {{count}} people on call at once. Each of them becomes a schedule of its own.",
  ),
  [ToolImportNoteCode.RotationNobody]: translationKey(
    "Nobody in {{rotation}} is being brought over, so it is left out.",
  ),
  [ToolImportNoteCode.RotationOneOff]: translationKey(
    "{{rotation}} is a one-off shift, not a rotation, so it is left out.",
  ),
  [ToolImportNoteCode.RotationApproximated]: translationKey(
    "{{rotation}} hands over in a way a OneUptime layer cannot, so it comes over as close as OneUptime gets. Check its turns after the import.",
  ),
  [ToolImportNoteCode.RotationTimezoneConverted]: translationKey(
    "{{rotation}} keeps {{timezone}} time. Its hours come over in the schedule's time zone as they are today, so they can move by an hour when daylight saving time changes.",
  ),
  [ToolImportNoteCode.ScheduleFromCalendarLink]: translationKey(
    "Its shifts come from a calendar link, which OneUptime cannot read. It comes over without layers, so add them in OneUptime.",
  ),
  [ToolImportNoteCode.PolicyFirstStepWaits]: translationKey(
    "Its first step waits {{minutes}} minutes in {{tool}}. OneUptime pages it right away.",
  ),
  [ToolImportNoteCode.PolicyWaitsForClose]: translationKey(
    "Some steps wait until the alert is closed. OneUptime moves on when nobody acknowledges.",
  ),
  [ToolImportNoteCode.PolicyNextOnCall]: translationKey(
    "A step pages whoever is on call next. OneUptime pages whoever is on call now.",
  ),
  [ToolImportNoteCode.PolicyTeamAdmins]: translationKey(
    "A step pages a team's admins. OneUptime pages every member of the team.",
  ),
  [ToolImportNoteCode.PolicyBranch]: translationKey(
    "It branches on {{condition}}. Only the first branch is brought over.",
  ),
  [ToolImportNoteCode.PolicyChannelStep]: translationKey(
    "Steps that post to a Slack or Microsoft Teams channel are left out. Workspace notification rules do that in OneUptime.",
  ),
  [ToolImportNoteCode.PolicyHandsOver]: translationKey(
    "A step hands over to another escalation path, which OneUptime cannot do. It is left out.",
  ),
  [ToolImportNoteCode.PolicyRoundRobin]: translationKey(
    "A step pages its people in turn. OneUptime pages everyone in the step at once.",
  ),
  [ToolImportNoteCode.PolicyLevelRepeats]: translationKey(
    "A step pages its people more than once. OneUptime pages them once, and the whole policy can repeat.",
  ),
  [ToolImportNoteCode.PolicyWorkingHours]: translationKey(
    "A wait depends on working hours. OneUptime waits a fixed time.",
  ),
  [ToolImportNoteCode.PolicyRepeatsFromLater]: translationKey(
    "It repeats from a later step. OneUptime repeats the whole policy.",
  ),
  [ToolImportNoteCode.PolicyFreePlanOneLevel]: translationKey(
    "On the Free plan a policy has one escalation rule, so only one step comes over: the first that pages someone being brought over.",
  ),
  [ToolImportNoteCode.PolicyLevelLeftOut]: translationKey(
    "Step {{level}} pages nobody who is being brought over, so it is left out.",
  ),
  [ToolImportNoteCode.PolicyUnknownTarget]: translationKey(
    "A step pages something OneUptime cannot page. It is left out.",
  ),
  [ToolImportNoteCode.PolicyWebhookStep]: translationKey(
    "A step calls a webhook. Workflows do that in OneUptime, so it is left out.",
  ),
  [ToolImportNoteCode.PolicyRunsAnotherPolicy]: translationKey(
    "A step runs another escalation policy, which OneUptime cannot do. It is left out.",
  ),
  [ToolImportNoteCode.PolicyResolvesAlert]: translationKey(
    "A step resolves the alert on its own. OneUptime leaves that to the people paged, so it is left out.",
  ),
  [ToolImportNoteCode.PolicyEmailAddress]: translationKey(
    "A step emails an address that is none of the people being brought over. It is left out.",
  ),
  [ToolImportNoteCode.PolicyUserGroup]: translationKey(
    "A step pages a Slack user group, which OneUptime cannot page. It is left out.",
  ),
  [ToolImportNoteCode.PolicyDeclaresIncident]: translationKey(
    "A step declares an incident. OneUptime declares incidents from monitors and alerts, so it is left out.",
  ),
  [ToolImportNoteCode.PolicyConditionalStep]: translationKey(
    "A step goes on only at certain times or alert counts. OneUptime always goes on to the next step.",
  ),
  [ToolImportNoteCode.PolicyScheduleNotRead]: translationKey(
    "A step pages a schedule the import could not read, so that part is left out.",
  ),
  [ToolImportNoteCode.PersonLeftOut]: translationKey(
    "{{name}} is not being brought over, so they are left out.",
  ),
  [ToolImportNoteCode.TeamLeftOut]: translationKey(
    "The team {{name}} is not being brought over, so it is left out.",
  ),
  [ToolImportNoteCode.ScheduleLeftOut]: translationKey(
    "The schedule {{name}} is not being brought over, so it is left out.",
  ),
  [ToolImportNoteCode.CustomFieldOptionsTrimmed]: translationKey(
    "Only its first {{count}} options come over.",
  ),
  [ToolImportNoteCode.PartNotAdded]: translationKey(
    "{{name}} could not be added: {{error}}",
  ),
  [ToolImportNoteCode.CouldNotRead]: translationKey(
    "The API key cannot read {{kind}}, so none are shown.",
  ),
  [ToolImportNoteCode.ReadIncomplete]: translationKey(
    "{{tool}} did not return all of its {{kind}}.",
  ),
  [ToolImportNoteCode.ReadLimitReached]: translationKey(
    "There are more {{kind}} than one import reads. The first {{limit}} are shown.",
  ),
  [ToolImportNoteCode.ShiftBasedSchedulesNotRead]: translationKey(
    "{{tool}}'s shift-based schedules cannot be read yet, so they are not shown. Create them in OneUptime.",
  ),
  [ToolImportNoteCode.MonitorTypeNotSupported]: translationKey(
    "OneUptime has no monitor that does what {{tool}}'s {{type}} checks do, so it is left out.",
  ),
  [ToolImportNoteCode.MonitorAddressUnreadable]: translationKey(
    "OneUptime cannot read its address, {{address}}, so it is left out.",
  ),
  [ToolImportNoteCode.MonitorUpsideDown]: translationKey(
    "It counts as up when its check fails in {{tool}}, which no OneUptime monitor does, so it is left out.",
  ),
  [ToolImportNoteCode.MonitorNeedsPaymentMethod]: translationKey(
    "Monitors have usage charges, even on the Free plan. Add a payment method in Project Settings, then Billing, to bring them over.",
  ),
  [ToolImportNoteCode.MonitorPlanLimit]: translationKey(
    "The Free plan has room for {{limit}} monitors, and this project has no room left for this one. Upgrade the plan to bring it over.",
  ),
  [ToolImportNoteCode.StatusPagePlanLimit]: translationKey(
    "The Free plan has room for {{limit}} status pages, and this project has no room left for this one. Upgrade the plan to bring it over.",
  ),
  [ToolImportNoteCode.SubscriberPlanLimit]: translationKey(
    "The Free plan has room for {{limit}} subscribers, and this project has no room left for them. Upgrade the plan to bring them over.",
  ),
  [ToolImportNoteCode.SubscriberNotConfirmed]: translationKey(
    "They never confirmed their subscription in {{tool}}, so they are left out.",
  ),
  [ToolImportNoteCode.SubscriberPageLeftOut]: translationKey(
    "Their status page is not being brought over, so they are left out.",
  ),
  [ToolImportNoteCode.SubscriberNotConsented]: translationKey(
    "Subscribers come over only when you confirm that you may move them, so they are left out.",
  ),
  [ToolImportNoteCode.MonitorAlreadyChecked]: translationKey(
    "OneUptime already checks this with {{name}}, so that monitor is used as it is.",
  ),
  [ToolImportNoteCode.SubscriberAlreadySubscribed]: translationKey(
    "They already get this status page's updates.",
  ),
  [ToolImportNoteCode.MonitorIntervalChanged]: translationKey(
    "{{tool}} checks it every {{every}}. OneUptime checks it every {{oneUptimeEvery}}, the closest it offers.",
  ),
  [ToolImportNoteCode.MonitorTimeoutShortened]: translationKey(
    "{{tool}} waits {{timeout}} for an answer. OneUptime waits at most a minute.",
  ),
  [ToolImportNoteCode.MonitorHeaderLeftOut]: translationKey(
    "Its {{header}} header may hold a secret, so it is not copied. Add it to the monitor with a monitor secret.",
  ),
  [ToolImportNoteCode.MonitorSignInLeftOut]: translationKey(
    "It signs in with a password in {{tool}}. Passwords are not copied: add it to the monitor with a monitor secret.",
  ),
  [ToolImportNoteCode.MonitorBodyLeftOut]: translationKey(
    "Its request body is not a JSON object, the only kind OneUptime sends, so it is left out.",
  ),
  [ToolImportNoteCode.MonitorPaused]: translationKey(
    "It is paused in {{tool}}, so it starts unticked, and comes over paused.",
  ),
  [ToolImportNoteCode.MonitorNewHeartbeatAddress]: translationKey(
    "It gets a new address in OneUptime. Once it is imported, open it, copy its address, and point the job that pings it there.",
  ),
  [ToolImportNoteCode.MonitorKeywordCaseSensitive]: translationKey(
    "OneUptime matches its keyword exactly, capital letters included.",
  ),
  [ToolImportNoteCode.MonitorChecksPortOnly]: translationKey(
    "OneUptime checks that its port answers, not the {{protocol}} conversation on it.",
  ),
  [ToolImportNoteCode.MonitorAssertionsLeftOut]: translationKey(
    "The checks it makes on what the answer says are not brought over. Add them as criteria in OneUptime.",
  ),
  [ToolImportNoteCode.MonitorDnsAnswersLeftOut]: translationKey(
    "The answers it expects are not brought over. Add them as criteria in OneUptime.",
  ),
  [ToolImportNoteCode.MonitorStatusNotCopied]: translationKey(
    "It is not shown as operational in {{tool}} right now. It comes over operational: change its status in OneUptime when you switch.",
  ),
  [ToolImportNoteCode.StatusPagePrivate]: translationKey(
    "Only some people may see it in {{tool}}. It comes over private: choose who may see it in OneUptime.",
  ),
  [ToolImportNoteCode.StatusPageCustomDomain]: translationKey(
    "{{domain}} does not come over. Add it under Custom Domains in OneUptime, then point it at OneUptime.",
  ),
  [ToolImportNoteCode.StatusPageBrandingLeftOut]: translationKey(
    "Its logo and colors do not come over. Add them under Branding in OneUptime.",
  ),
  [ToolImportNoteCode.StatusPageResourceNotSupported]: translationKey(
    "{{name}} shows something a OneUptime status page cannot show, so it is left out.",
  ),
  [ToolImportNoteCode.StatusPageMonitorLeftOut]: translationKey(
    "The monitor {{name}} is not being brought over, so the page does not show it.",
  ),
  [ToolImportNoteCode.StatusPageSubscriberChoiceNeedsPlan]: translationKey(
    "Its visitors choose the parts they follow. That needs the {{plan}} plan, so it comes over without the choice: new subscribers follow the whole page.",
  ),
  [ToolImportNoteCode.StatusPageGroupsNeedPlan]: translationKey(
    "Groups on a status page need the {{plan}} plan, so it comes over without them: everything it shows is listed on its own.",
  ),
  [ToolImportNoteCode.StatusPageGroupsNotAllowed]: translationKey(
    "You may not add groups to a status page, so it comes over without them: everything it shows is listed on its own.",
  ),
  [ToolImportNoteCode.SubscribersLeftOut]: translationKey(
    "{{count}} of its subscribers get updates by text message, webhook, Slack or Microsoft Teams. Only email subscribers come over.",
  ),
  [ToolImportNoteCode.SubscriberFollowsWholePage]: translationKey(
    "Not every part of the page they follow is being brought over, so they get updates about the whole page.",
  ),
  [ToolImportNoteCode.MaintenanceWindowsNotRead]: translationKey(
    "{{tool}} has {{count}} maintenance windows. They do not come over: plan them as scheduled maintenance in OneUptime.",
  ),
  [ToolImportNoteCode.MonitorsFromMetricsFile]: translationKey(
    "This file is Uptime Kuma's metrics page, which does not say how often each monitor is checked or what it looks for. They come over checked every 5 minutes: check each one after the import.",
  ),
};

/*
 * How long something takes, in the largest whole unit: "30 seconds",
 * "5 minutes", "2 hours", "1 day".
 */
export const TOOL_IMPORT_DURATIONS: {
  seconds: PluralTemplate;
  minutes: PluralTemplate;
  hours: PluralTemplate;
  days: PluralTemplate;
} = {
  seconds: {
    one: "{{count}} second",
    other: "{{count}} seconds",
  },
  minutes: {
    one: "{{count}} minute",
    other: "{{count}} minutes",
  },
  hours: {
    one: "{{count}} hour",
    other: "{{count}} hours",
  },
  days: {
    one: "{{count}} day",
    other: "{{count}} days",
  },
};

// The note values that are a number of seconds, written as a duration.
const DURATION_VALUES: ReadonlyArray<string> = [
  "every",
  "oneUptimeEvery",
  "timeout",
];

export function describeToolImportDuration(
  seconds: number,
  translator: Translator,
): string {
  const whole: number = Math.max(0, Math.round(seconds));

  if (whole % 86400 === 0 && whole >= 86400) {
    return translator.translatePlural(
      TOOL_IMPORT_DURATIONS.days,
      whole / 86400,
    );
  }

  if (whole % 3600 === 0 && whole >= 3600) {
    return translator.translatePlural(
      TOOL_IMPORT_DURATIONS.hours,
      whole / 3600,
    );
  }

  if (whole % 60 === 0 && whole >= 60) {
    return translator.translatePlural(
      TOOL_IMPORT_DURATIONS.minutes,
      whole / 60,
    );
  }

  return translator.translatePlural(TOOL_IMPORT_DURATIONS.seconds, whole);
}

/*
 * A duration put into a sentence, worded in that sentence's language: a
 * locale without the sentence reads it all in English, duration included.
 */
export function durationValue(seconds: number): TemplateValue {
  return composedValue((translator: Translator): string => {
    return describeToolImportDuration(seconds, translator);
  });
}

/*
 * What the page says about a tool: one line for the picker, the steps to
 * make the API key the import reads with (in the tool's own words for its
 * screens), and - for a tool with regions - how to tell which one an
 * account is in.
 */
export interface ToolImportRegionCopy {
  title: string;
  description: string;
}

export interface ToolImportToolCopy {
  description: string;
  keySteps: Array<string>;
  keyLabel: string;
  // The label of the key's ID, for a tool that pairs one with the key.
  keyIdLabel?: string | undefined;
  // The label of the API's address, for a tool whose address the person gives.
  apiUrlLabel?: string | undefined;
  regionQuestion?: string | undefined;
  // Keyed by the region's value in the catalog.
  regions?: Record<string, ToolImportRegionCopy> | undefined;
}

export const TOOL_IMPORT_TOOL_COPY: Record<
  ToolImportSource,
  ToolImportToolCopy
> = {
  [ToolImportSource.OpsGenie]: {
    description: translationKey(
      "People, teams, on-call schedules, escalations and services.",
    ),
    keySteps: [
      translationKey(
        "In Opsgenie, go to Settings, then API key management, and select Add new API key.",
      ),
      translationKey(
        "Name it OneUptime import and give it Read and Configuration access only. The import never changes anything in Opsgenie.",
      ),
      translationKey("Copy the key and paste it here."),
    ],
    keyLabel: translationKey("Opsgenie API key"),
    regionQuestion: translationKey("Where is your Opsgenie account?"),
    regions: {
      [OPSGENIE_REGION_US]: {
        title: translationKey("United States"),
        description: translationKey("You sign in at app.opsgenie.com."),
      },
      [OPSGENIE_REGION_EU]: {
        title: translationKey("Europe"),
        description: translationKey("You sign in at app.eu.opsgenie.com."),
      },
    },
  },
  [ToolImportSource.PagerDuty]: {
    description: translationKey(
      "People, teams, schedules with their layers, escalation policies and services.",
    ),
    keySteps: [
      translationKey(
        "In PagerDuty, go to Integrations, then Developer Tools, then API Access Keys, and select Create New API Key.",
      ),
      translationKey(
        "Describe it as OneUptime import, tick Read-only API Key, and select Create Key. The import never changes anything in PagerDuty.",
      ),
      translationKey("Copy the key and paste it here."),
    ],
    keyLabel: translationKey("PagerDuty API key"),
    regionQuestion: translationKey("Where is your PagerDuty account?"),
    regions: {
      [PAGERDUTY_REGION_US]: {
        title: translationKey("United States"),
        description: translationKey(
          "You sign in at yourcompany.pagerduty.com.",
        ),
      },
      [PAGERDUTY_REGION_EU]: {
        title: translationKey("Europe"),
        description: translationKey(
          "You sign in at yourcompany.eu.pagerduty.com.",
        ),
      },
    },
  },
  [ToolImportSource.IncidentIo]: {
    description: translationKey(
      "People, teams, schedules, escalation paths, services and incident settings.",
    ),
    keySteps: [
      translationKey(
        "In incident.io, go to Settings, then API keys, and select Add new.",
      ),
      translationKey(
        "Name it OneUptime import and give it only permissions that view data, none that create, edit or manage. The import never changes anything in incident.io.",
      ),
      translationKey("Copy the key and paste it here."),
    ],
    keyLabel: translationKey("incident.io API key"),
  },
  [ToolImportSource.SplunkOnCall]: {
    description: translationKey(
      "People, teams, rotations and escalation policies.",
    ),
    keySteps: [
      translationKey(
        "In Splunk On-Call, go to Integrations, then API. Your API ID is shown above your API keys.",
      ),
      translationKey(
        "Create a new API key named OneUptime import, with Read-only ticked. The import never changes anything in Splunk On-Call.",
      ),
      translationKey("Copy the API ID and the key and paste them here."),
    ],
    keyIdLabel: translationKey("Splunk On-Call API ID"),
    keyLabel: translationKey("Splunk On-Call API key"),
  },
  [ToolImportSource.GrafanaOnCall]: {
    description: translationKey(
      "People, teams, schedules and their rotations, and escalation chains. Grafana Cloud or your own install.",
    ),
    keySteps: [
      translationKey(
        "In Grafana, open OnCall, then Settings. On Grafana Cloud, open IRM, then Settings, then Admin & API.",
      ),
      translationKey("Copy the OnCall API URL shown there and paste it here."),
      translationKey(
        "Under API tokens, create a token named OneUptime import, and paste it here as the API key. The import never changes anything in Grafana OnCall.",
      ),
    ],
    apiUrlLabel: translationKey("Grafana OnCall API URL"),
    keyLabel: translationKey("Grafana OnCall API key"),
  },
  [ToolImportSource.UptimeRobot]: {
    description: translationKey(
      "Monitors, heartbeats and public status pages.",
    ),
    keySteps: [
      translationKey("In UptimeRobot, go to Integrations & API, then API."),
      translationKey(
        "Create a Read-only API key, or copy the one you have. The import never changes anything in UptimeRobot.",
      ),
      translationKey("Copy the key and paste it here."),
    ],
    keyLabel: translationKey("UptimeRobot API key"),
  },
  [ToolImportSource.AtlassianStatuspage]: {
    description: translationKey(
      "Status pages with their components, groups and email subscribers.",
    ),
    keySteps: [
      translationKey(
        "In Statuspage, select your avatar at the bottom left, then API info. Only an account owner can create a key.",
      ),
      translationKey(
        "Select Create key and name it OneUptime import. The import never changes anything in Atlassian Statuspage.",
      ),
      translationKey("Copy the key and paste it here."),
    ],
    keyLabel: translationKey("Atlassian Statuspage API key"),
  },
  [ToolImportSource.BetterStack]: {
    description: translationKey(
      "Monitors, heartbeats and status pages with their email subscribers.",
    ),
    keySteps: [
      translationKey(
        "In Better Stack, go to API tokens, then Team-based tokens, and select your team.",
      ),
      translationKey(
        "Under Uptime API tokens, create a token named OneUptime import. The import never changes anything in Better Stack.",
      ),
      translationKey("Copy the token and paste it here as the API key."),
    ],
    keyLabel: translationKey("Better Stack API key"),
  },
  [ToolImportSource.Pingdom]: {
    description: translationKey(
      "Uptime checks: HTTP, TCP, ping, DNS and mail server checks.",
    ),
    keySteps: [
      translationKey(
        "In My Pingdom, open Settings, then Pingdom API, and select Add API token.",
      ),
      translationKey(
        "Name it OneUptime import and choose Read access. The import never changes anything in Pingdom.",
      ),
      translationKey("Copy the token and paste it here as the API key."),
    ],
    keyLabel: translationKey("Pingdom API key"),
  },
  [ToolImportSource.StatusCake]: {
    description: translationKey("Uptime, SSL and heartbeat checks."),
    keySteps: [
      translationKey(
        "In StatusCake, open your account panel and go to API Keys.",
      ),
      translationKey(
        "Create a key named OneUptime import. The import never changes anything in StatusCake.",
      ),
      translationKey("Copy the key and paste it here."),
    ],
    keyLabel: translationKey("StatusCake API key"),
  },
  [ToolImportSource.UptimeKuma]: {
    description: translationKey(
      "Monitors, from Uptime Kuma's backup file or its metrics page.",
    ),
    keySteps: [
      translationKey(
        "On Uptime Kuma 1, go to Settings, then Backup, and select Export. Keep the JSON file it saves.",
      ),
      translationKey(
        "On Uptime Kuma 2, which has no export, add an API key under Settings, then API Keys. Open /metrics on your Uptime Kuma, sign in with no user name and the key as the password, and save the page as a text file.",
      ),
      translationKey(
        "Choose the file here. It is read once to find your monitors and is never stored. The import never changes anything in Uptime Kuma.",
      ),
    ],
    keyLabel: translationKey("Uptime Kuma backup or metrics file"),
  },
};

export const TOOL_IMPORT_PLURALS: {
  members: PluralTemplate;
  rotations: PluralTemplate;
  schedules: PluralTemplate;
  steps: PluralTemplate;
  repeats: PluralTemplate;
  options: PluralTemplate;
  ticked: PluralTemplate;
  found: PluralTemplate;
  others: PluralTemplate;
  usesLeftOut: PluralTemplate;
  done: PluralTemplate;
  monitorsShown: PluralTemplate;
  groups: PluralTemplate;
} = {
  members: {
    one: "{{count}} member",
    other: "{{count}} members",
  },
  rotations: {
    one: "{{count}} rotation",
    other: "{{count}} rotations",
  },
  schedules: {
    one: "becomes {{count}} schedule",
    other: "becomes {{count}} schedules",
  },
  steps: {
    one: "{{count}} step",
    other: "{{count}} steps",
  },
  repeats: {
    one: "repeats {{count}} time",
    other: "repeats {{count}} times",
  },
  options: {
    one: "{{count}} option",
    other: "{{count}} options",
  },
  ticked: {
    one: "{{count}} of {{total}} ticked",
    other: "{{count}} of {{total}} ticked",
  },
  found: {
    one: "{{count}} found",
    other: "{{count}} found",
  },
  others: {
    one: "{{count}} other",
    other: "{{count}} others",
  },
  usesLeftOut: {
    one: "It uses {{names}}, which is not being brought over, so that part is left out.",
    other:
      "It uses {{names}}, which are not being brought over, so those parts are left out.",
  },
  done: {
    one: "{{count}} of {{total}} done",
    other: "{{count}} of {{total}} done",
  },
  monitorsShown: {
    one: "shows {{count}} monitor",
    other: "shows {{count}} monitors",
  },
  groups: {
    one: "{{count}} group",
    other: "{{count}} groups",
  },
};

// The report's counts, one phrase per outcome.
export const TOOL_IMPORT_OUTCOME_COUNTS: Record<
  ToolImportOutcome,
  PluralTemplate
> = {
  [ToolImportOutcome.Created]: {
    one: "{{count}} created",
    other: "{{count}} created",
  },
  [ToolImportOutcome.Invited]: {
    one: "{{count}} invited",
    other: "{{count}} invited",
  },
  [ToolImportOutcome.Matched]: {
    one: "{{count}} already in OneUptime",
    other: "{{count}} already in OneUptime",
  },
  [ToolImportOutcome.AlreadyImported]: {
    one: "{{count}} imported before",
    other: "{{count}} imported before",
  },
  [ToolImportOutcome.Skipped]: {
    one: "{{count}} not brought over",
    other: "{{count}} not brought over",
  },
  [ToolImportOutcome.Failed]: {
    one: "{{count}} failed",
    other: "{{count}} failed",
  },
};

/*
 * What the import API answers with when it refuses or stops, word for word,
 * so the page shows it in the reader's language: the form, the report and
 * ErrorMessage look an English message up by its text. A message that names
 * the tool, or passes on what the tool answered, stays as it came. The App
 * tests hold each one to the server's sources.
 */
export const TOOL_IMPORT_SERVER_MESSAGES: ReadonlyArray<string> = [
  translationKey("An item that was chosen is not one of the import's."),
  translationKey(
    "Another import is running in this project. Wait for it to finish, then try again.",
  ),
  translationKey("Choose a team to invite people to."),
  translationKey("Choose a tool to import from."),
  translationKey("Choose the file to read."),
  translationKey("Choose what to bring over."),
  translationKey(
    "Confirm that you may move the subscribers you ticked, or untick them.",
  ),
  translationKey("Only a preview that was not started can be discarded."),
  translationKey(
    "The API key is no longer here. Paste it again to read the tool.",
  ),
  translationKey("The import could not be queued. Try again."),
  translationKey(
    "The import stopped before it finished. Run it again to bring over the rest.",
  ),
  translationKey("There is nothing to preview for this import."),
  translationKey(
    "This import has already started, or is no longer waiting to be started.",
  ),
  translationKey(
    "This file is larger than 10 MB, which is more than an import reads.",
  ),
  translationKey("This import was not found."),
  translationKey(
    "This is not an Uptime Kuma backup or metrics file. Upload the JSON file Settings > Backup > Export gives, or the page /metrics shows.",
  ),
  translationKey(
    "This file is not an Uptime Kuma backup: it has no list of monitors.",
  ),
  translationKey(
    "This file is not an Uptime Kuma backup: it is nested deeper than a backup is.",
  ),
  translationKey(
    "This file is not an Uptime Kuma backup: it is not valid JSON.",
  ),
  translationKey(
    "This metrics file is longer than an Uptime Kuma metrics page can be.",
  ),
  translationKey("This Uptime Kuma file has no monitors in it."),
  translationKey("This tool is read with its API key, not from a file."),
  translationKey(
    "This preview is more than a day old. Read the tool again to import what it has now.",
  ),
  translationKey("Tick at least one thing to bring over."),
  translationKey("Too many items were chosen."),
  translationKey("What was read is no longer here. Read the tool again."),
  translationKey(
    "You are no longer a member of this project, so the import was stopped.",
  ),
  translationKey(
    "You may not create anything an import brings over. Ask a project owner or admin to run the import.",
  ),
];

// A date the server sent (ISO 8601), written the reader's way.
export function formatToolImportDate(value: string, language: string): string {
  const time: number = Date.parse(value);

  if (!Number.isFinite(time)) {
    return value;
  }

  try {
    return new Date(time).toLocaleDateString(language || "en", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return new Date(time).toISOString().slice(0, 10);
  }
}

// A date and time the server sent (ISO 8601), written the reader's way.
export function formatToolImportDateTime(
  value: string,
  language: string,
): string {
  const time: number = Date.parse(value);

  if (!Number.isFinite(time)) {
    return value;
  }

  try {
    return new Date(time).toLocaleString(language || "en", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return new Date(time).toISOString().slice(0, 16).replace("T", " ");
  }
}

function toTemplateValue(
  key: string,
  value: ToolImportNoteValue,
  translator: Translator,
): TemplateValue {
  if (key === "kind" && isToolImportResourceKind(value)) {
    return translatableTerm(TOOL_IMPORT_KIND_TERMS[value], {
      inSentence: true,
    });
  }

  if (key === "date" && typeof value === "string") {
    return formatToolImportDate(value, translator.language);
  }

  if (DURATION_VALUES.includes(key) && typeof value === "number") {
    return durationValue(value);
  }

  if (typeof value === "number") {
    return translator.formatNumber(value);
  }

  return value;
}

/*
 * A note in the reader's language. Values are put in as they are, except a
 * kind (translated with the sentence), a date and a number (written the
 * reader's way). A note this build has no sentence for says nothing.
 */
export function describeToolImportNote(
  note: ToolImportNote,
  translator: Translator,
  toolTitle: string,
): string {
  const template: string | undefined = TOOL_IMPORT_NOTE_TEMPLATES[note.code];

  if (!template) {
    return "";
  }

  const values: TemplateValues = { tool: toolTitle };

  for (const [key, value] of Object.entries(note.values || {})) {
    if (key === "tool") {
      continue;
    }

    values[key] = toTemplateValue(key, value, translator);
  }

  return translator.translateTemplate(template, values);
}

/*
 * "Alice, Bob and Carol", or "Alice, Bob and 7 others" for a longer list:
 * built in the language of the sentence it goes into.
 */
export function namesValue(names: ReadonlyArray<string>): TemplateValue {
  return composedValue((translator: Translator): string => {
    if (names.length <= 3) {
      return formatNameList(names, "and", translator);
    }

    return formatNameList(
      [
        names[0]!,
        names[1]!,
        translator.translatePlural(
          TOOL_IMPORT_PLURALS.others,
          names.length - 2,
        ),
      ],
      "and",
      translator,
    );
  });
}

/*
 * The facts under an item's name, each its own short phrase, joined with a
 * dot: an email address, how many members, rotations, steps or options.
 */
export function describeToolImportSummary(
  kind: ToolImportResourceKind,
  summary: ToolImportItemSummary,
  translator: Translator,
): string {
  const parts: Array<string> = [];

  if (summary.email) {
    parts.push(summary.email);
  }

  if (
    kind === ToolImportResourceKind.Team &&
    summary.memberCount !== undefined
  ) {
    parts.push(
      translator.translatePlural(
        TOOL_IMPORT_PLURALS.members,
        summary.memberCount,
      ),
    );
  }

  if (kind === ToolImportResourceKind.OnCallSchedule) {
    if (summary.layerCount !== undefined) {
      parts.push(
        translator.translatePlural(
          TOOL_IMPORT_PLURALS.rotations,
          summary.layerCount,
        ),
      );
    }

    if (summary.scheduleCount !== undefined && summary.scheduleCount > 1) {
      parts.push(
        translator.translatePlural(
          TOOL_IMPORT_PLURALS.schedules,
          summary.scheduleCount,
        ),
      );
    }

    if (summary.timezone) {
      parts.push(summary.timezone);
    }
  }

  if (kind === ToolImportResourceKind.OnCallPolicy) {
    if (summary.levelCount !== undefined) {
      parts.push(
        translator.translatePlural(
          TOOL_IMPORT_PLURALS.steps,
          summary.levelCount,
        ),
      );
    }

    if (summary.repeatTimes) {
      parts.push(
        translator.translatePlural(
          TOOL_IMPORT_PLURALS.repeats,
          summary.repeatTimes,
        ),
      );
    }
  }

  if (kind === ToolImportResourceKind.Monitor) {
    const typeLabel: string | undefined = summary.monitorType
      ? TOOL_IMPORT_MONITOR_TYPE_LABELS[summary.monitorType]
      : undefined;

    if (typeLabel) {
      parts.push(translator.translateText(typeLabel) || typeLabel);
    }

    if (summary.intervalSeconds) {
      parts.push(
        translator.translateTemplate("every {{duration}}", {
          duration: durationValue(summary.intervalSeconds),
        }),
      );
    }

    if (summary.destination) {
      parts.push(summary.destination);
    }
  }

  if (kind === ToolImportResourceKind.StatusPage) {
    if (summary.resourceCount !== undefined) {
      parts.push(
        translator.translatePlural(
          TOOL_IMPORT_PLURALS.monitorsShown,
          summary.resourceCount,
        ),
      );
    }

    if (summary.groupCount) {
      parts.push(
        translator.translatePlural(
          TOOL_IMPORT_PLURALS.groups,
          summary.groupCount,
        ),
      );
    }
  }

  if (
    kind === ToolImportResourceKind.StatusPageSubscriber &&
    summary.statusPageName
  ) {
    parts.push(
      translator.translateTemplate("Subscribed to {{page}}", {
        page: summary.statusPageName,
      }),
    );
  }

  if (kind === ToolImportResourceKind.IncidentCustomField) {
    const typeLabel: string | undefined = summary.fieldType
      ? TOOL_IMPORT_FIELD_TYPE_LABELS[summary.fieldType]
      : undefined;

    if (typeLabel) {
      parts.push(translator.translateText(typeLabel) || typeLabel);
    }

    if (summary.optionCount) {
      parts.push(
        translator.translatePlural(
          TOOL_IMPORT_PLURALS.options,
          summary.optionCount,
        ),
      );
    }
  }

  return parts.join(" · ");
}
