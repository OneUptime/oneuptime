import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentCustomField from "Common/Models/DatabaseModels/IncidentCustomField";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenanceCustomField from "Common/Models/DatabaseModels/ScheduledMaintenanceCustomField";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import CustomFieldMappingSourceResource from "Common/Types/CustomField/CustomFieldMappingSourceResource";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import {
  FormCustomFieldDefinition,
  FormRecordOption,
} from "Common/Types/Form/FormPublic";
import { FormTargetOptionsSource } from "Common/Types/Form/FormTargetCatalog";
import FormTargetType from "Common/Types/Form/FormTargetType";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import RecordsById from "Common/UI/Utils/RecordsById";

/*
 * What the form builder, the preview and the On Submit page read besides
 * the form itself: the target's custom fields in the project, and the
 * project's records a choice question can offer (severities, monitors,
 * labels, status pages). The same shapes the server builds the public form
 * from (FormService.buildPublicFormFor), so the builder's preview is drawn
 * from what the public page will be.
 */

export type LoadFormCustomFieldsFunction = (
  targetType: FormTargetType,
) => Promise<Array<FormCustomFieldDefinition>>;

/** The target's custom fields in the current project, in their order. */
export const loadFormCustomFields: LoadFormCustomFieldsFunction = async (
  targetType: FormTargetType,
): Promise<Array<FormCustomFieldDefinition>> => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return [];
  }

  if (targetType === FormTargetType.ScheduledMaintenance) {
    const result: ListResult<ScheduledMaintenanceCustomField> =
      await ModelAPI.getList<ScheduledMaintenanceCustomField>({
        modelType: ScheduledMaintenanceCustomField,
        query: { projectId: projectId },
        select: {
          _id: true,
          name: true,
          description: true,
          customFieldType: true,
          dropdownOptions: true,
          mapFromResourceType: true,
          mapFromCustomFieldName: true,
        },
        sort: { name: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    return toDefinitions(result.data);
  }

  const result: ListResult<IncidentCustomField> =
    await ModelAPI.getList<IncidentCustomField>({
      modelType: IncidentCustomField,
      query: { projectId: projectId },
      select: {
        _id: true,
        name: true,
        description: true,
        customFieldType: true,
        dropdownOptions: true,
        mapFromResourceType: true,
        mapFromCustomFieldName: true,
      },
      sort: { sortOrder: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    });

  return toDefinitions(result.data);
};

type ToDefinitionsFunction = (
  rows: Array<IncidentCustomField | ScheduledMaintenanceCustomField>,
) => Array<FormCustomFieldDefinition>;

const toDefinitions: ToDefinitionsFunction = (
  rows: Array<IncidentCustomField | ScheduledMaintenanceCustomField>,
): Array<FormCustomFieldDefinition> => {
  const definitions: Array<FormCustomFieldDefinition> = [];

  for (const row of rows) {
    const id: string | undefined = row._id?.toString();

    if (!id || !row.name) {
      continue;
    }

    const definition: FormCustomFieldDefinition = {
      id: id.toLowerCase(),
      name: row.name,
      description: row.description,
      customFieldType: row.customFieldType,
      dropdownOptions: row.dropdownOptions,
    };

    // Monitors are the only source either target can copy a value from.
    if (
      row.mapFromResourceType === CustomFieldMappingSourceResource.Monitor &&
      row.mapFromCustomFieldName
    ) {
      definition.isCopiedFromMonitor = true;
    }

    definitions.push(definition);
  }

  return definitions;
};

/*
 * Where a choice question's records come from, kind by kind, read as the
 * server reads them for the public page (FormRecordOptions): a severity or
 * a label a submitter picks is never an archived one, and each kind comes
 * in the project's own order - severities by their order, the rest by name.
 */
export interface FormRecordOptionsSource {
  modelType: DatabaseBaseModelType;
  // What a record must be, besides the project's, to be offered.
  query: Record<string, unknown>;
  select: Record<string, true>;
  // The column the project's own order is by.
  sortBy: "order" | "name";
}

export const FORM_RECORD_OPTIONS_SOURCES: Record<
  FormTargetOptionsSource,
  FormRecordOptionsSource
> = {
  [FormTargetOptionsSource.IncidentSeverity]: {
    modelType: IncidentSeverity,
    query: { isArchived: false },
    select: { _id: true, name: true, color: true, order: true },
    sortBy: "order",
  },
  [FormTargetOptionsSource.Monitor]: {
    modelType: Monitor,
    query: {},
    select: { _id: true, name: true },
    sortBy: "name",
  },
  [FormTargetOptionsSource.Label]: {
    modelType: Label,
    query: { isArchived: false },
    select: { _id: true, name: true, color: true },
    sortBy: "name",
  },
  [FormTargetOptionsSource.StatusPage]: {
    modelType: StatusPage,
    query: {},
    select: { _id: true, name: true },
    sortBy: "name",
  },
};

export type LoadFormRecordOptionsFunction = (
  source: FormTargetOptionsSource,
  /*
   * Read only these records - the ones a question offers - as the server
   * does (#10646). Unset, every record of the kind, which only a question
   * that may offer every record (severities) needs: a project's monitors,
   * labels or status pages read whole stopped at the first 10,000.
   */
  ids?: Array<string> | undefined,
) => Promise<Array<FormRecordOption>>;

/**
 * The records of one kind in the current project, as a choice question can
 * offer them: each one's id, its name and its color, where it has one.
 */
export const loadFormRecordOptions: LoadFormRecordOptionsFunction = async (
  source: FormTargetOptionsSource,
  ids?: Array<string> | undefined,
): Promise<Array<FormRecordOption>> => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const definition: FormRecordOptionsSource | undefined =
    FORM_RECORD_OPTIONS_SOURCES[source];

  if (!projectId || !definition) {
    return [];
  }

  if (ids) {
    const rows: Array<BaseModel> = await RecordsById.read<BaseModel>({
      modelType: definition.modelType,
      ids: ids,
      query: { projectId: projectId, ...definition.query } as Query<BaseModel>,
      select: definition.select as Select<BaseModel>,
    });

    return toOptions(sortInProjectOrder(rows, definition.sortBy) as never);
  }

  const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>({
    modelType: definition.modelType,
    query: { projectId: projectId, ...definition.query } as Query<BaseModel>,
    select: definition.select as Select<BaseModel>,
    sort: { [definition.sortBy]: SortOrder.Ascending } as Sort<BaseModel>,
    limit: LIMIT_PER_PROJECT,
    skip: 0,
  });

  return toOptions(result.data as never);
};

type SortInProjectOrderFunction = (
  rows: Array<BaseModel>,
  sortBy: "order" | "name",
) => Array<BaseModel>;

// Records read by their ids, put in the order the list would have them in.
const sortInProjectOrder: SortInProjectOrderFunction = (
  rows: Array<BaseModel>,
  sortBy: "order" | "name",
): Array<BaseModel> => {
  return [...rows].sort((a: BaseModel, b: BaseModel): number => {
    const left: unknown = (a as unknown as Record<string, unknown>)[sortBy];
    const right: unknown = (b as unknown as Record<string, unknown>)[sortBy];

    if (typeof left === "number" && typeof right === "number") {
      return left - right;
    }

    return String(left ?? "").localeCompare(String(right ?? ""));
  });
};

type ToOptionsFunction = (
  rows: Array<{
    _id?: string | undefined;
    name?: string | undefined;
    color?: { toString: () => string } | undefined;
  }>,
) => Array<FormRecordOption>;

const toOptions: ToOptionsFunction = (
  rows: Array<{
    _id?: string | undefined;
    name?: string | undefined;
    color?: { toString: () => string } | undefined;
  }>,
): Array<FormRecordOption> => {
  const options: Array<FormRecordOption> = [];

  for (const row of rows) {
    const id: string | undefined = row._id?.toString();

    if (!id) {
      continue;
    }

    const option: FormRecordOption = {
      id: id.toLowerCase(),
      name: row.name || "",
    };

    if (row.color) {
      option.color = row.color.toString();
    }

    options.push(option);
  }

  return options;
};
