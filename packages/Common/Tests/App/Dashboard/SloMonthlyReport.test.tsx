/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

type DownloadFileMock = (...args: Array<unknown>) => unknown;

const mockDownloadFile: Mock<DownloadFileMock> = jest.fn<DownloadFileMock>();

jest.mock("../../../UI/Utils/DownloadFile", () => {
  return {
    __esModule: true,
    default: (...args: Array<unknown>): unknown => {
      return mockDownloadFile(...args);
    },
  };
});

import SloMonthlyReportElement, {
  SLO_MONTHLY_REPORT_PERIOD_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloMonthlyReport";
import { SLO_MONTHLY_REPORT_TOTAL_ROW_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloMonthlyReportTable";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import API from "../../../UI/Utils/API/API";
import { followLanguageForDates } from "../../../UI/Utils/DateDisplayLanguage";
import {
  SloMonthlyFigures,
  SloMonthlyReport,
  SloMonthlyReportPeriod,
  SloMonthlyReportPeriodKind,
  SloMonthlyReportUnavailableReason,
  SloReportMonth,
  buildSloMonthlyReport,
  buildUnavailableSloMonthlyReport,
  getRequestMonthlyFigures,
  getSloReportMonths,
  sloMonthlyReportToJSON,
} from "../../../Utils/Slo/SloMonthlyReport";
import { PROJECT_ID } from "./SideMenuHarness";

/*
 * AN SLO'S MONTHLY REPORT PAGE (#5476): the months of the period picked,
 * drawn by the product's table with the total last; three figures that say
 * how the period went; each monitor's own months when there are several;
 * the period kept in the address; what an SLO with nothing to report, a
 * period with no data and a failed load say; and the CSV it downloads -
 * in English, German and Persian, from the shipped locale files.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const EN: Record<string, string> = readLocale("en");
const DE: Record<string, string> = readLocale("de");
const FA: Record<string, string> = readLocale("fa");

const SLO_ID: ObjectID = new ObjectID("54760000-0000-4000-8000-0000000000aa");
const MONITOR_A: string = "54760000-0000-4000-8000-0000000000a1";
const MONITOR_B: string = "54760000-0000-4000-8000-0000000000b2";

// The day the reports below were measured.
const MEASURED_AT: Date = new Date("2026-11-16T12:00:00.000Z");

const HOUR: number = 3600;
const DAY: number = 86400;

const NO_DATA: SloMonthlyFigures = { total: 0, bad: 0, sliPercentage: null };

const LATIN_DIGIT: RegExp = /[0-9]/;

function figures(total: number, bad: number): SloMonthlyFigures {
  return {
    total: total,
    bad: bad,
    sliPercentage: ((total - bad) / total) * 100,
  };
}

const LAST_6_MONTHS: SloMonthlyReportPeriod = {
  kind: SloMonthlyReportPeriodKind.LastMonths,
  months: 6,
};

const SIX_MONTHS: Array<SloReportMonth> = getSloReportMonths({
  period: LAST_6_MONTHS,
  now: MEASURED_AT,
});

/*
 * June and July have no data; August met the 99.9% target; September and
 * October missed it by two hours each; November is on track so far. Two
 * monitors: Payments cost the SLO its hours, Search was always up.
 */
const MONITOR_REPORT: SloMonthlyReport = buildSloMonthlyReport({
  sloId: SLO_ID,
  sloName: "Checkout API",
  sliType: SliType.MonitorUptime,
  targetPercentage: 99.9,
  timezone: "UTC",
  period: LAST_6_MONTHS,
  months: SIX_MONTHS,
  figures: [
    NO_DATA,
    NO_DATA,
    figures(31 * DAY, 0),
    figures(30 * DAY, 2 * HOUR),
    figures(31 * DAY, 2 * HOUR),
    figures(15.5 * DAY, 0),
  ],
  monitors: [
    {
      monitorId: MONITOR_B,
      name: "Search",
      months: [
        NO_DATA,
        NO_DATA,
        figures(31 * DAY, 0),
        figures(30 * DAY, 0),
        figures(31 * DAY, 0),
        figures(15.5 * DAY, 0),
      ],
    },
    {
      monitorId: MONITOR_A,
      name: "Payments",
      months: [
        NO_DATA,
        NO_DATA,
        figures(31 * DAY, 0),
        figures(30 * DAY, 2 * HOUR),
        figures(31 * DAY, 2 * HOUR),
        figures(15.5 * DAY, 0),
      ],
    },
  ],
  now: MEASURED_AT,
});

let apiGet: SpyInstance<typeof API.get>;

function answer(report: SloMonthlyReport): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    JSON.parse(JSON.stringify(sloMonthlyReportToJSON(report))) as JSONObject,
    {},
  );
}

