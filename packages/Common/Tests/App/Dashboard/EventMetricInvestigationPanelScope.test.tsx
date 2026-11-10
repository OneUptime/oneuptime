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
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #6265: the metric card of an incident or alert an infrastructure
 * monitor opened charts the resource the monitor watches - its cluster,
 * host or fleet - not the metric for every one in the project.
 *
 * - A snapshot stored since keeps beside its queries the filters its
 *   monitor read them with (MetricTelemetrySnapshot): it is charted with
 *   them, whatever the monitor watches now.
 * - One stored before is narrowed to what the monitor watches now, read off
 *   its current step, and the card says so.
 *
 * The panel, the investigation and MetricView are real; the charts, the
 * metric reads, the other events' markers, the companion tabs' explorers and
 * the reads of the event and its monitor are stood in for.
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

import EventMetricInvestigationPanel, {
  EVENT_METRIC_SCOPE_NOTE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/EventMetricInvestigationPanel";
import TelemetrySnapshotPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySnapshotPanel";
import { EventMetricSubject } from "../../../../App/FeatureSet/Dashboard/src/Utils/EventMetricInvestigation";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Dictionary from "../../../Types/Dictionary";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
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
import MonitorStepMetricQueries from "../../../Utils/Monitor/MonitorStepMetricQueries";
import { StateListType } from "../../../Utils/StateOrder";

const NOW: Date = new Date("2026-11-07T09:00:00.000Z");
const STARTED_AT: Date = new Date("2026-11-07T05:44:00.000Z");
const EVALUATED: InBetween<Date> = new InBetween<Date>(
  new Date("2026-11-07T05:39:00.000Z"),
  new Date("2026-11-07T05:44:00.000Z"),
);

const INCIDENT_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ALERT_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MONITOR_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RULE_ID: string = "rule-above-90";

const queryOf: (data: {
  metricName: string;
  attributes?: Dictionary<unknown>;
  groupBy?: Array<string>;
}) => MetricQueryConfigData = (data: {
  metricName: string;
  attributes?: Dictionary<unknown>;
  groupBy?: Array<string>;
}): MetricQueryConfigData => {
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
        metricName: data.metricName,
        aggegationType: MetricsAggregationType.Avg,
        ...(data.attributes ? { attributes: data.attributes } : {}),
      } as never,
      ...(data.groupBy ? { groupByAttributeKeys: data.groupBy } : {}),
    },
  };
};

const snapshotOf: (data: {
  queryConfigs: Array<MetricQueryConfigData>;
  scopes?: Array<Dictionary<unknown> | null>;
}) => TelemetryQuery = (data: {
  queryConfigs: Array<MetricQueryConfigData>;
  scopes?: Array<Dictionary<unknown> | null>;
}): TelemetryQuery => {
  return {
    telemetryType: TelemetryType.Metric,
    telemetryQuery: null,
    metricViewData: {
      startAndEndDate: EVALUATED,
      queryConfigs: data.queryConfigs,
      formulaConfigs: [],
    },
    ...(data.scopes ? { metricQueryScopes: data.scopes } : {}),
  };
};

// The monitor as it is now: one step, with the rule that opened the event.
const monitorStepsOf: (data: {
  monitorType: MonitorType;
  settings: Dictionary<unknown>;
  query: MetricQueryConfigData;
}) => MonitorSteps = (data: {
  monitorType: MonitorType;
  settings: Dictionary<unknown>;
  query: MetricQueryConfigData;
}): MonitorSteps => {
  const rule: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  rule.data = {
    id: RULE_ID,
    name: "Above 90",
    description: "",
    filterCondition: "Any" as never,
    filters: [
      {
        checkOn: CheckOn.MetricValue,
        filterType: FilterType.GreaterThan,
        value: 90,
        metricMonitorOptions: { metricAlias: "a" },
      },
    ],
    incidents: [{ id: "i", title: "t", description: "d" } as never],
    alerts: [{ id: "a", title: "t", description: "d" } as never],
    createIncidents: true,
    createAlerts: true,
    changeMonitorStatus: false,
    monitorStatusId: undefined,
  };

  const step: MonitorStep = new MonitorStep();
  step.data = {
    id: "step-1",
    monitorCriteria: { data: { monitorCriteriaInstanceArray: [rule] } },
    [MonitorStepMetricQueries.getStepKey(data.monitorType)!]: {
      ...data.settings,
      rollingTime: RollingTime.Past5Minutes,
      metricViewConfig: { queryConfigs: [data.query], formulaConfigs: [] },
    },
  } as unknown as MonitorStep["data"];

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = { monitorStepsInstanceArray: [step] } as never;
  return steps;
};

interface Reads {
  monitorType?: MonitorType;
  monitorSteps?: MonitorSteps;
  monitorFails?: boolean;
}

