import Dictionary from "../Dictionary";
import { Argument, ComponentInputType } from "./Component";

/*
 * DECLARING A RECORD FROM ONE OF ITS TEMPLATES, IN A WORKFLOW.
 *
 * A Create One step whose record can be declared from a template - Create
 * One Incident, from one of the project's incident templates - has one more
 * setting: the template, picked from the project's. With one picked, the step
 * declares the record from it the way OneUptime applies a template anywhere
 * on the server: the template fills in every field the step's JSON Object
 * leaves out, and a field the step sets wins over the template's.
 *
 * The record's own service applies it (DatabaseService.createFromTemplate;
 * IncidentService for an incident), as the step: a Project Admin of the
 * workflow's project, on its plan. So a template the step may not read, or
 * one from another project, is refused like a missing one, and the record
 * remembers which template it was declared from in a column no caller may
 * write for itself (for an incident, createdIncidentTemplateId).
 *
 * Keyed by the table of the record the step creates. Only the tables here
 * get the setting, and each has a service that applies its templates
 * (CreateFromTemplateServices.test.ts holds the two together).
 */

export const INCIDENT_TEMPLATE_ARGUMENT_ID: string = "incidentTemplateId";

interface CreateFromTemplateSetting {
  argument: Argument;
  /*
   * The column the record remembers its template in. OneUptime writes it;
   * a step that sends it in JSON Object is refused, and its run log points
   * at the setting instead (LogComponentError).
   */
  templateColumn: string;
}

const SETTINGS: Dictionary<CreateFromTemplateSetting> = {
  Incident: {
    argument: {
      id: INCIDENT_TEMPLATE_ARGUMENT_ID,
      name: "Incident Template",
      type: ComponentInputType.IncidentTemplateSelect,
      required: false,
      description:
        "Declare the incident from one of this project's incident templates. The template fills in what JSON Object leaves out: the title, description, severity, initial state, monitors and other resources, on-call policies, labels, status pages, custom fields and owners. Anything you set in JSON Object wins over the template's.",
      placeholder: "Select an incident template",
    },
    templateColumn: "createdIncidentTemplateId",
  },
};

type GetCreateFromTemplateArgumentFunction = (
  tableName: string | undefined,
) => Argument | null;

// The template setting of the Create One step of this table, if it has one.
export const getCreateFromTemplateArgument: GetCreateFromTemplateArgumentFunction =
  (tableName: string | undefined): Argument | null => {
    const setting: CreateFromTemplateSetting | undefined = tableName
      ? SETTINGS[tableName]
      : undefined;

    return setting ? { ...setting.argument } : null;
  };

type GetCreateFromTemplateColumnFunction = (
  tableName: string | undefined,
) => string | null;

// The column a record of this table remembers its template in, if any.
export const getCreateFromTemplateColumn: GetCreateFromTemplateColumnFunction =
  (tableName: string | undefined): string | null => {
    const setting: CreateFromTemplateSetting | undefined = tableName
      ? SETTINGS[tableName]
      : undefined;

    return setting ? setting.templateColumn : null;
  };

// The tables whose Create One step can declare a record from a template.
export const getCreateFromTemplateTableNames: () => Array<string> =
  (): Array<string> => {
    return Object.keys(SETTINGS).sort();
  };

type ReadTemplateIdFunction = (value: unknown) => string | null;

/*
 * The template a step's setting holds, as it was picked: the id, trimmed.
 * Null when none is picked - an empty setting, or one that is not text.
 * Whether it is a valid id is for the step to say (CreateOneBaseModel).
 */
export const readTemplateId: ReadTemplateIdFunction = (
  value: unknown,
): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed: string = value.trim();

  return trimmed ? trimmed : null;
};
