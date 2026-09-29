import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  SecurityEventConnectorCatalog,
  SecurityEventConnectorCategories,
  SecurityEventConnectorDefinition,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";

/*
 * The redesigned Security Events and Connections empty states look every
 * visible string up in the Dashboard locale files (by its English text), so
 * a string they render but no locale carries stays English for everyone.
 * This pins both halves, the same way SecurityEventsCorrelateI18n does: the
 * components still render exactly these strings, and every locale
 * translates each of them. It also walks the sources for every string they
 * hand to translation, so a new one cannot ship without being listed here.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMMON_ROOT: string = path.join(__dirname, "..", "..", "..", "Common");

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const SOURCE_FILES: Array<Array<string>> = [
  ["Components", "SecurityEvents", "SecurityEventsEmptyState.tsx"],
  ["Components", "SecurityEvents", "SecurityEventConnectionsEmptyState.tsx"],
  ["Components", "SecurityEvents", "SecurityEventProviderTile.tsx"],
];

/*
 * Every string the three components translate: literals passed to
 * translateString, the Add connection title (Button translates its own
 * title), and the ways-in and requirement copy the components pass through
 * translateString from their exported arrays.
 */
const COMPONENT_STRINGS: Array<string> = [
  // SecurityEventsEmptyState
  "No security events yet",
  "Events show up here as soon as a source starts sending. Every event is normalized to OCSF, whatever format it arrives in.",
  "Ways to start sending security events",
  "Send events to OneUptime",
  "POST JSON from a SIEM, a SOAR webhook, a log forwarder or any other source.",
  "Read the setup guide",
  "Pull from a security product",
  "OneUptime polls Microsoft Sentinel, CrowdStrike, Splunk and more on a schedule.",
  "Connect a security product",
  // SecurityEventConnectionsEmptyState
  "No security event connections yet",
  "Connect a SIEM, EDR / XDR, cloud security or identity product and OneUptime polls it on a schedule, importing each new alert, finding or log event as an OCSF security event.",
  "Add connection",
  "Pick a product to connect",
  "Supported products",
  "What you'll need",
  "A read-only credential",
  "A service principal, API client or API token with permission to list the product's alerts, findings or log events.",
  "A running OneUptime worker",
  "Polls every connection on its schedule. Test connection checks access and worker health before you save.",
  // SecurityEventProviderTile
  "Connect",
  "Setup guide",
  "(opens in a new tab)",
];

/*
 * The catalog's category names. They are declared in Common, not in these
 * components, but both translate them: the tile under each product's name
 * and the Events card's "SIEM · EDR / XDR · …" line.
 */
const CATEGORY_STRINGS: Array<string> = [
  "SIEM",
  "EDR / XDR",
  "Cloud security",
  "Identity",
];

const STRINGS: Array<string> = [...COMPONENT_STRINGS, ...CATEGORY_STRINGS];

/*
 * Strings that are legitimately identical to English in every locale: the
 * two categories are industry acronyms that security teams use untranslated
 * everywhere, the same way the Correlate and setup-guide copy keeps "SIEM"
 * as is. Keep this list short and explicit — anything else identical to
 * English is a copy someone forgot to translate.
 */
const IDENTICAL_IN_EVERY_LOCALE: Array<string> = ["SIEM", "EDR / XDR"];

// Per-locale exceptions on top of the list above. None today.
const IDENTICAL_TO_ENGLISH: Record<string, Array<string>> = {};

/*
 * Product, protocol and standard names. A translation keeps each one the
 * English string carries, character for character: a customer searching
 * their SIEM for "CrowdStrike" or reading "POST" off the endpoint must find
 * the same word on this page.
 */
const BRAND_NAMES: Array<string> = [
  "OneUptime",
  "OCSF",
  "SIEM",
  "SOAR",
  "JSON",
  "POST",
  "API",
  "EDR / XDR",
  "Microsoft Sentinel",
  "CrowdStrike",
  "Splunk",
];