function answerWith(...reports: Array<SloMonthlyReport>): void {
  for (const report of reports) {
    apiGet.mockResolvedValueOnce(answer(report) as never);
  }
}

function openPage(search: string = ""): void {
  window.history.replaceState(
    {},
    "",
    `/dashboard/${PROJECT_ID}/slos/${SLO_ID.toString()}/monthly-report${search}`,
  );

  render(
    <MemoryRouter>
      <SloMonthlyReportElement sloId={SLO_ID} />
    </MemoryRouter>,
  );
}

async function opened(search: string = ""): Promise<void> {
  openPage(search);
  await screen.findByTestId(SLO_MONTHLY_REPORT_TOTAL_ROW_TEST_ID);
}

function askedFor(call: number = 0): Record<string, string> {
  return (apiGet.mock.calls[call]![0] as { params: Record<string, string> })
    .params;
}

function monthlyTable(): HTMLElement {
  return screen
    .getByTestId(SLO_MONTHLY_REPORT_TOTAL_ROW_TEST_ID)
    .closest("table") as HTMLElement;
}

function rowsOf(table: HTMLElement): Array<HTMLElement> {
  return Array.from(table.querySelectorAll("tbody tr")) as Array<HTMLElement>;
}

function verdictsOf(table: HTMLElement): Array<string> {
  return Array.from(
    table.querySelectorAll("[data-testid='slo-monthly-report-verdict']"),
  ).map((cell: Element): string => {
    return (cell.textContent || "").trim();
  });
}

function periodButton(value: string): HTMLElement {
  return screen.getByTestId(`${SLO_MONTHLY_REPORT_PERIOD_TEST_ID}-${value}`);
}

const THIS_YEAR: number = new Date().getUTCFullYear();

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      fa: { translation: FA },
      en: { translation: EN },
    },
    interpolation: { escapeValue: false },
  });

  // Months are named in the page's language, as the Dashboard sets it up.
  followLanguageForDates(i18next);
});

beforeEach(async () => {
  await i18next.changeLanguage("en");
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: 1600,
  });
  mockDownloadFile.mockReset();
  apiGet = jest.spyOn(API, "get") as unknown as SpyInstance<typeof API.get>;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("loading the report", () => {
  test("asks the SLO's monthly report address for the last 12 months", async () => {
    answerWith(MONITOR_REPORT);

    await opened();

    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(
      (apiGet.mock.calls[0]![0] as { url: { toString: () => string } }).url
        .toString()
        .endsWith(
          `/service-level-objective/${SLO_ID.toString()}/monthly-report`,
        ),
    ).toBe(true);
    expect(askedFor()).toEqual({ months: "12" });
  });

  test("opens on the period the address asks for", async () => {
    answerWith(MONITOR_REPORT);

    await opened("?year=2025");

    expect(askedFor()).toEqual({ year: "2025" });
  });

  test("a period from a link that is not one of the buttons is still shown, and pressed", async () => {
    answerWith(MONITOR_REPORT);

    await opened("?months=4");

    expect(askedFor()).toEqual({ months: "4" });
    expect(periodButton("months-4")).toHaveAttribute("aria-checked", "true");
    // A number keeps its unit on its line: a no-break space between them.
    expect(periodButton("months-4").textContent).toBe("4\u00A0months");
  });

  test("an address it cannot read opens the default", async () => {
    answerWith(MONITOR_REPORT);

    await opened("?months=forty&year=1999");

    expect(askedFor()).toEqual({ months: "12" });
  });
});

