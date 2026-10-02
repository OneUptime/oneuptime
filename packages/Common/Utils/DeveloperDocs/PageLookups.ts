import { DatabaseBaseModelType } from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../Models/DatabaseModels/Label";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import Team from "../../Models/DatabaseModels/Team";
import Dictionary from "../../Types/Dictionary";
import { getTableColumns } from "../../Types/Database/TableColumn";
import { JSONObject } from "../../Types/JSON";
import {
  getRelatedModelType,
  getTableName,
  inScope,
  withNameAndDescription,
} from "./ExampleBuilder";
import {
  dedupeDeveloperDocsLookups,
  DeveloperDocsLookup,
  getDeveloperDocsLookup,
} from "./LiveData";
import {
  DeveloperDocsField,
  DeveloperDocsProfile,
  DeveloperDocsScopeName,
  DeveloperDocsValue,
  getDeveloperDocsProfile,
} from "./ResourceProfiles";
import { getTerraformAttributes, TerraformValueKind } from "./TerraformSchema";
import { isJSONObject } from "./TerraformValues";

/*
 * What a Developer page looks up before it shows its examples, worked out
 * from the resource's profile and, on a resource's own page, from the
 * record: a few of each kind of record its examples point at (severities,
 * monitors, teams), and the records the resource's own ids point at (to name
 * them in its configuration). Pure, so what a page asks for can be tested
 * without a server; DeveloperDocsPage runs the lookups, each on its own.
 */

export type DeveloperDocsPageKind = "terraform" | "api" | "ai-assistants";

// What a new monitor's steps point at: the project's statuses and severities.
const MONITOR_STEP_MODELS: Array<DatabaseBaseModelType> = [
  MonitorStatus,
  IncidentSeverity,
  AlertSeverity,
];

/*
 * A table named in a value: the block's own model (a data source looking up
 * one of its own kind), or the model a column of it points at.
 */
function findNamedModel(
  modelType: DatabaseBaseModelType,
  tableName: string,
): DatabaseBaseModelType | undefined {
  if (getTableName(modelType) === tableName) {
    return modelType;
  }

  for (const column of Object.keys(getTableColumns(new modelType()))) {
    const related: DatabaseBaseModelType | undefined = getRelatedModelType(
      modelType,
      column,
    );

    if (related && getTableName(related) === tableName) {
      return related;
    }
  }

  return undefined;
}

// The models a value points at, for the page to look a few of each up.
export function getModelsForValue(data: {
  modelType: DatabaseBaseModelType;
  column: string;
  value: DeveloperDocsValue | undefined;
}): Array<DatabaseBaseModelType> {
  const { value } = data;

  if (value?.kind === "monitorSteps") {
    return MONITOR_STEP_MODELS;
  }

  if (value && value.kind !== "live" && value.kind !== "liveName") {
    return [];
  }

  const tableName: string | undefined =
    value?.kind === "liveName" || value?.kind === "live"
      ? value.tableName
      : undefined;
  const related: DatabaseBaseModelType | undefined = tableName
    ? findNamedModel(data.modelType, tableName)
    : getRelatedModelType(data.modelType, data.column);

  return related ? [related] : [];
}

/*
 * The kinds of records a page's examples point at: what it looks a few of up,
 * so the examples use the project's own.
 */
export function getDeveloperDocsLiveModels(data: {
  modelType: DatabaseBaseModelType;
  scope: DeveloperDocsScopeName;
  page: DeveloperDocsPageKind;
}): Array<DatabaseBaseModelType> {
  const profile: DeveloperDocsProfile = getDeveloperDocsProfile(
    data.modelType,
  );
  const models: Map<string, DatabaseBaseModelType> = new Map<
    string,
    DatabaseBaseModelType
  >();
  const add: (
    modelType: DatabaseBaseModelType,
    column: string,
    value: DeveloperDocsValue | undefined,
  ) => void = (
    modelType: DatabaseBaseModelType,
    column: string,
    value: DeveloperDocsValue | undefined,
  ): void => {
    for (const related of getModelsForValue({ modelType, column, value })) {
      models.set(getTableName(related), related);
    }
  };

  if (data.page === "ai-assistants") {
    return [];
  }

  // A list page creates one: its fields, and every required one.
  if (data.scope === "list") {
    const fields: Array<DeveloperDocsField> = withNameAndDescription(
      data.modelType,
      profile,
    );

    for (const field of fields) {
      add(data.modelType, field.column, field.value);
    }

    for (const descriptor of getTerraformAttributes(data.modelType)) {
      if (
        descriptor.isRequired &&
        !fields.some((field: DeveloperDocsField): boolean => {
          return field.column === descriptor.columnName;
        })
      ) {
        add(data.modelType, descriptor.columnName, undefined);
      }
    }
  }

  if (data.page === "terraform") {
    for (const recipe of profile.recipes || []) {
      if (!inScope(recipe.scopes, data.scope)) {
        continue;
      }

      for (const block of recipe.blocks) {
        for (const field of block.fields) {
          add(block.modelType, field.column, field.value);
        }
      }
    }
  }

  if (data.page === "api" && data.scope === "list") {
    for (const filter of profile.filters || []) {
      for (const part of filter.query) {
        add(data.modelType, part.column, part.value);
      }
    }
  }

  if (data.page === "api" && data.scope === "view") {
    for (const field of profile.update?.fields || []) {
      add(data.modelType, field.column, field.value);
    }

    for (const task of profile.tasks || []) {
      if (!inScope(task.scopes, data.scope)) {
        continue;
      }

      for (const field of task.fields || []) {
        add(task.modelType, field.column, field.value);
      }

      for (const part of task.query || []) {
        add(task.modelType, part.column, part.value);
      }
    }
  }

  return Array.from(models.values());
}

