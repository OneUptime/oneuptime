import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Hostname from "../../Types/API/Hostname";
import URL from "../../Types/API/URL";
import GreaterThan from "../../Types/BaseDatabase/GreaterThan";
import Includes from "../../Types/BaseDatabase/Includes";
import NotEqual from "../../Types/BaseDatabase/NotEqual";
import Search from "../../Types/BaseDatabase/Search";
import Dictionary from "../../Types/Dictionary";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import IP from "../../Types/IP/IP";
import { JSONObject, JSONValue } from "../../Types/JSON";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import ObjectID from "../../Types/ObjectID";
import { Hcl, HclBodyItem, HclExpression, printHclDocument } from "./Hcl";
import {
  DeveloperDocsLiveData,
  DeveloperDocsLivePick,
  DeveloperDocsLiveRecord,
  pickDeveloperDocsLiveRecord,
} from "./LiveData";
import {
  COMMON_FIELD_ABOUT,
  DeveloperDocsField,
  DeveloperDocsFilter,
  DeveloperDocsProfile,
  DeveloperDocsQueryPart,
  DeveloperDocsRecipe,
  DeveloperDocsScopeName,
  DeveloperDocsSort,
  DeveloperDocsTask,
  DeveloperDocsValue,
  getDeveloperDocsProfile,
  getDeveloperDocsProfileFields,
} from "./ResourceProfiles";
import { monitorStepsToHcl } from "./TerraformMonitorSteps";
import {
  canLookUpByName,
  getNameColumn,
  getTerraformAttributes,
  getTerraformTypeName,
  TerraformAttributeDescriptor,
  TerraformValueKind,
} from "./TerraformSchema";
import {
  jsonToHcl,
  TerraformSecretVariable,
  TerraformVariableCollector,
  toTerraformIdentifier,
} from "./TerraformValues";
import {
  getExampleJsonValue,
  toSentenceCaseName,
  withIndefiniteArticle,
} from "./ExampleValues";

/*
 * The examples on the Developer pages, written from a resource's profile
 * (ResourceProfiles) and what the page knows about the project (LiveData):
 *
 *   - a new resource, as Terraform and as an API request, with the fields
 *     most people set and a line on each;
 *   - the recipes and tasks that come up again and again for it;
 *   - the filters, reads and changes the API page shows.
 *
 * A field is a model column throughout: its Terraform attribute, its type,
 * whether it is a secret, and the model it points at all come from the
 * model's metadata (TerraformSchema), so an example cannot name an attribute
 * the provider does not have. An id points at one of the project's records
 * where the page could look one up, with the record's name in a comment, and
 * at a placeholder in angle brackets only where it could not.
 */

// Where an example is shown: the record a view page is about, and the project.
export interface DeveloperDocsExampleContext {
  live: DeveloperDocsLiveData;
  record?:
    | {
        id: string;
        displayName: string | null;
        // Its API JSON, with the fields the page fetched.
        json?: JSONObject | undefined;
        // Its Terraform address, once its configuration is on the page.
        terraformAddress?: string | undefined;
      }
    | undefined;
}

// A value worked out for one field.
export interface DeveloperDocsResolvedValue {
  // As the API takes it.
  json: JSONValue;
  // For Terraform: a reference to another block, when it is one.
  reference?: string | undefined;
  // The names of the records it points at, one per id.
  names: Array<string | null>;
  // What it points at, in words ("incident state"), when it is a record.
  noun?: string | undefined;
  // Whether something in it is a placeholder to replace.
  isPlaceholder: boolean;
  // Whether it came from the project's own records.
  fromProject?: boolean | undefined;
}

// A row of the table that says what each field of an example is for.
export interface DeveloperDocsFieldRow {
  // The Terraform attribute or the API field.
  name: string;
  about: string;
  required: boolean;
}

export class DeveloperDocsExampleError extends Error {}

const MAX_EXAMPLE_TEXT_LENGTH: number = 80;

// `<incident severity id>`: what to replace with one of your own.
export function getPlaceholder(text: string): string {
  return `<${text}>`;
}

const PLACEHOLDER_TEXT: RegExp = /^<[^<>]+>$/;

export function isPlaceholderText(value: unknown): boolean {
  return typeof value === "string" && PLACEHOLDER_TEXT.test(value);
}

function containsPlaceholder(value: unknown): boolean {
  if (isPlaceholderText(value)) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.some(containsPlaceholder);
  }

  if (value && typeof value === "object") {
    return Object.values(value as Dictionary<unknown>).some(
      containsPlaceholder,
    );
  }

  return false;
}

function getColumns(
  modelType: DatabaseBaseModelType,
): Dictionary<TableColumnMetadata> {
  return getTableColumns(new modelType());
}

function getColumn(
  modelType: DatabaseBaseModelType,
  column: string,
): TableColumnMetadata {
  const metadata: TableColumnMetadata | undefined =
    getColumns(modelType)[column];

  if (!metadata) {
    throw new DeveloperDocsExampleError(
      `${new modelType().tableName} has no column ${column}.`,
    );
  }

  return metadata;
}

/*
 * The model a column points at: a list of records' model (`labels`), or the
 * model of the relation an id is the key of (`incidentSeverityId`).
 */
export function getRelatedModelType(
  modelType: DatabaseBaseModelType,
  column: string,
): DatabaseBaseModelType | undefined {
  const columns: Dictionary<TableColumnMetadata> = getColumns(modelType);
  const metadata: TableColumnMetadata | undefined = columns[column];

  if (metadata?.type === TableColumnType.EntityArray && metadata.modelType) {
    return metadata.modelType as DatabaseBaseModelType;
  }

  for (const key of Object.keys(columns)) {
    const relation: TableColumnMetadata | undefined = columns[key];

    if (
      relation?.type === TableColumnType.Entity &&
      relation.manyToOneRelationColumn === column &&
      relation.modelType
    ) {
      return relation.modelType as DatabaseBaseModelType;
    }
  }

  return undefined;
}

export function getTableName(modelType: DatabaseBaseModelType): string {
  return new modelType().tableName || "";
}

// "incident severity", for placeholders and sentences.
function getNoun(modelType: DatabaseBaseModelType): string {
  const model: DatabaseBaseModel = new modelType();

  return toSentenceCaseName(model.singularName || model.tableName || "");
}

/*
 * A date `days` from the page's now (or the next `weekday`), at the given
 * UTC time, as the API writes dates.
 */
