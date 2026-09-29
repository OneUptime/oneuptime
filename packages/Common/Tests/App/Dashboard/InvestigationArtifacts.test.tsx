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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * PR C surfaces on the investigation drawer: the deterministic findings
 * card (built from the drawer's OWN evidence — log signal, patterns,
 * event markers), the "Explain with AI" hand-off (prefill, never
 * auto-send), and "Save to incident" (the evidence pinned to an incident
 * timeline as a markdown internal note).
 */

const histogramMock: MockFunction = getJestMockFunction();
const patternsMock: MockFunction = getJestMockFunction();
const eventLinesMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsInsightsApi",
  () => {
    return {
      __esModule: true,
      fetchLogsHistogramRaw: (...args: Array<any>) => {
        return histogramMock(...args);
      },
      fetchTopErrorPatterns: (...args: Array<any>) => {
        return patternsMock(...args);
      },
    };
  },
);

// The marker hook is separately tested — here it hands back a fixed set.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: (...args: Array<any>) => {
        return eventLinesMock(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetryCompanionSignalTabs",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div", { "data-testid": "companion-tabs" });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div", {
          "data-testid": "embedded-metric-card",
        });
      },
    };
  },
);

import InvestigationDrawer from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/InvestigationDrawer";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import ObjectID from "../../../Types/ObjectID";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-08-20T10:00:00.000Z"),
  new Date("2026-08-20T10:15:00.000Z"),
);

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-1111-1111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-2222-2222-222222222222",
);

function buildViewData(): MetricViewData {
  return {
    queryConfigs: [
      {
        metricAliasData: { metricVariable: "a" },
        metricQueryData: {
          filterData: {
            metricName: "cpu.usage",
            attributes: { "host.name": "web-01" },
            aggegationType: MetricsAggregationType.Avg,
          },
        },
      },
    ],
    formulaConfigs: [],
    startAndEndDate: null,
  } as unknown as MetricViewData;
}

function buildIncident(): Incident {
  return {
    id: INCIDENT_ID,
    _id: INCIDENT_ID.toString(),
    title: "API latency spike",
    incidentNumberWithPrefix: "INC-42",
    incidentNumber: 42,
  } as unknown as Incident;
}

let dispatchSpy: ReturnType<typeof jest.spyOn>;
let getListSpy: ReturnType<typeof jest.spyOn>;
let createSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  histogramMock.mockReset();
  patternsMock.mockReset();
  eventLinesMock.mockReset();
  histogramMock.mockReturnValue(
    Promise.resolve([
      { time: "2026-08-20T10:00:00.000Z", severity: "Information", count: 90 },
      { time: "2026-08-20T10:12:00.000Z", severity: "Error", count: 10 },
    ]),
  );
  patternsMock.mockReturnValue(
    Promise.resolve([
      {
        pattern: "connection refused to <IP>",
        sampleBody: "connection refused to 10.0.0.5",
        count: 8,
        resourceIds: [],
        severities: ["Error"],
        sampleTraceIds: [],
      },
    ]),
  );
  eventLinesMock.mockReturnValue({
    lines: [
      {
        date: new Date("2026-08-20T10:05:00.000Z"),
        label: "Deploy: v2.31.0",
        color: "#6366f1",
      },
    ],
    markerCount: 1,
  });

  dispatchSpy = jest
    .spyOn(GlobalEvents, "dispatchEvent")
    .mockImplementation(() => {
      return undefined;
    });
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getListSpy = jest.spyOn(ModelAPI, "getList").mockReturnValue(
    Promise.resolve({
      data: [buildIncident()],
      count: 1,
      skip: 0,
      limit: 10,
    }) as never,
  );
  createSpy = jest.spyOn(ModelAPI, "create").mockImplementation(((input: {
    model: IncidentInternalNote;
  }) => {
    return Promise.resolve(input.model);
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  cleanup();
});

function renderDrawer(): void {
  render(
    <InvestigationDrawer
      window={WINDOW}
      metricViewData={buildViewData()}
      onClose={() => {
        // not exercised here
      }}
    />,
  );
}

describe("findings card", () => {
  test("correlates markers and the log signal into ranked findings", async () => {
    renderDrawer();

    /*
     * The change event leads (its marker came from the hook, scoped to
     * the pinned window)…
     */
    expect(
      screen.getByText(/Deploy: v2\.31\.0 landed .*before the end/),
    ).toBeInTheDocument();
    const hookArgs: Record<string, unknown> = eventLinesMock.mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect((hookArgs["window"] as InBetween<Date>).startValue.getTime()).toBe(
      WINDOW.startValue.getTime(),
    );

    // …and once the log signal lands, the error-rate finding joins it.
    await waitFor(() => {
      expect(
        screen.getByText(/10\.0% of the window's log lines/),
      ).toBeInTheDocument();
    });
  });
});

describe("explain with AI", () => {
  test("dispatches the chat-open event with the evidence as the prompt", async () => {
    renderDrawer();

    await waitFor(() => {
      expect(
        screen.getByText("connection refused to 10.0.0.5"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Explain with AI"));

    const aiCalls: Array<Array<unknown>> = dispatchSpy.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return call[0] === EventName.AI_CHAT_TOGGLE;
      },
    );
    expect(aiCalls).toHaveLength(1);
    const prompt: string = (aiCalls[0]?.[1] as Record<string, string>)[
      "prompt"
    ] as string;
    expect(prompt).toContain("host.name = web-01");
    expect(prompt).toContain("connection refused to 10.0.0.5");
    expect(prompt).toContain("Deploy: v2.31.0");
    expect(prompt).toContain("What is the most likely root cause");
  });
});

describe("save to incident", () => {
  test("lists recent incidents, then pins the markdown snapshot as an internal note", async () => {
    renderDrawer();

    fireEvent.click(screen.getByText("Save to incident"));

    // The picker fetched the project's recent incidents.
    await waitFor(() => {
      expect(screen.getByText(/INC-42/)).toBeInTheDocument();
    });
    const listArgs: Record<string, unknown> = getListSpy.mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(listArgs["modelType"]).toBe(Incident);
    expect(listArgs["limit"]).toBe(10);

    fireEvent.click(screen.getByText("Save note"));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledTimes(1);
    });
    const created: IncidentInternalNote = (
      createSpy.mock.calls[0]?.[0] as { model: IncidentInternalNote }
    ).model;
    expect(created.incidentId?.toString()).toBe(INCIDENT_ID.toString());
    expect(created.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(created.note).toContain("### Investigation snapshot");
    expect(created.note).toContain("**Scope:** host.name = web-01");
    expect(created.note).toContain("Open these charts in the Metric Explorer");

    // Success closes the picker.
    await waitFor(() => {
      expect(screen.queryByText("Save note")).toBeNull();
    });
  });

  test("cancel closes the picker without any write", async () => {
    renderDrawer();

    fireEvent.click(screen.getByText("Save to incident"));
    await waitFor(() => {
      expect(screen.getByText(/INC-42/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText(/INC-42/)).toBeNull();
    expect(createSpy).not.toHaveBeenCalled();
  });
});
