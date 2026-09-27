import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { ReactElement } from "react";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

import Incident from "../../../../Models/DatabaseModels/Incident";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import { JSONObject } from "../../../../Types/JSON";
import {
  buildCustomFieldFormFields,
  CustomFieldFormDefinition,
  toCustomFieldFormDefinition,
} from "../../../../UI/Components/CustomFields/CustomFieldFormFields";
import {
  buildCustomFieldModelFormFields,
  CUSTOM_FIELD_FORM_KEY_PREFIX,
  CUSTOM_FIELD_NO_VALUE_PLACEHOLDER,
  getCustomFieldFormInitialValues,
  getCustomFieldFormKey,
  isCustomFieldInherited,
  packCustomFieldFormValues,
  removeCustomFieldFormKeys,
} from "../../../../UI/Components/CustomFields/CustomFieldModelFormFields";
import { ModelField } from "../../../../UI/Components/Forms/ModelForm";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import Validation from "../../../../UI/Components/Forms/Validation";

/*
 * Custom field inputs inside a record's own create form - the Details step of
 * declaring an incident, the Custom Fields step of a new incident template.
 * What must hold:
 *
 *   - each input is held under its own form key, apart from the model's
 *     columns, and permission-checked against the `customFields` column;
 *   - "Required on create" is honoured where asked, and a required yes/no
 *     field must be ticked;
 *   - the values are packed into `customFields` from what the form holds, so
 *     0 and false survive, and a field emptied on the form is removed;
 *   - the starting values (a template's) are merged under the form's
 *     answers, never replaced by them;
 *   - the inputs never travel as misc data.
 */

afterEach(() => {
  cleanup();
});

function definition(
  overrides: Partial<CustomFieldFormDefinition> & { name: string },
): CustomFieldFormDefinition {
  return {
    customFieldType: CustomFieldType.Text,
    ...overrides,
  };
}

const IMPACT: CustomFieldFormDefinition = definition({
  name: "Impact",
  customFieldType: CustomFieldType.Dropdown,
  dropdownOptions: "Low\nMedium\nHigh",
  isRequiredOnCreate: true,
});
const DURATION: CustomFieldFormDefinition = definition({
  name: "Estimated Duration",
  customFieldType: CustomFieldType.Number,
});
const ACKNOWLEDGEMENT: CustomFieldFormDefinition = definition({
  name: "Acknowledgement",
  customFieldType: CustomFieldType.Boolean,
  isRequiredOnCreate: true,
});
// Named like one of the incident's own columns.
const TITLE_FIELD: CustomFieldFormDefinition = definition({
  name: "title",
  customFieldType: CustomFieldType.Text,
});

const DEFINITIONS: Array<CustomFieldFormDefinition> = [
  IMPACT,
  DURATION,
  ACKNOWLEDGEMENT,
  TITLE_FIELD,
];

function key(name: string): string {
  return getCustomFieldFormKey(name);
}

function fieldFor(
  fields: Array<ModelField<Incident>>,
  name: string,
): ModelField<Incident> {
  const field: ModelField<Incident> | undefined = fields.find(
    (candidate: ModelField<Incident>) => {
      return candidate.overrideFieldKey === key(name);
    },
  );

  if (!field) {
    throw new Error(`No input for ${name}`);
  }

  return field;
}

describe("the form key", () => {
  test("keeps a field's value apart from the model's columns", () => {
    expect(getCustomFieldFormKey("title")).toBe("customFields:title");
    expect(getCustomFieldFormKey("title")).not.toBe("title");
    expect(CUSTOM_FIELD_FORM_KEY_PREFIX).toBe("customFields:");
  });
});

