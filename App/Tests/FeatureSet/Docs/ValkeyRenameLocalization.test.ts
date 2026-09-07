import {
  DEFAULT_DOCS_LANGUAGE,
  SUPPORTED_DOCS_LANGUAGE_CODES,
} from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Locale parity for the Redis -> Valkey rename in the installation docs.
 *
 * The rename changed what a self-hoster types: the settings became `VALKEY_*`,
 * the Helm values `valkey:` / `externalValkey:`, the Kubernetes objects
 * `<release>-valkey*`. English was updated in the same PR; the 15 translations
 * were not, and nothing failed — a stale translation renders perfectly, it just
 * tells the reader to set variables the app no longer prefers.
 *
 * These tests read the English page as the source of truth and assert each
 * locale carries the same content. Two properties matter and neither is
 * cosmetic:
 *
 *   1. Every identifier the English text puts in backticks survives into every
 *      locale, character for character. A translator who localises `VALKEY_HOST`
 *      or lets a CJK input method turn `redis:` into `redis：` ships a value the
 *      reader copies and the app never reads.
 *
 *   2. The prose is actually translated. This repo has a `TODO(i18n)` marker
 *      convention for deferring a section, so "the file changed" is not evidence
 *      the reader can understand it — the section must contain neither that
 *      marker nor a verbatim copy of the English sentences.
 *
 * The structural counts (paragraphs, list items) are deliberate drift alarms: if
 * someone adds a bullet to the English section later, these fail until the 15
 * translations follow it, which is exactly the failure this file exists to stop.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const TRANSLATED_LANGUAGES: Array<string> =
  SUPPORTED_DOCS_LANGUAGE_CODES.filter((code: string): boolean => {
    return code !== DEFAULT_DOCS_LANGUAGE;
  });

const UPGRADING_PAGE: string = "installation/upgrading";
const COMPOSE_PAGE: string = "installation/docker-compose";
const SIZING_PAGE: string = "installation/sizing";

const VALKEY_LINK: string = "https://valkey.io";
const RENAMED_IN_VERSION: string = "12.0.36";
const TODO_MARKER: RegExp = /TODO\(i18n\)/;

const FENCE_LINE: RegExp = /^\s*```/;
const HEADING_LINE: RegExp = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM_LINE: RegExp = /^\s*[-*]\s+/;
const CODE_SPAN: RegExp = /`([^`\n]+)`/g;
const REDIS_MENTION: RegExp = /Redis/i;

function readPage(lang: string, page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, lang, `${page}.md`), "utf8");
}

type Heading = {
  level: number;
  text: string;
  line: number;
};

/*
 * Headings inside fenced blocks are shell comments, not headings — the same
 * reason Scripts/Docs/CheckAnchors.ts skips fences.
 */
function headingsOf(markdown: string): Array<Heading> {
  const found: Array<Heading> = [];
  let inFence: boolean = false;

  markdown.split("\n").forEach((line: string, index: number) => {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) {
      return;
    }
    const match: RegExpMatchArray | null = line.match(HEADING_LINE);
    if (match) {
      found.push({
        level: match[1]!.length,
        text: match[2]!.trim(),
        line: index,
      });
    }
  });

  return found;
}

/*
 * The Valkey section is found by its heading rather than by position, because
 * the heading text is translated in every locale but the product names inside it
 * are not. It runs until the next heading at the same level or higher.
 */
function valkeySection(markdown: string): { heading: Heading; body: string } {
  const headings: Array<Heading> = headingsOf(markdown);
  const matches: Array<Heading> = headings.filter(
    (heading: Heading): boolean => {
      return heading.text.includes("Valkey");
    },
  );

  expect(matches).toHaveLength(1);

  const heading: Heading = matches[0]!;
  const lines: Array<string> = markdown.split("\n");

  const next: Heading | undefined = headings.find(
    (candidate: Heading): boolean => {
      return candidate.line > heading.line && candidate.level <= heading.level;
    },
  );

  const end: number = next ? next.line : lines.length;

  return { heading, body: lines.slice(heading.line + 1, end).join("\n") };
}

/*
 * The compose and sizing changes are a single bullet and a single paragraph
 * rather than a section, so they are located by the one thing that is identical
 * in every language: the link to valkey.io.
 */
