import IconProp from "../../Icon/IconProp";
import { JSONObject } from "../../JSON";
import { getAffectedResourcesArgument } from "../AffectedResourcesSetting";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  ComponentType,
} from "./../Component";

/*
 * INCIDENTS AND ALERTS FROM ANOTHER TOOL.
 *
 * Every template that brings another tool's problems into OneUptime -
 * Zabbix, Huntress, Jira, Dynamics 365 - did the same job with the same
 * steps, written out again in each: find the record by the other tool's ID
 * (Find One, then an If / Else on whether it found one), open one unless it
 * has one (Create One), resolve or acknowledge it by moving it forward
 * (Find Many states, a script that picks the state and keeps it from moving
 * back, an If / Else, a state-timeline Create One), add a note (Create One
 * note), and a Log on every Error output. The Zabbix one had 48 steps. The
 * maintainer: "It should be 4-5 components max, honestly."
 *
 * This is that job as one step, for any tool that can call a URL. It reads
 * one event - What Happened, with the tool's ID for the problem - and keeps
 * one record per ID:
 *
 *   open         opens one, unless a record already has that ID (open or
 *                resolved: use an ID that is new for each problem, as a
 *                Zabbix event ID or a Huntress report number is);
 *   acknowledge  moves it to the project's first acknowledged state;
 *   resolve      moves it to the first resolved state;
 *   a state name moves it to that state;
 *   note         adds the Note as a private note.
 *
 * A record only ever moves forward, by the rule every template moved by: a
 * record at the state or past it, or resolved, is left as it is. The Note
 * is why on the record's timeline when it moves, and a private note when
 * What Happened is note. With a Reason as well, the Reason is why and the
 * Note is added as a private note beside the move: Zabbix sends one update
 * that acknowledges a problem and says something about it. The tool's own
 * words work too - problem, firing, triggered, recovery, ok, comment-added
 * - so most tools need no script in between.
 *
 * A new record's severity is named by its ID or its name, or by where it
 * sits among the project's severities - most severe, middle, least severe -
 * which is how a tool with levels of its own (Zabbix's six, Jira's
 * priorities) is spread over severities the project named itself, without
 * a step to read them first.
 *
 * The record keeps the ID in one of its custom fields (Outside ID Field),
 * which is how the next event finds it, and how the templates that write
 * back to the tool find what the record is about. Only that key is written,
 * so the record's other custom fields are kept.
 */

// The step category both belong to, and their group in the Add Component panel.
export const FROM_OTHER_TOOLS_COMPONENT_CATEGORY: string = "From Other Tools";

export enum FromAnotherToolAction {
  Open = "open",
  Acknowledge = "acknowledge",
  Resolve = "resolve",
  Note = "note",
  // A state of the project's, by name.
  MoveToState = "move-to-state",
  // Nothing to do: What Happened is empty.
  None = "none",
}

/*
 * The words other tools use, each for one action. Matched as a whole value,
 * lower case, with spaces, dashes and underscores between words read as one
 * space: "Comment Added", "comment-added" and "comment_added" are one word.
 */
export const FROM_ANOTHER_TOOL_WORDS: Readonly<
  Record<
    | FromAnotherToolAction.Open
    | FromAnotherToolAction.Acknowledge
    | FromAnotherToolAction.Resolve
    | FromAnotherToolAction.Note,
    ReadonlyArray<string>
  >
> = {
  [FromAnotherToolAction.Open]: [
    "open",
    "opened",
    "create",
    "created",
    "declare",
    "declared",
    "new",
    "problem",
    "trigger",
    "triggered",
    "firing",
    "alerting",
    "alert",
    "down",
  ],
  [FromAnotherToolAction.Acknowledge]: [
    "acknowledge",
    "acknowledged",
    "ack",
    "acked",
  ],
  [FromAnotherToolAction.Resolve]: [
    "resolve",
    "resolved",
    "recovery",
    "recovered",
    "ok",
    "close",
    "closed",
    "clear",
    "cleared",
    "up",
  ],
  [FromAnotherToolAction.Note]: [
    "note",
    "update",
    "updated",
    "comment",
    "commented",
    "comment added",
  ],
};

export interface WhatHappened {
  action: FromAnotherToolAction;
  /*
   * For MoveToState, the state's name as given, trimmed; otherwise the word
   * as given, trimmed, so the run can say what it read.
   */
  given: string;
}

