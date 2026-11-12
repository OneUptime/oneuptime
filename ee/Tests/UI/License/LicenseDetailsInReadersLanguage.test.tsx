import LicenseDetails from "../../../AdminDashboard/License/LicenseDetails";
import {
  LICENSE_DETAILS_PLURALS,
  LicenseDetailsCopy,
} from "../../../AdminDashboard/License/LicenseDetailsCopy";
import {
  ADMIN_DASHBOARD_LANGUAGES,
  DASHBOARD_LANGUAGES,
} from "Common/Tests/Helpers/TranslatedLanguages";
import { withoutIsolateMarks } from "Common/Tests/Helpers/IsolateMarks";
import OneUptimeDate from "Common/Types/Date";
import { withDateDisplayLanguage } from "Common/Types/DateLanguage";
import { JSONObject } from "Common/Types/JSON";
import { LicenseSnapshot } from "Common/UI/Components/EditionLabel/LicenseDetails";
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import { PluralTemplate } from "Common/UI/Utils/TranslateTemplate";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * THE LICENSE DETAILS IN THE READER'S LANGUAGE (#6470).
 *
 * The seat card and the instances on the license, drawn in every language
 * of both apps that draw them (the Admin Dashboard's header and Settings >
 * License, the Dashboard's footer), from each app's own locale files as it
 * ships them: no English sentence of the details is left on the page, its
 * numbers and dates are the reader's, the seat limit reads as the
 * language counts it ("37 / 50 Plätze", "37 من أصل 50"), and a host name
 * written in Latin letters reads left to right on an Arabic or Persian
 * page.
 */

type App = "AdminDashboard" | "Dashboard";
type Words = Record<string, unknown>;

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const localeCache: Map<string, Words> = new Map<string, Words>();

const wordsOf: (app: App, language: string) => Words = (
  app: App,
  language: string,
): Words => {
  const cacheKey: string = `${app}/${language}`;
  const cached: Words | undefined = localeCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const words: Words = JSON.parse(
    fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages/App/FeatureSet",
        app,
        "src/Locales",
        `${language}.json`,
      ),
      "utf8",
    ),
  ) as Words;

  localeCache.set(cacheKey, words);

  return words;
};

// Every key the details read, the one form of a count under key + "_one".
const KEYS: Array<string> = [
  ...Object.values(LicenseDetailsCopy),
  ...LICENSE_DETAILS_PLURALS.flatMap((plural: PluralTemplate): string[] => {
    return [plural.other, `${plural.other}_one`];
  }),
];

const PLACEHOLDER: RegExp = /\{\{\s*\w+\s*\}\}/;

// A sentence's own words, without the values it is filled with.
const piecesOf: (sentence: string) => Array<string> = (
  sentence: string,
): Array<string> => {
  return sentence
    .split(PLACEHOLDER)
    .map((piece: string): string => {
      return piece.trim();
    })
    .filter((piece: string): boolean => {
      return piece.length >= 5;
    });
};

/*
 * The details' English left on a page drawn in `language`: each piece of
 * one of their English sentences that none of the language's own wordings
 * holds ("OneUptime" is OneUptime in every language).
 */
const englishLeftOn: (drawn: string, app: App, language: string) => string[] = (
  drawn: string,
  app: App,
  language: string,
): Array<string> => {
  const english: Words = wordsOf(app, "en");
  const words: Words = wordsOf(app, language);
  const worded: Array<string> = KEYS.map((key: string): string => {
    return String(words[key]);
  });
  const left: Set<string> = new Set<string>();

  for (const key of KEYS) {
    for (const piece of piecesOf(String(english[key]))) {
      if (
        worded.some((sentence: string): boolean => {
          return sentence.includes(piece);
        })
      ) {
        continue;
      }

      if (drawn.includes(piece)) {
        left.add(piece);
      }
    }
  }

  return Array.from(left);
};

