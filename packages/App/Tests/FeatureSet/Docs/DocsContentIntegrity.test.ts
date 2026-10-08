import {
  DOCS_CONTENT_RULES,
  DOCS_CORPUS,
  DocsContentRule,
  DocsReader,
  NOTHING_CHANGED,
  checkRule,
  languagesOfScope,
} from "./DocsContentRules";
import { DOCS_LANGUAGES } from "./DocsContentSupport";
import { DOCS_KNOWN_FAILURES } from "./DocsKnownFailures";
import { describe, expect, it } from "@jest/globals";

/*
 * Every page in every language, held to the rules a reader relies on:
 *
 *   - the nav and the files agree: every page the nav lists exists, every
 *     page that exists is listed (a page outside the nav is a 404), and no
 *     translation is left without its English page;
 *   - a page has one title, on its first line, and it is about what its nav
 *     link says;
 *   - components are written so the renderer reads them - known names,
 *     closed, tabs inside a tab set - and nothing is left on the page as raw
 *     ":::" text;
 *   - every link to another docs page, every #anchor and every image leads
 *     somewhere, and no two headings share an anchor;
 *   - every code sample is closed, and in English declares its language;
 *     English headings never skip a level.
 *
 * The rules are in DocsContentRules.ts. A page that failed a rule when these
 * tests were committed is listed in DocsKnownFailures.ts, with the languages
 * it fails in; the list only shrinks. So each test fails on two things: a
 * page that breaks the rule and is not listed (named with its line and what
 * is wrong - fix it), and a listed page that keeps the rule now (delete its
 * entry).
 */

const docs: DocsReader = new DocsReader(DOCS_CORPUS);

const CONTENT_RULES: Array<DocsContentRule> = DOCS_CONTENT_RULES.filter(
  (rule: DocsContentRule): boolean => {
    return rule.suite === "content";
  },
);

describe.each(DOCS_LANGUAGES)("%s pages", (lang: string) => {
  const rules: Array<DocsContentRule> = CONTENT_RULES.filter(
    (rule: DocsContentRule): boolean => {
      return languagesOfScope(docs, rule.scope).includes(lang);
    },
  );

  it.each(
    rules.map((rule: DocsContentRule): [string, DocsContentRule] => {
      return [rule.title, rule];
    }),
  )("%s", async (_title: string, rule: DocsContentRule) => {
    expect(await checkRule(docs, rule, lang, DOCS_KNOWN_FAILURES)).toEqual(
      NOTHING_CHANGED,
    );
  });
});
