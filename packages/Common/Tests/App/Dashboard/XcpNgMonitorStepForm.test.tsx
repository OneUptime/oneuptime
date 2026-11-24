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
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The XCP-ng monitor's step form, drawn for real: what it saves when a
 * new monitor opens, what a metric of your own becomes, and the filters it
 * offers. Its MetricView is a stand-in (MetricView is held to its charts in
 * its own suites), and the pool list is read from a mocked ModelAPI.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div", { "data-testid": "metric-view" });
      },
    };
  },
);

import XcpNgMonitorStepForm, {
  XCP_NG_SCOPE_OPTIONS,
  buildXcpNgCustomMetricStep,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/XcpNgMonitor/XcpNgMonitorStepForm";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorStepXcpNgMonitor, {
  MonitorStepXcpNgMonitorUtil,
} from "../../../Types/Monitor/MonitorStepXcpNgMonitor";
import {
  XcpNgMetricDefinition,
  getAllXcpNgMetrics,
  getXcpNgMetricById,
} from "../../../Types/Monitor/XcpNgMetricCatalog";
import {
  getXcpNgAlertTemplateById,
  getXcpNgDefaultAlertTemplateId,
} from "../../../Types/Monitor/XcpNgAlertTemplates";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import {
  XCP_NG_ID_ATTRIBUTE,
  XcpNgDerivedSeries,
  XcpNgScope,
  XcpNgSeries,
} from "../../../Types/XcpNg/XcpNgTelemetry";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";

const POOL: string = "6b3e4a1c-2f9d-4e8b-a7c5-0d1e2f3a4b5c";
const HOST_UUID: string = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

function metric(id: string): XcpNgMetricDefinition {
  const found: XcpNgMetricDefinition | undefined = getXcpNgMetricById(id);
  expect(found).toBeDefined();
  return found!;
}

function onlyQuery(step: MonitorStepXcpNgMonitor): MetricQueryConfigData {
  expect(step.metricViewConfig.queryConfigs).toHaveLength(1);
  return step.metricViewConfig.queryConfigs[0]!;
}

function withPool(
  overrides: Partial<MonitorStepXcpNgMonitor> = {},
): MonitorStepXcpNgMonitor {
  return {
    ...MonitorStepXcpNgMonitorUtil.getDefault(),
    poolIdentifier: POOL,
    ...overrides,
  };
}

