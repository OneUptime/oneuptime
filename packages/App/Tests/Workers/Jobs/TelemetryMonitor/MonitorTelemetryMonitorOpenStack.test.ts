import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricMonitorResponse, {
  OpenStackResourceBreakdown,
} from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "Common/Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepOpenStackMonitor, {
  MonitorStepOpenStackMonitorUtil,
  OpenStackResourceFilters,
} from "Common/Types/Monitor/MonitorStepOpenStackMonitor";
import {
  OPENSTACK_ANCHOR_METRIC_ALIAS,
  getOpenStackAlertTemplateById,
} from "Common/Types/Monitor/OpenStackAlertTemplates";
import ObjectID from "Common/Types/ObjectID";

/*
 * What an OpenStack monitor reads.
 *
 * The exporter does not spell a label the same way on every series, so a filter
 * or a group-by has to be turned into each series' own spelling here, where the
 * criteria evaluator cannot see it: a project filter that reads `tenant_id` on a
 * floating IP matches nothing, and an external network whose `id` is not lined up
 * with its address counts' `network_id` never reads as external.
 */

// Keep the heavy worker module from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

// The worker transitively loads the native `isolated-vm` addon; stub it.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { aggregateBy: jest.fn(), findBy: jest.fn() },
  };
});
jest.mock("Common/Server/Services/MetricTypeService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import { monitorOpenStack } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";
import { FoldedReadArgs, foldRowsAsSqlRead } from "./SqlGroupedFold";

const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;

const REGION: string = "RegionOne";
const REGION_LABEL: string = "openstack.region.name";

const sampleTime: Date = new Date("2026-09-25T10:00:30.000Z");

interface RawRow {
  time: Date;
  value: number;
  attributes: JSONObject;
}

function row(value: number, attributes: JSONObject): RawRow {
  return {
    time: sampleTime,
    value,
    attributes: { [REGION_LABEL]: REGION, ...attributes },
  };
}

function mockRawRows(rowsByMetricName: Dictionary<Array<RawRow>>): void {
  metricAggregateBy.mockImplementation(async (args: unknown) => {
    const aggregateArgs: FoldedReadArgs & { query: { name: string } } =
      args as FoldedReadArgs & { query: { name: string } };

    return foldRowsAsSqlRead(
      rowsByMetricName[aggregateArgs.query.name] || [],
      aggregateArgs,
    );
  });
  metricFindBy.mockImplementation(async (args: unknown) => {
    return (
      rowsByMetricName[(args as { query: { name: string } }).query.name] || []
    );
  });
}

function queryOf(metricName: string): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: metricName,
      title: undefined,
      description: undefined,
      legend: undefined,
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {
        metricName,
        aggegationType: MetricsAggregationType.Max,
      },
    },
  } as unknown as MetricQueryConfigData;
}

function read(monitorStep: MonitorStep): Promise<MetricMonitorResponse> {
  return monitorOpenStack({
    monitorStep,
    monitorId: ObjectID.generate(),
    projectId: ObjectID.generate(),
  });
}

function stepReading(
  metricNames: Array<string>,
  resourceFilters: OpenStackResourceFilters,
): MonitorStep {
  const config: MonitorStepOpenStackMonitor = {
    ...MonitorStepOpenStackMonitorUtil.getDefault(),
    cloudIdentifier: "prod",
    resourceFilters,
    metricViewConfig: {
      queryConfigs: metricNames.map(queryOf),
      formulaConfigs: [],
    },
  };

  const step: MonitorStep = new MonitorStep();
  step.setOpenStackMonitor(config);
  return step;
}

function templateStep(templateId: string): MonitorStep {
  return getOpenStackAlertTemplateById(templateId)!.getMonitorStep({
    cloudIdentifier: "prod",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Prod",
  });
}

function aggregateCallFor(metricName: string): {
  groupByAttributeKeys?: Array<string>;
  query: { attributes?: Dictionary<unknown> };
} {
  const call: Array<unknown> | undefined = metricAggregateBy.mock.calls.find(
    (args: Array<unknown>): boolean => {
      return (args[0] as { query: { name: string } }).query.name === metricName;
    },
  );

  expect(call).toBeDefined();

  return call![0] as {
    groupByAttributeKeys?: Array<string>;
    query: { attributes?: Dictionary<unknown> };
  };
}