// An id from the API's JSON: a string, or a wrapper or related record that carries one.
function toId(value: unknown): string | null {
  if (typeof value === "string" && value) {
    return value;
  }

  if (isJSONObject(value)) {
    for (const key of ["_id", "value"]) {
      const id: unknown = value[key];

      if (typeof id === "string" && id) {
        return id;
      }
    }
  }

  return null;
}

// The ids in a monitor's steps, by the model they point at.
const MONITOR_STEP_ID_KEYS: ReadonlyArray<{
  key: string;
  modelType: DatabaseBaseModelType;
}> = [
  { key: "monitorStatusId", modelType: MonitorStatus },
  { key: "incidentSeverityId", modelType: IncidentSeverity },
  { key: "alertSeverityId", modelType: AlertSeverity },
  { key: "onCallPolicyIds", modelType: OnCallDutyPolicy },
  { key: "labelIds", modelType: Label },
  { key: "ownerTeamIds", modelType: Team },
];

function collectMonitorStepIds(
  value: unknown,
  ids: Map<string, { modelType: DatabaseBaseModelType; ids: Set<string> }>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectMonitorStepIds(item, ids);
    }
    return;
  }

  if (!isJSONObject(value)) {
    return;
  }

  for (const [key, item] of Object.entries(value as JSONObject)) {
    const known: { key: string; modelType: DatabaseBaseModelType } | undefined =
      MONITOR_STEP_ID_KEYS.find(
        (candidate: { key: string; modelType: DatabaseBaseModelType }) => {
          return candidate.key === key;
        },
      );

    if (known) {
      const found: Array<unknown> = Array.isArray(item) ? item : [item];

      for (const entry of found) {
        const id: string | null = toId(entry);

        if (id) {
          addId(ids, known.modelType, id);
        }
      }

      continue;
    }

    collectMonitorStepIds(item, ids);
  }
}

function addId(
  ids: Map<string, { modelType: DatabaseBaseModelType; ids: Set<string> }>,
  modelType: DatabaseBaseModelType,
  id: string,
): void {
  const tableName: string = getTableName(modelType);
  const entry: { modelType: DatabaseBaseModelType; ids: Set<string> } =
    ids.get(tableName) || { modelType, ids: new Set<string>() };

  entry.ids.add(id);
  ids.set(tableName, entry);
}

/*
 * The records a resource's own ids point at, by model: its severity, its
 * monitors, its labels, and the statuses and severities in its monitor
 * steps. Looked up to name them in its configuration.
 */
export function getDeveloperDocsRecordLookups(data: {
  modelType: DatabaseBaseModelType;
  json: Dictionary<unknown>;
}): Array<DeveloperDocsLookup> {
  const ids: Map<string, { modelType: DatabaseBaseModelType; ids: Set<string> }> =
    new Map<string, { modelType: DatabaseBaseModelType; ids: Set<string> }>();

  for (const descriptor of getTerraformAttributes(data.modelType)) {
    const value: unknown = data.json[descriptor.columnName];

    if (value === undefined || value === null) {
      continue;
    }

    if (descriptor.kind === TerraformValueKind.MonitorSteps) {
      collectMonitorStepIds(value, ids);
      continue;
    }

    if (!descriptor.relatedModelType || descriptor.secretKind) {
      continue;
    }

    const values: Array<unknown> = Array.isArray(value) ? value : [value];

    for (const item of values) {
      const id: string | null = toId(item);

      if (id) {
        addId(ids, descriptor.relatedModelType, id);
      }
    }
  }

  return Array.from(ids.values()).map(
    (entry: {
      modelType: DatabaseBaseModelType;
      ids: Set<string>;
    }): DeveloperDocsLookup => {
      return getDeveloperDocsLookup(entry.modelType, Array.from(entry.ids));
    },
  );
}

// Every lookup a page makes, once each.
export function getDeveloperDocsPageLookups(data: {
  modelType: DatabaseBaseModelType;
  scope: DeveloperDocsScopeName;
  page: DeveloperDocsPageKind;
  // The record, on a resource's own page.
  json?: Dictionary<unknown> | undefined;
}): Array<DeveloperDocsLookup> {
  const lookups: Array<DeveloperDocsLookup> = getDeveloperDocsLiveModels(
    data,
  ).map((modelType: DatabaseBaseModelType): DeveloperDocsLookup => {
    return getDeveloperDocsLookup(modelType);
  });

  if (data.page === "terraform" && data.scope === "view" && data.json) {
    lookups.push(
      ...getDeveloperDocsRecordLookups({
        modelType: data.modelType,
        json: data.json,
      }),
    );
  }

  return dedupeDeveloperDocsLookups(lookups);
}
