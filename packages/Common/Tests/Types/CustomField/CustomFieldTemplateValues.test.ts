import { CustomFieldDefinition } from "../../../Types/CustomField/CustomFieldDefinition";
import mergeTemplateCustomFieldsDefault, {
  mergeTemplateCustomFields,
} from "../../../Types/CustomField/CustomFieldTemplateMerge";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { keepValidCustomFieldValues } from "../../../Types/CustomField/CustomFieldValueValidator";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * An incident template's custom field values reach a new incident in two
 * places: the server copies them when an incident is created with
 * `createdIncidentTemplateId` (mergeTemplateCustomFields), and the dashboard
 * starts the Create page from them (keepValidCustomFieldValues drops the
 * stale ones first). Both merge into what the incident is given; neither
 * ever replaces it.
 */

describe("mergeTemplateCustomFields", () => {
  test("the template fills in the fields the incident does not set", () => {
    expect(
      mergeTemplateCustomFields({
        templateCustomFields: { Impact: "High", Category: "Network" },
        customFields: { Ticket: "OPS-7" },
      }),
    ).toEqual({ Impact: "High", Category: "Network", Ticket: "OPS-7" });
  });

  test("a value the incident sets always wins", () => {
    expect(
      mergeTemplateCustomFields({
        templateCustomFields: { Impact: "High", Category: "Network" },
        customFields: { Impact: "Low" },
      }),
    ).toEqual({ Impact: "Low", Category: "Network" });
  });

  test("0, false, null and empty from the incident are answers, not gaps", () => {
    expect(
      mergeTemplateCustomFields({
        templateCustomFields: {
          Count: 5,
          Acknowledged: true,
          Impact: "High",
          Notes: "From the template",
        },
        customFields: {
          Count: 0,
          Acknowledged: false,
          Impact: null,
          Notes: "",
        },
      }),
    ).toEqual({ Count: 0, Acknowledged: false, Impact: null, Notes: "" });
  });

  test("an incident with no custom fields gets the template's", () => {
    for (const customFields of [undefined, null]) {
      expect(
        mergeTemplateCustomFields({
          templateCustomFields: { Impact: "High" },
          customFields: customFields,
        }),
      ).toEqual({ Impact: "High" });
    }
  });

  test("a template with no values changes nothing", () => {
    for (const templateCustomFields of [undefined, null, {}, "x", [1]]) {
      expect(
        mergeTemplateCustomFields({
          templateCustomFields: templateCustomFields,
          customFields: { Ticket: "OPS-7" },
        }),
      ).toBeUndefined();
    }
  });

  test("custom fields that are not a bag are left exactly as sent", () => {
    for (const customFields of ["High", 7, ["a"]]) {
      expect(
        mergeTemplateCustomFields({
          templateCustomFields: { Impact: "High" },
          customFields: customFields,
        }),
      ).toBeUndefined();
    }
  });

  test("returns a new bag, leaving both inputs untouched", () => {
    const template: JSONObject = { Impact: "High" };
    const incident: JSONObject = { Ticket: "OPS-7" };

    const merged: JSONObject | undefined = mergeTemplateCustomFields({
      templateCustomFields: template,
      customFields: incident,
    });

    expect(merged).not.toBe(template);
    expect(merged).not.toBe(incident);
    expect(template).toEqual({ Impact: "High" });
    expect(incident).toEqual({ Ticket: "OPS-7" });
  });

  test("is the module's default export", () => {
    expect(mergeTemplateCustomFieldsDefault).toBe(mergeTemplateCustomFields);
  });
});

describe("keepValidCustomFieldValues", () => {
  const DEFINITIONS: Array<CustomFieldDefinition> = [
    {
      name: "Impact",
      customFieldType: CustomFieldType.Dropdown,
      dropdownOptions: "Low\nMedium\nHigh",
    },
    { name: "Estimated Duration", customFieldType: CustomFieldType.Number },
    { name: "Acknowledgement", customFieldType: CustomFieldType.Boolean },
    {
      name: "Regions",
      customFieldType: CustomFieldType.MultiSelectDropdown,
      dropdownOptions: "East\nWest",
    },
  ];

  test("keeps every value that still fits its field", () => {
    expect(
      keepValidCustomFieldValues({
        definitions: DEFINITIONS,
        customFields: {
          Impact: "High",
          "Estimated Duration": "0",
          Acknowledgement: false,
          Regions: ["East"],
        },
      }),
    ).toEqual({
      Impact: "High",
      "Estimated Duration": "0",
      Acknowledgement: false,
      Regions: ["East"],
    });
  });

  test("drops an option removed from a dropdown since the template was saved", () => {
    expect(
      keepValidCustomFieldValues({
        definitions: DEFINITIONS,
        customFields: { Impact: "Critical", Regions: ["East", "North"] },
      }),
    ).toEqual({});
  });

  test("drops a value of the wrong kind", () => {
    expect(
      keepValidCustomFieldValues({
        definitions: DEFINITIONS,
        customFields: {
          "Estimated Duration": "about an hour",
          Acknowledgement: "maybe",
          Impact: "Low",
        },
      }),
    ).toEqual({ Impact: "Low" });
  });

  test("keeps keys with no definition, and empty values", () => {
    expect(
      keepValidCustomFieldValues({
        definitions: DEFINITIONS,
        customFields: { "Deleted Field": "x", Impact: "" },
      }),
    ).toEqual({ "Deleted Field": "x", Impact: "" });
  });

  test("anything but a bag gives an empty bag", () => {
    for (const customFields of [undefined, null, "x", [1]]) {
      expect(
        keepValidCustomFieldValues({
          definitions: DEFINITIONS,
          customFields: customFields,
        }),
      ).toEqual({});
    }
  });
});
