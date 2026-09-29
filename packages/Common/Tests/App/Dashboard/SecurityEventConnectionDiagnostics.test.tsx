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
import React from "react";
import { MemoryRouter } from "react-router-dom";
import SecurityEventConnectionDiagnostics from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionDiagnostics";
import SecurityEventConnectionRunDetails from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionRunDetails";
import {
  ConnectorProviderDetailGroup,
  connectionEventAttributeKey,
  connectionEventsRoute,
  connectorHealth,
  connectorProviderDetailGroups,
  connectorProviderTitle,
  connectorSampleEventTime,
  connectorSampleTitle,
  connectorScopeImportNoun,
  connectorScopeLabel,
  connectorScopeSummary,
  normalizeConnectorCheckStatus,
  readConnectorProviderDetails,
  validateConnectionRange,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionDiagnosticsUtil";
import { readSecurityEventsTimeRange } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsTimeRange";
import { RouteUtil } from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectionRun from "../../../Models/DatabaseModels/SecurityEventConnectionRun";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityConnectorSample,
  SecurityConnectorTestReport,
} from "../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import {
  LEGACY_GOOGLE_SECOPS_CONNECTION_ID_ATTRIBUTE,
  SECURITY_CONNECTION_ID_ATTRIBUTE,
  SecurityEventConnectionRunResult,
  SecurityEventConnectionRunStatus,
  SecurityEventConnectionRunType,
} from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

/*
 * The diagnostics modal, run details and their util, driven by a Google
 * SecOps connection. Most cases are ported from the retired
 * GoogleSecOpsDiagnostics suite, which pinned the same behaviour on the
 * Google-only copies of these components; the rest pin what the merge
 * added: catalog-driven wording (Data to import, Preview detections), the
 * provider diagnostics and alert flag a SecOps run reports, and run history
 * carried over from the retired connector (no provider, legacy sample and
 * check shapes, and events stamped with the legacy connection attribute).
 */

const GOOGLE: string = SecurityEventConnectorProvider.GoogleSecOps;
const OKTA: string = SecurityEventConnectorProvider.OktaSystemLog;
const CONNECTION_ID: string = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const RUN_ID: string = "33333333-3333-4333-8333-333333333333";
const NOW: number = new Date("2026-09-10T12:00:00Z").getTime();

type SecurityEventConnectionOverrides = {
  [Key in keyof SecurityEventConnection]?:
    | SecurityEventConnection[Key]
    | undefined;
};

function connection(
  overrides: SecurityEventConnectionOverrides = {},
): SecurityEventConnection {
  const value: SecurityEventConnection = new SecurityEventConnection();
  value._id = CONNECTION_ID;
  value.projectId = new ObjectID(PROJECT_ID);
  value.name = "Customer SecOps";
  value.provider = SecurityEventConnectorProvider.GoogleSecOps;
  value.config = {
    region: "europe",
    instanceResourceName: "projects/acme/locations/europe/instances/i",
  };
  value.isEnabled = true;
  value.pollIntervalInMinutes = 5;
  value.alertingOnly = true;
  value.createdAt = new Date(NOW - 60_000);
  Object.assign(value, overrides);
  return value;
}

function sample(
  overrides: Partial<SecurityConnectorSample> = {},
): SecurityConnectorSample {
  return {
    id: "detection-1",
    title: "Successful brute force",
    severity: "High",
    eventTime: "2026-09-09T01:30:30Z",
    createdTime: "2026-09-10T04:16:58.612Z",
    isAlert: true,
    ...overrides,
  };
}

function result(
  overrides: Partial<SecurityEventConnectionRunResult> = {},
): SecurityEventConnectionRunResult {
  return {
    type: "poll",
    provider: GOOGLE,
    status: "success",
    startedAt: "2026-09-10T11:59:00Z",
    completedAt: "2026-09-10T12:00:00Z",
    durationMs: 60000,
    windowStart: "2026-09-10T04:00:00Z",
    windowEnd: "2026-09-10T05:00:00Z",
    fetchedCount: 1,
    ingestedCount: 1,
    duplicateCount: 0,
    rejectedCount: 0,
    failedCount: 0,
    complete: true,
    requestCount: 1,
    warnings: [],
    samples: [sample()],
    checks: [
      {
        key: "read-rule-detections",
        name: "Read rule detections by created time",
        status: "pass",
        durationMs: 500,
        message: "Detection read access verified.",
      },
    ],
    eventTimeStart: "2026-09-09T01:30:30Z",
    eventTimeEnd: "2026-09-09T01:30:30Z",
    ...overrides,
  };
}

// What a synchronous Test connection stores as its run's result.
function testReport(
  overrides: Partial<SecurityConnectorTestReport> = {},
): SecurityConnectorTestReport {
  return {
    provider: GOOGLE,
    status: "pass",
    startedAt: "2026-09-10T11:59:58.000Z",
    completedAt: "2026-09-10T12:00:00.000Z",
    durationMs: 2000,
    checks: [
      {
        key: "authentication",
        name: "Authenticate with Google",
        status: "pass",
        durationMs: 300,
        message: "Google accepted the service account credentials.",
      },
      {
        key: "worker-consumers",
        name: "Background workers",
        status: "pass",
        durationMs: 10,
        message: "2 worker processes are consuming the queue.",
      },
    ],
    summary: "Google SecOps is reachable, credentials are accepted.",
    ...overrides,
  };
}

function testRequestUrls(): Array<string> {
  return jest
    .mocked(API.post)
    .mock.calls.map((call: Array<unknown>): string => {
      return String((call[0] as { url: unknown }).url);
    });
}

function run(
  status: SecurityEventConnectionRunStatus = "success",
  type: SecurityEventConnectionRunType = "poll",
  value?: SecurityEventConnectionRunResult | JSONObject,
): SecurityEventConnectionRun {
  const model: SecurityEventConnectionRun = new SecurityEventConnectionRun();
  model._id = RUN_ID;
  model.securityEventConnectionId = new ObjectID(CONNECTION_ID);
  model.type = type;
  model.status = status;
  model.createdAt = new Date(NOW - 60_000);
  model.requestedByUserId = new ObjectID(PROJECT_ID);
  if (status !== "queued" && status !== "running") {
    model.startedAt = new Date(NOW - 60_000);
    model.completedAt = new Date(NOW);
    model.result = (value || result({ type, status })) as unknown as JSONObject;
  }
  return model;
}

function history(
  data: Array<SecurityEventConnectionRun>,
): ListResult<SecurityEventConnectionRun> {
  return { data, count: data.length, skip: 0, limit: 20 };
}

function renderDiagnostics(
  data: {
    canRun?: boolean;
    initialAction?: "test" | "poll";
    item?: SecurityEventConnection;
  } = {},
): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <SecurityEventConnectionDiagnostics
        connection={data.item || connection()}
        canRun={data.canRun ?? true}
        initialAction={data.initialAction}
        onClose={(): void => {}}
        onUpdated={(): void => {}}
      />
    </MemoryRouter>,
  );
}

function renderRun(
  value: SecurityEventConnectionRun,
  provider?: string,
): HTMLElement {
  render(
    <MemoryRouter>
      <SecurityEventConnectionRunDetails run={value} provider={provider} />
    </MemoryRouter>,
  );
  return screen.getByRole("region", { name: "Run details" });
}

function scheduledPolling(): HTMLElement {
  return screen.getByRole("region", { name: "Scheduled polling" });
}

