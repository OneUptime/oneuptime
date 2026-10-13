/**
 * The <meta name="robots"> of the public dashboard page, rendered from the
 * real template.
 *
 * A link no dashboard answers on - none was made, it is archived or shared
 * only with its project, or a master admin blocked its project - is served as
 * a 404 kept out of search results (PublicPageNotFound): the X-Robots-Tag
 * header is asserted in App/Tests/PublicDashboard/
 * BlockedProjectPublicDashboardServers.test.ts, and this is the tag in the
 * HTML, which a crawler that reads the body sees whatever the status.
 *
 * Read off disk rather than reproduced, like the status page's
 * (Common/Tests/App/StatusPage/StatusPageIndexPageRobotsMeta.test.ts).
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
  "PublicDashboard",
  "views",
  "index.ejs",
);

const NOINDEX_META: RegExp =
  /<meta\s+name="robots"\s+content="noindex,\s*nofollow">/;

function renderIndexPage(variables: JSONObject): string {
  return ejs.render(fs.readFileSync(INDEX_TEMPLATE, "utf8"), variables, {
    // The template includes a shared partial by a path relative to itself.
    filename: INDEX_TEMPLATE,
  });
}

describe("the public dashboard index template", () => {
  it("tells crawlers not to index a link no dashboard answers on", () => {
    const html: string = renderIndexPage({
      isSearchEngineIndexingEnabled: false,
    });

    const head: string = html.split("</head>")[0] || "";
    expect(head).toMatch(NOINDEX_META);
  });

  it("carries nothing of a dashboard it does not show: the placeholder title and description", () => {
    const html: string = renderIndexPage({
      isSearchEngineIndexingEnabled: false,
    });

    expect(html).toContain("<title>Dashboard</title>");
    expect(html).toContain('content="View dashboard metrics and insights."');
  });

  it("says nothing about robots for a dashboard it shows", () => {
    const html: string = renderIndexPage({
      title: "Acme Metrics",
      description: "How Acme is doing.",
    });

    expect(html).not.toContain('name="robots"');
    expect(html).toContain("<title>Acme Metrics</title>");
  });

  it.each([
    ["true", true],
    ["a truthy non-boolean", "no"],
    ["null", null],
  ])(
    "only an explicit false emits the tag, not %s",
    (_label: string, value: unknown) => {
      const html: string = renderIndexPage({
        title: "Acme Metrics",
        isSearchEngineIndexingEnabled: value,
      } as JSONObject);

      expect(html).not.toContain('name="robots"');
    },
  );
});
