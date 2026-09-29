import "@testing-library/jest-dom";
import React, { ReactElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import FormField, {
  TIMEZONE_DESCRIPTION_TEMPLATE,
} from "../../../../UI/Components/Forms/Fields/FormField";
import Field from "../../../../UI/Components/Forms/Types/Field";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import OneUptimeDate from "../../../../Types/Date";
import Timezone from "../../../../Types/Timezone";
import {
  DEFAULT_DASHBOARD_LANGUAGE,
  SUPPORTED_DASHBOARD_LANGUAGE_CODES,
} from "../../../../Types/Dashboard/DashboardLanguage";
import { JSONObject } from "../../../../Types/JSON";

/*
 * A DateTime or Time field ends its description with the timezone the value
 * is in. FormField used to glue that sentence, zone and all, onto the
 * description and hand FieldLabel the result, which FieldLabel then looked up
 * as a single key. The zone made the key unique to the user, so it never
 * matched a locale entry: the field's own description and the timezone
 * sentence both stayed in English for everyone.
 *
 * The German values are the shipped ones, copied from
 * App/FeatureSet/Dashboard/src/Locales/de.json (a test below keeps the copy
 * honest); the keys are the English source text, exactly as those locale
 * files key them.
 *
 * The instance reaches the component through I18nextProvider only. Adding
 * .use(initReactI18next) would install it as react-i18next's global instance
 * and leak German into every other test that shares this worker.
 *
 * escapeValue is left at i18next's default (on) on purpose. The zone name has
 * a slash in it, and an escaping instance that interpolated it would show
 * "Asia&#x2F;Kolkata".
 */

const DECLARED_AT: string = "Declared At";
const DECLARED_AT_DESCRIPTION: string =
  "When was this incident first declared?";
const GERMAN_DESCRIPTION: string =
  "Wann wurde dieser Vorfall erstmals deklariert?";

const GERMAN_TRANSLATIONS: Record<string, string> = {
  [DECLARED_AT]: "Erklärt am",
  [DECLARED_AT_DESCRIPTION]: GERMAN_DESCRIPTION,
  [TIMEZONE_DESCRIPTION_TEMPLATE]:
    "Diese Angabe bezieht sich auf Ihre Zeitzone - {{abbreviation}} ({{timezone}}).",
};

/*
 * India has no daylight saving time, so the abbreviation is the same whatever
 * day the suite runs on.
 */
const PINNED_TIMEZONE: Timezone = Timezone.AsiaKolkata;
const PINNED_ABBREVIATION: string = "IST";

const GERMAN_TIMEZONE_SENTENCE: string =
  "Diese Angabe bezieht sich auf Ihre Zeitzone - IST (Asia/Kolkata).";
const ENGLISH_TIMEZONE_SENTENCE: string =
  "This is in your timezone - IST (Asia/Kolkata).";

type CreateGermanFunction = (
  extraTranslations?: Record<string, string>,
) => Promise<i18n>;

const createGerman: CreateGermanFunction = async (
  extraTranslations?: Record<string, string>,
): Promise<i18n> => {
  const instance: i18n = createInstance();

  await instance.init({
    lng: "de",
    resources: {
      de: {
        translation: { ...GERMAN_TRANSLATIONS, ...extraTranslations },
      },
    },
    keySeparator: false,
    nsSeparator: false,
  });

  return instance;
};

let german: i18n;
let previousTimezone: Timezone | null = null;

beforeAll(async () => {
  german = await createGerman();
  previousTimezone = OneUptimeDate.getUserTimezone();
  OneUptimeDate.setUserTimezone(PINNED_TIMEZONE);
});

afterAll(() => {
  OneUptimeDate.setUserTimezone(previousTimezone);
});

afterEach(() => {
  cleanup();
});

interface TestEntity extends JSONObject {
  declaredAt?: string;
}

interface RenderFieldOptions {
  overrides?: Partial<Field<TestEntity>> | undefined;
  withoutDescription?: boolean | undefined;
  instance?: i18n | null | undefined;
}

type RenderFieldFunction = (options?: RenderFieldOptions) => void;

/*
 * Renders one field under `instance` (German by default). Pass null to render
 * it with no i18next instance at all.
 */
const renderField: RenderFieldFunction = (
  options?: RenderFieldOptions,
): void => {
  const field: Field<TestEntity> = {
    title: DECLARED_AT,
    description: DECLARED_AT_DESCRIPTION,
    field: { declaredAt: true },
    fieldType: FormFieldSchemaType.DateTime,
    ...options?.overrides,
  };

  if (options?.withoutDescription) {
    delete field.description;
  }

  const formField: ReactElement = (
    <FormField<TestEntity>
      field={field}
      fieldName="declaredAt"
      index={0}
      isDisabled={false}
      error=""
      touched={false}
      currentValues={{} as FormValues<TestEntity>}
      setFieldTouched={() => {}}
      setFieldValue={() => {}}
    />
  );

  const instance: i18n | null =
    options?.instance === undefined ? german : options.instance;

  render(
    instance ? (
      <I18nextProvider i18n={instance}>{formField}</I18nextProvider>
    ) : (
      formField
    ),
  );
};

describe("FormField - a DateTime field in German", () => {
  test("the zone used by the checks below is the pinned one", () => {
    expect(OneUptimeDate.getCurrentTimezone()).toBe(PINNED_TIMEZONE);
    expect(OneUptimeDate.getCurrentTimezoneString()).toBe(PINNED_ABBREVIATION);
  });

  test("the description and the timezone sentence are both translated", () => {
    renderField();

    const description: HTMLElement = screen.getByText(
      `${GERMAN_DESCRIPTION} ${GERMAN_TIMEZONE_SENTENCE}`,
    );

    expect(description).toHaveTextContent(
      `${GERMAN_DESCRIPTION} ${GERMAN_TIMEZONE_SENTENCE}`,
      { normalizeWhitespace: false },
    );
    expect(screen.queryByText(/When was this incident/)).toBeNull();
    expect(screen.queryByText(/This is in your timezone/)).toBeNull();
    expect(screen.getByText("Erklärt am")).toBeInTheDocument();
  });

  test("the zone is shown as is, not escaped", () => {
    renderField();

    const description: HTMLElement = screen.getByText(
      new RegExp(`\\(${PINNED_TIMEZONE}\\)\\.$`),
    );

    expect(description.textContent).toContain("Asia/Kolkata");
    expect(description.textContent).not.toContain("&#x2F;");
  });

  test("a field with no description shows only the timezone sentence", () => {
    renderField({ withoutDescription: true });

    // Exact text content: no space left over where the description would be.
    expect(screen.getByText(GERMAN_TIMEZONE_SENTENCE).textContent).toBe(
      GERMAN_TIMEZONE_SENTENCE,
    );
  });

  test("an empty description shows only the timezone sentence", () => {
    renderField({ overrides: { description: "" } });

    expect(screen.getByText(GERMAN_TIMEZONE_SENTENCE).textContent).toBe(
      GERMAN_TIMEZONE_SENTENCE,
    );
  });

  test("a description with no German entry yet stays in English", () => {
    renderField({
      overrides: { description: "When did the customer first report it?" },
    });

    expect(
      screen.getByText(
        `When did the customer first report it? ${GERMAN_TIMEZONE_SENTENCE}`,
      ),
    ).toBeInTheDocument();
  });

  /*
   * An element description used to be concatenated as a string and shown as
   * "[object Object] This is in your timezone - ...".
   */
  test("a description given as an element is rendered untouched", () => {
    renderField({
      overrides: {
        description: (
          <span data-testid="element-description">
            {DECLARED_AT_DESCRIPTION}
          </span>
        ),
      },
    });

    expect(screen.getByTestId("element-description")).toHaveTextContent(
      DECLARED_AT_DESCRIPTION,
    );
    expect(
      screen.getByText(GERMAN_TIMEZONE_SENTENCE, { exact: false }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\[object Object\]/)).toBeNull();
  });

  /*
   * FieldLabel translates the description it is given. The composed text is
   * already German, so if FieldLabel looked it up again, an entry keyed by
   * that German text would replace it.
   */
  test("the translated text is not looked up a second time", async () => {
    const composed: string = `${GERMAN_DESCRIPTION} ${GERMAN_TIMEZONE_SENTENCE}`;
    const germanWithTrap: i18n = await createGerman({
      [composed]: "Zweimal übersetzt",
    });

    renderField({ instance: germanWithTrap });

    expect(screen.getByText(composed)).toBeInTheDocument();
    expect(screen.queryByText("Zweimal übersetzt")).toBeNull();
  });

  /*
   * A language may need the zone name before its abbreviation. The
   * placeholders are filled by name, so the translation's order is kept.
   */
  test("a translation that reorders the placeholders is filled by name", async () => {
    const reordered: i18n = await createGerman({
      [TIMEZONE_DESCRIPTION_TEMPLATE]:
        "Zeitzone {{timezone}}, abgekürzt {{abbreviation}}.",
    });

    renderField({ instance: reordered, withoutDescription: true });

    expect(
      screen.getByText("Zeitzone Asia/Kolkata, abgekürzt IST."),
    ).toBeInTheDocument();
  });

  test("a Time field is translated the same way", () => {
    renderField({ overrides: { fieldType: FormFieldSchemaType.Time } });

    expect(
      screen.getByText(`${GERMAN_DESCRIPTION} ${GERMAN_TIMEZONE_SENTENCE}`),
    ).toBeInTheDocument();
  });

  test("a Text field gets its description and no timezone sentence", () => {
    renderField({ overrides: { fieldType: FormFieldSchemaType.Text } });

    expect(screen.getByText(GERMAN_DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByText(/Zeitzone/)).toBeNull();
  });
});

describe("FormField - a DateTime field in English", () => {
  /*
   * English is the locale files' source text, so a lookup returns the key
   * itself. The sentence must read exactly as it did before it was split out.
   */
  test("reads as it always has", async () => {
    const english: i18n = createInstance();

    await english.init({
      lng: "en",
      resources: {
        en: {
          translation: {
            [TIMEZONE_DESCRIPTION_TEMPLATE]: TIMEZONE_DESCRIPTION_TEMPLATE,
          },
        },
      },
      keySeparator: false,
      nsSeparator: false,
    });

    renderField({ instance: english });

    expect(
      screen.getByText(
        `${DECLARED_AT_DESCRIPTION} ${ENGLISH_TIMEZONE_SENTENCE}`,
      ),
    ).toBeInTheDocument();
  });

  /*
   * With no ready i18next instance, react-i18next's t() returns the default
   * value as is - placeholders and all - so FormField fills them in itself.
   */
  test("fills in the zone even with no i18next instance", () => {
    renderField({ instance: null });

    expect(
      screen.getByText(
        `${DECLARED_AT_DESCRIPTION} ${ENGLISH_TIMEZONE_SENTENCE}`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\{\{/)).toBeNull();
  });
});

describe("BasicForm - a DateTime field in German", () => {
  test("the form's DateTime field shows its translated description", () => {
    const fields: Fields<TestEntity> = [
      {
        title: DECLARED_AT,
        description: DECLARED_AT_DESCRIPTION,
        field: { declaredAt: true },
        fieldType: FormFieldSchemaType.DateTime,
      },
    ];

    render(
      <I18nextProvider i18n={german}>
        <BasicForm
          id="declared-at-form"
          fields={fields}
          onSubmit={() => {}}
          submitButtonText="Save"
        />
      </I18nextProvider>,
    );

    expect(
      screen.getByText(`${GERMAN_DESCRIPTION} ${GERMAN_TIMEZONE_SENTENCE}`),
    ).toBeInTheDocument();
    expect(screen.queryByText(/This is in your timezone/)).toBeNull();
  });
});

const DASHBOARD_LOCALES: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

type ReadLocaleFunction = (code: string) => Record<string, unknown>;

const readLocale: ReadLocaleFunction = (
  code: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES, `${code}.json`), "utf8"),
  ) as Record<string, unknown>;
};

describe("the timezone sentence in the Dashboard locales", () => {
  test("English maps it to itself", () => {
    expect(
      readLocale(DEFAULT_DASHBOARD_LANGUAGE)[TIMEZONE_DESCRIPTION_TEMPLATE],
    ).toBe(TIMEZONE_DESCRIPTION_TEMPLATE);
  });

  /*
   * A translation that drops or renames a placeholder would show a raw
   * "{{timezone}}" or leave the zone out.
   */
  test("every other language translates it and keeps both placeholders", () => {
    const otherLanguages: Array<string> =
      SUPPORTED_DASHBOARD_LANGUAGE_CODES.filter((code: string): boolean => {
        return code !== DEFAULT_DASHBOARD_LANGUAGE;
      });

    expect(otherLanguages.length).toBeGreaterThan(0);

    for (const code of otherLanguages) {
      const translated: unknown =
        readLocale(code)[TIMEZONE_DESCRIPTION_TEMPLATE];

      expect({ code, isString: typeof translated === "string" }).toEqual({
        code,
        isString: true,
      });
      expect({ code, translated }).not.toEqual({
        code,
        translated: TIMEZONE_DESCRIPTION_TEMPLATE,
      });
      expect({
        code,
        placeholders: ((translated as string).match(/\{\{\w+\}\}/g) || [])
          .slice()
          .sort(),
      }).toEqual({
        code,
        placeholders: ["{{abbreviation}}", "{{timezone}}"],
      });
    }
  });

  test("the German used above is the shipped German", () => {
    const shipped: Record<string, unknown> = readLocale("de");

    for (const [key, value] of Object.entries(GERMAN_TRANSLATIONS)) {
      expect({ key, value: shipped[key] }).toEqual({ key, value });
    }
  });
});
