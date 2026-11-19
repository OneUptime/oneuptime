import { describeCommandOrigin } from "../../IncidentAlertAi/IncidentAlertAiLogs";
import {
  ResourceAttentionFact,
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionText,
} from "../../ResourcePart/ResourceAttention";
import {
  AiActivityFailedCommand,
  AiActivityInsights,
  AiActivitySubject,
} from "Common/Types/AI/AiActivityInsights";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import {
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * WHICH COMMANDS FAILED, AND WHY (#9749).
 *
 * An AI Insights page's footnote counts the commands OneUptime AI ran and
 * said "Commands: 3 failed" - a count nobody could open. "3 failed" is now a
 * pill (ResourceAttentionPill) that opens them, as every "N failed" in the
 * product opens what failed: each command as AI sent it, how it ended (its
 * exit code, and the agent's own words), why AI ran it, the incident or
 * alert it was for, when it failed, and View - that incident or alert, where
 * the investigation or fix that ran it is; the scope's AI Logs when the
 * reader may not read the incident or alert.
 *
 * The server sends the count and the list from one read of the failed
 * commands the reader may read (failedCommandList), so the pill says how
 * many it opens: the newest 50, and a line under them when there are more.
 * A reader who may read the command but not what it ran (a Viewer) reads
 * the rest of it. React-free, so the suites read it without a browser.
 */

export const AI_INSIGHTS_FAILED_COMMANDS_HINT: string = translationKey(
  "Show which commands failed and why",
);

export const AI_INSIGHTS_FAILED_COMMANDS_DESCRIPTION: string = translationKey(
  "The commands OneUptime AI ran here in the last 30 days that failed, and why, the newest first.",
);

export const AI_INSIGHTS_FAILED_COMMANDS_EMPTY: string = translationKey(
  "None of the commands OneUptime AI ran here failed.",
);

// A command whose words the reader may not read: a Viewer's.
export const AI_INSIGHTS_COMMAND_NOT_SHOWN: string = translationKey(
  "Command not shown to your role",
);

// The pill: "3 failed".
export const AI_INSIGHTS_FAILED_COMMANDS_LABEL: PluralTemplate = {
  one: "{{count}} failed",
  other: "{{count}} failed",
};

// The dialog's title: "3 commands failed".
export const AI_INSIGHTS_FAILED_COMMANDS_TITLE: PluralTemplate = {
  one: "{{count}} command failed",
  other: "{{count}} commands failed",
};

// Beside the pill: what no agent picked up in time.
export const AI_INSIGHTS_COMMANDS_NEVER_RAN: PluralTemplate = {
  one: "{{count}} never ran",
  other: "{{count}} never ran",
};

const EXIT_CODE_TEMPLATE: string = translationKey("Exit code {{exitCode}}");
const FAILED_TEMPLATE: string = translationKey("Failed {{time}}");
const FAILED_WORD: string = translationKey("Failed");
const WHY_LABEL: string = translationKey("Why");
const INCIDENT_LABEL: string = translationKey("Incident");
const ALERT_LABEL: string = translationKey("Alert");

// Where a row's View goes: the command's incident or alert, else AI Logs.
export interface AiFailedCommandRoutes {
  getSubjectRoute: (subject: AiActivitySubject) => Route;
  logsRoute: Route;
}

/*
 * The failed commands the dialog lists, newest first, and whether there
 * are more than it lists: the count says how many the reader may read.
 */
export function getFailedCommands(insights: AiActivityInsights): {
  commands: Array<AiActivityFailedCommand>;
  isTruncated: boolean;
} {
  const commands: Array<AiActivityFailedCommand> = [
    ...(insights.failedCommandList || []),
  ].sort((a: AiActivityFailedCommand, b: AiActivityFailedCommand): number => {
    return Date.parse(b.at) - Date.parse(a.at);
  });

  return {
    commands,
    isTruncated: insights.totals.failedCommands > commands.length,
  };
}

// The incident or alert, as the page names one: its number, then its title.
function getSubjectFact(subject: AiActivitySubject): ResourceAttentionFact {
  const number: string | undefined =
    subject.numberWithPrefix ||
    (subject.number !== undefined ? `#${subject.number}` : undefined);

  return {
    key: "subject",
    label: subject.kind === "incident" ? INCIDENT_LABEL : ALERT_LABEL,
    // "INC-42 Checkout is down": the number as the kind before the title.
    ...(number && subject.title ? { valueKind: number } : {}),
    value: subject.title || number || subject.id,
  };
}

// One row of the dialog: a failed command, as the reader may read it.
export function getFailedCommandItem(data: {
  command: AiActivityFailedCommand;
  translator: Translator;
  routes: AiFailedCommandRoutes;
}): ResourceAttentionItem {
  const command: AiActivityFailedCommand = data.command;
  const facts: Array<ResourceAttentionFact> = [];
  const origin: string | null = describeCommandOrigin(command.origin || null);

  if (origin) {
    facts.push({
      key: "why",
      label: WHY_LABEL,
      // Worded here, in the reader's language: drawn as given.
      value: data.translator.translateText(origin) || origin,
    });
  }

  if (command.subject) {
    facts.push(getSubjectFact(command.subject));
  }

  /*
   * How it ended, in a chip: its exit code, else that it failed. The
   * agent's own words, as it wrote them, go under it.
   */
  const reasons: Array<ResourceAttentionText> =
    typeof command.exitCode === "number"
      ? [
          {
            text: EXIT_CODE_TEMPLATE,
            values: { exitCode: String(command.exitCode) },
          },
        ]
      : [{ text: FAILED_WORD }];
  const at: Date = new Date(command.at);

  return {
    key: `command-${command.id}`,
    kind: "Command",
    icon: IconProp.Terminal,
    // The command as AI sent it; for a Viewer, that it is not theirs to read.
    name: command.command
      ? command.command
      : data.translator.translateText(AI_INSIGHTS_COMMAND_NOT_SHOWN) ||
        AI_INSIGHTS_COMMAND_NOT_SHOWN,
    severity: ResourceAttentionSeverity.Critical,
    reasons,
    ...(command.errorMessage ? { message: command.errorMessage } : {}),
    facts,
    ...(Number.isNaN(at.getTime())
      ? {}
      : { since: { at, template: FAILED_TEMPLATE } }),
    route: command.subject
      ? data.routes.getSubjectRoute(command.subject)
      : data.routes.logsRoute,
  };
}

export function getFailedCommandItems(data: {
  insights: AiActivityInsights;
  translator: Translator;
  routes: AiFailedCommandRoutes;
}): Array<ResourceAttentionItem> {
  return getFailedCommands(data.insights).commands.map(
    (command: AiActivityFailedCommand): ResourceAttentionItem => {
      return getFailedCommandItem({
        command,
        translator: data.translator,
        routes: data.routes,
      });
    },
  );
}