// The longest What Happened that is read: a word or a state's name.
export const MAX_WHAT_HAPPENED_LENGTH: number = 200;

// What starts a What Happened that names a state, whatever the state is called.
export const STATE_PREFIX: string = "state:";

export type ReadWhatHappenedFunction = (value: unknown) => WhatHappened;

/*
 * What a What Happened value asks for. A word that is none of the actions'
 * is read as the name of a state, which the step looks for among the
 * project's states when it runs. Read with a loop, never a pattern: the
 * value can be any text a webhook sent.
 */
export const readWhatHappened: ReadWhatHappenedFunction = (
  value: unknown,
): WhatHappened => {
  const given: string =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : "";

  if (!given) {
    return { action: FromAnotherToolAction.None, given: "" };
  }

  const clipped: string = given.slice(0, MAX_WHAT_HAPPENED_LENGTH);

  /*
   * "state: Open" always names a state, even one called like an action: a
   * template that maps another tool's statuses onto states by name writes
   * it so, and a state called Open or Resolved is still that state.
   */
  if (clipped.slice(0, STATE_PREFIX.length).toLowerCase() === STATE_PREFIX) {
    const name: string = clipped.slice(STATE_PREFIX.length).trim();

    return name
      ? { action: FromAnotherToolAction.MoveToState, given: name }
      : { action: FromAnotherToolAction.None, given: "" };
  }
  let word: string = "";
  let lastWasSpace: boolean = false;

  for (const character of clipped.toLowerCase()) {
    const isSpace: boolean =
      character === " " ||
      character === "-" ||
      character === "_" ||
      character === "\t";

    if (isSpace) {
      lastWasSpace = word.length > 0;
      continue;
    }

    if (lastWasSpace) {
      word += " ";
      lastWasSpace = false;
    }

    word += character;
  }

  for (const action of [
    FromAnotherToolAction.Open,
    FromAnotherToolAction.Acknowledge,
    FromAnotherToolAction.Resolve,
    FromAnotherToolAction.Note,
  ] as const) {
    if (FROM_ANOTHER_TOOL_WORDS[action].includes(word)) {
      return { action: action, given: clipped };
    }
  }

  return { action: FromAnotherToolAction.MoveToState, given: clipped };
};

// The custom field the ID is kept in when Outside ID Field is empty.
export const DEFAULT_OUTSIDE_ID_FIELD: string = "externalId";

// The longest outside ID that is kept: an ID, not a document.
export const MAX_OUTSIDE_ID_LENGTH: number = 500;

/*
 * A custom field's key the step writes: letters, digits and underscores,
 * starting with a letter, as the templates' zabbixEventId and
 * huntressReportId are. One class repeated, anchored, so it reads any text
 * in time in line with its length.
 */
const OUTSIDE_ID_FIELD_PATTERN: RegExp = /^[A-Za-z][A-Za-z0-9_]{0,99}$/;

export type ReadOutsideIdFieldFunction = (value: unknown) => string | null;

/*
 * The custom field to keep the outside ID in: the setting, or externalId
 * when it is empty. Null for a setting that is not a key the step writes.
 */
export const readOutsideIdField: ReadOutsideIdFieldFunction = (
  value: unknown,
): string | null => {
  const given: string = typeof value === "string" ? value.trim() : "";

  if (!given) {
    return DEFAULT_OUTSIDE_ID_FIELD;
  }

  return OUTSIDE_ID_FIELD_PATTERN.test(given) ? given : null;
};

/*
 * Where a severity sits among the project's, in words, for a tool whose
 * levels are its own: the most severe, the one in the middle, the least
 * severe. Matched as What Happened is - in any case, with spaces, dashes and
 * underscores between words read as one space - and only when no severity
 * of the project's has that name.
 */
export enum SeverityPosition {
  MostSevere = "most severe",
  Middle = "middle",
  LeastSevere = "least severe",
}

export const SEVERITY_POSITIONS: ReadonlyArray<SeverityPosition> = [
  SeverityPosition.MostSevere,
  SeverityPosition.Middle,
  SeverityPosition.LeastSevere,
];

