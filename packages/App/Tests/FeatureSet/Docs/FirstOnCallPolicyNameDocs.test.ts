import {
  TRANSLATED_LANGUAGES,
  listPages,
  readPage,
} from "./DocsContentSupport";
import { dashboardTranslator, isDashboardLabel } from "./DocsDashboardLabels";
import { inlineCode } from "./DocsTranslationChecks";
import {
  GUIDED_SETUP_POLICY_NAME,
  getFirstOnCallPolicyName,
} from "Common/Utils/GuidedSetup/OnCallPolicyRecords";
import { describe, expect, test } from "@jest/globals";

/*
 * THE FIRST ON-CALL POLICY, NAMED AS THE READER'S DASHBOARD NAMES IT (#8329).
 *
 * The website-down and on-call guided setups, and Ask AI's set_up_paging,
 * name a project's first on-call policy in the language of the person it is
 * made for (#7995): "Standard-Bereitschaftsrichtlinie" for a reader of
 * German, "Politique d'astreinte par défaut" for one of French. The
 * translated docs still quoted the English name as inline code - "Dabei
 * wird die Richtlinie `Default on-call policy` angelegt" - while the German
 * reader's On-Call Policies list showed "Standard-Bereitschaftsrichtlinie".
 *
 * Inline code is what a translation keeps as written (the docs checks hold
 * a translated page's code spans to the English page's), and the name is not
 * code: it is the words the Dashboard draws in the list and in the On-call
 * policy dropdown the Quickstart says to leave it in. So every page names
 * it in bold, as any label the Dashboard draws, and the translation suites
 * that read those pages (Introduction, Guides, AI) hold the bold name to
 * the language's Dashboard locale like every other one. This holds the rest:
 *
 *   - the English pages name it in bold, never as inline code or quoted;
 *   - each translated page names it, in bold, on every line its English
 *     page does, with the words the guided setup gives it for that reader
 *     (getFirstOnCallPolicyName with the language's translator);
 *   - no translated page names it in English anywhere.
 *
 * The server words it as the Dashboard does for Ask AI
 * (Common/Tests/Server/Locales/ServerLocalesDashboardWords).
 */

const ENGLISH_NAME: string = GUIDED_SETUP_POLICY_NAME;

// The name as each language's guided setups make it.
function policyNameIn(language: string): string {
  return getFirstOnCallPolicyName(dashboardTranslator(language));
}

// The English pages that name the first policy.
function pagesNamingThePolicy(): Array<string> {
  return listPages("en").filter((page: string): boolean => {
    return readPage("en", page).includes(ENGLISH_NAME);
  });
}

// The lines of a page that name the policy in bold, by their index.
function boldLines(markdown: string, name: string): Array<number> {
  return markdown
    .split("\n")
    .flatMap((line: string, index: number): Array<number> => {
      return line.includes(`**${name}**`) ? [index] : [];
    });
}

// The ways a page might name the policy other than in bold.
function unboldedNames(markdown: string, name: string): Array<string> {
  const withoutBold: string = markdown.split(`**${name}**`).join(" ");
  const found: Array<string> = [];

  if (inlineCode(markdown).includes(name)) {
    found.push(`\`${name}\``);
  }

  if (withoutBold.includes(name)) {
    found.push(name);
  }

  return found;
}

describe("the first on-call policy's name", () => {
  test("is a Dashboard label, so the translation suites draw it like any other", () => {
    expect(ENGLISH_NAME).toBe("Default on-call policy");
    expect(isDashboardLabel(ENGLISH_NAME)).toBe(true);
  });

  test("is named by the Quickstart, the website-down and paging guides and Ask AI (control)", () => {
    expect(pagesNamingThePolicy()).toEqual(
      expect.arrayContaining([
        "ai/ask-ai",
        "guides/paging",
        "guides/website-down",
        "introduction/quickstart",
      ]),
    );
  });

  test.each(TRANSLATED_LANGUAGES)(
    "is worded in %s, not left in English",
    (language: string) => {
      expect(policyNameIn(language)).not.toBe(ENGLISH_NAME);
      expect(policyNameIn(language).trim()).not.toBe("");
    },
  );

  test("reads as the German, French and Persian setups name it", () => {
    expect(policyNameIn("de")).toBe("Standard-Bereitschaftsrichtlinie");
    expect(policyNameIn("fr")).toBe("Politique d'astreinte par défaut");
    expect(policyNameIn("fa")).toBe("سیاست آنکال پیش‌فرض");
    expect(policyNameIn("en")).toBe(ENGLISH_NAME);
  });
});

describe("the English pages", () => {
  test.each(pagesNamingThePolicy())(
    "%s names the policy in bold, never as code or in quotes",
    (page: string) => {
      const markdown: string = readPage("en", page);

      expect(boldLines(markdown, ENGLISH_NAME).length).toBeGreaterThan(0);
      expect(unboldedNames(markdown, ENGLISH_NAME)).toEqual([]);
    },
  );
});

describe.each(TRANSLATED_LANGUAGES)("%s", (language: string) => {
  test.each(pagesNamingThePolicy())(
    "%s names the policy in bold on every line the English does, as this reader's setup names it",
    (page: string) => {
      const english: string = readPage("en", page);
      const translated: string = readPage(language, page);
      const name: string = policyNameIn(language);

      expect({ page, lines: boldLines(translated, name) }).toEqual({
        page,
        lines: boldLines(english, ENGLISH_NAME),
      });
      expect(unboldedNames(translated, name)).toEqual([]);
    },
  );

  test("no page names the policy in English", () => {
    const english: Array<string> = listPages(language).filter(
      (page: string): boolean => {
        return readPage(language, page).includes(ENGLISH_NAME);
      },
    );

    expect(english).toEqual([]);
  });
});

describe("the checks (controls)", () => {
  test("find the name quoted as code, in quotes, or bare", () => {
    expect(
      unboldedNames("this makes `Default on-call policy`, which", ENGLISH_NAME),
    ).toEqual(["`Default on-call policy`", ENGLISH_NAME]);
    expect(
      unboldedNames(
        'the first policy, "Default on-call policy", paging',
        ENGLISH_NAME,
      ),
    ).toEqual([ENGLISH_NAME]);
    expect(
      unboldedNames(
        "this makes **Default on-call policy**, which",
        ENGLISH_NAME,
      ),
    ).toEqual([]);
  });

  test("read bold names by line", () => {
    expect(
      boldLines(
        "One.\n**Standardjourpolicy** larmar.\nTwo.\nBehåll **Standardjourpolicy**.",
        "Standardjourpolicy",
      ),
    ).toEqual([1, 3]);
    // A name written another way is not the name.
    expect(boldLines("**Standardjour policy**", "Standardjourpolicy")).toEqual(
      [],
    );
  });
});
