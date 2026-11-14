import { describe, expect, it } from "@jest/globals";
import {
  DOCS_LANGUAGES,
  hasPage,
  listPages,
  readPage,
  TRANSLATED_LANGUAGES,
} from "./DocsContentSupport";

/*
 * THE DOCS NAME THE PROJECT'S LLM PROVIDER BY ITS SETTING'S NAME (#7358).
 *
 * Project Settings → AI → LLM Providers is where a project sets up the
 * model OneUptime AI uses, and since #7156 every message that sends people
 * there says "LLM provider". Two docs paragraphs still said "AI provider"
 * for it - the note composer's Draft with AI button "sends the incident to
 * your project's AI provider", and a transcript OneUptime AI could not read
 * because "the AI provider refused" - so a reader whose drafts failed had
 * no setting to look for. Both now say LLM provider, linked to the LLM
 * Providers page, in all 17 languages.
 *
 * "AI provider" stays where it means something else: an outside AI service
 * (OpenAI, Anthropic, Azure and the rest) that a customer's own apps call -
 * Data Security's flows and checks - or whose account OneUptime reads usage
 * from - the AI / LLM observability pages, one of which is called AI
 * Provider Accounts. Those pages are listed here, each with its reason;
 * every other page, in every language, says it nowhere.
 */

const LLM_PROVIDERS_PAGE: string = "/docs/ai/llm-provider";

/*
 * Pages where "AI provider" is the vendor, never the project's LLM
 * provider setting.
 */
const VENDOR_MEANING_PAGES: Readonly<Record<string, string>> = {
  "data-security/index": "services that send sensitive data to AI providers",
  "data-security/flows-access-residency":
    "the flows from a customer's services to AI providers",
  "data-security/checks-and-issues":
    "the check for sensitive data sent to an AI provider",
  "data-security/telemetry": "AI providers a service's spans call",
  "telemetry/ai-provider-accounts":
    "the AI Provider Accounts page: a vendor account's usage and cost",
  "telemetry/ai-llm-observability":
    "connected AI provider accounts and the AI providers apps call",
  "telemetry/ai-gateways": "the provider accounts behind a gateway",
  "telemetry/ai-coding-assistants":
    "coding assistants' vendors, read as provider accounts",
  "telemetry/ai-company-tools": "the AI Provider Accounts page, linked",
  "telemetry/cursor": "Cursor connected as an AI provider account",
};

/*
 * How each language says "AI provider" - the words its two paragraphs
 * used before, and the vendor pages still use. Matched as written: a
 * translation that names the setting says its LLM word instead.
 */
