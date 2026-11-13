import {
  composedValue,
  createTranslator,
  DEFAULT_LANGUAGE,
  fillTemplate,
  formatList,
  getSentenceLanguage,
  PluralTemplate,
  SentenceOptions,
  TemplateValues,
  translatableTerm,
  translationKey,
  Translator,
} from "../Translator";
import { getReadingDirection, ReadingDirection } from "../ReadingDirection";
import {
  AI_AFFECTED_RESOURCE_KINDS,
  AiAffectedResourceKindInfo,
} from "./AiAffectedResources";
import { MonitorTypeHelper, MonitorTypeProps } from "../Monitor/MonitorType";
import SloStatus from "../ServiceLevelObjective/SloStatus";
import { SecurityEntityType } from "../SecurityCase/SecurityEntity";
import {
  formatSloNumber,
  formatSloPercent,
} from "../../Utils/Slo/SloWidgetFormat";

/*
 * WHAT AN AI ACTION'S CARD SAYS, IN EVERY READER'S LANGUAGE.
 *
 * Before OneUptime AI changes anything - declares an incident, links a host,
 * pages an on-call policy - Ask AI and an incident's or alert's
 * conversation show the action on a card for the person to allow or skip,
 * and keep it as a line of the answer once it ran: "Create incident:
 * Checkout down", and under it "Linked to host "test01".". Those words were
 * built on the server in English, so a person whose Dashboard is in German
 * or Japanese read one English card in the middle of a translated page -
 * and a shared thread is read by responders in several languages at once.
 *
 * So the server writes each line as a sentence of this module: its English
 * template - a translationKey every Dashboard locale words (the extractor
 * reads this file) - and what fills it. A value is data, drawn as it is
 * written: the title the model gave the incident, its number ("INC-42"), a
 * host's name, a severity the project named - never a translated sentence
 * with the data inside it. A word of this module that goes into a sentence
 * - the kind of a resource, "Untitled" - is a term, translated with the
 * sentence; a list of resources is a list of sentences, joined the way the
 * reader's language joins a list.
 *
 * The Dashboard words a stored sentence in the reader's language, when it
 * is one of this module's (isKnownAIActionSentence; anything else reads as
 * the English the action stores). The server writes the same sentence in
 * English (describeAIActionSentence's default translator) for everything
 * that reads it so: the action's own title and description, which the
 * model reads in a turn's history, the conversation's PDF and Markdown
 * exports, and conversations saved before the words were.
 */

// A word of this module that goes into a sentence, translated with it.
export interface AIActionTerm {
  term: string;
  // Cased as the middle of a sentence is, in the reader's language.
  inSentence?: boolean | undefined;
}

// Sentences of this module, listed as the reader's language lists them.
export interface AIActionList {
  list: Array<AIActionSentence>;
}

/*
 * A figure, written the reader's way: a count ("1.234" in German), a rate
 * ("1,5"), a share ("99,9 %", "۹۹٫۹٪" in Persian) - as the SLO pages write
 * theirs (Utils/Slo/SloWidgetFormat), never with the server's digits.
 */
export interface AIActionFigure {
  figure: number;
  // A share of a hundred: "99.95%".
  isPercent?: boolean | undefined;
}

/*
 * A moment (an ISO 8601 date and time): the Dashboard writes it in the
 * reader's language and time zone. The English the card stores keeps the
 * ISO text, as it always did.
 */
export interface AIActionMoment {
  moment: string;
}

/*
 * What fills a sentence's {{placeholder}}: data as written, a number, a
 * term, a list, or a figure.
 */
export type AIActionSentenceValue =
  | string
  | number
  | AIActionTerm
  | AIActionList
  | AIActionFigure;

export interface AIActionSentence {
  /*
   * The English template: one of AI_ACTION_SENTENCES, or the "other" form
   * of one of AI_ACTION_PLURAL_SENTENCES (with `count`).
   */
  template: string;
  // For a sentence that counts: the count, which picks its form.
  count?: number | undefined;
  values?: Record<string, AIActionSentenceValue> | undefined;
}

/*
 * An action's card: its title, and the sentences of the line under it
 * (what it names by name, what the prepare chose for the person).
 */
export interface AIActionWords {
  title: AIActionSentence;
  description?: Array<AIActionSentence> | undefined;
  /*
   * The arguments the title names by name - incidentId, once it says
   * "INC-42" - so the card's line of arguments need not repeat their IDs.
   */
  namedArguments?: Array<string> | undefined;
  /*
   * The arguments the line under the title says in words - the severity
   * a new incident takes ("Severity: High."), where it starts - so the
   * card's line of arguments need not say them again.
   */
  describedArguments?: Array<string> | undefined;
}

/*
 * ---------------------------------------------------------------------------
 * The titles. Each names what it acts on by the number or the name the
 * person knows it by - or, when the call names no record, says so.
 * ---------------------------------------------------------------------------
 */

export const AI_ACTION_TITLES: {
  createIncident: string;
  acknowledgeIncident: string;
  acknowledgeIncidentUnnamed: string;
  resolveIncident: string;
  resolveIncidentUnnamed: string;
  createAlert: string;
  acknowledgeAlert: string;
  acknowledgeAlertUnnamed: string;
  resolveAlert: string;
  resolveAlertUnnamed: string;
  linkIncident: string;
  linkThisIncident: string;
  linkAlert: string;
  linkThisAlert: string;
  pageOnCallPolicy: string;
  pageOnCallPolicyForIncident: string;
  pageOnCallPolicyUnnamed: string;
  runRunbook: string;
  runRunbookForIncident: string;
  runRunbookUnnamed: string;
  postIncidentStatusUpdate: string;
  postIncidentStatusUpdateUnnamed: string;
  changeIncidentSeverity: string;
  changeIncidentSeverityUnnamed: string;
  addIncidentNote: string;
  addIncidentNoteUnnamed: string;
  addAlertNote: string;
  addAlertNoteUnnamed: string;
  startIncidentInvestigation: string;
  startAlertInvestigation: string;
  startInvestigation: string;
  addSecurityCaseNote: string;
  addSecurityCaseNoteUnnamed: string;
  runSecurityPlaybook: string;
  runSecurityPlaybookUnnamed: string;
  openPullRequest: string;
  createWorkflow: string;
  updateWorkflow: string;
  updateWorkflowUnnamed: string;
  setUpWebsiteMonitoring: string;
  setUpWebsiteMonitoringUnnamed: string;
  createOnCallPolicy: string;
  publishStatusPage: string;
  addMonitorsToStatusPage: string;
  addMonitorsToStatusPageUnnamed: string;
} = {
  createIncident: translationKey("Create incident: {{title}}"),
  acknowledgeIncident: translationKey("Acknowledge incident {{incident}}"),
  acknowledgeIncidentUnnamed: translationKey("Acknowledge incident"),
  resolveIncident: translationKey("Resolve incident {{incident}}"),
  resolveIncidentUnnamed: translationKey("Resolve incident"),
  createAlert: translationKey("Create alert: {{title}}"),
  acknowledgeAlert: translationKey("Acknowledge alert {{alert}}"),
  acknowledgeAlertUnnamed: translationKey("Acknowledge alert"),
  resolveAlert: translationKey("Resolve alert {{alert}}"),
  resolveAlertUnnamed: translationKey("Resolve alert"),
  linkIncident: translationKey(
    "Link incident {{incident}} to affected resources",
  ),
  linkThisIncident: translationKey("Link this incident to affected resources"),
  linkAlert: translationKey("Link alert {{alert}} to affected resources"),
  linkThisAlert: translationKey("Link this alert to affected resources"),
  pageOnCallPolicy: translationKey("Page on-call policy {{policy}}"),
  /*
   * The incident a page or a run is for, by its number: without it, the
   * card's line of arguments showed the incident's ID.
   */
  pageOnCallPolicyForIncident: translationKey(
    "Page on-call policy {{policy}} for incident {{incident}}",
  ),
  pageOnCallPolicyUnnamed: translationKey("Page on-call policy"),
  runRunbook: translationKey("Run runbook {{runbook}}"),
  runRunbookForIncident: translationKey(
    "Run runbook {{runbook}} for incident {{incident}}",
  ),
  runRunbookUnnamed: translationKey("Run runbook"),
  postIncidentStatusUpdate: translationKey(
    "Post public status update on incident {{incident}}",
  ),
  postIncidentStatusUpdateUnnamed: translationKey(
    "Post public status update on incident",
  ),
  changeIncidentSeverity: translationKey(
    "Change incident {{incident}} severity to {{severity}}",
  ),
  changeIncidentSeverityUnnamed: translationKey("Change incident severity"),
  addIncidentNote: translationKey(
    "Add private internal note to incident {{incident}}",
  ),
  addIncidentNoteUnnamed: translationKey(
    "Add private internal note to incident",
  ),
  addAlertNote: translationKey("Add private internal note to alert {{alert}}"),
  addAlertNoteUnnamed: translationKey("Add private internal note to alert"),
  startIncidentInvestigation: translationKey(
    "Start AI investigation for incident {{incident}}",
  ),
  startAlertInvestigation: translationKey(
    "Start AI investigation for alert {{alert}}",
  ),
  startInvestigation: translationKey("Start AI investigation"),
  addSecurityCaseNote: translationKey(
    "Add a note to security case {{securityCase}}",
  ),
  addSecurityCaseNoteUnnamed: translationKey("Add a note to security case"),
  runSecurityPlaybook: translationKey(
    "Run playbook {{playbook}} on security case {{securityCase}}",
  ),
  runSecurityPlaybookUnnamed: translationKey(
    "Run a playbook on a security case",
  ),
  openPullRequest: translationKey("Open pull request: {{title}}"),
  createWorkflow: translationKey("Create workflow: {{name}}"),
  updateWorkflow: translationKey("Update workflow {{workflow}}"),
  updateWorkflowUnnamed: translationKey("Update workflow"),
  /*
   * Ask AI's setup actions (#6829): what each part of a plan makes, by
   * the address, the name or the status page the person knows it by.
   */
  setUpWebsiteMonitoring: translationKey("Set up monitoring for {{address}}"),
  setUpWebsiteMonitoringUnnamed: translationKey(
    "Set up monitoring for a website",
  ),
  createOnCallPolicy: translationKey("Create on-call policy {{policy}}"),
  publishStatusPage: translationKey("Publish status page {{name}}"),
  addMonitorsToStatusPage: translationKey(
    "Add monitors to status page {{statusPage}}",
  ),
  addMonitorsToStatusPageUnnamed: translationKey(
    "Add monitors to a status page",
  ),
};