describe("a metric of your own (buildXcpNgCustomMetricStep)", () => {
  test("a host's metric alerts once per host: grouped by the object's UUID", () => {
    const step: MonitorStepXcpNgMonitor = buildXcpNgCustomMetricStep({
      current: withPool(),
      metric: metric("xcp-host-cpu-average"),
    });
    const query: MetricQueryConfigData = onlyQuery(step);

    expect(query.metricQueryData.filterData.metricName).toBe(
      XcpNgSeries.HostCpuAverage,
    );
    expect(query.metricQueryData.groupByAttributeKeys).toEqual([
      XCP_NG_ID_ATTRIBUTE,
    ]);
    expect(query.metricAliasData?.metricVariable).toBe("xcp_host_cpu_average");
    expect(query.metricAliasData?.legendUnit).toBe("ratio");
    expect(step.resourceFilters).toEqual({ scope: XcpNgScope.Host });
    expect(step.poolIdentifier).toBe(POOL);
  });

  test("the pool's own heartbeat is read whole: one series per pool", () => {
    const step: MonitorStepXcpNgMonitor = buildXcpNgCustomMetricStep({
      current: withPool(),
      metric: metric("xcp-pool-connected"),
    });
    const query: MetricQueryConfigData = onlyQuery(step);

    expect(query.metricQueryData.filterData.metricName).toBe(
      XcpNgSeries.PoolConnected,
    );
    expect(query.metricQueryData.groupByAttributeKeys).toBeUndefined();
    expect(step.resourceFilters).toEqual({ scope: XcpNgScope.Pool });
  });

  test("every catalog metric reads its own series, with its own aggregation, on its own kind of object", () => {
    for (const definition of getAllXcpNgMetrics()) {
      const step: MonitorStepXcpNgMonitor = buildXcpNgCustomMetricStep({
        current: withPool(),
        metric: definition,
      });
      const query: MetricQueryConfigData = onlyQuery(step);

      expect({
        id: definition.id,
        metricName: query.metricQueryData.filterData.metricName,
        aggregation: query.metricQueryData.filterData.aggegationType,
        scope: step.resourceFilters.scope,
        grouped: Boolean(query.metricQueryData.groupByAttributeKeys),
        variable: query.metricAliasData?.metricVariable,
      }).toEqual({
        id: definition.id,
        metricName: definition.metricName,
        aggregation: definition.defaultAggregation,
        scope: definition.defaultResourceScope,
        grouped: definition.defaultResourceScope !== XcpNgScope.Pool,
        // A formula and a criteria name the query by it: no dashes.
        variable: definition.id.replace(/-/g, "_"),
      });
      expect(query.metricAliasData?.metricVariable).not.toContain("-");
    }
  });

  test("a metric with no unit of its own writes none", () => {
    const unitless: XcpNgMetricDefinition | undefined =
      getAllXcpNgMetrics().find(
        (definition: XcpNgMetricDefinition): boolean => {
          return !definition.unit;
        },
      );

    expect(unitless).toBeDefined();
    expect(
      onlyQuery(
        buildXcpNgCustomMetricStep({ current: withPool(), metric: unitless! }),
      ).metricAliasData?.legendUnit,
    ).toBeUndefined();
  });

  test("keeps the host name typed already, on any kind of object", () => {
    const step: MonitorStepXcpNgMonitor = buildXcpNgCustomMetricStep({
      current: withPool({
        resourceFilters: { scope: XcpNgScope.Host, hostName: "xcp-host-01" },
      }),
      metric: metric("xcp-vm-cpu-usage"),
    });

    expect(step.resourceFilters).toEqual({
      scope: XcpNgScope.VM,
      hostName: "xcp-host-01",
    });
  });

  test("keeps a UUID typed for the same kind of object, and drops one that names another kind", () => {
    const sameKind: MonitorStepXcpNgMonitor = buildXcpNgCustomMetricStep({
      current: withPool({
        resourceFilters: { scope: XcpNgScope.Host, xcpNgId: HOST_UUID },
      }),
      metric: metric("xcp-host-cpu-average"),
    });
    const otherKind: MonitorStepXcpNgMonitor = buildXcpNgCustomMetricStep({
      current: withPool({
        resourceFilters: { scope: XcpNgScope.Host, xcpNgId: HOST_UUID },
      }),
      metric: metric("xcp-vm-cpu-usage"),
    });

    expect(sameKind.resourceFilters.xcpNgId).toBe(HOST_UUID);
    // A host's UUID names no VM: kept, the monitor would read nothing.
    expect(otherKind.resourceFilters.xcpNgId).toBeUndefined();
  });

  test("keeps the step's window and the pool it is bound to", () => {
    const step: MonitorStepXcpNgMonitor = buildXcpNgCustomMetricStep({
      current: withPool({
        rollingTime: RollingTime.Past15Minutes,
        resourceId: "pool-row-id",
      }),
      metric: metric("xcp-host-cpu-average"),
    });

    expect(step.rollingTime).toBe(RollingTime.Past15Minutes);
    expect(step.resourceId).toBe("pool-row-id");
  });

  test("a step written with no window reads the last five minutes", () => {
    const step: MonitorStepXcpNgMonitor = buildXcpNgCustomMetricStep({
      current: withPool({ rollingTime: undefined as unknown as RollingTime }),
      metric: metric("xcp-host-cpu-average"),
    });

    expect(step.rollingTime).toBe(RollingTime.Past5Minutes);
  });

  test("a step with no pool yet builds one for no pool, rather than failing", () => {
    const step: MonitorStepXcpNgMonitor = buildXcpNgCustomMetricStep({
      current: MonitorStepXcpNgMonitorUtil.getDefault(),
      metric: metric("xcp-host-cpu-average"),
    });

    expect(step.poolIdentifier).toBe("");
    expect(step.resourceId).toBeUndefined();
  });
});

describe("the Resource Scope options", () => {
  test("are every scope ingest stamps, each once, the pool's last", () => {
    const values: Array<unknown> = XCP_NG_SCOPE_OPTIONS.map(
      (option: DropdownOption): unknown => {
        return option.value;
      },
    );

    expect([...values].sort()).toEqual([...Object.values(XcpNgScope)].sort());
    expect(values[values.length - 1]).toBe(XcpNgScope.Pool);
  });

  test("are named as the pool pages name each kind of object", () => {
    expect(
      XCP_NG_SCOPE_OPTIONS.map((option: DropdownOption): string => {
        return option.label as string;
      }),
    ).toEqual([
      "Host",
      "VM",
      "Storage Repository",
      "Virtual Disk",
      "XOSTOR",
      "XCP-ng Pool",
    ]);
  });
});

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  getListMock.mockReset();
  getListMock.mockImplementation(() => {
    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
  });
});

afterEach(() => {
  cleanup();
});