describe("the months", () => {
  test("lists the months with data, oldest first, and the total last", async () => {
    answerWith(MONITOR_REPORT);

    await opened();

    const rows: Array<HTMLElement> = rowsOf(monthlyTable());

    expect(
      rows.map((row: HTMLElement): string => {
        return (row.querySelector("td")?.textContent || "").trim();
      }),
    ).toEqual([
      "August 2026",
      "September 2026",
      "October 2026",
      "November 2026So far",
      "Total",
    ]);

    // The months before the monitors had data are named once, above the table.
    expect(
      screen.getByTestId("slo-monthly-report-no-data-before").textContent,
    ).toBe(
      "This SLO's monitors have no status history before August 2026, so earlier months are left out.",
    );
  });

  test("judges every month and the total, as badges", async () => {
    answerWith(MONITOR_REPORT);

    await opened();

    /*
     * The total is decided early too: four hours down is more than the
     * period allows even through the end of November.
     */
    expect(verdictsOf(monthlyTable())).toEqual([
      "Met",
      "Missed",
      "Missed",
      "On track",
      "Missed",
    ]);
  });

  test("writes an SLI floored to three decimals, so a miss never reads as the target", async () => {
    answerWith(MONITOR_REPORT);

    await opened();

    const slis: Array<string> = Array.from(
      monthlyTable().querySelectorAll("[data-testid='slo-monthly-report-sli']"),
    ).map((cell: Element): string => {
      return (cell.textContent || "").trim();
    });

    // September: 2 hours of 30 days is 99.7222...%.
    expect(slis.slice(0, 4)).toEqual(["100%", "99.722%", "99.731%", "100%"]);
  });

  test("says each month's downtime and the share of its error budget it used", async () => {
    answerWith(MONITOR_REPORT);

    await opened();

    const september: HTMLElement = rowsOf(monthlyTable())[1]!;

    expect(within(september).getByText("2h")).toBeInTheDocument();
    // 2 hours against the 43m 12s 99.9% allows of 30 days.
    expect(within(september).getByText("277.8%")).toBeInTheDocument();
  });

  test("names its columns, with what an SLI and the budget mean", async () => {
    answerWith(MONITOR_REPORT);

    await opened();

    expect(
      Array.from(monthlyTable().querySelectorAll("thead th")).map(
        (cell: Element): string => {
          return (cell.textContent || "").trim();
        },
      ),
    ).toEqual(
      expect.arrayContaining([
        "Month",
        expect.stringContaining("SLI"),
        "Downtime",
        expect.stringContaining("Error Budget Used"),
        "Result",
      ]),
    );
  });
});

describe("the summary", () => {
  test("says the period's SLI, the months that met the target and the lowest month", async () => {
    answerWith(MONITOR_REPORT);

    await opened();

    const summary: HTMLElement = screen.getByTestId(
      "slo-monthly-report-summary",
    );

    expect(
      within(summary).getByText("SLI over the period so far"),
    ).toBeInTheDocument();
    // 4 hours down of 107.5 days measured.
    expect(screen.getByTestId("slo-monthly-report-total-sli").textContent).toBe(
      "99.844%",
    );
    expect(within(summary).getByText("Target 99.9%")).toBeInTheDocument();
    expect(
      screen.getByTestId("slo-monthly-report-months-met").textContent,
    ).toBe("1 of 3");
    expect(
      screen.getByTestId("slo-monthly-report-worst-month").textContent,
    ).toBe("September 2026");
  });

  test("the card says the target and the zone the months are cut in", async () => {
    answerWith(MONITOR_REPORT);

    await opened();

    expect(
      screen.getByText(
        "How this SLO did each calendar month against its target of 99.9%. Months run in UTC.",
      ),
    ).toBeInTheDocument();
  });
});