export function getDeveloperDocsDate(data: {
  now: Date;
  days?: number | undefined;
  weekday?: number | undefined;
  hour?: number | undefined;
  minute?: number | undefined;
}): string {
  const date: Date = new Date(data.now.getTime());

  if (data.weekday !== undefined) {
    // The next one strictly after today, so it is always ahead.
    const ahead: number = (data.weekday - date.getUTCDay() + 7) % 7 || 7;
    date.setUTCDate(date.getUTCDate() + ahead);
  } else if (data.days !== undefined) {
    date.setUTCDate(date.getUTCDate() + data.days);
  }

  if (data.hour !== undefined) {
    date.setUTCHours(data.hour, data.minute || 0, 0, 0);
  }

  if (data.hour === undefined && data.weekday === undefined) {
    date.setUTCSeconds(0, 0);
  }

  return date.toISOString();
}

function resolveLive(data: {
  context: DeveloperDocsExampleContext;
  modelType: DatabaseBaseModelType;
  column: string;
  tableName?: string | undefined;
  pick?: DeveloperDocsLivePick | undefined;
  list?: boolean | undefined;
}): DeveloperDocsResolvedValue {
  const related: DatabaseBaseModelType | undefined = getRelatedModelType(
    data.modelType,
    data.column,
  );
  const tableName: string =
    data.tableName || (related ? getTableName(related) : "");

  if (!tableName) {
    throw new DeveloperDocsExampleError(
      `${getTableName(data.modelType)}.${data.column} points at no model; give the live value a table.`,
    );
  }

  const record: DeveloperDocsLiveRecord | null = pickDeveloperDocsLiveRecord(
    data.context.live,
    tableName,
    data.pick,
  );
  const noun: string =
    related && getTableName(related) === tableName
      ? getNoun(related)
      : toSentenceCaseName(tableName.replace(/([a-z])([A-Z])/g, "$1 $2"));
  const id: string = record ? record.id : getPlaceholder(`${noun} id`);

  return {
    json: data.list ? [id] : id,
    names: [record?.name || null],
    noun,
    isPlaceholder: !record,
    fromProject: Boolean(record),
  };
}

// The monitor steps a new monitor of a type starts with, for the project.
function resolveMonitorSteps(
  value: Extract<DeveloperDocsValue, { kind: "monitorSteps" }>,
  context: DeveloperDocsExampleContext,
  monitorName: string,
): DeveloperDocsResolvedValue {
  const pickId: (
    tableName: string,
    pick: DeveloperDocsLivePick | undefined,
    placeholder: string,
  ) => { id: string; record: DeveloperDocsLiveRecord | null } = (
    tableName: string,
    pick: DeveloperDocsLivePick | undefined,
    placeholder: string,
  ) => {
    const record: DeveloperDocsLiveRecord | null = pickDeveloperDocsLiveRecord(
      context.live,
      tableName,
      pick,
    );

    return { id: record ? record.id : getPlaceholder(placeholder), record };
  };

  const online: { id: string; record: DeveloperDocsLiveRecord | null } = pickId(
    "MonitorStatus",
    { flag: "isOperationalState" },
    "operational monitor status id",
  );
  const offline: { id: string; record: DeveloperDocsLiveRecord | null } =
    pickId(
      "MonitorStatus",
      { flag: "isOfflineState" },
      "offline monitor status id",
    );
  const incidentSeverity: {
    id: string;
    record: DeveloperDocsLiveRecord | null;
  } = pickId("IncidentSeverity", undefined, "incident severity id");
  const alertSeverity: { id: string; record: DeveloperDocsLiveRecord | null } =
    pickId("AlertSeverity", undefined, "alert severity id");

  const steps: MonitorSteps = MonitorSteps.getDefaultMonitorSteps({
    monitorType: value.monitorType,
    monitorName,
    defaultMonitorStatusId: new ObjectID(online.id),
    onlineMonitorStatusId: new ObjectID(online.id),
    offlineMonitorStatusId: new ObjectID(offline.id),
    defaultIncidentSeverityId: new ObjectID(incidentSeverity.id),
    defaultAlertSeverityId: new ObjectID(alertSeverity.id),
  });

  const step: MonitorStep | undefined =
    steps.data?.monitorStepsInstanceArray[0];

  if (step && value.destination) {
    const destination: URL | Hostname | IP =
      value.destination.type === "URL"
        ? URL.fromString(value.destination.value)
        : value.destination.type === "IP"
          ? new IP(value.destination.value)
          : new Hostname(value.destination.value);
    step.setMonitorDestination(destination);
  }

  if (step && value.requestHeaders) {
    step.setRequestHeaders(value.requestHeaders);
  }

  /*
   * A criteria that does not open incidents (or alerts) needs no incident
   * (or alert) template: the dashboard keeps one ready in case it is
   * switched on, but in an example it is only noise.
   */
  for (const instance of step?.data?.monitorCriteria.data
    ?.monitorCriteriaInstanceArray || []) {
    if (instance.data && !instance.data.createIncidents) {
      instance.data.incidents = [];
    }

    if (instance.data && !instance.data.createAlerts) {
      instance.data.alerts = [];
    }
  }

  const records: Array<DeveloperDocsLiveRecord | null> = [
    online.record,
    offline.record,
    incidentSeverity.record,
    alertSeverity.record,
  ];

  const isPlaceholder: boolean = records.some(
    (record: DeveloperDocsLiveRecord | null): boolean => {
      return !record;
    },
  );

  return {
    json: withoutGeneratedIds(steps.toJSON()) as JSONValue,
    names: [],
    isPlaceholder,
    fromProject: !isPlaceholder,
  };
}

/*
 * Monitor steps without the ids the dashboard gives each step, criteria and
 * template: the server assigns them, and the Terraform provider never sends
 * them either.
 */
export function withoutGeneratedIds(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutGeneratedIds);
  }

  if (value && typeof value === "object") {
    const result: Dictionary<unknown> = {};

    for (const [key, item] of Object.entries(value as Dictionary<unknown>)) {
      if (key === "id" || item === undefined) {
        continue;
      }

      result[key] = withoutGeneratedIds(item);
    }

    return result;
  }

  return value;
}

/*
 * The value an example gives a field with no value of its own: one of the
 * project's records for a column that points at one, the column's
 * documented example when it is short, its default, or a placeholder.
 */
