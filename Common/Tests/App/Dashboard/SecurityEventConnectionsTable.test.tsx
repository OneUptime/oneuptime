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
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import SecurityEventConnectionRunDetails from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionRunDetails";
import SecurityEventConnectionsTable from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionsTable";
import {
  CONNECTOR_HEALTH_NO_EVENTS_YET,
  CONNECTOR_HEALTH_SUCCEEDED,
  connectorHealth,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionDiagnosticsUtil";
import {
  googleSecOpsHealth,
  googleSecOpsTestBody,
  GOOGLE_SECOPS_TEST_NEEDS_KEY_MESSAGE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/GoogleSecOpsDiagnosticsUtil";
import GoogleSecOpsConnectionsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/GoogleSecOpsConnections";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GoogleSecOpsConnection from "../../../Models/DatabaseModels/GoogleSecOpsConnection";
import Project from "../../../Models/DatabaseModels/Project";
import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectionRun from "../../../Models/DatabaseModels/SecurityEventConnectionRun";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { SecurityConnectorTestReport } from "../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import { SecurityEventConnectionRunResult } from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { GoogleSecOpsRunResult } from "../../../Types/SecurityEvent/GoogleSecOpsDiagnostics";
import { CardButtonSchema } from "../../../UI/Components/Card/Card";
import ModelColumn from "../../../UI/Components/ModelTable/Column";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import TableRow from "../../../UI/Components/Table/TableRow";
import TableColumn from "../../../UI/Components/Table/Types/Column";
import FieldType from "../../../UI/Components/Types/FieldType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * Replace only ModelTable's data-loading boundary, the way
 * GoogleSecOpsConnectionsErrors.test.tsx does: the real TableRow decides
 * action visibility and dispatches the selected row, and every modal the
 * table opens stays real. Rows are keyed by model so the Google SecOps
 * page, which renders both tables, gets each of its rows in the right one.
 */
const mockRows: Map<string, Array<BaseModel>> = new Map();
const mockTableProps: Map<string, ModelTableProps<BaseModel>> = new Map();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: ModelTableProps<BaseModel>): ReactElement => {
      const tableName: string = new props.modelType().tableName || "";
      mockTableProps.set(tableName, props);
      const columns: Array<TableColumn<BaseModel>> = [
        ...props.columns.map(
          (column: ModelColumn<BaseModel>): TableColumn<BaseModel> => {
            return {
              title: column.title,
              type: column.type,
              key: Object.keys(column.field)[0] as keyof BaseModel,
              getElement: column.getElement,
              noValueMessage: column.noValueMessage,
            };
          },
        ),
        { title: "Actions", type: FieldType.Actions },
      ];

      return (
        <table aria-label={props.cardProps?.title as string}>
          <thead>
            <tr>
              {columns.map((column: TableColumn<BaseModel>): ReactElement => {
                return <th key={column.title}>{column.title}</th>;
              })}
            </tr>
          </thead>
          {(mockRows.get(tableName) || []).map(
            (row: BaseModel): ReactElement => {
              return (
                <tbody
                  key={row._id}
                  data-testid={(row as unknown as { name: string }).name}
                >
                  <TableRow
                    item={row}
                    columns={columns}
                    actionButtons={props.actionButtons}
                    isMobile={false}
                  />
                </tbody>
              );
            },
          )}
        </table>
      );
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: string = "22222222-2222-4222-8222-222222222222";
const GOOGLE_ID: string = "33333333-3333-4333-8333-333333333333";
const NOW: number = new Date("2026-09-10T12:00:00Z").getTime();

function pollResult(
  overrides: Partial<SecurityEventConnectionRunResult> = {},
): SecurityEventConnectionRunResult {
  return {
    type: "poll",
    provider: "okta",
    status: "success",
    startedAt: "2026-09-10T11:59:00Z",
    completedAt: "2026-09-10T11:59:02Z",
    durationMs: 2000,
    windowStart: "2026-09-10T11:53:00Z",
    windowEnd: "2026-09-10T11:59:00Z",
    fetchedCount: 0,
    ingestedCount: 0,
    duplicateCount: 0,
    rejectedCount: 0,
    failedCount: 0,
    complete: true,
    requestCount: 1,
    warnings: [],
    samples: [],
    checks: [],
    ...overrides,
  };
}

function connection(
  overrides: Partial<SecurityEventConnection> = {},
): SecurityEventConnection {
  const value: SecurityEventConnection = new SecurityEventConnection();
  value._id = CONNECTION_ID;
  value.projectId = PROJECT_ID;
  value.name = "Acme Okta";
  value.provider = SecurityEventConnectorProvider.OktaSystemLog;
  value.config = { orgUrl: "https://acme.okta.com" };
  value.isEnabled = true;
  value.pollIntervalInMinutes = 5;
  value.alertingOnly = true;
  value.createdAt = new Date(NOW - 60 * 60_000);
  value.lastPolledAt = new Date(NOW - 60_000);
  value.lastSuccessfulPollAt = new Date(NOW - 60_000);
  value.lastPollResult = pollResult() as unknown as JSONObject;
  Object.assign(value, overrides);
  return value;
}

function report(provider: string): SecurityConnectorTestReport {
  return {
    provider,
    status: "warn",
    startedAt: "2026-09-10T12:00:00.000Z",
    completedAt: "2026-09-10T12:00:01.000Z",
    durationMs: 1000,
    summary: "Access works; nothing was created in the last 7 days.",
    checks: [
      {
        key: "authentication",
        name: "Authenticate",
        status: "pass",
        durationMs: 200,
        message: "Accepted.",
      },
      {
        key: "detections-available",
        name: "Records available to import",
        status: "warn",
        durationMs: 300,
        message: "No records were created in the last 7 days.",
        remediation: "Polling will import new records as they are created.",
      },
    ],
  };
}

function renderTable(rows: Array<SecurityEventConnection>): void {
  mockRows.set("SecurityEventConnection", rows);
  render(
    <MemoryRouter>
      <SecurityEventConnectionsTable />
    </MemoryRouter>,
  );
}

function row(name: string = "Acme Okta"): HTMLElement {
  return screen.getByTestId(name);
}

function postCall(index: number = 0): JSONObject {
  return jest.mocked(API.post).mock.calls[index]?.[0] as unknown as JSONObject;
}

describe("SecurityEventConnectionsTable", () => {
  beforeEach((): void => {
    /*
     * Health is judged against the clock, so pin it next to the fixtures'
     * timestamps the way GoogleSecOpsDiagnostics.test.tsx does.
     */
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    mockRows.clear();
    mockTableProps.clear();
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
    jest
      .spyOn(ModelAPI, "getCommonHeaders")
      .mockReturnValue({ "project-id": PROJECT_ID.toString() });
    jest
      .spyOn(ModelAPI, "getList")
      .mockResolvedValue({ data: [], count: 0, skip: 0, limit: 20 });
    jest.spyOn(ModelAPI, "getItem").mockResolvedValue(connection());
    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse(200, report("okta") as unknown as JSONObject, {}),
      );
  });

  afterEach((): void => {
    cleanup();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("declares the generic table without ModelTable's own create form and with an Add connection header button", (): void => {
    renderTable([]);

    const props: ModelTableProps<BaseModel> = mockTableProps.get(
      "SecurityEventConnection",
    ) as ModelTableProps<BaseModel>;
    expect(props.isCreateable).toBe(false);
    expect(props.isEditable).toBe(false);
    expect(props.formFields).toBeUndefined();
    expect(props.selectMoreFields).toEqual(
      expect.objectContaining({
        lastError: true,
        provider: true,
        config: true,
        lastEventIngestedAt: true,
      }),
    );
    expect(props.selectMoreFields).not.toHaveProperty("secrets");
    expect(props.query).toEqual({ projectId: PROJECT_ID });

    const button: CardButtonSchema = props.cardProps
      ?.buttons?.[0] as CardButtonSchema;
    expect(button.title).toBe("Add connection");
    expect(button.disabled).toBe(false);
    expect(
      props.columns.map((column: ModelColumn<BaseModel>): string => {
        return column.title;
      }),
    ).toEqual([
      "Name",
      "Provider",
      "Status",
      "Health",
      "Interval (Minutes)",
      "Last Polled",
      "Last Successful Poll",
      "Last Event Imported",
    ]);
  });

  test("the empty state explains prerequisites and links every provider's setup guide", (): void => {
    renderTable([]);

    const props: ModelTableProps<BaseModel> = mockTableProps.get(
      "SecurityEventConnection",
    ) as ModelTableProps<BaseModel>;
    render(<MemoryRouter>{props.noItemsMessage as ReactElement}</MemoryRouter>);

    expect(screen.getByText(/read-only credential/)).toBeVisible();
    expect(screen.getByText(/running OneUptime worker/)).toBeVisible();
    const links: Array<HTMLElement> = screen.getAllByRole("link");
    expect(
      links.map((link: HTMLElement): string => {
        return link.textContent || "";
      }),
    ).toEqual([
      "Microsoft Sentinel",
      "Microsoft Defender XDR",
      "CrowdStrike Falcon",
      "Splunk Enterprise Security",
      "Elastic Security",
      "AWS Security Hub",
      "Okta System Log",
    ]);
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link.getAttribute("href")).toMatch(
        /\/docs\/integrations\/[a-z-]+$/,
      );
    }
  });

  test("shows the catalog title, status and the honest health vocabulary per row", (): void => {
    const imported: SecurityEventConnection = connection({
      _id: "44444444-4444-4444-8444-444444444444",
      name: "Imported Sentinel",
      provider: SecurityEventConnectorProvider.MicrosoftSentinel,
      lastEventIngestedAt: new Date(NOW - 30_000),
    });
    const paused: SecurityEventConnection = connection({
      _id: "55555555-5555-4555-8555-555555555555",
      name: "Paused Splunk",
      provider: SecurityEventConnectorProvider.SplunkEnterpriseSecurity,
      isEnabled: false,
    });
    renderTable([connection(), imported, paused]);

    expect(row("Acme Okta")).toHaveTextContent("Okta System Log");
    expect(row("Acme Okta")).toHaveTextContent("Enabled");
    expect(row("Acme Okta")).toHaveTextContent(CONNECTOR_HEALTH_NO_EVENTS_YET);
    expect(row("Acme Okta")).not.toHaveTextContent(CONNECTOR_HEALTH_SUCCEEDED);

    expect(row("Imported Sentinel")).toHaveTextContent("Microsoft Sentinel");
    expect(row("Imported Sentinel")).toHaveTextContent(
      CONNECTOR_HEALTH_SUCCEEDED,
    );

    expect(row("Paused Splunk")).toHaveTextContent(
      "Splunk Enterprise Security",
    );
    expect(row("Paused Splunk")).toHaveTextContent("Disabled");
    expect(row("Paused Splunk")).toHaveTextContent("Schedule paused");
  });

  test("read-only members keep View Error and Diagnostics while every write action is locked", (): void => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({
      isAllowed: false,
      disabledReason: "You do not have permission to update connections.",
    });
    renderTable([
      connection({ lastError: "Okta System Log request failed (HTTP 401)" }),
    ]);

    const current: HTMLElement = row();
    for (const title of [
      "Test connection",
      "Run now",
      "Edit",
      "Update credentials",
    ]) {
      expect(
        within(current).getByRole("button", { name: title }),
      ).toBeDisabled();
    }
    expect(
      within(current).getByRole("button", { name: "Diagnostics" }),
    ).toBeEnabled();
    expect(
      within(current).getByRole("button", { name: "View Error" }),
    ).toBeEnabled();

    const props: ModelTableProps<BaseModel> = mockTableProps.get(
      "SecurityEventConnection",
    ) as ModelTableProps<BaseModel>;
    const button: CardButtonSchema = props.cardProps
      ?.buttons?.[0] as CardButtonSchema;
    expect(button.disabled).toBe(true);
    expect(button.tooltip).toBe(
      "You do not have permission to update connections.",
    );
    expect(API.post).not.toHaveBeenCalled();
  });

  test("View Error appears only for rows with an error and opens the full message", (): void => {
    renderTable([
      connection({ lastError: "Okta System Log request failed (HTTP 401)" }),
      connection({
        _id: "44444444-4444-4444-8444-444444444444",
        name: "Healthy",
      }),
    ]);

    expect(
      within(row("Healthy")).queryByRole("button", { name: "View Error" }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(row()).getByRole("button", { name: "View Error" }));
    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Last Error",
    });
    expect(
      within(dialog).getByLabelText("Full error message").textContent,
    ).toBe("Okta System Log request failed (HTTP 401)");
  });

  test("Test connection posts the connection id to the synchronous test route and shows the checklist", async (): Promise<void> => {
    renderTable([connection()]);

    fireEvent.click(
      within(row()).getByRole("button", { name: "Test connection" }),
    );

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: "Test connection: Acme Okta",
    });
    expect(
      await within(dialog).findByText("Passed with warnings"),
    ).toBeVisible();
    expect(dialog).toHaveTextContent("Access to Okta System Log");
    expect(dialog).toHaveTextContent("What is available to import");

    expect(API.post).toHaveBeenCalledTimes(1);
    expect(postCall()["data"]).toEqual({ connectionId: CONNECTION_ID });
    expect(postCall()["headers"]).toEqual({
      "project-id": PROJECT_ID.toString(),
    });
    const destination: globalThis.URL = new globalThis.URL(
      String(postCall()["url"]),
    );
    expect(destination.pathname).toMatch(/\/security-event-connection\/test$/);
    expect(Array.from(destination.searchParams.keys()).sort()).toEqual([]);
  });

  test("Run now opens diagnostics and queues a poll for that connection", async (): Promise<void> => {
    jest
      .mocked(API.post)
      .mockResolvedValue(
        new HTTPResponse(
          200,
          { runId: "66666666-6666-4666-8666-666666666666" },
          {},
        ),
      );
    renderTable([connection()]);

    fireEvent.click(within(row()).getByRole("button", { name: "Run now" }));

    expect(
      await screen.findByRole("dialog", {
        name: "Connection diagnostics: Acme Okta",
      }),
    ).toBeVisible();
    await waitFor((): void => {
      expect(API.post).toHaveBeenCalledTimes(1);
    });
    expect(postCall()["data"]).toEqual({ type: "poll" });
    expect(new globalThis.URL(String(postCall()["url"])).pathname).toMatch(
      new RegExp(`/security-event-connection/${CONNECTION_ID}/run$`),
    );
    // The diagnostics modal never selects the write-only secrets column.
    expect(
      jest.mocked(ModelAPI.getItem).mock.calls[0]?.[0].select,
    ).not.toHaveProperty("secrets");
  });

  test("Diagnostics shows the same health wording and UTC times with a local-time title", async (): Promise<void> => {
    renderTable([connection()]);

    fireEvent.click(within(row()).getByRole("button", { name: "Diagnostics" }));

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: "Connection diagnostics: Acme Okta",
    });
    expect(
      within(dialog).getByRole("region", { name: "Scheduled polling" }),
    ).toHaveTextContent(CONNECTOR_HEALTH_NO_EVENTS_YET);
    const lastAttempt: HTMLElement = within(dialog).getAllByText(
      "2026-09-10 11:59:00 UTC",
    )[0] as HTMLElement;
    expect(lastAttempt.getAttribute("title")).toMatch(/^Local time: /);
    expect(API.post).not.toHaveBeenCalled();
  });

  /*
   * stale-report-after-failed-rerun: Diagnostics kept the previous
   * checklist when a later Test connection request failed.
   */
  test("Diagnostics Test connection clears the previous checklist when a re-run fails", async (): Promise<void> => {
    renderTable([connection()]);

    fireEvent.click(within(row()).getByRole("button", { name: "Diagnostics" }));
    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: "Connection diagnostics: Acme Okta",
    });
    const checks: HTMLElement = within(dialog).getByRole("region", {
      name: "On-demand checks",
    });

    fireEvent.click(
      within(checks).getByRole("button", { name: "Test connection" }),
    );
    expect(
      await within(checks).findByText("Passed with warnings"),
    ).toBeVisible();

    jest
      .mocked(API.post)
      .mockResolvedValue(
        new HTTPErrorResponse(
          502,
          { message: "The API could not reach Okta." },
          {},
        ),
      );
    fireEvent.click(
      within(checks).getByRole("button", { name: "Test connection" }),
    );

    expect(
      await within(checks).findByText("The API could not reach Okta."),
    ).toBeVisible();
    expect(
      within(checks).queryByText("Passed with warnings"),
    ).not.toBeInTheDocument();
    expect(
      within(checks).queryByRole("region", { name: "Connection test report" }),
    ).not.toBeInTheDocument();
  });

  test("Edit and Update credentials open the form modal in the matching mode", async (): Promise<void> => {
    renderTable([connection()]);

    fireEvent.click(within(row()).getByRole("button", { name: "Edit" }));
    const edit: HTMLElement = await screen.findByRole("dialog", {
      name: "Edit connection: Acme Okta",
    });
    expect(within(edit).getByLabelText(/^Okta organization URL/)).toHaveValue(
      "https://acme.okta.com",
    );
    fireEvent.click(within(edit).getAllByRole("button", { name: "Close" })[0]!);
    await waitFor((): void => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    fireEvent.click(
      within(row()).getByRole("button", { name: "Update credentials" }),
    );
    const credentials: HTMLElement = await screen.findByRole("dialog", {
      name: "Update credentials: Acme Okta",
    });
    expect(within(credentials).getByLabelText(/^API token/)).toHaveAttribute(
      "placeholder",
      "Unchanged",
    );
    expect(
      within(credentials).queryByLabelText(/^Okta organization URL/),
    ).not.toBeInTheDocument();
  });
});

