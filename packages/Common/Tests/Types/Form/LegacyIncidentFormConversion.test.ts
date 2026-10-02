import {
  FormField,
  FormFieldSource,
  FormSubmitterField,
  validateFormFields,
} from "../../../Types/Form/FormField";
import {
  ConvertedLegacyIncidentForm,
  LegacyIncidentCustomFieldRow,
  LegacyIncidentFormRow,
  convertLegacyIncidentForm,
} from "../../../Types/Form/LegacyIncidentFormConversion";
import { validateFormTargetSettings } from "../../../Types/Form/FormTargetSettings";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { describe, expect, test } from "@jest/globals";

/*
 * How an incident form becomes a form, when MigrateIncidentFormsToForms
 * moves every incident form over: the same questions, in the same order,
 * required as they were, and the same severity and template.
 *
 * What an incident form asked:
 *
 *   - a Title, always, and always required;
 *   - a Description, unless its Description Question was Hidden - required
 *     when it was Required;
 *   - a Severity, when the reporter could choose it - optional, since the
 *     form's own severity applied when none was chosen;
 *   - each custom field set to Required or Optional on its Questions card,
 *     in the custom fields' order;
 *   - Your Name and Your Email, required unless anonymous reports were on.
 */

const SEVERITY_ID: string = "11111111-1111-4111-8111-111111111111";
const TEMPLATE_ID: string = "22222222-2222-4222-8222-222222222222";
const REGION_ID: string = "33333333-3333-4333-8333-333333333333";
const IMPACT_ID: string = "44444444-4444-4444-8444-444444444444";
const CUSTOMER_ID: string = "55555555-5555-4555-8555-555555555555";
const HIDDEN_ID: string = "66666666-6666-4666-8666-666666666666";

const CUSTOM_FIELDS: Array<LegacyIncidentCustomFieldRow> = [
  {
    _id: IMPACT_ID,
    name: "Impact",
    description: "How many customers?",
    variableKey: "impact",
    sortOrder: 2,
  },
  {
    _id: REGION_ID.toUpperCase(),
    name: "Region",
    variableKey: "region",
    sortOrder: 1,
  },
  {
    _id: CUSTOMER_ID,
    name: "Customer",
    variableKey: "customer",
    sortOrder: null,
  },
  {
    _id: HIDDEN_ID,
    name: "Internal",
    variableKey: "internal",
    sortOrder: 0,
  },
];

type ConvertFunction = (
  form: LegacyIncidentFormRow,
  customFields?: Array<LegacyIncidentCustomFieldRow>,
) => ConvertedLegacyIncidentForm;

const convert: ConvertFunction = (
  form: LegacyIncidentFormRow,
  customFields: Array<LegacyIncidentCustomFieldRow> = CUSTOM_FIELDS,
): ConvertedLegacyIncidentForm => {
  let next: number = 0;

  return convertLegacyIncidentForm({
    form,
    customFields,
    generateId: (): string => {
      next++;
      return `question-${next}`;
    },
  });
};

type ShapeFunction = (fields: Array<FormField>) => Array<string>;

const shape: ShapeFunction = (fields: Array<FormField>): Array<string> => {
  return fields.map((field: FormField): string => {
    const what: string =
      field.targetField || field.submitterField || field.customFieldId || "";
    return `${field.source}:${what}:${field.isRequired ? "required" : "optional"}`;
  });
};