/*
 * Copy the old empty states rendered and the redesign dropped. The old
 * Events description was one long sentence carrying both ways in; it is
 * gone from the source, so its locale entries went with it.
 */
const RETIRED_EVENTS_DESCRIPTION: string =
  "Send events from any source that can POST JSON — a SIEM, a SOAR webhook, a log forwarder — or connect a security product and OneUptime polls it for you. Every event is normalized to OCSF, whatever dialect it arrives in.";

const RETIRED_STRINGS: Array<string> = [
  RETIRED_EVENTS_DESCRIPTION,
  // The grey requirements box that sat above the docs cards.
  "Before you connect",
  // The heading of the eight heavy EmptyStateGuideLinks docs cards.
  "Setup guides",
];

// What a sentence may end with, per script.
const SENTENCE_ENDINGS: Array<string> = [".", "。", "।"];

/*
 * Persian (like the existing "Last 24 hours" entries) writes numbers with
 * its own digits; compare them as the ASCII digits they stand for.
 */
function toAsciiDigits(text: string): string {
  return text.replace(/[۰-۹٠-٩]/g, (digit: string) => {
    const code: number = digit.charCodeAt(0);
    const zero: number = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - zero);
  });
}

function readSource(relativePath: Array<string>): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...relativePath), "utf8");
}

function readSources(): string {
  return SOURCE_FILES.map((relativePath: Array<string>): string => {
    return readSource(relativePath);
  }).join("\n");
}

/*
 * Comments are stripped before walking the code: they quote copy ("real",
 * "Refresh?") and describe the old design, and the walkers must read what
 * the components do rather than what the commentary says.
 */
function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

function readSourceCode(): string {
  return stripComments(readSources());
}

function readLocaleRaw(file: string): string {
  return fs.readFileSync(path.join(LOCALES_DIR, file), "utf8");
}

function readLocale(file: string): Record<string, unknown> {
  return JSON.parse(readLocaleRaw(file)) as Record<string, unknown>;
}

// Index just past the string literal that opens at `start`.
function skipStringLiteral(source: string, start: number): number {
  const quote: string = source.charAt(start);
  let index: number = start + 1;
  while (index < source.length) {
    const char: string = source.charAt(index);
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === quote) {
      return index + 1;
    }
    index++;
  }
  return index;
}

/*
 * The raw argument text of every call to `callee`, with balanced
 * parentheses and string literals skipped, so a multi-line call, a ternary
 * between two literals and "(opens in a new tab)" all come back whole.
 */
function callArguments(source: string, callee: string): Array<string> {
  const results: Array<string> = [];
  const pattern: RegExp = new RegExp(`\\b${callee}\\(`, "g");
  let match: RegExpExecArray | null = pattern.exec(source);
  while (match !== null) {
    const start: number = match.index + match[0].length;
    let depth: number = 1;
    let index: number = start;
    while (index < source.length && depth > 0) {
      const char: string = source.charAt(index);
      if (char === '"' || char === "'" || char === "`") {
        index = skipStringLiteral(source, index);
        continue;
      }
      if (char === "(") {
        depth++;
      } else if (char === ")") {
        depth--;
      }
      index++;
    }
    results.push(source.slice(start, index - 1).trim());
    match = pattern.exec(source);
  }
  return results;
}

// Every double-quoted literal in `text`, unescaped.
function doubleQuotedLiterals(text: string): Array<string> {
  const literals: Array<string> = [];
  const pattern: RegExp = /"((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null = pattern.exec(text);
  while (match !== null) {
    literals.push(JSON.parse(`"${match[1] as string}"`) as string);
    match = pattern.exec(text);
  }
  return literals;
}

function translateStringArguments(): Array<string> {
  return callArguments(readSourceCode(), "translateString");
}

function translateStringLiterals(): Array<string> {
  return translateStringArguments().flatMap(
    (argument: string): Array<string> => {
      return doubleQuotedLiterals(argument);
    },
  );
}