export const AI_ACTION_PLURAL_TITLES: {
  commitFiles: PluralTemplate;
} = {
  commitFiles: {
    one: translationKey("Commit {{count}} file to {{branch}}"),
    other: translationKey("Commit {{count}} files to {{branch}}"),
  },
};

/*
 * ---------------------------------------------------------------------------
 * The line under a title: what an action names, by name, and what its
 * prepare chose for the person (Server/Utils/AI/Toolbox/ToolTypes'
 * PreparedMutation).
 * ---------------------------------------------------------------------------
 */

export const AI_ACTION_LINES: {
  linkedTo: string;
  adds: string;
  someNotLinked: string;
  noneLinked: string;
  severity: string;
  startsAcknowledged: string;
  startsResolved: string;
  workflowSteps: string;
  workflowStartsOff: string;
  workflowAddsSteps: string;
  workflowRemovesSteps: string;
  workflowChangesSteps: string;
  workflowUndoesSavedSince: string;
  workflowNotRead: string;
  workflowIsOn: string;
  monitorOpensIncident: string;
  monitorGoesOffline: string;
  monitorOwnerEmailed: string;
  monitorNoLocations: string;
  pagesYouForEveryNewEvent: string;
  pagesYouAndOthersForEveryNewEvent: string;
  pagesOthersForEveryNewEvent: string;
  respondersNotFound: string;
  noVerifiedPhoneForSms: string;
  noVerifiedPhoneForCalls: string;
  noMobileApp: string;
  nothingReachesYou: string;
  statusPageIsPublic: string;
  statusPageShows: string;
  monitorsNotFound: string;
  alreadyOnStatusPage: string;
} = {
  // A new incident's or alert's resources: "Linked to host "test01"."
  linkedTo: translationKey("Linked to {{resources}}."),
  // What linking an existing one adds to what it lists already.
  adds: translationKey("Adds {{resources}}."),
  someNotLinked: translationKey(
    "Some of the other resources named will not be linked.",
  ),
  noneLinked: translationKey("The resources named will not be linked."),
  // The severity a new incident or alert takes.
  severity: translationKey("Severity: {{severity}}."),
  /*
   * A new incident or alert written up after the fact, already acknowledged
   * or already over (Server/Utils/AI/Toolbox/NewRecordStart): said before
   * it is approved, because it pages nobody.
   */
  startsAcknowledged: translationKey(
    "Starts acknowledged, so it pages nobody.",
  ),
  startsResolved: translationKey("Starts resolved, so it pages nobody."),
  // A workflow's steps, by the Builder's titles for them.
  workflowSteps: translationKey("Steps: {{steps}}."),
  workflowStartsOff: translationKey(
    "It starts turned off, so nothing runs until someone turns it on.",
  ),
  workflowAddsSteps: translationKey("Adds {{steps}}."),
  workflowRemovesSteps: translationKey("Removes {{steps}}."),
  workflowChangesSteps: translationKey("Changes {{steps}}."),
  /*
   * The workflow was saved after Ask AI last saw its steps, and the change
   * would undo some of that save, by the steps it touches (issue #6291):
   * written from what Ask AI saw, it takes their step out again or puts an
   * old setting back.
   */
  workflowUndoesSavedSince: translationKey(
    "This change undoes what was saved after Ask AI read the workflow: {{steps}}.",
  ),
  // Ask AI never saw the workflow's steps, and the change touches some of them.
  workflowNotRead: translationKey(
    "Ask AI wrote this change without reading the workflow's steps, so it may remove or change steps it has not seen.",
  ),
  workflowIsOn: translationKey(
    "This workflow is on, so its next run uses the change.",
  ),
  /*
   * set_up_website_monitoring (#6829): what the monitor does when the
   * address goes down - the words of the website guided setup's summary
   * (#6804), so the setup and Ask AI say it alike - and who is emailed.
   */
  monitorOpensIncident: translationKey(
    "If it does not answer, or answers with an error, OneUptime opens an incident ({{severity}}).",
  ),
  monitorGoesOffline: translationKey(
    "If it does not answer, or answers with an error, its status changes to Offline.",
  ),
  monitorOwnerEmailed: translationKey(
    "You own this monitor, so you are emailed when its status changes.",
  ),
  // The project adds no probe to a new monitor: nothing would check it.
  monitorNoLocations: translationKey(
    "No location checks {{host}} yet. Probes are added under Monitors > Settings > Probes.",
  ),
  /*
   * set_up_paging (#6829): who the project's first on-call policy pages,
   * by name ({{others}} and {{responders}}: lists of AI_ACTION_NAME and
   * AI_ACTION_TEAM), with the two catch-all rules that run it.
   */
  pagesYouForEveryNewEvent: translationKey(
    "Pages you for every new incident and alert.",
  ),
  pagesYouAndOthersForEveryNewEvent: translationKey(
    "Pages you and {{others}} for every new incident and alert.",
  ),
  pagesOthersForEveryNewEvent: translationKey(
    "Pages {{responders}} for every new incident and alert.",
  ),
  respondersNotFound: translationKey(
    "Not in this project, so not paged: {{names}}.",
  ),
  /*
   * What the person asked to be reached by and cannot be yet: Ask AI
   * never adds a phone number or the app - the person verifies them -
   * so the card says what is missing and where it is added.
   */
  noVerifiedPhoneForSms: translationKey(
    "You have no verified phone number for texts yet. Add one in Notification Methods, and pages reach you by SMS too.",
  ),
  noVerifiedPhoneForCalls: translationKey(
    "You have no verified phone number for calls yet. Add one in Notification Methods, and pages can call you too.",
  ),
  noMobileApp: translationKey(
    "The mobile app is not set up for you yet. Set it up from Notification Methods to get push notifications.",
  ),
  nothingReachesYou: translationKey(
    "Nothing reaches you yet. Add a notification method in Notification Methods.",
  ),
  /*
   * publish_status_page and add_monitors_to_status_page (#6829): a page
   * is public from the moment it exists, so the card says so before it
   * is approved, and what it shows ({{monitors}}: AI_ACTION_NAME and
   * AI_ACTION_NEW_MONITOR).
   */
  statusPageIsPublic: translationKey(
    "It is public as soon as it is created: anyone with its link sees the status of the monitors it shows.",
  ),
  statusPageShows: translationKey("It shows {{monitors}}."),
  monitorsNotFound: translationKey(
    "Not in this project, so not shown: {{names}}.",
  ),
  alreadyOnStatusPage: translationKey("Already on it: {{monitors}}."),
};

/*
 * The lines that count: a code change's files Ask AI never saw as the
 * branch has them (issue #6313). Ask AI writes each file whole, from what
 * read_code_file showed it, so a commit - on a branch, or a pull request's
 * - would undo what was pushed to a file since, or replace a file Ask AI
 * read on another branch, or never read, or read only part of (issue
 * #6330), or read only in an earlier answer (issue #6365), or read earlier
 * in this answer and no longer has (issue #6570), or read all of and no
 * longer has part of (issue #6984) - or write placeholders where values
 * were hidden from Ask AI (issue #6364). Each
 * names the files, as {{files}}: a list of AI_ACTION_CODE_FILE, the first
 * few written out and the rest counted (moreFiles). {{count}} is how many
 * files it names.
 */