describe("convertLegacyIncidentForm", () => {
  test("a form with every default asks a title, a description and who is reporting", () => {
    const converted: ConvertedLegacyIncidentForm = convert({
      name: "Report a problem",
      descriptionSetting: "Optional",
      allowReporterToChooseSeverity: false,
      incidentSeverityId: SEVERITY_ID,
      isReporterDetailsRequired: true,
    });

    expect(shape(converted.fields)).toEqual([
      "TargetField:title:required",
      "TargetField:description:optional",
      "Submitter:Name:required",
      "Submitter:Email:required",
    ]);
    expect(converted.targetSettings).toEqual({
      incidentSeverityId: SEVERITY_ID,
    });
  });

  test("the questions keep the words the incident form showed", () => {
    const converted: ConvertedLegacyIncidentForm = convert({
      descriptionSetting: "Optional",
    });

    expect(converted.fields[0]).toEqual({
      id: "question-1",
      source: FormFieldSource.TargetField,
      targetField: "title",
      label: "Title",
      helpText: "A short summary of what is wrong.",
      isRequired: true,
    });
    expect(converted.fields[2]).toEqual({
      id: "question-3",
      source: FormFieldSource.Submitter,
      submitterField: FormSubmitterField.Name,
      label: "Your Name",
      isRequired: true,
    });
  });

  test("a Required description stays required, a Hidden one is not asked", () => {
    expect(shape(convert({ descriptionSetting: "Required" }).fields)[1]).toBe(
      "TargetField:description:required",
    );
    expect(
      shape(convert({ descriptionSetting: "Hidden" }).fields).some(
        (entry: string): boolean => {
          return entry.includes("description");
        },
      ),
    ).toBe(false);
  });

  test("an unknown or missing description setting reads as the old default, Optional", () => {
    for (const descriptionSetting of [undefined, null, "Banana"]) {
      expect(shape(convert({ descriptionSetting }).fields)[1]).toBe(
        "TargetField:description:optional",
      );
    }
  });

  test("a form that let the reporter choose the severity asks for it, optionally", () => {
    const converted: ConvertedLegacyIncidentForm = convert({
      allowReporterToChooseSeverity: true,
      incidentSeverityId: SEVERITY_ID,
    });

    expect(shape(converted.fields)[2]).toBe(
      "TargetField:incidentSeverityId:optional",
    );
    // Every severity is offered, as before; the form's own is the default.
    expect(converted.fields[2]!.allowedOptionIds).toBeUndefined();
    expect(converted.targetSettings.incidentSeverityId).toBe(SEVERITY_ID);
  });

  test("only a true allowReporterToChooseSeverity asks it", () => {
    expect(
      shape(convert({ allowReporterToChooseSeverity: "true" }).fields),
    ).not.toContain("TargetField:incidentSeverityId:optional");
  });

  test("custom fields set to Required or Optional, by their order, then their id", () => {
    const converted: ConvertedLegacyIncidentForm = convert({
      customFieldSettings: {
        impact: "Required",
        region: "Optional",
        customer: "Optional",
        internal: "Hidden",
        missing: "Required",
      },
    });

    expect(
      converted.fields
        .filter((field: FormField): boolean => {
          return field.source === FormFieldSource.TargetCustomField;
        })
        .map((field: FormField): string => {
          return `${field.label}:${field.customFieldId}:${field.isRequired}`;
        }),
    ).toEqual([
      `Region:${REGION_ID}:false`,
      `Impact:${IMPACT_ID}:true`,
      // No order: after the ones that have one.
      `Customer:${CUSTOMER_ID}:false`,
    ]);
  });

  test("a custom field's description becomes its help text", () => {
    const [impact]: Array<FormField> = convert({
      customFieldSettings: { impact: "Required" },
    }).fields.filter((field: FormField): boolean => {
      return field.source === FormFieldSource.TargetCustomField;
    });

    expect(impact!.helpText).toBe("How many customers?");
  });

  test("settings stored as JSON text are read too; anything unreadable asks no custom field", () => {
    expect(
      convert({
        customFieldSettings: JSON.stringify({ region: "Required" }),
      }).fields.some((field: FormField): boolean => {
        return field.customFieldId === REGION_ID;
      }),
    ).toBe(true);

    for (const customFieldSettings of [
      "{not json",
      "[]",
      7,
      null,
      ["region"],
    ]) {
      expect(
        convert({ customFieldSettings }).fields.some((field: FormField) => {
          return field.source === FormFieldSource.TargetCustomField;
        }),
      ).toBe(false);
    }
  });

  test("a custom field with no usable id or name, or a Default setting, is not asked", () => {
    const converted: ConvertedLegacyIncidentForm = convert(
      {
        customFieldSettings: {
          noid: "Required",
          noname: "Required",
          defaulted: "Default",
        },
      },
      [
        { _id: "not-a-uuid", name: "No id", variableKey: "noid" },
        { _id: REGION_ID, name: "", variableKey: "noname" },
        { _id: IMPACT_ID, name: "Defaulted", variableKey: "defaulted" },
      ],
    );

    expect(
      converted.fields.filter((field: FormField): boolean => {
        return field.source === FormFieldSource.TargetCustomField;
      }),
    ).toEqual([]);
  });

  test("anonymous reports make the reporter's details optional", () => {
    expect(
      shape(convert({ isReporterDetailsRequired: false }).fields).slice(-2),
    ).toEqual(["Submitter:Name:optional", "Submitter:Email:optional"]);
    // Anything but false keeps them required, as the column's default did.
    expect(
      shape(convert({ isReporterDetailsRequired: null }).fields).slice(-2),
    ).toEqual(["Submitter:Name:required", "Submitter:Email:required"]);
  });

  test("the severity and the template carry over, lowercased; anything else does not", () => {
    expect(
      convert({
        incidentSeverityId: SEVERITY_ID.toUpperCase(),
        incidentTemplateId: TEMPLATE_ID,
      }).targetSettings,
    ).toEqual({
      incidentSeverityId: SEVERITY_ID,
      incidentTemplateId: TEMPLATE_ID,
    });
    expect(
      convert({ incidentSeverityId: "high", incidentTemplateId: null })
        .targetSettings,
    ).toEqual({});
  });

  test("every converted form is one the server accepts", () => {
    const converted: ConvertedLegacyIncidentForm = convert({
      descriptionSetting: "Required",
      allowReporterToChooseSeverity: true,
      incidentSeverityId: SEVERITY_ID,
      incidentTemplateId: TEMPLATE_ID,
      customFieldSettings: {
        impact: "Required",
        region: "Optional",
        customer: "Optional",
      },
      isReporterDetailsRequired: false,
    });

    expect(
      validateFormFields({
        value: converted.fields,
        targetType: FormTargetType.Incident,
      }),
    ).toBeNull();
    expect(
      validateFormTargetSettings({
        value: converted.targetSettings,
        targetType: FormTargetType.Incident,
      }),
    ).toBeNull();
  });

  test("each question gets its own id, from the generator it is given", () => {
    const converted: ConvertedLegacyIncidentForm = convert({
      allowReporterToChooseSeverity: true,
      customFieldSettings: { region: "Optional" },
    });

    expect(
      converted.fields.map((field: FormField): string => {
        return field.id;
      }),
    ).toEqual([
      "question-1",
      "question-2",
      "question-3",
      "question-4",
      "question-5",
      "question-6",
    ]);
  });
});