// Literal title="…" props: Button translates its own title.
function jsxTitleLiterals(): Array<string> {
  const titles: Array<string> = [];
  const pattern: RegExp = /\stitle="((?:[^"\\]|\\.)*)"/g;
  const code: string = readSourceCode();
  let match: RegExpExecArray | null = pattern.exec(code);
  while (match !== null) {
    titles.push(match[1] as string);
    match = pattern.exec(code);
  }
  return titles;
}

/*
 * title / description / actionTitle literals in the exported arrays
 * (SECURITY_EVENTS_WAYS_IN and SECURITY_EVENT_CONNECTION_REQUIREMENTS),
 * whose fields the components translate when they render them.
 */
function dataFieldLiterals(): Array<string> {
  const values: Array<string> = [];
  const pattern: RegExp =
    /\b(?:title|description|actionTitle):\s*"((?:[^"\\]|\\.)*)"/g;
  const code: string = readSourceCode();
  let match: RegExpExecArray | null = pattern.exec(code);
  while (match !== null) {
    values.push(JSON.parse(`"${match[1] as string}"`) as string);
    match = pattern.exec(code);
  }
  return values;
}

function unique(values: Array<string>): Array<string> {
  return Array.from(new Set<string>(values)).sort();
}

const localeFiles: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".json");
  })
  .sort();

const nonEnglishLocaleFiles: Array<string> = localeFiles.filter(
  (file: string): boolean => {
    return file !== "en.json";
  },
);

function allowedCopiesFor(file: string): Array<string> {
  return [
    ...IDENTICAL_IN_EVERY_LOCALE,
    ...(IDENTICAL_TO_ENGLISH[file.replace(/\.json$/, "")] || []),
  ];
}

