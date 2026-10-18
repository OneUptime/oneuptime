import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * An infrastructure resource's Overview does not repeat its side menu.
 *
 * Five Overviews - a database, a queue, a serverless function, a cloud
 * environment and a cloud resource - drew an "Explore telemetry" card of
 * links under their Details: Traces, Logs, Metrics, Instances, Endpoints,
 * Owners, Documentation. Every one was a page of the side menu beside it,
 * so the card made a long Overview longer and said nothing new. They pass
 * no quick links now; this holds that every page the card linked to is in
 * that resource's side menu, so nothing became harder to find, and that a
 * database's "Runs on" - the one link the card had that the menu does not -
 * is still a link on the Overview.
 *
 * (The Service and RUM Overviews of the telemetry products still draw the
 * card; they are not infrastructure pages.)
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

// Comments out, whitespace squashed: the code as prettier may wrap it.
function code(relative: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relative), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
}

interface OverviewCase {
  name: string;
  overview: string;
  sideMenu: string;
  // The pages the Explore telemetry card linked to.
  formerLinks: Array<string>;
}

const OVERVIEWS: Array<OverviewCase> = [
  {
    name: "Database",
    overview: "Pages/Database/View/Overview.tsx",
    sideMenu: "Pages/Database/View/SideMenu.tsx",
    formerLinks: [
      "DATABASE_SERVER_VIEW_TRACES",
      "DATABASE_SERVER_VIEW_LOGS",
      "DATABASE_SERVER_VIEW_METRICS",
      "DATABASE_SERVER_VIEW_ENDPOINTS",
      "DATABASE_SERVER_VIEW_OWNERS",
    ],
  },
  {
    name: "Queue",
    overview: "Pages/MessageQueue/View/Overview.tsx",
    sideMenu: "Pages/MessageQueue/View/SideMenu.tsx",
    formerLinks: [
      "MESSAGE_QUEUE_VIEW_TRACES",
      "MESSAGE_QUEUE_VIEW_METRICS",
      "MESSAGE_QUEUE_VIEW_OWNERS",
      "MESSAGE_QUEUE_VIEW_DOCUMENTATION",
    ],
  },
  {
    name: "Serverless function",
    overview: "Pages/Serverless/View/Overview.tsx",
    sideMenu: "Pages/Serverless/View/SideMenu.tsx",
    formerLinks: [
      "SERVERLESS_FUNCTION_VIEW_TRACES",
      "SERVERLESS_FUNCTION_VIEW_LOGS",
      "SERVERLESS_FUNCTION_VIEW_METRICS",
    ],
  },
  {
    name: "Cloud environment",
    overview: "Pages/Cloud/View/Overview.tsx",
    sideMenu: "Pages/Cloud/View/SideMenu.tsx",
    formerLinks: [
      "CLOUD_RESOURCE_VIEW_TRACES",
      "CLOUD_RESOURCE_VIEW_LOGS",
      "CLOUD_RESOURCE_VIEW_METRICS",
      "CLOUD_RESOURCE_VIEW_INSTANCES",
      "CLOUD_RESOURCE_VIEW_OWNERS",
    ],
  },
  {
    name: "Cloud resource",
    overview: "Pages/Cloud/View/MonitoredResourceOverview.tsx",
    sideMenu: "Pages/Cloud/View/SideMenu.tsx",
    formerLinks: [
      "CLOUD_RESOURCE_VIEW_METRICS",
      "CLOUD_RESOURCE_VIEW_OWNERS",
      "CLOUD_RESOURCE_VIEW_DOCUMENTATION",
    ],
  },
];

describe.each(OVERVIEWS)("$name Overview", (overviewCase: OverviewCase) => {
  const overview: string = code(overviewCase.overview);
  const sideMenu: string = code(overviewCase.sideMenu);

  test("draws no Explore telemetry card", () => {
    expect(overview).toContain("<ResourceOverview ");
    expect(overview).not.toContain("quickLinks");
    expect(overview).not.toContain("ResourceOverviewQuickLink");
  });

  test.each(overviewCase.formerLinks)(
    "%s, which the card linked to, is in the side menu",
    (page: string) => {
      expect(sideMenu).toContain(`RouteMap[PageMap.${page}]`);
    },
  );
});

test("a database's Runs on is still a link on its Overview, to the cluster or host", () => {
  const overview: string = code("Pages/Database/View/Overview.tsx");

  expect(overview).toContain(
    'import { DatabaseRunsOnLink } from "../../../Components/DatabaseServer/DatabaseRunsOnLink";',
  );
  expect(overview).toContain(
    '{ label: "Runs on", value: platform ? runsOn : undefined, element: ( <DatabaseRunsOnLink source={r} className="text-sm text-indigo-600" /> ), },',
  );
});

test("the shared component draws the card only for a page that passes links", () => {
  const component: string = code(
    "Components/TelemetryResource/ResourceOverview.tsx",
  );

  expect(component).toContain(
    "{props.quickLinks && props.quickLinks.length > 0 ? (",
  );
});

/*
 * The Details rows ran edge to edge with -m-6 and started their words at
 * px-4, while the card is padded px-5 md:px-6: every label sat 8px left of
 * the card's title on a desktop, and the rows reached 4px past the card on a
 * phone. They follow the card's padding now, at every width.
 */
test("the Details rows line up with the card's title at every width", () => {
  const card: string = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "Common",
      "UI",
      "Components",
      "Card",
      "Card.tsx",
    ),
    "utf8",
  );
  const component: string = code(
    "Components/TelemetryResource/ResourceOverview.tsx",
  );

  // What the rows are lined up with.
  expect(card).toContain(
    'export const CARD_PADDING_CLASS_NAME: string = "py-6 px-5 md:px-6";',
  );

  // Edge to edge: out by exactly the card's padding.
  expect(component).toContain(
    '<div className="-mx-5 -mb-6 -mt-2 divide-y divide-gray-100 border-t border-gray-200 md:-mx-6">',
  );
  // And the words back in by it.
  expect(component).toContain(
    'className="px-5 py-3 sm:grid sm:grid-cols-3 sm:gap-4 md:px-6"',
  );
  expect(component).toContain(
    'className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 md:px-6"',
  );
  expect(component).not.toContain("-m-6");
  expect(component).not.toMatch(/"px-4 py-3/);
});