beforeEach(() => {
  metricAggregateBy.mockReset().mockResolvedValue({ data: [] } as never);
  metricFindBy.mockReset().mockResolvedValue([] as never);
  (MetricTypeService.findBy as unknown as jest.Mock)
    .mockReset()
    .mockResolvedValue([] as never);
});

describe("an OpenStack monitor's filters", () => {
  const CLOUD: string = "resource.openstack.cloud.name";

  const ALL_FILTERS: OpenStackResourceFilters = {
    regionName: REGION,
    availabilityZone: "nova",
    hypervisorName: "compute-01",
    serviceName: "nova-compute",
    projectId: "4f2d",
  };

  test("each uses the spelling its series has, and none empties a series without that label", async () => {
    const response: MetricMonitorResponse = await read(
      stepReading(
        [
          "openstack_nova_agent_state",
          "openstack_nova_server_status",
          "openstack_neutron_floating_ip",
          "openstack_nova_up",
        ],
        ALL_FILTERS,
      ),
    );

    expect(response.queryAttributes).toEqual([
      // Nova's workers say `zone`, and name their host and binary.
      {
        [CLOUD]: "prod",
        [REGION_LABEL]: REGION,
        zone: "nova",
        hostname: "compute-01",
        service: "nova-compute",
      },
      // An instance says which hypervisor it is on, and whose it is.
      {
        [CLOUD]: "prod",
        [REGION_LABEL]: REGION,
        availability_zone: "nova",
        hypervisor_hostname: "compute-01",
        tenant_id: "4f2d",
      },
      // A floating IP says `project_id`, and has no host or zone.
      {
        [CLOUD]: "prod",
        [REGION_LABEL]: REGION,
        project_id: "4f2d",
      },
      // An API's own series has only its region.
      { [CLOUD]: "prod", [REGION_LABEL]: REGION },
    ]);
  });

  test("the read is given what the monitor says it read", async () => {
    await read(stepReading(["openstack_neutron_floating_ip"], ALL_FILTERS));

    expect(
      aggregateCallFor("openstack_neutron_floating_ip").query.attributes,
    ).toEqual({
      [CLOUD]: "prod",
      [REGION_LABEL]: REGION,
      project_id: "4f2d",
    });
  });

  test("a series the catalogue does not know takes each filter's first spelling", async () => {
    const response: MetricMonitorResponse = await read(
      stepReading(["openstack_new_series"], {
        availabilityZone: "nova",
        projectId: "4f2d",
      }),
    );

    expect(response.queryAttributes).toEqual([
      {
        [CLOUD]: "prod",
        availability_zone: "nova",
        tenant_id: "4f2d",
      },
    ]);
  });

  test("a template's own filters stay beside the monitor's", async () => {
    const step: MonitorStep = templateStep("openstack-compute-service-down");

    step.data!.openstackMonitor!.resourceFilters = { regionName: REGION };

    const response: MetricMonitorResponse = await read(step);

    expect(response.queryAttributes?.[0]).toMatchObject({
      [CLOUD]: "prod",
      [REGION_LABEL]: REGION,
      adminState: "enabled",
    });
  });
});

