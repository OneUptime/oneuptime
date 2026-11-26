import { describe, expect, test } from "@jest/globals";
import Includes from "../../../Types/BaseDatabase/Includes";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import { escapeWildcards } from "../../../Types/BaseDatabase/WildcardPattern";
import Dictionary from "../../../Types/Dictionary";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import { JOURNALD_SYSTEMD_UNIT_ATTRIBUTE } from "../../../Utils/HostCollector/HostCollectorDefaultConfig";
import MonitorResourceSignalScope, {
  CONTAINER_IMAGE_ATTRIBUTE,
  CONTAINER_NAME_ATTRIBUTE,
  CONTAINER_RUNTIME_ATTRIBUTE,
  HOST_NAME_ATTRIBUTE,
  IOT_DEVICE_ID_ATTRIBUTE,
  IOT_DEVICE_TYPE_ATTRIBUTE,
  IOT_FLEET_ATTRIBUTE,
  ResourceSignal,
  ResourceSignalScope,
  SYSTEMD_UNIT_METRIC_ATTRIBUTE,
} from "../../../Utils/Monitor/MonitorResourceSignalScope";

/*
 * A RESOURCE MONITOR'S LOGS AND TRACES ARE ITS RESOURCE'S (#10451).
 *
 * The links an incident of a Host, Docker, Podman or IoT Device monitor
 * ends with carried the metric's own attributes (a Windows service's
 * `name`), which no log line or span has, and left out the host. Each case
 * here is what the monitor read, and what its logs and traces links keep.
 */

const EMPTY_METRIC_VIEW: {
  queryConfigs: [];
  formulaConfigs: [];
} = { queryConfigs: [], formulaConfigs: [] };

function hostStep(hostIdentifier: string): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.data!.hostMonitor = {
    hostIdentifier: hostIdentifier,
    metricViewConfig: EMPTY_METRIC_VIEW,
    rollingTime: RollingTime.Past5Minutes,
  };
  return step;
}

function containerStep(data: {
  runtime: "docker" | "podman";
  hostIdentifier: string;
  containerName?: string;
  containerImage?: string;
}): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  const config: {
    hostIdentifier: string;
    containerFilters: { containerName?: string; containerImage?: string };
    metricViewConfig: typeof EMPTY_METRIC_VIEW;
    rollingTime: RollingTime;
  } = {
    hostIdentifier: data.hostIdentifier,
    containerFilters: {
      ...(data.containerName ? { containerName: data.containerName } : {}),
      ...(data.containerImage ? { containerImage: data.containerImage } : {}),
    },
    metricViewConfig: EMPTY_METRIC_VIEW,
    rollingTime: RollingTime.Past5Minutes,
  };

  if (data.runtime === "docker") {
    step.data!.dockerMonitor = config;
  } else {
    step.data!.podmanMonitor = config;
  }

  return step;
}

function iotStep(fleetIdentifier: string): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.data!.iotMonitor = {
    fleetIdentifier: fleetIdentifier,
    resourceFilters: {},
    metricViewConfig: EMPTY_METRIC_VIEW,
    rollingTime: RollingTime.Past5Minutes,
  };
  return step;
}

function scopeOf(data: {
  monitorType: MonitorType | undefined;
  signal: ResourceSignal;
  monitorStep?: MonitorStep;
  queryAttributes?: Dictionary<unknown>;
  seriesLabels?: Dictionary<unknown>;
  readAttributes?: Array<Dictionary<unknown> | undefined>;
}): ResourceSignalScope | null {
  return MonitorResourceSignalScope.getScope(data);
}

describe("which monitors read one resource's metrics", () => {
  test.each([
    MonitorType.Host,
    MonitorType.Docker,
    MonitorType.Podman,
    MonitorType.IoTDevice,
  ])("%s does: its links are its resource's", (monitorType: MonitorType) => {
    expect(MonitorResourceSignalScope.isResourceMonitorType(monitorType)).toBe(
      true,
    );
  });

  test.each([
    MonitorType.Metrics,
    MonitorType.Kubernetes,
    MonitorType.Logs,
    MonitorType.Website,
  ])(
    "%s does not: its links keep the metric's own attributes",
    (monitorType: MonitorType) => {
      expect(
        MonitorResourceSignalScope.isResourceMonitorType(monitorType),
      ).toBe(false);

      for (const signal of [ResourceSignal.Logs, ResourceSignal.Traces]) {
        expect(
          scopeOf({
            monitorType: monitorType,
            signal: signal,
            queryAttributes: { "resource.host.name": "web-01" },
          }),
        ).toBeNull();
      }
    },
  );

  test("a monitor without a type has no resource", () => {
    expect(MonitorResourceSignalScope.isResourceMonitorType(undefined)).toBe(
      false,
    );
    expect(
      scopeOf({ monitorType: undefined, signal: ResourceSignal.Logs }),
    ).toBeNull();
  });
});