function getDefaultFieldValue(data: {
  modelType: DatabaseBaseModelType;
  column: string;
}): DeveloperDocsValue {
  const metadata: TableColumnMetadata = getColumn(data.modelType, data.column);

  if (getRelatedModelType(data.modelType, data.column)) {
    return {
      kind: "live",
      list: metadata.type === TableColumnType.EntityArray,
    };
  }

  const example: unknown = metadata.example;

  if (
    (typeof example === "string" &&
      example.length > 0 &&
      example.length <= MAX_EXAMPLE_TEXT_LENGTH &&
      !example.includes("\n")) ||
    typeof example === "number" ||
    typeof example === "boolean"
  ) {
    return { kind: "literal", value: example as JSONValue };
  }

  if (metadata.defaultValue !== undefined && metadata.defaultValue !== null) {
    return { kind: "literal", value: metadata.defaultValue as JSONValue };
  }

  const singularName: string = new data.modelType().singularName || "";
  const descriptor: TerraformAttributeDescriptor | undefined =
    getTerraformAttributes(data.modelType).find(
      (item: TerraformAttributeDescriptor): boolean => {
        return item.columnName === data.column;
      },
    );

  if (descriptor) {
    return {
      kind: "literal",
      value: getExampleJsonValue({
        descriptor,
        singularName,
        isNameColumn: getNameColumn(data.modelType) === data.column,
      }),
    };
  }

  return {
    kind: "literal",
    value: getPlaceholder((metadata.title || data.column).toLowerCase()),
  };
}

// Works out what an example sets a field to.
export function resolveDeveloperDocsValue(data: {
  modelType: DatabaseBaseModelType;
  column: string;
  value?: DeveloperDocsValue | undefined;
  context: DeveloperDocsExampleContext;
  // The recipe's blocks, for references between them (Terraform).
  references?: Dictionary<string> | undefined;
  // The name of the monitor, for monitor steps.
  monitorName?: string | undefined;
}): DeveloperDocsResolvedValue {
  const value: DeveloperDocsValue =
    data.value ||
    getDefaultFieldValue({ modelType: data.modelType, column: data.column });
  const { context } = data;

  switch (value.kind) {
    case "literal":
      return {
        json: value.value,
        names: [],
        isPlaceholder: containsPlaceholder(value.value),
      };
    case "live":
      return resolveLive({
        context,
        modelType: data.modelType,
        column: data.column,
        tableName: value.tableName,
        pick: value.pick,
        list: value.list,
      });
    case "liveName": {
      const record: DeveloperDocsLiveRecord | null =
        pickDeveloperDocsLiveRecord(context.live, value.tableName, value.pick);

      return {
        json: record?.name || value.fallback,
        names: [],
        isPlaceholder: false,
        fromProject: Boolean(record),
      };
    }
    case "this": {
      if (!context.record) {
        throw new DeveloperDocsExampleError(
          `${getTableName(data.modelType)}.${data.column} points at the page's record, and this page has none.`,
        );
      }

      return {
        json: value.list ? [context.record.id] : context.record.id,
        reference: context.record.terraformAddress
          ? `${context.record.terraformAddress}.id`
          : undefined,
        names: [context.record.displayName],
        isPlaceholder: false,
      };
    }
    case "thisName":
      return {
        json: context.record?.displayName || value.fallback,
        names: [],
        isPlaceholder: false,
      };
    case "me": {
      const id: string =
        context.live.currentUserId || getPlaceholder("your user id");

      return {
        json: id,
        names: [context.live.currentUserId ? "you" : null],
        isPlaceholder: !context.live.currentUserId,
        fromProject: Boolean(context.live.currentUserId),
      };
    }
    case "date":
      return {
        json: getDeveloperDocsDate({
          now: context.live.now,
          days: value.days,
          weekday: value.weekday,
          hour: value.hour,
          minute: value.minute,
        }),
        names: [],
        isPlaceholder: false,
      };
    case "monitorSteps":
      return resolveMonitorSteps(
        value,
        context,
        data.monitorName || "this monitor",
      );
    case "ref": {
      const reference: string | undefined = data.references?.[value.block];

      if (!reference) {
        throw new DeveloperDocsExampleError(
          `${getTableName(data.modelType)}.${data.column} refers to a block named ${value.block} that comes later or does not exist.`,
        );
      }

      return {
        json: value.list ? [reference] : reference,
        reference,
        names: [null],
        isPlaceholder: false,
      };
    }
  }
}

// What a field is for: its own words, the shared ones, or its model's description.
export function getDeveloperDocsFieldAbout(data: {
  modelType: DatabaseBaseModelType;
  field: DeveloperDocsField;
}): string {
  if (data.field.about) {
    return data.field.about;
  }

  if (COMMON_FIELD_ABOUT[data.field.column]) {
    return COMMON_FIELD_ABOUT[data.field.column] as string;
  }

  /*
   * The first sentence of the model's description ("e.g." and "i.e." do not
   * end one), with its full stop.
   */
  const description: string = (
    getColumn(data.modelType, data.field.column).description || ""
  )
    .trim()
    .replace(ABBREVIATION_DOT, `$1${ABBREVIATION_MARK}`);
  const firstSentence: string = (
    description.match(FIRST_SENTENCE)?.[0] || description
  )
    .split(ABBREVIATION_MARK)
    .join(".")
    .trim();

  if (!firstSentence) {
    return toSentenceCaseName(data.field.column);
  }

  return SENTENCE_END.test(firstSentence) ? firstSentence : `${firstSentence}.`;
}

// The dot of "e.g." and "i.e.", which does not end a sentence.
const ABBREVIATION_DOT: RegExp = /\b(e\.g|i\.e)\./g;
// Stands in for that dot while the first sentence is found.
const ABBREVIATION_MARK: string = "\u2024";
const FIRST_SENTENCE: RegExp = /^[\s\S]*?[.!?](?=\s|$)/;
const SENTENCE_END: RegExp = /[.!?]$/;

// Turns `name`/`title` into a short label for a block: "Checkout API" -> checkout_api.
function getLocalName(data: {
  fallback: string;
  name?: JSONValue | undefined;
}): string {
  const fromName: string =
    typeof data.name === "string" && !isPlaceholderText(data.name)
      ? toTerraformIdentifier(data.name)
      : "";
  const name: string = fromName.length > 40 ? "" : fromName;

  return name || toTerraformIdentifier(data.fallback) || "this";
}

function uniqueLocalName(name: string, used: Set<string>): string {
  let unique: string = name;
  let suffix: number = 2;

  while (used.has(unique)) {
    unique = `${name}_${suffix}`;
    suffix++;
  }

  used.add(unique);
  return unique;
}

