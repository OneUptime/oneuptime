/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Monitoring Logs > View Summary, on the real page (Pages/Monitor/View/Logs)
 * and the real table (AnalyticsModelTable, BaseModelTable, Table). Only the
 * edges are stubbed: the analytics and model APIs, the probe list, the
 * project, the viewer and translation. Every logBody is stored the way
 * MonitorLogUtil writes it (redacted, JSON round-tripped - so its ids are
 * ObjectID envelopes and its dates ISO strings), and the analytics stub
 * answers the way the server and the dashboard's HTTP client do together:
 * only the selected fields, deserialised by HTTPResponse, which turns those
 * envelopes back into ObjectIDs.
 *
 * The bug: on an Incoming Email monitor, View Summary said "No summary
 * available. Looks like no email has been received yet." for every row. The
 * page never handed the row to SummaryInfo's email slot. A customer reading
 * a sender's verification email - Azure Monitor action groups now send a
 * one-time passcode to every new recipient - could see it on the Overview
 * only until the next email pushed it off, and nowhere after that.
 */

const analyticsGetListMock: MockFunction = getJestMockFunction();
const modelGetItemMock: MockFunction = getJestMockFunction();
const getAllProbesMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables and the imports below are still
 * unassigned when the factories run.
 */
jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return modelGetItemMock(...args);
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: (...args: Array<any>) => {
        return getAllProbesMock(...args);
      },
    },
  };
});