describe("a Host monitor's logs and traces are its host's", () => {
  // A Windows service's monitor, as Create Monitor makes it, read by the worker.
  const spoolerRead: Dictionary<unknown> = {
    name: "Spooler",
    [HOST_NAME_ATTRIBUTE]: "web-01",
  };

  test.each([ResourceSignal.Logs, ResourceSignal.Traces])(
    "%s: the host the worker read, never the service's `name`",
    (signal: ResourceSignal) => {
      expect(
        scopeOf({
          monitorType: MonitorType.Host,
          signal: signal,
          monitorStep: hostStep("web-01"),
          queryAttributes: { name: "Spooler" },
          readAttributes: [spoolerRead],
        }),
      ).toEqual({
        attributes: { [HOST_NAME_ATTRIBUTE]: "web-01" },
        notCarried: [],
      });
    },
  );

  test("a CPU monitor's `state` is the metric's, and is left out without a word", () => {
    expect(
      scopeOf({
        monitorType: MonitorType.Host,
        signal: ResourceSignal.Logs,
        monitorStep: hostStep("db-02"),
        queryAttributes: { state: "user" },
        seriesLabels: { state: "user" },
        readAttributes: [{ state: "user", [HOST_NAME_ATTRIBUTE]: "db-02" }],
      }),
    ).toEqual({
      attributes: { [HOST_NAME_ATTRIBUTE]: "db-02" },
      notCarried: [],
    });
  });

  test("without the worker's read, the host the step names", () => {
    expect(
      scopeOf({
        monitorType: MonitorType.Host,
        signal: ResourceSignal.Traces,
        monitorStep: hostStep("  web-01 "),
        queryAttributes: { name: "Spooler" },
      }),
    ).toEqual({
      attributes: { [HOST_NAME_ATTRIBUTE]: "web-01" },
      notCarried: [],
    });
  });

  test("a host renamed since the monitor was saved: the name the worker read it by", () => {
    expect(
      scopeOf({
        monitorType: MonitorType.Host,
        signal: ResourceSignal.Logs,
        monitorStep: hostStep("old-name"),
        readAttributes: [{ [HOST_NAME_ATTRIBUTE]: "new-name" }],
      })?.attributes,
    ).toEqual({ [HOST_NAME_ATTRIBUTE]: "new-name" });
  });

  test("a monitor of every host, grouped by host: the host whose series breached", () => {
    expect(
      scopeOf({
        monitorType: MonitorType.Host,
        signal: ResourceSignal.Logs,
        monitorStep: hostStep(""),
        seriesLabels: { [HOST_NAME_ATTRIBUTE]: "web-02" },
        readAttributes: [{}],
      }),
    ).toEqual({
      attributes: { [HOST_NAME_ATTRIBUTE]: "web-02" },
      notCarried: [],
    });
  });

  test("a series of one host among the several the query reads: that host", () => {
    expect(
      scopeOf({
        monitorType: MonitorType.Host,
        signal: ResourceSignal.Traces,
        monitorStep: hostStep(""),
        queryAttributes: {
          [HOST_NAME_ATTRIBUTE]: new Includes(["web-01", "web-02"]),
        },
        seriesLabels: { [HOST_NAME_ATTRIBUTE]: "web-02" },
        readAttributes: [
          { [HOST_NAME_ATTRIBUTE]: new Includes(["web-01", "web-02"]) },
        ],
      })?.attributes,
    ).toEqual({ [HOST_NAME_ATTRIBUTE]: "web-02" });
  });

  test("a monitor of several hosts and no series: no exact host to name, and it says so", () => {
    expect(
      scopeOf({
        monitorType: MonitorType.Host,
        signal: ResourceSignal.Logs,
        monitorStep: hostStep(""),
        queryAttributes: {
          [HOST_NAME_ATTRIBUTE]: new Includes(["web-01", "web-02"]),
        },
        readAttributes: [
          { [HOST_NAME_ATTRIBUTE]: new Includes(["web-01", "web-02"]) },
        ],
      }),
    ).toEqual({ attributes: {}, notCarried: [HOST_NAME_ATTRIBUTE] });
  });

  test("a list of one host is that host", () => {
    expect(
      scopeOf({
        monitorType: MonitorType.Host,
        signal: ResourceSignal.Logs,
        monitorStep: hostStep(""),
        queryAttributes: { [HOST_NAME_ATTRIBUTE]: new Includes(["web-03"]) },
      })?.attributes,
    ).toEqual({ [HOST_NAME_ATTRIBUTE]: "web-03" });
  });

  test("a monitor of every host, ungrouped: the logs of every host", () => {
    expect(
      scopeOf({
        monitorType: MonitorType.Host,
        signal: ResourceSignal.Logs,
        monitorStep: hostStep(""),
        readAttributes: [{}],
      }),
    ).toEqual({ attributes: {}, notCarried: [] });
  });

  describe("a systemd unit's logs are its journal lines", () => {
    // As Create Monitor makes it on a unit's page, read by the worker.
    const nginxRead: Dictionary<unknown> = {
      [SYSTEMD_UNIT_METRIC_ATTRIBUTE]: "nginx.service",
      "systemd.unit.active_state": "active",
      [HOST_NAME_ATTRIBUTE]: "web-01",
    };

    test("logs: the host, and the unit by the name its journal lines carry", () => {
      expect(JOURNALD_SYSTEMD_UNIT_ATTRIBUTE).toBe("systemd.unit.name");
      expect(
        scopeOf({
          monitorType: MonitorType.Host,
          signal: ResourceSignal.Logs,
          monitorStep: hostStep("web-01"),
          queryAttributes: {
            [SYSTEMD_UNIT_METRIC_ATTRIBUTE]: "nginx.service",
            "systemd.unit.active_state": "active",
          },
          readAttributes: [nginxRead],
        }),
      ).toEqual({
        attributes: {
          [HOST_NAME_ATTRIBUTE]: "web-01",
          [JOURNALD_SYSTEMD_UNIT_ATTRIBUTE]: "nginx.service",
        },
        notCarried: [],
      });
    });

    test("traces: the host alone, as no span names a unit", () => {
      expect(
        scopeOf({
          monitorType: MonitorType.Host,
          signal: ResourceSignal.Traces,
          monitorStep: hostStep("web-01"),
          readAttributes: [nginxRead],
        }),
      ).toEqual({
        attributes: { [HOST_NAME_ATTRIBUTE]: "web-01" },
        notCarried: [],
      });
    });

    test("the host's Systemd Unit Failed alert, grouped by unit: the unit that failed", () => {
      expect(
        scopeOf({
          monitorType: MonitorType.Host,
          signal: ResourceSignal.Logs,
          monitorStep: hostStep("web-01"),
          queryAttributes: { "systemd.unit.active_state": "failed" },
          seriesLabels: { [SYSTEMD_UNIT_METRIC_ATTRIBUTE]: "cron.service" },
          readAttributes: [
            {
              "systemd.unit.active_state": "failed",
              [HOST_NAME_ATTRIBUTE]: "web-01",
            },
          ],
        })?.attributes,
      ).toEqual({
        [HOST_NAME_ATTRIBUTE]: "web-01",
        [JOURNALD_SYSTEMD_UNIT_ATTRIBUTE]: "cron.service",
      });
    });
  });
});