export const AI_ACTION_PLURAL_LINES: {
  codeFilesChangedSinceRead: PluralTemplate;
  codeFilesReadOnAnotherBranch: PluralTemplate;
  codeFilesNotRead: PluralTemplate;
  codeFilesReadInPart: PluralTemplate;
  codeFilesReadInEarlierAnswer: PluralTemplate;
  codeFilesReadEarlierInThisAnswer: PluralTemplate;
  codeFilesPartNoLongerInHand: PluralTemplate;
  codeFilesNotChecked: PluralTemplate;
  codeFilesValuesHidden: PluralTemplate;
  moreFiles: PluralTemplate;
  websiteMonitorChecks: PluralTemplate;
  apiMonitorChecks: PluralTemplate;
  checkedFromLocations: PluralTemplate;
  checkedEveryMinutes: PluralTemplate;
} = {
  // Pushed to, deleted or renamed away on the branch after Ask AI read it there.
  codeFilesChangedSinceRead: {
    one: translationKey(
      "This file changed on {{branch}} after Ask AI read it, and Ask AI's version undoes that change: {{files}}.",
    ),
    other: translationKey(
      "These {{count}} files changed on {{branch}} after Ask AI read them, and Ask AI's versions undo those changes: {{files}}.",
    ),
  },
  /*
   * Read on another branch only - the repository's main branch, unless Ask
   * AI was told one - and different on the branch written to. {{readBranch}}
   * is that branch, or "another branch" when the files were read on several.
   */
  codeFilesReadOnAnotherBranch: {
    one: translationKey(
      "Ask AI read this file on {{readBranch}}, but it is different on {{branch}}, so Ask AI's version may undo changes made there: {{files}}.",
    ),
    other: translationKey(
      "Ask AI read these {{count}} files on {{readBranch}}, but they are different on {{branch}}, so Ask AI's versions may undo changes made there: {{files}}.",
    ),
  },
  // Never read, and on the branch written to.
  codeFilesNotRead: {
    one: translationKey(
      "Ask AI wrote this file without reading it, and it replaces the one on {{branch}}: {{files}}.",
    ),
    other: translationKey(
      "Ask AI wrote these {{count}} files without reading them, and they replace the ones on {{branch}}: {{files}}.",
    ),
  },
  /*
   * The version on the branch is the one Ask AI read, but it read only some
   * of its lines - read_code_file shows a file a window at a time - and
   * the change writes all of it, dropping the lines Ask AI never saw.
   */
  codeFilesReadInPart: {
    one: translationKey(
      "Ask AI read only part of this file, and its version replaces all of it: {{files}}.",
    ),
    other: translationKey(
      "Ask AI read only part of these {{count}} files, and its versions replace all of them: {{files}}.",
    ),
  },
  /*
   * Ask AI saw the version on the branch only in an earlier answer (issue
   * #6365): a new turn replays the answers, never the files they read, so
   * it writes the file whole from memory.
   */
  codeFilesReadInEarlierAnswer: {
    one: translationKey(
      "Ask AI read this file in an earlier answer and no longer has its text, and its version replaces all of it: {{files}}.",
    ),
    other: translationKey(
      "Ask AI read these {{count}} files in an earlier answer and no longer has their text, and its versions replace all of them: {{files}}.",
    ),
  },
  /*
   * Ask AI read the version on the branch earlier in this answer, and no
   * longer has its text (issue #6570): a long answer leaves out its oldest
   * results once it outgrows what the model can take, so it writes the
   * file whole from memory.
   */
  codeFilesReadEarlierInThisAnswer: {
    one: translationKey(
      "Ask AI read this file earlier in this answer and no longer has its text, and its version replaces all of it: {{files}}.",
    ),
    other: translationKey(
      "Ask AI read these {{count}} files earlier in this answer and no longer has their text, and its versions replace all of them: {{files}}.",
    ),
  },
  /*
   * Ask AI read every line of the version on the branch, in parts, and no
   * longer has some of them (issue #6984): a part read in an earlier
   * answer, or earlier in this answer and left out since. It writes those
   * lines from memory - read, so never "read only part of".
   */
  codeFilesPartNoLongerInHand: {
    one: translationKey(
      "Ask AI read this file and no longer has part of its text, and its version replaces all of it: {{files}}.",
    ),
    other: translationKey(
      "Ask AI read these {{count}} files and no longer has part of their text, and its versions replace all of them: {{files}}.",
    ),
  },
  // The branch could not be read: never said to be unchanged.
  codeFilesNotChecked: {
    one: translationKey(
      "OneUptime could not check this file on {{branch}} against what Ask AI read: {{files}}.",
    ),
    other: translationKey(
      "OneUptime could not check these {{count}} files on {{branch}} against what Ask AI read: {{files}}.",
    ),
  },
  /*
   * Ask AI is shown what looks like a secret or personal data - an IP
   * address, an email address, a key - as a placeholder ("[redacted-ip]"),
   * and its version of the file holds more of a placeholder than the file
   * on the branch does: the change writes the placeholder where the value
   * was, or where one belongs.
   */
  codeFilesValuesHidden: {
    one: translationKey(
      "Values that look like secrets or personal data were hidden from Ask AI, and its version of this file writes placeholders in their place: {{files}}.",
    ),
    other: translationKey(
      "Values that look like secrets or personal data were hidden from Ask AI, and its versions of these {{count}} files write placeholders in their place: {{files}}.",
    ),
  },
  // The files a line counts rather than names, last in its list.
  moreFiles: {
    one: translationKey("{{count}} more file"),
    other: translationKey("{{count}} more files"),
  },
  /*
   * set_up_website_monitoring (#6829): what is checked and how often, in
   * minutes ({{count}}), and from how many of the project's locations.
   */
  websiteMonitorChecks: {
    one: translationKey("A website monitor checks {{url}} every minute."),
    other: translationKey(
      "A website monitor checks {{url}} every {{count}} minutes.",
    ),
  },
  apiMonitorChecks: {
    one: translationKey("An API monitor checks {{url}} every minute."),
    other: translationKey(
      "An API monitor checks {{url}} every {{count}} minutes.",
    ),
  },
  checkedFromLocations: {
    one: translationKey("It is checked from {{count}} location."),
    other: translationKey("It is checked from {{count}} locations."),
  },
  // The line of the card a new monitor leaves: how often it is checked.
  checkedEveryMinutes: {
    one: translationKey("Checked every minute"),
    other: translationKey("Checked every {{count}} minutes"),
  },
};

/*
 * The lines a code change's card says which files it would write over
 * unseen with, as they are stored (each one's "other" form). They name
 * some of the files, never how many the change writes - so a card that
 * shows only these still shows its "Files: 3" (issue #6331).
 */
export const AI_ACTION_CODE_CHANGE_LINES: ReadonlyArray<string> = [
  AI_ACTION_PLURAL_LINES.codeFilesChangedSinceRead.other,
  AI_ACTION_PLURAL_LINES.codeFilesReadOnAnotherBranch.other,
  AI_ACTION_PLURAL_LINES.codeFilesNotRead.other,
  AI_ACTION_PLURAL_LINES.codeFilesReadInPart.other,
  AI_ACTION_PLURAL_LINES.codeFilesReadInEarlierAnswer.other,
  AI_ACTION_PLURAL_LINES.codeFilesReadEarlierInThisAnswer.other,
  AI_ACTION_PLURAL_LINES.codeFilesPartNoLongerInHand.other,
  AI_ACTION_PLURAL_LINES.codeFilesNotChecked.other,
  AI_ACTION_PLURAL_LINES.codeFilesValuesHidden.other,
];

/*
 * One file in such a list, by its path as the commit writes it. No words
 * of its own: the path is data, in every language.
 */
export const AI_ACTION_CODE_FILE: string = "{{file}}";

/*
 * One resource in a list: its kind, then its name in quotes - 'host
 * "test01"'. The name is written as a JSON string, so a name with a quote
 * in it can never read as two resources ('host "a" and host "b"'); the
 * template has no words of its own, so it takes the reader's words for
 * the kind in every language.
 */
export const AI_ACTION_RESOURCE_BY_NAME: string = "{{kind}} {{name}}";

/*
 * One name in a list, as written: a person a policy pages, a monitor a
 * status page shows (in quotes, written as a JSON string, as a resource's
 * name is). No words of its own: the name is data, in every language.
 */
export const AI_ACTION_NAME: string = "{{name}}";

// A team a policy pages, by its name.
export const AI_ACTION_TEAM: string = translationKey("the {{name}} team");

/*
 * A monitor a status page will show that the same plan sets up first: it
 * does not exist until the plan is approved.
 */
export const AI_ACTION_NEW_MONITOR: string = translationKey("{{name}} (new)");

/*
 * ---------------------------------------------------------------------------
 * Terms: words a sentence takes, translated with it.
 * ---------------------------------------------------------------------------
 */

export const AI_ACTION_TERMS: {
  untitled: string;
  aBranch: string;
  anotherBranch: string;
} = {
  // What an incident, alert or pull request the call gave no title is called.
  untitled: translationKey("Untitled"),
  // The branch of a commit whose call names none.
  aBranch: translationKey("a branch"),
  // Where Ask AI read files, when it read them on more than one branch (codeFilesReadOnAnotherBranch).
  anotherBranch: translationKey("another branch"),
};

/*
 * ---------------------------------------------------------------------------
 * The card an action leaves under the answer once it ran.
 *
 * The approval card says what an action will do; once it ran, a card under
 * the answer shows what it made or changed (Dashboard ResourceCardWidget):
 * the kind of record ("INCIDENT"), the record by its number and title, a
 * line about what happened to it ("Now acknowledged"), and its facts. The
 * server wrote all of it in English - "ALERT", "Severity: High",
 * "Affected resources" - in the middle of a translated page. The card's
 * words are this module's too: the kind and each fact's name a term, the
 * line a sentence, a fact's value data as written (a note the model wrote)
 * or what the module can say (the resources it linked, listed the reader's
 * way). The English the card stores beside them is what exports print and
 * what an older conversation's card reads as.
 * ---------------------------------------------------------------------------
 */

// The kind of record a card is about, drawn over its heading.
export const AI_ACTION_CARD_KINDS: {
  incident: string;
  alert: string;
  onCallPolicy: string;
  runbook: string;
  securityCase: string;
  workflow: string;
  monitor: string;
  statusPage: string;
} = {
  incident: translationKey("Incident"),
  alert: translationKey("Alert"),
  onCallPolicy: translationKey("On-call policy"),
  runbook: translationKey("Runbook"),
  securityCase: translationKey("Security case"),
  workflow: translationKey("Workflow"),
  monitor: translationKey("Monitor"),
  statusPage: translationKey("Status page"),
};