describe("buildCustomFieldModelFormFields", () => {
  test("one input per definition, in the order given", () => {
    const fields: Array<ModelField<Incident>> =
      buildCustomFieldModelFormFields<Incident>({ definitions: DEFINITIONS });

    expect(
      fields.map((field: ModelField<Incident>) => {
        return field.overrideFieldKey;
      }),
    ).toEqual([
      key("Impact"),
      key("Estimated Duration"),
      key("Acknowledgement"),
      key("title"),
    ]);
  });

  test("each input is checked against the customFields column, not a column of its own name", () => {
    const fields: Array<ModelField<Incident>> =
      buildCustomFieldModelFormFields<Incident>({ definitions: DEFINITIONS });

    for (const field of fields) {
      expect(field.field).toBeUndefined();
      expect(field.overrideField).toEqual({ customFields: true });
    }
  });

  test("is built by the shared builder: the same title, type, options and description", () => {
    const shared: Array<Field<JSONObject>> = buildCustomFieldFormFields({
      definitions: [{ ...IMPACT, description: "How bad is it?" }],
    });
    const built: ModelField<Incident> =
      buildCustomFieldModelFormFields<Incident>({
        definitions: [{ ...IMPACT, description: "How bad is it?" }],
      })[0]!;

    expect(built.title).toBe(shared[0]!.title);
    expect(built.fieldType).toBe(shared[0]!.fieldType);
    expect(built.dropdownOptions).toEqual(shared[0]!.dropdownOptions);
    expect(built.description).toBe("How bad is it?");
  });

  test("puts every input on the step given", () => {
    const fields: Array<ModelField<Incident>> =
      buildCustomFieldModelFormFields<Incident>({
        definitions: DEFINITIONS,
        stepId: "details",
      });

    for (const field of fields) {
      expect(field.stepId).toBe("details");
    }
  });

  test("required only where asked, and only for fields marked Required on create", () => {
    const optional: Array<ModelField<Incident>> =
      buildCustomFieldModelFormFields<Incident>({ definitions: DEFINITIONS });
    const required: Array<ModelField<Incident>> =
      buildCustomFieldModelFormFields<Incident>({
        definitions: DEFINITIONS,
        enforceRequiredOnCreate: true,
      });

    expect(fieldFor(optional, "Impact").required).toBe(false);
    expect(fieldFor(required, "Impact").required).toBe(true);
    expect(fieldFor(required, "Estimated Duration").required).toBe(false);
  });

  test("a required acknowledgement must be ticked, read from its form key", () => {
    const acknowledgement: ModelField<Incident> = {
      ...fieldFor(
        buildCustomFieldModelFormFields<Incident>({
          definitions: DEFINITIONS,
          enforceRequiredOnCreate: true,
        }),
        "Acknowledgement",
      ),
      name: key("Acknowledgement"),
    };

    const validate: (values: JSONObject) => Record<string, string> = (
      values: JSONObject,
    ): Record<string, string> => {
      return Validation.validate<JSONObject>({
        formFields: [acknowledgement as unknown as Field<JSONObject>],
        values: values as FormValues<JSONObject>,
        onValidate: undefined,
      });
    };

    // Unticked: the form holds false, which `required` alone lets through.
    expect(
      validate({ [key("Acknowledgement")]: false })[key("Acknowledgement")],
    ).toBe("Acknowledgement must be checked.");
    // Never touched.
    expect(validate({})[key("Acknowledgement")]).toBeDefined();
    // Ticked.
    expect(
      validate({ [key("Acknowledgement")]: true })[key("Acknowledgement")],
    ).toBeUndefined();
    // A value under the bare name is not this input's value.
    expect(
      validate({ Acknowledgement: true, [key("Acknowledgement")]: false })[
        key("Acknowledgement")
      ],
    ).toBe("Acknowledgement must be checked.");
  });

  test("a field not shown is not asked, and not validated", () => {
    const fields: Array<ModelField<Incident>> =
      buildCustomFieldModelFormFields<Incident>({
        definitions: DEFINITIONS,
        enforceRequiredOnCreate: true,
        isShown: (field: CustomFieldFormDefinition, values: JSONObject) => {
          return !(field.name === "Impact" && values["hideImpact"] === true);
        },
      });

    const impact: ModelField<Incident> = {
      ...fieldFor(fields, "Impact"),
      name: key("Impact"),
    };

    expect(impact.showIf!({} as FormValues<Incident>)).toBe(true);
    expect(
      impact.showIf!({ hideImpact: true } as unknown as FormValues<Incident>),
    ).toBe(false);

    expect(
      Validation.validate<JSONObject>({
        formFields: [impact as unknown as Field<JSONObject>],
        values: { hideImpact: true } as FormValues<JSONObject>,
        onValidate: undefined,
      })[key("Impact")],
    ).toBeUndefined();
  });

  test("without isShown, every input is always shown", () => {
    for (const field of buildCustomFieldModelFormFields<Incident>({
      definitions: DEFINITIONS,
    })) {
      expect(field.showIf).toBeUndefined();
    }
  });

  describe("the review step", () => {
    function renderSummary(name: string, values: JSONObject): void {
      const field: ModelField<Incident> = fieldFor(
        buildCustomFieldModelFormFields<Incident>({ definitions: DEFINITIONS }),
        name,
      );

      render(
        field.getSummaryElement!(
          values as unknown as FormValues<Incident>,
        ) as ReactElement,
      );
    }

    test("shows the option picked", () => {
      renderSummary("Impact", { [key("Impact")]: "High" });

      expect(screen.getByText("High")).toBeInTheDocument();
    });

    test("shows 0, not an empty field", () => {
      renderSummary("Estimated Duration", { [key("Estimated Duration")]: 0 });

      expect(screen.getByText("0")).toBeInTheDocument();
    });

    test("shows an unticked box as No", () => {
      renderSummary("Acknowledgement", { [key("Acknowledgement")]: false });

      expect(screen.getByText("No")).toBeInTheDocument();
    });

    test("says when a field was left empty", () => {
      renderSummary("title", {});

      expect(
        screen.getByText(CUSTOM_FIELD_NO_VALUE_PLACEHOLDER),
      ).toBeInTheDocument();
    });

    test("reads the input's own value, not a column of the same name", () => {
      renderSummary("title", {
        title: "The incident's title",
        [key("title")]: "The field's value",
      });

      expect(screen.getByText("The field's value")).toBeInTheDocument();
      expect(screen.queryByText("The incident's title")).toBeNull();
    });
  });
});