describe("a new XCP-ng monitor", () => {
  test("starts on Pool Disconnected, which builds its query and its criteria", async () => {
    const onChange: MockFunction = getJestMockFunction();
    const onCriteria: MockFunction = getJestMockFunction();

    render(
      <XcpNgMonitorStepForm
        monitorStepXcpNgMonitor={MonitorStepXcpNgMonitorUtil.getDefault()}
        onChange={onChange}
        onMonitorCriteriaChange={onCriteria}
        monitorName="Production pool"
      />,
    );
    await settle();

    expect(
      getXcpNgAlertTemplateById(getXcpNgDefaultAlertTemplateId())?.name,
    ).toBe("Pool Disconnected");
    expect(screen.getByTestId("alert-template-picked")).toHaveAttribute(
      "data-alert-template-id",
      getXcpNgDefaultAlertTemplateId(),
    );

    const saved: MonitorStepXcpNgMonitor = onChange.mock
      .calls[0]![0] as MonitorStepXcpNgMonitor;
    expect(
      saved.metricViewConfig.queryConfigs[0]?.metricQueryData.filterData
        .metricName,
    ).toBe(XcpNgSeries.PoolConnected);
    expect(
      saved.metricViewConfig.queryConfigs[0]?.metricQueryData.filterData
        .aggegationType,
    ).toBe(MetricsAggregationType.Count);
    expect(saved.rollingTime).toBe(RollingTime.Past5Minutes);

    expect(onCriteria).toHaveBeenCalledTimes(1);
    const criteria: MonitorCriteria = onCriteria.mock
      .calls[0]![0] as MonitorCriteria;
    expect(criteria.data?.monitorCriteriaInstanceArray.length).toBeGreaterThan(
      0,
    );
  });

  test("a saved monitor keeps what it reads: no template is applied over it", async () => {
    const onChange: MockFunction = getJestMockFunction();
    const onCriteria: MockFunction = getJestMockFunction();
    const saved: MonitorStepXcpNgMonitor = buildXcpNgCustomMetricStep({
      current: withPool(),
      metric: metric("xcp-host-cpu-average"),
    });

    render(
      <XcpNgMonitorStepForm
        monitorStepXcpNgMonitor={saved}
        onChange={onChange}
        onMonitorCriteriaChange={onCriteria}
      />,
    );
    await settle();

    expect(onChange).not.toHaveBeenCalled();
    expect(onCriteria).not.toHaveBeenCalled();
  });

  test("a saved Host Offline monitor opens on its template, picked", async () => {
    const template: ReturnType<typeof getXcpNgAlertTemplateById> =
      getXcpNgAlertTemplateById("xcp-ng-host-offline");
    expect(template).toBeDefined();

    const step: MonitorStepXcpNgMonitor = template!.getMonitorStep({
      poolIdentifier: POOL,
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "Host Offline",
    }).data!.xcpNgMonitor!;

    expect(
      step.metricViewConfig.queryConfigs[0]?.metricQueryData.filterData
        .metricName,
    ).toBe(XcpNgDerivedSeries.HostRunning);

    render(
      <XcpNgMonitorStepForm
        monitorStepXcpNgMonitor={step}
        onChange={getJestMockFunction()}
      />,
    );
    await settle();

    expect(screen.getByTestId("alert-template-picked")).toHaveAttribute(
      "data-alert-template-id",
      "xcp-ng-host-offline",
    );
  });

  test("names the XCP-ng pool it watches, and offers to add one when there is none", async () => {
    render(
      <XcpNgMonitorStepForm
        monitorStepXcpNgMonitor={MonitorStepXcpNgMonitorUtil.getDefault()}
        onChange={getJestMockFunction()}
      />,
    );
    await settle();

    const setup: HTMLElement = screen.getByTestId(
      "infrastructure-monitor-setup",
    );

    expect(within(setup).getAllByText("XCP-ng Pool").length).toBeGreaterThan(0);
    expect(
      within(setup).getAllByText("Add XCP-ng Pool").length,
    ).toBeGreaterThan(0);
  });

  test("lists pools read from XcpNgPool, with their UUID read too", async () => {
    render(
      <XcpNgMonitorStepForm
        monitorStepXcpNgMonitor={MonitorStepXcpNgMonitorUtil.getDefault()}
        onChange={getJestMockFunction()}
      />,
    );
    await settle();

    expect(getListMock).toHaveBeenCalled();
    const request: { select: Record<string, unknown> } = getListMock.mock
      .calls[0]![0] as { select: Record<string, unknown> };
    expect(request.select).toMatchObject({
      _id: true,
      name: true,
      poolIdentifier: true,
      lastSeenAt: true,
    });
  });

  test("Advanced offers the three filters, and a filter typed is saved on the step", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <XcpNgMonitorStepForm
        monitorStepXcpNgMonitor={buildXcpNgCustomMetricStep({
          current: withPool(),
          metric: metric("xcp-host-cpu-average"),
        })}
        onChange={onChange}
      />,
    );
    await settle();

    const tab: HTMLElement | null = screen.queryByRole("tab", {
      name: "Advanced",
    });
    if (tab) {
      fireEvent.click(tab);
    }
    await settle();

    expect(screen.getAllByText("Resource Scope").length).toBeGreaterThan(0);
    expect(screen.getAllByText("UUID").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Host Name").length).toBeGreaterThan(0);

    fireEvent.change(screen.getAllByPlaceholderText("e.g. xcp-host-01")[0]!, {
      target: { value: "xcp-host-07" },
    });
    await settle();

    const saved: MonitorStepXcpNgMonitor = onChange.mock.calls[
      onChange.mock.calls.length - 1
    ]![0] as MonitorStepXcpNgMonitor;
    expect(saved.resourceFilters).toEqual({
      scope: XcpNgScope.Host,
      hostName: "xcp-host-07",
    });
    // The pool and the query stay as they were.
    expect(saved.poolIdentifier).toBe(POOL);
    expect(saved.metricViewConfig.queryConfigs).toHaveLength(1);
  });
});