// The line under a card's heading: what happened to the record.
export const AI_ACTION_CARD_LINES: {
  severity: string;
  startedAcknowledged: string;
  startedResolved: string;
  nowAcknowledged: string;
  nowResolved: string;
  linkedTo: string;
  alreadyLinkedTo: string;
  privateNoteAddedToIncident: string;
  privateNoteAddedToAlert: string;
  noteAdded: string;
  statusUpdatePostedQuietly: string;
  statusUpdatePostedSubscribersNotified: string;
  statusUpdateWaitsForApproval: string;
  pagedForIncident: string;
  runbookStarted: string;
  runbookStartedForIncident: string;
  investigationQueued: string;
  playbookStarted: string;
  playbookStepsWaitForApproval: string;
  workflowTurnedOff: string;
  workflowOnNextRun: string;
  workflowSavedSinceKept: string;
  pagesYouForEveryNewEvent: string;
  pagesYouAndOthersForEveryNewEvent: string;
  pagesOthersForEveryNewEvent: string;
  statusPagePublished: string;
  monitorsAdded: string;
} = {
  // The severity a new record took, or the one it was changed to.
  severity: translationKey("Severity: {{severity}}"),
  // A new record written up after the fact (NewRecordStart).
  startedAcknowledged: translationKey("Started acknowledged"),
  startedResolved: translationKey("Started resolved"),
  nowAcknowledged: translationKey("Now acknowledged"),
  nowResolved: translationKey("Now resolved"),
  // What linking added: 'Linked to host "test01"', no full stop.
  linkedTo: translationKey("Linked to {{resources}}"),
  // Nothing was added: everything named was linked already.
  alreadyLinkedTo: translationKey("Already linked to {{resources}}"),
  /*
   * An internal note on an incident or alert: no status page shows it,
   * and only the people who can see the record can read it. Not "for
   * your team only", which read as one of OneUptime's Teams (#7595).
   */
  privateNoteAddedToIncident: translationKey(
    "Private note added, only for people who can see the incident",
  ),
  privateNoteAddedToAlert: translationKey(
    "Private note added, only for people who can see the alert",
  ),
  // A note on a security case, on its timeline.
  noteAdded: translationKey("Note added"),
  // A public status update, and whether its subscribers heard of it.
  statusUpdatePostedQuietly: translationKey(
    "Status update posted, subscribers not notified",
  ),
  statusUpdatePostedSubscribersNotified: translationKey(
    "Status update posted, subscribers notified",
  ),
  /*
   * The project asks for public notes to be approved: the update waits, on
   * no status page and told to no subscriber until it is approved.
   */
  statusUpdateWaitsForApproval: translationKey(
    "Status update sent for approval, not published yet",
  ),
  // An on-call policy paged for an incident, named by its number.
  pagedForIncident: translationKey("Paged for incident {{incident}}"),
  runbookStarted: translationKey("Run started"),
  runbookStartedForIncident: translationKey(
    "Run started for incident {{incident}}",
  ),
  investigationQueued: translationKey("AI investigation queued"),
  playbookStarted: translationKey("Started playbook {{playbook}}"),
  // Containment steps a person approves on the case before they run.
  playbookStepsWaitForApproval: translationKey(
    "Steps that need approval wait on the case",
  ),
  workflowTurnedOff: translationKey("Turned off until someone turns it on"),
  workflowOnNextRun: translationKey("Turned on: its next run uses this"),
  /*
   * The workflow was saved again between the change being proposed and
   * approved, and the change was made on top of that save (issue #6274).
   */
  workflowSavedSinceKept: translationKey(
    "Changes saved after this was proposed were kept",
  ),
  // What a setup action made (#6829): who a new policy pages, no full stop.
  pagesYouForEveryNewEvent: translationKey(
    "Pages you for every new incident and alert",
  ),
  pagesYouAndOthersForEveryNewEvent: translationKey(
    "Pages you and {{others}} for every new incident and alert",
  ),
  pagesOthersForEveryNewEvent: translationKey(
    "Pages {{responders}} for every new incident and alert",
  ),
  statusPagePublished: translationKey("Published, public at its link"),
  monitorsAdded: translationKey("Added {{monitors}}"),
};

// The names of a card's facts.
export const AI_ACTION_CARD_FACTS: {
  affectedResources: string;
  alreadyLinked: string;
  description: string;
  note: string;
  statusUpdate: string;
  workflowSteps: string;
  toFillIn: string;
  address: string;
  publicLink: string;
  shows: string;
  notAdded: string;
} = {
  affectedResources: translationKey("Affected resources"),
  alreadyLinked: translationKey("Already linked"),
  description: translationKey("Description"),
  note: translationKey("Note"),
  statusUpdate: translationKey("Status update"),
  // Which steps a workflow has, by name: never how many (a count says little).
  workflowSteps: translationKey("Workflow steps"),
  toFillIn: translationKey("Still to fill in"),
  // What a setup action made (#6829): a monitor's address, a page's link.
  address: translationKey("Address"),
  publicLink: translationKey("Public link"),
  shows: translationKey("It shows"),
  notAdded: translationKey("Not added"),
};

/*
 * ---------------------------------------------------------------------------
 * The card a read leaves under the answer (issue #7175).
 *
 * A read tool leaves a card that shows a record as it is - a monitor read
 * by id, an SLO, a team, an on-call policy or schedule, a status page, a
 * runbook, a workflow, a security case - drawn plain (issue #6968). It was
 * the server's English in every language: "MONITOR", "Type: Website",
 * "Last status", "Off - not checked", "Disabled". Its words are this
 * module's now, as a write's card's are (WidgetBuilder.resourceCard): the
 * kind and each fact's name a term, the line a sentence or data, and a
 * fact's value data as written (a monitor's name, a status name the
 * project chose, a URL), a word of OneUptime's (a term), a sentence, a
 * figure or a moment. Words the Dashboard already says elsewhere are its
 * own keys ("Type", "Window", "Calendar Month", a monitor type's name), so
 * the card says them as those pages do.
 * ---------------------------------------------------------------------------
 */

// The kinds of record a read's card shows, besides AI_ACTION_CARD_KINDS'.
export const AI_READ_CARD_KINDS: {
  monitor: string;
  slo: string;
  team: string;
  onCallSchedule: string;
  statusPage: string;
} = {
  monitor: translationKey("Monitor"),
  slo: translationKey("SLO"),
  team: translationKey("Team"),
  onCallSchedule: translationKey("On-call schedule"),
  statusPage: translationKey("Status page"),
};

// The names of a read's card's facts, besides AI_ACTION_CARD_FACTS'.
export const AI_READ_CARD_FACTS: {
  type: string;
  status: string;
  lastStatus: string;
  archived: string;
  monitoring: string;
  ownerTeams: string;
  ownerUsers: string;
  target: string;
  window: string;
  sliType: string;
  currentSli: string;
  errorBudgetLeft: string;
  burnRate: string;
  monitors: string;
  monitorRules: string;
  burnRateRules: string;
  errorBudgetPolicyTier: string;
  deployments: string;
  escalationRules: string;
  onCallSince: string;
  handsOffAt: string;
  nextUp: string;
  nextShiftStarts: string;
  visibility: string;
  publicUrl: string;
  resourcesShown: string;
  activeSubscribers: string;
  steps: string;
  enabled: string;
  recentRuns: string;
  detections: string;
  entities: string;
} = {
  type: translationKey("Type"),
  status: translationKey("Status"),
  // A monitor whose monitoring is off: the status its last check saw.
  lastStatus: translationKey("Last status"),
  archived: translationKey("Archived"),
  monitoring: translationKey("Monitoring"),
  ownerTeams: translationKey("Owner teams"),
  ownerUsers: translationKey("Owner users"),
  target: translationKey("Target"),
  window: translationKey("Window"),
  sliType: translationKey("SLI type"),
  currentSli: translationKey("Current SLI"),
  errorBudgetLeft: translationKey("Error budget left"),
  burnRate: translationKey("Burn rate"),
  monitors: translationKey("Monitors"),
  monitorRules: translationKey("Monitor rules"),
  burnRateRules: translationKey("Burn-rate rules"),
  errorBudgetPolicyTier: translationKey("Error budget policy tier"),
  deployments: translationKey("Deployments"),
  escalationRules: translationKey("Escalation rules"),
  onCallSince: translationKey("On call since"),
  handsOffAt: translationKey("Hands off at"),
  nextUp: translationKey("Next up"),
  nextShiftStarts: translationKey("Next shift starts"),
  visibility: translationKey("Visibility"),
  publicUrl: translationKey("Public URL"),
  resourcesShown: translationKey("Resources shown"),
  activeSubscribers: translationKey("Active subscribers"),
  steps: translationKey("Steps"),
  enabled: translationKey("Enabled"),
  recentRuns: translationKey("Recent runs"),
  detections: translationKey("Detections"),
  entities: translationKey("Entities"),
};

// The line under a read's card's heading, when OneUptime writes it.
export const AI_READ_CARD_LINES: {
  disabled: string;
  enabled: string;
  noMembers: string;
  noOneOnCall: string;
  onCallNow: string;
} = {
  // A monitor whose monitoring is off, as the Monitors table says it; a runbook turned off.
  disabled: translationKey("Disabled"),
  enabled: translationKey("Enabled"),
  noMembers: translationKey("No members"),
  noOneOnCall: translationKey("No one is on call"),
  // Who an on-call schedule has on call now, by name.
  onCallNow: translationKey("On call now: {{name}}"),
};