// A value as one lower-case phrase: "Most-Severe" and "most_severe" read "most severe".
const asPhrase: (value: string) => string = (value: string): string => {
  let phrase: string = "";
  let lastWasSpace: boolean = false;

  for (const character of value.slice(0, MAX_WHAT_HAPPENED_LENGTH)) {
    const isSpace: boolean =
      character === " " ||
      character === "-" ||
      character === "_" ||
      character === "\t";

    if (isSpace) {
      lastWasSpace = phrase.length > 0;
      continue;
    }

    if (lastWasSpace) {
      phrase += " ";
      lastWasSpace = false;
    }

    phrase += character.toLowerCase();
  }

  return phrase;
};

export interface SeverityChoice {
  // The chosen severity's place in the list, most severe first.
  index: number;
  // How the setting named it; "none" is the most severe, for a setting that named none.
  namedBy: "id" | "name" | "position" | "none";
}

export type PickSeverityIndexFunction = (data: {
  given: string;
  // The project's severities, most severe first.
  severities: ReadonlyArray<{ id: string; name: string }>;
}) => SeverityChoice;

/*
 * Which of the project's severities a setting names: by its ID, by its
 * name, in any case, or by its place (SeverityPosition). The middle one of
 * an even number is the less severe of the two in the middle, as the
 * templates have always spread three levels over a project's severities:
 * Math.round((rank / 2) * (count - 1)). A setting that names none of them
 * is the most severe: a problem nobody is told about is worse than one that
 * wakes somebody.
 */
export const pickSeverityIndex: PickSeverityIndexFunction = (data: {
  given: string;
  severities: ReadonlyArray<{ id: string; name: string }>;
}): SeverityChoice => {
  const given: string = data.given.trim().toLowerCase();
  const count: number = data.severities.length;

  if (given && count > 0) {
    const byId: number = data.severities.findIndex(
      (severity: { id: string; name: string }): boolean => {
        return severity.id.toLowerCase() === given;
      },
    );

    if (byId !== -1) {
      return { index: byId, namedBy: "id" };
    }

    const byName: number = data.severities.findIndex(
      (severity: { id: string; name: string }): boolean => {
        return severity.name.trim().toLowerCase() === given;
      },
    );

    if (byName !== -1) {
      return { index: byName, namedBy: "name" };
    }

    const rank: number = SEVERITY_POSITIONS.indexOf(
      asPhrase(data.given) as SeverityPosition,
    );

    if (rank !== -1) {
      return {
        index: Math.round((rank / 2) * (count - 1)),
        namedBy: "position",
      };
    }
  }

  return { index: 0, namedBy: "none" };
};

export type ReadCustomFieldsFunction = (
  value: unknown,
) => { fields: JSONObject } | { error: string };

/*
 * The Custom Fields setting: a JSON object, as the runner hands it, or the
 * JSON text of one. Empty is no fields. Anything else is refused, rather
 * than a record opened without what the workflow meant it to keep.
 */
export const CUSTOM_FIELDS_REFUSAL: string =
  'Custom Fields must be a JSON object, such as {"caseNumber": "CAS-1"}.';

export const readCustomFields: ReadCustomFieldsFunction = (
  value: unknown,
): { fields: JSONObject } | { error: string } => {
  if (value === undefined || value === null) {
    return { fields: {} };
  }

  let parsed: unknown = value;

  if (typeof value === "string") {
    if (!value.trim()) {
      return { fields: {} };
    }

    try {
      parsed = JSON.parse(value);
    } catch {
      return { error: CUSTOM_FIELDS_REFUSAL };
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: CUSTOM_FIELDS_REFUSAL };
  }

  return { fields: parsed as JSONObject };
};

export type ReadOutsideIdFunction = (value: unknown) => string;

// The outside ID, as text, trimmed: an ID can come as a number.
export const readOutsideId: ReadOutsideIdFunction = (
  value: unknown,
): string => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return typeof value === "string" ? value.trim() : "";
};

/*
 * The stored ids of the steps' settings, outputs and values. Every
 * template and docs page uses them, so they never change; only the names
 * shown for them do.
 */
export const FROM_ANOTHER_TOOL_ARGUMENT_IDS: {
  readonly whatHappened: string;
  readonly outsideId: string;
  readonly title: string;
  readonly description: string;
  readonly severity: string;
  readonly note: string;
  readonly reason: string;
  readonly recordId: string;
  readonly outsideIdField: string;
  readonly customFields: string;
  readonly labels: string;
  readonly showOnStatusPages: string;
  readonly noteInsteadOfResolving: string;
} = {
  whatHappened: "what-happened",
  outsideId: "outside-id",
  title: "title",
  description: "description",
  severity: "severity",
  note: "note",
  reason: "reason",
  recordId: "record-id",
  outsideIdField: "outside-id-field",
  customFields: "custom-fields",
  labels: "labels",
  showOnStatusPages: "show-on-status-pages",
  noteInsteadOfResolving: "note-instead-of-resolving",
};

