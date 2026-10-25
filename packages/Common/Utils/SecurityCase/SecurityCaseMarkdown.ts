import FeedMarkdown, {
  MarkdownText,
  MarkdownValue,
  mdText,
} from "../Markdown/FeedMarkdown";
import { describeMitreId } from "../../Types/SecurityEvent/MitreAttack";
import { SecurityEntity } from "../../Types/SecurityCase/SecurityEntity";
import { isStixIndicatorId } from "../../Types/SecurityEvent/ThreatIntelConstants";

/*
 * The Markdown a security case's feed and its notifications are written in.
 * Every sentence places case data - titles, rule names, entity values, which
 * can come from a connected product or an attacker's own input - with mdText
 * (Common/Utils/Markdown/FeedMarkdown), so none of it can turn into a link,
 * an image, HTML or a chat mention wherever the sentence is shown.
 *
 * Kept apart from the services so the sentences are tested on their own and
 * read the same from every writer: the case service, the detection ingest
 * and the playbook engine.
 */

// "by playbook X" on a change a playbook made; nothing for a person's change.
function byPlaybook(playbookName: string | undefined): MarkdownText {
  return playbookName
    ? mdText` (playbook **${playbookName}**)`
    : FeedMarkdown.empty();
}

export function caseOpenedByPersonMarkdown(): MarkdownText {
  return mdText`🗂️ Opened this case.`;
}

export function caseOpenedFromDetectionMarkdown(data: {
  detectionTitle: string;
  source: string;
}): MarkdownText {
  return mdText`🛡️ Case opened by the detection **${data.detectionTitle}** (${data.source}).`;
}

export function detectionAddedMarkdown(data: {
  detectionTitle: string;
  severity: string;
}): MarkdownText {
  return mdText`⚡ New detection: **${data.detectionTitle}** (${data.severity}).`;
}

export function statusChangedMarkdown(data: {
  from: string;
  to: string;
  verdict?: string | undefined;
  /*
   * The case was closed and now is open (SecurityCaseStatuses'
   * getStatusChange): read off where the statuses sit in the project's
   * list, so leaving a closing status of the project's own ("Closed -
   * Duplicate") reads as a reopen too. Left out, a move from a status named
   * Closed is one.
   */
  reopens?: boolean | undefined;
  playbookName?: string | undefined;
}): MarkdownText {
  if (data.verdict) {
    return mdText`✅ Closed as **${data.verdict}**${byPlaybook(data.playbookName)}.`;
  }

  if (data.reopens ?? data.from === "Closed") {
    return mdText`↩️ Reopened as **${data.to}**${byPlaybook(data.playbookName)}.`;
  }

  return mdText`🔁 Status changed from **${data.from}** to **${data.to}**${byPlaybook(data.playbookName)}.`;
}

export function priorityChangedMarkdown(data: {
  from: string;
  to: string;
  playbookName?: string | undefined;
}): MarkdownText {
  return mdText`🚩 Priority changed from **${data.from}** to **${data.to}**${byPlaybook(data.playbookName)}.`;
}

export function assigneeChangedMarkdown(data: {
  userName?: string | undefined;
  teamName?: string | undefined;
  playbookName?: string | undefined;
}): MarkdownText {
  if (data.userName && data.teamName) {
    return mdText`👤 Assigned to **${data.userName}** in **${data.teamName}**${byPlaybook(data.playbookName)}.`;
  }

  if (data.userName) {
    return mdText`👤 Assigned to **${data.userName}**${byPlaybook(data.playbookName)}.`;
  }

  if (data.teamName) {
    return mdText`👥 Moved to the **${data.teamName}** queue${byPlaybook(data.playbookName)}.`;
  }

  return mdText`👤 Unassigned${byPlaybook(data.playbookName)}.`;
}

export function noteAddedMarkdown(note: string): MarkdownText {
  return mdText`📝 Added a note:\n\n${FeedMarkdown.asMarkdown(note)}`;
}

export function incidentDeclaredMarkdown(data: {
  incidentNumber: string;
  incidentUrl?: string | undefined;
  playbookName?: string | undefined;
}): MarkdownText {
  if (data.incidentUrl) {
    return mdText`🚨 Declared incident [${data.incidentNumber}](${data.incidentUrl})${byPlaybook(data.playbookName)}.`;
  }

  return mdText`🚨 Declared incident **${data.incidentNumber}**${byPlaybook(data.playbookName)}.`;
}

export interface SecurityCaseSummaryInput {
  caseNumber: string;
  title: string;
  priority: string;
  status: string;
  assignee?: string | undefined;
  detectionCount: number;
  entities: Array<SecurityEntity>;
  mitreTactics: Array<string>;
  url?: string | undefined;
}

