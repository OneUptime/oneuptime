import { describe, expect, test } from "@jest/globals";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Wildcard from "Common/Types/BaseDatabase/Wildcard";
import Dictionary from "Common/Types/Dictionary";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import ObjectID from "Common/Types/ObjectID";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import MetricTelemetrySnapshot from "Common/Utils/Monitor/MetricTelemetrySnapshot";

/*
 * The companion derivation loads ModelAPI and ProjectUtil (through the
 * metric pivot), which read `window` at import time: stood in for, as in
 * TelemetryCompanionSignals.test.ts.
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return { __esModule: true, default: { getList: jest.fn() } };
});

jest.mock("Common/UI/Utils/Project", () => {
  return { __esModule: true, default: { getCurrentProjectId: jest.fn() } };
});

import {
  CompanionSignalQueries,
  deriveCompanionSignalQueries,
} from "../../FeatureSet/Dashboard/src/Utils/TelemetryCompanionSignals";

/*
 * Issue #6265 keeps beside each query of an incident's metric snapshot the
 * filters its infrastructure monitor read it with, for the incident's
 * metric card. The incident's Logs, Traces and Exceptions tabs take the
 * metric queries' own equality filters as their scope, and most of what an
 * infrastructure monitor adds are labels only its metrics carry - a Proxmox
 * `pve.id`, a Ceph daemon, a container runtime - so carried to the logs
 * they would match nothing, and the tab would say nothing was logged. These
 * tabs read what they always did: the queries' own filters.
 */

const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-11-07T10:00:00.000Z"),
  new Date("2026-11-07T10:05:00.000Z"),
);

const queryOf: (attributes?: Dictionary<unknown>) => MetricQueryConfigData = (
  attributes?: Dictionary<unknown>,
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
        metricName: "container.cpu.utilization",
        aggegationType: MetricsAggregationType.Avg,
        ...(attributes ? { attributes } : {}),
      } as never,
    },
  };
};

function snapshotOf(
  query: MetricQueryConfigData,
  read: Dictionary<unknown> | undefined,
): TelemetryQuery {
  const response: MetricMonitorResponse = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    startAndEndDate: WINDOW,
    metricResult: [],
    metricViewConfig: { queryConfigs: [query], formulaConfigs: [] },
    queryAttributes: [read],
  };

  return MetricTelemetrySnapshot.fromResponse(response);
}

function companionsOf(telemetryQuery: TelemetryQuery): CompanionSignalQueries {
  return deriveCompanionSignalQueries({
    telemetryQuery: telemetryQuery,
    snapshotWindow: WINDOW,
  });
}

describe("an infrastructure incident's Logs, Traces and Exceptions tabs", () => {
  test.each([
    [
      "Docker: its host, runtime and container",
      {
        "resource.host.name": "docker-1",
        "resource.container.runtime": "docker",
        "resource.container.name": "api",
      },
    ],
    [
      "Proxmox: its cluster and node",
      {
        "resource.proxmox.cluster.name": "pve-prod",
        "pve.scope": "node",
        "pve.id": "pve1",
      },
    ],
    [
      "Docker Swarm: its image glob and tasks only",
      {
        "resource.docker.swarm.cluster.name": "swarm-1",
        "resource.container.image.name": new Wildcard<string>(["nginx"]),
        "resource.docker.swarm.task.id": new NotNull(),
      },
    ],
  ])(
    "%s: carry no more than before the scope was kept",
    (_name: string, read: Dictionary<unknown>) => {
      const before: CompanionSignalQueries = companionsOf(
        snapshotOf(queryOf(), undefined),
      );
      const after: CompanionSignalQueries = companionsOf(
        snapshotOf(queryOf(), read),
      );

      expect(after).toEqual(before);
      expect(after.logs?.logQuery).not.toHaveProperty("attributes");
      expect(after.traces?.notCarried).toEqual([]);
    },
  );

  test("a filter of the query's own is carried, as it always was", () => {
    const companions: CompanionSignalQueries = companionsOf(
      snapshotOf(queryOf({ "resource.service.name": "checkout" }), {
        "resource.service.name": "checkout",
        "resource.host.name": "web-01",
      }),
    );

    expect(
      (companions.logs?.logQuery as Record<string, unknown> | undefined)?.[
        "attributes"
      ],
    ).toEqual({ "resource.service.name": "checkout" });
  });
});