/*
 * A window that cannot be read in one poll no longer pins polling (review
 * findings bound-hit-window-never-advances and
 * alerts-view-budget-pins-cursor-forever). The poller records what it did
 * in chunkMinutes, nextChunkMinutes and forcedAdvance; run details must say
 * it plainly, and a forced advance must name the range to import.
 */
describe("run details for a window one poll could not read", () => {
  function run(
    overrides: Partial<SecurityEventConnectionRunResult>,
    type: SecurityEventConnectionRun["type"] = "poll",
  ): SecurityEventConnectionRun {
    const value: SecurityEventConnectionRun = new SecurityEventConnectionRun();
    value._id = "77777777-7777-4777-8777-777777777777";
    value.securityEventConnectionId = new ObjectID(CONNECTION_ID);
    value.type = type;
    value.status = overrides.status || "partial";
    value.startedAt = new Date("2026-09-10T12:00:00Z");
    value.completedAt = new Date("2026-09-10T12:00:05Z");
    value.result = pollResult({
      type: type || "poll",
      provider: SecurityEventConnectorProvider.AwsSecurityHub,
      status: "partial",
      complete: false,
      windowStart: "2026-09-10T11:29:00Z",
      windowEnd: "2026-09-10T12:00:00Z",
      ...overrides,
    }) as unknown as JSONObject;
    return value;
  }

  function renderRun(value: SecurityEventConnectionRun): HTMLElement {
    render(
      <MemoryRouter>
        <SecurityEventConnectionRunDetails run={value} />
      </MemoryRouter>,
    );
    return screen.getByRole("region", { name: "Run details" });
  }

  afterEach((): void => {
    cleanup();
  });

  test("a forced advance is an alert naming the minute to import", (): void => {
    const details: HTMLElement = renderRun(
      run({
        chunkMinutes: 1,
        nextChunkMinutes: 1,
        forcedAdvance: true,
        warnings: [
          "More records were created in the one minute from 2026-09-10T11:59:00.000Z to 2026-09-10T12:00:00.000Z than one poll can read.",
        ],
      }),
    );

    const alert: HTMLElement = within(details)
      .getAllByRole("alert")
      .find((element: HTMLElement): boolean => {
        return /Polling moved past one minute/.test(element.textContent || "");
      }) as HTMLElement;
    expect(alert).toBeVisible();
    expect(alert).toHaveTextContent(
      "More findings were created in one minute than one poll can read.",
    );
    expect(alert).toHaveTextContent(
      "use Import this time range under Find historical findings for 2026-09-10 11:59:00 UTC → 2026-09-10 12:00:00 UTC",
    );
    expect(details).toHaveTextContent("Window read by this poll1 minute");
    // The specific notice replaces the generic "did not finish" line.
    expect(details).not.toHaveTextContent("did not finish processing");
    // The poller's own warning is still listed verbatim.
    expect(details).toHaveTextContent(
      "More records were created in the one minute from",
    );
  });

  test("a narrowed window says the next poll reads a shorter window from the same start", (): void => {
    const details: HTMLElement = renderRun(
      run({ chunkMinutes: 1440, nextChunkMinutes: 720 }),
    );

    expect(details).toHaveTextContent("Window read by this poll24 hours");
    expect(details).toHaveTextContent(
      "Next scheduled poll readsUp to 12 hours",
    );
    expect(details).toHaveTextContent(
      "The next scheduled poll reads a window of 12 hours from the same starting point",
    );
    expect(details).not.toHaveTextContent("Polling moved past one minute");
    expect(details).not.toHaveTextContent("moved the cursor to the last");
  });

  test("a resumed window says the cursor moved to the last record read", (): void => {
    const details: HTMLElement = renderRun(
      run({ chunkMinutes: 60, nextChunkMinutes: 60 }),
    );

    expect(details).toHaveTextContent("1 hour, the same length");
    expect(details).toHaveTextContent(
      "moved the cursor to the last finding it read. The next scheduled poll continues from there with a window of 1 hour.",
    );
    expect(details).not.toHaveTextContent("from the same starting point");
  });

  test("a complete poll widens the next window without any alert", (): void => {
    const details: HTMLElement = renderRun(
      run({
        status: "success",
        complete: true,
        chunkMinutes: 30,
        nextChunkMinutes: 60,
      }),
    );

    expect(details).toHaveTextContent("Next scheduled poll readsUp to 1 hour");
    expect(within(details).queryAllByRole("alert")).toHaveLength(0);
  });

  test("a failed poll keeps its window and raises no volume notice", (): void => {
    const details: HTMLElement = renderRun(
      run({
        status: "failed",
        chunkMinutes: 30,
        nextChunkMinutes: 30,
        error: "AWS Security Hub request failed (HTTP 503)",
      }),
    );

    expect(details).toHaveTextContent(
      "A failed poll does not change the window",
    );
    expect(details).not.toHaveTextContent("moved the cursor to the last");
    // A failure is not a volume signal: no narrowing notice.
    expect(details).not.toHaveTextContent("reads a window of");
    expect(details).not.toHaveTextContent("than one poll can read");
  });

  test("runs without window fields keep the generic notice, with range advice for imports", (): void => {
    const details: HTMLElement = renderRun(run({}, "backfill"));

    expect(details).toHaveTextContent(
      "This run did not finish processing every record in the window. Choose a shorter time range to read the rest",
    );
    expect(
      within(details).queryByTestId("poll-window-progress"),
    ).not.toBeInTheDocument();
  });
});