/*
 * A read's card's values that are OneUptime's words, each said as a term:
 * what being archived means for the record, a figure not worked out yet,
 * a rule table the reader may not read.
 */
export const AI_READ_CARD_VALUES: {
  yes: string;
  no: string;
  public: string;
  private: string;
  monitorArchived: string;
  monitoringOff: string;
  onCallPolicyArchived: string;
  statusPageArchived: string;
  workflowArchived: string;
  noEscalationRules: string;
  notEvaluatedYet: string;
  none: string;
  monitorsPickedByHand: string;
  notVisible: string;
  noErrorBudgetPolicy: string;
  aboveEveryTier: string;
  deploymentsFrozen: string;
  deploymentsAllowed: string;
  calendarMonth: string;
  monitorUptime: string;
  metric: string;
  archived: string;
  disabled: string;
} = {
  yes: translationKey("Yes"),
  no: translationKey("No"),
  public: translationKey("Public"),
  private: translationKey("Private"),
  monitorArchived: translationKey("Yes - not monitored"),
  monitoringOff: translationKey("Off - not checked"),
  onCallPolicyArchived: translationKey("Yes - pages no one"),
  statusPageArchived: translationKey("Yes - offline, sends nothing"),
  workflowArchived: translationKey("Yes - does not run"),
  noEscalationRules: translationKey("None configured"),
  /*
   * Each value starts with a capital, as the card's other values do
   * ("Rolling 30-day window", "Yes - not monitored"): a fact list read
   * "Deployments: frozen by the error budget policy" under "Status: At
   * Risk". Not evaluated yet, None and Allowed are the Dashboard's own
   * words for them elsewhere.
   */
  // An SLO's figures before the worker first evaluates it.
  notEvaluatedYet: translationKey("Not evaluated yet"),
  none: translationKey("None"),
  monitorsPickedByHand: translationKey("None - monitors are picked by hand"),
  notVisible: translationKey("Not visible to you"),
  noErrorBudgetPolicy: translationKey("No error budget policy"),
  aboveEveryTier: translationKey("None - the budget is above every tier"),
  deploymentsFrozen: translationKey("Frozen by the error budget policy"),
  deploymentsAllowed: translationKey("Allowed"),
  // An SLO's window and SLI, as its Settings and Overview name them.
  calendarMonth: translationKey("Calendar Month"),
  monitorUptime: translationKey("Monitor uptime"),
  metric: translationKey("Metric"),
  // An SLO's status, as its list says it, before the worker's.
  archived: translationKey("Archived"),
  disabled: translationKey("Disabled"),
};

// An SLO's status, as the SLO list names it.
export const AI_READ_CARD_SLO_STATUSES: Record<SloStatus, string> = {
  [SloStatus.Healthy]: translationKey("Healthy"),
  [SloStatus.AtRisk]: translationKey("At Risk"),
  [SloStatus.BudgetExhausted]: translationKey("Budget Exhausted"),
  [SloStatus.Misconfigured]: translationKey("Misconfigured"),
  [SloStatus.Paused]: translationKey("Paused"),
};

// What an escalation rule pages, by kind: 'user "Ana"', 'team "SRE"'.
export const AI_READ_CARD_NOUNS: {
  user: string;
  team: string;
  onCallSchedule: string;
} = {
  user: translationKey("user"),
  team: translationKey("team"),
  onCallSchedule: translationKey("on-call schedule"),
};

// A read's card's sentences: an escalation rule's name and what it pages, a status page's resource.
export const AI_READ_CARD_SENTENCES: {
  rule: string;
  ruleNamed: string;
  pages: string;
  pagesNoOne: string;
  resourceFromMonitor: string;
  resourceFromMonitorGroup: string;
  resourceNotMonitored: string;
} = {
  rule: translationKey("Rule {{order}}"),
  ruleNamed: translationKey("Rule {{order}} — {{name}}"),
  // {{targets}} is a list of AI_ACTION_RESOURCE_BY_NAME, by AI_READ_CARD_NOUNS.
  pages: translationKey("Pages {{targets}}"),
  pagesNoOne: translationKey("Pages no one"),
  // A resource the page names its own way, and the monitor or group it shows.
  resourceFromMonitor: translationKey("{{name}} (monitor: {{monitor}})"),
  resourceFromMonitorGroup: translationKey(
    "{{name}} (monitor group: {{group}})",
  ),
  // The page draws it as Not monitored: its monitoring is off.
  resourceNotMonitored: translationKey("{{resource}} - not monitored"),
};

export const AI_READ_CARD_PLURAL_SENTENCES: {
  rollingWindow: PluralTemplate;
  rulesEnabled: PluralTemplate;
  pagesThenEscalates: PluralTemplate;
  pagesNoOneThenEscalates: PluralTemplate;
} = {
  // An SLO's rolling window, as its Settings page says it.
  rollingWindow: {
    one: translationKey("Rolling {{count}}-day window"),
    other: translationKey("Rolling {{count}}-day window"),
  },
  // {{enabled}} is a figure: how many of the {{count}} rules are on.
  rulesEnabled: {
    one: translationKey("{{enabled}} of {{count}} enabled"),
    other: translationKey("{{enabled}} of {{count}} enabled"),
  },
  // {{count}} is minutes.
  pagesThenEscalates: {
    one: translationKey(
      "Pages {{targets}}, then escalates after {{count}} minute",
    ),
    other: translationKey(
      "Pages {{targets}}, then escalates after {{count}} minutes",
    ),
  },
  pagesNoOneThenEscalates: {
    one: translationKey("Pages no one, then escalates after {{count}} minute"),
    other: translationKey(
      "Pages no one, then escalates after {{count}} minutes",
    ),
  },
};

/*
 * Sentences with no words of their own, which take the reader's: a name
 * alone - one of a status page's resources - and a count before what it
 * counts ("2: Checkout, Payments").
 */
export const AI_READ_CARD_NAME: string = "{{name}}";
export const AI_READ_CARD_COUNTED: string = "{{count}}: {{items}}";

/*
 * One of a security case's entities: its kind, a word the Dashboard says
 * on the case's page ("IP Address"), then its value, which is data
 * ("10.0.0.7"). No words of its own either.
 */
export const AI_READ_CARD_ENTITY: string = "{{type}}: {{value}}";

// The kinds of entity a security case names, by the Dashboard's words for them.
export const AI_READ_CARD_ENTITY_TYPES: ReadonlyArray<string> =
  Object.values(SecurityEntityType);

let monitorTypeTerms: ReadonlyArray<string> | null = null;

/*
 * Every monitor type's name, as the type picker and the Monitors list
 * write it ("Website", "Docker Container"): a monitor's card says its type
 * by the same word, in the reader's language where the Dashboard has one.
 */
export function getAIReadCardMonitorTypeTerms(): ReadonlyArray<string> {
  if (!monitorTypeTerms) {
    monitorTypeTerms = MonitorTypeHelper.getAllMonitorTypeProps().map(
      (props: MonitorTypeProps): string => {
        return props.title;
      },
    );
  }

  return monitorTypeTerms;
}

/*
 * ---------------------------------------------------------------------------
 * The table a read leaves under the answer (issue #7394).
 *
 * A read that lists records leaves a table beside its cards: "Which
 * monitors are down right now?" leaves the monitors query_monitors read,
 * under a card for each monitor it looked up. Since #7175 the cards said
 * "Deaktiviert" and "Eingehende Anfrage" on a German page, and the row
 * under them said "Disabled" and "Incoming Request" of the same monitor,
 * under the English title "Monitors (4)" and its English order line. The
 * table's own words are this module's now (AIActionTableWords): its title
 * and the line under it sentences, its count a figure written the
 * reader's way, and each cell that is a word of OneUptime's - a monitor's
 * type, Disabled for a monitor whose monitoring is off - a term, the same
 * word the card says. A name and a status the project chose are data, in
 * the rows as written. The table stores the same words in English as its
 * title, its line and its cells (WidgetBuilder.table), which the exports
 * print and a conversation saved before reads as.
 * ---------------------------------------------------------------------------
 */

/*
 * A read's table's title: what it lists and how many, the count a figure
 * ("Monitors (4)", "Monitore (4)", "مانیتورها (۴)").
 */
export const AI_READ_TABLE_TITLES: {
  monitors: string;
  monitorsWithProblems: string;
  monitorsInStatus: string;
} = {
  monitors: translationKey("Monitors ({{count}})"),
  monitorsWithProblems: translationKey("Monitors with problems ({{count}})"),
  // {{status}} is a status the project named, as named.
  monitorsInStatus: translationKey(
    'Monitors in status "{{status}}" ({{count}})',
  ),
};

/*
 * The line under a read's table's title: what it holds and in what order,
 * in about 40 English letters - the line is cut beside Open on a phone.
 */
export const AI_READ_TABLE_LINES: {
  notOperationalOnly: string;
  notOperationalFirst: string;
  notOperationalFirstDisabledLast: string;
} = {
  notOperationalOnly: translationKey("Non-operational monitors only"),
  notOperationalFirst: translationKey("Non-operational monitors first"),
  // Disabled as the table's Status column says it (AI_READ_CARD_VALUES.disabled).
  notOperationalFirstDisabledLast: translationKey(
    "Non-operational first, Disabled last",
  ),
};

/*
 * A table cell that is a word of OneUptime's: a term (a monitor type's
 * name, "Disabled") or a sentence of the module.
 */
export type AIActionTableCell = AIActionTerm | AIActionSentence;