describe("by monitor", () => {
  test("each monitor's own months, the one that cost the SLO most first", async () => {
    answerWith(MONITOR_REPORT);

    await opened();

    expect(screen.getByText("By Monitor")).toBeInTheDocument();
    expect(
      screen
        .getAllByTestId("slo-monthly-report-monitor-name")
        .map((cell: HTMLElement): string => {
          return cell.textContent || "";
        }),
    ).toEqual(["Payments", "Search"]);

    const table: HTMLElement = screen
      .getAllByTestId("slo-monthly-report-monitor-name")[0]!
      .closest("table") as HTMLElement;

    expect(
      Array.from(table.querySelectorAll("thead th")).map(
        (cell: Element): string => {
          return (cell.textContent || "").trim();
        },
      ),
    ).toEqual(
      expect.arrayContaining([
        "Monitor",
        "Aug 2026",
        "Sep 2026",
        "Oct 2026",
        "Nov 2026",
        "Total",
      ]),
    );

    // A month below the target is red, one at it green.
    const payments: Array<HTMLElement> = within(
      rowsOf(table)[0]!,
    ).getAllByTestId("slo-monthly-report-monitor-sli");

    expect(payments[1]!.className).toContain("text-red-700");
    expect(payments[0]!.className).toContain("text-emerald-700");
  });

  test("a single monitor needs no breakdown", async () => {
    answerWith({
      ...MONITOR_REPORT,
      monitors: MONITOR_REPORT.monitors.slice(0, 1),
    });

    await opened();

    expect(screen.queryByText("By Monitor")).not.toBeInTheDocument();
  });
});

describe("picking a period", () => {
  test("a button fetches its period and keeps it in the address", async () => {
    answerWith(MONITOR_REPORT, MONITOR_REPORT, MONITOR_REPORT, MONITOR_REPORT);

    await opened();

    expect(periodButton("months-12")).toHaveAttribute("aria-checked", "true");

    fireEvent.click(periodButton("months-6"));

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledTimes(2);
    });
    expect(askedFor(1)).toEqual({ months: "6" });
    expect(window.location.search).toBe("?months=6");

    fireEvent.click(periodButton(`year-${THIS_YEAR}`));

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledTimes(3);
    });
    expect(askedFor(2)).toEqual({ year: THIS_YEAR.toString() });
    expect(window.location.search).toBe(`?year=${THIS_YEAR}`);

    // The default leaves the address as it was first opened.
    fireEvent.click(periodButton("months-12"));

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledTimes(4);
    });
    expect(window.location.search).toBe("");
  });

  test("offers 3, 6, 9 and 12 months, this year and last year", async () => {
    answerWith(MONITOR_REPORT);

    await opened();

    expect(
      within(screen.getByRole("radiogroup", { name: "Period" }))
        .getAllByRole("radio")
        .map((button: HTMLElement): string => {
          // A number keeps its unit on its line (NoBreakSpaces).
          return (button.textContent || "").replace(/\u00A0/g, " ");
        }),
    ).toEqual([
      "3 months",
      "6 months",
      "9 months",
      "12 months",
      THIS_YEAR.toString(),
      (THIS_YEAR - 1).toString(),
    ]);
  });
});

describe("downloading", () => {
  test("Download CSV saves the report as a file named after the SLO", async () => {
    answerWith(MONITOR_REPORT);

    await opened();

    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledTimes(1);

    const file: { content: string; filename: string; mimeType: string } =
      mockDownloadFile.mock.calls[0]![0] as {
        content: string;
        filename: string;
        mimeType: string;
      };

    expect(file.filename).toBe("checkout-api-monthly-report-last-6-months.csv");
    expect(file.mimeType).toContain("text/csv");
    expect(file.content.split("\r\n")[0]).toBe(
      "Month,Month to date,SLI (%),Target (%),Measured (seconds),Downtime (seconds),Error budget used (%),Result,Payments SLI (%),Search SLI (%)",
    );
    expect(file.content).toContain("\r\nTotal,Yes,");
  });
});

