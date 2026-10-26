import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  getReportedResourceOverviewDetailRows,
  hasResourceOverviewDetailValue,
} from "../../FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceOverviewDetails";

/*
 * A resource's Overview does not repeat its side menu, and its Details card
 * says only what the resource reported.
 *
 * Every resource Overview built on ResourceOverview - a database, a queue, a
 * serverless function, a cloud environment, a cloud resource, a service and a
 * RUM application - drew an "Explore telemetry" card of links under its
 * Details: Traces, Logs, Metrics, Exceptions, Profiles, Session Replay,
 * Instances, Endpoints, Owners, Documentation. Every one was a page of the
 * side menu beside it, so the card made a long Overview longer and said
 * nothing new. #4979 took it off the five infrastructure Overviews; its
 * follow-up of #4980 took it off the Service and RUM Overviews and out of the
 * shared component, so no Overview can draw it again. This holds that every
 * page the card linked to is in that resource's side menu, so nothing became
 * harder to find, and that a database's "Runs on" - the one link the card had
 * that the menu does not - is still a link on the Overview.
 *
 * The Details card listed every fact a page knows how to show, "—" for each
 * the resource never reported: a new service's card was ten rows of which
 * two said something, beside a second "Service Details" card (#4980). A row
 * is drawn only when it has a value now, and the Service Overview has one
 * Details card.
 *
 * #5298's UI review: every one of these Details cards ends with the record's
 * ID line (no "Service ID" row of 36 characters first) and links to the
 * resource's Settings page, where its name, description and labels are
 * edited - a database's and a queue's had no link.
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
  // Its Settings page, where its name, description and labels are edited.
  settingsPage: string;
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
    settingsPage: "DATABASE_SERVER_VIEW_SETTINGS",
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
    settingsPage: "MESSAGE_QUEUE_VIEW_SETTINGS",
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
    settingsPage: "SERVERLESS_FUNCTION_VIEW_SETTINGS",
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
    settingsPage: "CLOUD_RESOURCE_VIEW_SETTINGS",
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
    settingsPage: "CLOUD_RESOURCE_VIEW_SETTINGS",
  },
  {
    name: "Service",
    overview: "Pages/Service/View/Index.tsx",
    sideMenu: "Pages/Service/View/SideMenu.tsx",
    formerLinks: [
      "SERVICE_VIEW_TRACES",
      "SERVICE_VIEW_LOGS",
      "SERVICE_VIEW_METRICS",
      "SERVICE_VIEW_EXCEPTIONS",
      "SERVICE_VIEW_PROFILES",
    ],
    settingsPage: "SERVICE_VIEW_SETTINGS",
  },
  {
    name: "RUM application",
    overview: "Pages/Rum/View/Overview.tsx",
    sideMenu: "Pages/Rum/View/SideMenu.tsx",
    formerLinks: [
      "RUM_APPLICATION_VIEW_SESSION_REPLAY",
      "RUM_APPLICATION_VIEW_TRACES",
      "RUM_APPLICATION_VIEW_LOGS",
      "RUM_APPLICATION_VIEW_METRICS",
    ],
    settingsPage: "RUM_APPLICATION_VIEW_SETTINGS",
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

  test("ends its Details card with the record's ID line, and spells the ID out in no row", () => {
    expect(overview).toContain("recordId={modelId.toString()}");
    expect(overview).not.toContain("value: modelId.toString()");
  });

  test("links its Details card to its Settings page, which the side menu lists too", () => {
    expect(overview).toContain(
      `settingsRoute={populate(PageMap.${overviewCase.settingsPage})}`,
    );
    expect(sideMenu).toContain(
      `RouteMap[PageMap.${overviewCase.settingsPage}]`,
    );
  });
});

/*
 * Every page that draws ResourceOverview is one of the cases above, so a new
 * Overview is held to the same rules the day it is added. (Not the detail
 * pages' ResourceOverviewTab, a different component.)
 */
const DRAWS_RESOURCE_OVERVIEW: RegExp = /<ResourceOverview[\s>]/;

