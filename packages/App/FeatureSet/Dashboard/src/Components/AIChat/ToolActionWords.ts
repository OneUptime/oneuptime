import {
  AIActionSentence,
  AIActionWords,
  describeAIActionSentence,
  getAIActionSentenceDirection,
  getAIActionSentenceSeparator,
  getAIActionSentenceShownValues,
  isKnownAIActionWords,
} from "Common/Types/AI/AIActionWords";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
  AIChatWidget,
  AIChatWidgetType,
} from "Common/Types/AI/AIChatTypes";
import { JSONObject } from "Common/Types/JSON";
import { ReadingDirection } from "Common/Types/ReadingDirection";
import { translationKey, Translator } from "Common/Types/Translator";

/*
 * WHAT AN AI ACTION'S CARD SAYS, IN THE READER'S LANGUAGE.
 *
 * The server stores each action's title and line twice: in English
 * (`title`, `description`), which the model, the exports and conversations
 * saved before read, and as sentences of Common/Types/AI/AIActionWords
 * (`words`), which the card words here in the reader's language - the
 * incident's number, the host's name and the title the model wrote as
 * data inside them. Words that are not this module's sentences, or an
 * action saved before them, read as the stored English.
 *
 * React-free, so App's tests and the card's own read the same rules.
 */

/*
 * A sentence as the card draws it. `direction` is the way its language is
 * read when it was worded here (a Persian sentence right to left, its
 * values set apart); null for the stored English, which is read the way
 * most of its letters are (IsolatedText).
 */
export interface DrawnActionSentence {
  text: string;
  direction: ReadingDirection | null;
  /*
   * What goes before it in a line of several: a space, or nothing after a
   * Chinese or Japanese full stop.
   */
  separatorBefore: string;
}

// The action's words, when they are sentences this Dashboard can say.
function getKnownWords(action: AIChatToolAction): AIActionWords | null {
  return isKnownAIActionWords(action.words) ? action.words : null;
}

/*
 * One sentence of the module, in the reader's language when it words it:
 * its values set apart, read its language's way. `previous` is the text
 * before it in its line, which picks what goes between the two.
 */
export function drawActionSentence(
  sentence: AIActionSentence,
  translator: Translator,
  previous: string,
): DrawnActionSentence {
  const text: string = describeAIActionSentence(sentence, translator, {
    setsValuesApart: true,
  });

  return {
    text,
    direction: getAIActionSentenceDirection(sentence, translator),
    separatorBefore: getAIActionSentenceSeparator(previous),
  };
}

// The action's title, in the reader's language when it can be.
export function getToolActionTitle(
  action: AIChatToolAction,
  translator: Translator,
): DrawnActionSentence {
  const words: AIActionWords | null = getKnownWords(action);

  if (!words) {
    return { text: action.title, direction: null, separatorBefore: "" };
  }

  return drawActionSentence(words.title, translator, "");
}

/*
 * The title as a name - a group's aria-label - with no isolate marks in it:
 * a screen reader hears the words, not how they are laid out.
 */
export function getToolActionTitleLabel(
  action: AIChatToolAction,
  translator: Translator,
): string {
  const words: AIActionWords | null = getKnownWords(action);

  return words
    ? describeAIActionSentence(words.title, translator)
    : action.title;
}

/*
 * The line under the title, sentence by sentence, in the reader's language
 * when it can be: none when the action has no line.
 */
export function getToolActionDescription(
  action: AIChatToolAction,
  translator: Translator,
): Array<DrawnActionSentence> {
  const words: AIActionWords | null = getKnownWords(action);

  if (!words) {
    return action.description
      ? [{ text: action.description, direction: null, separatorBefore: "" }]
      : [];
  }

  const drawn: Array<DrawnActionSentence> = [];
  let previous: string = "";

  for (const sentence of words.description || []) {
    const next: DrawnActionSentence = drawActionSentence(
      sentence,
      translator,
      previous,
    );

    drawn.push(next);
    previous = next.text;
  }

  return drawn;
}

/*
 * The data the title shows itself - the title the alert takes, the
 * incident's number - which the card's argument line need not repeat.
 */