function eventsParams(route: Route): URLSearchParams {
  const text: string = route.toString();
  return new URLSearchParams(text.slice(text.indexOf("?")));
}

/*
 * The chips the link opens the events explorer with, re-shaped as
 * `{ attributes: { key: value } }` — the reading these assertions have always
 * used.
 *
 * The link's grammar is the explorers' own `filters` param
 * (`[["attributes.<key>", "<value>"], ...]`); it used to be the model
 * table's serialized column filter, which went away with the table. Anything
 * the explorer does not express as an attribute chip is left out, so an
 * assertion that a key is absent still means "the link does not filter on
 * it".
 */
function eventsFilter(route: Route): JSONObject {
  const raw: string | null = eventsParams(route).get("filters");

  if (!raw) {
    return {};
  }

  const attributes: JSONObject = {};

  for (const pair of JSON.parse(raw) as Array<[string, string]>) {
    if (!Array.isArray(pair) || !pair[0]?.startsWith("attributes.")) {
      continue;
    }

    attributes[pair[0].substring("attributes.".length)] = pair[1];
  }

  return Object.keys(attributes).length > 0 ? { attributes } : {};
}

/*
 * The window the link opens. It rides on the page's own range params (the
 * window the Security Events range picker, volume chart and table share), and
 * is read back here the way the page reads it.
 */
function eventsRange(route: Route): [string, string] {
  const range: RangeStartAndEndDateTime = readSecurityEventsTimeRange(
    `?${eventsParams(route).toString()}`,
  );
  expect(range.range).toBe(TimeRange.CUSTOM);
  expect(range.startAndEndDate).toBeInstanceOf(InBetween);
  return [
    new Date(range.startAndEndDate!.startValue).toISOString(),
    new Date(range.startAndEndDate!.endValue).toISOString(),
  ];
}

