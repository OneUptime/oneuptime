import {
  ALL_MONITORS_TABLE_ID,
  MONITOR_TEMPLATE_FACET_QUERY_FIELD,
} from "../../FeatureSet/Dashboard/src/Components/Monitor/MonitorFacets";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * The third of issue #3491's asks: a Linked Monitors count on the template
 * page, and a direct link from there into the monitor list already filtered to
 * that template.
 *
 * The column and the chip themselves are asserted behaviourally, by rendering
 * the real table (Common/Tests/App/Dashboard/MonitorTemplateColumnAndFacet), and
 * the link's URL round-trip by driving the real Navigation and
 * TableFilterUrlState (MonitorListFacetRoute.test). What is left over is the
 * settings page's own wiring, which has no renderer in this suite — so, like
 * CustomFieldFilteringInvariants and SummaryTileFilteringInvariants, this reads
 * the source and asserts the expressions.
 *
 * Each assertion corresponds to a way the hand-off can be broken while every
 * other test stays green: the card losing its count, the button navigating
 * somewhere other than the shared route builder, the two ends of the link
 * naming different table ids, or the facet vocabulary picking up an import that
 * makes it unloadable from this suite.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type SquashFunction = (text: string) => string;

const squash: SquashFunction = (text: string): string => {
  return text.replace(/\s+/g, " ");
};

type ReadSourceFunction = (...relativeParts: Array<string>) => string;

const readSource: ReadSourceFunction = (
  ...relativeParts: Array<string>
): string => {
  return squash(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  );
};

const MONITORS_PAGE: string = readSource("Pages", "Monitor", "Monitors.tsx");
const TEMPLATE_VIEW_PAGE: string = readSource(
  "Pages",
  "Monitor",
  "Settings",
  "MonitorTemplatesView.tsx",
);
const FACET_VOCABULARY: string = readSource(
  "Components",
  "Monitor",
  "MonitorFacets.ts",
);
const FACET_ROUTE: string = readSource(
  "Components",
  "Monitor",
  "MonitorListFacetRoute.ts",
);

describe("the Linked Monitors card on a template", () => {
  /*
   * "How many monitors would a template edit touch" is the question this page
   * is open to answer, and it should be answerable without reading a button
   * that is about to overwrite them.
   */
  test("puts the count in its title", () => {
    expect(TEMPLATE_VIEW_PAGE).toContain(
      "`Linked Monitors (${linkedMonitorCount})`",
    );
    expect(TEMPLATE_VIEW_PAGE).toContain("title={linkedMonitorsTitle}");
  });

  /*
   * The count is fetched, so it is absent on the first paint. Interpolating a
   * null would put "Linked Monitors (null)" on the card until it lands.
   */
  test("and falls back to a bare title until the count arrives", () => {
    expect(TEMPLATE_VIEW_PAGE).toContain(
      'linkedMonitorCount === null ? "Linked Monitors"',
    );
  });

  /*
   * The count and the table have to be counting the same thing. Both go through
   * `monitorTemplateId`, which is also what makes MonitorTable drop the Template
   * chip and column here — a chip would overwrite this scope rather than narrow
   * it, and the card would list another template's monitors under this
   * template's heading.
   */
  test("counts and lists the same monitors, by the template foreign key", () => {
    expect(TEMPLATE_VIEW_PAGE).toContain("monitorTemplateId: modelId,");
    expect(TEMPLATE_VIEW_PAGE).toContain("query={linkedMonitorsQuery}");
    expect(MONITOR_TEMPLATE_FACET_QUERY_FIELD).toBe("monitorTemplateId");
  });
});

describe("the button into the filtered monitor list", () => {
  test("is offered on the card", () => {
    expect(TEMPLATE_VIEW_PAGE).toContain('title: "Open in Monitors List",');
  });

  /*
   * Composed from the shared selection and the shared route builder rather than
   * a hand-built URL: those two are what the round-trip test drives, so a
   * locally-assembled link would be a second, untested spelling of the same
   * hand-off.
   */
  test("navigates through the shared selection and route builder", () => {
    expect(TEMPLATE_VIEW_PAGE).toMatch(
      /Navigation\.navigate\( ?getMonitorListRouteForFacet\( ?getMonitorTemplateFacetSelection\(modelId\.toString\(\)/,
    );
  });

  test("takes both of those from the monitor components, not a local copy", () => {
    expect(TEMPLATE_VIEW_PAGE).toContain(
      'from "../../../Components/Monitor/MonitorFacets"',
    );
    expect(TEMPLATE_VIEW_PAGE).toContain(
      'from "../../../Components/Monitor/MonitorListFacetRoute"',
    );
  });
});

describe("both ends of the link name the same table", () => {
  /*
   * The link writes the chip into the arriving table's own facet URL namespace,
   * which is derived from its `tableId`. Spelled differently at the two ends,
   * the navigation still happens and the list still renders — just with no chip
   * set and every monitor in the project on it.
   */
  test("the monitors page registers the shared id", () => {
    expect(MONITORS_PAGE).toContain("tableId: ALL_MONITORS_TABLE_ID,");
    expect(MONITORS_PAGE).toContain(
      'from "../../Components/Monitor/MonitorFacets"',
    );
  });

  test("and the route builder addresses that same id", () => {
    expect(FACET_ROUTE).toContain("ALL_MONITORS_TABLE_ID,");
    expect(FACET_ROUTE).toContain('from "./MonitorFacets"');
  });

  /*
   * Also sitting in bookmarks and in links pasted into tickets, so a rename has
   * to be a conscious edit of this line.
   */
  test("and that id is the one already in shared links", () => {
    expect(ALL_MONITORS_TABLE_ID).toBe("all-monitors-table");
  });
});

describe("the facet vocabulary stays loadable from this suite", () => {
  /*
   * App's own `tsc` excludes FeatureSet/Dashboard, but an excluded file is
   * still type-checked when something in the program imports it — and App has
   * no React dependency, so a vocabulary module that reached a .tsx would break
   * App's compile with "Cannot find module 'react'". RouteMap is the other
   * hazard: it pulls in the app config, which reads `window` at import time, so
   * importing it here would need a browser stub before the module loaded.
   */
  test("MonitorFacets imports no React, no RouteMap and no API client", () => {
    expect(FACET_VOCABULARY).not.toContain('from "react"');
    expect(FACET_VOCABULARY).not.toContain("RouteMap");
    expect(FACET_VOCABULARY).not.toContain("ModelAPI");
  });

  test("the route builder is where RouteMap lives instead", () => {
    expect(FACET_ROUTE).toContain('from "../../Utils/RouteMap"');
  });
});