describe.each(["docker", "podman"] as Array<"docker" | "podman">)(
  "a %s monitor's logs and traces are its host's",
  (runtime: "docker" | "podman") => {
    const monitorType: MonitorType =
      runtime === "docker" ? MonitorType.Docker : MonitorType.Podman;

    // What the worker reads every query with (monitorDocker / monitorPodman).
    const read: (extra?: Dictionary<unknown>) => Dictionary<unknown> = (
      extra: Dictionary<unknown> = {},
    ): Dictionary<unknown> => {
      return {
        [HOST_NAME_ATTRIBUTE]: "dock-01",
        [CONTAINER_RUNTIME_ATTRIBUTE]: runtime,
        ...extra,
      };
    };

    test("logs: the host and its runtime, as the host's own Logs page reads them", () => {
      expect(
        scopeOf({
          monitorType: monitorType,
          signal: ResourceSignal.Logs,
          monitorStep: containerStep({
            runtime: runtime,
            hostIdentifier: "dock-01",
          }),
          readAttributes: [read()],
        }),
      ).toEqual({
        attributes: {
          [HOST_NAME_ATTRIBUTE]: "dock-01",
          [CONTAINER_RUNTIME_ATTRIBUTE]: runtime,
        },
        notCarried: [],
      });
    });

    test("traces: the host alone, as no application writes the runtime", () => {
      expect(
        scopeOf({
          monitorType: monitorType,
          signal: ResourceSignal.Traces,
          monitorStep: containerStep({
            runtime: runtime,
            hostIdentifier: "dock-01",
          }),
          readAttributes: [read()],
        }),
      ).toEqual({
        attributes: { [HOST_NAME_ATTRIBUTE]: "dock-01" },
        notCarried: [],
      });
    });

    test.each([ResourceSignal.Logs, ResourceSignal.Traces])(
      "%s: a container's name and image are on its metrics only, and the link says so",
      (signal: ResourceSignal) => {
        const scope: ResourceSignalScope | null = scopeOf({
          monitorType: monitorType,
          signal: signal,
          monitorStep: containerStep({
            runtime: runtime,
            hostIdentifier: "dock-01",
            containerName: "web",
            containerImage: "nginx:1.27",
          }),
          readAttributes: [
            read({
              [CONTAINER_NAME_ATTRIBUTE]: "web",
              [CONTAINER_IMAGE_ATTRIBUTE]: "nginx:1.27",
            }),
          ],
        });

        expect(scope?.attributes[HOST_NAME_ATTRIBUTE]).toBe("dock-01");
        expect(scope?.attributes[CONTAINER_NAME_ATTRIBUTE]).toBeUndefined();
        expect(scope?.attributes[CONTAINER_IMAGE_ATTRIBUTE]).toBeUndefined();
        expect(scope?.notCarried).toEqual([
          CONTAINER_NAME_ATTRIBUTE,
          CONTAINER_IMAGE_ATTRIBUTE,
        ]);
      },
    );

    test("a monitor grouped by container: the container is not carried either", () => {
      expect(
        scopeOf({
          monitorType: monitorType,
          signal: ResourceSignal.Logs,
          monitorStep: containerStep({
            runtime: runtime,
            hostIdentifier: "dock-01",
          }),
          seriesLabels: { [CONTAINER_NAME_ATTRIBUTE]: "api" },
          readAttributes: [read()],
        })?.notCarried,
      ).toEqual([CONTAINER_NAME_ATTRIBUTE]);
    });

    test("without the worker's read: what it reads for the step - its host, the runtime, its container", () => {
      expect(
        scopeOf({
          monitorType: monitorType,
          signal: ResourceSignal.Logs,
          monitorStep: containerStep({
            runtime: runtime,
            hostIdentifier: "dock-01",
            containerName: "web",
          }),
        }),
      ).toEqual({
        attributes: {
          [HOST_NAME_ATTRIBUTE]: "dock-01",
          [CONTAINER_RUNTIME_ATTRIBUTE]: runtime,
        },
        notCarried: [CONTAINER_NAME_ATTRIBUTE],
      });
    });

    test("a monitor of every host's containers: the runtime alone", () => {
      expect(
        scopeOf({
          monitorType: monitorType,
          signal: ResourceSignal.Logs,
          monitorStep: containerStep({ runtime: runtime, hostIdentifier: "" }),
          readAttributes: [{ [CONTAINER_RUNTIME_ATTRIBUTE]: runtime }],
        }),
      ).toEqual({
        attributes: { [CONTAINER_RUNTIME_ATTRIBUTE]: runtime },
        notCarried: [],
      });
    });
  },
);