// At most this many entities are listed in a summary; the rest are counted.
export const SUMMARY_ENTITY_LIMIT: number = 10;

/*
 * The case in a few lines, for an email, a Slack or Teams post, or a note:
 * what it is, how urgent, who has it, what it is about, and a link to it.
 */
export function securityCaseSummaryMarkdown(
  summary: SecurityCaseSummaryInput,
): MarkdownText {
  const lines: Array<MarkdownValue> = [];

  lines.push(
    summary.url
      ? mdText`**[${summary.caseNumber}](${summary.url})** ${summary.title}`
      : mdText`**${summary.caseNumber}** ${summary.title}`,
  );

  lines.push(
    mdText`Priority **${summary.priority}** · Status **${summary.status}** · ${summary.assignee ? mdText`Assigned to **${summary.assignee}**` : mdText`Unassigned`}`,
  );

  lines.push(
    mdText`${String(summary.detectionCount)} detection${summary.detectionCount === 1 ? "" : "s"}`,
  );

  if (summary.entities.length > 0) {
    const shown: Array<MarkdownValue> = summary.entities
      .slice(0, SUMMARY_ENTITY_LIMIT)
      .map((entity: SecurityEntity): MarkdownText => {
        return mdText`${FeedMarkdown.code(entity.value)} (${entity.type})`;
      });

    const more: number = summary.entities.length - shown.length;

    lines.push(
      mdText`Entities: ${FeedMarkdown.join(shown)}${more > 0 ? mdText`, and ${String(more)} more` : FeedMarkdown.empty()}`,
    );
  }

  if (summary.mitreTactics.length > 0) {
    lines.push(
      mdText`MITRE ATT&CK: ${FeedMarkdown.join(
        summary.mitreTactics.map((tactic: string): string => {
          return describeMitreId(tactic);
        }),
      )}`,
    );
  }

  return FeedMarkdown.join(lines, "\n\n");
}

export interface SecurityCaseTemplateValues {
  number: string;
  title: string;
  priority: string;
  status: string;
  assignee: string;
  url: string;
  entities: string;
  detections: string;
}

// {{case.title}}, {{ case.title }}: a name of letters, never more than 40 of them.
const PLACEHOLDER_PATTERN: RegExp =
  /\{\{\s{0,8}case\.([a-zA-Z]{1,40})\s{0,8}\}\}/g;

/*
 * A message a person wrote in a playbook step - Markdown with
 * {{case.title}}-style placeholders - with the case's values put in.
 * The person's Markdown is theirs (FeedMarkdown.asMarkdown); each value is
 * escaped as plain text where it lands (FeedMarkdown.templateText), so a case
 * titled with Markdown in it reads as typed. A placeholder that names
 * nothing is left as written, so the mistake shows.
 */
export function renderSecurityCaseTemplate(
  template: string,
  values: SecurityCaseTemplateValues,
): MarkdownText {
  const lookup: Record<string, string> = values as unknown as Record<
    string,
    string
  >;

  const rendered: string = template.replace(
    PLACEHOLDER_PATTERN,
    (whole: string, name: string): string => {
      if (!Object.prototype.hasOwnProperty.call(lookup, name)) {
        return whole;
      }

      return FeedMarkdown.templateText(lookup[name] || "");
    },
  );

  return FeedMarkdown.asMarkdown(rendered);
}

// The placeholders a playbook message can use, for the step editor to list.
export const SECURITY_CASE_TEMPLATE_PLACEHOLDERS: ReadonlyArray<{
  placeholder: string;
  description: string;
}> = [
  {
    placeholder: "{{case.number}}",
    description: "The case number, like CASE-42",
  },
  { placeholder: "{{case.title}}", description: "The case title" },
  // The case's priority and status are the project's own, named as it names them.
  {
    placeholder: "{{case.priority}}",
    description: "The case's priority, as your project names it, such as High",
  },
  {
    placeholder: "{{case.status}}",
    description:
      "The case's status, as your project names it, such as Investigating",
  },
  {
    placeholder: "{{case.assignee}}",
    description: "Who the case is assigned to",
  },
  {
    placeholder: "{{case.url}}",
    description: "A link to the case in OneUptime",
  },
  {
    placeholder: "{{case.entities}}",
    description: "The users, hosts and addresses the case is about",
  },
  {
    placeholder: "{{case.detections}}",
    description: "How many detections the case holds",
  },
];

// How a run came to start, as the feed says it.
function triggerPhrase(trigger: string): string {
  switch (trigger) {
    case "Case Opened":
      return "when the case opened";
    case "Detection Added":
      return "for a new detection";
    case "Triaged as Likely Malicious":
      return "when AI triage read the case as Likely Malicious";
    default:
      return "by hand";
  }
}