// Everything the details say: their text, names, hints and the bar's value.
const drawnText: () => string = (): string => {
  const parts: Array<string> = [document.body.textContent || ""];

  document.body
    .querySelectorAll("[aria-label], [title], [aria-valuetext]")
    .forEach((element: Element): void => {
      for (const attribute of ["aria-label", "title", "aria-valuetext"]) {
        const value: string | null = element.getAttribute(attribute);

        if (value) {
          parts.push(value);
        }
      }
    });

  return withoutIsolateMarks(parts.join("\n"));
};

const readIn: (app: App, language: string) => Promise<void> = async (
  app: App,
  language: string,
): Promise<void> => {
  await act(async () => {
    for (const code of [language, "en"]) {
      i18next.removeResourceBundle(code, "translation");
      i18next.addResourceBundle(
        code,
        "translation",
        wordsOf(app, code),
        true,
        true,
      );
    }

    await i18next.changeLanguage(language);
  });
};

const REPORTED_AT: string = "2026-03-14T09:30:00.000Z";

const INSTANCES: Array<JSONObject> = [
  {
    instanceId: "instance-1",
    host: "oneuptime.acme.internal",
    userCount: 7,
    lastReportedAt: REPORTED_AT,
    version: "12.9.0",
  },
  {
    instanceId: "instance-2",
    host: "staging.acme.internal",
    userCount: 1,
    lastReportedAt: null,
    version: "12.0.0",
  },
];

// A master admin's license: over its limit, enforced, on two instances.
const breached: (overrides?: Partial<LicenseSnapshot>) => LicenseSnapshot = (
  overrides?: Partial<LicenseSnapshot>,
): LicenseSnapshot => {
  return {
    payload: {
      activationMode: "online",
      userCountUpdatedAt: REPORTED_AT,
      instanceId: "instance-1",
      instances: INSTANCES,
    },
    canManageLicense: true,
    showLicenseDetails: true,
    companyName: "Acme",
    licenseKey: "license-key",
    userLimit: 50,
    currentUserCount: 52,
    effectiveUserCount: 52,
    isSeatLimitEnforced: true,
    canAddMoreUsers: false,
    seatTone: "breached",
    seatUsageDisplayPercent: 104,
    currentVersion: "13.0.0",
    latestVersion: "13.1.0",
    hasComparableVersion: true,
    ...overrides,
  };
};

// Four seats left of fifty: the advice to ask for more.
const approaching: () => LicenseSnapshot = (): LicenseSnapshot => {
  return breached({
    currentUserCount: 46,
    effectiveUserCount: 46,
    isSeatLimitEnforced: false,
    canAddMoreUsers: true,
    seatTone: "approaching",
    seatUsageDisplayPercent: 92,
  });
};

// No seat limit and no report yet: "/ unlimited", the first report's hours.
const unlimited: () => LicenseSnapshot = (): LicenseSnapshot => {
  return breached({
    payload: {
      activationMode: "online",
      instanceId: "instance-1",
      instances: [INSTANCES[0] as JSONObject],
    },
    userLimit: null,
    currentUserCount: 37,
    effectiveUserCount: 37,
    isSeatLimitEnforced: false,
    canAddMoreUsers: true,
    seatTone: "healthy",
    seatUsageDisplayPercent: null,
  });
};

// Activated offline: says why nothing is reported.
const offline: () => LicenseSnapshot = (): LicenseSnapshot => {
  return breached({
    payload: {
      activationMode: "offline",
      instanceId: "instance-1",
      instances: INSTANCES,
    },
    currentUserCount: 3,
    effectiveUserCount: 3,
    isSeatLimitEnforced: false,
    canAddMoreUsers: true,
    seatTone: "healthy",
    seatUsageDisplayPercent: 6,
  });
};

const SCENARIOS: Array<[string, () => LicenseSnapshot]> = [
  ["over its limit", breached],
  ["nearly full", approaching],
  ["unlimited", unlimited],
  ["activated offline", offline],
];

const APP_LANGUAGES: Array<[App, string]> = [
  ...ADMIN_DASHBOARD_LANGUAGES.map((language: string): [App, string] => {
    return ["AdminDashboard", language];
  }),
  ...DASHBOARD_LANGUAGES.map((language: string): [App, string] => {
    return ["Dashboard", language];
  }),
];