// Reads the monitor on its own; not what is under test.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/DisabledWarning",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<any>) => {
        return getCurrentProjectIdMock(...args);
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectMember];
      },
      getProjectPermissions: (): {
        permissions: Array<{ permission: Permission }>;
      } => {
        return { permissions: [{ permission: Permission.ProjectMember }] };
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return { globalPermissions: [] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import MonitorLogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/Logs";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import MonitorLog from "../../../Models/AnalyticsModels/MonitorLog";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Probe from "../../../Models/DatabaseModels/Probe";
import { redactForPersistence } from "../../../Server/Utils/Monitor/MonitorPayloadRedaction";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import OneUptimeDate from "../../../Types/Date";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import TableColumnsToCsv from "../../../UI/Utils/TableColumnsToCsv";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const MONITOR_ID: string = "22222222-2222-4222-8222-222222222222";
const MONITOR_STEP_ID: string = "33333333-3333-4333-8333-333333333333";
const PROBE_FRANKFURT: string = "44444444-4444-4444-8444-444444444444";
const PROBE_VIRGINIA: string = "55555555-5555-4555-8555-555555555555";

const NO_EMAIL_MESSAGE: string =
  "No summary available. Looks like no email has been received yet.";

const PASSCODE: string = "482913";

const pageProps: PageComponentProps = {
  pageRoute: new Route("/logs"),
  currentProject: null,
  hasPaymentMethod: false,
};

const at: (iso: string) => Date = (iso: string): Date => {
  return OneUptimeDate.fromString(iso);
};

const EVALUATION_SUMMARY: MonitorEvaluationSummary = {
  evaluatedAt: at("2026-09-30T09:12:00.000Z"),
  criteriaResults: [
    {
      criteriaId: "criteria-online",
      criteriaName: "Email Body Has No Error",
      filterCondition: FilterCondition.Any,
      met: true,
      message: "The email body does not contain error.",
      filters: [],
    },
  ],
  events: [],
};

// The body exactly as MonitorLogUtil.saveMonitorLog stores it.
function storeAsMonitorLog(dataToProcess: unknown): JSONObject {
  return redactForPersistence(
    JSON.parse(JSON.stringify(dataToProcess)),
  ) as JSONObject;
}

function logRow(data: { id: string; time: string; body: unknown }): JSONObject {
  return {
    _id: data.id,
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    time: data.time,
    logBody: storeAsMonitorLog(data.body),
  };
}

function emailRow(data: {
  id: string;
  time: string;
  from: string;
  subject: string;
  body: string;
}): JSONObject {
  return logRow({
    id: data.id,
    time: data.time,
    body: {
      projectId: new ObjectID(PROJECT_ID),
      monitorId: new ObjectID(MONITOR_ID),
      emailFrom: data.from,
      emailTo: "[REDACTED]@inbound.oneuptime.com",
      emailSubject: data.subject,
      emailBody: data.body,
      emailHeaders: { From: data.from },
      emailReceivedAt: at(data.time),
      checkedAt: at(data.time),
      onlyCheckForIncomingEmailReceivedAt: false,
      evaluationSummary: EVALUATION_SUMMARY,
    },
  });
}

// What the table's list request asked for, and what the stub holds.
let apiRows: Array<JSONObject> = [];

interface ListRequest {
  select: Record<string, boolean | undefined>;
}

function monitorOfType(monitorType: MonitorType): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID;
  monitor.monitorType = monitorType;
  return monitor;
}

function probe(id: string, name: string): Probe {
  const row: Probe = new Probe();
  row._id = id;
  row.name = name;
  return row;
}

beforeEach(() => {
  apiRows = [];
  getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
  getAllProbesMock.mockResolvedValue([
    probe(PROBE_FRANKFURT, "Frankfurt"),
    probe(PROBE_VIRGINIA, "N. Virginia"),
  ]);
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(MONITOR_ID));
  analyticsGetListMock.mockImplementation(
    async (request: ListRequest): Promise<ListResult<MonitorLog>> => {
      const selected: Array<JSONObject> = apiRows.map(
        (row: JSONObject): JSONObject => {
          const fields: JSONObject = {};
          for (const key of Object.keys(row)) {
            const value: JSONValue | undefined = row[key];
            if (request.select[key] && value !== undefined) {
              fields[key] = value;
            }
          }
          return fields;
        },
      );
      // What AnalyticsModelAPI.getList gets back from its HTTP client.
      const wire: HTTPResponse<JSONArray> = new HTTPResponse<JSONArray>(
        200,
        {
          data: selected,
          count: selected.length,
          skip: 0,
          limit: selected.length,
        },
        {},
      );
      const data: Array<MonitorLog> =
        AnalyticsBaseModel.fromJSONArray<MonitorLog>(
          wire.data as Array<JSONObject>,
          MonitorLog,
        );
      return { data, count: data.length, skip: 0, limit: data.length };
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

async function renderLogsPage(data: {
  monitorType: MonitorType;
  rows: Array<JSONObject>;
}): Promise<void> {
  apiRows = data.rows;
  modelGetItemMock.mockResolvedValue(monitorOfType(data.monitorType));

  await act(async () => {
    render(
      <MemoryRouter>
        <MonitorLogs {...pageProps} />
      </MemoryRouter>,
    );
  });

  await waitFor(() => {
    expect(screen.queryAllByTestId("row-actions")).toHaveLength(
      data.rows.length,
    );
  });
}

// Opens View Summary on the n-th row (newest first) and returns the modal.
function openSummary(rowIndex: number): HTMLElement {
  const rowActions: HTMLElement =
    screen.getAllByTestId("row-actions")[rowIndex]!;

  fireEvent.click(within(rowActions).getByText("View Summary"));

  const modal: HTMLElement = screen.getByRole("dialog");

  expect(within(modal).getByText("Monitoring Summary")).toBeInTheDocument();

  return modal;
}

function closeSummary(modal: HTMLElement): void {
  fireEvent.click(within(modal).getByText("Close"));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
}

function columnHeaderTexts(): Array<string> {
  return screen
    .getAllByRole("columnheader")
    .map((header: HTMLElement): string => {
      return header.textContent || "";
    });
}

// Each data row's cell in the column headed `title`, newest row first.
function cellsOfColumn(title: string): Array<HTMLElement> {
  const column: number = columnHeaderTexts().indexOf(title);

  expect(column).toBeGreaterThanOrEqual(0);

  return screen
    .getAllByTestId("row-actions")
    .map((actions: HTMLElement): HTMLElement => {
      return actions
        .closest("tr")!
        .querySelectorAll("td")
        .item(column) as HTMLElement;
    });
}

// The value an InfoCard in `container` shows under `title`.
function infoCardValue(container: HTMLElement, title: string): string {
  const card: HTMLElement | null = within(container)
    .getByText(title)
    .closest(".rounded-xl");

  expect(card).not.toBeNull();

  return (card!.textContent || "").replace(title, "").trim();
}

describe("Monitoring Logs > View Summary on an Incoming Email monitor", () => {
  const VERIFICATION_ROW: JSONObject = emailRow({
    id: "a0000000-0000-4000-8000-000000000002",
    time: "2026-09-30T09:12:00.000Z",
    from: "azure-noreply@microsoft.com",
    subject: "Verify your email address for Azure Monitor",
    body: `Use this one-time passcode to verify your email address: ${PASSCODE}`,
  });

  // Arrived after the verification email, so it is the one the Overview shows.
  const LATER_ROW: JSONObject = emailRow({
    id: "a0000000-0000-4000-8000-000000000003",
    time: "2026-09-30T09:40:00.000Z",
    from: "alerts-noreply@mail.windowsazure.com",
    subject: "Fired: Sev3 Azure Monitor Alert CPU above 90%",
    body: "Your Azure Monitor alert was triggered.",
  });

  // The worker's scheduled check from before any email arrived.
  const CHECK_BEFORE_ANY_EMAIL: JSONObject = logRow({
    id: "a0000000-0000-4000-8000-000000000001",
    time: "2026-09-30T08:55:00.000Z",
    body: {
      projectId: new ObjectID(PROJECT_ID),
      monitorId: new ObjectID(MONITOR_ID),
      emailReceivedAt: at("2026-09-01T08:00:00.000Z"),
      onlyCheckForIncomingEmailReceivedAt: true,
      checkedAt: at("2026-09-30T08:55:00.000Z"),
      emailFrom: "",
      emailTo: "",
      emailSubject: "",
      emailBody: "",
      evaluationSummary: EVALUATION_SUMMARY,
    },
  });

  const ROWS: Array<JSONObject> = [
    LATER_ROW,
    VERIFICATION_ROW,
    CHECK_BEFORE_ANY_EMAIL,
  ];

  test("shows the verification email a row recorded, passcode included", async () => {
    await renderLogsPage({
      monitorType: MonitorType.IncomingEmail,
      rows: ROWS,
    });

    const modal: HTMLElement = openSummary(1);

    expect(within(modal).queryByText(NO_EMAIL_MESSAGE)).not.toBeInTheDocument();
    expect(infoCardValue(modal, "From")).toBe("azure-noreply@microsoft.com");
    expect(infoCardValue(modal, "Subject")).toBe(
      "Verify your email address for Azure Monitor",
    );

    fireEvent.click(within(modal).getByText("Show More Details"));

    expect(
      within(modal).getByText(
        `Use this one-time passcode to verify your email address: ${PASSCODE}`,
      ),
    ).toBeInTheDocument();
    // Why this row matched: the evaluation is in the modal too.
    expect(
      within(modal).getByText("Email Body Has No Error"),
    ).toBeInTheDocument();
  });

  test("shows each row's own email, not the first one opened", async () => {
    await renderLogsPage({
      monitorType: MonitorType.IncomingEmail,
      rows: ROWS,
    });

    closeSummary(openSummary(1));

    const modal: HTMLElement = openSummary(0);

    expect(infoCardValue(modal, "Subject")).toBe(
      "Fired: Sev3 Azure Monitor Alert CPU above 90%",
    );
    expect(infoCardValue(modal, "From")).toBe(
      "alerts-noreply@mail.windowsazure.com",
    );
  });

  test("says no email had arrived on a check that ran before any did", async () => {
    await renderLogsPage({
      monitorType: MonitorType.IncomingEmail,
      rows: ROWS,
    });

    const modal: HTMLElement = openSummary(2);

    expect(infoCardValue(modal, "Last Email Received At")).toBe("No email yet");
    expect(infoCardValue(modal, "Monitor Status Check At")).toBe(
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        at("2026-09-30T08:55:00.000Z"),
      ),
    );
  });

  test("gives an email monitor no Probe column", async () => {
    await renderLogsPage({
      monitorType: MonitorType.IncomingEmail,
      rows: ROWS,
    });

    expect(
      screen.queryByRole("columnheader", { name: "Probe" }),
    ).not.toBeInTheDocument();
    expect(getAllProbesMock).not.toHaveBeenCalled();
  });

  /*
   * Every row used to read "Criteria met: ..." and nothing else, so the
   * verification email's row could only be found by opening each one.
   */
  test("names each row's email in an Email column after the time", async () => {
    await renderLogsPage({
      monitorType: MonitorType.IncomingEmail,
      rows: ROWS,
    });

    const headers: Array<string> = columnHeaderTexts();

    expect(headers.indexOf("Email")).toBeGreaterThan(
      headers.indexOf("Monitored At"),
    );
    expect(headers.indexOf("Evaluation Outcome")).toBeGreaterThan(
      headers.indexOf("Email"),
    );

    const [later, verification, check] = cellsOfColumn("Email");

    expect(
      within(later!).getByText("Fired: Sev3 Azure Monitor Alert CPU above 90%"),
    ).toBeInTheDocument();
    expect(
      within(later!).getByText("alerts-noreply@mail.windowsazure.com"),
    ).toBeInTheDocument();

    expect(
      within(verification!).getByText(
        "Verify your email address for Azure Monitor",
      ),
    ).toBeInTheDocument();
    expect(
      within(verification!).getByText("azure-noreply@microsoft.com"),
    ).toBeInTheDocument();

    expect(check).toHaveTextContent(/^Scheduled check$/);
  });

  test("calls a scheduled check a check, though it carries the last email", async () => {
    // The worker's check spreads the monitor's last email into its payload.
    const checkAfterVerification: JSONObject = logRow({
      id: "a0000000-0000-4000-8000-000000000004",
      time: "2026-09-30T09:42:30.000Z",
      body: {
        ...(VERIFICATION_ROW["logBody"] as JSONObject),
        checkedAt: at("2026-09-30T09:42:30.000Z"),
        onlyCheckForIncomingEmailReceivedAt: true,
      },
    });

    await renderLogsPage({
      monitorType: MonitorType.IncomingEmail,
      rows: [checkAfterVerification, VERIFICATION_ROW],
    });

    const [check, verification] = cellsOfColumn("Email");

    expect(check).toHaveTextContent(/^Scheduled check$/);
    expect(verification).toHaveTextContent(
      "Verify your email address for Azure Monitor",
    );

    // Its summary still shows the email the check measured, and when.
    const modal: HTMLElement = openSummary(0);

    expect(infoCardValue(modal, "Subject")).toBe(
      "Verify your email address for Azure Monitor",
    );
    expect(infoCardValue(modal, "Monitor Status Check At")).toBe(
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        at("2026-09-30T09:42:30.000Z"),
      ),
    );
  });

  test("exports the Email column as its words, not the log body behind it", async () => {
    const downloads: Array<{ csv: string; filename: string }> = [];

    jest
      .spyOn(TableColumnsToCsv, "downloadCsv")
      .mockImplementation((data: { csv: string; filename: string }): void => {
        downloads.push(data);
      });

    await renderLogsPage({
      monitorType: MonitorType.IncomingEmail,
      rows: ROWS,
    });

    // Every bulk action, the export included, waits behind a selection.
    await act(async () => {
      fireEvent.click(
        screen.getByRole("checkbox", { name: "Select all items" }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Bulk Actions"));
    });
    await waitFor(() => {
      expect(screen.queryByText("Export CSV")).not.toBeNull();
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Export CSV"));
    });
    await waitFor(() => {
      expect(downloads).toHaveLength(1);
    });

    const csv: string = downloads[0]!.csv;

    expect(csv.split("\r\n")[0]).toContain("Email");
    expect(csv).toContain(
      "Fired: Sev3 Azure Monitor Alert CPU above 90% <alerts-noreply@mail.windowsazure.com>",
    );
    expect(csv).toContain(
      "Verify your email address for Azure Monitor <azure-noreply@microsoft.com>",
    );
    expect(csv).toContain("Scheduled check");
  });

  test("says an email had no subject rather than leaving the cell blank", async () => {
    await renderLogsPage({
      monitorType: MonitorType.IncomingEmail,
      rows: [
        emailRow({
          id: "a0000000-0000-4000-8000-000000000005",
          time: "2026-09-30T10:00:00.000Z",
          from: "backup@nightly.example",
          subject: "",
          body: "Backup completed.",
        }),
      ],
    });

    const [cell] = cellsOfColumn("Email");

    expect(within(cell!).getByText("(no subject)")).toBeInTheDocument();
    expect(
      within(cell!).getByText("backup@nightly.example"),
    ).toBeInTheDocument();
  });
});

describe("Monitoring Logs on a probe monitor", () => {
  function websiteRow(data: {
    id: string;
    time: string;
    probeId: string;
    responseCode: number;
  }): JSONObject {
    return logRow({
      id: data.id,
      time: data.time,
      body: {
        projectId: new ObjectID(PROJECT_ID),
        monitorId: new ObjectID(MONITOR_ID),
        monitorStepId: new ObjectID(MONITOR_STEP_ID),
        probeId: new ObjectID(data.probeId),
        isOnline: data.responseCode < 400,
        responseCode: data.responseCode,
        responseTimeInMs: 240,
        monitoredAt: at(data.time),
        evaluationSummary: EVALUATION_SUMMARY,
      },
    });
  }

  const ROWS: Array<JSONObject> = [
    websiteRow({
      id: "b0000000-0000-4000-8000-000000000002",
      time: "2026-09-30T09:13:00.000Z",
      probeId: PROBE_VIRGINIA,
      responseCode: 200,
    }),
    websiteRow({
      id: "b0000000-0000-4000-8000-000000000001",
      time: "2026-09-30T09:12:00.000Z",
      probeId: PROBE_FRANKFURT,
      responseCode: 503,
    }),
  ];

  test("names the probe that ran each check", async () => {
    // Stored as an envelope; the HTTP client hands the page an ObjectID.
    expect((ROWS[0]!["logBody"] as JSONObject)["probeId"]).toEqual({
      _type: "ObjectID",
      value: PROBE_VIRGINIA,
    });

    await renderLogsPage({ monitorType: MonitorType.Website, rows: ROWS });

    const headers: Array<HTMLElement> = screen.getAllByRole("columnheader");
    const probeColumn: number = headers.findIndex(
      (header: HTMLElement): boolean => {
        return header.textContent === "Probe";
      },
    );

    expect(probeColumn).toBeGreaterThanOrEqual(0);

    const probeCells: Array<string> = screen
      .getAllByTestId("row-actions")
      .map((actions: HTMLElement): string => {
        const row: HTMLElement = actions.closest("tr")!;
        return row.querySelectorAll("td")[probeColumn]?.textContent || "";
      });

    expect(probeCells).toEqual(["N. Virginia", "Frankfurt"]);
  });

  test("has no Email column, which only an email monitor gets", async () => {
    await renderLogsPage({ monitorType: MonitorType.Website, rows: ROWS });

    expect(columnHeaderTexts()).not.toContain("Email");
  });

  test("shows a check and its probe in View Summary", async () => {
    await renderLogsPage({ monitorType: MonitorType.Website, rows: ROWS });

    const modal: HTMLElement = openSummary(1);

    expect(infoCardValue(modal, "Probe")).toBe("Frankfurt");
    expect(infoCardValue(modal, "Response Status Code")).toBe("503");
    expect(
      within(modal).getByText("Email Body Has No Error"),
    ).toBeInTheDocument();
  });
});

describe("Monitoring Logs on the other push monitors", () => {
  test("shows an incoming request in View Summary", async () => {
    await renderLogsPage({
      monitorType: MonitorType.IncomingRequest,
      rows: [
        logRow({
          id: "c0000000-0000-4000-8000-000000000001",
          time: "2026-09-30T09:12:00.000Z",
          body: {
            projectId: new ObjectID(PROJECT_ID),
            monitorId: new ObjectID(MONITOR_ID),
            incomingRequestReceivedAt: at("2026-09-30T09:12:00.000Z"),
            checkedAt: at("2026-09-30T09:12:00.000Z"),
            requestMethod: "POST",
            requestHeaders: { "content-type": "application/json" },
            evaluationSummary: EVALUATION_SUMMARY,
          },
        }),
      ],
    });

    // Its heartbeats are requests, not emails.
    expect(columnHeaderTexts()).not.toContain("Email");

    const modal: HTMLElement = openSummary(0);

    expect(infoCardValue(modal, "Request Method")).toBe("POST");
  });

  test("shows a server report in View Summary", async () => {
    await renderLogsPage({
      monitorType: MonitorType.Server,
      rows: [
        logRow({
          id: "d0000000-0000-4000-8000-000000000001",
          time: "2026-09-30T09:12:00.000Z",
          body: {
            projectId: new ObjectID(PROJECT_ID),
            monitorId: new ObjectID(MONITOR_ID),
            hostname: "orders-db-01",
            requestReceivedAt: at("2026-09-30T09:12:00.000Z"),
            onlyCheckRequestReceivedAt: false,
            evaluationSummary: EVALUATION_SUMMARY,
          },
        }),
      ],
    });

    const modal: HTMLElement = openSummary(0);

    expect(infoCardValue(modal, "Hostname")).toBe("orders-db-01");
  });
});

/*
 * MONITORING LOGS ON EVERY MONITOR BUT A MANUAL ONE (issue #6639).
 *
 * The telemetry worker's checks were always logged, but a Metrics, Logs or
 * Kubernetes monitor had no Monitoring Logs page to read them on. Its rows
 * now say what each check saw - the logs or spans its criteria counted, the
 * data a metric check read, or that it read none - and View Summary shows
 * when the check ran, what it saw and how the criteria judged it, with no
 * "Next Check At" a check that has run cannot have.
 */
describe("Monitoring Logs on a telemetry monitor", () => {
  const METRIC_EVALUATION: MonitorEvaluationSummary = {
    evaluatedAt: at("2026-11-10T09:12:00.000Z"),
    criteriaResults: [
      {
        criteriaId: "criteria-high-cpu",
        criteriaName: "High CPU",
        filterCondition: FilterCondition.Any,
        met: true,
        message: "CPU recorded latest 92.00% (expected above 80%).",
        filters: [],
      },
    ],
    events: [],
  };

  function points(count: number): Array<JSONObject> {
    const data: Array<JSONObject> = [];
    for (let index: number = 0; index < count; index++) {
      data.push({
        timestamp: at("2026-11-10T09:10:00.000Z"),
        value: 90 + index,
      } as unknown as JSONObject);
    }
    return data;
  }

  function metricRow(data: {
    id: string;
    time: string;
    pointsPerQuery: Array<number>;
    evaluationSummary?: MonitorEvaluationSummary | undefined;
  }): JSONObject {
    return logRow({
      id: data.id,
      time: data.time,
      body: {
        projectId: new ObjectID(PROJECT_ID),
        monitorId: new ObjectID(MONITOR_ID),
        startAndEndDate: {
          startValue: at("2026-11-10T09:07:00.000Z"),
          endValue: at(data.time),
        },
        metricResult: data.pointsPerQuery.map((count: number): JSONObject => {
          return { data: points(count) } as unknown as JSONObject;
        }),
        metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
        evaluationSummary: data.evaluationSummary || METRIC_EVALUATION,
      },
    });
  }

  const METRIC_ROWS: Array<JSONObject> = [
    metricRow({
      id: "e0000000-0000-4000-8000-000000000003",
      time: "2026-11-10T09:12:00.000Z",
      pointsPerQuery: [5, 3],
    }),
    // The metric stopped arriving: the check read nothing.
    metricRow({
      id: "e0000000-0000-4000-8000-000000000002",
      time: "2026-11-10T09:11:00.000Z",
      pointsPerQuery: [0, 0],
      evaluationSummary: {
        ...METRIC_EVALUATION,
        criteriaResults: [
          {
            ...METRIC_EVALUATION.criteriaResults[0]!,
            met: false,
            message: "No data points in the window.",
          },
        ],
      },
    }),
    metricRow({
      id: "e0000000-0000-4000-8000-000000000001",
      time: "2026-11-10T09:10:00.000Z",
      pointsPerQuery: [1],
    }),
  ];

  function logsRow(data: {
    id: string;
    time: string;
    logCount: number;
  }): JSONObject {
    return logRow({
      id: data.id,
      time: data.time,
      body: {
        projectId: new ObjectID(PROJECT_ID),
        monitorId: new ObjectID(MONITOR_ID),
        logCount: data.logCount,
        logQuery: { severityText: "ERROR" },
        evaluationSummary: EVALUATION_SUMMARY,
      },
    });
  }

  function textsOfColumn(title: string): Array<string> {
    return cellsOfColumn(title).map((cell: HTMLElement): string => {
      return cell.textContent || "";
    });
  }

  test("a Metrics monitor's rows say how much data each check read", async () => {
    await renderLogsPage({
      monitorType: MonitorType.Metrics,
      rows: METRIC_ROWS,
    });

    const headers: Array<string> = columnHeaderTexts();

    // When it ran, what it saw, then how the criteria judged it.
    expect(headers.indexOf("Monitored At")).toBeLessThan(
      headers.indexOf("Observed"),
    );
    expect(headers.indexOf("Observed")).toBeLessThan(
      headers.indexOf("Evaluation Outcome"),
    );
    expect(textsOfColumn("Observed")).toEqual([
      "8 data points",
      "No data",
      "1 data point",
    ]);
  });

  test("a check that read nothing stands out as No data", async () => {
    await renderLogsPage({
      monitorType: MonitorType.Metrics,
      rows: METRIC_ROWS,
    });

    const cells: Array<HTMLElement> = cellsOfColumn("Observed");

    expect(
      within(cells[1]!).getByTestId("monitor-log-no-data"),
    ).toHaveTextContent("No data");
    expect(
      within(cells[0]!).queryByTestId("monitor-log-no-data"),
    ).not.toBeInTheDocument();
  });

  test("a telemetry monitor has none of a probe's or an email's columns", async () => {
    await renderLogsPage({
      monitorType: MonitorType.Metrics,
      rows: METRIC_ROWS,
    });

    const headers: Array<string> = columnHeaderTexts();

    expect(headers).not.toContain("Probe");
    expect(headers).not.toContain("Attempts");
    expect(headers).not.toContain("Email");
    // It never asks for the probes: no probe checks it.
    expect(getAllProbesMock).not.toHaveBeenCalled();
  });

  test("the evaluation outcome reads the same as on every other monitor", async () => {
    await renderLogsPage({
      monitorType: MonitorType.Metrics,
      rows: METRIC_ROWS,
    });

    expect(textsOfColumn("Evaluation Outcome")).toEqual([
      "Criteria met: High CPU",
      "No criteria met",
      "Criteria met: High CPU",
    ]);
  });

  test("View Summary shows when the check ran, what it saw and how it was judged", async () => {
    await renderLogsPage({
      monitorType: MonitorType.Metrics,
      rows: METRIC_ROWS,
    });

    const modal: HTMLElement = openSummary(0);

    expect(infoCardValue(modal, "Monitored At")).toBe(
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        at("2026-11-10T09:12:00.000Z"),
      ),
    );
    expect(infoCardValue(modal, "Observed")).toBe("8 data points");
    // A check that has run has no next one.
    expect(within(modal).queryByText("Next Check At")).not.toBeInTheDocument();
    // How the criteria judged it.
    expect(within(modal).getByText("High CPU")).toBeInTheDocument();

    closeSummary(modal);

    const noData: HTMLElement = openSummary(1);

    expect(infoCardValue(noData, "Observed")).toBe("No data");
  });

  test("a Logs monitor's rows say how many logs each check counted", async () => {
    await renderLogsPage({
      monitorType: MonitorType.Logs,
      rows: [
        logsRow({
          id: "f0000000-0000-4000-8000-000000000003",
          time: "2026-11-10T09:12:00.000Z",
          logCount: 412,
        }),
        logsRow({
          id: "f0000000-0000-4000-8000-000000000002",
          time: "2026-11-10T09:11:00.000Z",
          logCount: 1,
        }),
        // A service that stopped logging: a count of 0, said as one.
        logsRow({
          id: "f0000000-0000-4000-8000-000000000001",
          time: "2026-11-10T09:10:00.000Z",
          logCount: 0,
        }),
      ],
    });

    expect(textsOfColumn("Observed")).toEqual(["412 logs", "1 log", "0 logs"]);

    const modal: HTMLElement = openSummary(0);

    expect(infoCardValue(modal, "Observed")).toBe("412 logs");
    expect(within(modal).queryByText("Next Check At")).not.toBeInTheDocument();
  });

  test("a grouped Kubernetes monitor's rows count the series that reported", async () => {
    await renderLogsPage({
      monitorType: MonitorType.Kubernetes,
      rows: [
        logRow({
          id: "f1000000-0000-4000-8000-000000000001",
          time: "2026-11-10T09:12:00.000Z",
          body: {
            projectId: new ObjectID(PROJECT_ID),
            monitorId: new ObjectID(MONITOR_ID),
            metricResult: [{ data: points(6) }],
            metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
            seriesBreakdown: [
              {
                fingerprint: "pod=api-1",
                labels: { "k8s.pod.name": "api-1" },
                aggregatedResults: [{ data: points(3) }],
              },
              {
                fingerprint: "pod=api-2",
                labels: { "k8s.pod.name": "api-2" },
                aggregatedResults: [{ data: points(3) }],
              },
            ],
            evaluationSummary: METRIC_EVALUATION,
          },
        }),
      ],
    });

    expect(textsOfColumn("Observed")).toEqual(["2 series"]);
  });

  test("a row whose check cannot be read shows a dash, not a count of 0", async () => {
    await renderLogsPage({
      monitorType: MonitorType.Traces,
      rows: [
        logRow({
          id: "f2000000-0000-4000-8000-000000000001",
          time: "2026-11-10T09:12:00.000Z",
          body: {
            projectId: new ObjectID(PROJECT_ID),
            monitorId: new ObjectID(MONITOR_ID),
            evaluationSummary: EVALUATION_SUMMARY,
          },
        }),
      ],
    });

    expect(textsOfColumn("Observed")).toEqual(["—"]);
  });

  test("exports the Observed column as its words, not the log body behind it", async () => {
    const downloads: Array<{ csv: string; filename: string }> = [];

    jest
      .spyOn(TableColumnsToCsv, "downloadCsv")
      .mockImplementation((data: { csv: string; filename: string }): void => {
        downloads.push(data);
      });

    await renderLogsPage({
      monitorType: MonitorType.Metrics,
      rows: METRIC_ROWS,
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("checkbox", { name: "Select all items" }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Bulk Actions"));
    });
    await waitFor(() => {
      expect(screen.queryByText("Export CSV")).not.toBeNull();
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Export CSV"));
    });
    await waitFor(() => {
      expect(downloads).toHaveLength(1);
    });

    const csv: string = downloads[0]!.csv;

    expect(csv.split("\r\n")[0]).toContain("Observed");
    expect(csv).toContain("8 data points");
    expect(csv).toContain("No data");
    expect(csv).toContain("1 data point");
  });

  test("a probe monitor gets no Observed column", async () => {
    await renderLogsPage({
      monitorType: MonitorType.Website,
      rows: [
        logRow({
          id: "f3000000-0000-4000-8000-000000000001",
          time: "2026-11-10T09:12:00.000Z",
          body: {
            projectId: new ObjectID(PROJECT_ID),
            monitorId: new ObjectID(MONITOR_ID),
            monitorStepId: new ObjectID(MONITOR_STEP_ID),
            probeId: new ObjectID(PROBE_FRANKFURT),
            isOnline: true,
            responseCode: 200,
            monitoredAt: at("2026-11-10T09:12:00.000Z"),
            evaluationSummary: EVALUATION_SUMMARY,
          },
        }),
      ],
    });

    expect(columnHeaderTexts()).not.toContain("Observed");
  });
});