function variableBlock(variable: TerraformSecretVariable): HclBodyItem {
  return Hcl.block(
    "variable",
    [variable.name],
    [
      Hcl.attribute("description", Hcl.string(variable.description)),
      Hcl.attribute("type", Hcl.raw("string")),
      Hcl.attribute("sensitive", Hcl.bool(true)),
    ],
  );
}

// The name in a comment after an id: "Critical Incident", or nothing.
function commentFor(names: Array<string | null>): string | undefined {
  const known: Array<string> = names.filter(
    (name: string | null): name is string => {
      return Boolean(name);
    },
  );

  return known.length > 0 ? known.join(", ") : undefined;
}

/*
 * A field's value as its Terraform attribute takes it. An id written out
 * carries the name of its record in a comment (`= "6b1d..." # Critical
 * Incident`); a reference to another block (`oneuptime_team.platform.id`)
 * needs none.
 */
function toTerraformAttribute(data: {
  descriptor: TerraformAttributeDescriptor;
  resolved: DeveloperDocsResolvedValue;
  variables: TerraformVariableCollector;
  localName: string;
  label: string;
  describeId: (id: string) => string | undefined;
}): HclBodyItem | null {
  const { descriptor, resolved } = data;
  const name: string = descriptor.attributeName;

  if (resolved.reference) {
    return Hcl.attribute(
      name,
      descriptor.kind === TerraformValueKind.IdSet
        ? Hcl.tuple([Hcl.raw(resolved.reference)])
        : Hcl.raw(resolved.reference),
    );
  }

  const json: JSONValue = resolved.json;

  switch (descriptor.kind) {
    case TerraformValueKind.String:
    case TerraformValueKind.DateTime:
      return Hcl.attribute(
        name,
        Hcl.string(String(json)),
        commentFor(resolved.names),
      );
    case TerraformValueKind.Number:
      return typeof json === "number"
        ? Hcl.attribute(name, Hcl.number(json))
        : Hcl.attribute(name, Hcl.string(String(json)));
    case TerraformValueKind.Bool:
      return Hcl.attribute(name, Hcl.bool(json === true));
    case TerraformValueKind.IdSet:
    case TerraformValueKind.StringSet: {
      const items: Array<string> = (Array.isArray(json) ? json : [json]).map(
        (item: unknown): string => {
          return String(item);
        },
      );

      if (items.length === 1) {
        return Hcl.attribute(
          name,
          Hcl.tuple([Hcl.string(items[0] as string)]),
          commentFor(resolved.names),
        );
      }

      return Hcl.attribute(
        name,
        Hcl.tuple(
          items.map((item: string, index: number) => {
            return {
              value: Hcl.string(item),
              comment: resolved.names[index] || undefined,
            };
          }),
        ),
      );
    }
    case TerraformValueKind.Json:
      return Hcl.attribute(name, Hcl.call("jsonencode", [jsonToHcl(json)]));
    case TerraformValueKind.MonitorSteps: {
      const steps: HclExpression | null = monitorStepsToHcl(json, {
        variables: data.variables,
        variablePrefix: data.localName,
        monitorLabel: data.label,
        describeId: data.describeId,
      });

      return steps ? Hcl.attribute(name, steps) : null;
    }
    default:
      return null;
  }
}

// The names the page knows, for comments after ids inside monitor steps.
function getIdDescriber(
  context: DeveloperDocsExampleContext,
): (id: string) => string | undefined {
  return (id: string): string | undefined => {
    return context.live.namesById[id];
  };
}

export interface DeveloperDocsTerraformBlock {
  // The block, preceded by the variables its secrets are read from.
  items: Array<HclBodyItem>;
  typeName: string;
  localName: string;
  // `oneuptime_incident.checkout` or `data.oneuptime_incident_severity.critical`.
  address: string;
  rows: Array<DeveloperDocsFieldRow>;
  isPlaceholder: boolean;
  // Whether a value in it came from the project's own records.
  usesProjectData: boolean;
}

/*
 * One resource (or data source) block, from fields. Every field must be an
 * attribute of the resource; every required attribute is written, a
 * secret from a sensitive variable.
 */
