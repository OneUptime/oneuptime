import IncidentFormMessage from "../../FeatureSet/Accounts/src/Utils/IncidentFormMessage";
import { INCIDENT_FORM_QUESTION_LABELS } from "Common/Types/Incident/IncidentFormPublic";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * ---------------------------------------------------------------------------
 * THE PUBLIC INCIDENT FORM PAGE, WIRED INTO THE ACCOUNTS APP.
 *
 * Anybody holding an incident form's link opens
 * /accounts/incident-form/<shareKey> to report a problem, with or without a
 * OneUptime account. What can break without a single failing render test:
 *
 *  - THE ROUTE. Registered after the "*" catch-all, or under another path,
 *    every link the dashboard hands out opens "Page not found". The share
 *    key is also a link identifier, not a single-use secret: it stays in the
 *    address bar, so the path must never join SensitiveUrlToken's
 *    TOKEN_ROUTES (whose bootstrap would strip it before the page reads it).
 *  - THE CLIENT. The page is served from the OneUptime host, so a signed-in
 *    visitor's dashboard session rides along to the form's routes. Any other
 *    client - the dashboard's BaseAPI, ModelAPI - answers a 401 by
 *    refreshing that session, signing the visitor out and navigating away
 *    from their half-written report. IncidentFormApiSession.test.ts pins the
 *    client's behaviour; this file pins that the page goes through nothing
 *    else, and that nothing on it redirects a signed-in visitor.
 *  - THE URL. The page and the server agree on /api/incident-form/public/...
 *    only because both spell it the same way.
 *  - IMAGE UPLOAD. A Markdown editor uploads pasted images to the File API,
 *    which needs a signed-in user; on this page it must be off, everywhere.
 *  - THE COPY. i18next falls back to English for a missing key, so a locale
 *    that lost one renders a half-English page and throws nothing. The
 *    failure sentences are looked up whole, as flat keys, so each has to
 *    match the server's sentence byte for byte (IncidentFormServerMessages
 *    in Common checks the server side of that).
 *
 * Nothing is rendered here: App's suite has no DOM. The files are read as
 * text, as the other Accounts wiring tests read them.
 * ---------------------------------------------------------------------------
 */

const APP_DIR: string = nodePath.join(__dirname, "..", "..");

const PACKAGES_DIR: string = nodePath.join(APP_DIR, "..");

const ACCOUNTS_SRC: string = nodePath.join(
  APP_DIR,
  "FeatureSet",
  "Accounts",
  "src",
);

const LOCALES_DIR: string = nodePath.join(ACCOUNTS_SRC, "Locales");