describe("when there is nothing to show", () => {
  test("an SLO with no monitors says so, with the page that adds them", async () => {
    answerWith(
      buildUnavailableSloMonthlyReport({
        sloId: SLO_ID,
        sliType: SliType.MonitorUptime,
        targetPercentage: 99.9,
        timezone: "UTC",
        period: { kind: SloMonthlyReportPeriodKind.LastMonths, months: 12 },
        reason: SloMonthlyReportUnavailableReason.NoMonitors,
        now: MEASURED_AT,
      }),
    );

    openPage();

    const state: HTMLElement = await screen.findByTestId(
      "slo-monthly-report-unavailable",
    );

    expect(
      within(state).getByText("Nothing to report yet"),
    ).toBeInTheDocument();
    expect(
      within(state).getByText(
        "No monitors are attached to this SLO, so there is nothing to report yet. Add the monitors it measures, or a monitor rule that attaches them.",
      ),
    ).toBeInTheDocument();
    expect(
      within(state).getByRole("link", { name: "Add Monitors" }),
    ).toHaveAttribute(
      "href",
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.SLO_VIEW_MONITORS] as Route,
        { modelId: SLO_ID },
      ).toString(),
    );
    expect(screen.getByRole("button", { name: "Download CSV" })).toBeDisabled();
  });

  test("a request SLO without services is sent to Settings", async () => {
    answerWith(
      buildUnavailableSloMonthlyReport({
        sloId: SLO_ID,
        sliType: SliType.RequestSuccess,
        targetPercentage: 99.9,
        timezone: "UTC",
        period: { kind: SloMonthlyReportPeriodKind.LastMonths, months: 12 },
        reason: SloMonthlyReportUnavailableReason.NoServices,
        now: MEASURED_AT,
      }),
    );

    openPage();

    const state: HTMLElement = await screen.findByTestId(
      "slo-monthly-report-unavailable",
    );

    expect(
      within(state).getByRole("link", { name: "Open Settings" }),
    ).toHaveAttribute(
      "href",
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.SLO_VIEW_SETTINGS] as Route,
        { modelId: SLO_ID },
      ).toString(),
    );
  });

  test("a period with no data at all says so", async () => {
    answerWith({
      ...buildSloMonthlyReport({
        sloId: SLO_ID,
        sliType: SliType.MonitorUptime,
        targetPercentage: 99.9,
        timezone: "UTC",
        period: LAST_6_MONTHS,
        months: SIX_MONTHS,
        figures: SIX_MONTHS.map((): SloMonthlyFigures => {
          return NO_DATA;
        }),
        now: MEASURED_AT,
      }),
    });

    openPage();

    expect(
      await screen.findByTestId("slo-monthly-report-no-data"),
    ).toHaveTextContent("No data in this period");
    expect(
      screen.queryByTestId(SLO_MONTHLY_REPORT_TOTAL_ROW_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("a failed load says what failed, and Try again loads it again", async () => {
    apiGet.mockResolvedValueOnce(
      new HTTPErrorResponse(
        500,
        { message: "The report could not be measured. Try again." },
        {},
      ) as never,
    );
    answerWith(MONITOR_REPORT);

    openPage();

    expect(
      await screen.findByText("The report could not be measured. Try again."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /try again|refresh/i }));

    await screen.findByTestId(SLO_MONTHLY_REPORT_TOTAL_ROW_TEST_ID);
    expect(apiGet).toHaveBeenCalledTimes(2);
  });
});

describe("a request SLO", () => {
  test("counts requests: the requests and the slow ones, with no monitors to break down", async () => {
    const months: Array<SloReportMonth> = getSloReportMonths({
      period: { kind: SloMonthlyReportPeriodKind.LastMonths, months: 2 },
      now: MEASURED_AT,
    });

    answerWith(
      buildSloMonthlyReport({
        sloId: SLO_ID,
        sloName: "Search latency",
        sliType: SliType.RequestLatency,
        targetPercentage: 99,
        timezone: "UTC",
        period: { kind: SloMonthlyReportPeriodKind.LastMonths, months: 2 },
        months: months,
        figures: [
          getRequestMonthlyFigures({ goodCount: 1236900, totalCount: 1240000 }),
          getRequestMonthlyFigures({ goodCount: 9000, totalCount: 10000 }),
        ],
        now: MEASURED_AT,
      }),
    );

    await opened();

    const headers: Array<string> = Array.from(
      monthlyTable().querySelectorAll("thead th"),
    ).map((cell: Element): string => {
      return (cell.textContent || "").trim();
    });

    expect(headers).toEqual(
      expect.arrayContaining(["Requests", "Slow Requests"]),
    );
    expect(headers).not.toContain("Downtime");

    const october: HTMLElement = rowsOf(monthlyTable())[0]!;
    expect(within(october).getByText("1,240,000")).toBeInTheDocument();
    expect(within(october).getByText("3,100")).toBeInTheDocument();

    // November so far is below the target, but more requests can still lift it.
    expect(verdictsOf(monthlyTable())[1]).toBe("Below target");
    expect(screen.queryByText("By Monitor")).not.toBeInTheDocument();
  });
});

describe("a Metric SLO", () => {
  test("counts its metric's events, and its bad ones", async () => {
    answerWith(
      buildSloMonthlyReport({
        sloId: SLO_ID,
        sloName: "Checkout latency",
        sliType: SliType.Metric,
        targetPercentage: 99,
        timezone: "UTC",
        period: { kind: SloMonthlyReportPeriodKind.LastMonths, months: 1 },
        months: getSloReportMonths({
          period: { kind: SloMonthlyReportPeriodKind.LastMonths, months: 1 },
          now: MEASURED_AT,
        }),
        figures: [
          getRequestMonthlyFigures({ goodCount: 995, totalCount: 1000 }),
        ],
        now: MEASURED_AT,
      }),
    );

    await opened();

    const headers: Array<string> = Array.from(
      monthlyTable().querySelectorAll("thead th"),
    ).map((cell: Element): string => {
      return (cell.textContent || "").trim();
    });

    expect(headers).toEqual(expect.arrayContaining(["Events", "Bad Events"]));
    expect(headers).not.toContain("Requests");
    expect(headers).not.toContain("Downtime");
    expect(
      within(rowsOf(monthlyTable())[0]!).getByText("1,000"),
    ).toBeInTheDocument();
  });

  test("a Metric SLO with no metric to count is sent to Settings", async () => {
    answerWith(
      buildUnavailableSloMonthlyReport({
        sloId: SLO_ID,
        sliType: SliType.Metric,
        targetPercentage: 99,
        timezone: "UTC",
        period: { kind: SloMonthlyReportPeriodKind.LastMonths, months: 12 },
        reason: SloMonthlyReportUnavailableReason.NoMetric,
        now: MEASURED_AT,
      }),
    );

    openPage();

    const state: HTMLElement = await screen.findByTestId(
      "slo-monthly-report-unavailable",
    );

    expect(
      within(state).getByText(
        "This SLO has no metric it can count, so there is nothing to report yet. Choose its metric in Settings.",
      ),
    ).toBeInTheDocument();
    expect(
      within(state).getByRole("link", { name: "Open Settings" }),
    ).toBeInTheDocument();
  });
});

describe("in the reader's language", () => {
  test("German: the words, the months and the figures read in German", async () => {
    await i18next.changeLanguage("de");
    answerWith(MONITOR_REPORT);

    await opened();

    expect(screen.getByText("Monatsbericht")).toBeInTheDocument();
    expect(verdictsOf(monthlyTable())).toEqual([
      DE["Met"],
      DE["Missed (target)"],
      DE["Missed (target)"],
      DE["On track"],
      DE["Missed (target)"],
    ]);
    expect(DE["Missed (target)"]).toBe("Verfehlt");

    const firstCells: Array<string> = rowsOf(monthlyTable()).map(
      (row: HTMLElement): string => {
        return (row.querySelector("td")?.textContent || "").trim();
      },
    );

    expect(firstCells).toContain("Oktober 2026");
    expect(firstCells[firstCells.length - 1]).toBe("Gesamt");

    // A decimal comma, never "99.722".
    expect(
      screen.getByTestId("slo-monthly-report-total-sli").textContent,
    ).toMatch(/^99,844\s%$/);
  });

  test("Persian: the page's words in Persian, and not one Latin digit in an SLI", async () => {
    await i18next.changeLanguage("fa");
    answerWith(MONITOR_REPORT);

    await opened();

    expect(
      screen.getByText(FA["Monthly Report"] as string),
    ).toBeInTheDocument();

    const slis: Array<string> = Array.from(
      document.querySelectorAll("[data-testid='slo-monthly-report-sli']"),
    ).map((cell: Element): string => {
      return cell.textContent || "";
    });

    expect(slis.length).toBeGreaterThan(0);

    for (const sli of slis) {
      expect(sli).not.toMatch(LATIN_DIGIT);
    }
  });
});
