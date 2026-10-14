import ModelSchemaAPI from "../../../FeatureSet/Workflow/API/ModelSchema";
import { DocsHeading, scanMarkdown } from "./DocsContentSupport";
import AllModelTypes from "Common/Models/DatabaseModels/Index";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import { JSONObject } from "Common/Types/JSON";
import ComponentMetadata from "Common/Types/Workflow/Component";
import { getNewStepArguments } from "Common/Types/Workflow/ComponentOutPorts";
import BaseModelComponents, {
  SELECT_FIELDS_NAME,
  WATCHED_FIELDS_NAME,
} from "Common/Types/Workflow/Components/BaseModel";
import {
  getDisplayColumn,
  getWorkflowModel,
} from "Common/Types/Workflow/Documentation/ModelExamples";
import {
  FieldOption,
  FieldPickerMode,
  getFieldOptions,
} from "Common/UI/Components/Workflow/FieldPicker/FieldPickerOptions";
import { ModelSchemaColumn } from "Common/UI/Components/Workflow/ModelSchema";
import { jest } from "@jest/globals";

/*
 * A record trigger's two field lists, as the integration guides build them
 * and as the Builder draws them: Fields to pass on and Fields to watch,
 * chips picked from Add field's list, and Edit as JSON behind them
 * (Common/UI/Components/Workflow/ModelFieldPicker).
 *
 * The guides used to give both lists as JSON - {"_id": true, "title":
 * true} - which only goes in after Edit as JSON, and the guides never said
 * so. They name the fields to pick now, as the list names them, and say
 * Edit as JSON wherever JSON is still offered. These read what a guide asks
 * for, and what the real list offers: the /model-schema endpoint describes a
 * model, and the picker's own rules (FieldPickerOptions) name and group its
 * fields, as the browser runs them.
 */

// What the picker's buttons say (ModelFieldPicker's ModelFieldPickerCopy).
export const ADD_FIELD: string = "Add field";
export const EDIT_AS_JSON: string = "Edit as JSON";

export const FIELD_LIST_SETTINGS: ReadonlyArray<string> = [
  SELECT_FIELDS_NAME,
  WATCHED_FIELDS_NAME,
];

const BOLD_SPAN: RegExp = /\*\*([^*\n]+?)\*\*/g;
const CODE_SPAN: RegExp = /`([^`\n]+)`/g;
// "starts with **Title**": what a new trigger's list already holds.
const STARTS_WITH: RegExp = /starts with \*\*([^*\n]+?)\*\*/g;
// The end of a sentence: a full stop before a space or the line's end.
const SENTENCE_END: RegExp = /\.(?:\s|$)/;
// "open **Current Incident State**": a related record, opened to its fields.
const OPENS_A_RECORD: RegExp = /\bopen\s+$/;
const FENCE_LINE: RegExp = /^\s*(`{3,}|~{3,})/;
// A trigger's record, as a later step reads it: incident-on-create-1's.
const TRIGGER_REFERENCE: RegExp =
  /\{\{\s*local\.components\.([a-z0-9-]+-on-(?:create|update)-\d+)\.returnValues\.model\.([A-Za-z0-9_.]+)\s*\}\}/g;
// The number a step's identifier ends in: "-1".
const IDENTIFIER_NUMBER: RegExp = /-\d+$/;

export interface FieldPick {
  // As the list names it: "Description", or a related record's "Name".
  label: string;
  // The related record it is opened from: "Current Incident State".
  relation?: string | undefined;
}

export interface FieldListInstruction {
  // The page's line, from 1.
  line: number;
  // Fields to pass on or Fields to watch.
  setting: string;
  // What a new trigger's list holds already: "starts with **Title**".
  startsWith: Array<string>;
  // The fields picked from Add field's list, in order.
  picks: Array<FieldPick>;
  // Whether it names Add field.
  addsFields: boolean;
  // Whether it names Edit as JSON.
  editAsJson: boolean;
  // The JSON the guide gives to put in under Edit as JSON, if it gives one.
  json?: string | undefined;
}

