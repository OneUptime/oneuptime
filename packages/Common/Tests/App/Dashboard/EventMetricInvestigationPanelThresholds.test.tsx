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
  render,
  RenderResult,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #6250: the metric charts of an incident, alert or episode a metrics
 * monitor opened draw the value the monitor compared the metric with - "CPU
 * above 90" is a line at 90 on the CPU chart - as the monitor's own page
 * draws it, and nothing when the rule cannot be read.
 *
 * The panel, the investigation and MetricView are real; the charts, the
 * metric reads, the other events' markers, the explorers in the companion
 * tabs and the reads of the event and its monitor are stood in for.
 */

const fetchResultsMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

interface MockChartsProps {
  thresholds?: Array<Record<string, unknown>> | undefined;
}

let lastCharts: MockChartsProps | null = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (props: MockChartsProps): React.ReactElement => {
        lastCharts = props;
        return <div data-testid="metric-charts" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<unknown>) => {
          return fetchResultsMock(...args);
        },
        loadAllMetricsTypes: () => {
          return Promise.resolve({ metricTypes: [], telemetryServices: [] });
        },
        getMetricTypes: () => {
          return Promise.resolve([]);
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { lines: [], markerCount: 0 };
      },
    };
  },
);

function mockViewer(name: string): unknown {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <div data-testid={`viewer-${name}`} />;
    },
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    return mockViewer("logs");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer",
  () => {
    return mockViewer("traces");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsViewer",
  () => {
    return mockViewer("exceptions");
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/useServiceNames",
  () => {
    return {
      __esModule: true,
      default: () => {
        return {};
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

import EventMetricInvestigationPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/EventMetricInvestigationPanel";
import TelemetrySnapshotPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySnapshotPanel";
import { EventMetricSubject } from "../../../../App/FeatureSet/Dashboard/src/Utils/EventMetricInvestigation";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import { TelemetryQuery } from "../../../Types/Telemetry/TelemetryQuery";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import { StateListType } from "../../../Utils/StateOrder";

const NOW: Date = new Date("2026-11-05T09:00:00.000Z");
const STARTED_AT: Date = new Date("2026-11-05T05:44:00.000Z");
const EVALUATED: InBetween<Date> = new InBetween<Date>(
  new Date("2026-11-05T05:39:00.000Z"),
  new Date("2026-11-05T05:44:00.000Z"),
);

const INCIDENT_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ALERT_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MONITOR_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RULE_ID: string = "rule-cpu-above-90";

// The query the monitor reads, as the event's snapshot keeps it.
const queryOf: (metricName: string) => MetricQueryConfigData = (
  metricName: string,
): MetricQueryConfigData => {
  return {
    metricAliasData: {
      metricVariable: "a",
      title: "",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: metricName,
        aggegationType: MetricsAggregationType.Avg,
      } as never,
      groupByAttributeKeys: ["host.name"],
    },
  };
};

// The event's snapshot, narrowed to its own host (MetricSeriesScope).
const snapshot: TelemetryQuery = {
  telemetryType: TelemetryType.Metric,
  telemetryQuery: null,
  metricViewData: {
    startAndEndDate: EVALUATED,
    queryConfigs: [
      {
        ...queryOf("system.cpu.utilization"),
        metricQueryData: {
          ...queryOf("system.cpu.utilization").metricQueryData,
          filterData: {
            metricName: "system.cpu.utilization",
            aggegationType: MetricsAggregationType.Avg,
            attributes: { "host.name": "web-01" },
          } as never,
        },
      },
    ],
    formulaConfigs: [],
  },
};

// The monitor as it is now: its step, with the rule that opened the event.
const monitorStepsOf: (data: {
  metricName?: string;
  value?: number;
  incident?: boolean;
}) => MonitorSteps = (data: {
  metricName?: string;
  value?: number;
  incident?: boolean;
}): MonitorSteps => {
  const rule: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  rule.data = {
    id: RULE_ID,
    name: "CPU above 90",
    description: "",
    filterCondition: "Any" as never,
    filters: [
      {
        checkOn: CheckOn.MetricValue,
        filterType: FilterType.GreaterThan,
        value: data.value === undefined ? 90 : data.value,
        metricMonitorOptions: { metricAlias: "a" },
      },
    ],
    incidents:
      data.incident === false
        ? []
        : [{ id: "i", title: "t", description: "d" } as never],
    alerts: [{ id: "a", title: "t", description: "d" } as never],
    createIncidents: data.incident !== false,
    createAlerts: true,
    changeMonitorStatus: false,
    monitorStatusId: undefined,
  };

  const step: MonitorStep = new MonitorStep();
  step.data = {
    id: "step-1",
    monitorCriteria: { data: { monitorCriteriaInstanceArray: [rule] } },
    metricMonitor: {
      rollingTime: RollingTime.Past5Minutes,
      metricViewConfig: {
        queryConfigs: [queryOf(data.metricName || "system.cpu.utilization")],
        formulaConfigs: [],
      },
    },
  } as unknown as MonitorStep["data"];

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = { monitorStepsInstanceArray: [step] };
  return steps;
};

interface Reads {
  createdCriteriaId?: string;
  monitorSteps?: MonitorSteps;
  monitorFails?: boolean;
}

function readsAre(reads: Reads): void {
  getItemMock.mockImplementation((...args: Array<unknown>) => {
    const request: { modelType: unknown; id: ObjectID } = args[0] as never;

    if (request.modelType === Incident) {
      return Promise.resolve({
        createdCriteriaId: reads.createdCriteriaId,
        monitors: [{ id: new ObjectID(MONITOR_ID) }],
      });
    }

    if (request.modelType === Alert) {
      return Promise.resolve({
        createdCriteriaId: reads.createdCriteriaId,
        monitorId: new ObjectID(MONITOR_ID),
      });
    }

    if (request.modelType === Monitor) {
      return reads.monitorFails
        ? Promise.reject(new Error("You do not have permission"))
        : Promise.resolve({
            monitorType: MonitorType.Metrics,
            monitorSteps: reads.monitorSteps,
          });
    }

    return Promise.resolve(null);
  });
}

function renderPanel(
  overrides?: Partial<
    React.ComponentProps<typeof EventMetricInvestigationPanel>
  >,
): RenderResult {
  return render(
    <EventMetricInvestigationPanel
      telemetryQuery={snapshot}
      evaluationWindow={EVALUATED}
      seriesSummary="host.name = web-01"
      subject={EventMetricSubject.Incident}
      eventId={INCIDENT_ID}
      startedAt={STARTED_AT}
      stateTimeline={[]}
      states={[]}
      stateList={StateListType.IncidentState}
      {...overrides}
    />,
  );
}

// Waits for the event's rule to have been read, and the charts redrawn.
async function ruleRead(): Promise<void> {
  await waitFor(() => {
    expect(fetchResultsMock).toHaveBeenCalled();
    expect(
      getItemMock.mock.calls.some((call: Array<unknown>) => {
        return (call[0] as { modelType: unknown }).modelType === Monitor;
      }),
    ).toBe(true);
  });
  // Let the read settle into a render.
  await waitFor(() => {
    expect(lastCharts).not.toBeNull();
  });
}

/*
 * Lets every read that has started finish and render: the rule is read in
 * a few steps (the event, then its monitor), each a promise away.
 */
async function settle(): Promise<void> {
  for (let round: number = 0; round < 8; round++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function monitorWasRead(): boolean {
  return getItemMock.mock.calls.some((call: Array<unknown>) => {
    return (call[0] as { modelType: unknown }).modelType === Monitor;
  });
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  window.history.replaceState({}, "", "/dashboard/p/incidents/incident-1");
  fetchResultsMock.mockReset();
  fetchResultsMock.mockImplementation(() => {
    return Promise.resolve([{ data: [], truncated: false }]);
  });
  getItemMock.mockReset();
  lastCharts = null;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("a metrics incident opened by a rule like 'CPU above 90'", () => {
  test("shows a line at 90 on the CPU chart, drawn and named as on the monitor's page", async () => {
    readsAre({ createdCriteriaId: RULE_ID, monitorSteps: monitorStepsOf({}) });

    renderPanel();
    await ruleRead();

    await waitFor(() => {
      expect(lastCharts?.thresholds).toEqual([
        {
          metricVariable: "a",
          value: 90,
          unit: undefined,
          name: "CPU above 90",
          filterType: FilterType.GreaterThan,
          isForecast: false,
          color: "#ef4444",
          shade: "above",
          onlyAtInterval: null,
        },
      ]);
    });

    // The incident's criteria and monitor, then the monitor's steps.
    const incidentRead: { modelType: unknown; id: ObjectID; select: unknown } =
      getItemMock.mock.calls[0]![0] as never;
    expect(incidentRead.modelType).toBe(Incident);
    expect(incidentRead.id.toString()).toBe(INCIDENT_ID);
    expect(incidentRead.select).toMatchObject({
      createdCriteriaId: true,
      monitors: { _id: true },
    });
  });

  test("the line belongs to the card's defaults: an untouched card writes nothing to the URL", async () => {
    readsAre({ createdCriteriaId: RULE_ID, monitorSteps: monitorStepsOf({}) });

    renderPanel();
    await ruleRead();
    await waitFor(() => {
      expect(lastCharts?.thresholds).toHaveLength(1);
    });

    expect(window.location.search).toBe("");
  });

  test("a value changed since is drawn as the monitor compares it now", async () => {
    readsAre({
      createdCriteriaId: RULE_ID,
      monitorSteps: monitorStepsOf({ value: 95 }),
    });

    renderPanel();
    await ruleRead();

    await waitFor(() => {
      expect(lastCharts?.thresholds?.[0]?.["value"]).toBe(95);
    });
  });
});

describe("no line when the rule cannot be read", () => {
  test.each([
    [
      "the criteria is gone from the monitor",
      { createdCriteriaId: "deleted-rule", monitorSteps: monitorStepsOf({}) },
    ],
    [
      "the monitor now reads another metric",
      {
        createdCriteriaId: RULE_ID,
        monitorSteps: monitorStepsOf({ metricName: "system.memory.usage" }),
      },
    ],
    [
      "the monitor cannot be read",
      { createdCriteriaId: RULE_ID, monitorFails: true },
    ],
    [
      "the incident was not opened by a criteria",
      { createdCriteriaId: "", monitorSteps: monitorStepsOf({}) },
    ],
  ])(
    "%s, and nothing else on the card changes",
    async (_name: string, reads: Reads) => {
      readsAre(reads);

      renderPanel();
      await waitFor(() => {
        expect(fetchResultsMock).toHaveBeenCalled();
        expect(getItemMock).toHaveBeenCalled();
        // A criteria to look for has its monitor read.
        expect(monitorWasRead()).toBe(Boolean(reads.createdCriteriaId));
      });
      // Whatever was read has been drawn by now.
      await settle();

      expect(lastCharts).not.toBeNull();
      expect(lastCharts?.thresholds).toBeUndefined();
      // The card is the same card: its charts and their metric.
      expect(fetchResultsMock).toHaveBeenCalled();
    },
  );
});

describe("an alert a metrics monitor opened", () => {
  test("reads the alert's monitor and draws the rule, in the alerts' amber when it opens no incident", async () => {
    readsAre({
      createdCriteriaId: RULE_ID,
      monitorSteps: monitorStepsOf({ incident: false }),
    });

    renderPanel({ subject: EventMetricSubject.Alert, eventId: ALERT_ID });
    await ruleRead();

    await waitFor(() => {
      expect(lastCharts?.thresholds?.[0]).toMatchObject({
        value: 90,
        color: "#f59e0b",
      });
    });
    expect(
      (getItemMock.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(Alert);
  });
});

describe("an episode's snapshot", () => {
  test("draws the rule of the member whose telemetry it shows", async () => {
    readsAre({ createdCriteriaId: RULE_ID, monitorSteps: monitorStepsOf({}) });

    render(
      <TelemetrySnapshotPanel
        telemetryQuery={snapshot}
        snapshotWindow={EVALUATED}
        seriesSummary="host.name = web-01"
        eventNoun="incident"
        subject={EventMetricSubject.IncidentEpisode}
        startedAt={STARTED_AT}
        stateTimeline={[]}
        states={[]}
        metricRuleEventId={INCIDENT_ID}
      />,
    );
    await ruleRead();

    await waitFor(() => {
      expect(lastCharts?.thresholds?.[0]?.["value"]).toBe(90);
    });
    expect(
      (getItemMock.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe(INCIDENT_ID);
  });

  test("without a member to read, draws no line and reads nothing", async () => {
    render(
      <TelemetrySnapshotPanel
        telemetryQuery={snapshot}
        snapshotWindow={EVALUATED}
        seriesSummary=""
        eventNoun="alert"
        subject={EventMetricSubject.AlertEpisode}
        startedAt={STARTED_AT}
        stateTimeline={[]}
        states={[]}
      />,
    );

    await waitFor(() => {
      expect(fetchResultsMock).toHaveBeenCalled();
    });
    expect(getItemMock).not.toHaveBeenCalled();
    expect(lastCharts?.thresholds).toBeUndefined();
  });
});
