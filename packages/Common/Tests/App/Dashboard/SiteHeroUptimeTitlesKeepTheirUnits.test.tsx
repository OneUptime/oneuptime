import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A NETWORK SITE'S UPTIME TITLES KEEP THEIR NUMBER WITH ITS UNIT (#8043).
 *
 * The Overview hero titles its two uptime tiles from "Uptime ({{hours}}h)"
 * and "Uptime ({{days}}d)". German writes "Verfügbarkeit ({{hours}} Std.)",
 * and on a phone, two tiles to a row, the title broke inside its brackets:
 * "Verfügbarkeit (24" over "Std.) (i)". Twelve of the seventeen languages
 * write a space there; the other five none, as English does ("(24h)").
 *
 * The real hero is drawn here in every Dashboard language, from the
 * locale files as they are written: the Translator sets the space after
 * each number English writes beside its unit as a no-break one
 * (Common/Types/NoBreakSpaces). jsdom lays nothing out, so the titles are
 * read for what decides a break: no space a line breaks at between the
 * number and the closing bracket.
 */

const SITE_ID: string = "55555555-5555-4555-8555-555555558043";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const fetchMaintenanceWindowsMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      count: (...args: Array<unknown>): unknown => {
        return countMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteMaintenanceWindows",
  () => {
    const fetcher: (...args: Array<unknown>) => unknown = (
      ...args: Array<unknown>
    ): unknown => {
      return fetchMaintenanceWindowsMock(...args);
    };

    return {
      __esModule: true,
      default: fetcher,
      fetchSiteMaintenanceWindows: fetcher,
    };
  },
);

import SiteStatusHero from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteStatusHero";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import { Green } from "../../../Types/BrandColors";
import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";
import ObjectID from "../../../Types/ObjectID";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

// Any space at all, a no-break one too.
const ANY_SPACE: RegExp = /\s/;

// The number a window's length fills a title with: 24 hours, 30 days.
const WINDOW_NUMBER: RegExp = /24|30|۲۴|۳۰/;

// A space a line may break at: the space and the fixed-width ones.
const BREAKING_SPACE: RegExp = /[ \u2000-\u2006\u2008-\u200A\u205F]/;

/*
 * The languages whose translation writes a space between the number and
 * its unit, as the issue found them, and those that write none.
 */
const SPACED: ReadonlyArray<string> = [
  "de",
  "es",
  "fr",
  "it",
  "no",
  "ru",
  "sv",
  "ar",
  "fa",
  "ja",
  "zh-CN",
  "zh-TW",
];

const JOINED: ReadonlyArray<string> = ["da", "hi", "ko", "nl", "pt"];

function operational(): MonitorStatus {
  const row: MonitorStatus = new MonitorStatus();

  row._id = "77777777-7777-4777-8777-000000008043";
  row.name = "Operational";
  row.color = Green;
  row.priority = 1;
  row.isOperationalState = true;

  return row;
}

function site(): NetworkSite {
  const row: NetworkSite = new NetworkSite();

  row._id = SITE_ID;
  row.currentMonitorStatus = operational();
  row.lastRollupAt = new Date();

  return row;
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// The hero's two uptime tiles' titles, as drawn: every space as it is.
async function drawUptimeTitles(language: string): Promise<Array<string>> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });

  render(
    <MemoryRouter>
      <SiteStatusHero modelId={new ObjectID(SITE_ID)} />
    </MemoryRouter>,
  );
  await flush();

  const titles: Array<string> = screen
    .getAllByTestId("site-hero-tile-title")
    .map((title: HTMLElement): string => {
      return withoutIsolateMarks(title.textContent || "");
    });

  cleanup();

  // The two whose number a window's length fills: 24 hours and 30 days.
  return titles.filter((title: string): boolean => {
    return WINDOW_NUMBER.test(title);
  });
}

// Persian's digits as Latin ones, so one check reads every language.
function inLatinDigits(text: string): string {
  return text.replace(/[۰-۹]/g, (digit: string): string => {
    return String(digit.charCodeAt(0) - 0x06f0);
  });
}

// What stands between the window's number and the bracket that closes it.
function betweenNumberAndBracket(title: string): string {
  const match: RegExpMatchArray | null = inLatinDigits(title).match(
    /(?:24|30)([^)）]*)[)）]/,
  );

  expect({ title, found: Boolean(match) }).toEqual({ title, found: true });

  return match![1] as string;
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of DASHBOARD_LANGUAGES) {
    resources[language] = { translation: readDashboardLocale(language) };
  }

  resources["en"] = { translation: readDashboardLocale("en") };

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });

  getItemMock.mockResolvedValue(site());
  getListMock.mockResolvedValue({ data: [], count: 0 });
  countMock.mockResolvedValue(0);
  fetchMaintenanceWindowsMock.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

describe("the network site hero's uptime titles", () => {
  test("every Dashboard language is one of the two kinds", () => {
    expect([...SPACED, ...JOINED].sort()).toEqual(
      [...DASHBOARD_LANGUAGES].sort(),
    );
  });

  test("in German they read as the issue asks: the number and its unit held together", async () => {
    expect(await drawUptimeTitles("de")).toEqual([
      `Verfügbarkeit (24${NO_BREAK_SPACE}Std.)`,
      `Verfügbarkeit (30${NO_BREAK_SPACE}T.)`,
    ]);
  });

  test("in English they read as before", async () => {
    expect(await drawUptimeTitles("en")).toEqual([
      "Uptime (24h)",
      "Uptime (30d)",
    ]);
  });

  test.each(SPACED)(
    "in %s, a no-break space and nothing a line breaks at between the number and its unit",
    async (language: string) => {
      const titles: Array<string> = await drawUptimeTitles(language);

      expect(titles).toHaveLength(2);

      for (const title of titles) {
        const between: string = betweenNumberAndBracket(title);

        expect({
          language,
          title,
          holds: between.includes(NO_BREAK_SPACE),
        }).toEqual({ language, title, holds: true });
        expect({
          language,
          title,
          breaks: BREAKING_SPACE.test(between),
        }).toEqual({ language, title, breaks: false });
      }
    },
  );

  test.each(JOINED)(
    "in %s, the unit is written right after the number, as before",
    async (language: string) => {
      const titles: Array<string> = await drawUptimeTitles(language);

      expect(titles).toHaveLength(2);

      for (const title of titles) {
        const between: string = betweenNumberAndBracket(title);

        expect({ language, title, spaces: ANY_SPACE.test(between) }).toEqual({
          language,
          title,
          spaces: false,
        });
      }
    },
  );

  test("the locale files keep the plain space their translators typed", () => {
    expect(readDashboardLocale("de")["Uptime ({{hours}}h)"]).toBe(
      "Verfügbarkeit ({{hours}} Std.)",
    );
  });
});
