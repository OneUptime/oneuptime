/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import React, { act } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Route from "../../../Types/API/Route";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import StatusPageGroupViewMode from "../../../Types/StatusPage/StatusPageGroupViewMode";
import Navigation from "../../../UI/Utils/Navigation";
import {
  getPublicResourceGridClassNames,
  getPublicResourceGridMatrixVariant,
  getPublicResourceGridStackVariant,
  PUBLIC_RESOURCE_GRID_COLUMN_AXIS_CLASS_NAME,
  PUBLIC_RESOURCE_GRID_CORNER_CLASS_NAME,
  PUBLIC_RESOURCE_GRID_ROW_AXIS_CLASS_NAME,
  PublicResourceGridClassNames,
} from "../../../UI/Components/StatusPage/PublicResourceGridLayout";
import { RESOURCE_GRID_CLASS_NAME } from "../../../UI/Components/StatusPage/ResourceGridLayout";
import Overview from "../../../../App/FeatureSet/StatusPage/src/Pages/Overview/Overview";
import StatusPageUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage";

/*
 * THE PUBLIC STATUS PAGE'S RESOURCE GRID, THROUGH THE REAL OVERVIEW PAGE
 * (#7238).
 *
 * A status page group in grid view is drawn for visitors as a matrix of
 * its row axis's values by its column axis's values. It scrolled sideways
 * on phones (a three-column grid is 580px in a 332px card). It is now drawn
 * as the Dashboard's editor of the same grid is: a matrix where its columns
 * fit the grid's box, a stack where they would scroll - each row a section
 * headed by its value, each cell a line naming its column, with its status
 * at the line's end (PublicResourceGridLayout). The rows' values are held
 * at the start of the line, whichever side that is.
 *
 * These read the page's markup: which classes each part of the table
 * carries, that each cell names its column, and that the page owner's
 * values are read the way they are written. The layout is laid out and
 * measured in Chromium (packages/E2E/StatusPageTheme/
 * StatusPageResourceGrid.spec.ts).
 */

const NOW: Date = new Date("2026-11-12T10:00:00.000Z");

const STATUS_PAGE_ID: string = "42000000-0000-4000-8000-000000000001";

const OPERATIONAL_STATUS_ID: string = "12000000-0000-4000-8000-000000000001";
const DEGRADED_STATUS_ID: string = "12000000-0000-4000-8000-000000000002";
const OFFLINE_STATUS_ID: string = "12000000-0000-4000-8000-000000000003";

// Status page groups.
const REGIONS_ID: string = "62000000-0000-4000-8000-000000000001";
const GULF_ID: string = "62000000-0000-4000-8000-000000000002";
const UNSET_ID: string = "62000000-0000-4000-8000-000000000003";

const ROWS: Array<string> = ["API", "Dashboard"];
const COLUMNS: Array<string> = ["US", "EU", "Asia Pacific"];

interface StatusDefinition {
  name: string;
  color: string;
  priority: number;
  isOperationalState: boolean;
}

const STATUSES: Record<string, StatusDefinition> = {
  [OPERATIONAL_STATUS_ID]: {
    name: "Operational",
    color: "#2ab57d",
    priority: 1,
    isOperationalState: true,
  },
  [DEGRADED_STATUS_ID]: {
    name: "Degraded",
    color: "#ffbf53",
    priority: 2,
    isOperationalState: false,
  },
  [OFFLINE_STATUS_ID]: {
    name: "Offline",
    color: "#fd625e",
    priority: 3,
    isOperationalState: false,
  },
};

let mockRespondToPost: () => HTTPResponse<JSONObject> =
  (): HTTPResponse<JSONObject> => {
    throw new Error("mockRespondToPost was not set by the test");
  };

jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isLoggedIn: () => {
        return true;
      },
      logout: () => {
        return Promise.resolve();
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: () => {
        return Promise.resolve(mockRespondToPost());
      },
      getDefaultHeaders: () => {
        return {};
      },
      getFriendlyMessage: (error: { message?: string }) => {
        return error?.message || "Something went wrong";
      },
    },
  };
});

// The real page chrome renders breadcrumbs, which need a router.
jest.mock(
  "../../../../App/FeatureSet/StatusPage/src/Components/Page/Page",
  () => {
    return {
      __esModule: true,
      default: (props: { children: React.ReactNode }) => {
        return <div>{props.children}</div>;
      },
    };
  },
);

/*
 * The page's language: English, unless a test reads it in Arabic, a
 * language read right to left (mockReaderLanguage).
 */
let mockReaderLanguage: "en" | "ar" = "en";

