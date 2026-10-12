import FormMessage from "../../FeatureSet/Accounts/src/Utils/FormMessage";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * ---------------------------------------------------------------------------
 * THE PUBLIC FORM PAGE, WIRED INTO THE ACCOUNTS APP.
 *
 * Anybody holding a form's link opens /accounts/form/<shareKey> to fill it
 * in - report a problem, ask for a maintenance window - with or without a
 * OneUptime account. What can break without a single failing render test:
 *
 *  - THE ROUTES. Registered after the "*" catch-all, or under another path,
 *    every link the dashboard hands out opens "Page not found" - and so does
 *    every incident form link shared before Forms replaced incident forms
 *    (/accounts/incident-form/<shareKey>), which must forward to the same
 *    form. The share key is a link identifier, not a single-use secret: it
 *    stays in the address bar, so neither path may join SensitiveUrlToken's
 *    TOKEN_ROUTES (whose bootstrap would strip it before the page reads it).
 *  - THE CLIENT. The page is served from the OneUptime host, so a signed-in
 *    visitor's dashboard session rides along to the form's routes. Any other
 *    client - the dashboard's BaseAPI, ModelAPI - answers a 401 by
 *    refreshing that session, signing the visitor out and navigating away
 *    from their half-written answers. FormApiSession.test.ts pins the
 *    client's behaviour; this file pins that the page goes through nothing
 *    else, and that nothing on it redirects a signed-in visitor.
 *  - THE URL. The page and the server agree on /api/form/public/... only
 *    because both spell it the same way.
 *  - IMAGE UPLOAD. A Markdown editor uploads pasted images to the File API,
 *    which needs a signed-in user; on this page it must be off, everywhere.
 *  - THE COPY. i18next falls back to English for a missing key, so a locale
 *    that lost one renders a half-English page and throws nothing. The
 *    failure sentences are looked up whole, as flat keys, so each has to
 *    match the server's sentence byte for byte (FormServerMessages in
 *    Common checks the server side of that).
 *
 * Nothing is rendered here: App's suite has no DOM. The files are read as
 * text, as the other Accounts wiring tests read them. (FormPage.test.tsx in
 * Common renders the page.)
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
  nodePath.join(ACCOUNTS_SRC, "Pages", "Form.tsx"),
);

const utilsSource: string = readCode(
  nodePath.join(ACCOUNTS_SRC, "Utils", "Form.ts"),
);

const clientSource: string = readCode(
  nodePath.join(ACCOUNTS_SRC, "Utils", "FormAPI.ts"),
);

const apiPathsSource: string = readCode(
  nodePath.join(ACCOUNTS_SRC, "Utils", "ApiPaths.ts"),
);

// The questions are drawn by the builder the dashboard's preview shares.
const fieldBuilderSource: string = readCode(
  nodePath.join(
    PACKAGES_DIR,
    "Common",
    "UI",
    "Components",
    "PublicForm",
    "PublicFormFields.ts",
  ),
);