const AI_PROVIDER_FORMS: Readonly<Record<string, RegExp>> = {
  en: /\bAI[ -]providers?\b/i,
  da: /\b(?:AI|KI)-udbyder/,
  de: /\b(?:KI|AI)-Anbieter/,
  es: /\bproveedor(?:es)? de IA\b/,
  fa: /ارائه‌دهند\S* هوش مصنوعی/,
  fr: /\bfournisseurs? (?:d'IA|d’IA|IA)\b/,
  hi: /(?:AI|एआई) प्रदाता/,
  it: /\b(?:fornitor[ei]|provider) di (?:IA|AI)\b/,
  ja: /AI ?プロバイダ/,
  ko: /AI ?(?:제공자|공급자)/,
  nl: /\bAI-(?:providers?|aanbieders?)\b/,
  no: /\b(?:KI|AI)-leverandør/,
  pt: /\bprovedor(?:es)? de IA\b/,
  ru: /(?:поставщик|провайдер)\S* ИИ|ИИ-провайдер/,
  sv: /\bAI-leverantör/,
  "zh-CN": /AI ?(?:提供方|提供商)/,
  "zh-TW": /AI ?(?:提供者|供應商|提供商)/,
};

// The two paragraphs, by the English words they start with.
const PARAGRAPHS: ReadonlyArray<{
  name: string;
  page: string;
  startsWith: string;
  english: string;
}> = [
  {
    name: "Draft with AI",
    page: "incidents/notes-owners-and-feed",
    startsWith: "The composer has a **Draft with AI** button",
    english: `It sends the incident to your project's [LLM provider](${LLM_PROVIDERS_PAGE}) and drops the generated Markdown into the note`,
  },
  {
    name: "a transcript OneUptime AI could not read",
    page: "workspace-connections/video-calls",
    startsWith: "The card says why: AI is off for the project",
    english: `or the project's [LLM provider](${LLM_PROVIDERS_PAGE}) refused.`,
  },
];

interface Found {
  where: string;
  text: string;
}

// Every line of a page that says "AI provider" in the page's language.
function saysAiProvider(lang: string, page: string): Array<Found> {
  const form: RegExp = AI_PROVIDER_FORMS[lang]!;

  return readPage(lang, page)
    .split("\n")
    .map((text: string, index: number): Found => {
      return { where: `${lang}/${page}.md:${index + 1}`, text };
    })
    .filter((found: Found): boolean => {
      return form.test(found.text);
    });
}

// The links of a line: [text](target).
function linksOf(line: string): Array<{ text: string; target: string }> {
  const links: Array<{ text: string; target: string }> = [];
  let at: number = line.indexOf("[");

  while (at !== -1) {
    const close: number = line.indexOf("](", at);
    const end: number = close === -1 ? -1 : line.indexOf(")", close);

    if (close === -1 || end === -1) {
      break;
    }

    links.push({
      text: line.slice(at + 1, close),
      target: line.slice(close + 2, end),
    });
    at = line.indexOf("[", end);
  }

  return links;
}

function paragraphLine(
  lang: string,
  paragraph: (typeof PARAGRAPHS)[number],
): string {
  const english: Array<string> = readPage("en", paragraph.page).split("\n");
  const index: number = english.findIndex((line: string): boolean => {
    return line.startsWith(paragraph.startsWith);
  });

  expect(index).toBeGreaterThan(0);

  // Translations follow the English line for line.
  const lines: Array<string> = readPage(lang, paragraph.page).split("\n");

  expect(lines.length).toBe(english.length);

  return lines[index]!;
}

describe("no page says AI provider for the project's LLM provider", () => {
  it("every language has its words for AI provider", () => {
    expect(Object.keys(AI_PROVIDER_FORMS).sort()).toEqual(
      [...DOCS_LANGUAGES].sort(),
    );
  });

  it.each(DOCS_LANGUAGES)(
    "%s: only the vendor pages say AI provider",
    (lang: string) => {
      const pages: Array<string> = listPages(lang);

      expect(pages.length).toBeGreaterThan(100);
      expect(
        pages
          .filter((page: string): boolean => {
            return VENDOR_MEANING_PAGES[page] === undefined;
          })
          .flatMap((page: string): Array<Found> => {
            return saysAiProvider(lang, page);
          })
          .map((found: Found): string => {
            return `${found.where}: ${found.text}`;
          }),
      ).toEqual([]);
    },
  );

  it("each vendor page is there and still says AI provider, so the list never goes stale", () => {
    for (const page of Object.keys(VENDOR_MEANING_PAGES)) {
      expect({ page, exists: hasPage("en", page) }).toEqual({
        page,
        exists: true,
      });
      expect({
        page,
        says: saysAiProvider("en", page).length > 0,
      }).toEqual({ page, says: true });
    }
  });

  it("the Data Security pages keep AI provider: there it is an outside AI service", () => {
    for (const page of [
      "data-security/index",
      "data-security/flows-access-residency",
      "data-security/checks-and-issues",
    ]) {
      expect(saysAiProvider("en", page).length).toBeGreaterThan(0);
      expect(VENDOR_MEANING_PAGES[page]).toBeDefined();
    }
  });
});

describe("the two paragraphs name the LLM provider and link its page", () => {
  it.each(PARAGRAPHS)(
    "English: $name",
    (paragraph: (typeof PARAGRAPHS)[number]) => {
      const line: string = paragraphLine("en", paragraph);

      expect(line).toContain(paragraph.english);
      expect(line).not.toMatch(AI_PROVIDER_FORMS["en"]!);
    },
  );

  it.each(
    TRANSLATED_LANGUAGES.flatMap((lang: string) => {
      return PARAGRAPHS.map((paragraph: (typeof PARAGRAPHS)[number]) => {
        return { lang, paragraph };
      });
    }),
  )(
    "$lang: $paragraph.name",
    (data: { lang: string; paragraph: (typeof PARAGRAPHS)[number] }) => {
      const lang: string = data.lang;
      const paragraph: (typeof PARAGRAPHS)[number] = data.paragraph;
      const line: string = paragraphLine(lang, paragraph);
      const toLlmProviders: Array<{ text: string; target: string }> = linksOf(
        line,
      ).filter((link: { text: string; target: string }): boolean => {
        return link.target === LLM_PROVIDERS_PAGE;
      });

      // One link, as in English, worded with the language's LLM word.
      expect(toLlmProviders.length).toBe(1);
      expect(toLlmProviders[0]!.text).toContain("LLM");
      expect(line).not.toMatch(AI_PROVIDER_FORMS[lang]!);
    },
  );
});

describe("the reading itself", () => {
  it("finds every link of a line, with its text and its target", () => {
    expect(
      linksOf(
        "See [LLM provider](/docs/ai/llm-provider) and [Ask AI](/docs/ai/ask-ai#setup).",
      ),
    ).toEqual([
      { text: "LLM provider", target: "/docs/ai/llm-provider" },
      { text: "Ask AI", target: "/docs/ai/ask-ai#setup" },
    ]);
    expect(linksOf("No link [here] at all.")).toEqual([]);
  });

  it("knows each language's AI provider words, and not its LLM words", () => {
    const said: Record<string, [string, string]> = {
      en: ["your project's AI provider", "your project's LLM provider"],
      de: ["den KI-Anbieter Ihres Projekts", "den LLM-Anbieter Ihres Projekts"],
      fa: ["ارائه‌دهنده هوش مصنوعی پروژه", "ارائه‌دهنده LLM پروژه"],
      ru: ["поставщику ИИ вашего проекта", "провайдеру LLM вашего проекта"],
      "zh-CN": ["你项目的 AI 提供方", "你项目的 LLM 提供商"],
      nl: ["de AI-aanbieder weigerde", "de LLM-provider weigerde"],
      it: ["il provider di AI", "il provider LLM"],
    };

    for (const [lang, [before, after]] of Object.entries(said)) {
      expect({ lang, before: AI_PROVIDER_FORMS[lang]!.test(before) }).toEqual({
        lang,
        before: true,
      });
      expect({ lang, after: AI_PROVIDER_FORMS[lang]!.test(after) }).toEqual({
        lang,
        after: false,
      });
    }
  });
});
