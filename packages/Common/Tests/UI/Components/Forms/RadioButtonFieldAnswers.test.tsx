import "@testing-library/jest-dom";
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import BasicModelForm from "../../../../UI/Components/Forms/BasicModelForm";
import FormField from "../../../../UI/Components/Forms/Fields/FormField";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import IncidentReminderRule from "../../../../Models/DatabaseModels/IncidentReminderRule";
import ReminderStopState from "../../../../Types/Reminder/ReminderStopState";
import { JSONObject } from "../../../../Types/JSON";
import getJestMockFunction from "../../../../Tests/MockType";

/*
 * A choice drawn as radio answers (FormFieldSchemaType.RadioButton) - a
 * reminder rule's "Stop Reminders When: Resolved / Acknowledged".
 *
 * The field handed Radio each answer's title only: an answer's own line,
 * which Radio can draw under it, was dropped, and the title was drawn in
 * English in every language while every other control on the form was
 * translated. Each answer now says, in the reader's language, what picking
 * it means.
 *
 * And the line under the field's title: a field with no description of its
 * own shows its column's, which is written for the API - on this choice a
 * sentence about both answers, over the answers' own lines. A field can say
 * it needs none (Field.hideColumnDescription).
 */

const GERMAN: Record<string, string> = {
  Resolved: "Behoben",
  Acknowledged: "Bestätigt",
  "Keep reminding until the incident is resolved.":
    "Erinnern, bis der Vorfall behoben ist.",
  "Stop once someone acknowledges the incident.":
    "Aufhören, sobald jemand den Vorfall bestätigt.",
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
  stopRemindersOnState?: string;
}

const STOP_FIELD: Field<TestEntity> = {
  title: "Stop Reminders When",
  field: { stopRemindersOnState: true },
  fieldType: FormFieldSchemaType.RadioButton,
  radioButtonOptions: [
    {
      title: "Resolved",
      description: "Keep reminding until the incident is resolved.",
      value: ReminderStopState.Resolved,
    },
    {
      title: "Acknowledged",
      description: "Stop once someone acknowledges the incident.",
      value: ReminderStopState.Acknowledged,
    },
  ],
};

function renderField(
  field: Field<TestEntity>,
  inGerman: boolean = false,
): void {
  const element: React.ReactElement = (
    <FormField<TestEntity>
      field={field}
      fieldName="stopRemindersOnState"
      index={0}
      isDisabled={false}
      error=""
      touched={false}
      currentValues={
        {
          stopRemindersOnState: ReminderStopState.Resolved,
        } as FormValues<TestEntity>
      }
      setFieldTouched={() => {}}
      setFieldValue={() => {}}
    />
  );

  render(
    inGerman ? (
      <I18nextProvider i18n={german}>{element}</I18nextProvider>
    ) : (
      element
    ),
  );
}

describe("a RadioButton field's answers", () => {
  test("each says under its title what picking it means", () => {
    renderField(STOP_FIELD);

    const resolved: HTMLElement = screen.getByRole("radio", {
      name: "Resolved",
    });
    expect(resolved).toBeChecked();
    expect(resolved).toHaveAccessibleDescription(
      "Keep reminding until the incident is resolved.",
    );
    expect(
      screen.getByRole("radio", { name: "Acknowledged" }),
    ).toHaveAccessibleDescription(
      "Stop once someone acknowledges the incident.",
    );
  });

  test("an answer without a line is drawn as before", () => {
    renderField({
      ...STOP_FIELD,
      radioButtonOptions: [
        { title: "All", value: "all" },
        { title: "Any", value: "any" },
      ],
    });

    const all: HTMLElement = screen.getByRole("radio", { name: "All" });
    expect(all).not.toHaveAttribute("aria-describedby");
  });

  test("titles and lines are in the reader's language", () => {
    renderField(STOP_FIELD, true);

    expect(screen.getByRole("radio", { name: "Behoben" })).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Bestätigt" }),
    ).toHaveAccessibleDescription(
      "Aufhören, sobald jemand den Vorfall bestätigt.",
    );
    expect(screen.queryByText("Resolved")).toBeNull();
    expect(
      screen.queryByText("Keep reminding until the incident is resolved."),
    ).toBe(null);
  });

  test("the stored value is still the answer's value, whatever the language", () => {
    const set: ReturnType<typeof getJestMockFunction> = getJestMockFunction();

    render(
      <I18nextProvider i18n={german}>
        <FormField<TestEntity>
          field={STOP_FIELD}
          fieldName="stopRemindersOnState"
          index={0}
          isDisabled={false}
          error=""
          touched={false}
          currentValues={{} as FormValues<TestEntity>}
          setFieldTouched={() => {}}
          setFieldValue={set}
        />
      </I18nextProvider>,
    );

    screen.getByRole("radio", { name: "Bestätigt" }).click();

    expect(set).toHaveBeenCalledWith(
      "stopRemindersOnState",
      ReminderStopState.Acknowledged,
    );
  });
});

describe("the line under a field's title in a model form", () => {
  const COLUMN_SENTENCE: RegExp = /Select Acknowledged to stop reminders/;

  test("is the column's description when the field has none of its own", async () => {
    render(
      <BasicModelForm<IncidentReminderRule>
        model={new IncidentReminderRule()}
        id="reminder-rule"
        error={null}
        onSubmit={getJestMockFunction()}
        fields={[
          {
            ...(STOP_FIELD as unknown as Field<IncidentReminderRule>),
            field: { stopRemindersOnState: true },
          },
        ]}
      />,
    );

    expect(await screen.findByText(COLUMN_SENTENCE)).toBeInTheDocument();
  });

  test("is left out when the field says what it means another way", async () => {
    render(
      <BasicModelForm<IncidentReminderRule>
        model={new IncidentReminderRule()}
        id="reminder-rule"
        error={null}
        onSubmit={getJestMockFunction()}
        fields={[
          {
            ...(STOP_FIELD as unknown as Field<IncidentReminderRule>),
            field: { stopRemindersOnState: true },
            hideColumnDescription: true,
          },
        ]}
      />,
    );

    const group: HTMLElement = await screen.findByRole("radiogroup");
    expect(
      within(group).getByText("Keep reminding until the incident is resolved."),
    ).toBeInTheDocument();
    expect(screen.queryByText(COLUMN_SENTENCE)).toBeNull();
  });

  test("a field's own description is drawn either way", async () => {
    render(
      <BasicModelForm<IncidentReminderRule>
        model={new IncidentReminderRule()}
        id="reminder-rule"
        error={null}
        onSubmit={getJestMockFunction()}
        fields={[
          {
            ...(STOP_FIELD as unknown as Field<IncidentReminderRule>),
            field: { stopRemindersOnState: true },
            description: "When reminders stop.",
            hideColumnDescription: true,
          },
        ]}
      />,
    );

    expect(await screen.findByText("When reminders stop.")).toBeInTheDocument();
  });
});
