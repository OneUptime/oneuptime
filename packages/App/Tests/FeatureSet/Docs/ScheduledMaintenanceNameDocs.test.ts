import { SCHEDULED_MAINTENANCE_NAMES } from "../../Dashboard/MaintenanceEventWords";
import { DocsBlock, blocksOf } from "./DocsBlocks";
import { stripHtmlTags } from "./DocsHtmlText";
import {
  TRANSLATED_LANGUAGES,
  listPages,
  readPage,
} from "./DocsContentSupport";
import { describe, expect, test } from "@jest/globals";

/*
 * THE TRANSLATED DOCS NAME SCHEDULED MAINTENANCE AS THEIR DASHBOARD DOES
 * (#8635).
 *
 * Each language's Dashboard names the product with one name, its
 * "Scheduled Maintenance", and #8169 made the status page, the emails and
 * every locale string say it (MaintenanceWordsInLocales). The translated
 * docs went on calling it by the names those locales dropped: Swedish
 * "planerat underhåll", Russian "плановые работы", Japanese
 * "計画メンテナンス", Italian "manutenzione pianificata", Portuguese
 * "manutenção agendada", Chinese "排定的維護" (SCHEDULED_MAINTENANCE_NAMES'
 * otherName).
 *
 * A translation follows its English page block for block (DocsTranslations
 * holds the shape), so each block that says another name is read beside
 * its English block. The other name is right only where the English means
 * something else than the product, and no more often than the English says
 * it (NOT_THE_PRODUCT, each with its reason): "planned maintenance" is a
 * form template's case or a cloud's own window, "planned work" a host or a
 * unit a team takes out. Everywhere else, bold labels, headings and diagram
 * lines included, a block says the Dashboard's name.
 */

