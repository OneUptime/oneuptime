import {
  LICENSE_DETAILS_PLURALS,
  LicenseDetailsCopy,
} from "../../../AdminDashboard/License/LicenseDetailsCopy";
import {
  LICENSE_SETTINGS_PLURALS,
  LicenseSettingsCopy,
  LicenseStatusCopy,
  SALES_EMAIL,
} from "../../../AdminDashboard/License/LicenseSettingsCopy";
import LicenseSettingsView from "../../../AdminDashboard/License/LicenseSettingsView";
import { writeLicenseDate } from "../../../AdminDashboard/License/LicenseStatus";
import { withoutIsolateMarks } from "Common/Tests/Helpers/IsolateMarks";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "Common/Types/ReadingDirection";
import {
  inEnglishDates,
  withDateDisplayLanguage,
} from "Common/Types/DateLanguage";
import { JSONObject } from "Common/Types/JSON";
import {
  GRACE_ENFORCEMENT_TEMPLATE,
  LICENSE_LAPSED_STATE,
  TRIAL_ENFORCEMENT_TEMPLATE,
} from "Common/UI/Components/EditionLabel/EditionLabel";
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import { PluralTemplate } from "Common/UI/Utils/TranslateTemplate";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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
 * SETTINGS > LICENSE IN THE READER'S LANGUAGE (#7132).
 *
 * The page drawn from the Admin Dashboard's own locale files, as it ships
 * them, in German, Arabic, Persian and Russian, in the three states a
 * master admin finds it in - no license yet (the trial, with the activation
 * form), a license added with a key, and one activated offline with a
 * token - and with a license the client could not use:
 *
 *   - no English sentence of the page is left: not its status, its facts,
 *     its buttons, its form or the license cards below it;
 *   - its dates are the reader's ("2. März 2027", Persian digits), never
 *     the browser's or English's;
 *   - what is not OneUptime's to word is drawn as written, read in its own
 *     direction on an Arabic or Persian page: the instance ID, the licensed
 *     company's name, the sales address, and what the license client said.
 */

type Words = Record<string, unknown>;

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const localeCache: Map<string, Words> = new Map<string, Words>();

const wordsOf: (language: string) => Words = (language: string): Words => {
  const cached: Words | undefined = localeCache.get(language);

  if (cached) {
    return cached;
  }

  const words: Words = JSON.parse(
    fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages/App/FeatureSet/AdminDashboard/src/Locales",
        `${language}.json`,
      ),
      "utf8",
    ),
  ) as Words;

  localeCache.set(language, words);

  return words;
};

const word: (language: string, key: string) => string = (
  language: string,
  key: string,
): string => {
  return String(wordsOf(language)[key]);
};

const pluralKeys: (plurals: ReadonlyArray<PluralTemplate>) => string[] = (
  plurals: ReadonlyArray<PluralTemplate>,
): Array<string> => {
  return plurals.flatMap((plural: PluralTemplate): Array<string> => {
    return [plural.other, `${plural.other}_one`];
  });
};

/*
 * What the page's shared components draw on it in words: the license key's
 * "Click to reveal" (HiddenText), its copy buttons and the error page's
 * retry. They were English in Persian, Russian and ten more Admin languages,
 * on a page otherwise in the reader's own (#7132's review).
 */
const SHARED_WORDS_ON_THE_PAGE: ReadonlyArray<string> = [
  "Click to reveal",
  "Copy to clipboard",
  "Copied to clipboard",
  "Copy failed",
  "Try again",
];

