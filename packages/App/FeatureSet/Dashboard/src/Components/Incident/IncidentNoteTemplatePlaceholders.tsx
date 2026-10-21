import IncidentCustomFieldsCopy from "./IncidentCustomFieldsCopy";
import {
  IncidentCustomFieldTemplateVariableRow,
  IncidentCustomFieldTemplateVariablesState,
  fetchIncidentCustomFieldTemplateVariables,
} from "../StatusPage/IncidentCustomFieldTemplateVariables";
import IncidentCustomFieldTemplateVariablesCopy from "../StatusPage/IncidentCustomFieldTemplateVariablesCopy";
import { isCustomFieldTemplateVariableName } from "Common/Types/CustomField/CustomFieldVariableKey";
import {
  TemplateVariable,
  TemplateVariableGroup,
  TemplateVariableGroups,
} from "Common/Types/Template/TemplateVariable";
import {
  INCIDENT_NOTE_TEMPLATE_VARIABLES,
  IncidentNoteTemplateVariableInfo,
} from "Common/Utils/Incident/IncidentNoteTemplateVariables";
import { useEffect, useMemo, useState } from "react";

/*
 * The template variables an incident note template can use, as its Note
 * field offers them - in a new template's Note Details step and in a
 * template's Edit Note Template dialog.
 *
 * They used to be listed above the editor, every one of them, in front of
 * what the field was for. The maintainer: "show the list of variables at the
 * bottom, but it should be collapsed ... integrate variables with the
 * markdown editor ... pick those variables and have them directly in the
 * editor". So the field hands these to the Markdown editor
 * (Field.templateVariables): collapsed under it as "Template variables",
 * behind its Insert variable button, and under the cursor when "{{" is
 * typed, each put in where the cursor is.
 *
 * Two groups:
 *
 *   - Incident: the incident's own values, {{incident.title}} and on, from
 *     Common/Utils/Incident/IncidentNoteTemplateVariables - the list that
 *     fills them in;
 *   - Custom Fields: the project's incident custom fields, each by its own
 *     {{incident.customFields.<key>}} and named as the project named it. The
 *     family's pattern itself is not offered: "<key>" picked into a note
 *     fills nothing. A project without fields, or a reader who may not list
 *     them, sees a line saying so instead.
 *
 * No warning goes with them: the yellow box titled Internal data that sat
 * under the list was taken out as clutter, and App/Tests/Dashboard/
 * InternalDataWarningRemoved keeps it out (this file is one it reads).
 */

export const NOTE_TEMPLATE_INCIDENT_GROUP_TITLE: string = "Incident";
export const NOTE_TEMPLATE_CUSTOM_FIELDS_GROUP_TITLE: string = "Custom Fields";

export type IncidentNoteTemplateCustomFields =
  IncidentCustomFieldTemplateVariablesState;

// The custom field family's own row: what the family is, in one line.
const CUSTOM_FIELD_FAMILY: IncidentNoteTemplateVariableInfo | undefined =
  INCIDENT_NOTE_TEMPLATE_VARIABLES.find(
    (variable: IncidentNoteTemplateVariableInfo): boolean => {
      return isCustomFieldTemplateVariableName(variable.name);
    },
  );

export type GetIncidentNoteTemplateVariableGroupsFunction = (
  customFields: IncidentNoteTemplateCustomFields,
) => TemplateVariableGroups;

/**
 * The note field's variables: the incident's own, then the project's custom
 * fields as far as they are known.
 */
export const getIncidentNoteTemplateVariableGroups: GetIncidentNoteTemplateVariableGroupsFunction =
  (customFields: IncidentNoteTemplateCustomFields): TemplateVariableGroups => {
    const incident: TemplateVariableGroup = {
      title: NOTE_TEMPLATE_INCIDENT_GROUP_TITLE,
      variables: INCIDENT_NOTE_TEMPLATE_VARIABLES.filter(
        (variable: IncidentNoteTemplateVariableInfo): boolean => {
          return !isCustomFieldTemplateVariableName(variable.name);
        },
      ).map((variable: IncidentNoteTemplateVariableInfo): TemplateVariable => {
        return { name: variable.name, description: variable.description };
      }),
    };

    let description: string | undefined = CUSTOM_FIELD_FAMILY?.description;
    let variables: Array<TemplateVariable> = [];

    if (customFields.status === "failed") {
      description =
        IncidentCustomFieldTemplateVariablesCopy.customFieldsUnavailable;
    } else if (customFields.status === "loaded") {
      if (customFields.rows.length === 0) {
        description = IncidentCustomFieldTemplateVariablesCopy.noCustomFields;
      }

      variables = customFields.rows.map(
        (row: IncidentCustomFieldTemplateVariableRow): TemplateVariable => {
          return {
            name: row.variableName,
            // The field's name, as a project member typed it.
            description: row.name,
            isDescriptionVerbatim: true,
          };
        },
      );
    }

    return [
      incident,
      {
        title: NOTE_TEMPLATE_CUSTOM_FIELDS_GROUP_TITLE,
        description: description,
        variables: variables,
      },
    ];
  };

export interface IncidentNoteTemplateVariables {
  groups: TemplateVariableGroups;
  // The first line of the open list: what the variables are filled with.
  description: string;
}

/**
 * The note field's variables, with the project's custom fields read once
 * the form is shown.
 */
const useIncidentNoteTemplateVariables: () => IncidentNoteTemplateVariables =
  (): IncidentNoteTemplateVariables => {
    const [customFields, setCustomFields] =
      useState<IncidentNoteTemplateCustomFields>({ status: "loading" });

    useEffect(() => {
      let isCurrent: boolean = true;

      fetchIncidentCustomFieldTemplateVariables()
        .then((rows: Array<IncidentCustomFieldTemplateVariableRow>) => {
          if (isCurrent) {
            setCustomFields({ status: "loaded", rows: rows });
          }
        })
        .catch(() => {
          if (isCurrent) {
            setCustomFields({ status: "failed" });
          }
        });

      return () => {
        isCurrent = false;
      };
    }, []);

    const groups: TemplateVariableGroups = useMemo(() => {
      return getIncidentNoteTemplateVariableGroups(customFields);
    }, [customFields]);

    return {
      groups: groups,
      description: IncidentCustomFieldsCopy.noteTemplateVariablesIntro,
    };
  };

export default useIncidentNoteTemplateVariables;