describe("an IoT Device monitor's logs and traces are its fleet's", () => {
  // The worker reads the fleet case aside: an escaped glob of its name.
  const fleetRead: Dictionary<unknown> = {
    [IOT_FLEET_ATTRIBUTE]: new Wildcard<string>([
      escapeWildcards("Warehouse *1*"),
    ]),
  };

  test.each([ResourceSignal.Logs, ResourceSignal.Traces])(
    "%s: the fleet, by its name as written",
    (signal: ResourceSignal) => {
      expect(
        scopeOf({
          monitorType: MonitorType.IoTDevice,
          signal: signal,
          monitorStep: iotStep("Warehouse *1*"),
          readAttributes: [fleetRead],
        }),
      ).toEqual({
        attributes: { [IOT_FLEET_ATTRIBUTE]: "Warehouse *1*" },
        notCarried: [],
      });
    },
  );

  test("a device's id and type are on its readings only, and the link says so", () => {
    expect(
      scopeOf({
        monitorType: MonitorType.IoTDevice,
        signal: ResourceSignal.Logs,
        monitorStep: iotStep("Warehouse"),
        queryAttributes: { [IOT_DEVICE_TYPE_ATTRIBUTE]: "thermostat" },
        seriesLabels: { [IOT_DEVICE_ID_ATTRIBUTE]: "dev-17" },
        readAttributes: [
          {
            [IOT_FLEET_ATTRIBUTE]: new Wildcard<string>(["Warehouse"]),
            [IOT_DEVICE_TYPE_ATTRIBUTE]: "thermostat",
          },
        ],
      }),
    ).toEqual({
      attributes: { [IOT_FLEET_ATTRIBUTE]: "Warehouse" },
      notCarried: [IOT_DEVICE_ID_ATTRIBUTE, IOT_DEVICE_TYPE_ATTRIBUTE],
    });
  });

  test("without the worker's read: the step's fleet, and its device filters are not carried", () => {
    const step: MonitorStep = iotStep("Warehouse");
    step.data!.iotMonitor!.resourceFilters = {
      deviceId: "dev-17",
      deviceType: " ",
    };

    expect(
      scopeOf({
        monitorType: MonitorType.IoTDevice,
        signal: ResourceSignal.Traces,
        monitorStep: step,
      }),
    ).toEqual({
      attributes: { [IOT_FLEET_ATTRIBUTE]: "Warehouse" },
      notCarried: [IOT_DEVICE_ID_ATTRIBUTE],
    });
  });

  test("a fleet read by a pattern names no one fleet", () => {
    expect(
      scopeOf({
        monitorType: MonitorType.IoTDevice,
        signal: ResourceSignal.Logs,
        monitorStep: iotStep(""),
        queryAttributes: {
          [IOT_FLEET_ATTRIBUTE]: new Wildcard<string>(["warehouse-*"]),
        },
      }),
    ).toEqual({ attributes: {}, notCarried: [IOT_FLEET_ATTRIBUTE] });
  });
});