// What a block says, its bold labels included: a label names the product too.
function wordsOf(text: string): string {
  return stripHtmlTags(
    text
      .replace(/-<br\s*\/?>/g, "")
      .replace(/<br\s*\/?>/g, " ")
      .replace(/`[^`]*`/g, " ")
      .replace(/\*\*/g, "")
      .replace(/\]\([^)]*\)/g, "]"),
  );
}

interface NotTheProduct {
  english: RegExp;
  why: string;
}

/*
 * What the English may mean where a translation says one of the other
 * names: never the product.
 */
export const NOT_THE_PRODUCT: ReadonlyArray<NotTheProduct> = [
  {
    english: /\bplanned maintenance\b/gi,
    why: "Planned maintenance is a case of its own: a form template's name (Planned Maintenance) or a cloud's or a part's maintenance window, which the languages word as planned.",
  },
  {
    english: /\bplanned work\b/gi,
    why: "Planned work is what a team takes a host or a unit out for (an OpenStack worker disabled, a site's unit switched off), which Russian words плановые работы, as the English means it.",
  },
];

// How many times a text says what the pattern matches.
function count(pattern: RegExp, text: string): number {
  return Array.from(text.matchAll(pattern)).length;
}

/*
 * Why a block's other names are right, or null when they are not: the
 * English says what is not the product at least as often.
 */
export function reasonFor(
  language: string,
  english: string,
  translation: string,
): string | null {
  const otherName: RegExp = new RegExp(
    SCHEDULED_MAINTENANCE_NAMES[language]!.otherName!.source,
    "gi",
  );
  const said: string = wordsOf(english);
  const others: number = count(otherName, wordsOf(translation));
  const meant: Array<NotTheProduct> = NOT_THE_PRODUCT.filter(
    (entry: NotTheProduct): boolean => {
      return count(entry.english, said) > 0;
    },
  );
  const notTheProduct: number = meant.reduce(
    (sum: number, entry: NotTheProduct): number => {
      return sum + count(entry.english, said);
    },
    0,
  );

  return others > 0 && others <= notTheProduct
    ? meant.map((entry: NotTheProduct): string => {
        return entry.why;
      })[0]!
    : null;
}

// What the English says where an other name is left: never the product.
const PLANNED: RegExp = /\bplanned (?:maintenance|work)\b/i;

const NAMED_OTHERWISE: Array<string> = TRANSLATED_LANGUAGES.filter(
  (language: string): boolean => {
    return Boolean(SCHEDULED_MAINTENANCE_NAMES[language]?.otherName);
  },
);

interface Finding {
  where: string;
  says: string;
  english: string;
}

// Every block of a language's docs that says another name, with its English block.
function otherNamesIn(language: string): {
  wrong: Array<Finding>;
  allowed: Array<Finding>;
  unpaired: Array<string>;
} {
  const otherName: RegExp = SCHEDULED_MAINTENANCE_NAMES[language]!.otherName!;
  const englishPages: Set<string> = new Set(listPages("en"));
  const wrong: Array<Finding> = [];
  const allowed: Array<Finding> = [];
  const unpaired: Array<string> = [];

  for (const page of listPages(language)) {
    const translated: Array<DocsBlock> = blocksOf(readPage(language, page));
    const hits: Array<number> = translated
      .map((block: DocsBlock, index: number): number => {
        return !block.code && otherName.test(wordsOf(block.text)) ? index : -1;
      })
      .filter((index: number): boolean => {
        return index >= 0;
      });

    if (hits.length === 0) {
      continue;
    }

    const english: Array<DocsBlock> = englishPages.has(page)
      ? blocksOf(readPage("en", page))
      : [];

    if (english.length !== translated.length) {
      unpaired.push(`${language}/${page}.md`);
      continue;
    }

    for (const index of hits) {
      const finding: Finding = {
        where: `packages/App/FeatureSet/Docs/Content/${language}/${page}.md:${translated[index]!.line + 1}`,
        says: otherName.exec(wordsOf(translated[index]!.text))![0],
        english: wordsOf(english[index]!.text),
      };

      if (reasonFor(language, english[index]!.text, translated[index]!.text)) {
        allowed.push(finding);
      } else {
        wrong.push(finding);
      }
    }
  }

  return { wrong, allowed, unpaired };
}

describe("the translated docs name Scheduled Maintenance as their Dashboard does", () => {
  test("the languages that had another name are the ones checked", () => {
    expect(NAMED_OTHERWISE.sort()).toEqual(
      ["hi", "it", "ja", "pt", "ru", "sv", "zh-TW"].sort(),
    );
  });

  test.each(NAMED_OTHERWISE)(
    "%s: no block names the product another way",
    (language: string) => {
      const { wrong, unpaired } = otherNamesIn(language);

      expect({ language, unpaired, wrong }).toEqual({
        language,
        unpaired: [],
        wrong: [],
      });
    },
  );

  test("the other names left are each where the English means planned maintenance or planned work", () => {
    const allowed: Array<Finding> = NAMED_OTHERWISE.flatMap(
      (language: string): Array<Finding> => {
        return otherNamesIn(language).allowed;
      },
    );

    for (const finding of allowed) {
      expect({
        where: finding.where,
        planned: PLANNED.test(finding.english),
      }).toEqual({ where: finding.where, planned: true });
    }

    // The forms pages' Planned Maintenance template, and OpenStack's planned work (control).
    for (const page of [
      "sv/forms/index.md",
      "ru/monitor/openstack-monitor.md",
    ]) {
      expect({
        page,
        allowed: allowed.some((finding: Finding): boolean => {
          return finding.where.includes(page);
        }),
      }).toEqual({ page, allowed: true });
    }
  });
});

describe("the check itself (controls)", () => {
  test("planned maintenance and planned work are not the product, scheduled maintenance is", () => {
    expect(
      reasonFor(
        "sv",
        "such as **Planned Maintenance**",
        "som **Planerat underhåll**",
      ),
    ).not.toBeNull();
    expect(
      reasonFor(
        "ru",
        "and a disabled one is planned work",
        "а отключённый - это плановая работа",
      ),
    ).not.toBeNull();
    expect(
      reasonFor(
        "sv",
        "**Scheduled maintenance**: create and manage",
        "**Planerat underhåll**: skapa och hantera",
      ),
    ).toBeNull();
    // As often as the English says planned work, and no more.
    expect(
      reasonFor(
        "ru",
        "[Scheduled Maintenance](/docs/x): Tell customers about planned work before it starts.",
        "[Плановое обслуживание](/docs/x): Сообщать клиентам о плановых работах до их начала.",
      ),
    ).not.toBeNull();
    expect(
      reasonFor(
        "ru",
        "never take maintenance for an outage: the monitor stays online through the other project's planned work.",
        "никогда не принимают плановые работы за сбой: монитор остаётся в сети во время плановых работ другого проекта.",
      ),
    ).toBeNull();
    expect(
      reasonFor("sv", "Open the incident.", "Öppna incidenten."),
    ).toBeNull();
  });

  test("each language's other name is found in a sentence, and its name is not", () => {
    const sentences: Record<string, [string, string]> = {
      sv: ["Prenumerera på planerat underhåll", "Schemalagt underhåll"],
      ru: ["**Плановые работы**: создание", "Плановое обслуживание"],
      ja: ["計画メンテナンスのメモ", "定期メンテナンス"],
      it: ["una manutenzione pianificata", "Manutenzione programmata"],
      pt: ["a manutenção agendada", "Manutenção programada"],
      "zh-TW": ["訂閱排定的維護", "排定維護"],
      hi: ["निर्धारित रखरखाव", "अनुसूचित रखरखाव"],
    };

    for (const [language, [other, name]] of Object.entries(sentences)) {
      const otherName: RegExp =
        SCHEDULED_MAINTENANCE_NAMES[language]!.otherName!;

      expect({ language, other: otherName.test(wordsOf(other)) }).toEqual({
        language,
        other: true,
      });
      expect({ language, name: otherName.test(name) }).toEqual({
        language,
        name: false,
      });
    }
  });

  test("a bold label is read, code is not", () => {
    expect(wordsOf("**Planerat underhåll** and `planerat underhåll`")).toBe(
      "Planerat underhåll and  ",
    );
  });

  test("every reason says why", () => {
    for (const entry of NOT_THE_PRODUCT) {
      expect(entry.why.length).toBeGreaterThan(40);
    }
  });
});