export const FROM_ANOTHER_TOOL_PORT_IDS: {
  readonly opened: string;
  readonly updated: string;
  readonly unchanged: string;
  readonly error: string;
} = {
  opened: "opened",
  updated: "updated",
  unchanged: "unchanged",
  error: "error",
};

export const FROM_ANOTHER_TOOL_RETURN_VALUE_IDS: {
  readonly record: string;
  readonly summary: string;
} = {
  record: "record",
  summary: "summary",
};

/*
 * Everything the incident and the alert step say differently. An incident
 * is opened; an alert is created, as the product says everywhere else.
 */
export interface FromAnotherToolKind {
  componentId: ComponentID;
  tableName: string;
  noun: string;
  Noun: string;
  // "opens" / "creates", "Open" / "Create", "Opened" / "Created".
  opens: string;
  Opens: string;
  Opened: string;
  icon: IconProp;
  hasStatusPages: boolean;
}

export const INCIDENT_FROM_ANOTHER_TOOL: FromAnotherToolKind = {
  componentId: ComponentID.IncidentFromAnotherTool,
  tableName: "Incident",
  noun: "incident",
  Noun: "Incident",
  opens: "opens",
  Opens: "Open",
  Opened: "Opened",
  icon: IconProp.Alert,
  hasStatusPages: true,
};

export const ALERT_FROM_ANOTHER_TOOL: FromAnotherToolKind = {
  componentId: ComponentID.AlertFromAnotherTool,
  tableName: "Alert",
  noun: "alert",
  Noun: "Alert",
  opens: "creates",
  Opens: "Create",
  Opened: "Created",
  icon: IconProp.ExclaimationCircle,
  hasStatusPages: false,
};

export const FROM_ANOTHER_TOOL_KINDS: ReadonlyArray<FromAnotherToolKind> = [
  INCIDENT_FROM_ANOTHER_TOOL,
  ALERT_FROM_ANOTHER_TOOL,
];

type FromAnotherToolMetadataFunction = (
  kind: FromAnotherToolKind,
) => ComponentMetadata;

