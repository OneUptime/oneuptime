import "@testing-library/jest-dom";
import React, { ReactElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import CustomTimeRangeModal, {
  TIMEZONE_NOTE_TEMPLATE,
} from "../../../UI/Components/Date/CustomTimeRangeModal";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import {
  DEFAULT_DASHBOARD_LANGUAGE,
  SUPPORTED_DASHBOARD_LANGUAGE_CODES,
} from "../../../Types/Dashboard/DashboardLanguage";

/*
 * The custom time range modal ends with a note naming the zone its times are
 * in. It used to be the JSX literal "Times are shown in {zone}.", which never
 * went through translation, so it stayed in English for everyone.
 *
 * The German value is the shipped one, copied from
 * App/FeatureSet/Dashboard/src/Locales/de.json (a test below keeps the copy
 * honest); the key is the English source text, exactly as those locale files
 * key it.
 *
 * The instance reaches the component through I18nextProvider only. Adding
 * .use(initReactI18next) would install it as react-i18next's global instance
 * and leak German into every other test that shares this worker.
 */

const GERMAN_TRANSLATIONS: Record<string, string> = {
  [TIMEZONE_NOTE_TEMPLATE]:
    "Zeiten werden in der Zeitzone {{abbreviation}} angezeigt.",
};

/*
 * India has no daylight saving time, so the abbreviation is the same whatever
 * day the suite runs on.
 */
const PINNED_TIMEZONE: Timezone = Timezone.AsiaKolkata;
const PINNED_ABBREVIATION: string = "IST";

const GERMAN_NOTE: string = "Zeiten werden in der Zeitzone IST angezeigt.";
const ENGLISH_NOTE: string = "Times are shown in IST.";

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

type RenderModalFunction = (instance?: i18n | null) => void;

/*
 * Renders the modal under `instance` (German by default). Pass null to render
 * it with no i18next instance at all.
 */
const renderModal: RenderModalFunction = (instance?: i18n | null): void => {
  const modal: ReactElement = (
    <CustomTimeRangeModal
      initialValue={
        new InBetween<Date>(
          new Date("2024-03-01T10:00:00.000Z"),
          new Date("2024-03-01T13:00:00.000Z"),
        )
      }
      onClose={jest.fn()}
      onSave={jest.fn()}
    />
  );

  const activeInstance: i18n | null =
    instance === undefined ? german : instance;

  render(
    activeInstance ? (
      <I18nextProvider i18n={activeInstance}>{modal}</I18nextProvider>
    ) : (
      modal
    ),
  );
};

describe("CustomTimeRangeModal - the timezone note in German", () => {
  test("the zone used by the checks below is the pinned one", () => {
    expect(OneUptimeDate.getCurrentTimezone()).toBe(PINNED_TIMEZONE);
    expect(OneUptimeDate.getCurrentTimezoneString()).toBe(PINNED_ABBREVIATION);
  });

  test("is translated, with the zone filled in", () => {
    renderModal();

    // Exact text content: the whole note, nothing glued on either side.
    expect(screen.getByText(GERMAN_NOTE).textContent).toBe(GERMAN_NOTE);
    expect(screen.queryByText(/Times are shown in/)).toBeNull();
    expect(screen.queryByText(/\{\{/)).toBeNull();
  });

  /*
   * The note is rendered as it comes back from the lookup. If anything looked
   * the German text up again, an entry keyed by that text would replace it.
   */
  test("the translated text is not looked up a second time", async () => {
    const germanWithTrap: i18n = await createGerman({
      [GERMAN_NOTE]: "Zweimal übersetzt",
    });

    renderModal(germanWithTrap);

    expect(screen.getByText(GERMAN_NOTE)).toBeInTheDocument();
    expect(screen.queryByText("Zweimal übersetzt")).toBeNull();
  });

  test("stays in English, zone filled in, where the locale lacks the entry", async () => {
    const germanWithoutNote: i18n = createInstance();

    await germanWithoutNote.init({
      lng: "de",
      resources: { de: { translation: {} } },
      keySeparator: false,
      nsSeparator: false,
    });

    renderModal(germanWithoutNote);

    expect(screen.getByText(ENGLISH_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(/\{\{/)).toBeNull();
  });
});

describe("CustomTimeRangeModal - the timezone note in English", () => {
  /*
   * English is the locale files' source text, so a lookup returns the key
   * itself. The note must read exactly as it did before it was translatable.
   */
  test("reads as it always has", async () => {
    const english: i18n = createInstance();

    await english.init({
      lng: "en",
      resources: {
        en: {
          translation: {
            [TIMEZONE_NOTE_TEMPLATE]: TIMEZONE_NOTE_TEMPLATE,
          },
        },
      },
      keySeparator: false,
      nsSeparator: false,
    });

    renderModal(english);

    expect(screen.getByText(ENGLISH_NOTE).textContent).toBe(ENGLISH_NOTE);
  });

  /*
   * With no ready i18next instance, react-i18next's t() returns the default
   * value as is - placeholder and all - so the modal fills it in itself.
   */
  test("fills in the zone even with no i18next instance", () => {
    renderModal(null);

    expect(screen.getByText(ENGLISH_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(/\{\{/)).toBeNull();
  });
});

const DASHBOARD_LOCALES: string = path.resolve(
  __dirname,
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

describe("the timezone note in the Dashboard locales", () => {
  test("English maps it to itself", () => {
    expect(readLocale(DEFAULT_DASHBOARD_LANGUAGE)[TIMEZONE_NOTE_TEMPLATE]).toBe(
      TIMEZONE_NOTE_TEMPLATE,
    );
  });

  /*
   * A translation that drops or renames the placeholder would show a raw
   * "{{abbreviation}}" or leave the zone out.
   */
  test("every other language translates it and keeps the placeholder", () => {
    const otherLanguages: Array<string> =
      SUPPORTED_DASHBOARD_LANGUAGE_CODES.filter((code: string): boolean => {
        return code !== DEFAULT_DASHBOARD_LANGUAGE;
      });

    expect(otherLanguages.length).toBeGreaterThan(0);

    for (const code of otherLanguages) {
      const translated: unknown = readLocale(code)[TIMEZONE_NOTE_TEMPLATE];

      expect({ code, isString: typeof translated === "string" }).toEqual({
        code,
        isString: true,
      });
      expect({ code, translated }).not.toEqual({
        code,
        translated: TIMEZONE_NOTE_TEMPLATE,
      });
      expect({
        code,
        placeholders: (translated as string).match(/\{\{\w+\}\}/g) || [],
      }).toEqual({
        code,
        placeholders: ["{{abbreviation}}"],
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