// Every key the page reads, its license cards' among them.
const KEYS: Array<string> = [
  ...SHARED_WORDS_ON_THE_PAGE,
  ...Object.values(LicenseSettingsCopy),
  ...Object.values(LicenseStatusCopy),
  TRIAL_ENFORCEMENT_TEMPLATE,
  GRACE_ENFORCEMENT_TEMPLATE,
  LICENSE_LAPSED_STATE,
  ...pluralKeys(LICENSE_SETTINGS_PLURALS),
  ...Object.values(LicenseDetailsCopy),
  ...pluralKeys(LICENSE_DETAILS_PLURALS),
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
 * The page's English left on a page drawn in `language`: each piece of one
 * of its English sentences that none of the language's own wordings holds
 * ("OneUptime" is OneUptime in every language, French "Activation" is
 * French).
 */
const englishLeftOn: (drawn: string, language: string) => Array<string> = (
  drawn: string,
  language: string,
): Array<string> => {
  const english: Words = wordsOf("en");
  const worded: Array<string> = KEYS.map((key: string): string => {
    return word(language, key);
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

// Everything the page says: its text, names, hints, titles and placeholders.
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

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

// Whole days from now, at noon UTC: a date that is the same in every zone.
const inDays: (days: number) => string = (days: number): string => {
  const date: Date = new Date(Date.now() + days * DAY_IN_MS);

  date.setUTCHours(12, 0, 0, 0);

  return date.toISOString();
};

const INSTANCE_ID: string = "inst-7f3a9c2e";
const COMPANY: string = "Acme Inc";
const SERVER_MESSAGE: string =
  "The stored license does not match this instance.";

const TRIAL_ENDS_AT: string = inDays(10);
const EXPIRES_AT: string = inDays(200);

const licensedPayload: (overrides?: JSONObject) => JSONObject = (
  overrides?: JSONObject,
): JSONObject => {
  return {
    edition: "enterprise",
    status: "valid",
    verification: "verified",
    graceReason: null,
    graceEndsAt: null,
    licenseValid: true,
    companyName: COMPANY,
    expiresAt: EXPIRES_AT,
    isEvaluation: false,
    marketplace: null,
    message: null,
    licenseKey: "acme-license-key",
    token: "signed.license.token",
    activationMode: "online",
    instanceId: INSTANCE_ID,
    userLimit: 50,
    currentUserCount: 10,
    isSeatLimitEnforced: false,
    canAddMoreUsers: true,
    currentVersion: "13.0.0",
    latestVersion: "13.0.0",
    userCountUpdatedAt: inDays(-1),
    instances: [
      {
        instanceId: INSTANCE_ID,
        host: "oneuptime.acme.internal",
        userCount: 7,
        lastReportedAt: inDays(-1),
        version: "13.0.0",
      },
    ],
    ...(overrides || {}),
  };
};

// No license yet: the first-run trial, and the form to add one.
const noLicense: () => JSONObject = (): JSONObject => {
  return licensedPayload({
    status: "grace",
    graceReason: "unlicensed",
    graceEndsAt: TRIAL_ENDS_AT,
    verification: "none",
    companyName: "",
    expiresAt: null,
    licenseKey: null,
    token: null,
    activationMode: null,
    instances: [],
  });
};

const licensed: () => JSONObject = (): JSONObject => {
  return licensedPayload();
};

// Activated offline with a signed token: no key, nothing reported.
const offline: () => JSONObject = (): JSONObject => {
  return licensedPayload({ activationMode: "offline", licenseKey: null });
};

// A license the client could not use, and said why.
const invalid: () => JSONObject = (): JSONObject => {
  return licensedPayload({
    status: "invalid",
    licenseValid: false,
    message: SERVER_MESSAGE,
  });
};

const STATES: Array<[string, () => JSONObject]> = [
  ["no license", noLicense],
  ["licensed", licensed],
  ["offline", offline],
  ["not valid", invalid],
];

const LANGUAGES: Array<string> = ["de", "ar", "fa", "ru"];

let answer: JSONObject = licensed();
let refreshAnswer: JSONObject = licensed();

jest.mock("../../../AdminDashboard/License/LicenseSettingsAPI", () => {
  return {
    __esModule: true,
    isLicenseSettingsAvailable: (): boolean => {
      return true;
    },
    fetchLicense: (): Promise<JSONObject> => {
      return Promise.resolve(answer);
    },
    refreshLicense: (): Promise<JSONObject> => {
      return Promise.resolve(refreshAnswer);
    },
    activateLicenseKey: (): Promise<JSONObject> => {
      return Promise.resolve(answer);
    },
    activateLicenseToken: (): Promise<JSONObject> => {
      return Promise.resolve(answer);
    },
  };
});

const readIn: (language: string) => Promise<void> = async (
  language: string,
): Promise<void> => {
  await act(async () => {
    for (const code of [language, "en"]) {
      i18next.removeResourceBundle(code, "translation");
      i18next.addResourceBundle(code, "translation", wordsOf(code), true, true);
    }

    await i18next.changeLanguage(language);
  });
};

// The page in `language`, once it has read the license.
const drawIn: (
  language: string,
  payload: JSONObject,
) => Promise<string> = async (
  language: string,
  payload: JSONObject,
): Promise<string> => {
  answer = payload;
  await readIn(language);
  render(<LicenseSettingsView />);
  await screen.findByTestId("license-status");

  return drawnText();
};

// A date as `language` writes one on the page: "2. März 2027", "۲ مارس ۲۰۲۷".
const dateIn: (language: string, iso: string) => string = (
  language: string,
  iso: string,
): string => {
  return withDateDisplayLanguage(language, (): string => {
    return writeLicenseDate(new Date(iso));
  });
};

const englishDate: (iso: string) => string = (iso: string): string => {
  return inEnglishDates((): string => {
    return writeLicenseDate(new Date(iso));
  });
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
  answer = licensed();
  refreshAnswer = licensed();
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe("Settings > License in the reader's language", () => {
  test.each(LANGUAGES)(
    "%s: no English sentence is left, in every state",
    async (language: string) => {
      for (const [name, payload] of STATES) {
        const drawn: string = await drawIn(language, payload());

        expect({ name, left: englishLeftOn(drawn, language) }).toEqual({
          name,
          left: [],
        });

        cleanup();
      }
    },
  );

  test("English draws the English sentences (the check would see them)", async () => {
    const trial: string = await drawIn("en", noLicense());

    expect(englishLeftOn(trial, "de")).toEqual(
      expect.arrayContaining([
        "No Enterprise license is installed.",
        "License key",
        "Validate your license key with OneUptime to activate it. Need a license key? Contact our sales team at",
        "No internet access? Activate offline with a license token",
        "Validate License",
        "Enter your enterprise license key",
      ]),
    );
    cleanup();

    const page: string = await drawIn("en", licensed());

    expect(englishLeftOn(page, "fa")).toEqual(
      expect.arrayContaining([
        "License active",
        "Enterprise features are on for this installation.",
        "Licensed to",
        "Instance ID",
        "Refresh license",
        "Change license key",
        "The Enterprise license of this installation.",
      ]),
    );
  });

  test("German: the status, the facts and the buttons", async () => {
    const drawn: string = await drawIn("de", licensed());

    expect(drawn).toContain("Lizenz aktiv");
    expect(drawn).toContain(
      "Enterprise-Funktionen sind für diese Installation aktiviert.",
    );
    expect(drawn).toContain("Die Enterprise-Lizenz dieser Installation.");
    expect(drawn).toContain("Lizenziert für");
    expect(drawn).toContain("Läuft ab");
    expect(drawn).toContain("Lizenzschlüssel");
    expect(drawn).toContain("Instanz-ID");
    expect(drawn).toContain("Benutzer: 7");
    expect(
      screen.getByRole("button", { name: /Lizenz aktualisieren/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Lizenzschlüssel ändern/ }),
    ).toBeInTheDocument();
  });

  test("German: no license yet, the trial and the form to add one", async () => {
    const drawn: string = await drawIn("de", noLicense());

    // Ten or eleven days, as the hour of the run falls against noon.
    expect(drawn).toMatch(/Testphase der Enterprise Edition: noch 1[01] Tage/);
    expect(drawn).toContain(word("de", LicenseStatusCopy.noLicenseInstalled));
    expect(drawn).toContain(
      `Validieren Sie Ihren Lizenzschlüssel bei OneUptime, um ihn zu aktivieren. Sie benötigen einen Lizenzschlüssel? Wenden Sie sich an unser Vertriebsteam unter ${SALES_EMAIL}.`,
    );
    // Short enough to fit a phone's input (it was cut at 390px).
    expect(
      screen.getByPlaceholderText("Enterprise-Lizenzschlüssel eingeben"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Lizenz validieren/ }),
    ).toBeInTheDocument();

    // The other way in: a token, beside this installation's ID.
    fireEvent.click(screen.getByTestId("switch-license-activation-mode"));

    expect(
      withoutIsolateMarks(
        screen.getByTestId("license-token-instance-id").textContent || "",
      ),
    ).toBe(
      `Ein Token funktioniert nur auf der Instanz, für die es ausgestellt wurde. Die Instanz-ID dieser Installation ist ${INSTANCE_ID}.`,
    );
    expect(
      screen.getByRole("button", { name: /Lizenz aktivieren/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Stattdessen einen Lizenzschlüssel verwenden"),
    ).toBeInTheDocument();
    expect(drawnText()).toContain("Lizenz-Token (Offline-Aktivierung)");
    expect(englishLeftOn(drawnText(), "de")).toEqual([]);
  });

  test("German: activated offline says so, and offers a new token", async () => {
    const drawn: string = await drawIn("de", offline());

    expect(drawn).toContain("Aktivierung");
    expect(drawn).toContain("Offline, mit einem signierten Token");
    expect(
      screen.getByRole("button", { name: /Lizenz ersetzen/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Lizenz aktualisieren/ }),
    ).not.toBeInTheDocument();
  });

  test("German: what a refresh says, in German", async () => {
    await drawIn("de", licensed());

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Lizenz aktualisieren/ }),
      );
    });

    expect(
      await screen.findByText("Lizenz von OneUptime aktualisiert."),
    ).toBeInTheDocument();
  });

  test("German: a refresh that leaves nothing licensed warns in German", async () => {
    refreshAnswer = noLicense();
    await drawIn("de", licensed());

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Lizenz aktualisieren/ }),
      );
    });

    expect(
      await screen.findByTestId("enterprise-license-stored-warning"),
    ).toHaveTextContent(word("de", LicenseStatusCopy.storedButNotLicensing));
  });

  test("German: the license key's Click to reveal is German too", async () => {
    await drawIn("de", licensed());

    expect(screen.getByText("Zum Anzeigen klicken")).toBeInTheDocument();
    expect(screen.queryByText("Click to reveal")).not.toBeInTheDocument();
  });

  test.each(["fa", "ru"])(
    "%s: the license key's Click to reveal is in the reader's language",
    async (language: string) => {
      await drawIn(language, licensed());

      expect(screen.getByText(word(language, "Click to reveal"))).toBeVisible();
      expect(word(language, "Click to reveal")).not.toBe("Click to reveal");
      expect(screen.queryByText("Click to reveal")).not.toBeInTheDocument();
    },
  );

  test("German: a license that is not valid says so in German, then the client's reason as sent", async () => {
    const drawn: string = await drawIn("de", invalid());

    expect(drawn).toContain(word("de", LicenseStatusCopy.licenseNotValid));
    expect(drawn).toContain(
      "Die gespeicherte Lizenz konnte nicht verifiziert werden. Validieren Sie die Lizenz erneut.",
    );
    expect(
      screen.getByTestId("license-status-server-message"),
    ).toHaveTextContent(SERVER_MESSAGE);

    // The page's own sentence comes first, the client's reason after it.
    const status: string = withoutIsolateMarks(
      screen.getByTestId("license-status").textContent || "",
    );

    expect(status.indexOf("Die gespeicherte Lizenz")).toBeLessThan(
      status.indexOf(SERVER_MESSAGE),
    );
  });

  test("Persian: the trial's title sets its days left apart from the Latin edition name", async () => {
    await drawIn("fa", noLicense());

    const title: string =
      screen.getByTestId("license-status").querySelector("h3")?.textContent ||
      "";

    // Ten or eleven days, as the hour of the run falls against noon.
    expect(
      ["۱۰", "۱۱"].map((days: string): string => {
        return `دورهٔ آزمایشی Enterprise Edition: ${FIRST_STRONG_ISOLATE}${days} روز مانده${POP_DIRECTIONAL_ISOLATE}`;
      }),
    ).toContain(title);
  });

  test("the way to a token is a link whose wrapped lines start where the form does", async () => {
    await drawIn("de", noLicense());

    expect(screen.getByTestId("switch-license-activation-mode")).toHaveClass(
      "text-start",
    );
  });

  test("Russian: the instance's users begin their line", async () => {
    const drawn: string = await drawIn("ru", licensed());

    expect(drawn).toContain("Пользователей: 7");
    expect(drawn).not.toContain("пользователей: 7");
    expect(drawn).toContain("Лицензия активна");
    expect(drawn).toContain("Обновить лицензию");
  });
});

