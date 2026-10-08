import {
  DOCS_CONTENT_RULES,
  DOCS_CORPUS,
  DocsContentRule,
  DocsReader,
  NOTHING_CHANGED,
  checkRule,
} from "./DocsContentRules";
import { TRANSLATED_LANGUAGES } from "./DocsContentSupport";
import { DOCS_KNOWN_FAILURES } from "./DocsKnownFailures";
import { describe, expect, it } from "@jest/globals";

/*
 * Every page is in every language, and each translation says what the
 * English says: the same sections, the same code, the same diagrams, the
 * same components, links and images. A page with no translation is served in
 * English, and a translation that has drifted - a section the English gained
 * after it was translated, a code sample that changed - tells its readers
 * something the product no longer does.
 *
 * What is compared is the page's shape, not its words: the heading levels in
 * order, each code sample's language, the components and their tabs and
 * steps, the callouts, the {{PLACEHOLDERS}}, the docs pages it links to and
 * the images it shows (DocsContentRules.ts, shapeOf).
 *
 * A page that was untranslated or had drifted when these tests were
 * committed is listed in DocsKnownFailures.ts ("translated", "sameShape"),
 * with its languages; the list only shrinks. A translation's title line is
 * checked with every other page's, in DocsContentIntegrity.
 */

const docs: DocsReader = new DocsReader(DOCS_CORPUS);

const TRANSLATION_RULES: Array<DocsContentRule> = DOCS_CONTENT_RULES.filter(
  (rule: DocsContentRule): boolean => {
    return rule.suite === "translations";
  },
);

describe.each(TRANSLATED_LANGUAGES)("the %s docs", (lang: string) => {
  it.each(
    TRANSLATION_RULES.map(
      (rule: DocsContentRule): [string, DocsContentRule] => {
        return [rule.title, rule];
      },
    ),
  )("%s", async (_title: string, rule: DocsContentRule) => {
    expect(await checkRule(docs, rule, lang, DOCS_KNOWN_FAILURES)).toEqual(
      NOTHING_CHANGED,
    );
  });
});