/*
 * The text of a page outside its code blocks, line by line: code lines are
 * left empty, so a line keeps its number.
 */
function proseLines(markdown: string): Array<string> {
  let inFence: boolean = false;

  return markdown.split("\n").map((line: string): string => {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      return "";
    }

    return inFence ? "" : line;
  });
}

// Where each field list is named on a line: [setting, index of its bold].
function settingsOn(line: string): Array<[string, number]> {
  const found: Array<[string, number]> = [];

  for (const setting of FIELD_LIST_SETTINGS) {
    let from: number = 0;
    let index: number = line.indexOf(`**${setting}**`, from);

    while (index >= 0) {
      found.push([setting, index]);
      from = index + setting.length + 4;
      index = line.indexOf(`**${setting}**`, from);
    }
  }

  return found.sort((a: [string, number], b: [string, number]): number => {
    return a[1] - b[1];
  });
}

// The fields a segment picks after Add field, up to the end of its sentence.
function picksIn(segment: string): Array<FieldPick> {
  const addAt: number = segment.indexOf(`**${ADD_FIELD}**`);

  if (addAt < 0) {
    return [];
  }

  let rest: string = segment.slice(addAt + ADD_FIELD.length + 4);
  const sentenceEnd: number = rest.search(SENTENCE_END);

  if (sentenceEnd >= 0) {
    rest = rest.slice(0, sentenceEnd);
  }

  const jsonAt: number = rest.indexOf(`**${EDIT_AS_JSON}**`);

  if (jsonAt >= 0) {
    rest = rest.slice(0, jsonAt);
  }

  const picks: Array<FieldPick> = [];
  let relation: string | undefined = undefined;
  let previousEnd: number = 0;

  for (const match of Array.from(rest.matchAll(BOLD_SPAN))) {
    const label: string = (match[1] as string).trim();
    const before: string = rest.slice(previousEnd, match.index);

    previousEnd = (match.index as number) + match[0].length;

    if (OPENS_A_RECORD.test(before)) {
      relation = label;
      continue;
    }

    picks.push(relation ? { label: label, relation: relation } : { label });
    relation = undefined;
  }

  return picks;
}

/**
 * Every field list a page names in its prose, as an instruction: which
 * list, what it starts with, what is picked from Add field, and whether it
 * says Edit as JSON, with the JSON it gives there.
 */
export function fieldListInstructions(
  markdown: string,
): Array<FieldListInstruction> {
  const lines: Array<string> = proseLines(markdown);
  const fences: Array<{ lang: string; code: string; line: number }> =
    scanMarkdown(markdown).fences;
  const instructions: Array<FieldListInstruction> = [];

  lines.forEach((line: string, index: number): void => {
    const settings: Array<[string, number]> = settingsOn(line);

    settings.forEach((setting: [string, number], position: number): void => {
      const next: [string, number] | undefined = settings[position + 1];
      /*
       * A list's words run to the next list's name; the first list's start
       * at the line's start too: "click **Edit as JSON** under **Fields to
       * pass on**".
       */
      const segment: string = line.slice(
        position === 0 ? 0 : setting[1],
        next ? next[1] : line.length,
      );
      const editAsJson: boolean = segment.includes(`**${EDIT_AS_JSON}**`);
      const isLast: boolean = !next;
      // The JSON a line gives to paste, in the code block right under it.
      const fence: { lang: string; code: string; line: number } | undefined =
        editAsJson && isLast && line.trimEnd().endsWith(":")
          ? fences.find((candidate: { line: number }): boolean => {
              return (
                candidate.line > index + 1 &&
                lines
                  .slice(index + 1, candidate.line - 1)
                  .every((between: string): boolean => {
                    return between.trim() === "";
                  })
              );
            })
          : undefined;

      instructions.push({
        line: index + 1,
        setting: setting[0],
        startsWith: Array.from(segment.matchAll(STARTS_WITH)).map(
          (match: RegExpMatchArray): string => {
            return (match[1] as string).trim();
          },
        ),
        picks: picksIn(segment),
        addsFields: segment.includes(`**${ADD_FIELD}**`),
        editAsJson: editAsJson,
        json: fence && fence.lang === "json" ? fence.code : undefined,
      });
    });
  });

  return instructions;
}