describe("Security Events empty states translations", () => {
  test("the list has no duplicates", () => {
    expect(new Set<string>(STRINGS).size).toBe(STRINGS.length);
  });

  test("every string is still rendered by the empty-state components", () => {
    const sources: string = readSources();
    const missing: Array<string> = COMPONENT_STRINGS.filter(
      (text: string): boolean => {
        return !sources.includes(`"${text}"`);
      },
    );
    expect(missing).toEqual([]);
  });

  /*
   * The categories come from the catalog, so the list follows it: a fifth
   * category added there must be added (and translated) here too.
   */
  test("the category strings are exactly the catalog's categories", () => {
    expect(CATEGORY_STRINGS).toEqual([...SecurityEventConnectorCategories]);

    const usedCategories: Array<string> = unique(
      SecurityEventConnectorCatalog.map(
        (definition: SecurityEventConnectorDefinition): string => {
          return definition.category;
        },
      ),
    );
    for (const category of usedCategories) {
      expect(CATEGORY_STRINGS).toContain(category);
    }
  });

  test("both places that show a category translate it", () => {
    const eventsArguments: Array<string> = callArguments(
      stripComments(readSource(SOURCE_FILES[0] as Array<string>)),
      "translateString",
    );
    const tileArguments: Array<string> = callArguments(
      stripComments(readSource(SOURCE_FILES[2] as Array<string>)),
      "translateString",
    );

    expect(eventsArguments).toContain("category");
    expect(tileArguments).toContain("definition.category");
  });

  /*
   * The guard against a future string skipping translation: any literal
   * handed to translateString in these components must be listed here, so
   * the locale tests below cover it.
   */
  test("every literal passed to translateString is in the list", () => {
    const literals: Array<string> = translateStringLiterals();

    // Sanity: the walker really finds the calls, including the ternary.
    expect(literals).toEqual(
      expect.arrayContaining([
        "No security events yet",
        "Pick a product to connect",
        "Supported products",
        "Connect",
        "(opens in a new tab)",
      ]),
    );

    const unlisted: Array<string> = literals.filter((text: string): boolean => {
      return !STRINGS.includes(text);
    });
    expect(unlisted).toEqual([]);
  });

  /*
   * A template literal cannot be looked up by its English text, so it
   * would silently stay English in every locale.
   */
  test("translateString is never given a template literal", () => {
    const templated: Array<string> = translateStringArguments().filter(
      (argument: string): boolean => {
        return argument.includes("`");
      },
    );
    expect(templated).toEqual([]);
  });

  test("Button translates the title it is given", () => {
    const button: string = fs.readFileSync(
      path.join(COMMON_ROOT, "UI", "Components", "Button", "Button.tsx"),
      "utf8",
    );
    expect(button).toMatch(/translateString\(\s*title\s*\)/);
  });

  test("every literal Button title is in the list", () => {
    const titles: Array<string> = jsxTitleLiterals();
    expect(titles).toEqual(["Add connection"]);
    for (const title of titles) {
      expect(STRINGS).toContain(title);
    }
  });

  /*
   * The ways in and the requirements are data, not JSX, so a literal
   * walker over translateString alone would miss them. They are listed,
   * and each field is rendered through translateString.
   */
  test("every ways-in and requirement field is listed and translated", () => {
    const fields: Array<string> = dataFieldLiterals();
    // Two ways in with three fields each, two requirements with two.
    expect(fields).toHaveLength(10);
    for (const field of fields) {
      expect(STRINGS).toContain(field);
    }

    const translatedExpressions: Array<string> = translateStringArguments();
    for (const expression of [
      "wayIn.title",
      "wayIn.description",
      "wayIn.actionTitle",
      "requirement.title",
      "requirement.description",
    ]) {
      expect(translatedExpressions).toContain(expression);
    }
  });

  /*
   * Both directions at once: nothing the components translate is missing
   * from the list, and nothing in the list is left over from copy the
   * components no longer translate.
   */
  test("the component strings are exactly what the components translate", () => {
    expect(
      unique([
        ...translateStringLiterals(),
        ...jsxTitleLiterals(),
        ...dataFieldLiterals(),
      ]),
    ).toEqual(unique(COMPONENT_STRINGS));
  });

  /*
   * Every visible label is translated, so a literal aria-label (which
   * would be read out in English) must not creep in.
   */
  test("no aria-label is an untranslated literal", () => {
    expect(readSourceCode()).not.toMatch(/aria-label="/);
    expect(readSourceCode()).toMatch(
      /aria-label=\{translateString\("Ways to start sending security events"\)\}/,
    );
  });

  /*
   * Product names are brands and the ingest route is API, not prose: they
   * are rendered as is and must never be looked up in the locales.
   */
  test("product names and the ingest endpoint are never translated", () => {
    const translatedExpressions: Array<string> = translateStringArguments();
    expect(translatedExpressions).not.toContain("definition.title");
    expect(translatedExpressions).not.toContain(
      "SECURITY_EVENTS_INGEST_METHOD",
    );
    expect(translatedExpressions).not.toContain("SECURITY_EVENTS_INGEST_PATH");

    for (const definition of SecurityEventConnectorCatalog) {
      expect(STRINGS).not.toContain(definition.title);
    }
    expect(STRINGS).not.toContain("POST");
    expect(STRINGS).not.toContain("/security-events/v1/ingest");
  });

  test("the retired empty-state copy is gone from the components", () => {
    const sources: string = readSources();
    for (const text of RETIRED_STRINGS) {
      expect({ text, rendered: sources.includes(`"${text}"`) }).toEqual({
        text,
        rendered: false,
      });
    }
    expect(readSourceCode()).not.toContain("EmptyStateGuideLinks");
  });

  test.each(localeFiles)(
    "%s no longer carries the retired Events description",
    (file: string) => {
      expect(
        Object.prototype.hasOwnProperty.call(
          readLocale(file),
          RETIRED_EVENTS_DESCRIPTION,
        ),
      ).toBe(false);
    },
  );

  /*
   * i18next splits keys on "." and ":" unless told not to, and most of
   * these strings are sentences with full stops in the middle.
   */
  test("the lookup treats each English string as one flat key", () => {
    const translation: string = fs.readFileSync(
      path.join(COMMON_ROOT, "UI", "Utils", "Translation.tsx"),
      "utf8",
    );
    expect(translation).toMatch(/keySeparator:\s*false/);
    expect(translation).toMatch(/nsSeparator:\s*false/);
  });

  test("all 17 Dashboard locales are covered", () => {
    expect(localeFiles).toHaveLength(17);
    expect(localeFiles).toContain("en.json");
  });

  test("the identical-to-English exceptions are all listed strings", () => {
    for (const text of IDENTICAL_IN_EVERY_LOCALE) {
      expect(CATEGORY_STRINGS).toContain(text);
    }
    for (const copies of Object.values(IDENTICAL_TO_ENGLISH)) {
      for (const text of copies) {
        expect(STRINGS).toContain(text);
      }
    }
  });

  test("English maps every string to itself", () => {
    const english: Record<string, unknown> = readLocale("en.json");
    for (const text of STRINGS) {
      expect(english[text]).toBe(text);
    }
  });

  test.each(nonEnglishLocaleFiles)(
    "%s translates every string",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);
      const allowedCopies: Array<string> = allowedCopiesFor(file);

      for (const text of STRINGS) {
        const value: unknown = locale[text];
        expect(typeof value).toBe("string");
        expect((value as string).trim().length).toBeGreaterThan(0);
        if (!allowedCopies.includes(text)) {
          expect({ text, value }).not.toEqual({ text, value: text });
        }
      }
    },
  );

  /*
   * JSON.parse keeps only the last of two identical keys, so a duplicate
   * would pass every other test while one of the two values is dead text.
   */
  test.each(localeFiles)(
    "%s carries each string exactly once",
    (file: string) => {
      const raw: string = readLocaleRaw(file);
      for (const text of STRINGS) {
        const occurrences: number =
          raw.split(`\n  ${JSON.stringify(text)}: `).length - 1;
        expect({ text, occurrences }).toEqual({ text, occurrences: 1 });
      }
    },
  );

  test.each(localeFiles)(
    "%s keeps the numbers the English strings carry",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);
      const numberPattern: RegExp = /\d+/g;
      for (const text of STRINGS) {
        const englishNumbers: Array<string> = text.match(numberPattern) || [];
        const translatedNumbers: Array<string> =
          toAsciiDigits(String(locale[text])).match(numberPattern) || [];
        expect({ text, numbers: translatedNumbers.sort() }).toEqual({
          text,
          numbers: englishNumbers.sort(),
        });
      }
    },
  );

  test.each(localeFiles)(
    "%s keeps every product, protocol and standard name",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);
      for (const text of STRINGS) {
        const translated: string = String(locale[text]);
        for (const name of BRAND_NAMES) {
          if (text.includes(name)) {
            expect({ text, name, kept: translated.includes(name) }).toEqual({
              text,
              name,
              kept: true,
            });
          }
        }
      }
    },
  );

  /*
   * The descriptions are sentences and the titles, headings and buttons
   * are not; a translation keeps that shape so the page reads the same in
   * every language.
   */
  test.each(localeFiles)(
    "%s ends sentences as sentences and labels as labels",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);
      for (const text of STRINGS) {
        const translated: string = String(locale[text]).trim();
        const englishIsSentence: boolean = text.endsWith(".");
        const translatedIsSentence: boolean = SENTENCE_ENDINGS.some(
          (ending: string): boolean => {
            return translated.endsWith(ending);
          },
        );
        expect({ text, sentence: translatedIsSentence }).toEqual({
          text,
          sentence: englishIsSentence,
        });
      }
    },
  );

  /*
   * "(opens in a new tab)" follows the Setup guide link text inside the
   * same accessible name; it stays a parenthetical aside in every locale
   * (full-width brackets in Chinese and Japanese).
   */
  test.each(localeFiles)(
    "%s keeps the new-tab notice in brackets",
    (file: string) => {
      const notice: string = String(
        readLocale(file)["(opens in a new tab)"],
      ).trim();
      expect(["(", "（"]).toContain(notice.charAt(0));
      expect([")", "）"]).toContain(notice.charAt(notice.length - 1));
    },
  );
});