const drawIn: (
  app: App,
  language: string,
  license: LicenseSnapshot,
) => Promise<string> = async (
  app: App,
  language: string,
  license: LicenseSnapshot,
): Promise<string> => {
  await readIn(app, language);
  render(<LicenseDetails license={license} />);

  return drawnText();
};

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {},
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });

  followLanguageForDates(i18next);
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe("the license details in the reader's language", () => {
  test("are drawn in every language of both apps (the list is not empty)", () => {
    expect(APP_LANGUAGES.length).toBeGreaterThan(30);
    expect(ADMIN_DASHBOARD_LANGUAGES).toEqual(
      expect.arrayContaining(["de", "fa", "ar"]),
    );
  });

  test.each(APP_LANGUAGES)(
    "%s: %s leaves no English sentence of the details on the page",
    async (app: App, language: string) => {
      for (const [name, license] of SCENARIOS) {
        const drawn: string = await drawIn(app, language, license());

        expect({ name, left: englishLeftOn(drawn, app, language) }).toEqual({
          name,
          left: [],
        });

        cleanup();
      }
    },
  );

  test("English draws the English sentences (the check would see them)", async () => {
    const drawn: string = await drawIn("AdminDashboard", "en", breached());

    expect(englishLeftOn(drawn, "AdminDashboard", "de")).toEqual(
      expect.arrayContaining([
        "Licensed seats",
        "users over your licensed seats",
        "This installation enforces the seat limit: users above it cannot be invited, signed up or provisioned.",
        "Instances on this license",
      ]),
    );
  });

  test("German: the seat card, the advice and the instances in German", async () => {
    const drawn: string = await drawIn("AdminDashboard", "de", breached());

    expect(drawn).toContain("Lizenzierte Plätze");
    expect(drawn).toContain("Limit überschritten");
    expect(drawn).toContain("/ 50 Plätze");
    expect(drawn).toContain("2 über dem Limit");
    expect(drawn).toContain("2 Benutzer über Ihren lizenzierten Plätzen");
    expect(drawn).toContain("104 % der lizenzierten Plätze belegt");
    expect(drawn).toContain(
      "Diese Installation belegt 52 von 50 lizenzierten Plätzen.",
    );
    expect(drawn).toContain(
      "Oder schreiben Sie direkt an sales@oneuptime.com.",
    );
    expect(drawn).toContain("2 Instanzen");
    expect(drawn).toContain("Benutzer: 7");
    expect(drawn).toContain("Noch keine Nutzung gemeldet. Update verfügbar.");
    expect(
      screen.getByRole("button", { name: /Lizenz erweitern/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-label",
      "Nutzung der lizenzierten Plätze",
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      "104 % der lizenzierten Plätze belegt — 2 Benutzer über Ihren lizenzierten Plätzen",
    );
  });

  /*
   * The report's moment is written as every other moment in the product: in
   * the reader's timezone and clock, with no seconds, and the year only when
   * it is not this one (it was the browser's long form, seconds and all).
   */
  test("German: the dates are German dates", async () => {
    const drawn: string = await drawIn("AdminDashboard", "de", breached());
    const german: string = withDateDisplayLanguage("de", (): string => {
      return OneUptimeDate.getDateAsCompactLocalString(REPORTED_AT);
    });
    const english: string = withDateDisplayLanguage("en", (): string => {
      return OneUptimeDate.getDateAsCompactLocalString(REPORTED_AT);
    });

    expect(german).not.toBe(english);
    expect(drawn).toContain(`Zuletzt am ${german} an OneUptime gemeldet.`);
    expect(drawn).toContain(`Zuletzt gemeldet am ${german}.`);
    expect(drawn).not.toContain(english);
    expect(drawn).not.toContain(new Date(REPORTED_AT).toLocaleString("de-DE"));
  });

  /*
   * A 12-hour clock writes the half of the day with a dot of its own in
   * Persian and Spanish: a sentence that ends with that time ends with one
   * full stop, not two.
   */
  test.each(["fa", "es"])(
    "%s: a sentence that ends with a 12-hour time ends with one full stop",
    async (language: string) => {
      const prefers12Hours: jest.SpyInstance = jest
        .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
        .mockReturnValue(true);

      try {
        const time: string = withDateDisplayLanguage(language, (): string => {
          return OneUptimeDate.getDateAsCompactLocalString(REPORTED_AT);
        });
        const drawn: string = withoutIsolateMarks(
          await drawIn("AdminDashboard", language, breached()),
        );

        // The case this is about: the time itself ends with a dot.
        expect(time.endsWith(".")).toBe(true);
        expect(drawn).toContain(time);
        expect(drawn).not.toContain(`${time}.`);
      } finally {
        prefers12Hours.mockRestore();
      }
    },
  );

  test("German: an unlimited license and the first report's hours", async () => {
    const drawn: string = await drawIn("Dashboard", "de", unlimited());

    expect(drawn).toContain("/ unbegrenzt");
    expect(drawn).toContain("innerhalb von 24 Stunden gesendet.");
    expect(drawn).not.toContain("unlimited");
  });

  test("Russian and Arabic count the seat limit their own way", async () => {
    expect(await drawIn("AdminDashboard", "ru", approaching())).toContain(
      "из 50",
    );
    cleanup();

    const arabic: string = await drawIn("AdminDashboard", "ar", approaching());

    expect(arabic).toContain("من أصل 50");
    // Arabic writes Latin digits in OneUptime.
    expect(arabic).toContain("46");
  });

  test("Persian: Persian digits, and a Latin host name read left to right", async () => {
    const drawn: string = await drawIn("AdminDashboard", "fa", breached());

    expect(drawn).toContain("۵۲");
    expect(drawn).toContain("صندلی‌های پروانه");
    expect(drawn).toContain("این نمونه");

    const host: HTMLElement = screen.getByText("oneuptime.acme.internal");

    expect(host).toHaveAttribute("dir", "ltr");
    expect(host).toHaveClass("truncate");
  });

  test("Arabic: a Latin host name reads left to right too", async () => {
    await drawIn("AdminDashboard", "ar", breached());

    expect(screen.getByText("staging.acme.internal")).toHaveAttribute(
      "dir",
      "ltr",
    );
  });

  test("German: a host name reads as the page does, with no dir of its own", async () => {
    await drawIn("AdminDashboard", "de", breached());

    expect(screen.getByText("oneuptime.acme.internal")).not.toHaveAttribute(
      "dir",
    );
  });

  /*
   * A label and its figure, the number drawn bolder: in Russian the Admin
   * Dashboard's row said "пользователей: 7", lowercase where the line
   * begins, with the Backups page's mid-sentence count (#7134). Both apps
   * draw the same line now, capitalised.
   */
  test.each(["AdminDashboard", "Dashboard"] as Array<App>)(
    "%s: an instance's users begin their line in Russian, the number drawn bolder",
    async (app: App) => {
      await drawIn(app, "ru", breached());

      const row: HTMLElement = screen
        .getByText("oneuptime.acme.internal")
        .closest("li") as HTMLElement;
      const text: string = withoutIsolateMarks(row.textContent || "");

      expect(text).toContain("Пользователей: 7");
      expect(text).not.toContain("пользователей: 7");

      const count: HTMLElement | undefined = Array.from(
        row.querySelectorAll("span.font-medium"),
      ).find((element: Element): boolean => {
        return element.textContent === "7";
      }) as HTMLElement | undefined;

      expect(count).toBeDefined();
    },
  );

  test.each([
    ["de", "Benutzer: 7", "Benutzer: 1"],
    ["fa", "کاربران: ۷", "کاربران: ۱"],
    ["zh-CN", "用户数：7", "用户数：1"],
  ])(
    "%s: an instance's users read %s, and alike for one user",
    async (language: string, seven: string, one: string) => {
      const drawn: string = await drawIn(
        "AdminDashboard",
        language,
        breached(),
      );

      expect(drawn).toContain(seven);
      expect(drawn).toContain(one);
    },
  );
});