/**
 * Whether a piece of JSON is a field list as the two settings store one:
 * an object of `true`s, or of related records that are objects of `true`s.
 */
export function isFieldListJson(text: string): boolean {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }

  const isListOf: (value: unknown, depth: number) => boolean = (
    value: unknown,
    depth: number,
  ): boolean => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const entries: Array<unknown> = Object.values(value as JSONObject);

    return (
      entries.length > 0 &&
      entries.every((entry: unknown): boolean => {
        return entry === true || (depth === 0 && isListOf(entry, 1));
      })
    );
  };

  return isListOf(parsed, 0);
}

export interface FieldListJson {
  // The page's line, from 1: the code span's, or the code block's first.
  line: number;
  json: string;
  // A code block rather than a code span.
  isBlock: boolean;
}

// Every field list a page writes as JSON, in its prose or in a code block.
export function fieldListJsonOn(markdown: string): Array<FieldListJson> {
  const found: Array<FieldListJson> = [];

  proseLines(markdown).forEach((line: string, index: number): void => {
    for (const match of Array.from(line.matchAll(CODE_SPAN))) {
      if (isFieldListJson(match[1] as string)) {
        found.push({
          line: index + 1,
          json: match[1] as string,
          isBlock: false,
        });
      }
    }
  });

  for (const fence of scanMarkdown(markdown).fences) {
    if (isFieldListJson(fence.code)) {
      found.push({ line: fence.line, json: fence.code, isBlock: true });
    }
  }

  return found.sort((a: FieldListJson, b: FieldListJson): number => {
    return a.line - b.line;
  });
}

/*
 * The line that introduces a code block: the nearest line above it with
 * text on it.
 */
export function introductionOf(markdown: string, fenceLine: number): string {
  const lines: Array<string> = markdown.split("\n");

  for (let index: number = fenceLine - 2; index >= 0; index--) {
    if ((lines[index] as string).trim() !== "") {
      return lines[index] as string;
    }
  }

  return "";
}

/**
 * The field lists a page writes as JSON with no Edit as JSON before them -
 * `editAsJson` as the page's language draws it, in bold - as "line: JSON":
 * a code span needs it earlier on its line, a code block on the line that
 * introduces it.
 */
export function fieldListJsonBeforeEditAsJson(
  markdown: string,
  editAsJson: string,
): Array<string> {
  const lines: Array<string> = markdown.split("\n");
  const label: string = `**${editAsJson}**`;

  return fieldListJsonOn(markdown)
    .filter((found: FieldListJson): boolean => {
      if (found.isBlock) {
        return !introductionOf(markdown, found.line).includes(label);
      }

      const line: string = lines[found.line - 1] as string;
      const at: number = line.indexOf(label);

      return at < 0 || at > line.indexOf(`\`${found.json}\``);
    })
    .map((found: FieldListJson): string => {
      return `${found.line}: ${found.json}`;
    });
}