// Comments removed and whitespace collapsed, so prettier re-wrapping is noise.
function readCode(absolutePath: string): string {
  return fs
    .readFileSync(absolutePath, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\{\s*\}/g, "{}")
    .replace(/\s+/g, " ");
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/*
 * The source between `start` and the first `end` after it. Asserts both are
 * there, so a landmark that was renamed away fails loudly here instead of
 * turning every later `toContain` into a search of the wrong text.
 */
function sliceBetween(source: string, start: string, end: string): string {
  const startIndex: number = source.indexOf(start);

  expect(startIndex).toBeGreaterThan(-1);

  const endIndex: number = source.indexOf(end, startIndex + start.length);

  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}

const appSource: string = readCode(nodePath.join(ACCOUNTS_SRC, "App.tsx"));

const pageSource: string = readCode(
  nodePath.join(ACCOUNTS_SRC, "Pages", "IncidentForm.tsx"),
);

const utilsSource: string = readCode(
  nodePath.join(ACCOUNTS_SRC, "Utils", "IncidentForm.ts"),
);

const clientSource: string = readCode(
  nodePath.join(ACCOUNTS_SRC, "Utils", "IncidentFormAPI.ts"),
);

const apiPathsSource: string = readCode(
  nodePath.join(ACCOUNTS_SRC, "Utils", "ApiPaths.ts"),
);

describe("the route", () => {
  const ROUTE: string = 'path="/accounts/incident-form/:shareKey"';

  test("is registered once, for the page, lazily like every Accounts page", () => {
    expect(countOccurrences(appSource, ROUTE)).toBe(1);
    expect(appSource).toContain(`${ROUTE} element={<IncidentFormPage />}`);
    expect(appSource).toContain('return import("./Pages/IncidentForm");');
  });

  test("comes before the catch-all, which would otherwise answer every link", () => {
    const route: number = appSource.indexOf(ROUTE);
    const catchAll: number = appSource.indexOf('path="*"');

    expect(route).toBeGreaterThan(-1);
    expect(catchAll).toBeGreaterThan(route);
  });

  test("has no key-less twin: the key never leaves the path", () => {
    expect(appSource).not.toContain('path="/accounts/incident-form"');
  });

  test("is not a token route, so the bootstrap never strips the key", () => {
    const tokenRoutesUi: string = readCode(
      nodePath.join(
        PACKAGES_DIR,
        "Common",
        "UI",
        "Utils",
        "SensitiveUrlToken.ts",
      ),
    );
    const tokenRoutesPartial: string = fs.readFileSync(
      nodePath.join(
        PACKAGES_DIR,
        "Common",
        "Server",
        "Views",
        "Partials",
        "SensitiveUrlToken.ejs",
      ),
      "utf8",
    );

    expect(
      sliceBetween(tokenRoutesUi, "const TOKEN_ROUTES", ";"),
    ).not.toContain("incident-form");
    expect(
      sliceBetween(tokenRoutesPartial, "var TOKEN_ROUTES", ";"),
    ).not.toContain("incident-form");
  });

  test("nothing in the app or on the page sends a signed-in visitor elsewhere", () => {
    /*
     * Login, Register and SSO send a signed-in user on to the Dashboard.
     * A reporter who happens to be signed in must still get the form.
     */
    for (const source of [appSource, pageSource]) {
      expect(source).not.toContain("isLoggedIn");
      expect(source).not.toContain("UserUtil");
      expect(source).not.toContain("LoginUtil");
      expect(source).not.toContain("Navigation.navigate");
    }
  });
});

describe("the page talks to the server through its own client only", () => {
  test("the page itself imports no client at all", () => {
    expect(pageSource).not.toContain('"Common/UI/Utils/API/API"');
    expect(pageSource).not.toContain('"Common/Utils/API"');
    expect(pageSource).not.toContain("ModelAPI");
    expect(pageSource).not.toContain("IncidentFormAPI");
  });

  test("it reads and submits through the page's helpers", () => {
    expect(pageSource).toContain("loadPublicIncidentForm(shareKey)");
    expect(pageSource).toContain("await submitPublicIncidentForm(");
  });

  test("and the helpers make both requests with IncidentFormAPI, and nothing else", () => {
    expect(utilsSource).toContain(
      'import IncidentFormAPI from "./IncidentFormAPI";',
    );
    expect(
      countOccurrences(utilsSource, "IncidentFormAPI.get<JSONObject>("),
    ).toBe(1);
    expect(
      countOccurrences(utilsSource, "IncidentFormAPI.post<JSONObject>("),
    ).toBe(1);
    expect(utilsSource).not.toContain('"Common/UI/Utils/API/API"');
    expect(utilsSource).not.toContain("ModelAPI");
  });

  test("the client is the refresh-aware UI client, with every way out closed", () => {
    expect(clientSource).toContain(
      'import BaseAPI from "Common/UI/Utils/API/API";',
    );
    expect(clientSource).toContain(
      "export default class IncidentFormAPI extends BaseAPI {",
    );

    expect(
      sliceBetween(clientSource, "getRefreshSessionUrl(): URL | null {", "}"),
    ).toContain("return null;");
    expect(
      sliceBetween(clientSource, "public static override handleError(", "}"),
    ).toContain("return error;");
    // Nothing between the braces: no storage cleared, no request, no navigation.
    expect(clientSource).toContain(
      "public static override logoutUser(): void {}",
    );
    expect(
      sliceBetween(clientSource, "getDefaultHeaders(): Headers {", "};"),
    ).toContain('tenantid: ""');
  });

  test("its URL hangs off the API and matches the server's public routes", () => {
    const definition: string = sliceBetween(
      apiPathsSource,
      "export const INCIDENT_FORM_PUBLIC_API_URL: URL =",
      ";",
    );

    expect(definition).toContain("APP_API_URL");
    expect(definition).toContain('new Route("/incident-form/public")');

    const modelSource: string = readCode(
      nodePath.join(
        PACKAGES_DIR,
        "Common",
        "Models",
        "DatabaseModels",
        "IncidentForm.ts",
      ),
    );
    const serverApiSource: string = readCode(
      nodePath.join(
        PACKAGES_DIR,
        "Common",
        "Server",
        "API",
        "IncidentFormAPI.ts",
      ),
    );

    expect(modelSource).toContain(
      '@CrudApiEndpoint(new Route("/incident-form"))',
    );
    expect(serverApiSource).toContain("?.toString()}/public/:shareKey`,");
    expect(serverApiSource).toContain(
      "?.toString()}/public/:shareKey/submit`,",
    );

    expect(utilsSource).toContain("`/${encodeURIComponent(shareKey)}`");
    expect(utilsSource).toContain("`/${encodeURIComponent(shareKey)}/submit`");
  });
});

describe("what the page asks", () => {
  test("no Markdown editor on it can upload an image", () => {
    // The description, and every Markdown custom field.
    expect(countOccurrences(pageSource, "allowImageUpload = false")).toBe(1);
    expect(countOccurrences(pageSource, "allowImageUpload: false")).toBe(1);
    expect(pageSource).not.toContain("allowImageUpload: true");
    expect(
      sliceBetween(
        pageSource,
        "if (customField.fieldType === FormFieldSchemaType.Markdown) {",
        "}",
      ),
    ).toContain("customField.allowImageUpload = false;");
  });

  /*
   * The editor looks up what an empty box says itself, in the page's
   * language, and says it for each of its two modes. A placeholder handed
   * to it replaces both - the source box would say "Type your content
   * here..." too - so the page hands none, to the description or to any
   * Markdown question.
   */
  test("every Markdown box keeps the editor's own words, in both its modes", () => {
    const descriptionField: string = sliceBetween(
      pageSource,
      "const descriptionField: Field<JSONObject> = {",
      "};",
    );

    expect(descriptionField).toContain(
      "fieldType: FormFieldSchemaType.Markdown,",
    );
    expect(descriptionField).not.toContain("placeholder");
    expect(
      sliceBetween(
        pageSource,
        "if (customField.fieldType === FormFieldSchemaType.Markdown) {",
        "}",
      ),
    ).not.toContain("placeholder");
    expect(pageSource).not.toContain("markdownPlaceholder");
    expect(pageSource).not.toContain('"Type your content here..."');
    expect(pageSource).not.toContain('"Type your markdown here..."');
    // The words themselves are the editor's, and every Accounts locale has them.
    expect(MARKDOWN_EDITOR_SENTENCES).toEqual([
      "Type your content here...",
      "Type your markdown here...",
      "Formatting help",
    ]);
  });

  test("custom fields are built by the shared builder, required where the form says", () => {
    const builder: string = sliceBetween(
      pageSource,
      "buildCustomFieldFormFields({",
      "})",
    );

    expect(builder).toContain("enforceRequiredOnCreate: true");
    expect(builder).toContain("getFormKey: getCustomFieldFormKey");
  });

  test("the captcha shows only when the server wants one and this install can draw one", () => {
    expect(pageSource).toContain(
      "form && form.isCaptchaRequired && CAPTCHA_ENABLED && CAPTCHA_SITE_KEY",
    );
  });

  test("every failed submit asks for a fresh captcha", () => {
    const failure: string = sliceBetween(
      pageSource,
      "} catch (error: unknown) {",
      "} finally {",
    );

    expect(failure).toContain(
      "setSubmitFailure(getIncidentFormFailure(error));",
    );
    expect(failure).toContain("setCaptchaResetSignal(");
  });
});

/*
 * ---------------------------------------------------------------------------
 * THE COPY, IN ALL SEVENTEEN LOCALES.
 * ---------------------------------------------------------------------------
 */

// The page's own copy, exactly as the product's glossary words it.
const PAGE_COPY: Record<string, string> = {
  title: "Title",
  titleDescription: "A short summary of what is wrong.",
  description: "Description",
  severity: "Severity",
  reporterName: "Your Name",
  reporterEmail: "Your Email",
  successTitle: "Thank you — your report was submitted.",
  incidentNumber: "Your report is incident {{incidentNumber}}.",
  submitAnother: "Submit another report",
  retryAfter: "You can try again {{when}}.",
  tryAgain: "Try again",
};

/*
 * The shared form's own words the page shows - labels, and the checks the
 * form runs before anything is sent. Flat keys, as the form looks them up.
 */
const SHARED_FORM_SENTENCES: Array<string> = [
  "(Optional)",
  "{{field}} is required.",
  "{{field}} cannot be more than {{maxLength}} characters.",
  "Email is not valid.",
  "{{field}} must be checked.",
  "This is in your timezone - {{abbreviation}} ({{timezone}}).",
];

/*
 * The Markdown editor's own words on the page - what an empty box says, in
 * each of its two modes, and the help under it. Flat keys, as the editor
 * looks all three up itself, in the page's locale.
 */
const MARKDOWN_EDITOR_SENTENCES: Array<string> = [
  "Type your content here...",
  "Type your markdown here...",
  "Formatting help",
];

const FLAT_SENTENCES: Array<string> = [
  ...(Object.values(IncidentFormMessage) as Array<string>),
  ...SHARED_FORM_SENTENCES,
  ...MARKDOWN_EDITOR_SENTENCES,
];

/*
 * Words a language genuinely shares with English, and nothing else: French
 * "Description" is French, and German writes "(Optional)" the same way.
 */
const SAME_AS_ENGLISH: Record<string, Array<string>> = {
  fr: ["incidentForm.description"],
  de: ["(Optional)"],
};

const PLACEHOLDER: RegExp = /\{\{[^}]+\}\}/g;