export function getToolActionShownValues(
  action: AIChatToolAction,
): Array<string> {
  const words: AIActionWords | null = getKnownWords(action);

  return words ? getAIActionSentenceShownValues(words.title) : [];
}

/*
 * The arguments the title names by name - incidentId, once the title says
 * "INC-42" - whose IDs the card's argument line leaves out.
 */
export function getToolActionNamedArguments(
  action: AIChatToolAction,
): Array<string> {
  return getKnownWords(action)?.namedArguments || [];
}

/*
 * The arguments the line under the title says in words - the severity a
 * new incident takes, where it starts - which the argument line leaves
 * out: it would only say them again.
 */
export function getToolActionDescribedArguments(
  action: AIChatToolAction,
): Array<string> {
  return getKnownWords(action)?.describedArguments || [];
}

/*
 * ---------------------------------------------------------------------------
 * The card's arguments, in the reader's words.
 *
 * Under an action's title and line, the card lists the arguments it runs
 * with that neither says: the description an alert will carry, a note's
 * text. It listed them by the tool's own keys and as JSON - "note: ...",
 * "changes: [{"filePath": ...}]", "notifySubscribers: true" - in the
 * middle of a translated card. Each argument a write tool takes is named
 * here in the reader's words ("Note", "Files", "Notify subscribers"), a
 * list says how many it holds, and yes or no is said in words; what the
 * model wrote stays as it wrote it. The card draws each on a line of its
 * own (ToolApprovalCard): run together on one line cut at two, a public
 * status update's "Notify subscribers: Yes" fell off the end on a phone,
 * never seen before it was approved.
 * ---------------------------------------------------------------------------
 */

// The arguments of the write tools, by the name the reader knows them by.
export const ACTION_ARGUMENT_LABELS: { [key: string]: string } = {
  title: translationKey("Title"),
  description: translationKey("Description"),
  severityName: translationKey("Severity"),
  initialState: translationKey("Initial state"),
  affectedResources: translationKey("Affected resources"),
  incidentId: translationKey("Incident"),
  alertId: translationKey("Alert"),
  securityCaseId: translationKey("Security case"),
  onCallDutyPolicyId: translationKey("On-call policy"),
  runbookId: translationKey("Runbook"),
  securityPlaybookId: translationKey("Playbook"),
  note: translationKey("Note"),
  notifySubscribers: translationKey("Notify subscribers"),
  branchName: translationKey("Branch"),
  commitMessage: translationKey("Commit message"),
  changes: translationKey("Files"),
  repositoryId: translationKey("Repository"),
};

/*
 * An argument a tool names otherwise: a public status update's `note` is
 * the update itself, which the status page shows - beside a private note
 * on the same card, two rows read "Note:" - and the card it leaves names
 * it "Status update" too.
 */
export const TOOL_ARGUMENT_LABELS: {
  [toolName: string]: { [key: string]: string };
} = {
  post_incident_status_update: {
    note: translationKey("Status update"),
  },
};

/*
 * How long a value may be before it is cut. The card shows each argument
 * on a few lines of its own (ToolApprovalCard); this only bounds what a
 * screen reader reads of a very long one - the description of a pull
 * request - while a status update's note is read whole. Cut at 80, the
 * note a person approves for the status page was cut mid-sentence.
 */
export const MAX_ARGUMENT_VALUE_LENGTH: number = 400;

// One argument on the card: its name, and its value.
export interface ActionArgumentPart {
  key: string;
  // In the reader's words; an argument no label names keeps its key.
  label: string;
  value: string;
}

export interface ActionArgumentOptions {
  // The action's line names what its lists stand for: leave them out.
  leaveOutLists?: boolean | undefined;
  // The action's stored English title, for an action saved before its words.
  title?: string | undefined;
  // The data the title shows itself (getToolActionShownValues).
  shownValues?: Array<string> | undefined;
  // Arguments the title names by name (an incident's ID, as "INC-42").
  namedArguments?: Array<string> | undefined;
  // Arguments the line under the title says in words (the severity).
  describedArguments?: Array<string> | undefined;
  // The tool, for an argument it names otherwise (TOOL_ARGUMENT_LABELS).
  toolName?: string | undefined;
}

