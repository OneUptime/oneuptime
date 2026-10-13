import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * Home's "Needs attention" card (Components/Home/NeedsAttention.tsx): what is
 * open in the project, by name - the incidents, alerts, monitors that are
 * not operational, SLOs whose budget is burning and maintenance in progress
 * - each row opening its record, each kind with "View all" into its list.
 *
 * The card draws what Home's batch read (HomeOverviewData); here it is handed
 * that data directly, as real model instances. react-i18next answers from the
 * REAL locale files.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type LocaleData = Record<string, unknown>;

function readLocale(code: string): LocaleData {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as LocaleData;
}

const EN: LocaleData = readLocale("en");
const DE: LocaleData = readLocale("de");

let activeLocale: LocaleData = EN;

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: unknown): string => {
          const flat: unknown = activeLocale[key];
          if (typeof flat === "string") {
            return flat;
          }
          return (
            (options as { defaultValue?: string } | undefined)?.defaultValue ??
            key
          );
        },
        i18n: {
          language: activeLocale === DE ? "de" : "en",
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return currentProjectId;
      },
    },
  };
});

import {
  HomeList,
  HomeOverviewData,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/HomeOverviewData";
import NeedsAttention, {
  ALL_CLEAR_DESCRIPTION,
  ALL_CLEAR_TITLE,
  AttentionGroup,
  AttentionGroupKey,
  getAttentionGroups,
  NOTHING_MONITORED_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/NeedsAttention";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import Color from "../../../Types/Color";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import { createTranslator } from "../../../UI/Utils/TranslateTemplate";

const PROJECT_ID: string = "65f00000000000000000cccc";
let currentProjectId: ObjectID | null = new ObjectID(PROJECT_ID);

const NOW: Date = new Date("2026-10-13T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

function ago(milliseconds: number): Date {
  return new Date(NOW.getTime() - milliseconds);
}

function fromNow(milliseconds: number): Date {
  return new Date(NOW.getTime() + milliseconds);
}

function id(number: number): string {
  return `65f0000000000000000b${String(number).padStart(4, "0")}`;
}

function incident(data: {
  number: number;
  title?: string | undefined;
  severity?: string | undefined;
  state?: string | undefined;
  declaredAt?: Date | undefined;
}): Incident {
  return Object.assign(new Incident(), {
    _id: id(data.number),
    title: data.title,
    incidentNumber: data.number,
    incidentNumberWithPrefix: `INC-${data.number}`,
    declaredAt: data.declaredAt,
    incidentSeverity: data.severity
      ? Object.assign(new IncidentSeverity(), {
          name: data.severity,
          color: new Color("#dc2626"),
        })
      : undefined,
    currentIncidentState: data.state
      ? Object.assign(new IncidentState(), {
          name: data.state,
          color: new Color("#ef4444"),
        })
      : undefined,
  });
}

function alert(number: number, title: string, createdAt: Date): Alert {
  return Object.assign(new Alert(), {
    _id: id(1000 + number),
    title,
    alertNumber: number,
    alertNumberWithPrefix: `ALT-${number}`,
    createdAt,
    alertSeverity: Object.assign(new AlertSeverity(), {
      name: "High",
      color: new Color("#f97316"),
    }),
    currentAlertState: Object.assign(new AlertState(), {
      name: "Acknowledged",
      color: new Color("#f59e0b"),
    }),
  });
}

function monitor(number: number, name: string, status: string): Monitor {
  return Object.assign(new Monitor(), {
    _id: id(2000 + number),
    name,
    monitorType: MonitorType.API,
    currentMonitorStatus: Object.assign(new MonitorStatus(), {
      name: status,
      color: new Color("#ef4444"),
    }),
  });
}

function slo(
  number: number,
  name: string,
  status: SloStatus,
  remaining: number | undefined,
): ServiceLevelObjective {
  return Object.assign(new ServiceLevelObjective(), {
    _id: id(3000 + number),
    name,
    sloStatus: status,
    errorBudgetRemainingPercentage: remaining,
  });
}

function maintenance(
  number: number,
  title: string,
  endsAt: Date | undefined,
): ScheduledMaintenance {
  return Object.assign(new ScheduledMaintenance(), {
    _id: id(4000 + number),
    title,
    startsAt: ago(20 * MINUTE),
    endsAt,
    currentScheduledMaintenanceState: Object.assign(
      new ScheduledMaintenanceState(),
      { name: "Ongoing", color: new Color("#f59e0b") },
    ),
  });
}

function list<TModel>(items: Array<TModel>, count?: number): HomeList<TModel> {
  return { items, count: count ?? items.length };
}

function overview(overrides: Partial<HomeOverviewData> = {}): HomeOverviewData {
  return {
    activeIncidents: list<Incident>([]),
    activeAlerts: list<Alert>([]),
    notOperationalMonitors: list<Monitor>([]),
    ongoingMaintenance: list<ScheduledMaintenance>([]),
    slosNeedingAttention: list<ServiceLevelObjective>([]),
    totalMonitors: 4,
    totalSlos: 2,
    ...overrides,
  };
}

function busy(): HomeOverviewData {
  return overview({
    activeIncidents: list(
      [
        incident({
          number: 1042,
          title: "Checkout API returning 503 errors",
          severity: "SEV-1",
          state: "Investigating",
          declaredAt: ago(12 * MINUTE),
        }),
        incident({
          number: 1041,
          title: "Elevated latency on payment authorizations",
          severity: "SEV-2",
          state: "Identified",
          declaredAt: ago(47 * MINUTE),
        }),
      ],
      2,
    ),
    activeAlerts: list([alert(311, "CPU above 90% on orders-db-1", ago(HOUR))]),
    notOperationalMonitors: list([monitor(1, "Checkout API", "Offline")]),
    slosNeedingAttention: list([
      slo(1, "Checkout availability", SloStatus.AtRisk, 18.43),
      slo(2, "Search latency", SloStatus.BudgetExhausted, -30),
    ]),
    ongoingMaintenance: list([
      maintenance(1, "Database failover drill", fromNow(40 * MINUTE)),
    ]),
  });
}

function routeOf(pageMap: PageMap, modelId?: string): string {
  let route: string = RouteMap[pageMap]!.toString().replace(
    ":projectId",
    PROJECT_ID,
  );
  if (modelId) {
    route = route.replace(":id", modelId);
  }
  return route;
}

function renderCard(
  data: HomeOverviewData | null,
  isLoading: boolean = false,
): void {
  render(
    <MemoryRouter>
      <NeedsAttention data={data} isLoading={isLoading} now={NOW} />
    </MemoryRouter>,
  );
}

function rowsOf(groupKey: AttentionGroupKey): Array<HTMLElement> {
  return screen.queryAllByTestId(`home-attention-row-${groupKey}`);
}

function linkOf(element: HTMLElement): string {
  return element.closest("a")?.getAttribute("href") || "";
}

beforeEach(() => {
  activeLocale = EN;
  currentProjectId = new ObjectID(PROJECT_ID);
});

afterEach(() => {
  cleanup();
});

describe("the groups", () => {
  test("only the kinds with something open, most urgent first", () => {
    renderCard(busy());

    const groups: Array<string> = screen
      .getAllByTestId(/^home-attention-group-[a-z]+$/)
      .map((element: HTMLElement): string => {
        return (element.getAttribute("data-testid") || "").replace(
          "home-attention-group-",
          "",
        );
      });

    expect(groups).toEqual([
      AttentionGroupKey.Incidents,
      AttentionGroupKey.Alerts,
      AttentionGroupKey.Monitors,
      AttentionGroupKey.Slos,
      AttentionGroupKey.Maintenance,
    ]);
  });

  test("a kind with nothing open is left out", () => {
    renderCard(
      overview({
        activeAlerts: list([alert(1, "Disk 85% full on logs-2", ago(HOUR))]),
      }),
    );

    expect(screen.getByTestId("home-attention-group-alerts")).toBeVisible();
    expect(screen.queryByTestId("home-attention-group-incidents")).toBeNull();
    expect(screen.queryByTestId("home-attention-group-monitors")).toBeNull();
    expect(screen.queryByTestId("home-attention-group-slos")).toBeNull();
    expect(screen.queryByTestId("home-attention-group-maintenance")).toBeNull();
  });

  test("each kind says its total and opens its full list", () => {
    renderCard(busy());

    const expected: Array<[AttentionGroupKey, string, PageMap]> = [
      [AttentionGroupKey.Incidents, "2", PageMap.HOME_ACTIVE_INCIDENTS],
      [AttentionGroupKey.Alerts, "1", PageMap.HOME_ACTIVE_ALERTS],
      [AttentionGroupKey.Monitors, "1", PageMap.HOME_NOT_OPERATIONAL_MONITORS],
      [AttentionGroupKey.Slos, "2", PageMap.SLOS],
      [
        AttentionGroupKey.Maintenance,
        "1",
        PageMap.HOME_ONGOING_SCHEDULED_MAINTENANCE_EVENTS,
      ],
    ];

    for (const [key, count, pageMap] of expected) {
      expect(
        screen.getByTestId(`home-attention-group-${key}-count`),
      ).toHaveTextContent(count);
      const viewAll: HTMLElement = screen.getByTestId(
        `home-attention-group-${key}-view-all`,
      );
      expect(viewAll).toHaveTextContent("View all");
      expect(linkOf(viewAll)).toBe(routeOf(pageMap));
    }
  });

  test("more open than the card shows: View all says how many", () => {
    renderCard(
      overview({
        activeIncidents: list(
          [1, 2, 3, 4, 5].map((number: number): Incident => {
            return incident({ number, title: `Edge node ${number} down` });
          }),
          9,
        ),
      }),
    );

    expect(rowsOf(AttentionGroupKey.Incidents)).toHaveLength(5);
    expect(
      screen.getByTestId("home-attention-group-incidents-count"),
    ).toHaveTextContent("9");
    expect(
      screen.getByTestId("home-attention-group-incidents-view-all"),
    ).toHaveTextContent("View all 9");
  });

  test("the total open counts problems, not planned maintenance", () => {
    renderCard(busy());

    // 2 incidents + 1 alert + 1 monitor + 2 SLOs; the maintenance is planned.
    expect(screen.getByTestId("home-attention-total")).toHaveTextContent(
      "6 open",
    );
  });

  test("maintenance alone shows no open count", () => {
    renderCard(
      overview({
        ongoingMaintenance: list([
          maintenance(1, "Database failover drill", fromNow(40 * MINUTE)),
        ]),
      }),
    );

    expect(
      screen.getByTestId("home-attention-group-maintenance"),
    ).toBeVisible();
    expect(screen.queryByTestId("home-attention-total")).toBeNull();
  });
});

describe("the rows", () => {
  test("an incident: its title, number and severity, its state and when it was declared", () => {
    renderCard(busy());

    const [first]: Array<HTMLElement> = rowsOf(AttentionGroupKey.Incidents);
    expect(first).toHaveTextContent("Checkout API returning 503 errors");
    expect(first).toHaveTextContent("INC-1042 · SEV-1");
    expect(within(first!).getByTestId("pill")).toHaveTextContent(
      "Investigating",
    );
    expect(
      within(first!).getByTestId("home-attention-row-time"),
    ).toHaveTextContent("12 minutes ago");
    expect(linkOf(first!)).toBe(routeOf(PageMap.INCIDENT_VIEW, id(1042)));
  });

  test("the rows keep the batch's order: newest incident first", () => {
    renderCard(busy());

    expect(
      rowsOf(AttentionGroupKey.Incidents).map(
        (row: HTMLElement): string | null => {
          return row.getAttribute("data-id");
        },
      ),
    ).toEqual([id(1042), id(1041)]);
  });

  test("an alert opens the alert, with its number and severity", () => {
    renderCard(busy());

    const [row]: Array<HTMLElement> = rowsOf(AttentionGroupKey.Alerts);
    expect(row).toHaveTextContent("CPU above 90% on orders-db-1");
    expect(row).toHaveTextContent("ALT-311 · High");
    expect(row).toHaveTextContent("1 hour ago");
    expect(linkOf(row!)).toBe(routeOf(PageMap.ALERT_VIEW, id(1311)));
  });

  test("a monitor opens the monitor, with its type and status", () => {
    renderCard(busy());

    const [row]: Array<HTMLElement> = rowsOf(AttentionGroupKey.Monitors);
    expect(row).toHaveTextContent("Checkout API");
    expect(row).toHaveTextContent("API");
    expect(within(row!).getByTestId("pill")).toHaveTextContent("Offline");
    expect(linkOf(row!)).toBe(routeOf(PageMap.MONITOR_VIEW, id(2001)));
  });

  test("an SLO says how much budget is left, or that none is", () => {
    renderCard(busy());

    const [atRisk, exhausted]: Array<HTMLElement> = rowsOf(
      AttentionGroupKey.Slos,
    );
    expect(atRisk).toHaveTextContent("Checkout availability");
    expect(atRisk).toHaveTextContent("18.4% of the error budget left");
    expect(within(atRisk!).getByTestId("pill")).toHaveTextContent("At Risk");
    expect(exhausted).toHaveTextContent("No error budget left");
    expect(within(exhausted!).getByTestId("pill")).toHaveTextContent(
      "Budget Exhausted",
    );
    expect(linkOf(atRisk!)).toBe(routeOf(PageMap.SLO_VIEW, id(3001)));
  });

  test("maintenance in progress says when it ends", () => {
    renderCard(busy());

    const [row]: Array<HTMLElement> = rowsOf(AttentionGroupKey.Maintenance);
    expect(row).toHaveTextContent("Database failover drill");
    expect(row).toHaveTextContent("Ends in 40 minutes");
    expect(linkOf(row!)).toBe(
      routeOf(PageMap.SCHEDULED_MAINTENANCE_VIEW, id(4001)),
    );
  });

  test("a row without a title still reads as something to open", () => {
    renderCard(
      overview({
        activeIncidents: list([incident({ number: 7 })]),
      }),
    );

    const [row]: Array<HTMLElement> = rowsOf(AttentionGroupKey.Incidents);
    expect(row).toHaveTextContent("Untitled");
    expect(row).toHaveTextContent("INC-7");
  });

  test("the time's full date is in its tooltip", () => {
    renderCard(busy());

    const time: HTMLElement = within(
      rowsOf(AttentionGroupKey.Incidents)[0]!,
    ).getByTestId("home-attention-row-time");
    expect(time.getAttribute("title")).toMatch(/2026/);
  });
});

describe("nothing open", () => {
  test("with monitors: nothing needs your attention", () => {
    renderCard(overview());

    const empty: HTMLElement = screen.getByTestId("home-attention-empty");
    expect(empty).toHaveAttribute("data-state", "all-clear");
    expect(empty).toHaveTextContent(ALL_CLEAR_TITLE);
    expect(empty).toHaveTextContent(ALL_CLEAR_DESCRIPTION);
    expect(screen.queryByTestId("home-attention-total")).toBeNull();
  });

  test("with nothing monitored: says where problems will show, not that all is clear", () => {
    renderCard(overview({ totalMonitors: 0 }));

    const empty: HTMLElement = screen.getByTestId("home-attention-empty");
    expect(empty).toHaveAttribute("data-state", "nothing-monitored");
    expect(empty).toHaveTextContent(NOTHING_MONITORED_TITLE);
    expect(empty).not.toHaveTextContent(ALL_CLEAR_TITLE);
  });

  test("while loading, placeholders; when the batch failed, a pointer to Refresh", () => {
    renderCard(null, true);

    expect(screen.getByTestId("home-attention-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("home-attention-empty")).toBeNull();

    cleanup();
    renderCard(null, false);

    expect(screen.getByTestId("home-attention-unavailable")).toHaveTextContent(
      "Refresh",
    );
  });
});

describe("getAttentionGroups", () => {
  const ENGLISH: ReturnType<typeof createTranslator> = createTranslator(
    undefined,
    "en",
  );

  test("each group's rows are the batch's rows, and its count the batch's total", () => {
    const groups: Array<AttentionGroup> = getAttentionGroups(busy(), ENGLISH);

    expect(
      groups.map((group: AttentionGroup): [string, number, number] => {
        return [group.key, group.rows.length, group.count];
      }),
    ).toEqual([
      ["incidents", 2, 2],
      ["alerts", 1, 1],
      ["monitors", 1, 1],
      ["slos", 2, 2],
      ["maintenance", 1, 1],
    ]);
  });

  test("an empty project has no groups", () => {
    expect(getAttentionGroups(overview(), ENGLISH)).toEqual([]);
  });
});

describe("in German", () => {
  function german(english: string): string {
    const value: unknown = DE[english];
    expect([english, typeof value]).toEqual([english, "string"]);
    expect(value).not.toBe(english);
    return value as string;
  }

  test("the group titles, View all and the times are in German", () => {
    activeLocale = DE;
    renderCard(busy());

    expect(
      screen.getByTestId("home-attention-group-incidents"),
    ).toHaveTextContent(german("Active incidents"));
    expect(
      screen.getByTestId("home-attention-group-alerts-view-all"),
    ).toHaveTextContent(german("View all"));
    expect(
      within(rowsOf(AttentionGroupKey.Incidents)[0]!).getByTestId(
        "home-attention-row-time",
      ),
    ).toHaveTextContent("vor 12 Minuten");
  });

  test("the empty state is in German", () => {
    activeLocale = DE;
    renderCard(overview());

    expect(screen.getByTestId("home-attention-empty")).toHaveTextContent(
      german(ALL_CLEAR_TITLE),
    );
  });
});