describe("the routes", () => {
  const ROUTE: string = 'path="/accounts/form/:shareKey"';
  const OLD_ROUTE: string = 'path="/accounts/incident-form/:shareKey"';

  test("the form's page is registered once, lazily like every Accounts page", () => {
    expect(countOccurrences(appSource, ROUTE)).toBe(1);
    expect(appSource).toContain(`${ROUTE} element={<FormPage />}`);
    expect(appSource).toContain('return import("./Pages/Form");');
  });

  test("an incident form link from before Forms forwards to the same form, replacing the old address", () => {
    expect(countOccurrences(appSource, OLD_ROUTE)).toBe(1);
    expect(appSource).toContain(
      `${OLD_ROUTE} element={<LegacyIncidentFormRedirect />}`,
    );

    const redirect: string = sliceBetween(
      appSource,
      "export function LegacyIncidentFormRedirect(): ReactElement {",
      "function App(): ReactElement {",
    );

    expect(redirect).toContain('params["shareKey"]');
    expect(redirect).toContain("<Navigate replace={true}");
    expect(redirect).toContain(
      "to={`/accounts/form/${encodeURIComponent(shareKey)}`}",
    );
    // The page itself is no longer there to load.
    expect(appSource).not.toContain('import("./Pages/IncidentForm")');
    expect(
      fs.existsSync(nodePath.join(ACCOUNTS_SRC, "Pages", "IncidentForm.tsx")),
    ).toBe(false);
  });

  test("both come before the catch-all, which would otherwise answer every link", () => {
    const catchAll: number = appSource.indexOf('path="*"');

    for (const route of [ROUTE, OLD_ROUTE]) {
      expect(appSource.indexOf(route)).toBeGreaterThan(-1);
      expect(catchAll).toBeGreaterThan(appSource.indexOf(route));
    }
  });

  test("have no key-less twin: the key never leaves the path", () => {
    expect(appSource).not.toContain('path="/accounts/form"');
    expect(appSource).not.toContain('path="/accounts/incident-form"');
  });

  test("are not token routes, so the bootstrap never strips the key", () => {
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

    for (const tokenRoutes of [
      sliceBetween(tokenRoutesUi, "const TOKEN_ROUTES", ";"),
      sliceBetween(tokenRoutesPartial, "var TOKEN_ROUTES", ";"),
    ]) {
      // The list really is there, with the routes it does hold.
      expect(tokenRoutes).toContain("reset-password");
      expect(tokenRoutes).not.toMatch(/["']form["']/);
      expect(tokenRoutes).not.toContain("incident-form");
    }
  });

  test("nothing in the app or on the page sends a signed-in visitor elsewhere", () => {
    /*
     * Login, Register and SSO send a signed-in user on to the Dashboard.
     * A submitter who happens to be signed in must still get the form.
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
    expect(pageSource).not.toContain("FormAPI");
  });

  test("it reads and submits through the page's helpers", () => {
    expect(pageSource).toContain("loadPublicForm(shareKey)");
    expect(pageSource).toContain("await submitPublicForm(");
  });

  test("and the helpers make both requests with FormAPI, and nothing else", () => {
    expect(utilsSource).toContain('import FormAPI from "./FormAPI";');
    expect(countOccurrences(utilsSource, "FormAPI.get<JSONObject>(")).toBe(1);
    expect(countOccurrences(utilsSource, "FormAPI.post<JSONObject>(")).toBe(1);
    expect(utilsSource).not.toContain('"Common/UI/Utils/API/API"');
    expect(utilsSource).not.toContain("ModelAPI");
  });

  test("the client is the refresh-aware UI client, with every way out closed", () => {
    expect(clientSource).toContain(
      'import BaseAPI from "Common/UI/Utils/API/API";',
    );
    expect(clientSource).toContain(
      "export default class FormAPI extends BaseAPI {",
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

    const headers: string = sliceBetween(
      clientSource,
      "getDefaultHeaders(): Headers {",
      "};",
    );

    expect(headers).toContain('tenantid: ""');
    expect(headers).toContain("[FORM_PAGE_HEADER]: FORM_PAGE_HEADER_VALUE");
  });

  test("its URL hangs off the API and matches the server's public routes", () => {
    const definition: string = sliceBetween(
      apiPathsSource,
      "export const FORM_PUBLIC_API_URL: URL =",
      ";",
    );

    expect(definition).toContain("APP_API_URL");
    expect(definition).toContain('new Route("/form/public")');
    expect(apiPathsSource).not.toContain("incident-form");

    const modelSource: string = readCode(
      nodePath.join(
        PACKAGES_DIR,
        "Common",
        "Models",
        "DatabaseModels",
        "Form.ts",
      ),
    );
    const serverApiSource: string = readCode(
      nodePath.join(PACKAGES_DIR, "Common", "Server", "API", "FormAPI.ts"),
    );

    expect(modelSource).toContain('@CrudApiEndpoint(new Route("/form"))');
    expect(serverApiSource).toContain("?.toString()}/public/:shareKey`,");
    expect(serverApiSource).toContain(
      "?.toString()}/public/:shareKey/submit`,",
    );

    expect(utilsSource).toContain("`/${encodeURIComponent(shareKey)}`");
    expect(utilsSource).toContain("`/${encodeURIComponent(shareKey)}/submit`");
  });
});

describe("what the page asks", () => {
  test("its questions are drawn by the builder the dashboard's preview draws them with", () => {
    expect(pageSource).toContain("buildPublicFormFields(askedForm)");
    expect(pageSource).toContain(
      'from "Common/UI/Components/PublicForm/PublicFormFields"',
    );
  });

  /*
   * A template can make a question required, optional or hidden (issue
   * #4563). The page draws the form as the chosen template asks it, with
   * the function the server holds the submission to, and sends the request
   * built the same way - never the raw list of every question the page was
   * told about.
   */
  test("it asks the form as the chosen template asks it, as the server does", () => {
    expect(pageSource).toContain(
      "getPublicFormForTemplate({ form, template })",
    );
    expect(pageSource).not.toContain("buildPublicFormFields(form)");
    expect(utilsSource).toContain("getPublicFormForTemplate({");
    expect(
      sliceBetween(
        utilsSource,
        "export const buildFormSubmissionRequest",
        "return request;",
      ),
    ).toContain("form: getPublicFormForTemplate({");
  });

  test("no Markdown editor on it can upload an image", () => {
    expect(
      sliceBetween(
        fieldBuilderSource,
        "if (question.type === PublicFormFieldType.Markdown) {",
        "}",
      ),
    ).toContain("field.allowImageUpload = false;");
    expect(fieldBuilderSource).not.toContain("allowImageUpload = true");
    expect(fieldBuilderSource).not.toContain("allowImageUpload: true");
    expect(pageSource).not.toContain("allowImageUpload");
  });

  /*
   * The editor looks up what an empty box says itself, in the page's
   * language, and says it for each of its two modes. A placeholder handed
   * to it replaces both - the source box would say "Type your content
   * here..." too - so neither the page nor the builder hands one.
   */
  test("every Markdown box keeps the editor's own words, in both its modes", () => {
    for (const source of [pageSource, fieldBuilderSource]) {
      expect(source).not.toContain("placeholder");
      expect(source).not.toContain('"Type your content here..."');
      expect(source).not.toContain('"Type your markdown here..."');
    }

    // The words themselves are the editor's, and every Accounts locale has them.
    expect(MARKDOWN_EDITOR_SENTENCES).toEqual([
      "Type your content here...",
      "Type your markdown here...",
      "Formatting help",
    ]);
  });

  test("the form's own description and thank-you message are shown, never edited", () => {
    expect(pageSource).toContain("<MarkdownViewer text={form.description} />");
    expect(pageSource).toContain(
      "<MarkdownViewer text={result.successMessage} />",
    );
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

    expect(failure).toContain("setSubmitFailure(getFormFailure(error));");
    expect(failure).toContain("setCaptchaResetSignal(");
  });
});

/*
 * ---------------------------------------------------------------------------
 * THE COPY, IN ALL SEVENTEEN LOCALES.
 * ---------------------------------------------------------------------------
 */

/*
 * The page's own copy. The questions' labels are the form's own, as its
 * builder wrote them; the page names nothing else.
 */
const PAGE_COPY: Record<string, string> = {
  successTitle: "Thank you — your response was submitted.",
  reference: "Your reference number is {{reference}}.",
  submitAnother: "Submit another response",
  retryAfter: "You can try again {{when}}.",
  tryAgain: "Try again",
  templateLabel: "Start from a template",
  templateDescription:
    "Choose a template to fill in the form. You can change any answer before you submit.",
  templateNone: "No template",
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

/*
 * The Markdown editor's toolbar, which the editor looks up in the page's
 * locale too: its buttons' names, and on this narrow page the words of its
 * More formatting menu, which holds the buttons that do not fit.
 */
const MARKDOWN_TOOLBAR_WORDS: Array<string> = [
  "More formatting",
  "Bold",
  "Italic",
  "Underline",
  "Strikethrough",
  "Heading 1",
  "Heading 2",
  "Heading 3",
  "Bullet List",
  "Numbered List",
  "Task List",
  "Indent",
  "Outdent",
  "Link",
  "Upload Image",
  "Code",
  "Table",
  "Horizontal Rule",
  "Quote",
  "Code Block",
  "Switch to markdown source",
  "Switch to visual editor",
];

const FLAT_SENTENCES: Array<string> = [
  ...(Object.values(FormMessage) as Array<string>),
  ...SHARED_FORM_SENTENCES,
  ...MARKDOWN_EDITOR_SENTENCES,
  ...MARKDOWN_TOOLBAR_WORDS,
];

// Words a language genuinely shares with English, and nothing else.
const SAME_AS_ENGLISH: Record<string, Array<string>> = {
  de: ["(Optional)", "Link", "Code"],
  fr: ["Code"],
  pt: ["Link"],
  nl: ["Code"],
  da: ["Link"],
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
  const block: unknown = readLocale(code)["form"];

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

  test("English is the page's copy, word for word", () => {
    expect(readPageCopy("en")).toEqual(PAGE_COPY);
  });

  test("the incident form page's copy is gone from every locale", () => {
    for (const code of localeCodes) {
      expect(Object.keys(readLocale(code))).not.toContain("incidentForm");
    }
  });

  test("the page uses every key it ships, and ships every key it uses", () => {
    const used: Array<string> = Array.from(
      pageSource.matchAll(/\bt\(\s*"form\.([A-Za-z]+)"/g),
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
    "%s: form sits after resendVerificationEmail, keys in English's order",
    (code: string) => {
      const keys: Array<string> = Object.keys(readLocale(code));

      expect(keys[keys.indexOf("resendVerificationEmail") + 1]).toBe("form");
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

        if (!sameAsEnglish.includes(`form.${key}`)) {
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
    for (const sentence of Object.values(FormMessage) as Array<string>) {
      expect(sentence).not.toContain("{{");
    }
  });

  test("no failure sentence still speaks of reports or incident forms only", () => {
    for (const sentence of Object.values(FormMessage) as Array<string>) {
      expect(sentence).not.toMatch(/incident form/i);
      expect(sentence).not.toMatch(/\breport\b/i);
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