/*
 * What a read's table says besides its data: its title, the line under
 * it, and, row by row in the order of the rows it stores, the cells that
 * are OneUptime's words, by column key. A cell not named is data, drawn
 * as stored.
 */
export interface AIActionTableWords {
  title: AIActionSentence;
  description?: AIActionSentence | undefined;
  cells?: Array<Record<string, AIActionTableCell>> | undefined;
}

/*
 * A card's value: data as written (a note, a name, a URL), a word of the
 * module (a term), a sentence or a list of them (the resources it linked),
 * a figure, or a moment.
 */
export type AIActionCardValue =
  | string
  | AIActionTerm
  | AIActionSentence
  | AIActionList
  | AIActionFigure
  | AIActionMoment;

/*
 * A fact of a card: its name - a term, or a sentence for a name with data
 * in it ("Rule 2 — Database team") - and its value.
 */
export interface AIActionCardFact {
  label: AIActionTerm | AIActionSentence;
  value: AIActionCardValue;
}

/*
 * What a card says besides its heading, which is data in every language:
 * the record by its number and title ("INC-42 · Checkout down"), a policy
 * by its name.
 */
export interface AIActionCardWords {
  // The kind of record: a term ("Incident", "On-call policy").
  kind: AIActionTerm;
  /*
   * The line under the heading, its parts one after another: sentences,
   * and data as written - a status name the project chose, a description.
   */
  line?: Array<AIActionSentence | string> | undefined;
  facts?: Array<AIActionCardFact> | undefined;
}

/*
 * ---------------------------------------------------------------------------
 * Every sentence and term a stored action may name.
 * ---------------------------------------------------------------------------
 */

export const AI_ACTION_SENTENCES: ReadonlyArray<string> = [
  ...Object.values(AI_ACTION_TITLES),
  ...Object.values(AI_ACTION_LINES),
  ...Object.values(AI_ACTION_CARD_LINES),
  AI_ACTION_RESOURCE_BY_NAME,
  AI_ACTION_CODE_FILE,
  AI_ACTION_NAME,
  AI_ACTION_TEAM,
  AI_ACTION_NEW_MONITOR,
  ...Object.values(AI_READ_CARD_LINES),
  ...Object.values(AI_READ_CARD_SENTENCES),
  AI_READ_CARD_NAME,
  AI_READ_CARD_COUNTED,
  AI_READ_CARD_ENTITY,
  ...Object.values(AI_READ_TABLE_TITLES),
  ...Object.values(AI_READ_TABLE_LINES),
];

export const AI_ACTION_PLURAL_SENTENCES: ReadonlyArray<PluralTemplate> = [
  ...Object.values(AI_ACTION_PLURAL_TITLES),
  ...Object.values(AI_ACTION_PLURAL_LINES),
  ...Object.values(AI_READ_CARD_PLURAL_SENTENCES),
];

// The kinds of resource, by the nouns the server names them by.
export const AI_ACTION_RESOURCE_NOUNS: ReadonlyArray<string> =
  AI_AFFECTED_RESOURCE_KINDS.map((info: AiAffectedResourceKindInfo): string => {
    return info.noun;
  });

export const AI_ACTION_TERM_WORDS: ReadonlyArray<string> = [
  ...Object.values(AI_ACTION_TERMS),
  ...AI_ACTION_RESOURCE_NOUNS,
  ...Object.values(AI_ACTION_CARD_KINDS),
  ...Object.values(AI_ACTION_CARD_FACTS),
  ...Object.values(AI_READ_CARD_KINDS),
  ...Object.values(AI_READ_CARD_FACTS),
  ...Object.values(AI_READ_CARD_VALUES),
  ...Object.values(AI_READ_CARD_SLO_STATUSES),
  ...Object.values(AI_READ_CARD_NOUNS),
  ...AI_READ_CARD_ENTITY_TYPES,
];

/*
 * ---------------------------------------------------------------------------
 * Building a sentence (the server's tools).
 * ---------------------------------------------------------------------------
 */

export function aiActionSentence(
  template: string,
  values?: Record<string, AIActionSentenceValue> | undefined,
): AIActionSentence {
  return values ? { template, values } : { template };
}

export function aiActionPluralSentence(
  template: PluralTemplate,
  count: number,
  values?: Record<string, AIActionSentenceValue> | undefined,
): AIActionSentence {
  return {
    template: template.other,
    count,
    ...(values ? { values } : {}),
  };
}

export function aiActionTerm(
  term: string,
  options?: { inSentence?: boolean | undefined } | undefined,
): AIActionTerm {
  return options?.inSentence ? { term, inSentence: true } : { term };
}

export function aiActionList(list: Array<AIActionSentence>): AIActionList {
  return { list };
}

/*
 * One resource in a list, by its kind's noun and its name: 'host
 * "test01"' (AI_ACTION_RESOURCE_BY_NAME).
 */
export function aiActionResourceByName(data: {
  noun: string;
  name: string;
}): AIActionSentence {
  return aiActionSentence(AI_ACTION_RESOURCE_BY_NAME, {
    kind: aiActionTerm(data.noun, { inSentence: true }),
    name: JSON.stringify(data.name),
  });
}

/*
 * A fact of the card an action leaves (AIActionCardWords): one of
 * AI_ACTION_CARD_FACTS, and its value.
 */
export function aiActionCardFact(
  label: string,
  value: AIActionCardValue,
): AIActionCardFact {
  return { label: aiActionTerm(label), value };
}

// A figure, written the reader's way (AIActionFigure).
export function aiActionFigure(
  figure: number,
  options?: { isPercent?: boolean | undefined } | undefined,
): AIActionFigure {
  return options?.isPercent ? { figure, isPercent: true } : { figure };
}

// A moment, written in the reader's language and time zone (AIActionMoment).
export function aiActionMoment(moment: Date): AIActionMoment {
  return { moment: moment.toISOString() };
}

/*
 * ---------------------------------------------------------------------------
 * Reading a stored sentence (the Dashboard).
 * ---------------------------------------------------------------------------
 */

// How deep a list may hold lists: a list of resources is one level.
const MAX_SENTENCE_DEPTH: number = 3;

// The most items a stored list may hold, and the most values a sentence may.
const MAX_LIST_ITEMS: number = 100;
const MAX_SENTENCE_VALUES: number = 10;

const isPlainObject: (value: unknown) => value is Record<string, unknown> = (
  value: unknown,
): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

export function isAIActionTerm(value: unknown): value is AIActionTerm {
  return isPlainObject(value) && typeof value["term"] === "string";
}

export function isAIActionList(value: unknown): value is AIActionList {
  return isPlainObject(value) && Array.isArray(value["list"]);
}

export function isAIActionFigure(value: unknown): value is AIActionFigure {
  return isPlainObject(value) && typeof value["figure"] === "number";
}

export function isAIActionMoment(value: unknown): value is AIActionMoment {
  return isPlainObject(value) && typeof value["moment"] === "string";
}

// A stored figure the Dashboard can write: a finite number, a share or not.
const isKnownFigure: (value: AIActionFigure) => boolean = (
  value: AIActionFigure,
): boolean => {
  return (
    Number.isFinite(value.figure) &&
    (value.isPercent === undefined || typeof value.isPercent === "boolean")
  );
};

// The longest moment a stored card may hold: an ISO 8601 date and time is 24.
const MAX_MOMENT_LENGTH: number = 40;

// A stored moment the Dashboard can write: a date it can read.
const isKnownMoment: (value: AIActionMoment) => boolean = (
  value: AIActionMoment,
): boolean => {
  return (
    value.moment.length > 0 &&
    value.moment.length <= MAX_MOMENT_LENGTH &&
    !isNaN(new Date(value.moment).getTime())
  );
};

// The plural template whose "other" form is `template`, if it is one.
export function getAIActionPluralTemplate(
  template: string,
): PluralTemplate | undefined {
  return AI_ACTION_PLURAL_SENTENCES.find((plural: PluralTemplate): boolean => {
    return plural.other === template;
  });
}

