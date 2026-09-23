import "@testing-library/jest-dom";
import React, { ReactElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import FormField from "../../../../UI/Components/Forms/Fields/FormField";
import Field from "../../../../UI/Components/Forms/Types/Field";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { JSONObject } from "../../../../Types/JSON";

/*
 * Every other field type draws its title and description through FieldLabel,
 * which looks them up in the active locale. A Checkbox skips FieldLabel - the
 * box draws its own label beside it - and FormField used to hand it the raw
 * English strings, so the locale entries for checkbox titles and descriptions
 * were never shown to anyone reading the dashboard in another language.
 *
 * The German values are the shipped ones, copied from
 * App/FeatureSet/Dashboard/src/Locales/de.json; the keys are the English
 * source text, exactly as those locale files key them.
 *
 * The instance reaches the component through I18nextProvider only. Adding
 * .use(initReactI18next) would install it as react-i18next's global instance
 * and leak German into every other test that shares this worker.
 */

const GERMAN_TRANSLATIONS: Record<string, string> = {
  "Notify Status Page Subscribers": "Statusseiten-Abonnenten benachrichtigen",
  "Should status page subscribers be notified?":
    "Sollen Abonnenten der Statusseite benachrichtigt werden?",
};

const german: i18n = createInstance();

beforeAll(async () => {
  await german.init({
    lng: "de",
    resources: { de: { translation: GERMAN_TRANSLATIONS } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

interface TestEntity extends JSONObject {
  shouldStatusPageSubscribersBeNotified?: boolean;
}

type RenderFieldFunction = (overrides?: Partial<Field<TestEntity>>) => void;

const renderFieldInGerman: RenderFieldFunction = (
  overrides?: Partial<Field<TestEntity>>,
): void => {
  const field: Field<TestEntity> = {
    title: "Notify Status Page Subscribers",
    description: "Should status page subscribers be notified?",
    field: { shouldStatusPageSubscribersBeNotified: true },
    fieldType: FormFieldSchemaType.Checkbox,
    ...overrides,
  };

  render(
    <I18nextProvider i18n={german}>
      <FormField<TestEntity>
        field={field}
        fieldName="shouldStatusPageSubscribersBeNotified"
        index={0}
        isDisabled={false}
        error=""
        touched={false}
        currentValues={{} as FormValues<TestEntity>}
        setFieldTouched={() => {}}
        setFieldValue={() => {}}
      />
    </I18nextProvider>,
  );
};

describe("FormField - a Checkbox field in German", () => {
  test("the title beside the box is translated", () => {
    renderFieldInGerman();

    expect(
      screen.getByText("Statusseiten-Abonnenten benachrichtigen"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Notify Status Page Subscribers")).toBeNull();
  });

  test("the description under the title is translated", () => {
    renderFieldInGerman();

    expect(
      screen.getByText(
        "Sollen Abonnenten der Statusseite benachrichtigt werden?",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Should status page subscribers be notified?"),
    ).toBeNull();
  });

  /*
   * The label and description are wired to the input, so a screen reader
   * announces the translated text too - not only the sighted reader.
   */
  test("the box is named and described in German", () => {
    renderFieldInGerman();

    const checkbox: HTMLElement = screen.getByRole("checkbox", {
      name: "Statusseiten-Abonnenten benachrichtigen",
    });

    expect(checkbox).toHaveAccessibleDescription(
      "Sollen Abonnenten der Statusseite benachrichtigt werden?",
    );
  });

  test("a title with no German entry yet stays in English", () => {
    renderFieldInGerman({
      title: "Notify Monitor Owners",
      description: "Should monitor owners be notified?",
    });

    expect(
      screen.getByRole("checkbox", { name: "Notify Monitor Owners" }),
    ).toHaveAccessibleDescription("Should monitor owners be notified?");
  });

  test("a description given as an element is rendered untouched", () => {
    renderFieldInGerman({
      description: (
        <span data-testid="element-description">
          Should status page subscribers be notified?
        </span>
      ),
    });

    expect(screen.getByTestId("element-description")).toHaveTextContent(
      "Should status page subscribers be notified?",
    );
    expect(
      screen.getByText("Statusseiten-Abonnenten benachrichtigen"),
    ).toBeInTheDocument();
  });

  test("a checkbox with an empty description renders no description", () => {
    renderFieldInGerman({ description: "" });

    expect(
      screen.getByRole("checkbox", {
        name: "Statusseiten-Abonnenten benachrichtigen",
      }),
    ).not.toHaveAttribute("aria-describedby");
  });

  /*
   * A Toggle is the other boolean field. It never had this gap - it keeps
   * FieldLabel - and this pins that down so the two stay consistent. The
   * name is matched as a prefix because FieldLabel appends "(Optional)".
   */
  test("a Toggle field with the same strings is translated the same way", () => {
    renderFieldInGerman({ fieldType: FormFieldSchemaType.Toggle });

    expect(
      screen.getByRole("switch", {
        name: /^Statusseiten-Abonnenten benachrichtigen/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Sollen Abonnenten der Statusseite benachrichtigt werden?",
      ),
    ).toBeInTheDocument();
  });
});

describe("BasicForm - a Checkbox field in German", () => {
  test("the form's checkbox shows its translated title and description", () => {
    const fields: Fields<TestEntity> = [
      {
        title: "Notify Status Page Subscribers",
        description: "Should status page subscribers be notified?",
        field: { shouldStatusPageSubscribersBeNotified: true },
        fieldType: FormFieldSchemaType.Checkbox,
      },
    ];

    const form: ReactElement = (
      <BasicForm
        id="notify-subscribers-form"
        fields={fields}
        onSubmit={() => {}}
        submitButtonText="Save"
      />
    );

    render(<I18nextProvider i18n={german}>{form}</I18nextProvider>);

    expect(
      screen.getByRole("checkbox", {
        name: "Statusseiten-Abonnenten benachrichtigen",
      }),
    ).toHaveAccessibleDescription(
      "Sollen Abonnenten der Statusseite benachrichtigt werden?",
    );
    expect(screen.queryByText("Notify Status Page Subscribers")).toBeNull();
  });
});