describe("getCustomFieldFormInitialValues", () => {
  test("puts the starting values under the form keys", () => {
    expect(
      getCustomFieldFormInitialValues({
        definitions: DEFINITIONS,
        customFields: {
          Impact: "High",
          "Estimated Duration": 0,
          Acknowledgement: false,
          Unrelated: "x",
        },
      }),
    ).toEqual({
      [key("Impact")]: "High",
      [key("Estimated Duration")]: 0,
      [key("Acknowledgement")]: false,
    });
  });

  test("skips empty values, and anything but a bag", () => {
    expect(
      getCustomFieldFormInitialValues({
        definitions: DEFINITIONS,
        customFields: { Impact: "", "Estimated Duration": null },
      }),
    ).toEqual({});

    for (const customFields of [undefined, null, "x", ["High"]]) {
      expect(
        getCustomFieldFormInitialValues({
          definitions: DEFINITIONS,
          customFields: customFields,
        }),
      ).toEqual({});
    }
  });
});

describe("packCustomFieldFormValues", () => {
  test("0 and false survive", () => {
    expect(
      packCustomFieldFormValues({
        definitions: DEFINITIONS,
        formValues: {
          [key("Estimated Duration")]: 0,
          [key("Acknowledgement")]: false,
        },
      }),
    ).toEqual({ "Estimated Duration": 0, Acknowledgement: false });
  });

  test('a number typed as text is kept as typed, "0" included', () => {
    expect(
      packCustomFieldFormValues({
        definitions: DEFINITIONS,
        formValues: { [key("Estimated Duration")]: "0" },
      }),
    ).toEqual({ "Estimated Duration": "0" });
  });

  test("merges over the starting values, never replacing them", () => {
    expect(
      packCustomFieldFormValues({
        definitions: [IMPACT, DURATION],
        formValues: { [key("Impact")]: "Low" },
        startingCustomFields: {
          Impact: "High",
          Category: "Network",
        },
      }),
    ).toEqual({ Impact: "Low", Category: "Network" });
  });

  test("a starting value the form never held is kept", () => {
    expect(
      packCustomFieldFormValues({
        definitions: [IMPACT, DURATION],
        formValues: {},
        startingCustomFields: { "Estimated Duration": 30 },
      }),
    ).toEqual({ "Estimated Duration": 30 });
  });

  test("a field emptied on the form is removed, template value and all", () => {
    for (const emptied of ["", null, undefined, []]) {
      expect(
        packCustomFieldFormValues({
          definitions: [IMPACT],
          formValues: { [key("Impact")]: emptied },
          startingCustomFields: { Impact: "High", Category: "Network" },
        }),
      ).toEqual({ Category: "Network" });
    }
  });

  test("a field the form did not show keeps its starting value", () => {
    expect(
      packCustomFieldFormValues({
        definitions: [IMPACT],
        formValues: { [key("Impact")]: "Low", monitors: ["m1"] },
        startingCustomFields: { Impact: "High" },
        isShown: (_field: CustomFieldFormDefinition, values: JSONObject) => {
          return !values["monitors"];
        },
      }),
    ).toEqual({ Impact: "High" });
  });

  test("a dropdown still holding its option object stores the option's value", () => {
    expect(
      packCustomFieldFormValues({
        definitions: [
          IMPACT,
          definition({
            name: "Regions",
            customFieldType: CustomFieldType.MultiSelectDropdown,
          }),
        ],
        formValues: {
          [key("Impact")]: { label: "High", value: "High" },
          [key("Regions")]: [
            { label: "East", value: "East" },
            { label: "West", value: "West" },
          ],
        },
      }),
    ).toEqual({ Impact: "High", Regions: ["East", "West"] });
  });

  test("reads the form keys only, never a column of the same name", () => {
    expect(
      packCustomFieldFormValues({
        definitions: [TITLE_FIELD],
        formValues: { title: "The incident's title" },
      }),
    ).toBeUndefined();

    expect(
      packCustomFieldFormValues({
        definitions: [TITLE_FIELD],
        formValues: {
          title: "The incident's title",
          [key("title")]: "The field's value",
        },
      }),
    ).toEqual({ title: "The field's value" });
  });

  test("nothing to store is undefined, not an empty bag", () => {
    expect(
      packCustomFieldFormValues({
        definitions: DEFINITIONS,
        formValues: {},
      }),
    ).toBeUndefined();
    expect(
      packCustomFieldFormValues({
        definitions: DEFINITIONS,
        formValues: undefined,
        startingCustomFields: "not a bag",
      }),
    ).toBeUndefined();
  });

  test("never changes the starting values it was given", () => {
    const starting: JSONObject = { Impact: "High" };

    packCustomFieldFormValues({
      definitions: [IMPACT],
      formValues: { [key("Impact")]: "" },
      startingCustomFields: starting,
    });

    expect(starting).toEqual({ Impact: "High" });
  });
});

