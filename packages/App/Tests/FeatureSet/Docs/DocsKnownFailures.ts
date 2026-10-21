import { DocsKnownFailures } from "./DocsContentRules";

/*
 * The docs pages that broke a content rule when the rules were committed
 * (docs overhaul task 0, 2026-10-08), before the overhaul rewrote them:
 * page -> rule -> the languages it fails in. DocsContentIntegrity and
 * DocsTranslations hold every other page to every rule, and these pages to
 * every rule they keep.
 *
 * This list only shrinks, and it is empty now: docs overhaul task 31
 * rewrote the Mobile & Desktop Apps pages, the last ones on it
 * (2026-10-14).
 *
 *   - When a change makes a page pass a rule, the suites fail and say so
 *     ("<page> passes <rule> in <lang> now: delete ..."). Delete that
 *     language, and the rule or the page once nothing is left under it. A
 *     docs task that rewrites a page with its 16 translations deletes the
 *     page's whole block.
 *   - Never add an entry. A page that breaks a rule it kept is fixed, not
 *     listed: the suites name the line and what is wrong.
 *
 * The rules, by id (DocsContentRules.ts says what each one reads):
 *
 *   navHasPages                  the nav links only to pages that exist
 *   pagesInNav                   every English page is in the nav
 *   noStrayTranslations          every translated page has an English page
 *   titleMatchesNav              line 1 names what the page's nav link names
 *   title                        line 1 is "# Title", the only "# " heading
 *   components                   components are known, closed and nested
 *   codeClosed                   every code sample is closed
 *   pageLinks                    /docs links land on nav pages and headings
 *   inPageAnchors                #anchors land on a heading of the page
 *   images                       images and /docs/static/ files exist
 *   noRelativeLinks              no relative links ("./page.md", "page")
 *   rendered                     no raw ":::", "@tab" or "[!NOTE]" is shown
 *   placeholderLinks             an address to fill in is code, never a link
 *   uniqueHeadings               no two headings of a page share an anchor
 *   codeLanguage                 every English code sample names a language
 *   headingLevels                English headings never skip a level
 *   relativeDocsLinks            English pages link /docs/..., not the site
 *   gettingStartedReachesGroups  Getting Started links into every nav group
 *   translated                   every language has every English page
 *   sameShape                    a translation keeps its English page's shape
 */

export const DOCS_KNOWN_FAILURES: DocsKnownFailures = {};