const localeCodes: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((fileName: string): boolean => {
    return fileName.endsWith(".json");
  })
  .map((fileName: string): string => {
    return fileName.replace(/\.json$/, "");
  })
  .sort();

const translatedLocaleCodes: Array<string> = localeCodes.filter(
  (code: string): boolean => {
    return code !== "en";
  },
);

function readLocaleRaw(code: string): string {
  return fs.readFileSync(nodePath.join(LOCALES_DIR, `${code}.json`), "utf8");
}

function readLocale(code: string): Record<string, unknown> {
  return JSON.parse(readLocaleRaw(code)) as Record<string, unknown>;
}

function readPageCopy(code: string): Record<string, unknown> {
  const block: unknown = readLocale(code)["incidentForm"];

  expect(typeof block).toBe("object");

  return block as Record<string, unknown>;
}

function placeholders(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

describe("the page's copy exists in every Accounts locale", () => {
  test("all seventeen locales are checked", () => {
    expect(localeCodes).toHaveLength(17);
    expect(localeCodes).toContain("en");
  });

  test("English is the glossary, word for word", () => {
    expect(readPageCopy("en")).toEqual(PAGE_COPY);
  });

  test("the built-in questions are labelled as the server names them in its errors", () => {
    /*
     * The server says "Your Email is required." about the same box the page
     * labels "Your Email" - in English, from INCIDENT_FORM_QUESTION_LABELS.
     */
    expect(PAGE_COPY["title"]).toBe(INCIDENT_FORM_QUESTION_LABELS.title);
    expect(PAGE_COPY["description"]).toBe(
      INCIDENT_FORM_QUESTION_LABELS.description,
    );
    expect(PAGE_COPY["severity"]).toBe(INCIDENT_FORM_QUESTION_LABELS.severity);
    expect(PAGE_COPY["reporterName"]).toBe(
      INCIDENT_FORM_QUESTION_LABELS.reporterName,
    );
    expect(PAGE_COPY["reporterEmail"]).toBe(
      INCIDENT_FORM_QUESTION_LABELS.reporterEmail,
    );
  });

  test("the page uses every key it ships, and ships every key it uses", () => {
    const used: Array<string> = Array.from(
      pageSource.matchAll(/\bt\(\s*"incidentForm\.([A-Za-z]+)"/g),
    )
      .map((match: RegExpMatchArray): string => {
        return match[1]!;
      })
      .sort();

    expect(Array.from(new Set(used))).toEqual(Object.keys(PAGE_COPY).sort());
  });

  test.each([
    ["common", "submit"],
    ["captcha", "title"],
    ["captcha", "description"],
  ])(
    "the page's borrowed key %s.%s is there in every locale",
    (block: string, leaf: string) => {
      expect(pageSource).toContain(`t("${block}.${leaf}")`);

      for (const code of localeCodes) {
        const value: unknown = (
          readLocale(code)[block] as Record<string, unknown>
        )[leaf];

        expect(typeof value).toBe("string");
      }
    },
  );

  test.each(localeCodes)(
    "%s: incidentForm sits after resendVerificationEmail, keys in English's order",
    (code: string) => {
      const keys: Array<string> = Object.keys(readLocale(code));

      expect(keys[keys.indexOf("resendVerificationEmail") + 1]).toBe(
        "incidentForm",
      );
      expect(Object.keys(readPageCopy(code))).toEqual(Object.keys(PAGE_COPY));
    },
  );

  test.each(translatedLocaleCodes)(
    "%s: every line of the page is translated, placeholders kept",
    (code: string) => {
      const copy: Record<string, unknown> = readPageCopy(code);
      const sameAsEnglish: Array<string> = SAME_AS_ENGLISH[code] || [];

      for (const key of Object.keys(PAGE_COPY)) {
        const value: unknown = copy[key];

        expect(typeof value).toBe("string");
        expect((value as string).trim().length).toBeGreaterThan(0);
        expect(placeholders(value as string)).toEqual(
          placeholders(PAGE_COPY[key]!),
        );

        if (!sameAsEnglish.includes(`incidentForm.${key}`)) {
          expect(`${key}: ${value as string}`).not.toBe(
            `${key}: ${PAGE_COPY[key]!}`,
          );
        }
      }
    },
  );
});

describe("the sentences the page looks up whole", () => {
  test("English maps each one to itself", () => {
    const en: Record<string, unknown> = readLocale("en");

    for (const sentence of FLAT_SENTENCES) {
      expect(en[sentence]).toBe(sentence);
    }
  });

  test.each(translatedLocaleCodes)(
    "%s translates each one, placeholders kept",
    (code: string) => {
      const locale: Record<string, unknown> = readLocale(code);
      const sameAsEnglish: Array<string> = SAME_AS_ENGLISH[code] || [];

      for (const sentence of FLAT_SENTENCES) {
        const value: unknown = locale[sentence];

        expect(typeof value).toBe("string");
        expect((value as string).trim().length).toBeGreaterThan(0);
        expect(placeholders(value as string)).toEqual(placeholders(sentence));

        if (!sameAsEnglish.includes(sentence)) {
          expect(value).not.toBe(sentence);
        }
      }
    },
  );

  test.each(localeCodes)(
    "%s keeps them in the same order, at the end",
    (code: string) => {
      const keys: Array<string> = Object.keys(readLocale(code));

      expect(keys.slice(keys.length - FLAT_SENTENCES.length)).toEqual(
        FLAT_SENTENCES,
      );
    },
  );

  test("the page's failure sentences contain no placeholder a server sentence could not fill", () => {
    for (const sentence of Object.values(
      IncidentFormMessage,
    ) as Array<string>) {
      expect(sentence).not.toContain("{{");
    }
  });
});

describe("the locale files stay as the tools write them", () => {
  test.each(localeCodes)(
    "%s.json is JSON.stringify(locale, null, 2) plus a newline",
    (code: string) => {
      const raw: string = readLocaleRaw(code);

      expect(raw).toBe(`${JSON.stringify(JSON.parse(raw), null, 2)}\n`);
    },
  );
});
