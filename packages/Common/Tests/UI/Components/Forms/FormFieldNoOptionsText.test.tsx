import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import i18next from "i18next";
import React from "react";
import { initReactI18next } from "react-i18next";
import { JSONObject } from "../../../../Types/JSON";
import {
  DROPDOWN_NO_MATCHES_MESSAGE,
  DROPDOWN_NO_OPTIONS_MESSAGE,
} from "../../../../UI/Components/Dropdown/Dropdown";
import FormField from "../../../../UI/Components/Forms/Fields/FormField";
import { loadAllFormFieldControls } from "../../../../UI/Components/Forms/Fields/FormFieldControls";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { NO_DEVICE_MONITOR_TEMPLATE_YET } from "../../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Settings/AutoImportRuleFormUtil";
import { readDashboardLocale } from "../../../Helpers/DashboardLocales";

/*
 * A DROPDOWN FIELD'S OWN WORDS FOR AN EMPTY LIST (OneUptime issue #9510).
 *
 * An auto import rule's Monitor Template listed Network Device templates
 * only, and a project without one saw "No options available" - nothing
 * about which templates the list takes or how to make one. A field can say
 * that itself now (noOptionsText): the open list says it, in the reader's
 * language, while nothing is typed; a search that finds nothing still says
 * "No matches found", and a field that says nothing keeps the product's
 * own "No options available".
 */

interface TestEntity extends JSONObject {
  monitorTemplate?: string;
}

function box(): HTMLElement {
  return screen.getByRole("combobox");
}

function notice(): string | null {
  return (
    document.querySelector<HTMLElement>(".ou-select__menu-notice")
      ?.textContent || null
  );
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 10; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function openMenu(): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(box(), { key: "ArrowDown" });
  });
}

async function type(text: string): Promise<void> {
  await act(async () => {
    fireEvent.change(box(), { target: { value: text } });
  });
}

async function renderField(
  overrides: Partial<Field<TestEntity>>,
): Promise<void> {
  const field: Field<TestEntity> = {
    title: "Monitor Template",
    name: "monitorTemplate",
    field: { monitorTemplate: true },
    fieldType: FormFieldSchemaType.Dropdown,
    dropdownOptions: [],
    required: false,
    placeholder: "Import device only (no monitor)",
    ...overrides,
  } as Field<TestEntity>;

  render(
    <FormField<TestEntity>
      field={field}
      fieldName="monitorTemplate"
      index={0}
      isDisabled={false}
      error=""
      touched={false}
      currentValues={{} as FormValues<TestEntity>}
      setFieldTouched={(): void => {}}
      setFieldValue={(): void => {}}
      disableAutofocus={true}
    />,
  );

  await settle();
}

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      de: { translation: readDashboardLocale("de") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });

  await loadAllFormFieldControls();
});

afterEach(async () => {
  cleanup();
  await inLanguage("en");
});

afterAll(async () => {
  await inLanguage("en");
});

describe("a dropdown field with words of its own for an empty list", () => {
  test("says which templates the list takes and how to make one, when there is none", async () => {
    await renderField({ noOptionsText: NO_DEVICE_MONITOR_TEMPLATE_YET });
    await openMenu();

    expect(notice()).toBe(NO_DEVICE_MONITOR_TEMPLATE_YET);
    expect(notice()).toContain(
      "Network Device, Ping, IP, Port, NTP, Website, API or SSL Certificate",
    );
    expect(notice()).toContain("Manage templates");
  });

  test("says it in the reader's language", async () => {
    await inLanguage("de");
    await renderField({ noOptionsText: NO_DEVICE_MONITOR_TEMPLATE_YET });
    await openMenu();

    const german: string = readDashboardLocale("de")[
      NO_DEVICE_MONITOR_TEMPLATE_YET
    ] as string;

    expect(german).toBeTruthy();
    expect(german).not.toBe(NO_DEVICE_MONITOR_TEMPLATE_YET);
    expect(notice()).toBe(german);
  });

  test("still says nothing matched when a search finds nothing", async () => {
    await inLanguage("de");
    await renderField({ noOptionsText: NO_DEVICE_MONITOR_TEMPLATE_YET });
    await openMenu();
    await type("kiosk");

    expect(notice()).toBe(
      readDashboardLocale("de")[DROPDOWN_NO_MATCHES_MESSAGE],
    );
  });

  test("leaves a field that says nothing with the product's own words", async () => {
    await renderField({});
    await openMenu();

    expect(notice()).toBe(DROPDOWN_NO_OPTIONS_MESSAGE);
  });
});