describe("SecurityEventConnectionDiagnostics for a Google SecOps connection", () => {
  beforeEach((): void => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    jest.spyOn(ModelAPI, "getList").mockResolvedValue(history([]));
    jest.spyOn(ModelAPI, "getItem").mockResolvedValue(connection());
    jest
      .spyOn(ModelAPI, "getCommonHeaders")
      .mockReturnValue({ "project-id": PROJECT_ID });
    jest
      .spyOn(API, "post")
      .mockResolvedValue(new HTTPResponse(200, { runId: RUN_ID }, {}));
    jest
      .spyOn(RouteUtil, "populateRouteParams")
      .mockImplementation((): Route => {
        /*
         * A fresh Route per call: addQueryParams mutates the Route it is
         * given, so a shared instance would carry one link's query into the
         * next.
         */
        return new Route(`/dashboard/${PROJECT_ID}/security-events`);
      });
  });

  afterEach((): void => {
    cleanup();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test("loads tenant-scoped history and never requests credentials", async (): Promise<void> => {
    renderDiagnostics();
    expect(screen.getByText("Loading run history…")).toBeInTheDocument();
    expect(await screen.findByText(/No runs recorded yet/)).toBeInTheDocument();
    expect(ModelAPI.getList).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: SecurityEventConnectionRun,
        query: {
          projectId: new ObjectID(PROJECT_ID),
          securityEventConnectionId: new ObjectID(CONNECTION_ID),
        },
        limit: 20,
        skip: 0,
      }),
    );
    expect(ModelAPI.getItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: new ObjectID(CONNECTION_ID) }),
    );
    expect(
      jest.mocked(ModelAPI.getItem).mock.calls[0]?.[0].select,
    ).not.toHaveProperty("secrets");
    expect(
      jest.mocked(ModelAPI.getItem).mock.calls[0]?.[0].select,
    ).toHaveProperty("alertingOnly", true);
    expect(API.post).not.toHaveBeenCalled();
  });

  /*
   * google-diagnostics-test-still-queued: Test connection used to POST
   * /:id/run and wait for a worker. It calls the synchronous endpoint and
   * renders the checklist inline.
   */
  test("runs the synchronous connection test and renders its checklist inline", async (): Promise<void> => {
    jest
      .mocked(API.post)
      .mockResolvedValue(
        new HTTPResponse(200, testReport() as unknown as JSONObject, {}),
      );
    renderDiagnostics();
    await screen.findByText(/No runs recorded yet/);
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    const report: HTMLElement = await screen.findByRole("region", {
      name: "Connection test report",
    });
    expect(within(report).getByText("All checks passed")).toBeVisible();
    expect(within(report).getByText("Background workers")).toBeVisible();
    expect(report).toHaveTextContent("Access to Google SecOps");
    expect(API.post).toHaveBeenCalledTimes(1);
    expect(API.post).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { connectionId: CONNECTION_ID },
        headers: { "project-id": PROJECT_ID },
      }),
    );
    expect(testRequestUrls()[0]).toContain("/security-event-connection/test");
    expect(testRequestUrls()[0]).not.toContain("/run");
    expect(testRequestUrls()[0]).not.toContain("google-secops-connection");
    expect(
      screen.getByText(/It runs immediately and imports nothing/),
    ).toBeVisible();
  });

  test("Test connection stays available while a queued run waits for a worker", async (): Promise<void> => {
    jest.mocked(ModelAPI.getList).mockResolvedValue(history([run("queued")]));
    jest.mocked(API.post).mockResolvedValue(
      new HTTPResponse(
        200,
        testReport({
          status: "fail",
          summary: "1 check failed: Background workers.",
        }) as unknown as JSONObject,
        {},
      ),
    );
    renderDiagnostics();
    expect(
      await screen.findByText(/Queued — waiting for a worker/),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Run now" })).toBeDisabled();
    const testButton: HTMLElement = screen.getByRole("button", {
      name: "Test connection",
    });
    expect(testButton).toBeEnabled();
    fireEvent.click(testButton);
    expect(await screen.findByText("Some checks failed")).toBeVisible();
    expect(testRequestUrls()).toEqual([
      expect.stringContaining("/security-event-connection/test"),
    ]);
  });

  test("a failed re-run clears the previous report instead of showing it beside the error", async (): Promise<void> => {
    jest
      .mocked(API.post)
      .mockResolvedValueOnce(
        new HTTPResponse(200, testReport() as unknown as JSONObject, {}),
      )
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          500,
          { message: "Test endpoint unavailable." },
          {},
        ),
      );
    renderDiagnostics();
    await screen.findByText(/No runs recorded yet/);
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("All checks passed")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/Test endpoint unavailable/)).toBeVisible();
    expect(screen.queryByText("All checks passed")).not.toBeInTheDocument();
  });

  test("an initial test action runs the synchronous test once", async (): Promise<void> => {
    jest
      .mocked(API.post)
      .mockResolvedValue(
        new HTTPResponse(200, testReport() as unknown as JSONObject, {}),
      );
    renderDiagnostics({ initialAction: "test" });
    expect(await screen.findByText("All checks passed")).toBeVisible();
    await act(async (): Promise<void> => {
      jest.advanceTimersByTime(15000);
    });
    expect(testRequestUrls()).toEqual([
      expect.stringContaining("/security-event-connection/test"),
    ]);
  });

  test("the copy speaks in detections and the Data to import control", async (): Promise<void> => {
    renderDiagnostics();
    await screen.findByText(/No runs recorded yet/);

    const scheduled: HTMLElement = scheduledPolling();
    const scopeLabel: HTMLElement =
      within(scheduled).getByText("Data to import");
    expect(scopeLabel.tagName).toBe("DT");
    expect(scopeLabel.parentElement).toHaveTextContent(
      "Data to importAlerts only",
    );
    expect(within(scheduled).queryByText("Scope")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /To import detections too, select Detections under Data to import using Edit connection\./,
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(/Change settings using Edit connection/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /what it has available to import with and without Detections, and whether/,
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Find historical detections" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        /When Last Error says polling moved past a minute it could not read in full, import that minute here to recover what one run can read\./,
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Preview detections" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Preview records" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/15 minutes/)).not.toBeInTheDocument();
  });

  test("a connection importing Detections too reads as Alerts and detections", async (): Promise<void> => {
    const allDetections: SecurityEventConnection = connection({
      alertingOnly: false,
    });
    jest.mocked(ModelAPI.getItem).mockResolvedValue(allDetections);
    renderDiagnostics({ item: allDetections });
    await screen.findByText(/No runs recorded yet/);

    expect(
      within(scheduledPolling()).getByText("Data to import").parentElement,
    ).toHaveTextContent("Data to importAlerts and detections");
  });

  test("a provider without an alerting distinction keeps the generic wording in its own record name", async (): Promise<void> => {
    const okta: SecurityEventConnection = connection({
      name: "Acme Okta",
      provider: SecurityEventConnectorProvider.OktaSystemLog,
      config: { orgUrl: "https://acme.okta.com" },
    });
    jest.mocked(ModelAPI.getItem).mockResolvedValue(okta);
    renderDiagnostics({ item: okta });
    await screen.findByText(/No runs recorded yet/);

    expect(
      screen.getByText(/Change settings using Edit connection\./),
    ).toBeVisible();
    expect(
      within(scheduledPolling()).queryByText("Data to import"),
    ).not.toBeInTheDocument();
    expect(
      within(scheduledPolling()).queryByText("Scope"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/with and without/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Preview log events" }),
    ).toBeVisible();
    // The forced-advance recovery path is not provider-specific.
    expect(screen.getByText(/import that minute here/)).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Import this time range" }),
    );
    expect(
      screen.getByRole("group", { name: "Confirm historical import" }),
    ).toHaveTextContent("Import log events from");
  });

  test("Run now is available for paused schedules and sends a poll request", async (): Promise<void> => {
    const paused: SecurityEventConnection = connection({ isEnabled: false });
    jest.mocked(ModelAPI.getItem).mockResolvedValue(paused);
    renderDiagnostics({ item: paused });
    await screen.findByText(/No runs recorded yet/);
    expect(screen.getByText(/Schedule paused/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    await waitFor((): void => {
      expect(API.post).toHaveBeenCalledWith(
        expect.objectContaining({ data: { type: "poll" } }),
      );
    });
    expect(testRequestUrls()[0]).toContain(
      `/security-event-connection/${CONNECTION_ID}/run`,
    );
  });

  test("a direct row action is submitted only once even with refreshes", async (): Promise<void> => {
    jest
      .mocked(ModelAPI.getList)
      .mockResolvedValue(history([run("queued", "poll")]));
    renderDiagnostics({ initialAction: "poll" });
    expect(
      await screen.findByText(/Queued — waiting for a worker/),
    ).toBeVisible();
    await act(async (): Promise<void> => {
      jest.advanceTimersByTime(3000);
    });
    expect(API.post).toHaveBeenCalledTimes(1);
  });

  test("queued and running runs disable duplicate actions and update to completed results", async (): Promise<void> => {
    jest.mocked(ModelAPI.getList).mockResolvedValue(history([run("queued")]));
    renderDiagnostics();
    expect(
      await screen.findByText(/Queued — waiting for a worker/),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Run now" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Preview detections" }),
    ).toBeDisabled();
    jest.mocked(ModelAPI.getList).mockResolvedValue(history([run("running")]));
    await act(async (): Promise<void> => {
      jest.advanceTimersByTime(3000);
    });
    // A running run has no result yet; the connection names the provider.
    expect(
      await screen.findByText(/Running — checking Google SecOps/),
    ).toBeVisible();
    jest.mocked(ModelAPI.getList).mockResolvedValue(history([run()]));
    await act(async (): Promise<void> => {
      jest.advanceTimersByTime(3000);
    });
    expect(await screen.findByText("Result: Success")).toBeVisible();
    expect(screen.getByRole("button", { name: "Run now" })).toBeEnabled();
    expect(screen.getByText("Successful brute force")).toBeVisible();
  });

  test("read-only users can inspect results but cannot start any operation", async (): Promise<void> => {
    jest.mocked(ModelAPI.getList).mockResolvedValue(history([run()]));
    renderDiagnostics({ canRun: false });
    await screen.findByText("Result: Success");
    for (const title of [
      "Test connection",
      "Run now",
      "Preview detections",
      "Import this time range",
    ]) {
      expect(screen.getByRole("button", { name: title })).toBeDisabled();
    }
    fireEvent.click(screen.getByRole("button", { name: "View run" }));
    expect(screen.getByRole("region", { name: "Run details" })).toBeVisible();
    expect(API.post).not.toHaveBeenCalled();
  });

  test("a selected run leaving the recent history does not disable actions", async (): Promise<void> => {
    jest.mocked(ModelAPI.getList).mockResolvedValue(history([run()]));
    renderDiagnostics();
    await screen.findByText("Successful brute force");
    const latest: SecurityEventConnectionRun = run(
      "empty",
      "preview",
      result({
        type: "preview",
        status: "empty",
        fetchedCount: 0,
        ingestedCount: 0,
        samples: [],
      }),
    );
    latest._id = "44444444-4444-4444-8444-444444444444";
    jest.mocked(ModelAPI.getList).mockResolvedValue(history([latest]));
    fireEvent.click(screen.getByRole("button", { name: "Refresh history" }));
    expect(
      await screen.findByText("Result: No records returned"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Run now" })).toBeEnabled();
    expect(
      screen.queryByText(/Waiting for the run to appear/),
    ).not.toBeInTheDocument();
  });

  test("previews a selected seven-day range without importing", async (): Promise<void> => {
    renderDiagnostics();
    await screen.findByText(/No runs recorded yet/);
    fireEvent.change(screen.getByLabelText("Time range"), {
      target: { value: "168" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview detections" }));
    await waitFor((): void => {
      expect(API.post).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            type: "preview",
            startTime: "2026-09-03T12:00:00.000Z",
            endTime: "2026-09-10T12:00:00.000Z",
          },
        }),
      );
    });
    expect(API.post).toHaveBeenCalledTimes(1);
  });

  test("historical import requires confirmation for the actual range and scope", async (): Promise<void> => {
    const allDetections: SecurityEventConnection = connection({
      alertingOnly: false,
    });
    jest.mocked(ModelAPI.getItem).mockResolvedValue(allDetections);
    renderDiagnostics({ item: allDetections });
    await screen.findByText(/No runs recorded yet/);
    fireEvent.click(
      screen.getByRole("button", { name: "Import this time range" }),
    );
    const confirmation: HTMLElement = screen.getByRole("group", {
      name: "Confirm historical import",
    });
    expect(confirmation).toHaveTextContent("Import alerts and detections from");
    expect(confirmation).toHaveTextContent("2026-09-09 12:00:00 UTC");
    expect(confirmation).toHaveTextContent(
      "Already imported detections are skipped",
    );
    expect(API.post).not.toHaveBeenCalled();
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Confirm import" }),
    );
    await waitFor((): void => {
      expect(API.post).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            type: "backfill",
            startTime: "2026-09-09T12:00:00.000Z",
            endTime: "2026-09-10T12:00:00.000Z",
          },
        }),
      );
    });
  });

  test("an alerts-only connection confirms importing alerts", async (): Promise<void> => {
    renderDiagnostics();
    await screen.findByText(/No runs recorded yet/);
    fireEvent.click(
      screen.getByRole("button", { name: "Import this time range" }),
    );
    const confirmation: HTMLElement = screen.getByRole("group", {
      name: "Confirm historical import",
    });
    expect(confirmation).toHaveTextContent("Import alerts from");
    expect(confirmation).not.toHaveTextContent("alerts and detections");
  });

  test("changing the selected range cancels a pending import confirmation", async (): Promise<void> => {
    renderDiagnostics();
    await screen.findByText(/No runs recorded yet/);
    fireEvent.click(
      screen.getByRole("button", { name: "Import this time range" }),
    );
    fireEvent.change(screen.getByLabelText("Time range"), {
      target: { value: "1" },
    });
    expect(
      screen.queryByRole("group", { name: "Confirm historical import" }),
    ).not.toBeInTheDocument();
    expect(API.post).not.toHaveBeenCalled();
  });

  test("invalid dates disable preview and import with a specific explanation", async (): Promise<void> => {
    renderDiagnostics();
    await screen.findByText(/No runs recorded yet/);
    fireEvent.change(screen.getByLabelText("Start (your local time)"), {
      target: { value: "" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose a valid start and end time",
    );
    expect(
      screen.getByRole("button", { name: "Preview detections" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Import this time range" }),
    ).toBeDisabled();
    expect(API.post).not.toHaveBeenCalled();
  });

  test("submission failures are visible and retry remains available", async (): Promise<void> => {
    jest
      .mocked(API.post)
      .mockResolvedValue(
        new HTTPErrorResponse(
          400,
          { message: "Another run is already queued for this connection." },
          {},
        ),
      );
    renderDiagnostics();
    await screen.findByText(/No runs recorded yet/);
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    expect(
      await screen.findByText(/Another run is already queued/),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Run now" })).toBeEnabled();
  });

  test("history failures offer refresh and stop polling when the modal unmounts", async (): Promise<void> => {
    jest
      .mocked(ModelAPI.getList)
      .mockRejectedValue(new Error("History unavailable"));
    const view: ReturnType<typeof render> = renderDiagnostics();
    expect(await screen.findByText(/History unavailable/)).toBeVisible();
    jest.mocked(ModelAPI.getList).mockResolvedValue(history([]));
    fireEvent.click(screen.getByRole("button", { name: "Refresh history" }));
    expect(await screen.findByText(/No runs recorded yet/)).toBeVisible();
    const calls: number = jest.mocked(ModelAPI.getList).mock.calls.length;
    view.unmount();
    await act(async (): Promise<void> => {
      jest.advanceTimersByTime(30000);
    });
    expect(ModelAPI.getList).toHaveBeenCalledTimes(calls);
  });

  test("a run carried over without a provider still reads as Google SecOps in the modal", async (): Promise<void> => {
    const migrated: JSONObject = {
      ...(result() as unknown as JSONObject),
    };
    delete migrated["provider"];
    jest
      .mocked(ModelAPI.getList)
      .mockResolvedValue(history([run("success", "poll", migrated)]));
    renderDiagnostics();

    expect(await screen.findByText("Result: Success")).toBeVisible();
    const details: HTMLElement = screen.getByRole("region", {
      name: "Run details",
    });
    expect(details).toHaveTextContent("Returned by Google SecOps");
  });
});

describe("SecurityEventConnectionRunDetails for Google SecOps runs", () => {
  beforeEach((): void => {
    jest
      .spyOn(RouteUtil, "populateRouteParams")
      .mockImplementation((): Route => {
        /*
         * A fresh Route per call: addQueryParams mutates the Route it is
         * given, so a shared instance would carry one link's query into the
         * next.
         */
        return new Route(`/dashboard/${PROJECT_ID}/security-events`);
      });
  });

  afterEach((): void => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("partial and empty results have different guidance and preserve the source dates", (): void => {
    const partial: SecurityEventConnectionRunResult = result({
      status: "partial",
      complete: false,
      ingestedCount: 0,
      rejectedCount: 1,
      warnings: ["One payload could not be normalized."],
    });
    const view: ReturnType<typeof render> = render(
      <MemoryRouter>
        <SecurityEventConnectionRunDetails
          run={run("partial", "poll", partial)}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Result: Partial")).toBeVisible();
    expect(
      screen.getByText(/This run did not finish processing every record/),
    ).toBeVisible();
    expect(
      screen.getByText("One payload could not be normalized."),
    ).toBeVisible();
    expect(screen.getByText("2026-09-09 01:30:30 UTC")).toBeVisible();
    expect(screen.getByText("2026-09-10 04:16:58 UTC")).toBeVisible();
    expect(screen.getByText("Returned by Google SecOps")).toBeVisible();
    view.unmount();

    render(
      <MemoryRouter>
        <SecurityEventConnectionRunDetails
          run={run(
            "empty",
            "preview",
            result({
              type: "preview",
              status: "empty",
              fetchedCount: 0,
              ingestedCount: 0,
              samples: [],
              providerDetails: { includeNonAlertingDetections: false },
            }),
          )}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Result: No records returned")).toBeVisible();
    expect(
      screen.getByText(
        "Google SecOps returned no matching records for this time range. Try a wider range, or use Test connection to see what is available to import. Only alerts are imported with this Data to import selection; select Detections to import the rest.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  test("an empty run that already imported Detections gets no Detections advice", (): void => {
    renderRun(
      run(
        "empty",
        "poll",
        result({
          status: "empty",
          fetchedCount: 0,
          ingestedCount: 0,
          samples: [],
          providerDetails: { includeNonAlertingDetections: true },
        }),
      ),
    );
    expect(
      screen.getByText(/returned no matching records for this time range/),
    ).not.toHaveTextContent("select Detections");
  });

  test.each(["test", "preview"] as Array<SecurityEventConnectionRunType>)(
    "%s reports duplicate detection as not checked",
    (type: SecurityEventConnectionRunType): void => {
      renderRun(run("success", type, result({ type, duplicateCount: 0 })));

      const duplicateCount: HTMLElement | null =
        screen.getByText("Already imported").parentElement;
      expect(duplicateCount).toHaveTextContent("Not checked");
      expect(duplicateCount).not.toHaveTextContent("0");
    },
  );

  test.each(["poll", "backfill"] as Array<SecurityEventConnectionRunType>)(
    "%s reports the actual duplicate detection count",
    (type: SecurityEventConnectionRunType): void => {
      renderRun(run("success", type, result({ type, duplicateCount: 7 })));

      const duplicateCount: HTMLElement | null =
        screen.getByText("Already imported").parentElement;
      expect(duplicateCount).toHaveTextContent("7");
      expect(duplicateCount).not.toHaveTextContent("Not checked");
    },
  );

  test("an import failure preserves successful Google read diagnostics without blaming Google", (): void => {
    const failed: SecurityEventConnectionRunResult = result({
      status: "failed",
      complete: false,
      ingestedCount: 0,
      failedCount: 1,
      error: "OneUptime telemetry storage is unavailable.",
      checks: [
        {
          key: "read",
          name: "Read detections from the configured instance",
          status: "pass",
          durationMs: 500,
          message: "Google SecOps detection read succeeded.",
        },
        {
          key: "store",
          name: "Import detections",
          status: "fail",
          durationMs: 500,
          message: "The detection could not be stored in OneUptime.",
          remediation: "Check that the telemetry database is reachable.",
        },
      ],
    });
    renderRun(run("failed", "poll", failed));

    expect(screen.getByText("Result: Failed")).toBeVisible();
    expect(
      screen.getByText(/This run did not finish processing every record/),
    ).toHaveTextContent("Review the checks and warnings before retrying.");
    expect(
      screen.getByText("Read detections from the configured instance: Passed"),
    ).toHaveClass("text-green-700");
    expect(screen.getByText("Import detections: Failed")).toHaveClass(
      "text-red-700",
    );
    expect(
      screen.getByText("Check that the telemetry database is reachable."),
    ).toBeVisible();
    expect(
      screen.getByText("OneUptime telemetry storage is unavailable."),
    ).toBeVisible();
    expect(
      screen.queryByText(/Google did not return a complete result/),
    ).not.toBeInTheDocument();
  });

  /*
   * A failed synchronous test stores its summary as the run error and the
   * checklist as the result. The summary is shown once, in the report
   * banner, never again as a red box above it.
   */
  test("a stored synchronous test report renders as its checklist with its error shown once", (): void => {
    const stored: SecurityEventConnectionRun = run("failed", "test");
    stored.result = testReport({
      status: "fail",
      summary: "1 check failed: Background workers.",
      checks: [
        {
          key: "worker-consumers",
          name: "Background workers",
          status: "fail",
          durationMs: 10,
          message: "No process is consuming the Worker queue.",
          remediation: "Start a worker.",
        },
      ],
    }) as unknown as JSONObject;
    stored.error = "1 check failed: Background workers.";
    const details: HTMLElement = renderRun(stored);

    const report: HTMLElement = screen.getByRole("region", {
      name: "Connection test report",
    });
    expect(within(report).getByText("Some checks failed")).toBeVisible();
    expect(
      within(report).getByText("No process is consuming the Worker queue."),
    ).toBeVisible();
    expect(
      screen.getAllByText("1 check failed: Background workers."),
    ).toHaveLength(1);
    expect(
      within(details).queryByText("1 check failed: Background workers.", {
        selector: 'p[role="alert"]',
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Returned by/)).not.toBeInTheDocument();
  });

  test("a failed run without a report still shows its error, as literal text", (): void => {
    const failed: SecurityEventConnectionRun = run("failed");
    failed.error = "Google rejected access. <script>not markup</script>";
    renderRun(failed);
    expect(screen.getByRole("alert")).toHaveTextContent(failed.error);
    expect(document.querySelector("script")).toBeNull();
  });

  test("a legacy queued test result still renders as a run result", (): void => {
    renderRun(run("success", "test", result({ type: "test" })));
    expect(screen.getByText("Returned by Google SecOps")).toBeVisible();
    expect(
      screen.getByText(
        /does not import events or confirm that scheduled polling is working/,
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("region", { name: "Connection test report" }),
    ).not.toBeInTheDocument();
  });

  test("a forced advance explains the skipped minute and how to recover it", (): void => {
    const details: HTMLElement = renderRun(
      run(
        "partial",
        "poll",
        result({
          status: "partial",
          complete: false,
          chunkMinutes: 1,
          nextChunkMinutes: 1,
          forcedAdvance: true,
          warnings: [
            "More records were created in the one minute from 2026-09-10T04:59:00.000Z to 2026-09-10T05:00:00.000Z than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.",
          ],
          checks: [
            {
              key: "read-rule-detections",
              name: "Read rule detections by created time",
              status: "warn",
              durationMs: 500,
              message: "stopped by the request budget after 20 requests",
            },
          ],
        }),
      ),
    );

    /*
     * Hoisted: eslint's wrap-regex and prettier disagree about an inline
     * literal followed by .test().
     */
    const pollingMovedPast: RegExp = /Polling moved past one minute/;
    const alert: HTMLElement = within(details)
      .getAllByRole("alert")
      .find((element: HTMLElement): boolean => {
        return pollingMovedPast.test(element.textContent || "");
      }) as HTMLElement;
    expect(alert).toHaveTextContent(
      "More detections were created in one minute than one poll can read.",
    );
    expect(alert).toHaveTextContent(
      "use Import this time range under Find historical detections for 2026-09-10 04:59:00 UTC → 2026-09-10 05:00:00 UTC",
    );
    expect(details).toHaveTextContent("Window read by this poll1 minute");
    expect(details).not.toHaveTextContent("did not finish processing");
    expect(
      screen.getByText("Read rule detections by created time: Warning"),
    ).toHaveClass("text-amber-700");
  });

  test("a narrowed partial poll says the next poll re-reads a shorter window", (): void => {
    const details: HTMLElement = renderRun(
      run(
        "partial",
        "poll",
        result({
          status: "partial",
          complete: false,
          chunkMinutes: 1440,
          nextChunkMinutes: 720,
          warnings: [
            "This window holds more records than one poll can read; the next poll reads a 720 minute window from the same starting point.",
          ],
        }),
      ),
    );
    expect(details).toHaveTextContent(
      "This window held more detections than one poll can read, so the cursor stayed where it was. The next scheduled poll reads a window of 12 hours from the same starting point",
    );
    expect(details).toHaveTextContent("Window read by this poll24 hours");
    expect(details).not.toHaveTextContent("Polling moved past one minute");
  });

  test("provider details show the basis, per-pass counts and creation lag, and the scope as Data to import", (): void => {
    const details: HTMLElement = renderRun(
      run(
        "success",
        "poll",
        result({
          providerDetails: {
            basis: "created-time",
            sourceCounts: {
              ruleDetections: 12,
              curatedDetections: 3,
              alertsView: 4,
            },
            creationLag: { measured: 18, lateCount: 2, maxLagMinutes: 95 },
            includeNonAlertingDetections: false,
          },
        }),
      ),
    );

    const provider: HTMLElement = within(details).getByRole("region", {
      name: "Provider details",
    });
    const detail: (key: string) => Element | null = (
      key: string,
    ): Element | null => {
      return provider.querySelector(`[data-detail-key="${key}"]`);
    };
    expect(detail("basis")).toHaveTextContent("Time basis readCreated time");
    expect(within(provider).getByText("Returned by each pass")).toBeVisible();
    expect(detail("sourceCounts.ruleDetections")).toHaveTextContent(
      "Rule detections12",
    );
    expect(detail("sourceCounts.curatedDetections")).toHaveTextContent(
      "Curated rule detections3",
    );
    expect(detail("sourceCounts.alertsView")).toHaveTextContent("Alerts view4");
    expect(within(provider).getByText("Creation lag")).toBeVisible();
    expect(detail("creationLag.measured")).toHaveTextContent(
      "Records measured18",
    );
    expect(detail("creationLag.lateCount")).toHaveTextContent(
      "Created later than the poll interval2",
    );
    expect(detail("creationLag.maxLagMinutes")).toHaveTextContent(
      "Longest lag (minutes)95",
    );
    // The scope is its own line in the provider's words, not a raw detail.
    expect(provider).not.toHaveTextContent("Includes non-alerting records");
    expect(detail("includeNonAlertingDetections")).toBeNull();
    expect(
      within(details).getByText("Data to import").parentElement,
    ).toHaveTextContent("Data to importAlerts only");
  });

  test("a preview read by detection time with Detections included says so", (): void => {
    const details: HTMLElement = renderRun(
      run(
        "success",
        "preview",
        result({
          type: "preview",
          providerDetails: {
            basis: "detection-time",
            includeNonAlertingDetections: true,
          },
        }),
      ),
    );

    expect(
      within(details).getByRole("region", { name: "Provider details" }),
    ).toHaveTextContent(
      "Time basis readDetection time, with created time also read",
    );
    expect(
      within(details).getByText("Data to import").parentElement,
    ).toHaveTextContent("Data to importAlerts and detections");
  });

  test("a run without provider details renders neither the section nor a scope line", (): void => {
    const details: HTMLElement = renderRun(run());
    expect(
      within(details).queryByRole("region", { name: "Provider details" }),
    ).not.toBeInTheDocument();
    expect(
      within(details).queryByText("Data to import"),
    ).not.toBeInTheDocument();
  });

  test("a provider without the Data to import control lists every detail it reports", (): void => {
    const details: HTMLElement = renderRun(
      run(
        "success",
        "poll",
        result({
          provider: OKTA,
          providerDetails: {
            includeNonAlertingDetections: false,
            pagesRead: 3,
          },
        }),
      ),
    );

    const provider: HTMLElement = within(details).getByRole("region", {
      name: "Provider details",
    });
    expect(
      provider.querySelector(
        '[data-detail-key="includeNonAlertingDetections"]',
      ),
    ).toHaveTextContent("Includes non-alerting recordsNo");
    expect(
      provider.querySelector('[data-detail-key="pagesRead"]'),
    ).toHaveTextContent("Pages read3");
    expect(
      within(details).queryByText("Data to import"),
    ).not.toBeInTheDocument();
  });

  test("samples get an Alert column only when the source says which records are alerts", (): void => {
    const details: HTMLElement = renderRun(
      run(
        "success",
        "poll",
        result({
          fetchedCount: 3,
          samples: [
            sample({ id: "alert", title: "Alerting rule", isAlert: true }),
            sample({ id: "match", title: "Rule match", isAlert: false }),
            sample({ id: "unknown", title: "Unlabelled", isAlert: undefined }),
          ],
        }),
      ),
    );

    expect(
      within(details).getByRole("columnheader", { name: "Alert" }),
    ).toBeVisible();
    const cells: (title: string) => Array<string> = (
      title: string,
    ): Array<string> => {
      const rowElement: HTMLElement = within(details)
        .getByText(title)
        .closest("tr") as HTMLElement;
      return Array.from(rowElement.querySelectorAll("td")).map(
        (cell: HTMLTableCellElement): string => {
          return cell.textContent || "";
        },
      );
    };
    expect(cells("Alerting rule")[4]).toBe("Yes");
    expect(cells("Rule match")[4]).toBe("No");
    expect(cells("Unlabelled")[4]).toBe("Unknown");
    cleanup();

    const withoutFlag: HTMLElement = renderRun(
      run(
        "success",
        "poll",
        result({
          provider: OKTA,
          samples: [sample({ isAlert: undefined })],
        }),
      ),
    );
    expect(
      within(withoutFlag).queryByRole("columnheader", { name: "Alert" }),
    ).not.toBeInTheDocument();
    expect(
      within(withoutFlag)
        .getAllByRole("columnheader")
        .map((header: HTMLElement): string => {
          return header.textContent || "";
        }),
    ).toEqual([
      "Record",
      "Severity",
      "Event time (UTC)",
      "Created at source (UTC)",
    ]);
  });

  /*
   * Poll history carried over from the retired Google SecOps connector: no
   * provider on the result, the diagnostics at the top level, samples that
   * name the rule and detection time, and success/failed check statuses.
   */
  test("a run carried over from the retired connector renders truthfully", (): void => {
    const legacy: JSONObject = {
      type: "poll",
      status: "success",
      startedAt: "2026-09-10T11:59:00Z",
      completedAt: "2026-09-10T12:00:00Z",
      durationMs: 60000,
      windowStart: "2026-09-10T04:00:00Z",
      windowEnd: "2026-09-10T05:00:00Z",
      includeNonAlertingDetections: true,
      basis: "created-time",
      sourceCounts: { ruleDetections: 2, curatedDetections: 0, alertsView: 1 },
      creationLag: { measured: 2, lateCount: 1, maxLagMinutes: 75 },
      fetchedCount: 2,
      ingestedCount: 2,
      duplicateCount: 0,
      rejectedCount: 0,
      failedCount: 0,
      complete: true,
      requestCount: 3,
      warnings: [],
      samples: [
        {
          id: "legacy-1",
          ruleName: "Legacy brute force rule",
          detectionTime: "2026-09-09T01:30:30Z",
          createdTime: "2026-09-10T04:16:58Z",
          isAlert: false,
        },
      ],
      checks: [
        {
          name: "Read detections",
          status: "success",
          durationMs: 5,
          message: "Read two detections.",
        },
        {
          name: "Import detections",
          status: "failed",
          durationMs: 5,
          message: "One detection was not stored.",
        },
      ],
      eventTimeStart: "2026-09-09T01:30:30Z",
      eventTimeEnd: "2026-09-09T01:30:30Z",
    };
    const details: HTMLElement = renderRun(
      run("success", "poll", legacy),
      GOOGLE,
    );

    expect(details).toHaveTextContent("Returned by Google SecOps");
    expect(
      within(details).getByText("Data to import").parentElement,
    ).toHaveTextContent("Data to importAlerts and detections");
    const provider: HTMLElement = within(details).getByRole("region", {
      name: "Provider details",
    });
    expect(
      provider.querySelector('[data-detail-key="sourceCounts.ruleDetections"]'),
    ).toHaveTextContent("Rule detections2");
    expect(
      provider.querySelector('[data-detail-key="creationLag.maxLagMinutes"]'),
    ).toHaveTextContent("Longest lag (minutes)75");

    const sampleRow: HTMLElement = within(details)
      .getByText("Legacy brute force rule")
      .closest("tr") as HTMLElement;
    expect(sampleRow).toHaveTextContent("2026-09-09 01:30:30 UTC");
    expect(sampleRow).not.toHaveTextContent("Untitled");
    expect(
      Array.from(sampleRow.querySelectorAll("td")).map(
        (cell: HTMLTableCellElement): string => {
          return cell.textContent || "";
        },
      )[4],
    ).toBe("No");

    expect(screen.getByText("Read detections: Passed")).toHaveClass(
      "text-green-700",
    );
    expect(screen.getByText("Import detections: Failed")).toHaveClass(
      "text-red-700",
    );
    expect(
      screen.getByRole("link", { name: "View events in this time range" }),
    ).toBeVisible();

    const filter: JSONObject = eventsFilter(
      connectionEventsRoute(
        legacy as unknown as SecurityEventConnectionRunResult,
        CONNECTION_ID,
      ),
    );
    expect(filter["attributes"]).toEqual({
      [LEGACY_GOOGLE_SECOPS_CONNECTION_ID_ATTRIBUTE]: CONNECTION_ID,
    });
  });
});

describe("View events for a connection run", () => {
  beforeEach((): void => {
    jest
      .spyOn(RouteUtil, "populateRouteParams")
      .mockImplementation((): Route => {
        /*
         * A fresh Route per call: addQueryParams mutates the Route it is
         * given, so a shared instance would carry one link's query into the
         * next.
         */
        return new Route(`/dashboard/${PROJECT_ID}/security-events`);
      });
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test("newly imported events are filtered on the shared connection attribute", (): void => {
    const filter: JSONObject = eventsFilter(
      connectionEventsRoute(result(), CONNECTION_ID),
    );
    expect(filter["attributes"]).toEqual({
      "oneuptime.security_connection.id": CONNECTION_ID,
    });
    expect(SECURITY_CONNECTION_ID_ATTRIBUTE).toBe(
      "oneuptime.security_connection.id",
    );
  });

  /*
   * Events a migrated connection imported before the move carry the retired
   * connector's attribute; its carried-over runs name that key, and the
   * link has to filter on it or it opens an empty table.
   */
  test("a carried-over run filters on the attribute its events were stamped with", (): void => {
    const filter: JSONObject = eventsFilter(
      connectionEventsRoute(
        result({
          eventAttributeKey: LEGACY_GOOGLE_SECOPS_CONNECTION_ID_ATTRIBUTE,
        }),
        CONNECTION_ID,
      ),
    );
    expect(filter["attributes"]).toEqual({
      "oneuptime.google_secops.connection_id": CONNECTION_ID,
    });
    expect(filter["attributes"]).not.toHaveProperty(
      SECURITY_CONNECTION_ID_ATTRIBUTE,
    );
  });

  test("the attribute key: named, recognisably legacy, or the shared default", (): void => {
    expect(connectionEventAttributeKey(result())).toBe(
      SECURITY_CONNECTION_ID_ATTRIBUTE,
    );
    expect(
      connectionEventAttributeKey(
        result({ eventAttributeKey: "custom.connection.id" }),
      ),
    ).toBe("custom.connection.id");
    expect(
      connectionEventAttributeKey({
        ...result(),
        includeNonAlertingDetections: false,
      } as unknown as SecurityEventConnectionRunResult),
    ).toBe(LEGACY_GOOGLE_SECOPS_CONNECTION_ID_ATTRIBUTE);
    // The shared poller files the flag under providerDetails, never on top.
    expect(
      connectionEventAttributeKey(
        result({ providerDetails: { includeNonAlertingDetections: false } }),
      ),
    ).toBe(SECURITY_CONNECTION_ID_ATTRIBUTE);
    // A named key wins even on a legacy-shaped result.
    expect(
      connectionEventAttributeKey({
        ...result({ eventAttributeKey: SECURITY_CONNECTION_ID_ATTRIBUTE }),
        includeNonAlertingDetections: true,
      } as unknown as SecurityEventConnectionRunResult),
    ).toBe(SECURITY_CONNECTION_ID_ATTRIBUTE);
  });

  test("View events targets detection time rather than creation or import time", (): void => {
    const route: Route = connectionEventsRoute(result());
    expect(eventsRange(route)).toEqual([
      "2026-09-09T01:30:29.000Z",
      "2026-09-09T01:30:31.000Z",
    ]);
    // Without a connection id there is nothing to scope on.
    expect(eventsFilter(route)["attributes"]).toBeUndefined();
  });

  test("the window is the page's time range, not a chip", (): void => {
    const route: Route = connectionEventsRoute(result(), CONNECTION_ID);
    const params: URLSearchParams = eventsParams(route);

    expect(params.get("range")).toBe(TimeRange.CUSTOM);
    expect(params.get("start")).toBe("2026-09-09T01:30:29.000Z");
    expect(params.get("end")).toBe("2026-09-09T01:30:31.000Z");
    // The window is the explorer's own range, never one of its chips.
    expect(eventsFilter(route)["time"]).toBeUndefined();
    expect(eventsFilter(route)["attributes"]).toEqual({
      [SECURITY_CONNECTION_ID_ATTRIBUTE]: CONNECTION_ID,
    });
  });

  test("the connection chip is written in the explorer's filters grammar", (): void => {
    const raw: string | null = eventsParams(
      connectionEventsRoute(result(), CONNECTION_ID),
    ).get("filters");

    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual([
      [`attributes.${SECURITY_CONNECTION_ID_ATTRIBUTE}`, CONNECTION_ID],
    ]);
  });

  test("a link with nothing to filter on sets no chips at all", (): void => {
    const params: URLSearchParams = eventsParams(
      connectionEventsRoute(result()),
    );

    expect(params.get("filters")).toBeNull();
    // The retired model table's own filter param is gone for good.
    expect(params.get("security-events-table-filter")).toBeNull();
    expect(params.get("range")).toBe(TimeRange.CUSTOM);
  });

  /*
   * A duplicate-only run imported nothing, so the link cannot scope to the
   * connection, and a run without a stored event-time range must still
   * open the range the detections are stored under: their detection time,
   * which for a late-created detection is a day before its creation time.
   */
  test("duplicate-only links recover the detection-time range from samples", (): void => {
    const route: Route = connectionEventsRoute(
      result({
        ingestedCount: 0,
        duplicateCount: 1,
        eventTimeStart: undefined,
        eventTimeEnd: undefined,
      }),
      CONNECTION_ID,
    );
    expect(eventsRange(route)).toEqual([
      "2026-09-09T01:30:29.000Z",
      "2026-09-09T01:30:31.000Z",
    ]);
    expect(eventsFilter(route)["attributes"]).toBeUndefined();
  });

  test("a legacy sample's detection time is used the same way", (): void => {
    const legacySample: SecurityConnectorSample = {
      id: "legacy",
      detectionTime: "2026-09-08T22:00:00Z",
      createdTime: "2026-09-10T04:00:00Z",
    } as unknown as SecurityConnectorSample;
    const route: Route = connectionEventsRoute(
      result({
        ingestedCount: 0,
        duplicateCount: 1,
        eventTimeStart: undefined,
        eventTimeEnd: undefined,
        samples: [legacySample],
      }),
    );
    expect(eventsRange(route)).toEqual([
      "2026-09-08T21:59:59.000Z",
      "2026-09-08T22:00:01.000Z",
    ]);
  });

  test("creation time is the fallback for a sample without an event time, and the window for no samples", (): void => {
    expect(
      eventsRange(
        connectionEventsRoute(
          result({
            eventTimeStart: undefined,
            eventTimeEnd: undefined,
            samples: [
              sample({
                eventTime: undefined,
                createdTime: "2026-09-10T04:10:00Z",
              }),
            ],
          }),
        ),
      ),
    ).toEqual(["2026-09-10T04:09:59.000Z", "2026-09-10T04:10:01.000Z"]);

    expect(
      eventsRange(
        connectionEventsRoute(
          result({
            eventTimeStart: undefined,
            eventTimeEnd: undefined,
            samples: [],
          }),
        ),
      ),
    ).toEqual(["2026-09-10T03:59:59.000Z", "2026-09-10T05:00:01.000Z"]);
  });

  test("a stored event-time range wins over the samples", (): void => {
    expect(
      eventsRange(
        connectionEventsRoute(
          result({
            eventTimeStart: "2026-09-01T00:00:00Z",
            eventTimeEnd: "2026-09-02T00:00:00Z",
          }),
        ),
      ),
    ).toEqual(["2026-08-31T23:59:59.000Z", "2026-09-02T00:00:01.000Z"]);
  });
});

describe("connection diagnostics util", () => {
  const google: SecurityEventConnectorDefinition =
    getSecurityEventConnectorDefinition(
      GOOGLE,
    ) as SecurityEventConnectorDefinition;
  const okta: SecurityEventConnectorDefinition =
    getSecurityEventConnectorDefinition(
      OKTA,
    ) as SecurityEventConnectorDefinition;

  test("Google SecOps is titled from the catalog, and an unknown provider by its identifier", (): void => {
    expect(connectorProviderTitle(GOOGLE)).toBe("Google SecOps");
    expect(connectorProviderTitle("future-provider")).toBe("future-provider");
    expect(connectorProviderTitle("")).toBe("");
  });

  test("the scope reads in the control's words, generically without one, and not at all without a distinction", (): void => {
    expect(connectorScopeLabel(google)).toBe("Data to import");
    expect(connectorScopeLabel(okta)).toBe("Scope");
    expect(connectorScopeLabel(undefined)).toBe("Scope");

    expect(connectorScopeSummary(google, true)).toBe("Alerts only");
    expect(connectorScopeSummary(google, undefined)).toBe("Alerts only");
    expect(connectorScopeSummary(google, false)).toBe("Alerts and detections");
    expect(connectorScopeSummary(okta, false)).toBeUndefined();
    expect(connectorScopeSummary(undefined, false)).toBeUndefined();

    const toggleOnly: Pick<
      SecurityEventConnectorDefinition,
      "supportsAlertingOnlyToggle" | "alertingOnlyControl"
    > = { supportsAlertingOnlyToggle: true };
    expect(connectorScopeLabel(toggleOnly)).toBe("Scope");
    expect(connectorScopeSummary(toggleOnly, true)).toBe("Alerts only");
    expect(connectorScopeSummary(toggleOnly, false)).toBe(
      "Alerts and detections",
    );
  });

  test("an import names what it brings in only when the provider has a control", (): void => {
    expect(connectorScopeImportNoun(google, true)).toBe("alerts");
    expect(connectorScopeImportNoun(google, false)).toBe(
      "alerts and detections",
    );
    expect(connectorScopeImportNoun(okta, false)).toBeUndefined();
    expect(
      connectorScopeImportNoun({ supportsAlertingOnlyToggle: true }, false),
    ).toBeUndefined();
    // A control on a provider without the distinction is ignored.
    expect(
      connectorScopeImportNoun(
        {
          supportsAlertingOnlyToggle: false,
          alertingOnlyControl: google.alertingOnlyControl,
        },
        false,
      ),
    ).toBeUndefined();
  });

  test("provider details come from providerDetails, or from the top of a carried-over result", (): void => {
    expect(
      readConnectorProviderDetails(
        result({ providerDetails: { basis: "created-time" } }),
      ),
    ).toEqual({ basis: "created-time" });
    expect(readConnectorProviderDetails(result())).toBeUndefined();

    const legacy: SecurityEventConnectionRunResult = {
      ...result(),
      includeNonAlertingDetections: false,
      basis: "detection-time",
      sourceCounts: { ruleDetections: 1 },
      creationLag: { measured: 0, lateCount: 0, maxLagMinutes: 0 },
      unrelated: "ignored",
    } as unknown as SecurityEventConnectionRunResult;
    expect(readConnectorProviderDetails(legacy)).toEqual({
      includeNonAlertingDetections: false,
      basis: "detection-time",
      sourceCounts: { ruleDetections: 1 },
      creationLag: { measured: 0, lateCount: 0, maxLagMinutes: 0 },
    });

    // providerDetails wins when both are present.
    expect(
      readConnectorProviderDetails({
        ...legacy,
        providerDetails: { basis: "created-time" },
      }),
    ).toEqual({ basis: "created-time" });
  });

  test("detail groups: values first, one group per object, deeper values as JSON, blanks and omitted keys dropped", (): void => {
    expect(connectorProviderDetailGroups(undefined)).toEqual([]);
    expect(connectorProviderDetailGroups({})).toEqual([]);

    const groups: Array<ConnectorProviderDetailGroup> =
      connectorProviderDetailGroups(
        {
          sourceCounts: { ruleDetections: 1200, nested: { deep: true } },
          basis: "created-time",
          truncated: true,
          skipped: null,
          emptyGroup: {},
          includeNonAlertingDetections: false,
        },
        ["includeNonAlertingDetections"],
      );

    expect(groups).toEqual([
      {
        key: "",
        rows: [
          { key: "basis", label: "Time basis read", value: "Created time" },
          { key: "truncated", label: "Truncated", value: "Yes" },
        ],
      },
      {
        key: "sourceCounts",
        title: "Returned by each pass",
        rows: [
          {
            key: "sourceCounts.ruleDetections",
            label: "Rule detections",
            value: (1200).toLocaleString(),
          },
          {
            key: "sourceCounts.nested",
            label: "Nested",
            value: '{"deep":true}',
          },
        ],
      },
    ]);
  });

  test("carried-over check statuses and samples are read in the shared vocabulary", (): void => {
    expect(normalizeConnectorCheckStatus("success")).toBe("pass");
    expect(normalizeConnectorCheckStatus("failed")).toBe("fail");
    for (const status of ["pass", "fail", "warn", "skip", "unexpected"]) {
      expect(normalizeConnectorCheckStatus(status)).toBe(status);
    }

    expect(connectorSampleTitle(sample())).toBe("Successful brute force");
    const legacy: SecurityConnectorSample = {
      id: "legacy",
      ruleName: "Legacy rule",
      detectionTime: "2026-09-09T00:00:00Z",
    } as unknown as SecurityConnectorSample;
    expect(connectorSampleTitle(legacy)).toBe("Legacy rule");
    expect(connectorSampleEventTime(legacy)).toBe("2026-09-09T00:00:00Z");
    expect(connectorSampleEventTime(sample())).toBe("2026-09-09T01:30:30Z");
    expect(
      connectorSampleTitle({ id: "blank" } as SecurityConnectorSample),
    ).toBe("");
    expect(
      connectorSampleEventTime({ id: "blank" } as SecurityConnectorSample),
    ).toBeUndefined();
  });

  test.each([
    ["", "2026-09-10T12:00:00Z", "valid start"],
    ["2026-09-10T12:00:00Z", "2026-09-10T12:00:00Z", "before the end"],
    ["2026-09-10T11:00:00Z", "2026-09-10T12:01:00Z", "future"],
    ["2026-09-02T12:00:00Z", "2026-09-10T12:00:00Z", "7 days or less"],
  ])(
    "rejects range %s to %s",
    (start: string, end: string, expected: string): void => {
      expect(validateConnectionRange(start, end, NOW)).toContain(expected);
    },
  );

  test("allows a complete seven-day historical range", (): void => {
    expect(
      validateConnectionRange(
        "2026-09-03T12:00:00Z",
        "2026-09-10T12:00:00Z",
        NOW,
      ),
    ).toBeNull();
  });

  test("a Google SecOps connection's partial imports and catch-up stay distinguishable from failures", (): void => {
    const item: SecurityEventConnection = connection({
      lastPolledAt: new Date(NOW),
      lastError: "Poll incomplete; retrying the same window.",
      lastPollResult: result({
        status: "partial",
        complete: false,
      }) as unknown as JSONObject,
    });
    expect(connectorHealth(item, NOW)).toBe("Partial import");
    delete item.lastError;
    item.lastPollResult = result() as unknown as JSONObject;
    expect(connectorHealth(item, NOW)).toBe("Catching up");
  });
});