const fromAnotherToolMetadata: FromAnotherToolMetadataFunction = (
  kind: FromAnotherToolKind,
): ComponentMetadata => {
  const n: string = kind.noun;
  const ids: typeof FROM_ANOTHER_TOOL_ARGUMENT_IDS =
    FROM_ANOTHER_TOOL_ARGUMENT_IDS;
  const affectedResources: Argument | null = getAffectedResourcesArgument(
    kind.tableName,
  );

  const argumentsList: Array<Argument> = [
    {
      id: ids.whatHappened,
      name: "What Happened",
      description: `One of open, acknowledge, resolve or note. The tool's own words work too, such as problem, firing or recovery, and a state's name moves the ${n} there.`,
      type: ComponentInputType.Text,
      required: true,
      placeholder: "problem",
    },
    {
      id: ids.outsideId,
      name: "Outside ID",
      description: `The other tool's ID for the problem, such as a Zabbix event ID. Every event with the same ID acts on the same ${n}.`,
      type: ComponentInputType.Text,
      required: true,
      notRequiredWhen: { argumentId: ids.recordId },
      placeholder: "40312",
    },
    {
      id: ids.title,
      name: "Title",
      description: `The ${n}'s title. Needed when the step ${kind.opens} one.`,
      type: ComponentInputType.Text,
      required: false,
      placeholder: "Zabbix: High CPU on web-01",
    },
    {
      id: ids.description,
      name: "Description",
      description: `Markdown for the new ${n}'s description.`,
      type: ComponentInputType.Markdown,
      required: false,
    },
    {
      id: ids.severity,
      name: "Severity",
      description: `A new ${n}'s severity: one of yours by name or ID, or most severe, middle or least severe. Otherwise your most severe.`,
      type: ComponentInputType.Text,
      required: false,
      placeholder: kind.hasStatusPages ? "Critical Incident" : "High",
    },
    {
      id: ids.note,
      name: "Note",
      description: `Markdown about the event: why, on the timeline, when the ${n} changes state, or a private note when What Happened is note.`,
      type: ComponentInputType.Markdown,
      required: false,
    },
    {
      id: ids.reason,
      name: "Reason",
      description: `Why the ${n} changes state, on its timeline. When set, the Note is added as a private note as well.`,
      type: ComponentInputType.Markdown,
      required: false,
      isAdvanced: true,
    },
    {
      id: ids.recordId,
      name: `${kind.Noun} ID`,
      description: `Act on the ${n} with this ID instead of the one Outside ID finds, when the other tool keeps the ${n}'s ID.`,
      type: ComponentInputType.Text,
      required: false,
      isAdvanced: true,
    },
    {
      id: ids.outsideIdField,
      name: "Outside ID Field",
      description: `The ${n} custom field that keeps the Outside ID, so later events find it. Left empty, externalId.`,
      type: ComponentInputType.Text,
      required: false,
      isAdvanced: true,
      placeholder: DEFAULT_OUTSIDE_ID_FIELD,
    },
    {
      id: ids.customFields,
      name: "Custom Fields",
      description: `More custom fields a new ${n} gets, as a JSON object. The Outside ID is added to them.`,
      type: ComponentInputType.JSON,
      required: false,
      isAdvanced: true,
      placeholder: '{"caseNumber": "CAS-1"}',
    },
    ...(affectedResources ? [{ ...affectedResources, isAdvanced: true }] : []),
    {
      id: ids.labels,
      name: "Labels",
      description: `IDs of the labels a new ${n} gets, separated by commas.`,
      type: ComponentInputType.Text,
      required: false,
      isAdvanced: true,
    },
    ...(kind.hasStatusPages
      ? [
          {
            id: ids.showOnStatusPages,
            name: "Show On Status Pages",
            description:
              "Show a new incident on your status pages and tell their subscribers. Off by default: another tool's text is written for its own users.",
            type: ComponentInputType.Boolean,
            required: false,
            isAdvanced: true,
          },
        ]
      : []),
    {
      id: ids.noteInsteadOfResolving,
      name: "Note Instead Of Resolving",
      description: `When the tool says the problem is over, add the Note and leave the ${n} for people to resolve.`,
      type: ComponentInputType.Boolean,
      required: false,
      isAdvanced: true,
    },
  ];

  return {
    id: kind.componentId,
    title: `${kind.Noun} From Another Tool`,
    category: FROM_OTHER_TOOLS_COMPONENT_CATEGORY,
    description: `${kind.Opens}, acknowledge or resolve an ${n} for a problem in another tool, or add a note to it, matched by that tool's ID.`,
    iconProp: kind.icon,
    componentType: ComponentType.Component,
    arguments: argumentsList,
    returnValues: [
      {
        id: FROM_ANOTHER_TOOL_RETURN_VALUE_IDS.record,
        name: kind.Noun,
        description: `The ${n} the step ${kind.opens === "opens" ? "opened" : "created"} or found: its ID, number, title, state and severity.`,
        type: ComponentInputType.JSON,
        required: false,
      },
      {
        id: FROM_ANOTHER_TOOL_RETURN_VALUE_IDS.summary,
        name: "Summary",
        description: "What the step did, in a sentence.",
        type: ComponentInputType.Text,
        required: false,
      },
    ],
    inPorts: [
      {
        title: "In",
        description: "Connect the step that runs before this one.",
        id: "in",
      },
    ],
    outPorts: [
      {
        title: kind.Opened,
        description: `Runs next when the step ${kind.opens} a new ${n}.`,
        id: FROM_ANOTHER_TOOL_PORT_IDS.opened,
      },
      {
        title: "Updated",
        description: `Runs next when the step moved the ${n} or added a note.`,
        id: FROM_ANOTHER_TOOL_PORT_IDS.updated,
      },
      {
        title: "Unchanged",
        description: `Runs next when there was nothing to do: no ${n} has the ID, or it is there already.`,
        id: FROM_ANOTHER_TOOL_PORT_IDS.unchanged,
      },
      {
        title: "Error",
        description: `Runs next when the step could not read or change the ${n}.`,
        id: FROM_ANOTHER_TOOL_PORT_IDS.error,
      },
    ],
  };
};

const components: Array<ComponentMetadata> = FROM_ANOTHER_TOOL_KINDS.map(
  fromAnotherToolMetadata,
);

export default components;
