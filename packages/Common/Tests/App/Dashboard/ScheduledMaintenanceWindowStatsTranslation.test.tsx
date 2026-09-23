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
import {
  PLANNED_WINDOW_DESCRIPTION_TEMPLATE,
  ScheduledMaintenanceWindowStats,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/Index";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import {
  DEFAULT_DASHBOARD_LANGUAGE,
  SUPPORTED_DASHBOARD_LANGUAGE_CODES,
} from "../../../Types/Dashboard/DashboardLanguage";

/*
 * The Duration cell of the scheduled maintenance stat bar says which zone the
 * window's times are in. It used to be "Planned window · times in " + zone,
 * built in code and handed to EventStatTile, which does not translate its
 * description - so it stayed in English for everyone, and the zone in the
 * text would have kept it from ever matching a locale key anyway.
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
  [PLANNED_WINDOW_DESCRIPTION_TEMPLATE]:
    "Geplantes Zeitfenster · Zeiten in {{abbreviation}}",
};

/*
 * India has no daylight saving time, so the abbreviation is the same whatever
 * day the suite runs on.
 */
const PINNED_TIMEZONE: Timezone = Timezone.AsiaKolkata;
const PINNED_ABBREVIATION: string = "IST";

const GERMAN_DESCRIPTION: string = "Geplantes Zeitfenster · Zeiten in IST";
const ENGLISH_DESCRIPTION: string = "Planned window · times in IST";

const HOUR: number = 60 * 60 * 1000;

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

type RenderStatsFunction = (instance?: i18n | null) => HTMLElement;

/*
 * Renders the stat bar under `instance` (German by default) and returns its
 * Duration cell. Pass null to render it with no i18next instance at all.
 */
const renderStats: RenderStatsFunction = (
  instance?: i18n | null,
): HTMLElement => {
  const startsAt: Date = OneUptimeDate.addRemoveHours(
    OneUptimeDate.getCurrentDate(),
    2,
  );

  const stats: ReactElement = (
    <ScheduledMaintenanceWindowStats
      eventStartsAt={startsAt}
      eventEndsAt={new Date(startsAt.getTime() + 2 * HOUR)}
    />
  );

  const activeInstance: i18n | null =
    instance === undefined ? german : instance;

  render(
    activeInstance ? (
      <I18nextProvider i18n={activeInstance}>{stats}</I18nextProvider>
    ) : (
      stats
    ),
  );

  const cells: Array<Element> = Array.from(
    screen.getByRole("group", { name: "Maintenance window" }).children,
  );

  expect(cells).toHaveLength(3);

  return cells[2] as HTMLElement;
};

describe("ScheduledMaintenanceWindowStats - the Duration cell in German", () => {
  test("the zone used by the checks below is the pinned one", () => {
    expect(OneUptimeDate.getCurrentTimezone()).toBe(PINNED_TIMEZONE);
    expect(OneUptimeDate.getCurrentTimezoneString()).toBe(PINNED_ABBREVIATION);
  });

  test("describes the window in German, with the zone filled in", () => {
    const durationCell: HTMLElement = renderStats();

    // Exact text content: the whole description, nothing glued on.
    expect(screen.getByText(GERMAN_DESCRIPTION).textContent).toBe(
      GERMAN_DESCRIPTION,
    );
    expect(durationCell).toContainElement(screen.getByText(GERMAN_DESCRIPTION));
    expect(screen.queryByText(/Planned window/)).toBeNull();
    expect(screen.queryByText(/\{\{/)).toBeNull();
  });

  /*
   * EventStatTile shows its description as is today. If it (or anything
   * else) started looking the German text up again, an entry keyed by that
   * text would replace it.
   */
  test("the translated text is not looked up a second time", async () => {
    const germanWithTrap: i18n = await createGerman({
      [GERMAN_DESCRIPTION]: "Zweimal übersetzt",
    });

    renderStats(germanWithTrap);

    expect(screen.getByText(GERMAN_DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByText("Zweimal übersetzt")).toBeNull();
  });

  test("stays in English, zone filled in, where the locale lacks the entry", async () => {
    const germanWithoutEntry: i18n = createInstance();

    await germanWithoutEntry.init({
      lng: "de",
      resources: { de: { translation: {} } },
      keySeparator: false,
      nsSeparator: false,
    });

    renderStats(germanWithoutEntry);

    expect(screen.getByText(ENGLISH_DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByText(/\{\{/)).toBeNull();
  });
});

describe("ScheduledMaintenanceWindowStats - the Duration cell in English", () => {
  /*
   * English is the locale files' source text, so a lookup returns the key
   * itself. The description must read exactly as it did before.
   */
  test("reads as it always has", async () => {
    const english: i18n = createInstance();

    await english.init({
      lng: "en",
      resources: {
        en: {
          translation: {
            [PLANNED_WINDOW_DESCRIPTION_TEMPLATE]:
              PLANNED_WINDOW_DESCRIPTION_TEMPLATE,
          },
        },
      },
      keySeparator: false,
      nsSeparator: false,
    });

    renderStats(english);

    expect(screen.getByText(ENGLISH_DESCRIPTION).textContent).toBe(
      ENGLISH_DESCRIPTION,
    );
  });

  /*
   * With no ready i18next instance, react-i18next's t() returns the default
   * value as is - placeholder and all - so the page fills it in itself.
   */
  test("fills in the zone even with no i18next instance", () => {
    renderStats(null);

    expect(screen.getByText(ENGLISH_DESCRIPTION)).toBeInTheDocument();
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

describe("the planned window description in the Dashboard locales", () => {
  test("English maps it to itself", () => {
    expect(
      readLocale(DEFAULT_DASHBOARD_LANGUAGE)[
        PLANNED_WINDOW_DESCRIPTION_TEMPLATE
      ],
    ).toBe(PLANNED_WINDOW_DESCRIPTION_TEMPLATE);
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
      const translated: unknown =
        readLocale(code)[PLANNED_WINDOW_DESCRIPTION_TEMPLATE];

      expect({ code, isString: typeof translated === "string" }).toEqual({
        code,
        isString: true,
      });
      expect({ code, translated }).not.toEqual({
        code,
        translated: PLANNED_WINDOW_DESCRIPTION_TEMPLATE,
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