export function getDeveloperDocsTerraformBlock(data: {
  modelType: DatabaseBaseModelType;
  kind?: "resource" | "data" | undefined;
  localName?: string | undefined;
  fields: Array<DeveloperDocsField>;
  context: DeveloperDocsExampleContext;
  variables: TerraformVariableCollector;
  references?: Dictionary<string> | undefined;
  usedLocalNames?: Set<string> | undefined;
  // Leave out optional fields that point at a record the page has none of.
  dropUnresolvedOptional?: boolean | undefined;
}): DeveloperDocsTerraformBlock {
  const typeName: string | null = getTerraformTypeName(data.modelType);
  const tableName: string = getTableName(data.modelType);

  if (!typeName) {
    throw new DeveloperDocsExampleError(
      `${tableName} has no Terraform resource.`,
    );
  }

  const nameColumn: string | null = getNameColumn(data.modelType);
  const nameField: DeveloperDocsField | undefined = data.fields.find(
    (field: DeveloperDocsField): boolean => {
      return field.column === nameColumn;
    },
  );
  const nameValue: JSONValue | undefined = nameField
    ? resolveDeveloperDocsValue({
        modelType: data.modelType,
        column: nameField.column,
        value: nameField.value,
        context: data.context,
        references: data.references,
      }).json
    : undefined;
  const shortTypeName: string = typeName.replace(/^oneuptime_/, "");
  const localName: string = uniqueLocalName(
    data.localName ||
      getLocalName({ name: nameValue, fallback: shortTypeName }),
    data.usedLocalNames || new Set<string>(),
  );
  const isData: boolean = data.kind === "data";
  const address: string = `${isData ? "data." : ""}${typeName}.${localName}`;
  const label: string = `the ${getNoun(data.modelType)} ${localName}`;

  if (isData) {
    if (!canLookUpByName(data.modelType)) {
      throw new DeveloperDocsExampleError(
        `${tableName} cannot be looked up by name.`,
      );
    }

    const name: JSONValue | undefined = data.fields.find(
      (field: DeveloperDocsField): boolean => {
        return field.column === "name";
      },
    )
      ? resolveDeveloperDocsValue({
          modelType: data.modelType,
          column: "name",
          value: data.fields.find((field: DeveloperDocsField): boolean => {
            return field.column === "name";
          })?.value,
          context: data.context,
        }).json
      : undefined;

    if (typeof name !== "string" || data.fields.length !== 1) {
      throw new DeveloperDocsExampleError(
        `A ${tableName} data source looks a record up by its name, and by nothing else.`,
      );
    }

    return {
      items: [
        Hcl.block(
          "data",
          [typeName, localName],
          [Hcl.attribute("name", Hcl.string(name))],
        ),
      ],
      typeName,
      localName,
      address,
      rows: [],
      isPlaceholder: false,
      usesProjectData: false,
    };
  }

  const attributes: Array<TerraformAttributeDescriptor> =
    getTerraformAttributes(data.modelType);
  const byColumn: Dictionary<TerraformAttributeDescriptor> = {};

  for (const descriptor of attributes) {
    byColumn[descriptor.columnName] = descriptor;
  }

  const fields: Array<DeveloperDocsField> = [...data.fields];

  // Every required attribute is written, even when the profile leaves it out.
  for (const descriptor of attributes) {
    if (
      descriptor.isRequired &&
      !fields.some((field: DeveloperDocsField): boolean => {
        return field.column === descriptor.columnName;
      })
    ) {
      fields.push({ column: descriptor.columnName });
    }
  }

  const body: Array<HclBodyItem> = [];
  const rows: Array<DeveloperDocsFieldRow> = [];
  let isPlaceholder: boolean = false;
  let usesProjectData: boolean = false;
  const describeId: (id: string) => string | undefined = getIdDescriber(
    data.context,
  );

  for (const field of fields) {
    const descriptor: TerraformAttributeDescriptor | undefined =
      byColumn[field.column];

    if (!descriptor || !descriptor.inCreateSchema) {
      throw new DeveloperDocsExampleError(
        `${typeName} has no attribute it can be created with for ${tableName}.${field.column}.`,
      );
    }

    if (descriptor.isReservedName) {
      throw new DeveloperDocsExampleError(
        `${typeName}.${descriptor.attributeName} is named like a Terraform meta-argument and cannot be set in a configuration.`,
      );
    }

    let item: HclBodyItem | null;

    if (descriptor.secretKind) {
      item = Hcl.attribute(
        descriptor.attributeName,
        data.variables.add(
          `${localName}_${descriptor.attributeName}`,
          `The ${descriptor.title} of ${label}.`,
        ),
      );
    } else {
      const resolved: DeveloperDocsResolvedValue = resolveDeveloperDocsValue({
        modelType: data.modelType,
        column: field.column,
        value: field.value,
        context: data.context,
        references: data.references,
        monitorName: typeof nameValue === "string" ? nameValue : undefined,
      });

      if (
        resolved.isPlaceholder &&
        !descriptor.isRequired &&
        data.dropUnresolvedOptional !== false &&
        !resolved.reference &&
        field.value?.kind !== "literal" &&
        field.value?.kind !== "monitorSteps"
      ) {
        continue;
      }

      isPlaceholder = isPlaceholder || resolved.isPlaceholder;
      usesProjectData = usesProjectData || Boolean(resolved.fromProject);
      item = toTerraformAttribute({
        descriptor,
        resolved,
        variables: data.variables,
        localName,
        label,
        describeId,
      });
    }

    if (!item) {
      continue;
    }

    body.push(item);
    rows.push({
      name: descriptor.attributeName,
      about: getDeveloperDocsFieldAbout({ modelType: data.modelType, field }),
      required: descriptor.isRequired,
    });
  }

  return {
    items: [Hcl.block("resource", [typeName, localName], body)],
    typeName,
    localName,
    address,
    rows,
    isPlaceholder,
    usesProjectData,
  };
}

export interface DeveloperDocsTerraformExample {
  hcl: string;
  address: string;
  rows: Array<DeveloperDocsFieldRow>;
  variables: Array<TerraformSecretVariable>;
  isPlaceholder: boolean;
  // Whether a value in it came from the project's own records.
  usesProjectData: boolean;
}

function printWithVariables(
  variables: TerraformVariableCollector,
  blocks: Array<Array<HclBodyItem>>,
): string {
  const items: Array<HclBodyItem> = [];

  for (const variable of variables.variables) {
    items.push(variableBlock(variable), Hcl.blank());
  }

  blocks.forEach((block: Array<HclBodyItem>, index: number) => {
    if (index > 0) {
      items.push(Hcl.blank());
    }

    items.push(...block);
  });

  return printHclDocument(items);
}

/*
 * A new resource of this type as Terraform: the fields most people set,
 * filled in from the project. Null when the provider cannot create it.
 */
export function getTerraformCreateExample(data: {
  modelType: DatabaseBaseModelType;
  context: DeveloperDocsExampleContext;
}): DeveloperDocsTerraformExample | null {
  const profile: DeveloperDocsProfile = getDeveloperDocsProfile(data.modelType);

  if (
    !getTerraformTypeName(data.modelType) ||
    getTerraformAttributes(data.modelType).length === 0 ||
    profile.terraformCannotCreate
  ) {
    return null;
  }

  const variables: TerraformVariableCollector =
    new TerraformVariableCollector();
  const block: DeveloperDocsTerraformBlock = getDeveloperDocsTerraformBlock({
    modelType: data.modelType,
    fields: withNameAndDescription(data.modelType, profile),
    context: data.context,
    variables,
  });

  return {
    hcl: printWithVariables(variables, [block.items]),
    address: block.address,
    rows: block.rows,
    variables: variables.variables,
    isPlaceholder: block.isPlaceholder,
    usesProjectData: block.usesProjectData,
  };
}

/*
 * A profile's fields, with the name and description first when the profile
 * leaves them out (every resource is better for both).
 */
export function withNameAndDescription(
  modelType: DatabaseBaseModelType,
  profile: DeveloperDocsProfile,
): Array<DeveloperDocsField> {
  const fields: Array<DeveloperDocsField> =
    getDeveloperDocsProfileFields(profile);
  const createColumns: Set<string> = new Set<string>(
    getTerraformAttributes(modelType)
      .filter((descriptor: TerraformAttributeDescriptor): boolean => {
        return descriptor.inCreateSchema;
      })
      .map((descriptor: TerraformAttributeDescriptor): string => {
        return descriptor.columnName;
      }),
  );
  const leading: Array<DeveloperDocsField> = [];
  const nameColumn: string | null = getNameColumn(modelType);

  for (const column of [nameColumn, "description"]) {
    if (
      column &&
      createColumns.has(column) &&
      !fields.some((field: DeveloperDocsField): boolean => {
        return field.column === column;
      })
    ) {
      leading.push({
        column,
        value:
          column === "description"
            ? { kind: "literal", value: "Managed with Terraform." }
            : {
                kind: "literal",
                value: `My ${toSentenceCaseName(new modelType().singularName || "")}`,
              },
      });
    }
  }

  return [...leading, ...fields];
}

