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
import GoogleSecOpsDiagnostics from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/GoogleSecOpsDiagnostics";
import GoogleSecOpsRunDetails from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/GoogleSecOpsRunDetails";
import {
  googleSecOpsHealth,
  googleSecOpsEventsRoute,
  validateGoogleSecOpsRange,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/GoogleSecOpsDiagnosticsUtil";
import { RouteUtil } from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import GoogleSecOpsConnection from "../../../Models/DatabaseModels/GoogleSecOpsConnection";
import GoogleSecOpsConnectionRun from "../../../Models/DatabaseModels/GoogleSecOpsConnectionRun";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import {
  GoogleSecOpsRunResult,
  GoogleSecOpsRunStatus,
  GoogleSecOpsRunType,
} from "../../../Types/SecurityEvent/GoogleSecOpsDiagnostics";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

const CONNECTION_ID: string = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const RUN_ID: string = "33333333-3333-4333-8333-333333333333";
const NOW: number = new Date("2026-09-10T12:00:00Z").getTime();

function connection(): GoogleSecOpsConnection {
  const value: GoogleSecOpsConnection = new GoogleSecOpsConnection();
  value._id = CONNECTION_ID;
  value.projectId = new ObjectID(PROJECT_ID);
  value.name = "Customer SecOps";
  value.isEnabled = true;
  value.pollIntervalInMinutes = 5;
  value.includeNonAlertingDetections = false;
  value.createdAt = new Date(NOW - 60_000);
  return value;
}

function result(
  overrides: Partial<GoogleSecOpsRunResult> = {},
): GoogleSecOpsRunResult {
  return {
    type: "poll",
    status: "success",
    startedAt: "2026-09-10T11:59:00Z",
    completedAt: "2026-09-10T12:00:00Z",
    durationMs: 60000,
    windowStart: "2026-09-10T04:00:00Z",
    windowEnd: "2026-09-10T05:00:00Z",
    includeNonAlertingDetections: false,
    fetchedCount: 1,
    ingestedCount: 1,
    duplicateCount: 0,
    rejectedCount: 0,
    failedCount: 0,
    complete: true,
    requestCount: 1,
    warnings: [],
    samples: [
      {
        id: "detection-1",
        ruleName: "Successful brute force",
        detectionTime: "2026-09-09T01:30:30Z",
        createdTime: "2026-09-10T04:16:58.612Z",
      },
    ],
    checks: [
      {
        name: "Google SecOps API",
        status: "success",
        durationMs: 500,
        message: "Detection read access verified.",
      },
    ],
    eventTimeStart: "2026-09-09T01:30:30Z",
    eventTimeEnd: "2026-09-09T01:30:30Z",
    ...overrides,
  };
}

function run(
  status: GoogleSecOpsRunStatus = "success",
  type: GoogleSecOpsRunType = "poll",
  value?: GoogleSecOpsRunResult,
): GoogleSecOpsConnectionRun {
  const model: GoogleSecOpsConnectionRun = new GoogleSecOpsConnectionRun();
  model._id = RUN_ID;
  model.googleSecOpsConnectionId = new ObjectID(CONNECTION_ID);
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
  data: Array<GoogleSecOpsConnectionRun>,
): ListResult<GoogleSecOpsConnectionRun> {
  return { data, count: data.length, skip: 0, limit: 20 };
}

function renderDiagnostics(
  data: {
    canRun?: boolean;
    initialAction?: "test" | "poll";
    item?: GoogleSecOpsConnection;
  } = {},
): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <GoogleSecOpsDiagnostics
        connection={data.item || connection()}
        canRun={data.canRun ?? true}
        initialAction={data.initialAction}
        onClose={(): void => {}}
        onUpdated={(): void => {}}
      />
    </MemoryRouter>,
  );
}