function blockLinkingToValkey(markdown: string): string {
  const blocks: Array<string> = markdown.split(/\n\s*\n/);
  const matches: Array<string> = blocks.filter((block: string): boolean => {
    return block.includes(VALKEY_LINK);
  });

  expect(matches).toHaveLength(1);

  return matches[0]!;
}

function codeSpansOf(text: string): Array<string> {
  return [...text.matchAll(CODE_SPAN)].map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

function listItemCount(text: string): number {
  return text.split("\n").filter((line: string): boolean => {
    return LIST_ITEM_LINE.test(line);
  }).length;
}

function paragraphCount(text: string): number {
  return text.split(/\n\s*\n/).filter((block: string): boolean => {
    return block.trim().length > 0;
  }).length;
}

/*
 * Comparing prose for "was this actually translated" has to ignore everything
 * that is legitimately identical across languages: code spans, URLs, product
 * names and markdown punctuation. What is left is the sentences.
 */
function proseOnly(text: string): string {
  return text
    .replace(CODE_SPAN, " ")
    .replace(/\(https?:\/\/[^)]+\)/g, " ")
    .replace(/[#*\-_[\]()>|:.,;!?/]/g, " ")
    .replace(
      /\b(Valkey|Redis|OneUptime|Docker|Compose|Helm|Kubernetes|BullMQ|StatefulSet|Secret)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

describe("Valkey rename — installation docs localization", () => {
  describe("upgrading.md", () => {
    const english: string = readPage(DEFAULT_DOCS_LANGUAGE, UPGRADING_PAGE);
    const englishSection: { heading: Heading; body: string } =
      valkeySection(english);

    it("documents the rename in the English page's first section", () => {
      const headings: Array<Heading> = headingsOf(english);
      const firstLevelTwo: Heading = headings.find(
        (heading: Heading): boolean => {
          return heading.level === 2;
        },
      )!;

      expect(englishSection.heading.level).toBe(3);
      expect(englishSection.heading.line).toBeGreaterThan(firstLevelTwo.line);
      expect(englishSection.body).toContain(VALKEY_LINK);
      expect(codeSpansOf(englishSection.body).length).toBeGreaterThan(0);
    });

    it("keeps every English identifier intact in every locale", () => {
      const expected: Array<string> = [
        ...new Set(codeSpansOf(englishSection.body)),
      ];

      for (const lang of TRANSLATED_LANGUAGES) {
        const section: { heading: Heading; body: string } = valkeySection(
          readPage(lang, UPGRADING_PAGE),
        );
        const present: Array<string> = codeSpansOf(section.body);

        for (const identifier of expected) {
          /*
           * Named per language and per identifier so a failure says which
           * locale mangled which value instead of dumping the whole page.
           */
          expect(`${lang}: ${present.join(" ")}`).toContain(identifier);
        }
      }
    });

    it("mirrors the English structure in every locale", () => {
      const expectedItems: number = listItemCount(englishSection.body);
      const expectedParagraphs: number = paragraphCount(englishSection.body);

      for (const lang of TRANSLATED_LANGUAGES) {
        const section: { heading: Heading; body: string } = valkeySection(
          readPage(lang, UPGRADING_PAGE),
        );

        expect({ lang, items: listItemCount(section.body) }).toEqual({
          lang,
          items: expectedItems,
        });
        expect({ lang, paragraphs: paragraphCount(section.body) }).toEqual({
          lang,
          paragraphs: expectedParagraphs,
        });
        expect({ lang, level: section.heading.level }).toEqual({
          lang,
          level: englishSection.heading.level,
        });
        expect(section.body).toContain(VALKEY_LINK);
      }
    });

    it("places the section under the first top-level section in every locale", () => {
      for (const lang of TRANSLATED_LANGUAGES) {
        const markdown: string = readPage(lang, UPGRADING_PAGE);
        const headings: Array<Heading> = headingsOf(markdown);
        const section: { heading: Heading; body: string } =
          valkeySection(markdown);

        const enclosing: Heading = headings
          .filter((heading: Heading): boolean => {
            return heading.level === 2 && heading.line < section.heading.line;
          })
          .pop()!;
        const firstLevelTwo: Heading = headings.find(
          (heading: Heading): boolean => {
            return heading.level === 2;
          },
        )!;

        expect({ lang, line: enclosing.line }).toEqual({
          lang,
          line: firstLevelTwo.line,
        });
      }
    });

    it("carries real translations, not deferred English", () => {
      const englishProse: string = proseOnly(englishSection.body);

      for (const lang of TRANSLATED_LANGUAGES) {
        const section: { heading: Heading; body: string } = valkeySection(
          readPage(lang, UPGRADING_PAGE),
        );

        expect({ lang, todo: TODO_MARKER.test(section.body) }).toEqual({
          lang,
          todo: false,
        });
        expect({
          lang,
          sameAsEnglish: proseOnly(section.body) === englishProse,
        }).toEqual({ lang, sameAsEnglish: false });
        expect({ lang, heading: section.heading.text }).not.toEqual({
          lang,
          heading: englishSection.heading.text,
        });
      }
    });
  });

  describe("docker-compose.md", () => {
    const english: string = readPage(DEFAULT_DOCS_LANGUAGE, COMPOSE_PAGE);
    const englishBullet: string = blockLinkingToValkey(english);

    it("names the version the settings were renamed in", () => {
      expect(englishBullet).toContain(RENAMED_IN_VERSION);
    });

    it("keeps every English identifier intact in every locale", () => {
      const expected: Array<string> = [...new Set(codeSpansOf(englishBullet))];

      for (const lang of TRANSLATED_LANGUAGES) {
        const block: string = blockLinkingToValkey(
          readPage(lang, COMPOSE_PAGE),
        );
        const present: Array<string> = codeSpansOf(block);

        for (const identifier of expected) {
          expect(`${lang}: ${present.join(" ")}`).toContain(identifier);
        }

        expect(`${lang}: ${block}`).toContain(RENAMED_IN_VERSION);
        expect({ lang, todo: TODO_MARKER.test(block) }).toEqual({
          lang,
          todo: false,
        });
      }
    });

    it("stops telling operators the cache is called Redis", () => {
      /*
       * The bullet above it used to read "Redis is used as a cache and is
       * stateless"; the rename reworded it so the backups advice does not name
       * the engine at all. A locale that still says Redis there has not been
       * updated even if the new bullet landed.
       */
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const markdown: string = readPage(lang, COMPOSE_PAGE);
        const bullets: Array<string> = markdown
          .split("\n")
          .filter((line: string): boolean => {
            return LIST_ITEM_LINE.test(line);
          });

        const mentioningRedis: Array<string> = bullets.filter(
          (line: string): boolean => {
            return REDIS_MENTION.test(line) && !line.includes(VALKEY_LINK);
          },
        );

        expect({ lang, bullets: mentioningRedis }).toEqual({
          lang,
          bullets: [],
        });
      }
    });
  });

  describe("sizing.md", () => {
    const english: string = readPage(DEFAULT_DOCS_LANGUAGE, SIZING_PAGE);
    const englishParagraph: string = blockLinkingToValkey(english);

    it("keeps every English identifier intact in every locale", () => {
      const expected: Array<string> = [
        ...new Set(codeSpansOf(englishParagraph)),
      ];

      for (const lang of TRANSLATED_LANGUAGES) {
        const block: string = blockLinkingToValkey(readPage(lang, SIZING_PAGE));
        const present: Array<string> = codeSpansOf(block);

        for (const identifier of expected) {
          expect(`${lang}: ${present.join(" ")}`).toContain(identifier);
        }

        expect({ lang, todo: TODO_MARKER.test(block) }).toEqual({
          lang,
          todo: false,
        });
      }
    });

    it("carries real translations, not deferred English", () => {
      const englishProse: string = proseOnly(englishParagraph);

      for (const lang of TRANSLATED_LANGUAGES) {
        const block: string = blockLinkingToValkey(readPage(lang, SIZING_PAGE));

        expect({
          lang,
          sameAsEnglish: proseOnly(block) === englishProse,
        }).toEqual({ lang, sameAsEnglish: false });
      }
    });
  });
});
