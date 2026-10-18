import "@testing-library/jest-dom";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import FormField from "../../../../UI/Components/Forms/Fields/FormField";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { JSONObject } from "../../../../Types/JSON";

/*
 * A multi-select whose records carry labels - an on-call rule's On-Call
 * Duty Policies - draws a "Select items by Labels" link after its
 * description. That description reached the label inside an element, and
 * the label looks up only a plain string: so beside a translated link the
 * description stayed English in every language ("The on-call policies to
 * page when this rule matches." on a German form). It is looked up like
 * any other field's description now.
 */

const DESCRIPTION: string =
  "The on-call policies to page when this rule matches.";

const GERMAN: Record<string, string> = {
  [DESCRIPTION]:
    "Die Bereitschaftsrichtlinien, über die alarmiert wird, wenn diese Regel zutrifft.",
  "Select items by {{column}}": "Elemente nach {{column}} auswählen",
  Labels: "Beschriftungen",
  "On-Call Duty Policies": "Bereitschaftsrichtlinien",
};

const german: i18n = createInstance();

beforeAll(async () => {
  await german.init({
    lng: "de",
    resources: { de: { translation: GERMAN } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

interface TestEntity extends JSONObject {
  onCallDutyPolicies?: Array<string>;
}

function policiesField(withLabelsLink: boolean): Field<TestEntity> {
  return {
    title: "On-Call Duty Policies",
    field: { onCallDutyPolicies: true },
    fieldType: FormFieldSchemaType.MultiSelectDropdown,
    description: DESCRIPTION,
    dropdownOptions: [
      { label: "Platform on-call", value: "policy-1" },
      { label: "Database on-call", value: "policy-2" },
    ],
    ...(withLabelsLink
      ? {
          selectByAccessControlProps: {
            categoryCheckboxProps: { categories: [], options: [] },
            accessControlColumnTitle: "Labels",
          },
        }
      : {}),
  };
}

function renderField(data: {
  withLabelsLink: boolean;
  inGerman: boolean;
}): void {
  const element: React.ReactElement = (
    <FormField<TestEntity>
      field={policiesField(data.withLabelsLink)}
      fieldName="onCallDutyPolicies"
      index={0}
      isDisabled={false}
      error=""
      touched={false}
      currentValues={{} as FormValues<TestEntity>}
      setFieldTouched={() => {}}
      setFieldValue={() => {}}
    />
  );

  render(
    data.inGerman ? (
      <I18nextProvider i18n={german}>{element}</I18nextProvider>
    ) : (
      element
    ),
  );
}

describe("a multi-select's description beside its Select items by link", () => {
  test("is in the reader's language, as the link beside it is", () => {
    renderField({ withLabelsLink: true, inGerman: true });

    expect(
      screen.getByText(
        "Die Bereitschaftsrichtlinien, über die alarmiert wird, wenn diese Regel zutrifft.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(DESCRIPTION)).not.toBeInTheDocument();
    expect(
      screen.getByText("Elemente nach Beschriftungen auswählen"),
    ).toBeInTheDocument();
  });

  test("reads the same as without the link", () => {
    renderField({ withLabelsLink: false, inGerman: true });

    expect(
      screen.getByText(
        "Die Bereitschaftsrichtlinien, über die alarmiert wird, wenn diese Regel zutrifft.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Elemente nach Beschriftungen auswählen"),
    ).not.toBeInTheDocument();
  });

  test("in English, is the description followed by the link, as before", () => {
    renderField({ withLabelsLink: true, inGerman: false });

    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument();
    expect(screen.getByText("Select items by Labels")).toBeInTheDocument();
  });
});
