import IncidentCustomField from "Common/Models/DatabaseModels/IncidentCustomField";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import {
  CustomFieldFormDefinition,
  sortCustomFieldDefinitions,
  toCustomFieldFormDefinition,
} from "Common/UI/Components/CustomFields/CustomFieldFormFields";
import { isCustomFieldInherited } from "Common/UI/Components/CustomFields/CustomFieldModelFormFields";
import { JSONObject } from "Common/Types/JSON";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";

// The steps' ids and titles live with the rest of the text.
export {
  INCIDENT_DETAILS_STEP_ID,
  INCIDENT_DETAILS_STEP_TITLE,
  INCIDENT_TEMPLATE_CUSTOM_FIELDS_STEP_ID,
  INCIDENT_TEMPLATE_CUSTOM_FIELDS_STEP_TITLE,
} from "./IncidentCustomFieldsCopy";

/*
 * The project's incident custom fields, for the pages that ask for or fill in
 * their values outside the Custom Fields card: the Details step of declaring
 * an incident, a new incident template, and the placeholders of a note
 * template.
 */

// A definition, with the key {{customFields.<key>}} placeholders use.
export interface IncidentCustomFieldDefinition
  extends CustomFieldFormDefinition {
  variableKey?: string | undefined;
}

export const INCIDENT_CUSTOM_FIELD_DEFINITION_TABLE: string =
  "IncidentCustomField";

/**
 * Every incident custom field of the current project, in their order.
 *
 * Throws when they cannot be read. Reading them needs a billing plan with
 * custom fields and a permission, so a caller that can do without them - all
 * of them can - catches that and carries on with none.
 */
export const fetchIncidentCustomFieldDefinitions: () => Promise<
  Array<IncidentCustomFieldDefinition>
> = async (): Promise<Array<IncidentCustomFieldDefinition>> => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const result: ListResult<IncidentCustomField> =
    await ModelAPI.getList<IncidentCustomField>({
      modelType: IncidentCustomField,
      query: projectId ? { projectId: projectId } : {},
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        name: true,
        description: true,
        customFieldType: true,
        dropdownOptions: true,
        sortOrder: true,
        showOnCreate: true,
        isRequiredOnCreate: true,
        variableKey: true,
        mapFromResourceType: true,
        mapFromCustomFieldName: true,
      },
      sort: {
        sortOrder: SortOrder.Ascending,
      },
    });

  const definitions: Array<IncidentCustomFieldDefinition> = [];

  for (const row of result.data || []) {
    // Model instances and plain JSON both read by property.
    const definition: CustomFieldFormDefinition | null =
      toCustomFieldFormDefinition(row);

    if (!definition) {
      continue;
    }

    const variableKey: unknown = (row as unknown as JSONObject)["variableKey"];

    definitions.push({
      ...definition,
      variableKey:
        typeof variableKey === "string" && variableKey.length > 0
          ? variableKey
          : undefined,
    });
  }

  // Also by order here: fields with none come last, in the order listed.
  return sortCustomFieldDefinitions(definitions);
};

/**
 * The fields the Details step of declaring an incident asks for: the ones
 * marked "Show on Create", in their order.
 */
export const getDetailsStepDefinitions: (
  definitions: Array<IncidentCustomFieldDefinition>,
) => Array<IncidentCustomFieldDefinition> = (
  definitions: Array<IncidentCustomFieldDefinition>,
): Array<IncidentCustomFieldDefinition> => {
  return sortCustomFieldDefinitions(
    definitions.filter((definition: IncidentCustomFieldDefinition) => {
      return definition.showOnCreate === true;
    }),
  );
};

/**
 * Whether the incident being declared, as its form stands, is asked for this
 * field. Not when the field is mapped from a monitor field and the incident
 * has a monitor: the value is copied from the monitor when the incident is
 * created, so anything typed would only be replaced (the Custom Fields card
 * treats such a field the same way).
 */
export const isAskedOnIncidentForm: (
  definition: CustomFieldFormDefinition,
  values: JSONObject,
) => boolean = (
  definition: CustomFieldFormDefinition,
  values: JSONObject,
): boolean => {
  return !isCustomFieldInherited({
    definitionTableName: INCIDENT_CUSTOM_FIELD_DEFINITION_TABLE,
    definition: definition,
    values: values,
  });
};
