import AnalyticsBaseModel, {
  AnalyticsBaseModelType,
} from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AlertEpisodeInternalNote from "../../Models/DatabaseModels/AlertEpisodeInternalNote";
import AlertEpisodeStateTimeline from "../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertInternalNote from "../../Models/DatabaseModels/AlertInternalNote";
import AlertState from "../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../Models/DatabaseModels/AlertStateTimeline";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisodeInternalNote from "../../Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentEpisodePublicNote from "../../Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentEpisodeStateTimeline from "../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentInternalNote from "../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../Models/DatabaseModels/IncidentPublicNote";
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../Models/DatabaseModels/IncidentStateTimeline";
import ScheduledMaintenanceInternalNote from "../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenancePublicNote from "../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceState from "../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import { ALWAYS_SELECTABLE_COLUMNS } from "../../Types/HeldPermissions";
import { JSONArray, JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { StateListType } from "../StateOrder";
import { getClientResourceName } from "./ClientResourceNames";
import { getApiSingularName } from "../ModelApiName";
import {
  describePersonEmail,
  getPersonEmailColumnName,
  PersonColumnKind,
} from "./PeopleByEmail";
import {
  getTerraformAttributes,
  getTerraformModelOperations,
  isApiExcludedForPermissions,
  TerraformAttributeDescriptor,
  TerraformModelOperations,
  TerraformValueKind,
  toTerraformSnakeCase,
  toTerraformTypeSnakeCase,
} from "./TerraformSchema";

/*
 * THE ONEUPTIME CLI'S COMMANDS, WORKED OUT FROM THE MODELS
 *
 * The CLI (packages/CLI, `oneuptime`) has a command for every resource of
 * the OneUptime REST API, and a subcommand for every request the API
 * takes for it - the very rule the API documents itself by
 * (Common/Server/Utils/OpenAPI.ts) and the Terraform provider is generated
 * from (TerraformSchema.ts repeats it one model at a time):
 *
 *   - a record (a database model) has a command when it is documented and
 *     has an API path; telemetry (an analytics model) when it has an API
 *     path;
 *   - it has list, get and count when someone other than a signed-in user
 *     alone may read it, create when someone may create it, and so on for
 *     update and delete (isApiExcludedForPermissions);
 *   - the command is the provider's type name in kebab case: Terraform's
 *     oneuptime_on_call_policy is `oneuptime on-call-policy`, its
 *     oneuptime_iot_fleet `oneuptime iot-fleet`;
 *   - create and update take a flag for each field the API's create or
 *     update schema has, named for the field in kebab case
 *     (`incidentSeverityId` is `--incident-severity-id`), and a person is
 *     named by email address as well as by ID (`--user-email` beside
 *     `--user-id`), with the provider's words (PeopleByEmail.ts).
 *
 * So a new model gets its commands, its flags and its page in the
 * dashboard without a line of the CLI changing. The CLI reads this file to
 * build its program; the dashboard's Developer > CLI pages read it to write
 * commands the CLI really takes; the docs' command reference reads it for
 * the list of resource commands. packages/CLI/Tests/ApiParity builds the
 * real OpenAPI spec and fails when the API has a request the CLI has no
 * command for.
 *
 * Pure: no request is made here, so the dashboard and the docs use it too.
 */

// The command the CLI installs, and the package it is published as.
export const ONEUPTIME_CLI_COMMAND: string = "oneuptime";
export const ONEUPTIME_CLI_PACKAGE: string = "@oneuptime/cli";

// The environment variable the CLI reads OneUptime's address from.
export const ONEUPTIME_URL_ENVIRONMENT_VARIABLE: string = "ONEUPTIME_URL";

// The oldest Node.js the CLI runs on (its package.json's engines).
export const CLI_MINIMUM_NODE_MAJOR_VERSION: number = 22;

// A record (database) or telemetry (analytics): the words `resources` prints.
export type CliResourceType = "database" | "analytics";

export enum CliOperation {
  List = "list",
  Get = "get",
  Create = "create",
  Update = "update",
  Delete = "delete",
  Count = "count",
}

// The order the CLI adds a resource's operations in, as it always has.
export const CLI_OPERATIONS: ReadonlyArray<CliOperation> = [
  CliOperation.List,
  CliOperation.Get,
  CliOperation.Create,
  CliOperation.Update,
  CliOperation.Delete,
  CliOperation.Count,
];

/*
 * The subcommand every resource has that asks OneUptime nothing: the
 * fields a resource has, what each is, and the flag that sets it.
 */
export const CLI_FIELDS_SUBCOMMAND: string = "fields";

/*
 * What the dashboard's buttons do on a record, as commands of their own:
 * Acknowledge and Resolve on incidents, alerts and their episodes, Mark
 * Ongoing and End on scheduled maintenance, and a note on any of them.
 */
export enum CliAction {
  Acknowledge = "acknowledge",
  Resolve = "resolve",
  Start = "start",
  End = "end",
  AddNote = "add-note",
}

// The order a resource's actions come in, after its operations and fields.
export const CLI_ACTIONS: ReadonlyArray<CliAction> = [
  CliAction.Acknowledge,
  CliAction.Resolve,
  CliAction.Start,
  CliAction.End,
  CliAction.AddNote,
];

/*
 * NAMES
 */

const UNDERSCORES: RegExp = /_/g;

/*
 * A resource's command: the Terraform provider's type name in kebab case.
 * "On-Call Policy" -> on-call-policy, "IoT Fleet" -> iot-fleet,
 * "VMware vCenter" -> vcenter (the provider's oneuptime_vcenter).
 */
export function toCliCommandName(singularName: string): string {
  return toTerraformTypeSnakeCase(singularName).replace(UNDERSCORES, "-");
}

/*
 * A model's command: `incident`, `on-call-policy`. It is the name every
 * client OneUptime publishes gives the model (ClientResourceNames): its
 * singular name, or for the few worded for a screen rather than a
 * resource, a name of their own - `escalation-rule-team`, as the Terraform
 * provider's oneuptime_escalation_rule_team. No two models share one, so
 * no two resources share a command (packages/CLI/Tests/ApiParity).
 */
export function getCliResourceName(model: {
  tableName: string | null | undefined;
  singularName: string | null | undefined;
  // A model renamed on screen keeps its command by the name the API keeps.
  apiSingularName?: string | null | undefined;
}): string {
  const tableName: string = model.tableName || "";

  return toCliCommandName(
    getClientResourceName(tableName, getApiSingularName(model) || tableName),
  );
}

// A field's flag: incidentSeverityId -> --incident-severity-id.
export function toCliFlag(columnName: string): string {
  return `--${toTerraformSnakeCase(columnName).replace(UNDERSCORES, "-")}`;
}

/*
 * The column a flag sets, as Commander names its value: --incident-
 * severity-id is `incidentSeverityId` in a command's options.
 */
export function toCommanderAttributeName(flag: string): string {
  return flag
    .replace(LEADING_DASHES, "")
    .split("-")
    .map((part: string, index: number): string => {
      return index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("");
}

const LEADING_DASHES: RegExp = /^-+/;

/*
 * Flags the CLI uses for itself, which no field may take: the global ones
 * (`--url` is OneUptime's address, `--api-key` the key), and those create
 * and update read their data from. A field of one of these names is set in
 * --data instead: a data source's url, an LLM provider's apiKey, a file's
 * file. `--color` is a field's (labels, states, severities have a color):
 * the program's own is `--no-color`, a flag of another name.
 */
export const CLI_RESERVED_FLAGS: ReadonlyArray<string> = [
  "--api-key",
  "--url",
  "--context",
  "--output",
  "--json",
  "--no-color",
  "--version",
  "--help",
  "--data",
  "--file",
];

/*
 * Columns the server fills in, which no flag sets: the project comes from
 * the API key, and who created or deleted a record from the request.
 */
const SERVER_SET_COLUMNS: ReadonlyArray<string> = [
  "projectId",
  "createdByUserId",
  "deletedByUserId",
];

// Whether the server fills a column in, whatever a create or an update sends.
export function isCliServerSetColumn(columnName: string): boolean {
  return SERVER_SET_COLUMNS.includes(columnName);
}

/*
 * OPERATIONS
 */

function operationsFrom(
  operations: TerraformModelOperations,
): Array<CliOperation> {
  return CLI_OPERATIONS.filter((operation: CliOperation): boolean => {
    switch (operation) {
      case CliOperation.List:
      case CliOperation.Get:
      case CliOperation.Count:
        return operations.canRead;
      case CliOperation.Create:
        return operations.canCreate;
      case CliOperation.Update:
        return operations.canUpdate;
      case CliOperation.Delete:
        return operations.canDelete;
      default:
        return false;
    }
  });
}

/*
 * A record's operations: the requests the API documents for it. None when
 * it is not in the API, and none for a record only its own user may read
 * (a user's sessions, their two-factor keys): an API key reaches none of
 * those, so the CLI makes no command a key could never run.
 */
export function getCliDatabaseOperations(
  modelType: DatabaseBaseModelType,
): Array<CliOperation> {
  return getCliDatabaseOperationsOf(new modelType());
}

/*
 * The same, from a model already made: the CLI works this out for every
 * model each time it starts, and making each one once saves a tenth of
 * that start. isModelInPublicApi and getTerraformModelOperations, read off
 * the one instance.
 */
export function getCliDatabaseOperationsOf(
  model: DatabaseBaseModel,
): Array<CliOperation> {
  if (!(model.tableName && model.enableDocumentation && model.crudApiPath)) {
    return [];
  }

  return operationsFrom({
    canCreate: !isApiExcludedForPermissions(model.createRecordPermissions),
    canRead: !isApiExcludedForPermissions(model.readRecordPermissions),
    canUpdate: !isApiExcludedForPermissions(model.updateRecordPermissions),
    canDelete: !isApiExcludedForPermissions(model.deleteRecordPermissions),
  });
}

// Whether telemetry is in the API at all (OpenAPIUtil.buildOpenAPISpec).
export function isAnalyticsModelInPublicApi(
  modelType: AnalyticsBaseModelType,
): boolean {
  const model: AnalyticsBaseModel = new modelType();

  return Boolean(model.tableName && model.crudApiPath);
}

// Telemetry's operations, by the same rule as a record's.
export function getCliAnalyticsOperations(
  modelType: AnalyticsBaseModelType,
): Array<CliOperation> {
  return getCliAnalyticsOperationsOf(new modelType());
}

// The same, from a model already made.
export function getCliAnalyticsOperationsOf(
  model: AnalyticsBaseModel,
): Array<CliOperation> {
  if (!(model.tableName && model.crudApiPath)) {
    return [];
  }

  return operationsFrom({
    canCreate: !isApiExcludedForPermissions(model.getCreatePermissions()),
    canRead: !isApiExcludedForPermissions(model.getReadPermissions()),
    canUpdate: !isApiExcludedForPermissions(model.getUpdatePermissions()),
    canDelete: !isApiExcludedForPermissions(model.getDeletePermissions()),
  });
}

/*
 * ACTIONS
 */

// One state a record can be moved to by a command of its own.
export interface CliStateChange {
  action: CliAction;
  // The flag of the project's state it moves the record to.
  stateFlag: string;
  // The dashboard button it does what, for its help.
  description: string;
}

/*
 * How a record moves between its project's states: a row of its state
 * timeline names the record and the state, and creating one moves the
 * record - what the dashboard's buttons do (and the MCP server's
 * acknowledge_incident and resolve_incident tools).
 */
export interface CliStateMachine {
  tableName: string;
  stateModelType: DatabaseBaseModelType;
  timelineModelType: DatabaseBaseModelType;
  // The timeline's column of the record, and of the state.
  recordColumn: string;
  stateColumn: string;
  // The record's relation to the state it is in now.
  currentStateRelation: string;
  /*
   * The list its states are ordered in, for the one rule of what counts as
   * acknowledged (Common/Utils/AcknowledgedState).
   */
  stateList: StateListType;
  changes: Array<CliStateChange>;
}

const ACKNOWLEDGE: CliStateChange = {
  action: CliAction.Acknowledge,
  stateFlag: "isAcknowledgedState",
  description:
    "moves it to the project's acknowledged state, as the Acknowledge button does",
};

const RESOLVE: CliStateChange = {
  action: CliAction.Resolve,
  stateFlag: "isResolvedState",
  description:
    "moves it to the project's resolved state, as the Resolve button does",
};

export const CLI_STATE_MACHINES: ReadonlyArray<CliStateMachine> = [
  {
    tableName: "Incident",
    stateModelType: IncidentState,
    timelineModelType: IncidentStateTimeline,
    recordColumn: "incidentId",
    stateColumn: "incidentStateId",
    currentStateRelation: "currentIncidentState",
    stateList: StateListType.IncidentState,
    changes: [ACKNOWLEDGE, RESOLVE],
  },
  {
    tableName: "Alert",
    stateModelType: AlertState,
    timelineModelType: AlertStateTimeline,
    recordColumn: "alertId",
    stateColumn: "alertStateId",
    currentStateRelation: "currentAlertState",
    stateList: StateListType.AlertState,
    changes: [ACKNOWLEDGE, RESOLVE],
  },
  {
    tableName: "IncidentEpisode",
    stateModelType: IncidentState,
    timelineModelType: IncidentEpisodeStateTimeline,
    recordColumn: "incidentEpisodeId",
    stateColumn: "incidentStateId",
    currentStateRelation: "currentIncidentState",
    stateList: StateListType.IncidentState,
    changes: [ACKNOWLEDGE, RESOLVE],
  },
  {
    tableName: "AlertEpisode",
    stateModelType: AlertState,
    timelineModelType: AlertEpisodeStateTimeline,
    recordColumn: "alertEpisodeId",
    stateColumn: "alertStateId",
    currentStateRelation: "currentAlertState",
    stateList: StateListType.AlertState,
    changes: [ACKNOWLEDGE, RESOLVE],
  },
  {
    tableName: "ScheduledMaintenance",
    stateModelType: ScheduledMaintenanceState,
    timelineModelType: ScheduledMaintenanceStateTimeline,
    recordColumn: "scheduledMaintenanceId",
    stateColumn: "scheduledMaintenanceStateId",
    currentStateRelation: "currentScheduledMaintenanceState",
    stateList: StateListType.ScheduledMaintenanceState,
    changes: [
      {
        action: CliAction.Start,
        stateFlag: "isOngoingState",
        description:
          "moves it to the project's ongoing state, as the Mark Ongoing button does",
      },
      {
        action: CliAction.End,
        stateFlag: "isEndedState",
        description:
          "moves it to the project's ended state, as the End button does",
      },
    ],
  },
];

// Where a record's notes go: its internal notes, and the public ones.
export interface CliNoteTarget {
  tableName: string;
  internalNoteModelType: DatabaseBaseModelType;
  // The status page notes, for records that have them.
  publicNoteModelType?: DatabaseBaseModelType | undefined;
  // The note's column of the record.
  recordColumn: string;
}

// The note's text, in every note model.
export const CLI_NOTE_COLUMN: string = "note";

export const CLI_NOTE_TARGETS: ReadonlyArray<CliNoteTarget> = [
  {
    tableName: "Incident",
    internalNoteModelType: IncidentInternalNote,
    publicNoteModelType: IncidentPublicNote,
    recordColumn: "incidentId",
  },
  {
    tableName: "Alert",
    internalNoteModelType: AlertInternalNote,
    recordColumn: "alertId",
  },
  {
    tableName: "IncidentEpisode",
    internalNoteModelType: IncidentEpisodeInternalNote,
    publicNoteModelType: IncidentEpisodePublicNote,
    recordColumn: "incidentEpisodeId",
  },
  {
    tableName: "AlertEpisode",
    internalNoteModelType: AlertEpisodeInternalNote,
    recordColumn: "alertEpisodeId",
  },
  {
    tableName: "ScheduledMaintenance",
    internalNoteModelType: ScheduledMaintenanceInternalNote,
    publicNoteModelType: ScheduledMaintenancePublicNote,
    recordColumn: "scheduledMaintenanceId",
  },
];

export function getCliStateMachine(
  tableName: string,
): CliStateMachine | undefined {
  return CLI_STATE_MACHINES.find((machine: CliStateMachine): boolean => {
    return machine.tableName === tableName;
  });
}

export function getCliNoteTarget(tableName: string): CliNoteTarget | undefined {
  return CLI_NOTE_TARGETS.find((target: CliNoteTarget): boolean => {
    return target.tableName === tableName;
  });
}

// The model's API path: `/incident-state-timeline`.
export function getModelApiPathOf(modelType: DatabaseBaseModelType): string {
  const path: string = new modelType().crudApiPath?.toString() || "";

  return `/${path.replace(LEADING_SLASHES, "")}`;
}

const LEADING_SLASHES: RegExp = /^\/+/;

/*
 * The actions a record has, in their order: its state changes and its
 * notes, each only when the API lets a key make the row it writes.
 */
export function getCliActions(tableName: string): Array<CliAction> {
  const actions: Array<CliAction> = [];
  const machine: CliStateMachine | undefined = getCliStateMachine(tableName);

  if (
    machine &&
    getTerraformModelOperations(machine.timelineModelType).canCreate
  ) {
    actions.push(
      ...machine.changes.map((change: CliStateChange): CliAction => {
        return change.action;
      }),
    );
  }

  const notes: CliNoteTarget | undefined = getCliNoteTarget(tableName);

  if (
    notes &&
    getTerraformModelOperations(notes.internalNoteModelType).canCreate
  ) {
    actions.push(CliAction.AddNote);
  }

  return CLI_ACTIONS.filter((action: CliAction): boolean => {
    return actions.includes(action);
  });
}

/*
 * FIELDS AND THEIR FLAGS
 */

// A person a field names, by email address: the flag beside the ID's.
export interface CliPersonFlag {
  // The companion's name in --data: userEmail, ownerUserEmails.
  columnName: string;
  flag: string;
  valueName: string;
  isList: boolean;
  // A team member named by an address nobody in the project has is invited.
  invitesByEmail: boolean;
  description: string;
}

export interface CliFieldFlag {
  columnName: string;
  flag: string;
  // What the flag takes, as its help writes it: <text>, <id>, <ids>.
  valueName: string;
  kind: TerraformValueKind;
  columnType: TableColumnType;
  // A create must give it (or the person's email address instead).
  isRequired: boolean;
  inCreate: boolean;
  inUpdate: boolean;
  description: string;
  // The command of the resource an ID names: incident-severity.
  relatedResource?: string | undefined;
  // Hashed or encrypted: OneUptime never shows it again.
  isSecret: boolean;
  person?: CliPersonFlag | undefined;
}

function getValueName(descriptor: TerraformAttributeDescriptor): string {
  switch (descriptor.kind) {
    case TerraformValueKind.Number:
      return "<number>";
    case TerraformValueKind.Bool:
      return "[true|false]";
    case TerraformValueKind.DateTime:
      return "<date>";
    case TerraformValueKind.IdSet:
      return "<ids>";
    case TerraformValueKind.StringSet:
      return "<values>";
    case TerraformValueKind.Json:
    case TerraformValueKind.MonitorSteps:
      return "<json>";
    default:
      break;
  }

  if (
    descriptor.columnType === TableColumnType.ObjectID ||
    descriptor.relatedModelType
  ) {
    return "<id>";
  }

  return VALUE_NAMES_BY_TYPE[descriptor.columnType] || "<text>";
}

// What a text flag of these types takes, in its help.
const VALUE_NAMES_BY_TYPE: Partial<Record<TableColumnType, string>> = {
  [TableColumnType.Color]: "<color>",
  [TableColumnType.Email]: "<email>",
  [TableColumnType.ShortURL]: "<url>",
  [TableColumnType.LongURL]: "<url>",
  [TableColumnType.Phone]: "<phone>",
  [TableColumnType.Domain]: "<domain>",
};

/*
 * A flag that opens with --no- turns its option off in Commander
 * (--no-color sets color to false), so a field named noReply has no flag:
 * it is set in --data.
 */
const NEGATED_FLAG_PREFIX: string = "--no-";

// Whether a flag is one a field may take.
export function isCliFieldFlagAllowed(flag: string): boolean {
  return (
    !CLI_RESERVED_FLAGS.includes(flag) && !flag.startsWith(NEGATED_FLAG_PREFIX)
  );
}

/*
 * Whether a field can have a flag: a value the command line can write (not
 * a file's bytes), filled in by the caller rather than the server, and of a
 * name the CLI does not use itself.
 */
function canHaveFlag(descriptor: TerraformAttributeDescriptor): boolean {
  return (
    descriptor.kind !== TerraformValueKind.Unsupported &&
    !isCliServerSetColumn(descriptor.columnName) &&
    isCliFieldFlagAllowed(toCliFlag(descriptor.columnName))
  );
}

function getRelatedResource(
  descriptor: TerraformAttributeDescriptor,
): string | undefined {
  if (!descriptor.relatedModelType) {
    return undefined;
  }

  const related: DatabaseBaseModel = new descriptor.relatedModelType();

  if (getCliDatabaseOperations(descriptor.relatedModelType).length === 0) {
    return undefined;
  }

  return getCliResourceName(related);
}

function getPersonFlag(
  descriptor: TerraformAttributeDescriptor,
  idFlag: string,
): CliPersonFlag | undefined {
  if (!descriptor.personEmail) {
    return undefined;
  }

  const isList: boolean = descriptor.personEmail.isList;
  const columnName: string = getPersonEmailColumnName(
    descriptor.columnName,
    isList ? PersonColumnKind.Many : PersonColumnKind.One,
  );
  const flag: string = toCliFlag(columnName);

  if (!isCliFieldFlagAllowed(flag)) {
    return undefined;
  }

  return {
    columnName,
    flag,
    valueName: isList ? "<emails>" : "<email>",
    isList,
    invitesByEmail: descriptor.personEmail.invitesByEmail,
    description: describePersonEmail({
      idName: idFlag,
      isList,
      invitesByEmail: descriptor.personEmail.invitesByEmail,
    }),
  };
}

const LINE_BREAKS: RegExp = /\s+/g;

// What a field is for, on one line: the model's words, or its title.
function describeField(descriptor: TerraformAttributeDescriptor): string {
  const text: string = (descriptor.description || descriptor.title || "")
    .replace(LINE_BREAKS, " ")
    .trim();

  return text;
}

/*
 * Every field create and update take a flag for, in the order the model
 * declares them: the provider's attributes (TerraformSchema), so the API's
 * create and update schemas, less the ones the server fills in, those the
 * command line cannot write and those whose name the CLI uses itself.
 */
export function getCliFieldFlags(
  modelType: DatabaseBaseModelType,
): Array<CliFieldFlag> {
  const flags: Array<CliFieldFlag> = [];
  const seen: Set<string> = new Set<string>();

  for (const descriptor of getTerraformAttributes(modelType)) {
    if (!canHaveFlag(descriptor)) {
      continue;
    }

    const flag: string = toCliFlag(descriptor.columnName);

    // Two columns of one name in kebab case: the first keeps the flag.
    if (seen.has(flag)) {
      continue;
    }

    seen.add(flag);

    const person: CliPersonFlag | undefined = getPersonFlag(descriptor, flag);

    if (person) {
      seen.add(person.flag);
    }

    flags.push({
      columnName: descriptor.columnName,
      flag,
      valueName: getValueName(descriptor),
      kind: descriptor.kind,
      columnType: descriptor.columnType,
      isRequired: descriptor.isRequired,
      inCreate: descriptor.inCreateSchema,
      inUpdate: descriptor.inUpdateSchema,
      description: describeField(descriptor),
      relatedResource: getRelatedResource(descriptor),
      isSecret: Boolean(descriptor.secretKind),
      person,
    });
  }

  return flags;
}

// The flags a create (or an update) takes.
export function getCliFieldFlagsFor(
  modelType: DatabaseBaseModelType,
  operation: CliOperation.Create | CliOperation.Update,
): Array<CliFieldFlag> {
  return getCliFieldFlags(modelType).filter((flag: CliFieldFlag): boolean => {
    return operation === CliOperation.Create ? flag.inCreate : flag.inUpdate;
  });
}

/*
 * A flag's help: what the field is for, then what the flag takes - an ID
 * of which resource, IDs separated by commas, JSON - and whether a create
 * must give it.
 */
export function getCliFieldFlagHelp(
  flag: CliFieldFlag,
  operation: CliOperation.Create | CliOperation.Update,
): string {
  const parts: Array<string> = [];

  if (operation === CliOperation.Create && flag.isRequired) {
    parts.push(flag.person ? `Required, or ${flag.person.flag}.` : "Required.");
  }

  if (flag.description) {
    parts.push(withFullStop(flag.description));
  }

  switch (flag.kind) {
    case TerraformValueKind.IdSet:
      parts.push(
        flag.relatedResource
          ? `IDs separated by commas, from \`${ONEUPTIME_CLI_COMMAND} ${flag.relatedResource} list\`.`
          : "IDs separated by commas.",
      );
      break;
    case TerraformValueKind.StringSet:
      parts.push("Values separated by commas, or a JSON array.");
      break;
    case TerraformValueKind.Json:
    case TerraformValueKind.MonitorSteps:
      parts.push("JSON.");
      break;
    case TerraformValueKind.DateTime:
      parts.push("A date and time, such as 2026-11-01T10:00:00Z.");
      break;
    default:
      if (flag.relatedResource) {
        parts.push(
          `An ID from \`${ONEUPTIME_CLI_COMMAND} ${flag.relatedResource} list\`.`,
        );
      }
      break;
  }

  if (flag.isSecret) {
    parts.push("Secret: OneUptime never shows it again.");
  }

  return parts.join(" ");
}

const ENDS_WITH_PUNCTUATION: RegExp = /[.!?)]$/;

function withFullStop(text: string): string {
  return ENDS_WITH_PUNCTUATION.test(text) ? text : `${text}.`;
}

/*
 * VALUES
 */

// A value a flag cannot take, said the way the person fixes it.
export class CliValueError extends Error {}

const TRUE_WORDS: ReadonlyArray<string> = ["true", "yes", "1", "on"];
const FALSE_WORDS: ReadonlyArray<string> = ["false", "no", "0", "off"];

const LIST_SEPARATOR: string = ",";

// "a, b,c" or '["a","b"]' -> ["a", "b", "c"]; "" -> [].
export function parseCliList(flag: string, raw: string): Array<string> {
  const text: string = raw.trim();

  if (text.startsWith("[")) {
    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch {
      throw new CliValueError(
        `${flag} takes values separated by commas, or a JSON array, and ${JSON.stringify(raw)} is neither.`,
      );
    }

    if (
      !Array.isArray(parsed) ||
      !parsed.every((item: unknown): boolean => {
        return typeof item === "string";
      })
    ) {
      throw new CliValueError(
        `${flag} takes a JSON array of strings, such as ["a","b"].`,
      );
    }

    return parsed as Array<string>;
  }

  return text
    .split(LIST_SEPARATOR)
    .map((item: string): string => {
      return item.trim();
    })
    .filter((item: string): boolean => {
      return item.length > 0;
    });
}

function assertIds(flag: CliFieldFlag, ids: Array<string>): void {
  for (const id of ids) {
    if (!ObjectID.isValidUUID(id)) {
      throw new CliValueError(
        `${flag.flag} takes ${flag.kind === TerraformValueKind.IdSet ? "IDs" : "an ID"}, such as 6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11, and ${JSON.stringify(id)} is not one.${
          flag.relatedResource
            ? ` Find them with \`${ONEUPTIME_CLI_COMMAND} ${flag.relatedResource} list\`.`
            : ""
        }`,
      );
    }
  }
}

/*
 * What a flag's text is as the API takes it: a number for a number, true
 * or false for a switch (the flag alone is true), the records of a list
 * relation as `{"_id": ...}` objects, JSON parsed, a date as ISO 8601.
 * Throws a CliValueError that says what the flag takes.
 */
export function parseCliFieldValue(
  flag: CliFieldFlag,
  raw: string | boolean,
): JSONValue {
  if (typeof raw === "boolean") {
    if (flag.kind === TerraformValueKind.Bool) {
      return raw;
    }

    throw new CliValueError(`${flag.flag} needs a value: ${flag.valueName}.`);
  }

  switch (flag.kind) {
    case TerraformValueKind.Bool: {
      const word: string = raw.trim().toLowerCase();

      if (TRUE_WORDS.includes(word)) {
        return true;
      }

      if (FALSE_WORDS.includes(word)) {
        return false;
      }

      throw new CliValueError(
        `${flag.flag} takes true or false, and ${JSON.stringify(raw)} is neither.`,
      );
    }
    case TerraformValueKind.Number: {
      const value: number = Number(raw.trim());

      if (raw.trim() === "" || !Number.isFinite(value)) {
        throw new CliValueError(
          `${flag.flag} takes a number, and ${JSON.stringify(raw)} is not one.`,
        );
      }

      return value;
    }
    case TerraformValueKind.DateTime: {
      const date: Date = new Date(raw.trim());

      if (raw.trim() === "" || Number.isNaN(date.getTime())) {
        throw new CliValueError(
          `${flag.flag} takes a date and time, such as 2026-11-01T10:00:00Z, and ${JSON.stringify(raw)} is not one.`,
        );
      }

      return date.toISOString();
    }
    case TerraformValueKind.IdSet: {
      const ids: Array<string> = parseCliList(flag.flag, raw);

      assertIds(flag, ids);

      return ids.map((id: string): JSONObject => {
        return { _id: id };
      }) as JSONArray;
    }
    case TerraformValueKind.StringSet:
      return parseCliList(flag.flag, raw);
    case TerraformValueKind.Json:
    case TerraformValueKind.MonitorSteps:
      try {
        return JSON.parse(raw) as JSONValue;
      } catch {
        throw new CliValueError(
          `${flag.flag} takes JSON, and ${JSON.stringify(raw)} is not JSON. In Bash and zsh, wrap it in single quotes.`,
        );
      }
    default:
      if (
        flag.valueName === "<id>" &&
        flag.columnType === TableColumnType.ObjectID
      ) {
        assertIds(flag, [raw.trim()]);
        return raw.trim();
      }

      return raw;
  }
}

/*
 * TELEMETRY FIELDS
 *
 * Telemetry is written by OpenTelemetry, rarely by hand, so its create
 * takes its record in --data; its fields are listed all the same.
 */
export interface CliAnalyticsField {
  columnName: string;
  title: string;
  type: string;
  description: string;
  isRequired: boolean;
  inCreate: boolean;
  inUpdate: boolean;
  isReadable: boolean;
}

export function getCliAnalyticsFields(
  modelType: AnalyticsBaseModelType,
): Array<CliAnalyticsField> {
  const model: AnalyticsBaseModel = new modelType();

  return model
    .getTableColumns()
    .map((column: AnalyticsTableColumn): CliAnalyticsField => {
      return {
        columnName: column.key,
        title: column.title || column.key,
        type: column.type,
        description: (column.description || "")
          .replace(LINE_BREAKS, " ")
          .trim(),
        isRequired: column.required,
        inCreate: (column.accessControl?.create || []).length > 0,
        inUpdate: (column.accessControl?.update || []).length > 0,
        isReadable: isAnalyticsColumnReadable(
          column.key,
          column.accessControl?.read,
        ),
      };
    });
}

/*
 * Whether a key may read a telemetry column: its read rule names someone
 * other than a signed-in user alone, or, with no rule, it is one every
 * select may name (ALWAYS_SELECTABLE_COLUMNS) - the rule the CLI's own
 * select follows (packages/CLI/Utils/SelectFieldGenerator.ts).
 */
export function isAnalyticsColumnReadable(
  columnName: string,
  read: Array<Permission> | undefined,
): boolean {
  if (!read) {
    return ALWAYS_SELECTABLE_COLUMNS.includes(columnName);
  }

  return !isApiExcludedForPermissions(read);
}