const isKnownValue: (value: unknown, depth: number) => boolean = (
  value: unknown,
  depth: number,
): boolean => {
  if (typeof value === "string") {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (isAIActionTerm(value)) {
    return (
      AI_ACTION_TERM_WORDS.includes(value.term) &&
      (value.inSentence === undefined || typeof value.inSentence === "boolean")
    );
  }

  if (isAIActionList(value)) {
    return (
      depth < MAX_SENTENCE_DEPTH &&
      value.list.length <= MAX_LIST_ITEMS &&
      value.list.every((item: unknown): boolean => {
        return isKnownSentence(item, depth + 1);
      })
    );
  }

  if (isAIActionFigure(value)) {
    return isKnownFigure(value);
  }

  return false;
};

const isKnownSentence: (value: unknown, depth: number) => boolean = (
  value: unknown,
  depth: number,
): boolean => {
  if (!isPlainObject(value) || typeof value["template"] !== "string") {
    return false;
  }

  const template: string = value["template"];
  const isPlural: boolean = getAIActionPluralTemplate(template) !== undefined;

  if (!isPlural && !AI_ACTION_SENTENCES.includes(template)) {
    return false;
  }

  // A plural sentence counts; any other sentence does not.
  const count: unknown = value["count"];

  if (
    isPlural
      ? typeof count !== "number" || !Number.isFinite(count)
      : count !== undefined
  ) {
    return false;
  }

  const values: unknown = value["values"];

  if (values === undefined) {
    return true;
  }

  return (
    isPlainObject(values) &&
    Object.keys(values).length <= MAX_SENTENCE_VALUES &&
    Object.keys(values).every((name: string): boolean => {
      return isKnownValue(values[name], depth);
    })
  );
};

/*
 * Whether a stored sentence is one of this module's, filled with values it
 * can say: only then does the Dashboard word it in the reader's language.
 * A stored action is read from a conversation's saved JSON, so anything
 * else - another template, a value of another shape - reads as the
 * English the action stores.
 */
export function isKnownAIActionSentence(
  value: unknown,
): value is AIActionSentence {
  return isKnownSentence(value, 0);
}

export function isKnownAIActionWords(value: unknown): value is AIActionWords {
  if (!isPlainObject(value) || !isKnownAIActionSentence(value["title"])) {
    return false;
  }

  const description: unknown = value["description"];

  const isNameList: (names: unknown) => boolean = (names: unknown): boolean => {
    return (
      names === undefined ||
      (Array.isArray(names) &&
        names.length <= MAX_SENTENCE_VALUES &&
        names.every((name: unknown): boolean => {
          return typeof name === "string";
        }))
    );
  };

  return (
    (description === undefined ||
      (Array.isArray(description) &&
        description.length <= MAX_SENTENCE_VALUES &&
        description.every((sentence: unknown): boolean => {
          return isKnownAIActionSentence(sentence);
        }))) &&
    isNameList(value["namedArguments"]) &&
    isNameList(value["describedArguments"])
  );
}

// How many facts a stored card may hold.
const MAX_CARD_FACTS: number = 20;

/*
 * The kinds and the names of facts a card may hold: a write's card the
 * write cards' own, a read's card those and the read cards' (issue #7175).
 * A write's card saved with a name only a read's card has - "Steps", a
 * playbook's step count of before - reads as the English it stores.
 */
const WRITE_CARD_KIND_TERMS: ReadonlyArray<string> =
  Object.values(AI_ACTION_CARD_KINDS);
const READ_CARD_KIND_TERMS: ReadonlyArray<string> = [
  ...WRITE_CARD_KIND_TERMS,
  ...Object.values(AI_READ_CARD_KINDS),
];
const WRITE_CARD_FACT_TERMS: ReadonlyArray<string> =
  Object.values(AI_ACTION_CARD_FACTS);
const READ_CARD_FACT_TERMS: ReadonlyArray<string> = [
  ...WRITE_CARD_FACT_TERMS,
  ...Object.values(AI_READ_CARD_FACTS),
];

/*
 * A word a card's fact may hold as its value: one of the module's terms, or
 * a monitor type's name (getAIReadCardMonitorTypeTerms).
 */
const isKnownCardValueTerm: (value: AIActionTerm) => boolean = (
  value: AIActionTerm,
): boolean => {
  return (
    (AI_ACTION_TERM_WORDS.includes(value.term) ||
      getAIReadCardMonitorTypeTerms().includes(value.term)) &&
    (value.inSentence === undefined || typeof value.inSentence === "boolean")
  );
};

const isKnownCardTerm: (
  value: unknown,
  terms: ReadonlyArray<string>,
) => boolean = (value: unknown, terms: ReadonlyArray<string>): boolean => {
  return (
    isAIActionTerm(value) &&
    terms.includes(value.term) &&
    (value.inSentence === undefined || typeof value.inSentence === "boolean")
  );
};

/*
 * A fact's value: data as written, a word of the module, one of its
 * sentences or a list of them, a figure or a moment.
 */
const isKnownCardFactValue: (value: unknown) => boolean = (
  value: unknown,
): boolean => {
  if (typeof value === "string") {
    return true;
  }

  if (isAIActionTerm(value)) {
    return isKnownCardValueTerm(value);
  }

  if (isAIActionList(value)) {
    return isKnownValue(value, 0);
  }

  if (isAIActionFigure(value)) {
    return isKnownFigure(value);
  }

  if (isAIActionMoment(value)) {
    return isKnownMoment(value);
  }

  return isKnownAIActionSentence(value);
};

/*
 * A fact's name: one of the module's names - and on a read's card, a
 * sentence of it ("Rule {{order}}").
 */
const isKnownCardFactLabel: (value: unknown, isRead: boolean) => boolean = (
  value: unknown,
  isRead: boolean,
): boolean => {
  return isRead
    ? isKnownCardTerm(value, READ_CARD_FACT_TERMS) ||
        isKnownAIActionSentence(value)
    : isKnownCardTerm(value, WRITE_CARD_FACT_TERMS);
};

/*
 * Whether a stored card's words are this module's: only then does the
 * Dashboard draw the card in the reader's language. A card is read from a
 * conversation's saved JSON, so anything else - another kind, a fact named
 * otherwise, a value of another shape, a card saved before it had words -
 * reads as the English the card stores. `isRead` is whether a read left
 * the card (AIChatTypes' isAIChatReadResourceCard): a read's card may name
 * the kinds and facts only reads show, and hold data in its line - a
 * status name the project chose.
 */
export function isKnownAIActionCardWords(
  value: unknown,
  options?: { isRead?: boolean | undefined } | undefined,
): value is AIActionCardWords {
  const isRead: boolean = options?.isRead === true;

  if (
    !isPlainObject(value) ||
    !isKnownCardTerm(
      value["kind"],
      isRead ? READ_CARD_KIND_TERMS : WRITE_CARD_KIND_TERMS,
    )
  ) {
    return false;
  }

  const line: unknown = value["line"];
  const facts: unknown = value["facts"];

  return (
    (line === undefined ||
      (Array.isArray(line) &&
        line.length <= MAX_SENTENCE_VALUES &&
        line.every((part: unknown): boolean => {
          // One of the module's sentences, or on a read's card data as written.
          return (
            (isRead && typeof part === "string") ||
            isKnownAIActionSentence(part)
          );
        }))) &&
    (facts === undefined ||
      (Array.isArray(facts) &&
        facts.length <= MAX_CARD_FACTS &&
        facts.every((fact: unknown): boolean => {
          return (
            isPlainObject(fact) &&
            isKnownCardFactLabel(fact["label"], isRead) &&
            isKnownCardFactValue(fact["value"])
          );
        })))
  );
}

/*
 * A line a card saved before its words changed may hold, by the kind of
 * record the card is about, and the line that kind's card says now. "Private
 * note added, for your team only" said a team, which read as one of
 * OneUptime's Teams (#7595): a private note's card saved with it reads as
 * its record's line, in the reader's language - not as the English it
 * stored. Plain English, not a key: no locale file words it any more.
 */
const RETIRED_CARD_LINES: ReadonlyMap<
  string,
  ReadonlyMap<string, string>
> = new Map<string, ReadonlyMap<string, string>>([
  [
    "Private note added, for your team only",
    new Map<string, string>([
      [
        AI_ACTION_CARD_KINDS.incident,
        AI_ACTION_CARD_LINES.privateNoteAddedToIncident,
      ],
      [
        AI_ACTION_CARD_KINDS.alert,
        AI_ACTION_CARD_LINES.privateNoteAddedToAlert,
      ],
    ]),
  ],
]);

/*
 * A stored card's words with each retired line (RETIRED_CARD_LINES) as its
 * kind's card says it now; anything else as stored. For a card read from a
 * conversation's saved JSON, before isKnownAIActionCardWords.
 */
export function withCurrentAIActionCardLines(value: unknown): unknown {
  if (!isPlainObject(value) || !Array.isArray(value["line"])) {
    return value;
  }

  const kind: unknown = value["kind"];

  if (!isAIActionTerm(kind)) {
    return value;
  }

  let hasRetiredLine: boolean = false;

  const line: Array<unknown> = value["line"].map((part: unknown): unknown => {
    const current: string | undefined =
      isPlainObject(part) &&
      typeof part["template"] === "string" &&
      part["values"] === undefined &&
      part["count"] === undefined
        ? RETIRED_CARD_LINES.get(part["template"])?.get(kind.term)
        : undefined;

    if (!current) {
      return part;
    }

    hasRetiredLine = true;

    return aiActionSentence(current);
  });

  return hasRetiredLine ? { ...value, line } : value;
}

/*
 * The most rows a stored table's words may name, and the most worded cells
 * a row may have: a tool lists at most a few hundred rows of a few columns.
 */
const MAX_TABLE_WORDED_ROWS: number = 500;
const MAX_TABLE_WORDED_CELLS: number = 20;

// A cell's words: a word of the module or a monitor type's name, or one of its sentences.
const isKnownTableCell: (value: unknown) => boolean = (
  value: unknown,
): boolean => {
  return isAIActionTerm(value)
    ? isKnownCardValueTerm(value)
    : isKnownAIActionSentence(value);
};

/*
 * Whether a stored table's words are this module's (issue #7394): only
 * then does the Dashboard draw the table's title, its line and its worded
 * cells in the reader's language. A table is read from a conversation's
 * saved JSON, so anything else - another template, a cell of another
 * shape, a table saved before it had words - reads as the English the
 * table stores.
 */
export function isKnownAIActionTableWords(
  value: unknown,
): value is AIActionTableWords {
  if (!isPlainObject(value) || !isKnownAIActionSentence(value["title"])) {
    return false;
  }

  const description: unknown = value["description"];
  const cells: unknown = value["cells"];

  return (
    (description === undefined || isKnownAIActionSentence(description)) &&
    (cells === undefined ||
      (Array.isArray(cells) &&
        cells.length <= MAX_TABLE_WORDED_ROWS &&
        cells.every((row: unknown): boolean => {
          return (
            isPlainObject(row) &&
            Object.keys(row).length <= MAX_TABLE_WORDED_CELLS &&
            Object.keys(row).every((key: string): boolean => {
              return isKnownTableCell(row[key]);
            })
          );
        })))
  );
}

// The translator the server writes its sentences with: English, as written.
let englishTranslator: Translator | null = null;

const getEnglishTranslator: () => Translator = (): Translator => {
  if (!englishTranslator) {
    englishTranslator = createTranslator(undefined, DEFAULT_LANGUAGE);
  }

  return englishTranslator;
};

const toTemplateValues: (
  values: Record<string, AIActionSentenceValue> | undefined,
  options: SentenceOptions | undefined,
) => TemplateValues = (
  values: Record<string, AIActionSentenceValue> | undefined,
  options: SentenceOptions | undefined,
): TemplateValues => {
  const result: TemplateValues = {};

  for (const name of Object.keys(values || {})) {
    const value: AIActionSentenceValue = values![name]!;

    if (typeof value === "string" || typeof value === "number") {
      result[name] = value;
    } else if (isAIActionTerm(value)) {
      result[name] = translatableTerm(value.term, {
        inSentence: value.inSentence === true,
      });
    } else if (isAIActionList(value)) {
      const list: Array<AIActionSentence> = value.list;

      // Each item in the sentence's language, joined as it joins a list.
      result[name] = composedValue((sentenceTranslator: Translator): string => {
        return formatList(
          list.map((item: AIActionSentence): string => {
            return describeAIActionSentence(item, sentenceTranslator, options);
          }),
          sentenceTranslator,
        );
      });
    } else if (isAIActionFigure(value)) {
      // Written the way the sentence's language writes a figure.
      result[name] = composedValue((sentenceTranslator: Translator): string => {
        return describeAIActionFigure(value, sentenceTranslator);
      });
    }
  }

  return result;
};

// The most decimals a card's figure is written with: what the server rounds it to.
const FIGURE_DECIMALS: number = 2;

/*
 * A figure as the translator's language writes it, as the SLO pages write
 * theirs: "99.95%" and "1234" in English, as the card always said them;
 * "99,95 %" and "1.234" in German; "۹۹٫۹۵٪" in Persian; Latin digits in
 * Arabic.
 */
export function describeAIActionFigure(
  value: AIActionFigure,
  translator: Translator = getEnglishTranslator(),
): string {
  const written: string | null = value.isPercent
    ? formatSloPercent(value.figure, FIGURE_DECIMALS, translator)
    : formatSloNumber(value.figure, FIGURE_DECIMALS, translator);

  return written ?? `${value.figure}${value.isPercent ? "%" : ""}`;
}

// A fact's name in the translator's language: a term, or a sentence with its data.
export function describeAIActionCardLabel(
  label: AIActionTerm | AIActionSentence,
  translator: Translator = getEnglishTranslator(),
  options?: SentenceOptions | undefined,
): string {
  return isAIActionTerm(label)
    ? translator.translateTerm(label.term)
    : describeAIActionSentence(label, translator, options);
}

/*
 * A sentence in the translator's language: the reader's on the Dashboard
 * (with setsValuesApart, so a value in Latin letters keeps its place in a
 * Persian sentence), English on the server and by default. A template that
 * is none of this module's is filled as written, never looked up.
 */
export function describeAIActionSentence(
  sentence: AIActionSentence,
  translator: Translator = getEnglishTranslator(),
  options?: SentenceOptions | undefined,
): string {
  const values: TemplateValues = toTemplateValues(sentence.values, options);
  const plural: PluralTemplate | undefined = getAIActionPluralTemplate(
    sentence.template,
  );

  if (plural) {
    return translator.translatePlural(
      plural,
      sentence.count ?? 0,
      values,
      options,
    );
  }

  if (!AI_ACTION_SENTENCES.includes(sentence.template)) {
    return fillTemplate(sentence.template, values);
  }

  return translator.translateTemplate(sentence.template, values, options);
}

/*
 * A card fact's value in the translator's language: data as written, a
 * word, a sentence, a list of sentences joined the way the language joins
 * a list, or a figure. A moment is its ISO text here, as the English the
 * card stores it: the Dashboard writes it in the reader's language and
 * time zone itself (ResourceCardWords).
 */
export function describeAIActionCardValue(
  value: AIActionCardValue,
  translator: Translator = getEnglishTranslator(),
  options?: SentenceOptions | undefined,
): string {
  if (typeof value === "string") {
    return value;
  }

  if (isAIActionTerm(value)) {
    return translator.translateTerm(value.term);
  }

  if (isAIActionFigure(value)) {
    return describeAIActionFigure(value, translator);
  }

  if (isAIActionMoment(value)) {
    return value.moment;
  }

  if (isAIActionList(value)) {
    return formatList(
      value.list.map((item: AIActionSentence): string => {
        return describeAIActionSentence(item, translator, options);
      }),
      translator,
    );
  }

  return describeAIActionSentence(value, translator, options);
}

// What goes between the sentences of a card's line: "Severity: High · Started resolved".
export const AI_ACTION_CARD_LINE_SEPARATOR: string = " · ";

/*
 * A card's words in the translator's language - English, as the card
 * stores them for the exports and for older Dashboards, by default.
 */
export function describeAIActionCardWords(
  words: AIActionCardWords,
  translator: Translator = getEnglishTranslator(),
): {
  kind: string;
  line?: string | undefined;
  facts: Array<{ label: string; value: string }>;
} {
  const line: string = (words.line || [])
    .map((part: AIActionSentence | string): string => {
      return typeof part === "string"
        ? part
        : describeAIActionSentence(part, translator);
    })
    .filter((text: string): boolean => {
      return Boolean(text);
    })
    .join(AI_ACTION_CARD_LINE_SEPARATOR);

  return {
    kind: translator.translateTerm(words.kind.term),
    ...(line ? { line } : {}),
    facts: (words.facts || []).map(
      (fact: AIActionCardFact): { label: string; value: string } => {
        return {
          label: describeAIActionCardLabel(fact.label, translator),
          value: describeAIActionCardValue(fact.value, translator),
        };
      },
    ),
  };
}

/*
 * A table cell's words in the translator's language - English, as the
 * table stores the cell, by default.
 */
export function describeAIActionTableCell(
  cell: AIActionTableCell,
  translator: Translator = getEnglishTranslator(),
  options?: SentenceOptions | undefined,
): string {
  return isAIActionTerm(cell)
    ? translator.translateTerm(cell.term)
    : describeAIActionSentence(cell, translator, options);
}

/*
 * A table's title and the line under it, in the translator's language -
 * English, as the table stores them for the exports, the model and older
 * Dashboards, by default. No line when the words have none.
 */
export function describeAIActionTableWords(
  words: AIActionTableWords,
  translator: Translator = getEnglishTranslator(),
  options?: SentenceOptions | undefined,
): { title: string; description?: string | undefined } {
  return {
    title: describeAIActionSentence(words.title, translator, options),
    ...(words.description
      ? {
          description: describeAIActionSentence(
            words.description,
            translator,
            options,
          ),
        }
      : {}),
  };
}

// The language a sentence is drawn in: the reader's when it words it.
export function getAIActionSentenceLanguage(
  sentence: AIActionSentence,
  translator: Translator,
): string {
  const plural: PluralTemplate | undefined = getAIActionPluralTemplate(
    sentence.template,
  );

  return getSentenceLanguage(translator, plural || sentence.template);
}

// Which way a sentence is read once drawn in the translator's language.
export function getAIActionSentenceDirection(
  sentence: AIActionSentence,
  translator: Translator,
): ReadingDirection {
  return getReadingDirection(getAIActionSentenceLanguage(sentence, translator));
}

// A full stop that needs no space after it: Chinese and Japanese.
const FULL_WIDTH_SENTENCE_ENDS: ReadonlyArray<string> = ["。", "！", "？"];

/*
 * What goes between a sentence and the next in a line: a space, but none
 * after a Chinese or Japanese full stop - and nothing before the first.
 */
export function getAIActionSentenceSeparator(previous: string): string {
  if (!previous) {
    return "";
  }

  return FULL_WIDTH_SENTENCE_ENDS.some((end: string): boolean => {
    return previous.endsWith(end);
  })
    ? ""
    : " ";
}

// Sentences one after another, as a line reads them.
export function joinAIActionSentences(texts: Array<string>): string {
  let joined: string = "";

  for (const text of texts) {
    if (text) {
      joined = `${joined}${getAIActionSentenceSeparator(joined)}${text}`;
    }
  }

  return joined;
}

/*
 * A card's title and line, in the translator's language - English, as the
 * action stores them for the model and the exports, by default. No line
 * when the card has none.
 */
export function describeAIActionWords(
  words: AIActionWords,
  translator: Translator = getEnglishTranslator(),
): { title: string; description?: string | undefined } {
  const description: string = joinAIActionSentences(
    (words.description || []).map((sentence: AIActionSentence): string => {
      return describeAIActionSentence(sentence, translator);
    }),
  );

  return {
    title: describeAIActionSentence(words.title, translator),
    ...(description ? { description } : {}),
  };
}

/*
 * The data a sentence shows itself - the title it quotes, the number it
 * names - so a line listing the action's arguments need not repeat it.
 */
export function getAIActionSentenceShownValues(
  sentence: AIActionSentence,
): Array<string> {
  const shown: Array<string> = [];

  for (const value of Object.values(sentence.values || {})) {
    if (typeof value === "string" && value.trim()) {
      shown.push(value.trim());
    }
  }

  return shown;
}