test("every Overview drawn with ResourceOverview is held to these rules", () => {
  const drawers: Array<string> = [];
  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".tsx")) {
        if (DRAWS_RESOURCE_OVERVIEW.test(fs.readFileSync(full, "utf8"))) {
          drawers.push(
            path.relative(DASHBOARD_SRC, full).split(path.sep).join("/"),
          );
        }
      }
    }
  };
  walk(path.join(DASHBOARD_SRC, "Pages"));

  expect(drawers.sort()).toEqual(
    OVERVIEWS.map((overviewCase: OverviewCase): string => {
      return overviewCase.overview;
    }).sort(),
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

test("the shared component has no Explore telemetry card to draw", () => {
  const component: string = code(
    "Components/TelemetryResource/ResourceOverview.tsx",
  );

  expect(component).not.toContain("quickLinks");
  expect(component).not.toContain("ResourceOverviewQuickLink");
  expect(component).not.toContain("Explore telemetry");
  expect(component).not.toContain(
    "Drill into the raw signals for this resource.",
  );
});

/*
 * The Details rows ran edge to edge with -m-6 and started their words at
 * px-4, while the card is padded px-5 md:px-6: every label sat 8px left of
 * the card's title on a desktop, and the rows reached 4px past the card on a
 * phone. They are the card's ruled list now (CardSurface, as every ruled
 * list of a card is), with each row padded as the card is.
 */
test("the Details rows line up with the card's title at every width", () => {
  const commonCard: string = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "Common",
    "UI",
    "Components",
    "Card",
  );
  const card: string = fs.readFileSync(
    path.join(commonCard, "Card.tsx"),
    "utf8",
  );
  const surface: string = fs.readFileSync(
    path.join(commonCard, "CardSurface.ts"),
    "utf8",
  );
  const component: string = code(
    "Components/TelemetryResource/ResourceOverview.tsx",
  );

  // The card's padding, and the ruled list that reaches out by exactly it.
  expect(card).toContain(
    'export const CARD_PADDING_CLASS_NAME: string = "py-6 px-5 md:px-6";',
  );
  expect(surface).toContain(
    '"-mx-5 -mb-6 divide-y divide-gray-200 border-t border-gray-200 md:-mx-6"',
  );

  expect(component).toContain(
    'import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";',
  );
  expect(component).toContain(
    "const ruledListClassName: string = useCardRuledListClassName();",
  );
  /*
   * The Details body - its rows, a description list, and the ID line under
   * them - is the one ruled list; the rows rule each other in its grey.
   */
  expect(component.split("className={ruledListClassName}").length).toBe(2);
  expect(component).toContain(
    '<div data-testid="resource-overview-details-body" className={ruledListClassName} >',
  );
  expect(component).toContain(
    '<dl data-testid="resource-overview-details" className="divide-y divide-gray-200" >',
  );
  // And each row's words, and the ID line's, back in by the card's padding.
  expect(component).toContain(
    'className="px-5 py-3 sm:grid sm:grid-cols-3 sm:gap-4 md:px-6"',
  );
  expect(component).toContain(
    '<div className="px-5 py-3 md:px-6"> <DetailRecordLine recordId={props.recordId} /> </div>',
  );
  expect(component).not.toContain("-m-6");
  expect(component).not.toMatch(/"px-4 py-3/);
});

describe("the Details card draws only the rows a resource reported", () => {
  test("the component draws the reported rows, never a dash for a missing one", () => {
    const component: string = code(
      "Components/TelemetryResource/ResourceOverview.tsx",
    );

    expect(component).toContain(
      "getReportedResourceOverviewDetailRows(props.detailRows)",
    );
    expect(component).toContain("{reportedDetailRows.map(");
    expect(component).not.toContain("{props.detailRows.map(");
    expect(component).not.toContain(': "—"}');
    // With nothing reported, one line says so.
    expect(component).toContain(
      'translator.translateText("No details reported yet.")',
    );
  });

  test("a row with a value is drawn, an empty or blank one is not", () => {
    const rows: Array<{ label: string; value: string | undefined }> = [
      { label: "Service ID", value: "6d1c..." },
      { label: "Cloud Provider", value: undefined },
      { label: "Cloud Region", value: "" },
      { label: "Cloud Account ID", value: "   " },
      { label: "Runtime", value: "node 22.4.0" },
    ];

    expect(
      getReportedResourceOverviewDetailRows(rows).map(
        (row: { label: string }): string => {
          return row.label;
        },
      ),
    ).toEqual(["Service ID", "Runtime"]);
  });

  test("the rows keep the page's order and every field of the row", () => {
    const element: { kind: string } = { kind: "element" };
    const rows: Array<{
      label: string;
      value: string | undefined;
      mono?: boolean;
      element?: { kind: string };
    }> = [
      { label: "Agent version", value: "14.0.80", element: element },
      { label: "Version", value: undefined },
      { label: "Engine", value: "postgresql", mono: false },
    ];

    expect(getReportedResourceOverviewDetailRows(rows)).toEqual([
      { label: "Agent version", value: "14.0.80", element: element },
      { label: "Engine", value: "postgresql", mono: false },
    ]);
  });

  test("nothing reported is no rows", () => {
    expect(
      getReportedResourceOverviewDetailRows([
        { label: "Cloud Provider", value: undefined },
        { label: "Cloud Region", value: null },
      ]),
    ).toEqual([]);
    expect(getReportedResourceOverviewDetailRows([])).toEqual([]);
  });

  test("a value is a non-blank string", () => {
    expect(hasResourceOverviewDetailValue("x")).toBe(true);
    expect(hasResourceOverviewDetailValue("0")).toBe(true);
    expect(hasResourceOverviewDetailValue("")).toBe(false);
    expect(hasResourceOverviewDetailValue(" \t ")).toBe(false);
    expect(hasResourceOverviewDetailValue(undefined)).toBe(false);
    expect(hasResourceOverviewDetailValue(null)).toBe(false);
  });
});

describe("the Service Overview has one Details card", () => {
  const overview: string = code("Pages/Service/View/Index.tsx");

  test("no second Service Details card beside Details", () => {
    expect(overview).not.toContain("CardModelDetail");
    expect(overview).not.toContain('title: "Service Details"');
    expect(overview).not.toContain("model-detail-service");
  });

  test("its technology is a Details row in words, its ID the ID line, its labels the Labels card, its settings one link", () => {
    expect(overview).not.toContain('label: "Service ID"');
    expect(overview).toContain("recordId={modelId.toString()}");
    expect(overview).toContain('label: "Technology",');
    // One line, as the card's other values: "Java, Kotlin".
    expect(overview).toContain(
      'value: techStack.length > 0 ? techStack.join(", ") : languageDisplay, mono: false,',
    );
    expect(overview).not.toContain("TechStackView");
    expect(overview).toContain("labels={r.labels}");
    expect(overview).toContain(
      "settingsRoute={populate(PageMap.SERVICE_VIEW_SETTINGS)}",
    );
    // The labels are read with the service, for the Labels card.
    expect(overview).toContain("labels: { name: true, color: true, },");
  });

  test("the language is one Technology row, not a second SDK Language row", () => {
    expect(overview).not.toContain("SDK Language (telemetry.sdk.language)");
    expect(overview.split('label: "Technology"').length).toBe(2);
  });
});