/*
 * Whether the action's title already shows this argument in full: "Create
 * alert: <title>" ends with the title the alert takes.
 */
function isShownByTitle(value: string, title: string): boolean {
  const shown: string = value.trim();
  const titleShown: string = title.trim();

  return (
    shown.length > 0 &&
    (titleShown === shown || titleShown.endsWith(`: ${shown}`))
  );
}

function cut(text: string): string {
  return text.length > MAX_ARGUMENT_VALUE_LENGTH
    ? `${text.substring(0, MAX_ARGUMENT_VALUE_LENGTH)}…`
    : text;
}

/*
 * The action's arguments for the card. An action whose description names
 * what its lists stand for (the resources it links, by name) leaves those
 * lists out: their IDs would only repeat the description, unreadably. An
 * argument the action's title shows is left out too: repeating the title
 * there pushed what only the arguments say - the description an alert
 * will carry - out of sight. So is one the title names by name, or the
 * description says in words. The title's own values say which
 * (shownValues), in every language; for an action saved before its title
 * had values, the title ending with the argument does.
 */
export function getActionArgumentParts(
  args: JSONObject,
  options: ActionArgumentOptions,
  translator: Translator,
): Array<ActionArgumentPart> {
  const parts: Array<ActionArgumentPart> = [];

  for (const key of Object.keys(args)) {
    const value: unknown = args[key];

    if (value === undefined || value === null || value === "") {
      continue;
    }

    if (
      options.namedArguments?.includes(key) ||
      options.describedArguments?.includes(key)
    ) {
      continue;
    }

    if (options.leaveOutLists && typeof value === "object") {
      continue;
    }

    if (
      typeof value === "string" &&
      ((options.title && isShownByTitle(value, options.title)) ||
        options.shownValues?.includes(value.trim()))
    ) {
      continue;
    }

    const labelKey: string | undefined =
      (options.toolName
        ? TOOL_ARGUMENT_LABELS[options.toolName]?.[key]
        : undefined) || ACTION_ARGUMENT_LABELS[key];
    const label: string = labelKey
      ? translator.translateText(labelKey) || labelKey
      : key;

    // A list: how many it holds, as the reader writes numbers.
    if (Array.isArray(value)) {
      parts.push({
        key,
        label,
        value: translator.formatNumber(value.length),
      });
      continue;
    }

    if (typeof value === "boolean") {
      parts.push({
        key,
        label,
        value: translator.translateText(value ? "Yes" : "No") || "",
      });
      continue;
    }

    if (typeof value === "number") {
      parts.push({
        key,
        label,
        value: translator.formatNumber(value),
      });
      continue;
    }

    parts.push({
      key,
      label,
      value: cut(
        typeof value === "object" ? JSON.stringify(value) : String(value),
      ),
    });
  }

  return parts;
}

/*
 * ---------------------------------------------------------------------------
 * The actions an answer lists under its words.
 * ---------------------------------------------------------------------------
 */

/*
 * The actions of an answer its card of actions draws: every one, but an
 * action that ran and left a card above them (its widgetId, a ResourceCard
 * of the same answer) - that card says what it made or changed, and the
 * "Executed" line under it only said it again. An action saved before it
 * named its card, one that failed, was skipped or still waits, is drawn.
 */
export function getShownToolActions(
  toolActions: Array<AIChatToolAction>,
  widgets: Array<AIChatWidget>,
): Array<AIChatToolAction> {
  const cardIds: Array<string> = widgets
    .filter((widget: AIChatWidget): boolean => {
      return (
        widget.type === AIChatWidgetType.ResourceCard && Boolean(widget.id)
      );
    })
    .map((widget: AIChatWidget): string => {
      return widget.id;
    });

  return toolActions.filter((action: AIChatToolAction): boolean => {
    return !(
      action.status === AIChatToolActionStatus.Executed &&
      action.widgetId &&
      cardIds.includes(action.widgetId)
    );
  });
}