// Every inline code span of a line, in order.
export function codeSpansOf(line: string): Array<string> {
  return Array.from(line.matchAll(CODE_SPAN)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// Every bold span of a line, in order.
export function boldSpansOf(line: string): Array<string> {
  return Array.from(line.matchAll(BOLD_SPAN)).map(
    (match: RegExpMatchArray): string => {
      return (match[1] as string).trim();
    },
  );
}

export interface TriggerReference {
  line: number;
  // The trigger step's identifier: "incident-on-create-1".
  trigger: string;
  // What it reads of the record: "title", "currentIncidentState.name".
  path: string;
}

// Every place a page reads a trigger's record, code blocks included.
export function triggerReferences(markdown: string): Array<TriggerReference> {
  const found: Array<TriggerReference> = [];

  markdown.split("\n").forEach((line: string, index: number): void => {
    for (const match of Array.from(line.matchAll(TRIGGER_REFERENCE))) {
      found.push({
        line: index + 1,
        trigger: match[1] as string,
        path: match[2] as string,
      });
    }
  });

  return found;
}

export interface PageSection {
  // The heading's line, from 1; 1 for the page itself.
  start: number;
  // Its last line.
  end: number;
  heading: string;
}

/*
 * The sections a line is in, the innermost first and the whole page last:
 * a section runs from its heading to the next heading of its level or
 * above.
 */
export function sectionsAround(
  markdown: string,
  line: number,
): Array<PageSection> {
  const headings: Array<DocsHeading> = scanMarkdown(markdown).headings;
  const lineCount: number = markdown.split("\n").length;
  const around: Array<PageSection> = [];

  headings.forEach((heading: DocsHeading, index: number): void => {
    const next: DocsHeading | undefined = headings
      .slice(index + 1)
      .find((candidate: DocsHeading): boolean => {
        return candidate.level <= heading.level;
      });
    const end: number = next ? next.line - 1 : lineCount;

    if (heading.line <= line && line <= end) {
      around.push({ start: heading.line, end: end, heading: heading.text });
    }
  });

  around.sort((a: PageSection, b: PageSection): number => {
    return b.start - a.start;
  });
  around.push({ start: 1, end: lineCount, heading: "" });

  return around;
}

/*
 * The trigger a line's field list belongs to: the one the steps around it
 * read, in the innermost section that reads one. Null when that section
 * reads more than one, or none does.
 */
export function triggerOfLine(markdown: string, line: number): string | null {
  const references: Array<TriggerReference> = triggerReferences(markdown);

  for (const section of sectionsAround(markdown, line)) {
    const triggers: Set<string> = new Set(
      references
        .filter((reference: TriggerReference): boolean => {
          return (
            reference.line >= section.start && reference.line <= section.end
          );
        })
        .map((reference: TriggerReference): string => {
          return reference.trigger;
        }),
    );

    if (triggers.size === 1) {
      return Array.from(triggers)[0] as string;
    }

    if (triggers.size > 1) {
      return null;
    }
  }

  return null;
}

// The step a trigger's identifier names: "incident-on-create-1".
export function triggerComponentId(trigger: string): string {
  return trigger.replace(IDENTIFIER_NUMBER, "");
}

let triggerCatalog: Array<ComponentMetadata> | null = null;

// Every record trigger and database step, as the Builder offers them.
function recordComponents(): Array<ComponentMetadata> {
  if (!triggerCatalog) {
    triggerCatalog = AllModelTypes.flatMap(
      (modelType: { new (): BaseModel }): Array<ComponentMetadata> => {
        return BaseModelComponents.getComponents(new modelType());
      },
    );
  }

  return triggerCatalog;
}

// A record step by its id ("incident-on-create"), or by its title.
export function recordComponent(idOrTitle: string): ComponentMetadata {
  const found: ComponentMetadata | undefined = recordComponents().find(
    (candidate: ComponentMetadata): boolean => {
      return candidate.id === idOrTitle || candidate.title === idOrTitle;
    },
  );

  if (!found || !found.tableName) {
    throw new Error(`No record step is called ${idOrTitle}`);
  }

  return found;
}

const columnsByTable: Map<string, Array<ModelSchemaColumn>> = new Map();

/**
 * A model's columns as /model-schema describes them to the field lists
 * (the read gate): the endpoint's own handler, its answer caught.
 */
export async function schemaColumns(
  tableName: string,
): Promise<Array<ModelSchemaColumn>> {
  const cached: Array<ModelSchemaColumn> | undefined =
    columnsByTable.get(tableName);

  if (cached) {
    return cached;
  }

  let body: JSONObject | null = null;
  const answer: { mockRestore: () => void } = jest
    .spyOn(Response, "sendJsonObjectResponse")
    .mockImplementation(
      (_request: unknown, _response: unknown, json: unknown): void => {
        body = json as JSONObject;
      },
    );

  try {
    await new ModelSchemaAPI().getModelSchema(
      {
        params: { tableName: tableName },
        query: {},
      } as unknown as ExpressRequest,
      {} as unknown as ExpressResponse,
      (() => {}) as unknown as NextFunction,
    );
  } finally {
    answer.mockRestore();
  }

  if (!body) {
    throw new Error(`/model-schema did not describe ${tableName}`);
  }

  const columns: Array<ModelSchemaColumn> = (body as JSONObject)[
    "columns"
  ] as unknown as Array<ModelSchemaColumn>;

  columnsByTable.set(tableName, columns);

  return columns;
}

/**
 * What a field list offers for a model, as the picker builds its list:
 * every field by the name it is drawn with, a related record's fields under
 * it.
 */
export async function pickerFields(
  tableName: string,
  setting: string,
): Promise<Array<FieldOption>> {
  const model: BaseModel | null = getWorkflowModel(tableName);

  if (!model) {
    throw new Error(`No model has the table ${tableName}`);
  }

  return getFieldOptions({
    columns: await schemaColumns(tableName),
    mode: modeOf(setting),
    displayColumnId: getDisplayColumn(model).id,
  });
}

// The picker's mode for a list, by the name the step gives it.
export function modeOf(setting: string): FieldPickerMode {
  if (setting === WATCHED_FIELDS_NAME) {
    return FieldPickerMode.Watch;
  }

  if (setting === SELECT_FIELDS_NAME) {
    return FieldPickerMode.PassOn;
  }

  throw new Error(`${setting} is no field list`);
}

/*
 * The field a guide picks, as the list holds it: its own field by its name,
 * or a related record's field under the record it is opened from. Null when
 * the list has no such field.
 */
export function pickedField(
  options: Array<FieldOption>,
  pick: FieldPick,
): FieldOption | null {
  if (pick.relation) {
    const record: FieldOption | undefined = options.find(
      (option: FieldOption): boolean => {
        return Boolean(option.isRelation) && option.title === pick.relation;
      },
    );

    return (
      options.find((option: FieldOption): boolean => {
        return (
          Boolean(record) &&
          option.relationPath === record?.path &&
          option.shortTitle === pick.label
        );
      }) || null
    );
  }

  return (
    options.find((option: FieldOption): boolean => {
      return (
        !option.isRelation &&
        !option.relationPath &&
        option.title === pick.label
      );
    }) || null
  );
}

/*
 * What a trigger passes on as it is added to the canvas: the field that
 * names its record (getNewStepArguments).
 */
export function newTriggerFields(componentId: string): Array<string> {
  const metadata: ComponentMetadata = recordComponent(componentId);
  const select: unknown = getNewStepArguments(
    metadata.id,
    metadata.tableName,
  )?.["select"];

  return select && typeof select === "object"
    ? Object.keys(select as JSONObject)
    : [];
}

/*
 * Whether a field a step reads of a trigger's record is passed on, by the
 * fields the trigger passes on: the record's own field ("projectId" for
 * "projectId.value", an ID arriving as {"_type": "ObjectID", "value": ...})
 * or a related record's ("currentIncidentState.name"). The ID always is.
 */
export function isPassedOn(path: string, passedOn: Set<string>): boolean {
  const parts: Array<string> = path.split(".");
  const own: string = parts[0] as string;

  return (
    own === "_id" ||
    passedOn.has(own) ||
    (parts.length > 1 && passedOn.has(`${own}.${parts[1]}`))
  );
}

// The fields a stored field list names: "title", "currentIncidentState.name".
export function storedFieldPaths(value: JSONObject): Array<string> {
  const paths: Array<string> = [];

  for (const key of Object.keys(value)) {
    const inner: unknown = value[key];

    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      for (const field of Object.keys(inner as JSONObject)) {
        paths.push(`${key}.${field}`);
      }
      continue;
    }

    paths.push(key);
  }

  return paths;
}
