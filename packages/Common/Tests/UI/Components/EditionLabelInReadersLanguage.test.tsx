import EditionLabel, {
  getEditionPillAccessibleName,
} from "../../../UI/Components/EditionLabel/EditionLabel";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import {
  ACCOUNTS_LANGUAGES,
  ADMIN_DASHBOARD_LANGUAGES,
  DASHBOARD_LANGUAGES,
} from "../../Helpers/TranslatedLanguages";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * THE EDITION BADGE AND ITS DIALOG IN THE READER'S LANGUAGE (#6470).
 *
 * The sign-in pages (Accounts) and the Admin Dashboard's header draw the
 * same edition badge as the Dashboard's footer, and each looks the badge's
 * words up in its own locale. Accounts and the Admin Dashboard had none of
 * them, so a German, Persian or Arabic reader read "Community Edition, Learn
 * more", the whole Community comparison, "Talk to Sales" and every license
 * notice in English. Each app's own locale files are read here, as the app
 * ships them, and the badge is drawn in every language the app offers: the
 * pill, the dialog and its buttons say the app's words, and no English
 * sentence of the badge is left on the page.
 *
 * The edition names stay as written in every language but Arabic, as the
 * docs and the Dashboard write them: they are the product's names.
 */

let isEnterpriseEdition: boolean = false;
let isMasterAdmin: boolean = false;
let isLoggedIn: boolean = false;

jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  Object.defineProperty(mockedConfig, "IS_ENTERPRISE_EDITION", {
    get: (): boolean => {
      return isEnterpriseEdition;
    },
  });

  Object.defineProperty(mockedConfig, "BILLING_ENABLED", {
    get: (): boolean => {
      return false;
    },
  });

  return mockedConfig;
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdmin;
      },
      isLoggedIn: (): boolean => {
        return isLoggedIn;
      },
    },
  };
});

let payload: JSONObject = {};
let fetchCount: number = 0;

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      fetch: (): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        fetchCount++;

        return Promise.resolve(new HTTPResponse<JSONObject>(200, payload, {}));
      },
      getFriendlyMessage: (err: unknown): string => {
        return String(err);
      },
    },
  };
});

type App = "Accounts" | "AdminDashboard" | "Dashboard";
type Words = Record<string, unknown>;

const FEATURE_SETS: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet",
);
const COMMON: string = path.resolve(__dirname, "../../..");

const localeCache: Map<string, Words> = new Map<string, Words>();

// An app's locale file, as the app ships it.
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
      path.join(FEATURE_SETS, app, "src", "Locales", `${language}.json`),
      "utf8",
    ),
  ) as Words;

  localeCache.set(cacheKey, words);

  return words;
};

const word: (words: Words, key: string) => string = (
  words: Words,
  key: string,
): string => {
  const value: unknown = words[key];

  expect({ key, isWorded: typeof value === "string" }).toEqual({
    key,
    isWorded: true,
  });

  return value as string;
};

const PLACEHOLDER: RegExp = /{{\s*\w+\s*}}/;

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
      return piece.length > 1;
    });
};

/*
 * The badge's words: every string of the badge and of the update status it
 * borrows that the app has an entry for. (The App's guard,
 * Tests/EditionBadgeWordsInEveryApp, reads them with the extractor and holds
 * each app to all of them.)
 */
const BADGE_FILES: ReadonlyArray<string> = [
  "UI/Components/EditionLabel/EditionLabel.tsx",
  "UI/Components/UpdateStatus/UpdateStatusPill.tsx",
];

const BADGE_STRINGS: Array<string> = Array.from(
  new Set<string>(
    BADGE_FILES.flatMap((file: string): Array<string> => {
      const source: string = fs.readFileSync(path.join(COMMON, file), "utf8");

      return Array.from(source.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)).flatMap(
        (match: RegExpMatchArray): Array<string> => {
          try {
            return [JSON.parse(`"${match[1]}"`) as string];
          } catch {
            return [];
          }
        },
      );
    }),
  ),
);

const badgeKeysOf: (app: App) => Array<string> = (app: App): Array<string> => {
  const english: Words = wordsOf(app, "en");

  return BADGE_STRINGS.flatMap((text: string): Array<string> => {
    return [text, `${text}_one`];
  }).filter((key: string): boolean => {
    return typeof english[key] === "string";
  });
};