describe("what a link is read from", () => {
  test("a series label named like what every object inherits is read as its own", () => {
    // As an incident's labels read back from JSON: own keys.
    const labels: Dictionary<unknown> = JSON.parse(
      '{"__proto__": "x", "constructor": "y", "resource.host.name": "web-09"}',
    ) as Dictionary<unknown>;

    expect(
      scopeOf({
        monitorType: MonitorType.Host,
        signal: ResourceSignal.Logs,
        monitorStep: hostStep(""),
        seriesLabels: labels,
      }),
    ).toEqual({
      attributes: { [HOST_NAME_ATTRIBUTE]: "web-09" },
      notCarried: [],
    });
  });

  test("blank values say nothing, and a read that is not a map is no read", () => {
    expect(
      scopeOf({
        monitorType: MonitorType.Host,
        signal: ResourceSignal.Logs,
        monitorStep: hostStep(" "),
        queryAttributes: { [HOST_NAME_ATTRIBUTE]: "  " },
        seriesLabels: { [HOST_NAME_ATTRIBUTE]: "" },
        readAttributes: [
          undefined,
          "web-01" as unknown as Dictionary<unknown>,
          { [HOST_NAME_ATTRIBUTE]: new Includes([]) },
        ],
      }),
    ).toEqual({ attributes: {}, notCarried: [] });
  });

  test("the step's other configs are not read: a Host monitor's host is its hostMonitor's", () => {
    const step: MonitorStep = containerStep({
      runtime: "docker",
      hostIdentifier: "dock-01",
    });

    expect(
      scopeOf({
        monitorType: MonitorType.Host,
        signal: ResourceSignal.Logs,
        monitorStep: step,
      }),
    ).toEqual({ attributes: {}, notCarried: [] });
  });
});