describe("the page's dates are the reader's", () => {
  test.each(LANGUAGES)(
    "%s: the expiry, and the trial's end in its sentence",
    async (language: string) => {
      const expiry: string = dateIn(language, EXPIRES_AT);
      const trialEnd: string = dateIn(language, TRIAL_ENDS_AT);

      expect(expiry).not.toBe(englishDate(EXPIRES_AT));

      const page: string = await drawIn(language, licensed());

      expect(page).toContain(expiry);
      expect(page).not.toContain(englishDate(EXPIRES_AT));
      expect(page).not.toContain(new Date(EXPIRES_AT).toLocaleDateString());
      cleanup();

      const trial: string = await drawIn(language, noLicense());

      expect(trial).toContain(trialEnd);
      expect(trial).not.toContain(englishDate(TRIAL_ENDS_AT));
    },
  );

  test("German writes March as März, Persian in its own digits", () => {
    const march: string = "2027-03-02T12:00:00.000Z";

    expect(dateIn("de", march)).toContain("März");
    expect(dateIn("fa", march)).toMatch(/[۰-۹]/);
    expect(dateIn("fa", march)).not.toMatch(/[0-9]/);
    expect(englishDate(march)).toBe("02 Mar 2027");
  });
});

describe("what is drawn as written reads its own way", () => {
  test.each([
    ["ar", "ltr"],
    ["fa", "ltr"],
    ["de", null],
    ["ru", null],
  ])(
    "%s: the company's name, the instance ID and the client's message",
    async (language: string, dir: string | null) => {
      await drawIn(language, licensed());

      const company: HTMLElement = screen.getByTitle(COMPANY);

      expect(company).toHaveTextContent(COMPANY);
      expect(company.getAttribute("dir")).toBe(dir);

      // An identifier reads left to right on every page.
      const instanceId: HTMLElement = screen.getByTestId("license-instance-id");

      expect(within(instanceId).getByText(INSTANCE_ID)).toHaveAttribute(
        "dir",
        "ltr",
      );
      cleanup();

      await drawIn(language, invalid());

      const message: HTMLElement = screen.getByTestId(
        "license-status-server-message",
      );

      // As the server sent it, on a line of its own.
      expect(message.textContent).toBe(SERVER_MESSAGE);
      expect(message.getAttribute("dir")).toBe(dir);
      expect(screen.getByTestId("license-status")).toHaveTextContent(
        word(language, LicenseStatusCopy.licenseNotValid),
      );
    },
  );

  test.each(["ar", "fa"])(
    "%s: the sales address and the token's instance ID read left to right in their sentences",
    async (language: string) => {
      await drawIn(language, noLicense());

      const link: HTMLElement = screen.getByRole("link", { name: SALES_EMAIL });

      expect(link).toHaveAttribute("dir", "ltr");
      expect(link).toHaveAttribute("href", `mailto:${SALES_EMAIL}`);

      fireEvent.click(screen.getByTestId("switch-license-activation-mode"));

      const sentence: HTMLElement = screen.getByTestId(
        "license-token-instance-id",
      );

      expect(within(sentence).getByText(INSTANCE_ID)).toHaveAttribute(
        "dir",
        "ltr",
      );
      expect(withoutIsolateMarks(sentence.textContent || "")).toBe(
        word(language, LicenseSettingsCopy.tokenInstanceId).replace(
          "{{instanceId}}",
          INSTANCE_ID,
        ),
      );
    },
  );
});