export interface DeveloperDocsTerraformRecipe {
  title: string;
  description: string;
  hcl: string;
  variables: Array<TerraformSecretVariable>;
  isPlaceholder: boolean;
}

export function inScope(
  scopes: Array<DeveloperDocsScopeName>,
  scope: DeveloperDocsScopeName,
): boolean {
  return scopes.includes(scope);
}

// One recipe as Terraform.
export function getTerraformRecipe(data: {
  recipe: DeveloperDocsRecipe;
  context: DeveloperDocsExampleContext;
}): DeveloperDocsTerraformRecipe {
  const variables: TerraformVariableCollector =
    new TerraformVariableCollector();
  const references: Dictionary<string> = {};
  const usedLocalNames: Set<string> = new Set<string>();
  const blocks: Array<Array<HclBodyItem>> = [];
  let isPlaceholder: boolean = false;

  // The page's own resource keeps its name; recipes add others beside it.
  if (data.context.record?.terraformAddress) {
    usedLocalNames.add(
      data.context.record.terraformAddress.split(".").pop() || "",
    );
  }

  for (const blockSpec of data.recipe.blocks) {
    const block: DeveloperDocsTerraformBlock = getDeveloperDocsTerraformBlock({
      modelType: blockSpec.modelType,
      kind: blockSpec.kind,
      localName: blockSpec.localName,
      fields: blockSpec.fields,
      context: data.context,
      variables,
      references,
      usedLocalNames,
      // A recipe is about the records it points at: keep them, as placeholders if need be.
      dropUnresolvedOptional: false,
    });

    references[blockSpec.id] = `${block.address}.id`;
    blocks.push(block.items);
    isPlaceholder = isPlaceholder || block.isPlaceholder;
  }

  return {
    title: data.recipe.title,
    description: data.recipe.description,
    hcl: printWithVariables(variables, blocks),
    variables: variables.variables,
    isPlaceholder,
  };
}

// The recipes for a type's list page, or for one record's page.
export function getTerraformRecipes(data: {
  modelType: DatabaseBaseModelType;
  scope: DeveloperDocsScopeName;
  context: DeveloperDocsExampleContext;
}): Array<DeveloperDocsTerraformRecipe> {
  return (getDeveloperDocsProfile(data.modelType).recipes || [])
    .filter((recipe: DeveloperDocsRecipe): boolean => {
      return inScope(recipe.scopes, data.scope);
    })
    .map((recipe: DeveloperDocsRecipe): DeveloperDocsTerraformRecipe => {
      return getTerraformRecipe({ recipe, context: data.context });
    });
}

/*
 * API requests.
 */

/*
 * A value as a request body carries it. Records in a list relation
 * (`labels`, `monitors`) go as `{"_id": ...}` objects, the shape the API
 * documents and the Terraform provider sends.
 */
export function toApiValue(
  modelType: DatabaseBaseModelType,
  column: string,
  value: JSONValue,
): JSONValue {
  if (
    getColumns(modelType)[column]?.type === TableColumnType.EntityArray &&
    Array.isArray(value)
  ) {
    return (value as Array<JSONValue>).map((item: JSONValue): JSONValue => {
      return typeof item === "string" ? { _id: item } : item;
    }) as JSONValue;
  }

  return value;
}

export interface DeveloperDocsApiBody {
  body: JSONObject;
  rows: Array<DeveloperDocsFieldRow>;
  isPlaceholder: boolean;
  // Whether a value in it came from the project's own records.
  usesProjectData: boolean;
}

/*
 * The `data` of a create request: the fields given (and every required
 * one), as the API takes them.
 */
export function getApiCreateData(data: {
  modelType: DatabaseBaseModelType;
  fields: Array<DeveloperDocsField>;
  context: DeveloperDocsExampleContext;
  // Leave out optional fields that point at a record the page has none of.
  dropUnresolvedOptional?: boolean | undefined;
}): DeveloperDocsApiBody {
  const attributes: Array<TerraformAttributeDescriptor> =
    getTerraformAttributes(data.modelType);
  const fields: Array<DeveloperDocsField> = [...data.fields];

  for (const descriptor of attributes) {
    if (
      descriptor.isRequired &&
      !fields.some((field: DeveloperDocsField): boolean => {
        return field.column === descriptor.columnName;
      })
    ) {
      fields.push({ column: descriptor.columnName });
    }
  }

  const nameColumn: string | null = getNameColumn(data.modelType);
  const nameField: DeveloperDocsField | undefined = fields.find(
    (field: DeveloperDocsField): boolean => {
      return field.column === nameColumn;
    },
  );
  const monitorName: JSONValue | undefined = nameField
    ? resolveDeveloperDocsValue({
        modelType: data.modelType,
        column: nameField.column,
        value: nameField.value,
        context: data.context,
      }).json
    : undefined;

  const body: JSONObject = {};
  const rows: Array<DeveloperDocsFieldRow> = [];
  let isPlaceholder: boolean = false;
  let usesProjectData: boolean = false;

  for (const field of fields) {
    const descriptor: TerraformAttributeDescriptor | undefined =
      attributes.find((item: TerraformAttributeDescriptor): boolean => {
        return item.columnName === field.column;
      });
    const required: boolean = Boolean(descriptor?.isRequired);
    let value: JSONValue;

    if (descriptor?.secretKind) {
      value = getPlaceholder(descriptor.title.toLowerCase());
      isPlaceholder = true;
    } else {
      const resolved: DeveloperDocsResolvedValue = resolveDeveloperDocsValue({
        modelType: data.modelType,
        column: field.column,
        value: field.value,
        context: data.context,
        monitorName: typeof monitorName === "string" ? monitorName : undefined,
      });

      if (resolved.reference && !data.context.record) {
        throw new DeveloperDocsExampleError(
          `${getTableName(data.modelType)}.${field.column} refers to another block, which an API request cannot.`,
        );
      }

      if (
        resolved.isPlaceholder &&
        !required &&
        data.dropUnresolvedOptional !== false &&
        field.value?.kind !== "literal" &&
        field.value?.kind !== "monitorSteps"
      ) {
        continue;
      }

      isPlaceholder = isPlaceholder || resolved.isPlaceholder;
      usesProjectData = usesProjectData || Boolean(resolved.fromProject);
      value = toApiValue(data.modelType, field.column, resolved.json);
    }

    body[field.column] = value;
    rows.push({
      name: field.column,
      about: getDeveloperDocsFieldAbout({ modelType: data.modelType, field }),
      required,
    });
  }

  return { body, rows, isPlaceholder, usesProjectData };
}