// The status page's own words, as a visitor reads them.
jest.mock("react-i18next", () => {
  const locales: Record<string, Record<string, unknown>> = {
    en: jest.requireActual(
      "../../../../App/FeatureSet/StatusPage/src/Locales/en.json",
    ) as Record<string, unknown>,
    ar: jest.requireActual(
      "../../../../App/FeatureSet/StatusPage/src/Locales/ar.json",
    ) as Record<string, unknown>,
  };

  const lookUp: (key: string, isFlatKey: boolean) => string | undefined = (
    key: string,
    isFlatKey: boolean,
  ): string | undefined => {
    const path: Array<string> = isFlatKey ? [key] : key.split(".");
    let node: unknown = locales[mockReaderLanguage];

    for (const part of path) {
      if (!node || typeof node !== "object") {
        return undefined;
      }

      node = (node as Record<string, unknown>)[part];
    }

    return typeof node === "string" ? node : undefined;
  };

  const t: (
    key: string,
    opts?: { defaultValue?: string } & Record<string, unknown>,
  ) => string = (
    key: string,
    opts?: { defaultValue?: string } & Record<string, unknown>,
  ): string => {
    let out: string =
      lookUp(key, opts?.["keySeparator"] === false) ??
      opts?.defaultValue ??
      key;

    for (const name of Object.keys(opts || {})) {
      const raw: unknown = (opts as Record<string, unknown>)[name];

      if (
        name === "defaultValue" ||
        (typeof raw !== "string" && typeof raw !== "number")
      ) {
        continue;
      }

      out = out.split(`{{${name}}}`).join(String(raw));
    }

    return out;
  };

  return {
    initReactI18next: {
      type: "3rdParty",
      init: () => {},
    },
    useTranslation: () => {
      return {
        t: t,
        i18n: {
          resolvedLanguage: mockReaderLanguage,
          language: mockReaderLanguage,
        },
      };
    },
  };
});

/*
 * ---------------------------------------------------------------------------
 * The payload.
 * ---------------------------------------------------------------------------
 */

function objectId(value: string): { _type: string; value: string } {
  return { _type: "ObjectID", value: value };
}

function color(value: string): { _type: string; value: string } {
  return { _type: "Color", value: value };
}

function statusJson(statusId: string): JSONObject {
  const status: StatusDefinition = STATUSES[statusId]!;

  return {
    _id: statusId,
    name: status.name,
    color: color(status.color),
    priority: status.priority,
    isOperationalState: status.isOperationalState,
  };
}

let resourceCount: number = 0;

function resourceJson(data: {
  name: string;
  statusId: string;
  statusPageGroupId: string;
  row: string;
  column: string;
}): JSONObject {
  resourceCount++;
  const suffix: string = String(resourceCount).padStart(12, "0");

  return {
    _id: `32000000-0000-4000-8000-${suffix}`,
    displayName: data.name,
    showCurrentStatus: true,
    showUptimePercent: true,
    showStatusHistoryChart: false,
    order: resourceCount,
    monitorId: objectId(`22000000-0000-4000-8000-${suffix}`),
    monitor: {
      _id: `22000000-0000-4000-8000-${suffix}`,
      currentMonitorStatusId: objectId(data.statusId),
    },
    statusPageGroupId: objectId(data.statusPageGroupId),
    rowAxisValue: data.row,
    columnAxisValue: data.column,
  };
}

function gridGroupJson(data: {
  id: string;
  name: string;
  order: number;
  rows: Array<string>;
  columns: Array<string>;
  rowAxisLabel?: string | undefined;
  columnAxisLabel?: string | undefined;
}): JSONObject {
  const json: JSONObject = {
    _id: data.id,
    name: data.name,
    order: data.order,
    isExpandedByDefault: true,
    showCurrentStatus: true,
    showUptimePercent: true,
    viewMode: StatusPageGroupViewMode.Grid,
    rowAxisValues: data.rows.join(", "),
    columnAxisValues: data.columns.join(", "),
  };

  if (data.rowAxisLabel) {
    json["rowAxisLabel"] = data.rowAxisLabel;
  }

  if (data.columnAxisLabel) {
    json["columnAxisLabel"] = data.columnAxisLabel;
  }

  return json;
}

/*
 * Regions (Service by Region): API in every region - Operational, Degraded,
 * Operational - and the Dashboard in the US (Operational) and Asia Pacific
 * (Offline), with nothing in the EU.
 */