export function playbookStartedMarkdown(data: {
  playbookName: string;
  trigger: string;
}): MarkdownText {
  return mdText`▶️ Started playbook **${data.playbookName}** ${triggerPhrase(data.trigger)}.`;
}

export function playbookCancelledMarkdown(data: {
  playbookName: string;
}): MarkdownText {
  return mdText`⏹️ Cancelled playbook **${data.playbookName}**.`;
}

export function playbookFinishedMarkdown(data: {
  playbookName: string;
  succeeded: number;
  skipped: number;
  failed: number;
}): MarkdownText {
  const parts: Array<MarkdownValue> = [
    mdText`${String(data.succeeded)} step${data.succeeded === 1 ? "" : "s"} ran`,
  ];

  if (data.skipped > 0) {
    parts.push(mdText`${String(data.skipped)} skipped`);
  }

  if (data.failed > 0) {
    parts.push(mdText`${String(data.failed)} failed and the run went on`);
  }

  return mdText`🏁 Playbook **${data.playbookName}** finished: ${FeedMarkdown.join(parts)}.`;
}

export function playbookFailedMarkdown(data: {
  playbookName: string;
  stepNumber: number;
  stepTitle: string;
}): MarkdownText {
  return mdText`❌ Playbook **${data.playbookName}** stopped: step ${String(data.stepNumber)} (${data.stepTitle}) failed.`;
}

export function playbookStepMarkdown(data: {
  playbookName: string;
  stepNumber: number;
  stepTitle: string;
  // What the step did, in Markdown OneUptime wrote (a MarkdownText's text).
  summary: MarkdownText;
}): MarkdownText {
  return mdText`⚙️ **${data.playbookName}**, step ${String(data.stepNumber)} (${data.stepTitle}): ${data.summary}`;
}

// Entity values as code, one after another.
function valueList(values: Array<string>): MarkdownText {
  return FeedMarkdown.join(
    values.map((value: string): MarkdownText => {
      return FeedMarkdown.code(value);
    }),
  );
}

export function approvalRequestedMarkdown(data: {
  playbookName: string;
  stepNumber: number;
  stepTitle: string;
  // For a step that acts on users or hosts: the ones it would act on.
  targets?: Array<string> | undefined;
}): MarkdownText {
  const on: MarkdownText =
    data.targets && data.targets.length > 0
      ? mdText` on ${valueList(data.targets)}`
      : FeedMarkdown.empty();

  return mdText`⏸️ Playbook **${data.playbookName}** is waiting for approval to run step ${String(data.stepNumber)} (${data.stepTitle})${on}.`;
}

export function approvalDecidedMarkdown(data: {
  playbookName: string;
  stepNumber: number;
  stepTitle: string;
  isApproved: boolean;
  // For a step that acts on users or hosts: what the approver kept, and left out.
  targets?: Array<string> | undefined;
  leftOut?: Array<string> | undefined;
}): MarkdownText {
  if (!data.isApproved) {
    return mdText`👎 Rejected step ${String(data.stepNumber)} (${data.stepTitle}) of playbook **${data.playbookName}**, which ends the run.`;
  }

  const forTargets: MarkdownText =
    data.targets && data.targets.length > 0
      ? mdText` for ${valueList(data.targets)}`
      : FeedMarkdown.empty();
  const leftOut: MarkdownText =
    data.leftOut && data.leftOut.length > 0
      ? mdText`, leaving out ${valueList(data.leftOut)}`
      : FeedMarkdown.empty();

  return mdText`👍 Approved step ${String(data.stepNumber)} (${data.stepTitle}) of playbook **${data.playbookName}**${forTargets}${leftOut}.`;
}

export function targetUndoneMarkdown(data: {
  playbookName: string;
  stepNumber: number;
  stepTitle: string;
  undoTitle: string;
  value: string;
  detail: string;
}): MarkdownText {
  return mdText`↩️ ${data.undoTitle}: ${FeedMarkdown.code(data.value)} ${data.detail}, undoing step ${String(data.stepNumber)} (${data.stepTitle}) of playbook **${data.playbookName}**.`;
}

export function playbookInterruptedMarkdown(data: {
  playbookName: string;
}): MarkdownText {
  return mdText`❌ Playbook **${data.playbookName}** stopped without finishing: the worker running it was restarted or timed out. Run it again from the case.`;
}

/*
 * What a detection rule's match says on its detection and the case it
 * opens. The rule's own description is Markdown its author wrote; the sample
 * event and the observables are whatever the events carried - an attacker
 * picks the user name a brute force tries - so they are code, never
 * Markdown.
 */
