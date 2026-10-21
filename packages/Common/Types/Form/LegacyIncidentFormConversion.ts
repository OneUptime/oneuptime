import ObjectID from "../ObjectID";
import {
  createCustomFieldField,
  createSubmitterField,
  createTargetField,
  FormField,
  FormSubmitterField,
} from "./FormField";
import {
  FormTargetFieldDefinition,
  getFormTargetField,
} from "./FormTargetCatalog";
import { IncidentFormTargetSettings } from "./FormTargetSettings";
import FormTargetType from "./FormTargetType";

/*
 * Forms replaced incident forms (Incidents > Settings > Forms), which asked a
 * fixed set of questions: a title, a description (Required, Optional or
 * Hidden), a severity when the reporter could choose one, the incident
 * custom fields the form listed as Required or Optional, and the reporter's
 * name and email (required unless the form allowed anonymous reports). The
 * migration that moves them (MigrateIncidentFormsToForms) turns each one
 * into a form that asks exactly the same, in the same order, and creates
 * incidents exactly as it did: from the same severity and template.
 *
 * Pure, with no database or React imports, so the conversion is tested on
 * its own; the migration only reads the rows and writes what this returns.
 */

// One incident form row, as the migration reads it.
export interface LegacyIncidentFormRow {
  name?: unknown;
  descriptionSetting?: unknown;
  allowReporterToChooseSeverity?: unknown;
  incidentSeverityId?: unknown;
  incidentTemplateId?: unknown;
  customFieldSettings?: unknown;
  isReporterDetailsRequired?: unknown;
}

// One of the project's incident custom fields, as the migration reads it.
export interface LegacyIncidentCustomFieldRow {
  _id?: unknown;
  name?: unknown;
  description?: unknown;
  variableKey?: unknown;
  sortOrder?: unknown;
}

export interface ConvertedLegacyIncidentForm {
  fields: Array<FormField>;
  targetSettings: IncidentFormTargetSettings;
}

type DefinitionFunction = (key: string) => FormTargetFieldDefinition;

const definition: DefinitionFunction = (
  key: string,
): FormTargetFieldDefinition => {
  return getFormTargetField(FormTargetType.Incident, key)!;
};

type ReadIdFunction = (value: unknown) => string | undefined;

const readId: ReadIdFunction = (value: unknown): string | undefined => {
  const id: string =
    value === null || value === undefined
      ? ""
      : String(value).trim().toLowerCase();

  return ObjectID.isValidUUID(id) ? id : undefined;
};

type ReadSettingsFunction = (value: unknown) => Record<string, unknown>;

// The stored custom field settings: a JSON object, or JSON text of one.
const readSettings: ReadSettingsFunction = (
  value: unknown,
): Record<string, unknown> => {
  let parsed: unknown = value;

  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return {};
    }
  }

  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
};

type CompareFieldsFunction = (
  a: LegacyIncidentCustomFieldRow,
  b: LegacyIncidentCustomFieldRow,
) => number;

/*
 * The order the old form asked its custom fields in: by Sort Order, fields
 * without one last, and by id among equals - the database's tie order.
 */
const compareFields: CompareFieldsFunction = (
  a: LegacyIncidentCustomFieldRow,
  b: LegacyIncidentCustomFieldRow,
): number => {
  const orderA: number =
    typeof a.sortOrder === "number" && Number.isFinite(a.sortOrder)
      ? a.sortOrder
      : Number.POSITIVE_INFINITY;
  const orderB: number =
    typeof b.sortOrder === "number" && Number.isFinite(b.sortOrder)
      ? b.sortOrder
      : Number.POSITIVE_INFINITY;

  if (orderA !== orderB) {
    return orderA < orderB ? -1 : 1;
  }

  const idA: string = String(a._id || "");
  const idB: string = String(b._id || "");

  return idA < idB ? -1 : idA > idB ? 1 : 0;
};

export type ConvertLegacyIncidentFormFunction = (data: {
  form: LegacyIncidentFormRow;
  // The project's incident custom fields.
  customFields: Array<LegacyIncidentCustomFieldRow>;
  // Makes each question's id; the migration passes a uuid generator.
  generateId: () => string;
}) => ConvertedLegacyIncidentForm;

/**
 * The questions and On Submit settings of the form an incident form
 * becomes:
 *
 *   1. Title - always asked, required;
 *   2. Description - unless it was Hidden, required when it was Required;
 *   3. Severity - when the reporter could choose one, optional (left empty,
 *      the form's own severity applies), offering every severity;
 *   4. each custom field the form listed as Required or Optional, in the
 *      project's order, required when it was Required (a field deleted
 *      since, or not listed, is not asked);
 *   5. Your Name and Your Email - required unless anonymous reports were
 *      allowed.
 *
 * The severity and template become the On Submit settings.
 */
export const convertLegacyIncidentForm: ConvertLegacyIncidentFormFunction =
  (data: {
    form: LegacyIncidentFormRow;
    customFields: Array<LegacyIncidentCustomFieldRow>;
    generateId: () => string;
  }): ConvertedLegacyIncidentForm => {
    const fields: Array<FormField> = [];

    const title: FormField = createTargetField({
      definition: definition("title"),
      id: data.generateId(),
    });
    title.isRequired = true;
    fields.push(title);

    const descriptionSetting: unknown = data.form.descriptionSetting;

    if (descriptionSetting !== "Hidden") {
      const description: FormField = createTargetField({
        definition: definition("description"),
        id: data.generateId(),
      });
      description.isRequired = descriptionSetting === "Required";
      fields.push(description);
    }

    if (data.form.allowReporterToChooseSeverity === true) {
      const severity: FormField = createTargetField({
        definition: definition("incidentSeverityId"),
        id: data.generateId(),
      });
      severity.isRequired = false;
      fields.push(severity);
    }

    const settings: Record<string, unknown> = readSettings(
      data.form.customFieldSettings,
    );

    const asked: Array<LegacyIncidentCustomFieldRow> = (data.customFields || [])
      .filter((row: LegacyIncidentCustomFieldRow): boolean => {
        const key: unknown = row.variableKey;

        return (
          typeof key === "string" &&
          Object.prototype.hasOwnProperty.call(settings, key) &&
          (settings[key] === "Required" || settings[key] === "Optional") &&
          Boolean(readId(row._id)) &&
          typeof row.name === "string" &&
          row.name.length > 0
        );
      })
      .sort(compareFields);

    for (const row of asked) {
      const field: FormField = createCustomFieldField({
        customFieldId: readId(row._id)!,
        name: row.name as string,
        description:
          typeof row.description === "string" ? row.description : undefined,
        id: data.generateId(),
      });

      field.isRequired = settings[row.variableKey as string] === "Required";
      fields.push(field);
    }

    const isReporterDetailsRequired: boolean =
      data.form.isReporterDetailsRequired !== false;

    fields.push(
      createSubmitterField({
        submitterField: FormSubmitterField.Name,
        isRequired: isReporterDetailsRequired,
        id: data.generateId(),
      }),
      createSubmitterField({
        submitterField: FormSubmitterField.Email,
        isRequired: isReporterDetailsRequired,
        id: data.generateId(),
      }),
    );

    const targetSettings: IncidentFormTargetSettings = {};

    const severityId: string | undefined = readId(data.form.incidentSeverityId);

    if (severityId) {
      targetSettings.incidentSeverityId = severityId;
    }

    const templateId: string | undefined = readId(data.form.incidentTemplateId);

    if (templateId) {
      targetSettings.incidentTemplateId = templateId;
    }

    return { fields, targetSettings };
  };