function regionsResources(): Array<JSONObject> {
  return [
    resourceJson({
      name: "API in US",
      statusId: OPERATIONAL_STATUS_ID,
      statusPageGroupId: REGIONS_ID,
      row: "API",
      column: "US",
    }),
    resourceJson({
      name: "API in EU",
      statusId: DEGRADED_STATUS_ID,
      statusPageGroupId: REGIONS_ID,
      row: "API",
      column: "EU",
    }),
    resourceJson({
      name: "API in Asia Pacific",
      statusId: OPERATIONAL_STATUS_ID,
      statusPageGroupId: REGIONS_ID,
      row: "API",
      column: "Asia Pacific",
    }),
    resourceJson({
      name: "Dashboard in US",
      statusId: OPERATIONAL_STATUS_ID,
      statusPageGroupId: REGIONS_ID,
      row: "Dashboard",
      column: "US",
    }),
    resourceJson({
      name: "Dashboard in Asia Pacific",
      statusId: OFFLINE_STATUS_ID,
      statusPageGroupId: REGIONS_ID,
      row: "Dashboard",
      column: "Asia Pacific",
    }),
  ];
}

// A one-column grid whose values are written in Arabic, with no axis names.
const GULF_ROWS: Array<string> = ["الرياض", "دبي"];
const GULF_COLUMNS: Array<string> = ["البوابة"];

function gulfResources(): Array<JSONObject> {
  return [
    resourceJson({
      name: "Riyadh gateway",
      statusId: OPERATIONAL_STATUS_ID,
      statusPageGroupId: GULF_ID,
      row: "الرياض",
      column: "البوابة",
    }),
  ];
}

function overviewPayload(data: {
  groups: Array<JSONObject>;
  resources: Array<JSONObject>;
}): JSONObject {
  return {
    statusPage: {
      _id: STATUS_PAGE_ID,
      defaultBarColor: color("#5F5F5F"),
      downtimeMonitorStatuses: [{ _id: OFFLINE_STATUS_ID }],
      showOverallUptimePercentOnStatusPage: false,
      showUptimeHistoryInDays: 30,
    },
    resourceGroups: data.groups,
    statusPageResources: data.resources,
    monitorStatuses: [
      statusJson(OPERATIONAL_STATUS_ID),
      statusJson(DEGRADED_STATUS_ID),
      statusJson(OFFLINE_STATUS_ID),
    ],
    monitorStatusTimelines: [],
    uptimeDailyAggregate: {
      monitors: [],
      isComplete: true,
      completeFrom: null,
      timezone: "UTC",
    },
    statusPageHistoryChartBarColorRules: [],
    incidentStateTimelines: [],
    scheduledMaintenanceStateTimelines: [],
    scheduledMaintenanceEvents: [],
    scheduledMaintenanceEventsPublicNotes: [],
    activeAnnouncements: [],
    activeIncidents: [],
    activeEpisodes: [],
    incidentPublicNotes: [],
    episodePublicNotes: [],
    episodeStateTimelines: [],
    timelineIncidents: [],
    monitorsInGroup: {},
    monitorGroupCurrentStatuses: {},
    overallStatus: statusJson(OFFLINE_STATUS_ID),
  };
}

function serve(payload: JSONObject): void {
  mockRespondToPost = (): HTTPResponse<JSONObject> => {
    return new HTTPResponse<JSONObject>(200, payload, {});
  };
}

const REGIONS_GROUP: JSONObject = gridGroupJson({
  id: REGIONS_ID,
  name: "Regions",
  order: 1,
  rows: ROWS,
  columns: COLUMNS,
  rowAxisLabel: "Service",
  columnAxisLabel: "Region",
});

const GULF_GROUP: JSONObject = gridGroupJson({
  id: GULF_ID,
  name: "Gulf",
  order: 2,
  rows: GULF_ROWS,
  columns: GULF_COLUMNS,
});

function serveRegionsAndGulf(): void {
  serve(
    overviewPayload({
      groups: [REGIONS_GROUP, GULF_GROUP],
      resources: [...regionsResources(), ...gulfResources()],
    }),
  );
}

async function renderOverview(): Promise<void> {
  await act(async () => {
    render(<Overview pageRoute={new Route("/")} onLoadComplete={() => {}} />);
  });
}

/*
 * ---------------------------------------------------------------------------
 * Reading the page.
 * ---------------------------------------------------------------------------
 */

// A status page group's section, by the group's name.
function sectionOf(groupName: string): HTMLElement {
  const section: HTMLElement | undefined = screen
    .getAllByTestId("status-page-group-header")
    .map((header: HTMLElement): HTMLElement => {
      return header.parentElement as HTMLElement;
    })
    .find((candidate: HTMLElement): boolean => {
      return (
        within(
          candidate.querySelector(
            "[data-testid='status-page-group-header']",
          ) as HTMLElement,
        ).queryByText(groupName) !== null
      );
    });

  if (!section) {
    throw new Error(`No status page group is named ${groupName}.`);
  }

  return section;
}

// The grid of a status page group, by the group's name.
function gridOf(groupName: string): HTMLElement {
  return within(sectionOf(groupName)).getByTestId("status-page-grid");
}

// An element's children with this tag.
function childrenTagged(parent: Element, tagName: string): Array<HTMLElement> {
  return Array.from(parent.children).filter((child: Element): boolean => {
    return child.tagName === tagName;
  }) as Array<HTMLElement>;
}