describe("Google SecOps page test action", () => {
  function googleConnection(): GoogleSecOpsConnection {
    const value: GoogleSecOpsConnection = new GoogleSecOpsConnection();
    value._id = GOOGLE_ID;
    value.projectId = PROJECT_ID;
    value.name = "Customer SecOps";
    value.isEnabled = true;
    value.pollIntervalInMinutes = 5;
    value.createdAt = new Date(NOW - 60 * 60_000);
    value.lastPolledAt = new Date(NOW - 60_000);
    value.lastPollResult = {
      ...pollResult(),
      includeNonAlertingDetections: false,
    } as unknown as JSONObject;
    return value;
  }

  beforeEach((): void => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    mockRows.clear();
    mockTableProps.clear();
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
    jest
      .spyOn(ModelAPI, "getCommonHeaders")
      .mockReturnValue({ "project-id": PROJECT_ID.toString() });
    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse(
          200,
          report("google-secops") as unknown as JSONObject,
          {},
        ),
      );
  });

  afterEach((): void => {
    cleanup();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("renders the generic table above the Google table and tests a Google row synchronously", async (): Promise<void> => {
    mockRows.set("GoogleSecOpsConnection", [googleConnection()]);
    const project: Project = new Project();
    project.id = PROJECT_ID;
    await act(async (): Promise<void> => {
      render(
        <MemoryRouter>
          <GoogleSecOpsConnectionsPage
            pageRoute={new Route("/dashboard/security-events/connections")}
            currentProject={project}
            hasPaymentMethod={true}
          />
        </MemoryRouter>,
      );
    });

    const tables: Array<HTMLElement> = screen.getAllByRole("table");
    expect(
      tables.map((table: HTMLElement): string | null => {
        return table.getAttribute("aria-label");
      }),
    ).toEqual(["Security Event Connections", "Google SecOps Connections"]);

    const googleRow: HTMLElement = screen.getByTestId("Customer SecOps");
    expect(googleRow).toHaveTextContent(CONNECTOR_HEALTH_NO_EVENTS_YET);

    fireEvent.click(
      within(googleRow).getByRole("button", { name: "Test connection" }),
    );
    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: "Test connection: Customer SecOps",
    });
    expect(
      await within(dialog).findByText("Passed with warnings"),
    ).toBeVisible();
    expect(dialog).toHaveTextContent("Access to Google SecOps");
    expect(API.post).toHaveBeenCalledTimes(1);
    expect(postCall()["data"]).toEqual({ connectionId: GOOGLE_ID });
    expect(new globalThis.URL(String(postCall()["url"])).pathname).toMatch(
      /\/google-secops-connection\/test$/,
    );
  });

  test("the unsaved-settings body sends the pasted key, or the id when editing without one", (): void => {
    expect(
      googleSecOpsTestBody({
        region: " us ",
        instanceResourceName: "projects/p/locations/us/instances/i",
        serviceAccountJson: '{"client_email":"a@b"}',
        includeNonAlertingDetections: true,
      }),
    ).toEqual({
      region: "us",
      instanceResourceName: "projects/p/locations/us/instances/i",
      serviceAccountJson: '{"client_email":"a@b"}',
      includeNonAlertingDetections: true,
    });

    expect(
      googleSecOpsTestBody({
        _id: GOOGLE_ID,
        region: "europe",
        instanceResourceName: "projects/p/locations/europe/instances/i",
        serviceAccountJson: "",
      }),
    ).toEqual({
      connectionId: GOOGLE_ID,
      region: "europe",
      instanceResourceName: "projects/p/locations/europe/instances/i",
      includeNonAlertingDetections: false,
    });

    expect((): void => {
      googleSecOpsTestBody({ region: "us" });
    }).toThrow(GOOGLE_SECOPS_TEST_NEEDS_KEY_MESSAGE);
  });
});