// A new resource of this type, as the `data` of a create request.
export function getApiCreateExample(data: {
  modelType: DatabaseBaseModelType;
  context: DeveloperDocsExampleContext;
}): DeveloperDocsApiBody {
  return getApiCreateData({
    modelType: data.modelType,
    fields: withNameAndDescription(
      data.modelType,
      getDeveloperDocsProfile(data.modelType),
    ),
    context: data.context,
  });
}

/*
 * The `data` of the "Change it" example: the profile's change, or a new
 * description. A field pointing at a record moves to another one than the
 * record has now.
 */
export function getApiUpdateExample(data: {
  modelType: DatabaseBaseModelType;
  context: DeveloperDocsExampleContext;
}): { data: JSONObject; description: string } | null {
  const profile: DeveloperDocsProfile = getDeveloperDocsProfile(data.modelType);
  const updatable: Set<string> = new Set<string>(
    getTerraformAttributes(data.modelType)
      .filter((descriptor: TerraformAttributeDescriptor): boolean => {
        return descriptor.inUpdateSchema && !descriptor.secretKind;
      })
      .map((descriptor: TerraformAttributeDescriptor): string => {
        return descriptor.columnName;
      }),
  );

  if (profile.update) {
    const body: JSONObject = {};
    const names: Array<string> = [];
    let noun: string | undefined = undefined;

    for (const field of profile.update.fields) {
      if (!updatable.has(field.column)) {
        throw new DeveloperDocsExampleError(
          `${getTableName(data.modelType)}.${field.column} cannot be changed over the API.`,
        );
      }

      const current: unknown = data.context.record?.json?.[field.column];
      const currentId: string | undefined =
        typeof current === "string"
          ? current
          : current && typeof current === "object"
            ? ((current as JSONObject)["value"] as string | undefined)
            : undefined;
      let value: DeveloperDocsValue | undefined = field.value;

      if (value?.kind === "live" && currentId) {
        value = { ...value, pick: { ...value.pick, notId: currentId } };
      }

      const resolved: DeveloperDocsResolvedValue = resolveDeveloperDocsValue({
        modelType: data.modelType,
        column: field.column,
        value,
        context: data.context,
      });

      body[field.column] = toApiValue(
        data.modelType,
        field.column,
        resolved.json,
      );
      names.push(
        ...resolved.names.filter((name: string | null): name is string => {
          return Boolean(name);
        }),
      );
      noun = noun || resolved.noun;
    }

    return {
      data: body,
      description: fillName(
        profile.update.description,
        names,
        noun || getNoun(data.modelType),
      ),
    };
  }

  if (updatable.has("description")) {
    return {
      data: { description: "Updated with the OneUptime API." },
      description:
        "Send only the fields you want to change. Everything else stays as it is.",
    };
  }

  const nameColumn: string | null = getNameColumn(data.modelType);

  if (nameColumn && updatable.has(nameColumn)) {
    return {
      data: {
        [nameColumn]: data.context.record?.displayName
          ? `${data.context.record.displayName} (renamed)`
          : "New name",
      },
      description:
        "Send only the fields you want to change. Everything else stays as it is.",
    };
  }

  return null;
}

// The fields a read asks for: the profile's, or its plain fields and the name.
export function getApiReadSelect(modelType: DatabaseBaseModelType): JSONObject {
  const profile: DeveloperDocsProfile = getDeveloperDocsProfile(modelType);
  const columns: Dictionary<TableColumnMetadata> = getColumns(modelType);
  const secretColumns: Set<string> = new Set<string>(
    getTerraformAttributes(modelType)
      .filter((descriptor: TerraformAttributeDescriptor): boolean => {
        return Boolean(descriptor.secretKind);
      })
      .map((descriptor: TerraformAttributeDescriptor): string => {
        return descriptor.columnName;
      }),
  );
  const select: JSONObject = { _id: true };
  const nameColumn: string | null = getNameColumn(modelType);

  if (nameColumn) {
    select[nameColumn] = true;
  }

  const plainTypes: Array<TableColumnType> = [
    TableColumnType.ShortText,
    TableColumnType.LongText,
    TableColumnType.Name,
    TableColumnType.Description,
    TableColumnType.Markdown,
    TableColumnType.Boolean,
    TableColumnType.Number,
    TableColumnType.SmallNumber,
    TableColumnType.PositiveNumber,
    TableColumnType.SmallPositiveNumber,
    TableColumnType.BigNumber,
    TableColumnType.BigPositiveNumber,
    TableColumnType.Date,
    TableColumnType.ObjectID,
    TableColumnType.MonitorType,
    TableColumnType.Color,
    TableColumnType.Email,
    TableColumnType.Phone,
    TableColumnType.Domain,
    TableColumnType.ShortURL,
    TableColumnType.LongURL,
  ];
  const readColumns: Array<string> =
    profile.readFields ||
    getDeveloperDocsProfileFields(profile)
      .map((field: DeveloperDocsField): string => {
        return field.column;
      })
      .filter((column: string): boolean => {
        const type: TableColumnType | undefined = columns[column]?.type;
        return Boolean(type && plainTypes.includes(type));
      })
      .concat(columns["createdAt"] ? ["createdAt"] : []);

  for (const column of readColumns) {
    if (!columns[column]) {
      throw new DeveloperDocsExampleError(
        `${getTableName(modelType)} has no column ${column} to read.`,
      );
    }

    if (!secretColumns.has(column)) {
      select[column] = true;
    }
  }

  return select;
}

/*
 * A query value, as the API's query schema documents it: a value matches
 * itself, an operator is `{"_type": ..., "value": ...}`, and a list
 * relation (`labels`, `monitors`) matches any of a plain list of ids.
 */
function toQueryValue(data: {
  modelType: DatabaseBaseModelType;
  column: string;
  operator: DeveloperDocsQueryPart["operator"];
  value: JSONValue;
}): JSONValue {
  const { operator, value } = data;

  if (
    operator === "includes" &&
    getColumns(data.modelType)[data.column]?.type ===
      TableColumnType.EntityArray
  ) {
    return (Array.isArray(value) ? value : [value]) as JSONValue;
  }

  switch (operator) {
    case "equals":
      return value;
    case "notEqual":
      return new NotEqual(value as string).toJSON() as JSONValue;
    case "search":
      return new Search(String(value)).toJSON() as JSONValue;
    case "greaterThan":
      return new GreaterThan(value as string).toJSON() as JSONValue;
    case "includes":
      return new Includes(
        (Array.isArray(value) ? value : [value]) as Array<string>,
      ).toJSON() as JSONValue;
  }
}

