import { describeContentRules } from "./DocsContentRules";
import { TRANSLATED_LANGUAGES } from "./DocsContentSupport";
import { DOCS_KNOWN_FAILURES } from "./DocsKnownFailures";

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
 * with its languages; the list only shrinks. A translation's title line,
 * links, components and headings are checked with every other page's, in
 * DocsContentIntegrity.
 */

describeContentRules({
  suite: "translations",
  languages: TRANSLATED_LANGUAGES,
  name: "the %s docs",
  known: DOCS_KNOWN_FAILURES,
});
