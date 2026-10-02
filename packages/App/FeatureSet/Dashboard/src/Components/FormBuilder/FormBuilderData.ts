import IncidentCustomField from "Common/Models/DatabaseModels/IncidentCustomField";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenanceCustomField from "Common/Models/DatabaseModels/ScheduledMaintenanceCustomField";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
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

    definitions.push({
      id: id.toLowerCase(),
      name: row.name,
      description: row.description,
      customFieldType: row.customFieldType,
      dropdownOptions: row.dropdownOptions,
    });
  }

  return definitions;
};

export type LoadFormRecordOptionsFunction = (
  source: FormTargetOptionsSource,
) => Promise<Array<FormRecordOption>>;

/**
 * Every record of one kind in the current project, as a choice question can
 * offer it: its id, its name and its color, where it has one.
 */
export const loadFormRecordOptions: LoadFormRecordOptionsFunction = async (
  source: FormTargetOptionsSource,
): Promise<Array<FormRecordOption>> => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return [];
  }

  switch (source) {
    case FormTargetOptionsSource.IncidentSeverity: {
      const result: ListResult<IncidentSeverity> =
        await ModelAPI.getList<IncidentSeverity>({
          modelType: IncidentSeverity,
          query: { projectId: projectId },
          select: { _id: true, name: true, color: true },
          sort: { order: SortOrder.Ascending },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
        });

      return toOptions(result.data);
    }

    case FormTargetOptionsSource.Monitor: {
      const result: ListResult<Monitor> = await ModelAPI.getList<Monitor>({
        modelType: Monitor,
        query: { projectId: projectId },
        select: { _id: true, name: true },
        sort: { name: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

      return toOptions(result.data);
    }

    case FormTargetOptionsSource.Label: {
      const result: ListResult<Label> = await ModelAPI.getList<Label>({
        modelType: Label,
        query: { projectId: projectId },
        select: { _id: true, name: true, color: true },
        sort: { name: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

      return toOptions(result.data);
    }

    case FormTargetOptionsSource.StatusPage: {
      const result: ListResult<StatusPage> =
        await ModelAPI.getList<StatusPage>({
          modelType: StatusPage,
          query: { projectId: projectId },
          select: { _id: true, name: true },
          sort: { name: SortOrder.Ascending },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
        });

      return toOptions(result.data);
    }

    default:
      return [];
  }
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