export interface DeveloperDocsApiQuery {
  query: JSONObject;
  // The names of the records the query uses, for its description.
  names: Array<string>;
  // What the first record it uses is, in words, for when it has no name.
  noun?: string | undefined;
  isPlaceholder: boolean;
}

// A query, as the API takes it: `{"title": {"_type": "Search", "value": "..."}}`.
export function getApiQuery(data: {
  modelType: DatabaseBaseModelType;
  parts: Array<DeveloperDocsQueryPart>;
  context: DeveloperDocsExampleContext;
}): DeveloperDocsApiQuery {
  const query: JSONObject = {};
  const names: Array<string> = [];
  let noun: string | undefined = undefined;
  let isPlaceholder: boolean = false;

  for (const part of data.parts) {
    getColumn(data.modelType, part.column);

    const resolved: DeveloperDocsResolvedValue = resolveDeveloperDocsValue({
      modelType: data.modelType,
      column: part.column,
      value: part.value,
      context: data.context,
    });

    query[part.column] = toQueryValue({
      modelType: data.modelType,
      column: part.column,
      operator: part.operator,
      value: resolved.json,
    });
    names.push(
      ...resolved.names.filter((name: string | null): name is string => {
        return Boolean(name);
      }),
    );
    noun = noun || resolved.noun;
    isPlaceholder = isPlaceholder || resolved.isPlaceholder;
  }

  return { query, names, noun, isPlaceholder };
}

function toSortJson(sort: DeveloperDocsSort | undefined): JSONObject {
  return sort ? { [sort.column]: sort.order } : { createdAt: "DESC" };
}

export interface DeveloperDocsApiFilter {
  title: string;
  description: string;
  body: JSONObject;
  isPlaceholder: boolean;
}

/*
 * The profile's list filters, as list request bodies. A filter that needs a
 * record the project does not have (no labels yet) is left out.
 */
export function getApiFilters(data: {
  modelType: DatabaseBaseModelType;
  context: DeveloperDocsExampleContext;
}): Array<DeveloperDocsApiFilter> {
  const select: JSONObject = getApiReadSelect(data.modelType);

  return (getDeveloperDocsProfile(data.modelType).filters || [])
    .map((filter: DeveloperDocsFilter): DeveloperDocsApiFilter | null => {
      const query: DeveloperDocsApiQuery = getApiQuery({
        modelType: data.modelType,
        parts: filter.query,
        context: data.context,
      });

      if (query.isPlaceholder) {
        return null;
      }

      return {
        title: filter.title,
        description: fillName(
          filter.description,
          query.names,
          query.noun || getNoun(data.modelType),
        ),
        body: { query: query.query, select, sort: toSortJson(filter.sort) },
        isPlaceholder: false,
      };
    })
    .filter(
      (
        filter: DeveloperDocsApiFilter | null,
      ): filter is DeveloperDocsApiFilter => {
        return filter !== null;
      },
    );
}

// `{name}` in a sentence: the record's name in quotes, or "this one".
function fillName(
  text: string,
  names: Array<string>,
  fallbackNoun: string,
): string {
  const name: string | undefined = names[0];

  return text.replace(
    /\{name\}/g,
    name ? `“${name}”` : `the ${fallbackNoun} you choose`,
  );
}

export interface DeveloperDocsApiTask {
  title: string;
  description: string;
  modelType: DatabaseBaseModelType;
  operation: "create" | "list";
  body: JSONObject;
  isPlaceholder: boolean;
}

// The profile's tasks for a scope, as request bodies.
export function getApiTasks(data: {
  modelType: DatabaseBaseModelType;
  scope: DeveloperDocsScopeName;
  context: DeveloperDocsExampleContext;
}): Array<DeveloperDocsApiTask> {
  return (getDeveloperDocsProfile(data.modelType).tasks || [])
    .filter((task: DeveloperDocsTask): boolean => {
      return inScope(task.scopes, data.scope);
    })
    .map((task: DeveloperDocsTask): DeveloperDocsApiTask => {
      if (task.operation === "create") {
        const created: DeveloperDocsApiBody = getApiCreateData({
          modelType: task.modelType,
          fields: task.fields || [],
          context: data.context,
          dropUnresolvedOptional: false,
        });
        const liveValues: Array<DeveloperDocsResolvedValue> = (
          task.fields || []
        )
          .filter((field: DeveloperDocsField): boolean => {
            return field.value?.kind === "live";
          })
          .map((field: DeveloperDocsField): DeveloperDocsResolvedValue => {
            return resolveDeveloperDocsValue({
              modelType: task.modelType,
              column: field.column,
              value: field.value,
              context: data.context,
            });
          });
        const names: Array<string> = liveValues.flatMap(
          (value: DeveloperDocsResolvedValue): Array<string> => {
            return value.names.filter((name: string | null): name is string => {
              return Boolean(name);
            });
          },
        );

        return {
          title: task.title,
          description: fillName(
            task.description,
            names,
            liveValues[0]?.noun || getNoun(task.modelType),
          ),
          modelType: task.modelType,
          operation: "create",
          body: { data: created.body },
          isPlaceholder: created.isPlaceholder,
        };
      }

      const query: DeveloperDocsApiQuery = getApiQuery({
        modelType: task.modelType,
        parts: task.query || [],
        context: data.context,
      });
      const select: JSONObject = { _id: true };

      for (const column of task.select || []) {
        getColumn(task.modelType, column);
        select[column] = true;
      }

      return {
        title: task.title,
        description: fillName(
          task.description,
          query.names,
          query.noun || getNoun(task.modelType),
        ),
        modelType: task.modelType,
        operation: "list",
        body: { query: query.query, select, sort: toSortJson(task.sort) },
        isPlaceholder: query.isPlaceholder,
      };
    });
}

// "an incident", "a scheduled maintenance event": for step titles.
export function getCreateTitle(data: {
  modelType: DatabaseBaseModelType;
  singularName: string;
}): string {
  const profile: DeveloperDocsProfile = getDeveloperDocsProfile(data.modelType);

  return (
    profile.createTitle ||
    `Create ${withIndefiniteArticle(toSentenceCaseName(data.singularName))}`
  );
}