function readsAre(reads: Reads): void {
  getItemMock.mockImplementation((...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as never;

    if (request.modelType === Incident) {
      return Promise.resolve({
        createdCriteriaId: RULE_ID,
        monitors: [{ id: new ObjectID(MONITOR_ID) }],
      });
    }

    if (request.modelType === Alert) {
      return Promise.resolve({
        createdCriteriaId: RULE_ID,
        monitorId: new ObjectID(MONITOR_ID),
      });
    }

    if (request.modelType === Monitor) {
      return reads.monitorFails
        ? Promise.reject(new Error("You do not have permission"))
        : Promise.resolve({
            monitorType: reads.monitorType,
            monitorSteps: reads.monitorSteps,
          });
    }

    return Promise.resolve(null);
  });
}

const PROXMOX_QUERY: MetricQueryConfigData = queryOf({
  metricName: "pve_cpu_usage_ratio",
});

const PROXMOX_NOW: Reads = {
  monitorType: MonitorType.Proxmox,
  monitorSteps: monitorStepsOf({
    monitorType: MonitorType.Proxmox,
    settings: {
      clusterIdentifier: "pve-prod",
      resourceFilters: { nodeName: "pve1" },
    },
    query: PROXMOX_QUERY,
  }),
};

function renderPanel(
  telemetryQuery: TelemetryQuery,
  overrides?: Partial<
    React.ComponentProps<typeof EventMetricInvestigationPanel>
  >,
): RenderResult {
  return render(
    <EventMetricInvestigationPanel
      telemetryQuery={telemetryQuery}
      evaluationWindow={EVALUATED}
      seriesSummary=""
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

// The attributes the latest fetch read the card's first query with.
function lastFetchedAttributes(): unknown {
  const calls: Array<Array<unknown>> = fetchResultsMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return (calls[calls.length - 1]![0] as { metricViewData: MetricViewData })
    .metricViewData.queryConfigs[0]?.metricQueryData.filterData.attributes;
}

function monitorWasRead(): boolean {
  return getItemMock.mock.calls.some((call: Array<unknown>) => {
    return (call[0] as { modelType: unknown }).modelType === Monitor;
  });
}

async function settle(): Promise<void> {
  for (let round: number = 0; round < 8; round++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
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

describe("an incident opened before its snapshot kept its monitor's scope", () => {
  test("Proxmox: charts the cluster and node the monitor watches now, and says so", async () => {
    readsAre(PROXMOX_NOW);

    renderPanel(snapshotOf({ queryConfigs: [PROXMOX_QUERY] }));

    await waitFor(() => {
      expect(lastFetchedAttributes()).toEqual({
        "resource.proxmox.cluster.name": "pve-prod",
        "pve.scope": "node",
        "pve.id": "pve1",
      });
    });

    expect(
      await screen.findByTestId(EVENT_METRIC_SCOPE_NOTE_TEST_ID),
    ).toHaveTextContent("Charted for pve-prod, which this monitor checks now.");

    // The rule's line is drawn on the narrowed chart as before.
    await waitFor(() => {
      expect(lastCharts?.thresholds?.[0]).toMatchObject({ value: 90 });
    });

    // An untouched card is the card's defaults: nothing in the URL.
    expect(window.location.search).toBe("");
  });

  test("Host: charts the host the monitor watches, as ingest stores its name", async () => {
    const query: MetricQueryConfigData = queryOf({
      metricName: "system.cpu.utilization",
    });
    readsAre({
      monitorType: MonitorType.Host,
      monitorSteps: monitorStepsOf({
        monitorType: MonitorType.Host,
        settings: { hostIdentifier: "Web-01" },
        query,
      }),
    });

    renderPanel(snapshotOf({ queryConfigs: [query] }));

    await waitFor(() => {
      expect(lastFetchedAttributes()).toEqual({
        "resource.host.name": "web-01",
      });
    });
    expect(
      await screen.findByTestId(EVENT_METRIC_SCOPE_NOTE_TEST_ID),
    ).toHaveTextContent("Charted for Web-01, which this monitor checks now.");
  });

  test("Kubernetes: the series the incident is about, inside the cluster the monitor watches", async () => {
    const grouped: MetricQueryConfigData = queryOf({
      metricName: "k8s.node.cpu.utilization",
      groupBy: ["resource.k8s.node.name"],
    });
    readsAre({
      monitorType: MonitorType.Kubernetes,
      monitorSteps: monitorStepsOf({
        monitorType: MonitorType.Kubernetes,
        settings: { clusterIdentifier: "prod" },
        query: grouped,
      }),
    });

    // As the incident page hands it over: narrowed to its own series.
    renderPanel(
      snapshotOf({
        queryConfigs: [
          queryOf({
            metricName: "k8s.node.cpu.utilization",
            groupBy: ["resource.k8s.node.name"],
            attributes: { "resource.k8s.node.name": "node-7" },
          }),
        ],
      }),
      { seriesSummary: "resource.k8s.node.name = node-7" },
    );

    await waitFor(() => {
      expect(lastFetchedAttributes()).toEqual({
        "resource.k8s.node.name": "node-7",
        "resource.k8s.cluster.name": "prod",
      });
    });
    expect(
      screen.getByText(
        "Metrics related to this incident, scoped to the affected series (resource.k8s.node.name = node-7).",
      ),
    ).toBeInTheDocument();
  });

  test("an alert reads its own monitor, and is narrowed the same way", async () => {
    readsAre(PROXMOX_NOW);

    renderPanel(snapshotOf({ queryConfigs: [PROXMOX_QUERY] }), {
      subject: EventMetricSubject.Alert,
      eventId: ALERT_ID,
    });

    await waitFor(() => {
      expect(lastFetchedAttributes()).toMatchObject({
        "resource.proxmox.cluster.name": "pve-prod",
      });
    });
    expect(
      (getItemMock.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(Alert);
  });

  test("the note goes once the reader picks metrics of their own", async () => {
    readsAre(PROXMOX_NOW);
    window.history.replaceState(
      {},
      "",
      `/dashboard/p/incidents/incident-1?metricsQueries=${encodeURIComponent(
        JSON.stringify([{ metricName: "pve_memory_usage_bytes" }]),
      )}`,
    );

    renderPanel(snapshotOf({ queryConfigs: [PROXMOX_QUERY] }));

    await waitFor(() => {
      expect(monitorWasRead()).toBe(true);
      expect(fetchResultsMock).toHaveBeenCalled();
    });
    await settle();

    expect(
      screen.queryByTestId(EVENT_METRIC_SCOPE_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      (
        fetchResultsMock.mock.calls[
          fetchResultsMock.mock.calls.length - 1
        ]![0] as { metricViewData: MetricViewData }
      ).metricViewData.queryConfigs[0]?.metricQueryData.filterData.metricName,
    ).toBe("pve_memory_usage_bytes");
  });

  test("an episode's card narrows the snapshot of the member it shows", async () => {
    readsAre(PROXMOX_NOW);

    render(
      <TelemetrySnapshotPanel
        telemetryQuery={snapshotOf({ queryConfigs: [PROXMOX_QUERY] })}
        snapshotWindow={EVALUATED}
        seriesSummary=""
        eventNoun="incident"
        subject={EventMetricSubject.IncidentEpisode}
        startedAt={STARTED_AT}
        stateTimeline={[]}
        states={[]}
        metricRuleEventId={INCIDENT_ID}
      />,
    );

    await waitFor(() => {
      expect(lastFetchedAttributes()).toMatchObject({
        "resource.proxmox.cluster.name": "pve-prod",
      });
    });
    expect(
      screen.getByTestId(EVENT_METRIC_SCOPE_NOTE_TEST_ID),
    ).toBeInTheDocument();
  });
});

describe("an incident whose snapshot keeps its monitor's scope", () => {
  test("charts each query with the scope it was read with, and says nothing", async () => {
    readsAre(PROXMOX_NOW);

    renderPanel(
      snapshotOf({
        queryConfigs: [PROXMOX_QUERY],
        scopes: [
          {
            "resource.proxmox.cluster.name": "pve-prod",
            "pve.scope": "node",
            "pve.id": "pve1",
          },
        ],
      }),
    );

    await waitFor(() => {
      expect(lastFetchedAttributes()).toEqual({
        "resource.proxmox.cluster.name": "pve-prod",
        "pve.scope": "node",
        "pve.id": "pve1",
      });
    });
    await waitFor(() => {
      expect(lastCharts?.thresholds?.[0]).toMatchObject({ value: 90 });
    });
    expect(
      screen.queryByTestId(EVENT_METRIC_SCOPE_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  test("charts it from the start: the first fetch is already narrowed", async () => {
    readsAre(PROXMOX_NOW);

    renderPanel(
      snapshotOf({
        queryConfigs: [PROXMOX_QUERY],
        scopes: [{ "resource.proxmox.cluster.name": "pve-prod" }],
      }),
    );

    await waitFor(() => {
      expect(fetchResultsMock).toHaveBeenCalled();
    });
    expect(
      (fetchResultsMock.mock.calls[0]![0] as { metricViewData: MetricViewData })
        .metricViewData.queryConfigs[0]?.metricQueryData.filterData.attributes,
    ).toEqual({ "resource.proxmox.cluster.name": "pve-prod" });
  });
});

describe("charted as the snapshot keeps it, with nothing said", () => {
  test("a snapshot that keeps its scope, though the monitor watches another cluster now", async () => {
    readsAre(PROXMOX_NOW);

    renderPanel(
      snapshotOf({
        queryConfigs: [PROXMOX_QUERY],
        scopes: [{ "resource.proxmox.cluster.name": "pve-old" }],
      }),
    );

    await waitFor(() => {
      expect(monitorWasRead()).toBe(true);
    });
    await settle();

    for (const call of fetchResultsMock.mock.calls) {
      expect(
        (call[0] as { metricViewData: MetricViewData }).metricViewData
          .queryConfigs[0]?.metricQueryData.filterData.attributes,
      ).toEqual({ "resource.proxmox.cluster.name": "pve-old" });
    }
    expect(
      screen.queryByTestId(EVENT_METRIC_SCOPE_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
    // Its rule is still drawn.
    await waitFor(() => {
      expect(lastCharts?.thresholds?.[0]).toMatchObject({ value: 90 });
    });
  });

  test("an old snapshot whose monitor cannot be read", async () => {
    readsAre({ monitorFails: true });

    renderPanel(snapshotOf({ queryConfigs: [PROXMOX_QUERY] }));

    await waitFor(() => {
      expect(monitorWasRead()).toBe(true);
    });
    await settle();

    expect(lastFetchedAttributes()).toBeUndefined();
    expect(
      screen.queryByTestId(EVENT_METRIC_SCOPE_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("an old snapshot of a Metrics monitor, whose queries carry their own filters", async () => {
    const query: MetricQueryConfigData = queryOf({
      metricName: "http.server.duration",
      attributes: { "resource.service.name": "checkout" },
    });
    readsAre({
      monitorType: MonitorType.Metrics,
      monitorSteps: monitorStepsOf({
        monitorType: MonitorType.Metrics,
        settings: {},
        query,
      }),
    });

    renderPanel(snapshotOf({ queryConfigs: [query] }));

    await waitFor(() => {
      expect(monitorWasRead()).toBe(true);
    });
    await settle();

    expect(lastFetchedAttributes()).toEqual({
      "resource.service.name": "checkout",
    });
    expect(
      screen.queryByTestId(EVENT_METRIC_SCOPE_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

/*
 * Issue #6266: an incident a Metrics monitor limited to some services
 * opened charts those services only.
 */
describe("an incident of a Metrics monitor limited to some services", () => {
  const API: string = "44444444-4444-4444-8444-444444444444";
  const CHECKOUT: string = "55555555-5555-4555-8555-555555555555";

  const QUERY: MetricQueryConfigData = queryOf({
    metricName: "http.server.duration",
  });

  function lastFetchedServices(): unknown {
    const calls: Array<Array<unknown>> = fetchResultsMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return (calls[calls.length - 1]![0] as { metricViewData: MetricViewData })
      .metricViewData.queryConfigs[0]?.metricQueryData.filterData
      .telemetryServiceIds;
  }

  test("a snapshot that keeps its services charts them from the first read, and says nothing", async () => {
    readsAre({
      monitorType: MonitorType.Metrics,
      monitorSteps: monitorStepsOf({
        monitorType: MonitorType.Metrics,
        settings: { telemetryServiceIds: [CHECKOUT] },
        query: QUERY,
      }),
    });

    renderPanel({
      ...snapshotOf({ queryConfigs: [QUERY], scopes: [null] }),
      metricServiceIds: [API],
    });

    await waitFor(() => {
      expect(fetchResultsMock).toHaveBeenCalled();
    });
    expect(
      (fetchResultsMock.mock.calls[0]![0] as { metricViewData: MetricViewData })
        .metricViewData.queryConfigs[0]?.metricQueryData.filterData
        .telemetryServiceIds,
    ).toEqual([API]);

    await waitFor(() => {
      expect(monitorWasRead()).toBe(true);
    });
    await settle();
    // Still the services it was read for, not the monitor's now.
    expect(lastFetchedServices()).toEqual([API]);
    expect(
      screen.queryByTestId(EVENT_METRIC_SCOPE_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("one stored before charts the services the monitor is limited to now, and says so", async () => {
    readsAre({
      monitorType: MonitorType.Metrics,
      monitorSteps: monitorStepsOf({
        monitorType: MonitorType.Metrics,
        settings: { telemetryServiceIds: [API, CHECKOUT] },
        query: QUERY,
      }),
    });

    renderPanel(snapshotOf({ queryConfigs: [QUERY] }));

    await waitFor(() => {
      expect(lastFetchedServices()).toEqual([API, CHECKOUT]);
    });
    expect(
      await screen.findByTestId(EVENT_METRIC_SCOPE_NOTE_TEST_ID),
    ).toHaveTextContent("Charted for what this monitor checks now.");
  });
});