describe("connection health vocabulary", () => {
  test("a succeeding poll that never imported reads as polling, not success", (): void => {
    const item: SecurityEventConnection = connection();
    expect(connectorHealth(item, NOW)).toBe(CONNECTOR_HEALTH_NO_EVENTS_YET);

    item.lastEventIngestedAt = new Date(NOW - 30_000);
    expect(connectorHealth(item, NOW)).toBe(CONNECTOR_HEALTH_SUCCEEDED);
  });

  test("mirrors the Google decision tree for every other state", (): void => {
    const item: SecurityEventConnection = connection({
      lastPolledAt: undefined,
      lastSuccessfulPollAt: undefined,
      lastPollResult: undefined,
      createdAt: new Date(NOW - 60_000),
    });
    expect(connectorHealth(item, NOW)).toBe("Waiting for first poll");
    item.lastPolledAt = new Date(NOW - 60_000);
    expect(connectorHealth(item, NOW)).toBe("Details unavailable");
    item.lastPollResult = pollResult({
      status: "empty",
      windowEnd: "2026-09-10T12:00:00Z",
    }) as unknown as JSONObject;
    expect(connectorHealth(item, NOW)).toBe("No records returned");
    item.lastError = "Permission denied";
    expect(connectorHealth(item, NOW)).toBe("Last poll failed");
    item.lastPolledAt = new Date(NOW - 8 * 60_000);
    expect(connectorHealth(item, NOW)).toBe("Poll overdue");
    item.isEnabled = false;
    expect(connectorHealth(item, NOW)).toBe("Schedule paused");
  });

  test("Google SecOps applies the same rule to its own success state", (): void => {
    const item: GoogleSecOpsConnection = new GoogleSecOpsConnection();
    item._id = GOOGLE_ID;
    item.isEnabled = true;
    item.pollIntervalInMinutes = 5;
    item.createdAt = new Date(NOW - 60 * 60_000);
    item.lastPolledAt = new Date(NOW - 60_000);
    const result: GoogleSecOpsRunResult = {
      ...pollResult(),
      includeNonAlertingDetections: false,
    } as unknown as GoogleSecOpsRunResult;
    item.lastPollResult = result as unknown as JSONObject;

    expect(googleSecOpsHealth(item, NOW)).toBe(CONNECTOR_HEALTH_NO_EVENTS_YET);
    item.lastEventIngestedAt = new Date(NOW - 30_000);
    expect(googleSecOpsHealth(item, NOW)).toBe(CONNECTOR_HEALTH_SUCCEEDED);
  });
});