describe("Google SecOps diagnostics interactions", () => {
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
      .mockReturnValue(new Route(`/dashboard/${PROJECT_ID}/security-events`));
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
        modelType: GoogleSecOpsConnectionRun,
        query: {
          projectId: new ObjectID(PROJECT_ID),
          googleSecOpsConnectionId: new ObjectID(CONNECTION_ID),
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
    ).not.toHaveProperty("serviceAccountJson");
    expect(API.post).not.toHaveBeenCalled();
  });

  test("starts an access test without a range and clearly limits its claim", async (): Promise<void> => {
    renderDiagnostics();
    await screen.findByText(/No runs recorded yet/);
    jest
      .mocked(ModelAPI.getList)
      .mockResolvedValue(
        history([
          run("success", "test", result({ type: "test", ingestedCount: 0 })),
        ]),
      );
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(
      await screen.findByText(
        /does not import events or confirm that scheduled polling is working/,
      ),
    ).toBeVisible();
    expect(API.post).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { type: "test" },
        headers: { "project-id": PROJECT_ID },
      }),
    );
    const destination: string = String(
      jest.mocked(API.post).mock.calls[0]?.[0].url,
    );
    expect(destination).toContain(
      `/google-secops-connection/${CONNECTION_ID}/run`,
    );
  });

  test("Run now is available for paused schedules and sends a poll request", async (): Promise<void> => {
    const paused: GoogleSecOpsConnection = connection();
    paused.isEnabled = false;
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
  });

  test("a direct row action is submitted only once even with refreshes", async (): Promise<void> => {
    jest
      .mocked(ModelAPI.getList)
      .mockResolvedValue(history([run("queued", "test")]));
    renderDiagnostics({ initialAction: "test" });
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
    const latest: GoogleSecOpsConnectionRun = run(
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
      await screen.findByText("Result: No detections returned"),
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
    const allDetections: GoogleSecOpsConnection = connection();
    allDetections.includeNonAlertingDetections = true;
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

  test("partial and empty results have different guidance and preserve the source dates", (): void => {
    const partial: GoogleSecOpsRunResult = result({
      status: "partial",
      complete: false,
      ingestedCount: 0,
      rejectedCount: 1,
      warnings: ["One payload could not be normalized."],
    });
    const view: ReturnType<typeof render> = render(
      <MemoryRouter>
        <GoogleSecOpsRunDetails run={run("partial", "poll", partial)} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Result: Partial")).toBeVisible();
    expect(
      screen.getByText(/This run did not finish processing every detection/),
    ).toBeVisible();
    expect(
      screen.getByText("One payload could not be normalized."),
    ).toBeVisible();
    expect(screen.getByText("2026-09-09 01:30:30 UTC")).toBeVisible();
    expect(screen.getByText("2026-09-10 04:16:58 UTC")).toBeVisible();
    expect(screen.getByText("Unknown")).toBeVisible();
    view.unmount();
    render(
      <MemoryRouter>
        <GoogleSecOpsRunDetails
          run={run(
            "empty",
            "preview",
            result({
              type: "preview",
              status: "empty",
              fetchedCount: 0,
              ingestedCount: 0,
              samples: [],
            }),
          )}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Result: No detections returned")).toBeVisible();
    expect(
      screen.getByText(
        /Try a wider range or check whether the rule creates alerts/,
      ),
    ).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  test.each(["test", "preview"] as Array<GoogleSecOpsRunType>)(
    "%s reports duplicate detection as not checked",
    (type: GoogleSecOpsRunType): void => {
      render(
        <MemoryRouter>
          <GoogleSecOpsRunDetails
            run={run("success", type, result({ type, duplicateCount: 0 }))}
          />
        </MemoryRouter>,
      );

      const duplicateCount: HTMLElement | null =
        screen.getByText("Already imported").parentElement;
      expect(duplicateCount).toHaveTextContent("Not checked");
      expect(duplicateCount).not.toHaveTextContent("0");
    },
  );

  test.each(["poll", "backfill"] as Array<GoogleSecOpsRunType>)(
    "%s reports the actual duplicate detection count",
    (type: GoogleSecOpsRunType): void => {
      render(
        <MemoryRouter>
          <GoogleSecOpsRunDetails
            run={run("success", type, result({ type, duplicateCount: 7 }))}
          />
        </MemoryRouter>,
      );

      const duplicateCount: HTMLElement | null =
        screen.getByText("Already imported").parentElement;
      expect(duplicateCount).toHaveTextContent("7");
      expect(duplicateCount).not.toHaveTextContent("Not checked");
    },
  );

  test("an import failure preserves successful Google read diagnostics without blaming Google", (): void => {
    const failed: GoogleSecOpsRunResult = result({
      status: "failed",
      complete: false,
      ingestedCount: 0,
      failedCount: 1,
      error: "OneUptime telemetry storage is unavailable.",
      checks: [
        {
          name: "Read detections from the configured instance",
          status: "success",
          durationMs: 500,
          message: "Google SecOps detection read succeeded.",
        },
        {
          name: "Import detections",
          status: "failed",
          durationMs: 500,
          message: "The detection could not be stored in OneUptime.",
        },
      ],
    });
    render(
      <MemoryRouter>
        <GoogleSecOpsRunDetails run={run("failed", "poll", failed)} />
      </MemoryRouter>,
    );

    expect(screen.getByText("Result: Failed")).toBeVisible();
    expect(
      screen.getByText(/This run did not finish processing every detection/),
    ).toHaveTextContent("Review the checks and warnings before retrying.");
    expect(
      screen.getByText(/Google SecOps detection read succeeded/),
    ).toBeVisible();
    expect(
      screen.getByText(/The detection could not be stored in OneUptime/),
    ).toBeVisible();
    expect(
      screen.getByText("OneUptime telemetry storage is unavailable."),
    ).toBeVisible();
    expect(
      screen.queryByText(/Google did not return a complete result/),
    ).not.toBeInTheDocument();
  });

  test("failed run errors remain literal readable text", (): void => {
    const failed: GoogleSecOpsConnectionRun = run("failed");
    failed.error = "Google rejected access. <script>not markup</script>";
    render(
      <MemoryRouter>
        <GoogleSecOpsRunDetails run={failed} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(failed.error);
    expect(document.querySelector("script")).toBeNull();
  });
});

describe("Google SecOps health and time ranges", () => {
  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test("configuration and a recent attempt cannot imply success", (): void => {
    const item: GoogleSecOpsConnection = connection();
    expect(googleSecOpsHealth(item, NOW)).toBe("Waiting for first poll");
    item.lastPolledAt = new Date(NOW - 60_000);
    expect(googleSecOpsHealth(item, NOW)).toBe("Details unavailable");
    item.lastPollResult = result({
      status: "empty",
      fetchedCount: 0,
      ingestedCount: 0,
      windowEnd: "2026-09-10T12:00:00Z",
    }) as unknown as JSONObject;
    expect(googleSecOpsHealth(item, NOW)).toBe("No detections returned");
    item.lastError = "Permission denied";
    expect(googleSecOpsHealth(item, NOW)).toBe("Last poll failed");
    item.lastPolledAt = new Date(NOW - 8 * 60_000);
    expect(googleSecOpsHealth(item, NOW)).toBe("Poll overdue");
    item.isEnabled = false;
    expect(googleSecOpsHealth(item, NOW)).toBe("Schedule paused");
  });

  test.each([
    ["", "2026-09-10T12:00:00Z", "valid start"],
    ["2026-09-10T12:00:00Z", "2026-09-10T12:00:00Z", "before the end"],
    ["2026-09-10T11:00:00Z", "2026-09-10T12:01:00Z", "future"],
    ["2026-09-02T12:00:00Z", "2026-09-10T12:00:00Z", "7 days or less"],
  ])(
    "rejects range %s to %s",
    (start: string, end: string, expected: string): void => {
      expect(validateGoogleSecOpsRange(start, end, NOW)).toContain(expected);
    },
  );

  test("allows a complete seven-day historical range", (): void => {
    expect(
      validateGoogleSecOpsRange(
        "2026-09-03T12:00:00Z",
        "2026-09-10T12:00:00Z",
        NOW,
      ),
    ).toBeNull();
  });

  test("partial imports and catch-up remain distinguishable from failures", (): void => {
    const item: GoogleSecOpsConnection = connection();
    item.lastPolledAt = new Date(NOW);
    item.lastError = "Poll incomplete; retrying the same window.";
    item.lastPollResult = result({
      status: "partial",
      complete: false,
    }) as unknown as JSONObject;
    expect(googleSecOpsHealth(item, NOW)).toBe("Partial import");
    delete item.lastError;
    item.lastPollResult = result() as unknown as JSONObject;
    expect(googleSecOpsHealth(item, NOW)).toBe("Catching up");
  });

  test("duplicate-only links recover source time from samples", (): void => {
    jest
      .spyOn(RouteUtil, "populateRouteParams")
      .mockReturnValue(new Route(`/dashboard/${PROJECT_ID}/security-events`));
    const route: string = googleSecOpsEventsRoute(
      result({
        ingestedCount: 0,
        duplicateCount: 1,
        eventTimeStart: undefined,
        eventTimeEnd: undefined,
      }),
      CONNECTION_ID,
    ).toString();
    const params: URLSearchParams = new URLSearchParams(
      route.slice(route.indexOf("?")),
    );
    const filter: JSONObject = JSONFunctions.deserialize(
      JSON.parse(params.get("security-events-table-filter")!) as JSONObject,
    );
    const range: InBetween<Date> = filter["time"] as InBetween<Date>;
    expect(new Date(range.startValue).toISOString()).toBe(
      "2026-09-09T01:30:29.000Z",
    );
    expect(filter["attributes"]).toBeUndefined();
  });

  test("newly imported event links scope to their source connection", (): void => {
    jest
      .spyOn(RouteUtil, "populateRouteParams")
      .mockReturnValue(new Route(`/dashboard/${PROJECT_ID}/security-events`));
    const route: string = googleSecOpsEventsRoute(
      result(),
      CONNECTION_ID,
    ).toString();
    const params: URLSearchParams = new URLSearchParams(
      route.slice(route.indexOf("?")),
    );
    const filter: JSONObject = JSONFunctions.deserialize(
      JSON.parse(params.get("security-events-table-filter")!) as JSONObject,
    );
    expect(filter["attributes"]).toEqual({
      "oneuptime.google_secops.connection_id": CONNECTION_ID,
    });
  });

  test("View events targets detection time rather than creation or import time", (): void => {
    jest
      .spyOn(RouteUtil, "populateRouteParams")
      .mockReturnValue(new Route(`/dashboard/${PROJECT_ID}/security-events`));
    const route: string = googleSecOpsEventsRoute(result()).toString();
    const params: URLSearchParams = new URLSearchParams(
      route.slice(route.indexOf("?")),
    );
    const filter: JSONObject = JSONFunctions.deserialize(
      JSON.parse(params.get("security-events-table-filter")!) as JSONObject,
    );
    const range: InBetween<Date> = filter["time"] as InBetween<Date>;
    expect(range).toBeInstanceOf(InBetween);
    expect(new Date(range.startValue).toISOString()).toBe(
      "2026-09-09T01:30:29.000Z",
    );
    expect(new Date(range.endValue).toISOString()).toBe(
      "2026-09-09T01:30:31.000Z",
    );
    expect(filter["className"]).toBe("Detection Finding");
  });
});