describe("removeCustomFieldFormKeys", () => {
  test("takes the inputs out of the misc data, and nothing else", () => {
    const miscDataProps: JSONObject = {
      [key("Impact")]: "High",
      [key("Acknowledgement")]: true,
      incidentRoles: ["r1"],
      alertIdsToLink: ["a1"],
    };

    removeCustomFieldFormKeys(miscDataProps);

    expect(miscDataProps).toEqual({
      incidentRoles: ["r1"],
      alertIdsToLink: ["a1"],
    });
  });
});

describe("isCustomFieldInherited", () => {
  const MAPPED: CustomFieldFormDefinition = definition({
    name: "Impact",
    mapFromResourceType: "Monitor",
    mapFromCustomFieldName: "Impact",
  });

  test("a field mapped from a monitor field, on an incident with a monitor", () => {
    expect(
      isCustomFieldInherited({
        definitionTableName: "IncidentCustomField",
        definition: MAPPED,
        values: { monitors: ["m1"] },
      }),
    ).toBe(true);
  });

  test("not while the incident has no monitor", () => {
    for (const monitors of [undefined, []]) {
      expect(
        isCustomFieldInherited({
          definitionTableName: "IncidentCustomField",
          definition: MAPPED,
          values: { monitors: monitors },
        }),
      ).toBe(false);
    }
  });

  test("not for a field that is not mapped", () => {
    expect(
      isCustomFieldInherited({
        definitionTableName: "IncidentCustomField",
        definition: definition({ name: "Impact" }),
        values: { monitors: ["m1"] },
      }),
    ).toBe(false);
  });

  test("not for a mapping from a resource this record cannot inherit from", () => {
    expect(
      isCustomFieldInherited({
        definitionTableName: "IncidentCustomField",
        definition: { ...MAPPED, mapFromResourceType: "NotAResource" },
        values: { monitors: ["m1"] },
      }),
    ).toBe(false);
  });

  test("toCustomFieldFormDefinition reads the mapping off a definition row", () => {
    expect(
      toCustomFieldFormDefinition({
        name: "Impact",
        mapFromResourceType: "Monitor",
        mapFromCustomFieldName: "Business Impact",
      }),
    ).toMatchObject({
      mapFromResourceType: "Monitor",
      mapFromCustomFieldName: "Business Impact",
    });

    const unmapped: CustomFieldFormDefinition | null =
      toCustomFieldFormDefinition({
        name: "Impact",
        mapFromResourceType: "",
        mapFromCustomFieldName: null,
      });

    expect(unmapped?.mapFromResourceType).toBeUndefined();
    expect(unmapped?.mapFromCustomFieldName).toBeUndefined();
  });
});
