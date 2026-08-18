/**
 * The <meta name="robots"> half of the status page indexing opt-out, rendered
 * from the real template.
 *
 * This is the channel that matters most: it is in the server-rendered HTML
 * before the JS bundle loads, so it is what a crawler that does not run
 * JavaScript sees. The X-Robots-Tag header that backs it up is asserted in
 * App/Tests/StatusPage/SearchEngineIndexingResponses.test.ts.
 *
 * The template is read off disk rather than reproduced here, because the
 * failure this guards against is someone editing index.ejs - a copy of the
 * markup would keep passing while the shipped page lost its tag. It lives
 * under Common/Tests because that is where the ejs types are installed;
 * Common/Tests/App is the established home for tests that reach into App.
 */

import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import path from "path";

const INDEX_TEMPLATE: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "StatusPage",
  "views",
  "index.ejs",
);

const NOINDEX_META: RegExp =
  /<meta\s+name="robots"\s+content="noindex,\s*nofollow">/;

function renderIndexPage(variables: JSONObject): string {
  return ejs.render(fs.readFileSync(INDEX_TEMPLATE, "utf8"), variables);
}

describe("the status page index template", () => {
  it("tells crawlers not to index when the owner turned indexing off", () => {
    const html: string = renderIndexPage({
      title: "Acme Status",
      description: "How Acme is doing.",
      isSearchEngineIndexingEnabled: false,
    });

    expect(html).toMatch(NOINDEX_META);
  });

  it("keeps the noindex tag inside <head>, where crawlers read it", () => {
    const html: string = renderIndexPage({
      title: "Acme Status",
      isSearchEngineIndexingEnabled: false,
    });

    const head: string = html.split("</head>")[0] || "";
    expect(head).toMatch(NOINDEX_META);
  });

  it("says nothing about robots when indexing is on", () => {
    /*
     * Not "emits index, follow". A crawler already assumes that, and emitting
     * it would override a noindex an operator set on a proxy in front of
     * OneUptime - the last robots instruction a crawler reads is the one that
     * counts.
     */
    const html: string = renderIndexPage({
      title: "Acme Status",
      description: "How Acme is doing.",
      isSearchEngineIndexingEnabled: true,
    });

    expect(html).not.toContain('name="robots"');
  });

  it("says nothing about robots when the variable was never passed", () => {
    /*
     * The fallback render - a host that resolves to no status page - passes
     * no flag at all, and must not throw on the missing variable either.
     * That page is the generic placeholder and stays indexable, which is what
     * shipped before this feature.
     */
    const html: string = renderIndexPage({ title: "Status Page" });

    expect(html).not.toContain('name="robots"');
    expect(html).toContain("<title>Status Page</title>");
  });

  it.each([
    ["a truthy non-boolean", "no"],
    ["null", null],
    ["zero", 0],
  ])(
    "only an explicit false suppresses indexing, not %s",
    (_label: string, value: unknown) => {
      /*
       * The template compares against false rather than testing falsiness, so
       * a value arriving in an unexpected shape leaves the page indexable
       * instead of silently de-indexing it.
       */
      const html: string = renderIndexPage({
        title: "Acme Status",
        isSearchEngineIndexingEnabled: value,
      } as JSONObject);

      expect(html).not.toContain('name="robots"');
    },
  );

  it("still renders the rest of the head when indexing is off", () => {
    /*
     * The opt-out must not cost the page its title, description or favicon -
     * a page kept out of search results is still a page people read.
     */
    const html: string = renderIndexPage({
      title: "Acme Status",
      description: "How Acme is doing.",
      faviconUrl: "/status-page-api/favicon/acme",
      isSearchEngineIndexingEnabled: false,
    });

    expect(html).toContain("<title>Acme Status</title>");
    expect(html).toContain('content="How Acme is doing."');
    expect(html).toContain('href="/status-page-api/favicon/acme"');
  });
});