function tokensOf(className: string): Array<string> {
  return className.split(" ").filter(Boolean);
}

// Every element of a grid, the grid's box included.
function elementsOf(grid: HTMLElement): Array<HTMLElement> {
  return [
    grid,
    ...(Array.from(grid.querySelectorAll("*")) as Array<HTMLElement>),
  ];
}

// The text of an element, as the browser would read it (no isolate marks here).
function textOf(element: Element): string {
  return (element.textContent || "").trim();
}

interface GridParts {
  table: HTMLElement;
  head: HTMLElement;
  body: HTMLElement;
  rows: Array<HTMLElement>;
}

function partsOf(grid: HTMLElement): GridParts {
  const table: HTMLElement = within(grid).getByRole("table");
  const head: HTMLElement = table.querySelector("thead") as HTMLElement;
  const body: HTMLElement = table.querySelector("tbody") as HTMLElement;

  return {
    table: table,
    head: head,
    body: body,
    rows: childrenTagged(body, "TR"),
  };
}

describe("the public status page's resource grid: a matrix where it fits, a stack where it would scroll (#7238)", () => {
  const navigate: typeof Navigation.navigate = Navigation.navigate;

  beforeEach(() => {
    localStorage.clear();
    StatusPageUtil.setStatusPageId(new ObjectID(STATUS_PAGE_ID));
    window.history.replaceState({}, "", "/");
    Navigation.navigate = (): void => {};
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    serveRegionsAndGulf();
  });

  afterEach(() => {
    jest.useRealTimers();
    Navigation.navigate = navigate;
  });

  test("the grid's own box is the container its query measures, inside the card it was always drawn in", async () => {
    await renderOverview();

    const grid: HTMLElement = gridOf("Regions");

    expect(tokensOf(grid.className)).toEqual(
      expect.arrayContaining([
        RESOURCE_GRID_CLASS_NAME,
        "rounded-xl",
        "border",
        "border-gray-200",
        "bg-white",
        "overflow-hidden",
      ]),
    );
    // The matrix still scrolls inside it where its words are wider than its least width.
    expect(partsOf(grid).table.parentElement).toHaveClass("overflow-x-auto");
    expect(partsOf(grid).table.parentElement!.parentElement).toBe(grid);
  });

  test("a three-column grid: its table, head, body, rows, rows' values and cells carry the three-column grid's classes", async () => {
    await renderOverview();

    const layout: PublicResourceGridClassNames =
      getPublicResourceGridClassNames(COLUMNS.length);
    const parts: GridParts = partsOf(gridOf("Regions"));

    expect(parts.table.className).toBe(layout.table);
    expect(parts.head.className).toBe(layout.head);
    expect(parts.body.className).toBe(layout.body);
    expect(parts.rows).toHaveLength(ROWS.length);

    parts.rows.forEach((row: HTMLElement, rowIndex: number) => {
      const isLastRow: boolean = rowIndex === ROWS.length - 1;
      const heading: HTMLElement = row.firstElementChild as HTMLElement;
      const cells: Array<HTMLElement> = childrenTagged(row, "TD");

      expect(row.className).toBe(layout.row);
      expect(heading.tagName).toBe("TH");
      expect(heading).toHaveAttribute("scope", "row");
      expect(heading.className).toBe(
        layout.getRowHeading({ isLastRow: isLastRow }),
      );
      expect(textOf(heading)).toBe(ROWS[rowIndex]);
      expect(cells).toHaveLength(COLUMNS.length);

      cells.forEach((cell: HTMLElement, columnIndex: number) => {
        // Dashboard has nothing in the EU.
        const isEmpty: boolean = rowIndex === 1 && columnIndex === 1;

        expect(
          `${ROWS[rowIndex]} / ${COLUMNS[columnIndex]}: ${cell.className}`,
        ).toBe(
          `${ROWS[rowIndex]} / ${COLUMNS[columnIndex]}: ${layout.getCell({
            isLastRow: isLastRow,
            isLastColumn: columnIndex === COLUMNS.length - 1,
            isEmpty: isEmpty,
          })}`,
        );
      });
    });

    // Its own query: 36.25rem, the 580px a three-column matrix needs.
    expect(tokensOf(parts.table.className)).toContain(
      "[@container(max-width:36.25rem)]:block",
    );
    expect(tokensOf(parts.head.className)).toContain(
      "[@container(max-width:36.25rem)]:hidden",
    );
  });

  test("each cell names its column first, drawn only in the stack, and the matrix's head still names each column", async () => {
    await renderOverview();

    const layout: PublicResourceGridClassNames =
      getPublicResourceGridClassNames(COLUMNS.length);
    const grid: HTMLElement = gridOf("Regions");
    const labels: Array<HTMLElement> = within(grid).getAllByTestId(
      "status-page-grid-cell-label",
    );

    expect(labels).toHaveLength(ROWS.length * COLUMNS.length);

    for (const row of partsOf(grid).rows) {
      childrenTagged(row, "TD").forEach(
        (cell: HTMLElement, columnIndex: number) => {
          const label: HTMLElement = within(cell).getByTestId(
            "status-page-grid-cell-label",
          );

          expect(textOf(label)).toBe(COLUMNS[columnIndex]);
          // First in its cell: at the start of the stack's line.
          expect(cell.firstElementChild).toBe(label);
          expect(label.className).toBe(layout.cellLabel);
          // Hidden in the matrix by the negated query, never a bare hidden.
          expect(tokensOf(label.className)).toContain(
            `${getPublicResourceGridMatrixVariant(COLUMNS.length)}hidden`,
          );
          expect(tokensOf(label.className)).not.toContain("hidden");
        },
      );
    }

    const headRows: Array<HTMLElement> = childrenTagged(
      partsOf(grid).head,
      "TR",
    );

    expect(headRows).toHaveLength(2);
    expect(Array.from(headRows[0]!.children).map(textOf)).toEqual([
      "",
      "Region",
    ]);
    expect(Array.from(headRows[1]!.children).map(textOf)).toEqual([
      "Service",
      ...COLUMNS,
    ]);

    // The column axis's name spans every column.
    expect(headRows[0]!.children[1]).toHaveAttribute(
      "colspan",
      String(COLUMNS.length),
    );
  });

  test("the head's cells: the corner and the row axis's name held at the start, the column headings ruled off from each other", async () => {
    await renderOverview();

    const layout: PublicResourceGridClassNames =
      getPublicResourceGridClassNames(COLUMNS.length);
    const headRows: Array<HTMLElement> = childrenTagged(
      partsOf(gridOf("Regions")).head,
      "TR",
    );
    const [corner, columnAxis]: Array<Element> = Array.from(
      headRows[0]!.children,
    );
    const [rowAxis, ...columns]: Array<Element> = Array.from(
      headRows[1]!.children,
    );

    expect(corner!.className).toBe(PUBLIC_RESOURCE_GRID_CORNER_CLASS_NAME);
    expect(columnAxis!.className).toBe(
      PUBLIC_RESOURCE_GRID_COLUMN_AXIS_CLASS_NAME,
    );
    expect(rowAxis!.className).toBe(PUBLIC_RESOURCE_GRID_ROW_AXIS_CLASS_NAME);

    columns.forEach((column: Element, index: number) => {
      expect(column).toHaveAttribute("scope", "col");
      expect(column.className).toBe(
        layout.getColumnHeading({
          isLastColumn: index === columns.length - 1,
        }),
      );
    });
  });

  test("a cell with resources draws their status and uptime, named by them under the pointer; an empty one a quiet dash, still under its column's name", async () => {
    await renderOverview();

    const layout: PublicResourceGridClassNames =
      getPublicResourceGridClassNames(COLUMNS.length);
    const rows: Array<HTMLElement> = partsOf(gridOf("Regions")).rows;
    const apiInEu: HTMLElement = childrenTagged(rows[0]!, "TD")[1]!;
    const dashboardInEu: HTMLElement = childrenTagged(rows[1]!, "TD")[1]!;
    const dashboardInAsia: HTMLElement = childrenTagged(rows[1]!, "TD")[2]!;

    const status: HTMLElement = within(apiInEu).getByTestId(
      "status-page-grid-cell-status",
    );

    expect(status.className).toBe(layout.cellStatus);
    expect(status).toHaveAttribute("title", "API in EU");
    expect(status).toHaveTextContent("Degraded");
    expect(status).toHaveTextContent("uptime");
    // Its status colour is its own: an inline tint, outside every query.
    expect(apiInEu.getAttribute("style") || "").toContain("background-color");

    expect(
      within(dashboardInAsia).getByTestId("status-page-grid-cell-status"),
    ).toHaveTextContent("Offline");

    expect(
      within(dashboardInEu).queryByTestId("status-page-grid-cell-status"),
    ).not.toBeInTheDocument();
    const empty: HTMLElement = dashboardInEu.lastElementChild as HTMLElement;

    expect(empty).toHaveAttribute("data-testid", "status-page-grid-cell-empty");
    expect(empty.className).toBe(layout.cellEmpty);
    expect(
      textOf(within(dashboardInEu).getByTestId("status-page-grid-cell-label")),
    ).toBe("EU");
    expect(dashboardInEu.getAttribute("style")).toBeNull();
  });

  /*
   * #7431: the dash is read as nothing, so a screen reader heard the
   * column's name in the stack and then the next cell, and a blank cell in
   * the matrix. The cell says what the dash means, to a screen reader only.
   */
  test("an empty cell's dash is for the eye, and a screen reader hears that it has no resources", async () => {
    await renderOverview();

    const rows: Array<HTMLElement> = partsOf(gridOf("Regions")).rows;
    const dashboardInEu: HTMLElement = childrenTagged(rows[1]!, "TD")[1]!;
    const empty: HTMLElement = within(dashboardInEu).getByTestId(
      "status-page-grid-cell-empty",
    );

    // The cell itself is read: only its dash is hidden.
    expect(empty).not.toHaveAttribute("aria-hidden");
    expect(dashboardInEu.closest("[aria-hidden='true']")).toBeNull();

    const [dash, words] = Array.from(empty.children) as Array<HTMLElement>;

    expect(dash).toHaveAttribute("aria-hidden", "true");
    expect(textOf(dash!)).toBe("");
    expect(words!.tagName).toBe("SPAN");
    expect(tokensOf(words!.className)).toEqual(["sr-only"]);
    expect(textOf(words!)).toBe("No resources");

    // In the stack, after the name of its column: "EU, No resources".
    expect(textOf(dashboardInEu)).toBe("EUNo resources");
  });

  test("a cell with resources says nothing of being empty, to anyone", async () => {
    await renderOverview();

    const rows: Array<HTMLElement> = partsOf(gridOf("Regions")).rows;

    rows.forEach((row: HTMLElement, rowIndex: number) => {
      childrenTagged(row, "TD").forEach(
        (cell: HTMLElement, columnIndex: number) => {
          const isDashboardInEu: boolean = rowIndex === 1 && columnIndex === 1;

          expect(
            within(cell).queryAllByTestId("status-page-grid-cell-empty"),
          ).toHaveLength(isDashboardInEu ? 1 : 0);
          expect(textOf(cell).includes("No resources")).toBe(isDashboardInEu);
          expect(cell.querySelectorAll(".sr-only")).toHaveLength(
            isDashboardInEu ? 1 : 0,
          );
        },
      );
    });
  });

  describe("in Arabic, a language read right to left", () => {
    beforeEach(() => {
      mockReaderLanguage = "ar";
    });

    afterEach(() => {
      mockReaderLanguage = "en";
    });

    test("an empty cell says it has no resources in the page's own words", async () => {
      const arabic: Record<string, Record<string, string>> = jest.requireActual(
        "../../../../App/FeatureSet/StatusPage/src/Locales/ar.json",
      ) as Record<string, Record<string, string>>;

      await renderOverview();

      const rows: Array<HTMLElement> = partsOf(gridOf("Regions")).rows;
      const dashboardInEu: HTMLElement = childrenTagged(rows[1]!, "TD")[1]!;
      const words: HTMLElement = within(dashboardInEu)
        .getByTestId("status-page-grid-cell-empty")
        .querySelector(".sr-only") as HTMLElement;

      expect(textOf(words)).toBe("لا توجد موارد");
      expect(textOf(words)).toBe(arabic["overview"]!["gridCellEmpty"]);
      expect(textOf(words)).not.toBe("No resources");
    });

    test("a grid with no row axis name heads its rows in the page's own word, not English's Resource", async () => {
      await renderOverview();

      const head: HTMLElement = partsOf(gridOf("Gulf")).head;

      expect(textOf(head)).toContain("المورد");
      expect(textOf(head)).not.toContain("Resource");
    });
  });

  test("a one-column grid has its own query, and with no axis names the rows' heading says Resource and no column axis row is drawn", async () => {
    await renderOverview();

    const layout: PublicResourceGridClassNames =
      getPublicResourceGridClassNames(1);
    const grid: HTMLElement = gridOf("Gulf");
    const parts: GridParts = partsOf(grid);

    expect(parts.table.className).toBe(layout.table);
    expect(tokensOf(parts.table.className)).toContain(
      "[@container(max-width:18.75rem)]:block",
    );
    expect(getPublicResourceGridStackVariant(1)).toBe(
      "[@container(max-width:18.75rem)]:",
    );

    const headRows: Array<HTMLElement> = childrenTagged(parts.head, "TR");

    expect(headRows).toHaveLength(1);
    expect(Array.from(headRows[0]!.children).map(textOf)).toEqual([
      "Resource",
      ...GULF_COLUMNS,
    ]);
    expect(
      parts.rows.map((row: HTMLElement): string => {
        return textOf(row.firstElementChild as HTMLElement);
      }),
    ).toEqual(GULF_ROWS);

    parts.rows.forEach((row: HTMLElement, index: number) => {
      expect((row.firstElementChild as HTMLElement).className).toBe(
        layout.getRowHeading({ isLastRow: index === parts.rows.length - 1 }),
      );
    });
  });

  test("the page owner's values are read the way they are written: English ones left to right, Arabic ones right to left, on any page", async () => {
    await renderOverview();

    const isolatesIn: (element: Element) => Array<HTMLElement> = (
      element: Element,
    ): Array<HTMLElement> => {
      return Array.from(element.querySelectorAll("bdi")) as Array<HTMLElement>;
    };

    // Regions: the axis names and every value, each one an isolate.
    const regions: HTMLElement = gridOf("Regions");
    const regionValues: Array<string> = isolatesIn(regions).map(textOf);

    expect(regionValues).toEqual(
      expect.arrayContaining(["Region", "Service", ...COLUMNS, ...ROWS]),
    );

    for (const isolate of isolatesIn(regions)) {
      expect(`${textOf(isolate)}: ${isolate.getAttribute("dir")}`).toBe(
        `${textOf(isolate)}: ltr`,
      );
    }

    // Gulf: Arabic values read right to left; the product's Resource does not need to.
    const gulf: HTMLElement = gridOf("Gulf");

    for (const value of [...GULF_ROWS, ...GULF_COLUMNS]) {
      const isolates: Array<HTMLElement> = isolatesIn(gulf).filter(
        (isolate: HTMLElement): boolean => {
          return textOf(isolate) === value;
        },
      );

      expect(isolates.length).toBeGreaterThan(0);

      for (const isolate of isolates) {
        expect(isolate).toHaveAttribute("dir", "rtl");
      }
    }
  });

  test("no element of a grid names a physical side, puts a colour under a container query, or hides itself with a bare hidden", async () => {
    await renderOverview();

    const PHYSICAL_SIDE_PATTERN: RegExp =
      /^(?:[a-z-]+:)*(?:left-|right-|border-l\b|border-r\b|border-l-|border-r-|text-left$|text-right$|pl-|pr-|ml-|mr-)/;
    const CONTAINER_VARIANT_PATTERN: RegExp = /^\[@container[^\]]*\]:/;
    const COLOUR_PATTERN: RegExp =
      /^(?:[a-z-]+:)?(?:bg|text|border|ring|divide|outline|from|via|to)-(?:white|black|transparent|[a-z]+-\d{2,3})(?:\/\d+)?$/;
    const found: Array<string> = [];

    for (const groupName of ["Regions", "Gulf"]) {
      for (const element of elementsOf(gridOf(groupName))) {
        const className: string =
          typeof element.className === "string"
            ? element.className
            : element.getAttribute("class") || "";

        for (const token of tokensOf(className)) {
          const bare: string = token.replace(CONTAINER_VARIANT_PATTERN, "");

          if (PHYSICAL_SIDE_PATTERN.test(bare)) {
            found.push(`${groupName}: a physical side, ${token}`);
          }

          if (bare !== token && COLOUR_PATTERN.test(bare)) {
            found.push(`${groupName}: a colour under a query, ${token}`);
          }

          if (token === "hidden") {
            found.push(`${groupName}: a bare hidden on a ${element.tagName}`);
          }
        }
      }
    }

    expect(found).toEqual([]);
  });

  /*
   * A grid group with no rows or no columns yet has no cells (#9476). It
   * drew, for every visitor, the owner's "no row or column values are
   * configured" as an error: a visitor cannot add the axes, and read it as
   * the status page failing. A visitor reads it as a list group: its
   * resources, or its own empty line. The sentence is the owner's, on the
   * Dashboard's preview, as a quiet note above the list.
   */
  describe("a grid group with no rows or no columns yet (#9476)", () => {
    const AXES_NOT_CONFIGURED: string =
      "This group is set to grid view but no row or column values are configured.";

    const PREVIEW_PATH: string = `/status-page/${STATUS_PAGE_ID}`;

    // Unset: a grid group with these rows and columns, and these resources.
    function serveUnset(data: {
      rows: Array<string>;
      columns: Array<string>;
      resources: Array<JSONObject>;
    }): void {
      serve(
        overviewPayload({
          groups: [
            gridGroupJson({
              id: UNSET_ID,
              name: "Unset",
              order: 1,
              rows: data.rows,
              columns: data.columns,
            }),
          ],
          resources: data.resources,
        }),
      );
    }

    // One resource placed in a cell before the axes went, one never placed.
    function unsetResources(): Array<JSONObject> {
      return [
        resourceJson({
          name: "API in US",
          statusId: OPERATIONAL_STATUS_ID,
          statusPageGroupId: UNSET_ID,
          row: "API",
          column: "US",
        }),
        resourceJson({
          name: "Checkout",
          statusId: DEGRADED_STATUS_ID,
          statusPageGroupId: UNSET_ID,
          row: "",
          column: "",
        }),
      ];
    }

    // The resources a group's section lists, by their lines' words.
    function listedIn(section: HTMLElement): Array<string> {
      return within(section)
        .queryAllByTestId("status-page-resource-header")
        .map(textOf);
    }

    test.each([
      ["rows but no columns", ["API"], []],
      ["columns but no rows", [], ["US"]],
      ["neither", [], []],
      ["rows that are only commas and spaces", [" ", ""], ["US"]],
    ] as Array<[string, Array<string>, Array<string>]>)(
      "with %s, a visitor reads its resources as a list group's, with no grid and no error",
      async (_axes: string, rows: Array<string>, columns: Array<string>) => {
        serveUnset({
          rows: rows,
          columns: columns,
          resources: unsetResources(),
        });
        await renderOverview();

        const section: HTMLElement = sectionOf("Unset");

        expect(listedIn(section)).toEqual([
          expect.stringContaining("API in US"),
          expect.stringContaining("Checkout"),
        ]);
        expect(
          within(section).queryByTestId("status-page-grid"),
        ).not.toBeInTheDocument();
        expect(
          within(section).queryByTestId("status-page-group-empty"),
        ).not.toBeInTheDocument();
        expect(textOf(document.body)).not.toContain(AXES_NOT_CONFIGURED);
        expect(
          screen.queryByTestId("status-page-grid-axes-not-configured"),
        ).not.toBeInTheDocument();
      },
    );

    test("with no resources either, a visitor reads the group's own empty line, and no error", async () => {
      serveUnset({ rows: ["API"], columns: [], resources: [] });
      await renderOverview();

      const section: HTMLElement = sectionOf("Unset");

      expect(
        textOf(within(section).getByTestId("status-page-group-empty")),
      ).toBe("No resources added to this group.");
      expect(
        within(section).queryByTestId("status-page-grid"),
      ).not.toBeInTheDocument();
      expect(textOf(document.body)).not.toContain(AXES_NOT_CONFIGURED);
    });

    test("its resources' history bars keep a list's time axis under them, which a grid has none of", async () => {
      serveUnset({
        rows: [],
        columns: [],
        resources: [
          {
            ...resourceJson({
              name: "API in US",
              statusId: OPERATIONAL_STATUS_ID,
              statusPageGroupId: UNSET_ID,
              row: "API",
              column: "US",
            }),
            showStatusHistoryChart: true,
          },
        ],
      });
      await renderOverview();

      expect(
        within(sectionOf("Unset")).getByTestId("uptime-time-axis"),
      ).toBeInTheDocument();
    });

    test("on the Dashboard's preview, its owner reads why, as a quiet note above the list rather than an error", async () => {
      window.history.replaceState({}, "", PREVIEW_PATH);
      serveUnset({ rows: ["API"], columns: [], resources: unsetResources() });
      await renderOverview();

      const section: HTMLElement = sectionOf("Unset");
      const note: HTMLElement = within(section).getByTestId(
        "status-page-grid-axes-not-configured",
      );

      expect(textOf(note)).toBe(AXES_NOT_CONFIGURED);

      // The empty line's quiet gray and size, not an error's block.
      expect(tokensOf(note.className)).toEqual(
        expect.arrayContaining(["text-sm", "text-gray-500"]),
      );
      expect(within(section).getAllByText(AXES_NOT_CONFIGURED)).toHaveLength(1);

      // Above the list it explains, which is the one its visitors read.
      const lines: Array<HTMLElement> = within(section).getAllByTestId(
        "status-page-resource-header",
      );

      expect(lines).toHaveLength(2);
      expect(
        note.compareDocumentPosition(lines[0]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        within(section).queryByTestId("status-page-grid"),
      ).not.toBeInTheDocument();
    });

    test("on the preview, a grid with its rows and columns, and a list group with none, draw no note", async () => {
      window.history.replaceState({}, "", PREVIEW_PATH);
      serve(
        overviewPayload({
          groups: [
            REGIONS_GROUP,
            {
              ...gridGroupJson({
                id: UNSET_ID,
                name: "Plain",
                order: 2,
                rows: [],
                columns: [],
              }),
              viewMode: StatusPageGroupViewMode.List,
            },
          ],
          resources: [
            ...regionsResources(),
            resourceJson({
              name: "Status API",
              statusId: OPERATIONAL_STATUS_ID,
              statusPageGroupId: UNSET_ID,
              row: "",
              column: "",
            }),
          ],
        }),
      );
      await renderOverview();

      expect(gridOf("Regions")).toBeInTheDocument();
      expect(listedIn(sectionOf("Plain"))).toEqual([
        expect.stringContaining("Status API"),
      ]);
      expect(
        screen.queryByTestId("status-page-grid-axes-not-configured"),
      ).not.toBeInTheDocument();
      expect(textOf(document.body)).not.toContain(AXES_NOT_CONFIGURED);
    });
  });
});
