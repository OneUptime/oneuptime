import { describeContentRules } from "./DocsContentRules";
import { DOCS_LANGUAGES } from "./DocsContentSupport";
import { DOCS_KNOWN_FAILURES } from "./DocsKnownFailures";

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
 *   - every link to another docs page, every #anchor, every image and file
 *     leads somewhere, and no two headings share an anchor;
 *   - every code sample is closed, and in English declares its language;
 *     English headings never skip a level, and Getting Started links into
 *     every nav group.
 *
 * The rules are in DocsContentRules.ts. A page that failed a rule when these
 * tests were committed is listed in DocsKnownFailures.ts, with the languages
 * it fails in; the list only shrinks. So each test fails on two things: a
 * page that breaks the rule and is not listed (named with its line and what
 * is wrong - fix it), and a listed page that keeps the rule now (delete its
 * entry).
 */

describeContentRules({
  suite: "content",
  languages: DOCS_LANGUAGES,
  name: "%s pages",
  known: DOCS_KNOWN_FAILURES,
});