// The product's names, which every language but Arabic writes as English does.
const PRODUCT_NAMES: ReadonlyArray<string> = [
  "Community Edition",
  "Enterprise Edition",
];

/*
 * The badge's English left on a page drawn in `language`: each piece of
 * one of its English sentences, but for the product's names, that none of
 * the language's own wordings holds (a code such as DISABLE_UPDATE_CHECK is
 * written as it is in every language).
 */
const englishLeftOn: (drawn: string, app: App, language: string) => string[] = (
  drawn: string,
  app: App,
  language: string,
): Array<string> => {
  const english: Words = wordsOf(app, "en");
  const words: Words = wordsOf(app, language);
  const keys: Array<string> = badgeKeysOf(app);
  // The language's own sentences: not one left as its English.
  const worded: Array<string> = keys
    .filter((key: string): boolean => {
      return typeof words[key] === "string" && words[key] !== english[key];
    })
    .map((key: string): string => {
      return words[key] as string;
    });
  const left: Set<string> = new Set<string>();

  for (const key of keys) {
    if (
      language !== "ar" &&
      PRODUCT_NAMES.includes(key) &&
      words[key] === english[key]
    ) {
      continue;
    }

    for (const piece of piecesOf(String(english[key]))) {
      if (piece.length < 5) {
        continue;
      }

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

// Everything the page says: its text, and the names and hints it gives.
const drawnText: () => string = (): string => {
  const parts: Array<string> = [document.body.textContent || ""];

  document.body
    .querySelectorAll("[aria-label], [title], [placeholder]")
    .forEach((element: Element): void => {
      for (const attribute of ["aria-label", "title", "placeholder"]) {
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

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const HOUR_IN_MS: number = 60 * 60 * 1000;

const inDays: (days: number) => string = (days: number): string => {
  return new Date(Date.now() + days * DAY_IN_MS).toISOString();
};

// What GET /global-config/license gives somebody who is not a master admin.
const publicPayload: (overrides?: JSONObject) => JSONObject = (
  overrides?: JSONObject,
): JSONObject => {
  return {
    edition: "enterprise",
    status: "valid",
    verification: "verified",
    graceReason: null,
    graceEndsAt: null,
    licenseValid: true,
    companyName: "Acme Inc",
    expiresAt: inDays(200),
    isEvaluation: false,
    isEvaluationLicense: false,
    ...(overrides || {}),
  };
};

// What it gives a master admin.
const adminPayload: (overrides?: JSONObject) => JSONObject = (
  overrides?: JSONObject,
): JSONObject => {
  return publicPayload({
    message: null,
    licenseKey: "acme-license-key",
    token: "signed.license.token",
    activationMode: "online",
    userLimit: 50,
    currentUserCount: 10,
    userCountUpdatedAt: "2026-01-01T00:00:00.000Z",
    instances: [],
    instanceId: "instance-1",
    currentVersion: "13.0.0",
    latestVersion: "13.0.0",
    latestVersionPublishedAt: null,
    latestVersionCheckedAt: null,
    isUpdateAvailable: false,
    isUpdateCheckDisabled: false,
    isSeatLimitEnforced: true,
    seatsInUse: 10,
    seatsRemaining: 40,
    canAddMoreUsers: true,
    ...(overrides || {}),
  });
};

// A master admin's installation licensed through AWS Marketplace, whose reports are being refused.
const marketplaceFailingPayload: () => JSONObject = (): JSONObject => {
  return adminPayload({
    status: "grace",
    graceReason: "expired",
    graceEndsAt: inDays(27),
    expiresAt: inDays(-3),
    verification: "none",
    companyName: null,
    licenseKey: null,
    token: null,
    activationMode: null,
    userLimit: null,
    currentUserCount: null,
    isSeatLimitEnforced: false,
    seatsInUse: null,
    seatsRemaining: null,
    features: "all",
    marketplace: "AWS",
    marketplaceBilling: {
      marketplace: "AWS",
      verifiedAt: inDays(-6),
      refusedAt: null,
      refusal: null,
      lastAcceptedReport: {
        hourStart: new Date(Date.now() - 6 * DAY_IN_MS).toISOString(),
        quantity: 42,
        reportId: "record-1",
        acceptedAt: new Date(
          Date.now() - 6 * DAY_IN_MS + HOUR_IN_MS,
        ).toISOString(),
      },
      pendingReportCount: 0,
      pendingUserHours: 0,
      lastProblem: null,
      lastProblemAt: null,
    },
  });
};

/*
 * The Enterprise plugin's license details, which the Admin Dashboard's
 * header hands the badge (and the sign-in pages do not): a master admin's
 * pill then asks for what they can do ("Renew license").
 */
const NoLicenseDetails: () => ReactElement = (): ReactElement => {
  return <></>;
};

let withLicenseDetails: boolean = false;

// The pill: the one button on the page until its dialog opens.
const drawPill: (words: Words) => Promise<HTMLElement> = async (
  words: Words,
): Promise<HTMLElement> => {
  const { container } = render(
    <EditionLabel
      licenseDetails={withLicenseDetails ? NoLicenseDetails : undefined}
    />,
  );
  const pill: HTMLElement = container.querySelector("button") as HTMLElement;

  expect(pill).toBeTruthy();

  if (isEnterpriseEdition) {
    await waitFor(() => {
      expect(fetchCount).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(pill.textContent).not.toContain(word(words, "Checking"));
    });
  }

  return pill;
};

// How each language lists the pill's words (#7133).
const LIST_SEPARATOR: Record<string, string> = {
  ar: "، ",
  fa: "، ",
  ja: "、",
  "zh-CN": "、",
  "zh-TW": "、",
};

const nameOf: (element: HTMLElement) => string = (
  element: HTMLElement,
): string => {
  return withoutIsolateMarks(element.getAttribute("aria-label") || "");
};

const openDialog: (pill: HTMLElement, words: Words) => Promise<void> = async (
  pill: HTMLElement,
  words: Words,
): Promise<void> => {
  fireEvent.click(pill);

  await waitFor(() => {
    expect(
      screen.getAllByRole("button", { name: word(words, "Close") }).length,
    ).toBeGreaterThan(0);
  });

  // Opening the dialog checks the license again.
  if (isEnterpriseEdition) {
    await waitFor(() => {
      expect(pageText()).not.toContain(
        word(words, "Checking your license with OneUptime..."),
      );
    });
  }
};

const pageText: () => string = (): string => {
  return withoutIsolateMarks(document.body.textContent || "");
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
});

beforeEach(() => {
  isEnterpriseEdition = false;
  isMasterAdmin = false;
  isLoggedIn = false;
  withLicenseDetails = false;
  fetchCount = 0;
  payload = {};
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe("the badge's words, as read from the files", () => {
  test("are the badge's sentences, the pill's tag among them", () => {
    // Many: a read that found nothing would pass the checks below.
    expect(badgeKeysOf("Accounts").length).toBeGreaterThan(120);
    expect(badgeKeysOf("Accounts")).toEqual(
      expect.arrayContaining([
        "Community Edition",
        "Learn more",
        "Talk to Sales",
        "Close",
        "{{count}} days left_one",
        "Evaluation license",
      ]),
    );
    // The pill's name is its words listed (#7133), no template of its own.
    expect(badgeKeysOf("Accounts")).not.toContain(
      "{{edition}}, Evaluation license, {{action}}",
    );
  });

  test("an English sentence left on a German page is found", () => {
    const english: string = word(
      wordsOf("Accounts", "en"),
      "You are running the free, open-source build of OneUptime.",
    );

    expect(englishLeftOn(`Hallo\n${english}`, "Accounts", "de")).toEqual([
      english,
    ]);
    expect(
      englishLeftOn(
        word(
          wordsOf("Accounts", "de"),
          "You are running the free, open-source build of OneUptime.",
        ),
        "Accounts",
        "de",
      ),
    ).toEqual([]);
  });
});

describe("on the sign-in pages (Accounts)", () => {
  test.each(ACCOUNTS_LANGUAGES)(
    "%s: the Community Edition pill and its comparison",
    async (language: string) => {
      await readIn("Accounts", language);
      const words: Words = wordsOf("Accounts", language);
      const pill: HTMLElement = await drawPill(words);

      expect(nameOf(pill)).toContain(word(words, "Community Edition"));
      expect(nameOf(pill)).toContain(word(words, "Learn more"));
      expect(pill).toHaveTextContent(word(words, "Learn more"));

      await openDialog(pill, words);

      expect(
        screen.getByRole("button", { name: word(words, "Talk to Sales") }),
      ).toBeInTheDocument();
      expect(pageText()).toContain(
        word(
          words,
          "You are running the free, open-source build of OneUptime.",
        ),
      );
      expect(pageText()).toContain(word(words, "Legal indemnification."));
      expect({
        language,
        english: englishLeftOn(drawnText(), "Accounts", language),
      }).toEqual({ language, english: [] });
    },
  );

  test.each(ACCOUNTS_LANGUAGES)(
    "%s: an unlicensed installation's trial, to somebody signing in",
    async (language: string) => {
      isEnterpriseEdition = true;
      payload = publicPayload({
        status: "grace",
        graceReason: "unlicensed",
        verification: "none",
        graceEndsAt: inDays(10),
        companyName: null,
        expiresAt: null,
      });
      await readIn("Accounts", language);
      const words: Words = wordsOf("Accounts", language);
      const pill: HTMLElement = await drawPill(words);

      for (const piece of piecesOf(
        word(words, "Enterprise Edition (Trial, {{daysLeft}})"),
      )) {
        expect(nameOf(pill)).toContain(piece);
      }

      expect(nameOf(pill)).toContain(word(words, "View details"));

      await openDialog(pill, words);

      const notice: HTMLElement = await screen.findByTestId(
        "enterprise-license-trial-notice",
      );

      expect(withoutIsolateMarks(notice.textContent || "")).toContain(
        word(words, "No Enterprise license is installed."),
      );
      expect({
        language,
        english: englishLeftOn(drawnText(), "Accounts", language),
      }).toEqual({ language, english: [] });
    },
  );

  test.each(ACCOUNTS_LANGUAGES)(
    "%s: a license that lapsed, to somebody signing in",
    async (language: string) => {
      isEnterpriseEdition = true;
      payload = publicPayload({
        status: "expired",
        licenseValid: false,
        expiresAt: inDays(-40),
      });
      await readIn("Accounts", language);
      const words: Words = wordsOf("Accounts", language);
      const pill: HTMLElement = await drawPill(words);

      expect(nameOf(pill)).toContain(
        word(words, "Enterprise Edition (License Expired)"),
      );

      await openDialog(pill, words);

      expect(pageText()).toContain(
        word(words, "A master admin has to activate this license"),
      );
      expect({
        language,
        english: englishLeftOn(drawnText(), "Accounts", language),
      }).toEqual({ language, english: [] });
    },
  );
});

describe("in the Admin Dashboard's header", () => {
  beforeEach(() => {
    isEnterpriseEdition = true;
    isMasterAdmin = true;
    isLoggedIn = true;
    withLicenseDetails = true;
  });

  test.each(ADMIN_DASHBOARD_LANGUAGES)(
    "%s: a license in its grace period, and a major upgrade",
    async (language: string) => {
      payload = adminPayload({
        status: "grace",
        graceReason: "expired",
        graceEndsAt: inDays(5),
        expiresAt: inDays(-25),
        latestVersion: "14.0.0",
        latestVersionPublishedAt: inDays(-2),
        latestVersionCheckedAt: inDays(0),
        isUpdateAvailable: true,
      });
      await readIn("AdminDashboard", language);
      const words: Words = wordsOf("AdminDashboard", language);
      const pill: HTMLElement = await drawPill(words);

      expect(nameOf(pill)).toContain(
        word(words, "Enterprise Edition (License Expired, Grace Period)"),
      );
      expect(nameOf(pill)).toContain(word(words, "Renew license"));

      await openDialog(pill, words);

      expect(
        screen.getByRole("button", { name: word(words, "Manage license") }),
      ).toBeInTheDocument();
      expect(pageText()).toContain(word(words, "This installation"));
      expect({
        language,
        english: englishLeftOn(drawnText(), "AdminDashboard", language),
      }).toEqual({ language, english: [] });
    },
  );

  test.each(ADMIN_DASHBOARD_LANGUAGES)(
    "%s: a cloud marketplace that is not taking the usage reports",
    async (language: string) => {
      payload = marketplaceFailingPayload();
      await readIn("AdminDashboard", language);
      const words: Words = wordsOf("AdminDashboard", language);
      const pill: HTMLElement = await drawPill(words);

      expect(nameOf(pill)).toContain(
        word(words, "Enterprise Edition (Marketplace Reports Failing)"),
      );
      expect(nameOf(pill)).toContain(word(words, "Check billing"));

      await openDialog(pill, words);

      expect({
        language,
        english: englishLeftOn(drawnText(), "AdminDashboard", language),
      }).toEqual({ language, english: [] });
    },
  );
});

describe("the badge's numbers in Persian", () => {
  /*
   * A Persian page writes its numbers in Persian digits, as the days left
   * on the pill are (۱۰ روز مانده). The trial's and the grace period's
   * length and a marketplace's user-hours were written in Latin digits in
   * the same notices ("دورهٔ آزمایشی 14 روزه").
   */
  test("the trial's 14 days, in the notice somebody signing in sees", async () => {
    isEnterpriseEdition = true;
    payload = publicPayload({
      status: "grace",
      graceReason: "unlicensed",
      verification: "none",
      graceEndsAt: inDays(10),
      companyName: null,
      expiresAt: null,
    });
    await readIn("Accounts", "fa");
    const words: Words = wordsOf("Accounts", "fa");

    await openDialog(await drawPill(words), words);

    const notice: string = withoutIsolateMarks(
      (await screen.findByTestId("enterprise-license-trial-notice"))
        .textContent || "",
    );

    expect(notice).toContain("دورهٔ آزمایشی ۱۴ روزه");
    expect(notice).toContain("۱۰ روز مانده");
    expect(notice).not.toContain("14");
  });

  /*
   * Persian keeps "Enterprise Edition" in Latin letters in the trial's
   * title. Without an isolate around the days left, the browser drew their
   * Persian digits inside that Latin run, on the far side of the colon:
   * "دورهٔ آزمایشی ۱۰ :Enterprise Edition روز مانده".
   */
  test("the trial's title sets its days left apart from the Latin edition name", async () => {
    isEnterpriseEdition = true;
    payload = publicPayload({
      status: "grace",
      graceReason: "unlicensed",
      verification: "none",
      graceEndsAt: inDays(10),
      companyName: null,
      expiresAt: null,
    });
    await readIn("Accounts", "fa");
    const words: Words = wordsOf("Accounts", "fa");

    await openDialog(await drawPill(words), words);

    const title: string =
      (
        await screen.findByTestId("enterprise-license-trial-notice")
      ).querySelector("h4")?.textContent || "";

    expect(title).toBe(
      `دورهٔ آزمایشی Enterprise Edition: ${FIRST_STRONG_ISOLATE}۱۰ روز مانده${POP_DIRECTIONAL_ISOLATE}`,
    );
  });

  test("the grace period's 30 days and a marketplace's user-hours, in the Admin Dashboard", async () => {
    isEnterpriseEdition = true;
    isMasterAdmin = true;
    isLoggedIn = true;
    withLicenseDetails = true;
    payload = adminPayload({
      status: "grace",
      graceReason: "expired",
      graceEndsAt: inDays(5),
      expiresAt: inDays(-25),
    });
    await readIn("AdminDashboard", "fa");
    const words: Words = wordsOf("AdminDashboard", "fa");

    await openDialog(await drawPill(words), words);

    const notice: string = withoutIsolateMarks(
      (await screen.findByTestId("enterprise-license-grace-notice"))
        .textContent || "",
    );

    expect(notice).toContain("دورهٔ مهلت ۳۰ روزه");
    expect(notice).not.toContain("30");

    cleanup();
    payload = marketplaceFailingPayload();

    await openDialog(await drawPill(words), words);

    expect(pageText()).toContain("(ساعت‌های کاربر: ۴۲)");
  });
});

describe("an evaluation license's tag on the pill", () => {
  /*
   * The tag says "Evaluation license", the dialog's own heading for it. It
   * said "Evaluation", which is also an SLO card's title: German words that
   * one "Auswertung" (assessing), never a license for trying OneUptime out.
   */
  test.each(DASHBOARD_LANGUAGES)("%s", async (language: string) => {
    isEnterpriseEdition = true;
    isMasterAdmin = true;
    isLoggedIn = true;
    payload = adminPayload({ isEvaluation: true, isEvaluationLicense: true });
    await readIn("Dashboard", language);
    const words: Words = wordsOf("Dashboard", language);
    const pill: HTMLElement = await drawPill(words);

    await waitFor(() => {
      expect(pill).toHaveTextContent(word(words, "Evaluation license"));
    });

    const tag: string = word(words, "Evaluation license");
    const assessing: string = word(words, "Evaluation");

    if (!tag.includes(assessing)) {
      expect(pill).not.toHaveTextContent(assessing);
    }

    // Every word the pill shows, in the order it shows them.
    expect(nameOf(pill)).toBe(
      [
        word(words, "Enterprise Edition"),
        tag,
        word(words, "View details"),
      ].join(LIST_SEPARATOR[language] || ", "),
    );

    // Mid-sentence, the way the language writes it there ("licence d'évaluation").
    expect(nameOf(pill).toLocaleLowerCase(language)).toContain(
      tag.toLocaleLowerCase(language),
    );
  });

  test("German says Testlizenz, not Auswertung", async () => {
    isEnterpriseEdition = true;
    isMasterAdmin = true;
    isLoggedIn = true;
    payload = adminPayload({ isEvaluation: true, isEvaluationLicense: true });
    await readIn("Dashboard", "de");
    const pill: HTMLElement = await drawPill(wordsOf("Dashboard", "de"));

    await waitFor(() => {
      expect(pill).toHaveTextContent("Testlizenz");
    });
    expect(pill).not.toHaveTextContent("Auswertung");
    expect(nameOf(pill)).toBe(
      "Enterprise Edition, Testlizenz, Details anzeigen",
    );
  });
});

/*
 * THE PILL'S NAME, LISTED AS THE READER'S LANGUAGE LISTS WORDS (#7133).
 *
 * The pill's accessible name is the words it shows - the edition, the
 * evaluation tag when there is one, the action - so voice-control users can
 * say what they see. It was a template of placeholders alone ("{{edition}},
 * {{action}}"), which no language words, so an Arabic or Persian name read
 * back and shown on a braille display with English's Latin comma. Each part
 * is joined as the language lists words now: "، " in Arabic and Persian,
 * "、" in Chinese and Japanese, ", " in the others.
 */
describe("the pill's name, listed as the reader's language lists words", () => {
  const EXPECTED_SEPARATOR: Array<[string, string]> = [
    ["ar", "، "],
    ["fa", "، "],
    ["zh-CN", "、"],
    ["zh-TW", "、"],
    ["ja", "、"],
    ["en", ", "],
    ["de", ", "],
    ["ru", ", "],
  ];

  test.each(EXPECTED_SEPARATOR)(
    "%s: the Community Edition pill, joined with %p",
    async (language: string, separator: string) => {
      await readIn("Dashboard", language);
      const words: Words = wordsOf("Dashboard", language);
      const pill: HTMLElement = await drawPill(words);
      const parts: Array<string> = [
        word(words, "Community Edition"),
        word(words, "Learn more"),
      ];

      expect(nameOf(pill)).toBe(parts.join(separator));
      // The name holds the words the pill shows (WCAG 2.5.3).
      expect(withoutIsolateMarks(pill.textContent || "")).toContain(
        word(words, "Learn more"),
      );
    },
  );

  test.each(EXPECTED_SEPARATOR)(
    "%s: an evaluation license's pill, its tag between, joined with %p",
    async (language: string, separator: string) => {
      isEnterpriseEdition = true;
      isMasterAdmin = true;
      isLoggedIn = true;
      payload = adminPayload({ isEvaluation: true, isEvaluationLicense: true });
      await readIn("Dashboard", language);
      const words: Words = wordsOf("Dashboard", language);
      const pill: HTMLElement = await drawPill(words);

      await waitFor(() => {
        expect(pill).toHaveTextContent(word(words, "Evaluation license"));
      });

      const parts: Array<string> = [
        word(words, "Enterprise Edition"),
        word(words, "Evaluation license"),
        word(words, "View details"),
      ];

      expect(nameOf(pill)).toBe(parts.join(separator));

      for (const part of parts) {
        expect(withoutIsolateMarks(pill.textContent || "")).toContain(part);
      }
    },
  );

  test.each(["ar", "fa"])(
    "%s: no Latin comma in the name, with or without the tag",
    async (language: string) => {
      await readIn("Dashboard", language);
      const words: Words = wordsOf("Dashboard", language);

      expect(nameOf(await drawPill(words))).not.toContain(",");
      cleanup();

      isEnterpriseEdition = true;
      isMasterAdmin = true;
      isLoggedIn = true;
      payload = adminPayload({ isEvaluation: true, isEvaluationLicense: true });
      const pill: HTMLElement = await drawPill(words);

      await waitFor(() => {
        expect(pill).toHaveTextContent(word(words, "Evaluation license"));
      });
      expect(nameOf(pill)).not.toContain(",");
      expect(nameOf(pill)).toContain("،");
    },
  );

  test.each(["Accounts", "AdminDashboard"] as Array<App>)(
    "%s: Arabic and Persian list the pill's words with their own comma too",
    async (app: App) => {
      for (const language of ["ar", "fa"]) {
        await readIn(app, language);
        const words: Words = wordsOf(app, language);

        expect(nameOf(await drawPill(words))).toBe(
          [word(words, "Community Edition"), word(words, "Learn more")].join(
            "، ",
          ),
        );
        cleanup();
      }
    },
  );

  test("the name is built from the pill's words, never a template (getEditionPillAccessibleName)", () => {
    const arabic: Translator = createTranslator(undefined, "ar");
    const japanese: Translator = createTranslator(undefined, "ja");
    const english: Translator = createTranslator(undefined, "en");

    expect(
      getEditionPillAccessibleName({
        edition: "إصدار المؤسسات",
        evaluationTag: "ترخيص تقييم",
        action: "عرض التفاصيل",
        translator: arabic,
      }),
    ).toBe("إصدار المؤسسات، ترخيص تقييم، عرض التفاصيل");
    expect(
      getEditionPillAccessibleName({
        edition: "Community Edition",
        evaluationTag: null,
        action: "詳細を見る",
        translator: japanese,
      }),
    ).toBe("Community Edition、詳細を見る");
    expect(
      getEditionPillAccessibleName({
        edition: "Enterprise Edition",
        evaluationTag: "",
        action: "Learn more",
        translator: english,
      }),
    ).toBe("Enterprise Edition, Learn more");
  });
});

describe("the pill where a line is too short for it", () => {
  /*
   * A phone's sign-in page, the Admin Dashboard's header beside its logo,
   * or a language whose words are longer than English's: the pill wraps
   * between its parts and never inside its tag or its action, which broke
   * in two ("EVALUATION / LICENSE", "Details / anzeigen") with the pill's
   * round ends cutting into them. Its corners round a two-line box.
   */
  // The parts that stay whole: the action, last, and the tag, if any.
  const partsOf: (pill: HTMLElement) => Array<Element> = (
    pill: HTMLElement,
  ): Array<Element> => {
    return [
      ...Array.from(pill.querySelectorAll("span.uppercase")),
      pill.lastElementChild as Element,
    ];
  };

  const expectWrapsBetweenItsParts: (
    pill: HTMLElement,
    words: Words,
    action: string,
  ) => void = (pill: HTMLElement, words: Words, action: string): void => {
    expect(pill).toHaveClass("flex-wrap", "max-w-full", "rounded-2xl");
    expect(pill).not.toHaveClass("rounded-full");

    const unbroken: Array<Element> = partsOf(pill);

    expect(
      withoutIsolateMarks(unbroken[unbroken.length - 1]!.textContent || ""),
    ).toBe(word(words, action));

    for (const part of unbroken) {
      expect(part).toHaveClass("whitespace-nowrap");
    }

    /*
     * The status dot and the warning icon keep their size, beside the
     * edition they mark: a state too long for the line wraps inside its own
     * words, and never leaves the dot alone on a line above them.
     */
    const edition: HTMLElement | null = pill.querySelector(
      "[data-testid='edition-label-pill-edition']",
    );
    const marks: Array<Element> = Array.from(
      pill.querySelectorAll("span.h-2, svg"),
    );

    expect(edition).toHaveClass("min-w-0");
    expect(edition?.lastElementChild).toHaveClass("min-w-0");
    expect(marks.length).toBeGreaterThan(0);

    for (const mark of marks) {
      expect(mark).toHaveClass("shrink-0");
      expect(edition?.contains(mark)).toBe(true);
    }
  };

  beforeEach(() => {
    isEnterpriseEdition = true;
    isMasterAdmin = true;
    isLoggedIn = true;
  });

  test.each(["de", "fr", "ru", "ar"])(
    "%s: an evaluation license's tag and its action stay whole",
    async (language: string) => {
      payload = adminPayload({ isEvaluation: true, isEvaluationLicense: true });
      await readIn("Dashboard", language);
      const words: Words = wordsOf("Dashboard", language);
      const pill: HTMLElement = await drawPill(words);

      await waitFor(() => {
        expect(pill).toHaveTextContent(word(words, "Evaluation license"));
      });

      expectWrapsBetweenItsParts(pill, words, "View details");
      expect(partsOf(pill).length).toBe(2);
    },
  );

  test("a license in its grace period (amber) and one over its seats (red) wrap the same way", async () => {
    withLicenseDetails = true;
    payload = adminPayload({
      status: "grace",
      graceReason: "expired",
      graceEndsAt: inDays(5),
      expiresAt: inDays(-25),
    });
    await readIn("AdminDashboard", "de");
    const words: Words = wordsOf("AdminDashboard", "de");
    const grace: HTMLElement = await drawPill(words);

    expect(grace).toHaveClass("border-amber-200");
    expect(grace.querySelector("svg")).toBeTruthy();
    expectWrapsBetweenItsParts(grace, words, "Renew license");

    cleanup();
    payload = adminPayload({
      currentUserCount: 52,
      seatsInUse: 52,
      seatsRemaining: -2,
      canAddMoreUsers: false,
    });
    const over: HTMLElement = await drawPill(words);

    await waitFor(() => {
      expect(over).toHaveClass("border-red-200");
    });
    expectWrapsBetweenItsParts(over, words, "User limit exceeded");
  });

  test("the Community Edition pill on a sign-in page wraps the same way", async () => {
    isEnterpriseEdition = false;
    await readIn("Accounts", "de");
    const words: Words = wordsOf("Accounts", "de");
    const pill: HTMLElement = await drawPill(words);

    expectWrapsBetweenItsParts(pill, words, "Learn more");
  });
});

describe("the days left, in the middle of a sentence", () => {
  /*
   * "{{count}} days left" stands inside "Enterprise Edition (Testphase,
   * {{daysLeft}})" and after "Testphase der Enterprise Edition:", where
   * German and Spanish write it in lower case: "noch 10 Tage", "quedan 10
   * días" - not "Noch", "Quedan".
   */
  test.each([
    ["de", "Enterprise Edition (Testphase, noch 10 Tage)"],
    ["es", "Enterprise Edition (prueba, quedan 10 días)"],
  ])("%s: %s", async (language: string, name: string) => {
    isEnterpriseEdition = true;
    payload = publicPayload({
      status: "grace",
      graceReason: "unlicensed",
      verification: "none",
      graceEndsAt: inDays(10),
      companyName: null,
      expiresAt: null,
    });
    await readIn("Accounts", language);

    expect(nameOf(await drawPill(wordsOf("Accounts", language)))).toContain(
      name,
    );
  });

  test.each(["Dashboard", "Accounts", "AdminDashboard"] as Array<App>)(
    "%s: German and Spanish start the days left in lower case",
    (app: App) => {
      for (const language of ["de", "es"]) {
        const words: Words = wordsOf(app, language);

        for (const key of ["{{count}} days left", "{{count}} days left_one"]) {
          const daysLeft: string = word(words, key);
          const first: string = daysLeft.charAt(0);

          expect({ app, language, key, first }).toEqual({
            app,
            language,
            key,
            first: first.toLocaleLowerCase(language),
          });
          expect(first).not.toBe(first.toLocaleUpperCase(language));
        }
      }
    },
  );
});

describe("the company a license names", () => {
  /*
   * A Latin company name in an Arabic or Persian dialog reads left to
   * right, cut short at its own end rather than losing its start, and
   * still lines up under its label; on a German page it reads as the page
   * does.
   */
  const COMPANY: string = "Nordwind Logistik und Datenverarbeitung GmbH";

  const companyLine: (language: string) => Promise<HTMLElement> = async (
    language: string,
  ): Promise<HTMLElement> => {
    isEnterpriseEdition = true;
    isMasterAdmin = true;
    isLoggedIn = true;
    withLicenseDetails = true;
    payload = adminPayload({ companyName: COMPANY });
    await readIn("AdminDashboard", language);
    const words: Words = wordsOf("AdminDashboard", language);

    await openDialog(await drawPill(words), words);

    return screen.getByTitle(COMPANY);
  };

  test.each(["ar", "fa"])(
    "%s: reads left to right, cut short at its end",
    async (language: string) => {
      const line: HTMLElement = await companyLine(language);

      expect(line).toHaveAttribute("dir", "ltr");
      expect(line).toHaveClass("truncate");
      expect(line).toHaveTextContent(COMPANY);
    },
  );

  test("de: reads as the page does", async () => {
    const line: HTMLElement = await companyLine("de");

    expect(line).not.toHaveAttribute("dir");
    expect(line).toHaveClass("truncate");
  });
});