export function detectionRuleMatchMarkdown(data: {
  ruleName: string;
  ruleDescription?: string | undefined;
  matchCount: number;
  distinctCount?:
    | { field: string; count: number; threshold: number }
    | undefined;
  windowStart: string;
  windowEnd: string;
  sampleMessage?: string | undefined;
  observables: Array<string>;
  /*
   * A correlation rule's match, in one sentence (CorrelationRuleMatcher):
   * "Failed sign-ins (5+ events in 10 minutes), then Successful sign-in,
   * 3 minutes apart". Its rule titles and values come from rules and events,
   * so it is placed as escaped text.
   */
  correlationSummary?: string | undefined;
}): MarkdownText {
  const parts: Array<MarkdownValue> = [];

  if (data.ruleDescription && data.ruleDescription.trim()) {
    parts.push(FeedMarkdown.asMarkdown(data.ruleDescription.trim()));
  }

  parts.push(
    mdText`Detection rule **${data.ruleName}** matched ${String(data.matchCount)} security event${data.matchCount === 1 ? "" : "s"} between ${data.windowStart} and ${data.windowEnd}.`,
  );

  if (data.correlationSummary) {
    parts.push(mdText`What happened: ${data.correlationSummary}.`);
  }

  if (data.distinctCount) {
    parts.push(
      mdText`${String(data.distinctCount.count)} distinct ${FeedMarkdown.code(data.distinctCount.field)} value${data.distinctCount.count === 1 ? "" : "s"} across these events (rule threshold: ${String(data.distinctCount.threshold)}).`,
    );
  }

  if (data.sampleMessage) {
    parts.push(mdText`Sample event: ${FeedMarkdown.code(data.sampleMessage)}`);
  }

  if (data.observables.length > 0) {
    parts.push(
      mdText`Observables: ${FeedMarkdown.join(
        data.observables.slice(0, 20).map((value: string): MarkdownText => {
          return FeedMarkdown.code(value);
        }),
      )}`,
    );
  }

  return FeedMarkdown.join(parts, "\n\n");
}

/*
 * What a threat-intel match says on its detection and the case it opens.
 * The indicator's name and value come from the feed - a third party - and
 * the sample event from the events, so each is code or escaped text.
 */
export function threatIntelMatchMarkdown(data: {
  feedName: string;
  indicatorName?: string | undefined;
  indicatorValue: string;
  indicatorType: string;
  confidence: number;
  matchCount: number;
  windowStart: string;
  windowEnd: string;
  stixId?: string | undefined;
  sampleMessage?: string | undefined;
}): MarkdownText {
  const parts: Array<MarkdownValue> = [];

  parts.push(
    mdText`Indicator ${FeedMarkdown.code(data.indicatorValue)} (${data.indicatorType || "indicator"}${data.confidence > 0 ? mdText`, confidence ${String(data.confidence)}` : FeedMarkdown.empty()}) from the threat intel feed **${data.feedName}** matched ${String(data.matchCount)} security event${data.matchCount === 1 ? "" : "s"} between ${data.windowStart} and ${data.windowEnd}.`,
  );

  if (data.indicatorName) {
    parts.push(mdText`Indicator: ${data.indicatorName}`);
  }

  // A list's or Google SecOps's indicators have no STIX id to show.
  if (isStixIndicatorId(data.stixId)) {
    parts.push(mdText`STIX indicator: ${FeedMarkdown.code(data.stixId!)}`);
  }

  if (data.sampleMessage) {
    parts.push(mdText`Sample event: ${FeedMarkdown.code(data.sampleMessage)}`);
  }

  return FeedMarkdown.join(parts, "\n\n");
}

/*
 * What the case about a run's overflow says (DetectionOverflow): the source
 * matched more groups than one run opens cases for. The source's name comes
 * from a person, the group values from events, so each is escaped or code.
 */
export function detectionOverflowMarkdown(data: {
  // "rule": a detection rule's run. "feed": a threat-intel feed's check.
  kind: "rule" | "feed";
  // A detection rule's name, or a threat-intel feed's.
  sourceName: string;
  // The plain sentence the source's last error carries (describeDetectionOverflow).
  summary: string;
  windowStart: string;
  windowEnd: string;
  // A few of the groups past the limit, highest count first.
  examples: Array<string>;
}): MarkdownText {
  const parts: Array<MarkdownValue> = [
    mdText`**${data.sourceName}** matched more than one ${
      data.kind === "rule" ? "run" : "check"
    } opens cases for, between ${data.windowStart} and ${data.windowEnd}.`,
    mdText`${data.summary}`,
  ];

  if (data.examples.length > 0) {
    parts.push(
      mdText`Among the rest: ${FeedMarkdown.join(
        data.examples.slice(0, 20).map((value: string): MarkdownText => {
          return FeedMarkdown.code(value);
        }),
      )}`,
    );
  }

  return FeedMarkdown.join(parts, "\n\n");
}