describe("an external network lines up with its address counts", () => {
  const PUBLIC_COUNTS: JSONObject = {
    network_id: "net-public",
    network_name: "public",
    ip_version: "4",
  };
  const TENANT_COUNTS: JSONObject = {
    network_id: "net-tenant",
    network_name: "private",
    ip_version: "4",
  };

  function seriesOf(
    response: MetricMonitorResponse,
    networkId: string,
  ): MetricSeriesResult {
    const series: MetricSeriesResult | undefined =
      response.seriesBreakdown?.find((candidate: MetricSeriesResult) => {
        return candidate.labels["network_id"] === networkId;
      });

    expect(series).toBeDefined();

    return series!;
  }

  function aliasIndex(alias: string, step: MonitorStep): number {
    return MonitorStep.getMetricsViewConfig(step)!
      .queryConfigs.map((config: MetricQueryConfigData) => {
        return config.metricAliasData?.metricVariable;
      })
      .indexOf(alias);
  }

  function valuesAt(series: MetricSeriesResult, index: number): Array<number> {
    return (
      (series.aggregatedResults[index] as AggregatedResult).data || []
    ).map((point: { value: number }) => {
      return point.value;
    });
  }

  test("reading each series by its own labels, and judging them as one", async () => {
    mockRawRows({
      openstack_neutron_network_ip_availabilities_used: [
        row(254, PUBLIC_COUNTS),
        row(10, TENANT_COUNTS),
      ],
      openstack_neutron_network_ip_availabilities_total: [
        row(254, PUBLIC_COUNTS),
        row(254, TENANT_COUNTS),
      ],
      // Neutron's own network series: `id` and `name`, on the external one only.
      openstack_neutron_network: [
        row(1, { id: "net-public", name: "public", is_external: "true" }),
      ],
      openstack_neutron_up: [row(1, {})],
    });

    const step: MonitorStep = templateStep("openstack-network-out-of-ips");
    const response: MetricMonitorResponse = await read(step);

    expect(
      aggregateCallFor("openstack_neutron_network").groupByAttributeKeys,
    ).toEqual([REGION_LABEL, "id", "name"]);
    expect(
      aggregateCallFor("openstack_neutron_network_ip_availabilities_used")
        .groupByAttributeKeys,
    ).toEqual([REGION_LABEL, "network_id", "network_name"]);

    const external: number = aliasIndex("is_external_network", step);
    const used: number = aliasIndex("addresses_used", step);
    const queryCount: number =
      MonitorStep.getMetricsViewConfig(step)!.queryConfigs.length;

    const publicNetwork: MetricSeriesResult = seriesOf(response, "net-public");
    const tenantNetwork: MetricSeriesResult = seriesOf(response, "net-tenant");

    // The marker landed on the external network's series, and only on that.
    expect(valuesAt(publicNetwork, external)).toEqual([1]);
    expect(valuesAt(tenantNetwork, external)).toEqual([]);

    // Each one's percentage is its own.
    expect(valuesAt(publicNetwork, used)).toEqual([254]);
    expect(valuesAt(publicNetwork, queryCount)).toEqual([100]);
    expect(valuesAt(tenantNetwork, queryCount)[0]).toBeCloseTo(
      (10 / 254) * 100,
      6,
    );
  });
});

describe("the series that only says a service reports", () => {
  test("is read for the criteria, and lists no part of the cloud as affected", async () => {
    mockRawRows({
      openstack_nova_agent_state: [
        row(1, {
          hostname: "compute-01",
          service: "nova-compute",
          adminState: "enabled",
        }),
      ],
      openstack_nova_up: [row(1, {})],
    });

    const step: MonitorStep = templateStep("openstack-compute-service-down");
    const aliases: Array<string | undefined> = MonitorStep.getMetricsViewConfig(
      step,
    )!.queryConfigs.map((config: MetricQueryConfigData) => {
      return config.metricAliasData?.metricVariable;
    });

    expect(aliases).toContain(OPENSTACK_ANCHOR_METRIC_ALIAS);

    const response: MetricMonitorResponse = await read(step);

    expect(aggregateCallFor("openstack_nova_up")).toBeDefined();
    expect(response.metricResult).toHaveLength(aliases.length);

    const breakdowns: Array<OpenStackResourceBreakdown> =
      response.openStackResourceBreakdowns || [];

    expect(
      breakdowns.map((breakdown: OpenStackResourceBreakdown) => {
        return breakdown.metricAlias;
      }),
    ).not.toContain(OPENSTACK_ANCHOR_METRIC_ALIAS);
    expect(breakdowns.length).toBeGreaterThan(0);
    expect(breakdowns[0]!.cloudName).toBe("prod");
    expect(breakdowns[0]!.affectedResources[0]).toMatchObject({
      hostName: "compute-01",
      serviceName: "nova-compute",
      regionName: REGION,
    });
  });
});
