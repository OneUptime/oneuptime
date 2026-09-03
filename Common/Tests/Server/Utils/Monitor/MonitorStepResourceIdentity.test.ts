import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStepResourceIdentity from "../../../../Server/Utils/Monitor/MonitorStepResourceIdentity";
import { SeriesResourceRefs } from "../../../../Server/Utils/Monitor/SeriesResourceLabels";
import { JSONObject } from "../../../../Types/JSON";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * MonitorStepResourceIdentity reads the resources a monitor's own
 * configuration names, so an alert or incident can be attached to them
 * even when the criteria is ungrouped and emits no series labels.
 *
 * The regression that motivated it: a metric monitor scoped to one
 * service with the attribute filter
 * `oneuptime.service.name = app-plan-starship-online-production` opened
 * alerts whose "Affected Resources" card read "No resources affected" —
 * the filter named the service, but nothing ever read it.
 *
 * Pure module: no database, no mocks.
 */

const SERVICE_ID_A: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SERVICE_ID_B: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function monitorWithSteps(
  monitorType: MonitorType,
  stepDataList: Array<JSONObject>,
): Monitor {
  const model: Monitor = new Monitor();
  model.monitorType = monitorType;
  model.projectId = new ObjectID("11111111-1111-4111-8111-111111111111");

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: stepDataList.map(
      (stepData: JSONObject): MonitorStep => {
        const step: MonitorStep = new MonitorStep();
        step.data = {
          ...step.data,
          ...stepData,
        } as MonitorStep["data"];
        return step;
      },
    ),
  };

  model.monitorSteps = steps;
  return model;
}

/*
 * A metric view config carrying one query whose filter attributes are
 * exactly `attributes`. This is the shape every metric-backed monitor
 * step holds, and the shape the user's reported bug lives in.
 */
function metricViewConfigWith(attributes: JSONObject): JSONObject {
  return {
    queryConfigs: [
      {
        metricQueryData: {
          filterData: {
            metricName: "azure_memorypercentage_maximum",
            attributes: attributes,
          },
        },
      },
    ],
    formulaConfigs: [],
  };
}

function refsFor(monitor: Monitor): SeriesResourceRefs {
  return MonitorStepResourceIdentity.extractResourceRefsFromMonitor({
    monitor: monitor,
  });
}

describe("MonitorStepResourceIdentity — the reported bug", () => {
  test("a metric monitor filtered by oneuptime.service.name names that service", () => {
    /*
     * ALT-144 in the wild: a Metrics monitor whose only resource
     * identity is an attribute filter. It is ungrouped, so the series
     * path sees nothing; this is the only thing that can name the
     * service.
     */
    const refs: SeriesResourceRefs = refsFor(
      monitorWithSteps(MonitorType.Metrics, [
        {
          metricMonitor: {
            metricViewConfig: metricViewConfigWith({
              "oneuptime.service.name": "app-plan-starship-online-production",
            }),
          },
        },
      ]),
    );

    expect(refs.serviceNames).toEqual(["app-plan-starship-online-production"]);
  });

  test("every accepted service-name spelling resolves", () => {
    for (const key of [
      "service.name",
      "resource.service.name",
      "oneuptime.service.name",
      "resource.oneuptime.service.name",
    ]) {
      const refs: SeriesResourceRefs = refsFor(
        monitorWithSteps(MonitorType.Metrics, [
          {
            metricMonitor: {
              metricViewConfig: metricViewConfigWith({ [key]: "checkout-api" }),
            },
          },
        ]),
      );

      expect(refs.serviceNames).toEqual(["checkout-api"]);
    }
  });

  test("a non-identifying filter attribute names nothing", () => {
    const refs: SeriesResourceRefs = refsFor(
      monitorWithSteps(MonitorType.Metrics, [
        {
          metricMonitor: {
            metricViewConfig: metricViewConfigWith({
              "http.response.status_code": "500",
            }),
          },
        },
      ]),
    );

    expect(MonitorStepResourceIdentity.isEmpty(refs)).toBe(true);
  });

  test("a non-string filter (Search / Includes) names nothing", () => {
    /*
     * `service.name CONTAINS prod` matches a set, not one row. Treating
     * the operator object as a name would stringify to "[object Object]"
     * and look up a service that cannot exist.
     */
    const refs: SeriesResourceRefs = refsFor(
      monitorWithSteps(MonitorType.Metrics, [
        {
          metricMonitor: {
            metricViewConfig: metricViewConfigWith({
              "service.name": { _type: "Search", value: "prod" },
            }),
          },
        },
      ]),
    );

    expect(refs.serviceNames).toEqual([]);
  });
});

describe("MonitorStepResourceIdentity — telemetry service ids", () => {
  test.each([
    ["logMonitor", MonitorType.Logs],
    ["traceMonitor", MonitorType.Traces],
    ["exceptionMonitor", MonitorType.Exceptions],
    /*
     * Profiles has no metricViewConfig and no declared identifier, so
     * telemetryServiceIds is the ONLY identity a profile monitor has —
     * omitting it here leaves that type with the original bug.
     */
    ["profileMonitor", MonitorType.Profiles],
    ["metricMonitor", MonitorType.Metrics],
  ])(
    "%s.telemetryServiceIds names its services",
    (stepKey: string, monitorType: MonitorType) => {
      const refs: SeriesResourceRefs = refsFor(
        monitorWithSteps(monitorType, [
          {
            [stepKey]: {
              telemetryServiceIds: [
                new ObjectID(SERVICE_ID_A),
                new ObjectID(SERVICE_ID_B),
              ],
            },
          },
        ]),
      );

      expect(refs.serviceIds.sort()).toEqual(
        [SERVICE_ID_A, SERVICE_ID_B].sort(),
      );
    },
  );

  test("a service id persisted as a bare string still resolves", () => {
    /*
     * Step JSON is not schema-checked, so an id can arrive as a plain
     * string rather than a rehydrated ObjectID.
     */
    const refs: SeriesResourceRefs = refsFor(
      monitorWithSteps(MonitorType.Logs, [
        { logMonitor: { telemetryServiceIds: [SERVICE_ID_A] } },
      ]),
    );

    expect(refs.serviceIds).toEqual([SERVICE_ID_A]);
  });

  test("an empty telemetryServiceIds list names nothing", () => {
    const refs: SeriesResourceRefs = refsFor(
      monitorWithSteps(MonitorType.Logs, [
        { logMonitor: { telemetryServiceIds: [] } },
      ]),
    );

    expect(MonitorStepResourceIdentity.isEmpty(refs)).toBe(true);
  });
});

describe("MonitorStepResourceIdentity — declared infra identifiers", () => {
  test.each([
    [MonitorType.Host, "hostMonitor", "hostIdentifier", "hostNames"],
    [MonitorType.Docker, "dockerMonitor", "hostIdentifier", "dockerHostNames"],
    [MonitorType.Podman, "podmanMonitor", "hostIdentifier", "podmanHostNames"],
    [
      MonitorType.Kubernetes,
      "kubernetesMonitor",
      "clusterIdentifier",
      "kubernetesClusterNames",
    ],
    [
      MonitorType.Proxmox,
      "proxmoxMonitor",
      "clusterIdentifier",
      "proxmoxClusterNames",
    ],
    [MonitorType.Ceph, "cephMonitor", "clusterIdentifier", "cephClusterNames"],
    [
      MonitorType.DockerSwarm,
      "dockerSwarmMonitor",
      "clusterIdentifier",
      "dockerSwarmClusterNames",
    ],
    [MonitorType.IoTDevice, "iotMonitor", "fleetIdentifier", "iotFleetNames"],
  ])(
    "a %s monitor names its resource via %s.%s",
    (
      monitorType: MonitorType,
      stepKey: string,
      identifierKey: string,
      refKey: string,
    ) => {
      const refs: SeriesResourceRefs = refsFor(
        monitorWithSteps(monitorType, [
          { [stepKey]: { [identifierKey]: "prod-01" } },
        ]),
      );

      expect(refs[refKey as keyof SeriesResourceRefs]).toEqual(["prod-01"]);

      /*
       * The identifier must land in exactly one bucket. A Docker
       * monitor that also produced `hostNames` would attach an
       * unrelated Host row.
       */
      const populated: Array<string> = Object.entries(refs)
        .filter(([, values]: [string, Array<string>]): boolean => {
          return values.length > 0;
        })
        .map(([key]: [string, Array<string>]): string => {
          return key;
        });

      expect(populated).toEqual([refKey]);
    },
  );

  test("a blank identifier names nothing", () => {
    const refs: SeriesResourceRefs = refsFor(
      monitorWithSteps(MonitorType.Host, [
        { hostMonitor: { hostIdentifier: "   " } },
      ]),
    );

    expect(MonitorStepResourceIdentity.isEmpty(refs)).toBe(true);
  });

  test("an identifier is trimmed", () => {
    const refs: SeriesResourceRefs = refsFor(
      monitorWithSteps(MonitorType.Host, [
        { hostMonitor: { hostIdentifier: "  prod-01  " } },
      ]),
    );

    expect(refs.hostNames).toEqual(["prod-01"]);
  });
});

describe("MonitorStepResourceIdentity — Docker / Podman host disambiguation", () => {
  test("a Docker monitor's resource.host.name filter does NOT name a Host", () => {
    /*
     * The Docker worker writes the step's hostIdentifier into
     * `resource.host.name`, which the label key map hands to Host. That
     * value names a DockerHost row. Honouring the map would attach an
     * unrelated Host and surface the alert on that host's Activity tab.
     */
    const refs: SeriesResourceRefs = refsFor(
      monitorWithSteps(MonitorType.Docker, [
        {
          dockerMonitor: {
            hostIdentifier: "docker-prod-01",
            metricViewConfig: metricViewConfigWith({
              "resource.host.name": "docker-prod-01",
            }),
          },
        },
      ]),
    );

    expect(refs.hostNames).toEqual([]);
    expect(refs.hostIds).toEqual([]);
    expect(refs.dockerHostNames).toEqual(["docker-prod-01"]);
  });

  test("a Podman monitor's resource.host.name filter does NOT name a Host", () => {
    const refs: SeriesResourceRefs = refsFor(
      monitorWithSteps(MonitorType.Podman, [
        {
          podmanMonitor: {
            hostIdentifier: "podman-prod-01",
            metricViewConfig: metricViewConfigWith({
              "resource.host.name": "podman-prod-01",
            }),
          },
        },
      ]),
    );

    expect(refs.hostNames).toEqual([]);
    expect(refs.podmanHostNames).toEqual(["podman-prod-01"]);
  });

  test("a Host monitor's resource.host.name filter DOES name a Host", () => {
    // Same key, different monitor type — here it genuinely is a Host.
    const refs: SeriesResourceRefs = refsFor(
      monitorWithSteps(MonitorType.Host, [
        {
          hostMonitor: {
            hostIdentifier: "prod-01",
            metricViewConfig: metricViewConfigWith({
              "resource.host.name": "prod-01",
            }),
          },
        },
      ]),
    );

    expect(refs.hostNames).toEqual(["prod-01"]);
  });
});

describe("MonitorStepResourceIdentity — monitor types with no resource identity", () => {
  test.each([
    MonitorType.Website,
    MonitorType.API,
    MonitorType.Ping,
    MonitorType.IP,
    MonitorType.Port,
    MonitorType.SSLCertificate,
    MonitorType.Domain,
    MonitorType.DNS,
    MonitorType.SQLQuery,
    /*
     * A database health step names a host:port, which is not one of the
     * buckets SeriesResourceRefs carries.
     */
    MonitorType.Database,
    MonitorType.SyntheticMonitor,
    MonitorType.CustomJavaScriptCode,
    MonitorType.IncomingRequest,
    MonitorType.IncomingEmail,
    MonitorType.Server,
    MonitorType.Manual,
    MonitorType.NetworkDevice,
    MonitorType.ExternalStatusPage,
  ])("%s names no resource", (monitorType: MonitorType) => {
    const refs: SeriesResourceRefs = refsFor(
      monitorWithSteps(monitorType, [{}]),
    );

    expect(MonitorStepResourceIdentity.isEmpty(refs)).toBe(true);
  });

  test("a monitor with no steps at all names no resource", () => {
    const model: Monitor = new Monitor();
    model.monitorType = MonitorType.Host;

    expect(MonitorStepResourceIdentity.isEmpty(refsFor(model))).toBe(true);
  });

  test("a monitor with no monitorType names no resource", () => {
    const model: Monitor = new Monitor();

    expect(MonitorStepResourceIdentity.isEmpty(refsFor(model))).toBe(true);
  });
});

describe("MonitorStepResourceIdentity — multi-query metric steps", () => {
  test("names every service its queries filter on", () => {
    /*
     * A metric step can hold several queries, and the UI lets a user add
     * them. Two queries filtering the same attribute on different
     * services both name a real resource; collapsing them to the last
     * one silently drops a service from Affected Resources, from its
     * Activity tab, and from owner/label inheritance.
     */
    const refs: SeriesResourceRefs = refsFor(
      monitorWithSteps(MonitorType.Metrics, [
        {
          metricMonitor: {
            metricViewConfig: {
              queryConfigs: [
                {
                  metricQueryData: {
                    filterData: {
                      metricName: "a",
                      attributes: { "oneuptime.service.name": "checkout-api" },
                    },
                  },
                },
                {
                  metricQueryData: {
                    filterData: {
                      metricName: "b",
                      attributes: { "oneuptime.service.name": "payments-api" },
                    },
                  },
                },
              ],
              formulaConfigs: [],
            },
          },
        },
      ]),
    );

    expect(refs.serviceNames.sort()).toEqual(["checkout-api", "payments-api"]);
  });
});

describe("MonitorStepResourceIdentity — malformed step configuration", () => {
  /*
   * Step JSON is persisted free-form and never schema-checked, so the
   * API, a seed, an import or an older build can write shapes the types
   * say are impossible. This module runs inside the probe and telemetry
   * queue workers: a TypeError here would fail the whole job and retry
   * forever, so it must degrade to "names nothing" instead of throwing.
   */
  test.each([
    ["an object", {}],
    ["a number", 123],
    ["a string", "not-an-array"],
    ["null", null],
  ])(
    "does not throw when telemetryServiceIds is %s",
    (_label: string, value: unknown) => {
      const monitor: Monitor = monitorWithSteps(MonitorType.Logs, [
        { logMonitor: { telemetryServiceIds: value } } as unknown as JSONObject,
      ]);

      expect(() => {
        return refsFor(monitor);
      }).not.toThrow();

      expect(refsFor(monitor).serviceIds).toEqual([]);
    },
  );

  test.each([
    ["a number", 12345],
    ["an object", { name: "prod-01" }],
    ["null", null],
  ])(
    "does not throw when a declared identifier is %s",
    (_label: string, value: unknown) => {
      const monitor: Monitor = monitorWithSteps(MonitorType.Host, [
        { hostMonitor: { hostIdentifier: value } } as unknown as JSONObject,
      ]);

      expect(() => {
        return refsFor(monitor);
      }).not.toThrow();

      expect(refsFor(monitor).hostNames).toEqual([]);
    },
  );

  test("drops a non-scalar service id rather than stringifying it", () => {
    /*
     * `String({})` is "[object Object]" — a lookup key that can never
     * match, but that would still cost a query and pollute the refs.
     */
    const refs: SeriesResourceRefs = refsFor(
      monitorWithSteps(MonitorType.Logs, [
        {
          logMonitor: { telemetryServiceIds: [{ nested: "object" }] },
        } as unknown as JSONObject,
      ]),
    );

    expect(refs.serviceIds).toEqual([]);
  });

  test("does not throw when a metric view config is malformed", () => {
    const monitor: Monitor = monitorWithSteps(MonitorType.Metrics, [
      {
        metricMonitor: { metricViewConfig: { queryConfigs: "nope" } },
      } as unknown as JSONObject,
    ]);

    expect(() => {
      return refsFor(monitor);
    }).not.toThrow();
  });
});

describe("MonitorStepResourceIdentity — persisted monitors", () => {
  /*
   * Production never sees a hand-built MonitorSteps: it reads one that
   * has been through toJSON on the way into Postgres and fromJSON on the
   * way out. If an ObjectID does not survive that round trip as
   * something String() can render, the ids become "[object Object]" and
   * every lookup silently misses. These pin the shape that actually
   * reaches the extractor.
   */
  function roundTrip(monitorType: MonitorType, stepData: JSONObject): Monitor {
    const built: Monitor = monitorWithSteps(monitorType, [stepData]);

    const rehydrated: MonitorSteps = MonitorSteps.fromJSON(
      JSON.parse(JSON.stringify(built.monitorSteps!.toJSON())) as JSONObject,
    ) as MonitorSteps;

    const model: Monitor = new Monitor();
    model.monitorType = monitorType;
    model.projectId = new ObjectID("11111111-1111-4111-8111-111111111111");
    model.monitorSteps = rehydrated;
    return model;
  }

  test("telemetryServiceIds survive a persist / rehydrate round trip", () => {
    const refs: SeriesResourceRefs = refsFor(
      roundTrip(MonitorType.Logs, {
        logMonitor: {
          attributes: {},
          body: "",
          severityTexts: [],
          lastXSecondsOfLogs: 60,
          telemetryServiceIds: [new ObjectID(SERVICE_ID_A)],
        },
      }),
    );

    expect(refs.serviceIds).toEqual([SERVICE_ID_A]);
  });

  test("a metric filter survives a persist / rehydrate round trip", () => {
    const refs: SeriesResourceRefs = refsFor(
      roundTrip(MonitorType.Metrics, {
        metricMonitor: {
          rollingTime: "Past 1 Minute",
          metricViewConfig: metricViewConfigWith({
            "oneuptime.service.name": "app-plan-starship-online-production",
          }),
        },
      }),
    );

    expect(refs.serviceNames).toEqual(["app-plan-starship-online-production"]);
  });

  test("a declared host identifier survives a persist / rehydrate round trip", () => {
    const refs: SeriesResourceRefs = refsFor(
      roundTrip(MonitorType.Host, {
        hostMonitor: {
          hostIdentifier: "prod-01",
          rollingTime: "Past 1 Minute",
          metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
        },
      }),
    );

    expect(refs.hostNames).toEqual(["prod-01"]);
  });

  test("no id ever renders as [object Object]", () => {
    /*
     * The failure mode this whole describe exists to catch: a
     * half-rehydrated ObjectID stringifies to "[object Object]" and the
     * lookup quietly matches nothing.
     */
    const refs: SeriesResourceRefs = refsFor(
      roundTrip(MonitorType.Metrics, {
        metricMonitor: {
          rollingTime: "Past 1 Minute",
          telemetryServiceIds: [new ObjectID(SERVICE_ID_A)],
          metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
        },
      }),
    );

    for (const values of Object.values(refs)) {
      for (const value of values) {
        expect(value).not.toContain("[object");
      }
    }

    expect(refs.serviceIds).toEqual([SERVICE_ID_A]);
  });
});

describe("MonitorStepResourceIdentity — multiple steps", () => {
  test("names the union across steps", () => {
    /*
     * The creation path does not know which step fired, so a monitor
     * watching three hosts names all three. Attributing nothing is the
     * bug this module exists to fix.
     */
    const refs: SeriesResourceRefs = refsFor(
      monitorWithSteps(MonitorType.Host, [
        { hostMonitor: { hostIdentifier: "prod-01" } },
        { hostMonitor: { hostIdentifier: "prod-02" } },
      ]),
    );

    expect(refs.hostNames.sort()).toEqual(["prod-01", "prod-02"]);
  });

  test("dedupes a resource named by two steps", () => {
    const refs: SeriesResourceRefs = refsFor(
      monitorWithSteps(MonitorType.Host, [
        { hostMonitor: { hostIdentifier: "prod-01" } },
        { hostMonitor: { hostIdentifier: "prod-01" } },
      ]),
    );

    expect(refs.hostNames).toEqual(["prod-01"]);
  });

  test("dedupes a service named by both the filter and another step", () => {
    const refs: SeriesResourceRefs = refsFor(
      monitorWithSteps(MonitorType.Metrics, [
        {
          metricMonitor: {
            metricViewConfig: metricViewConfigWith({
              "service.name": "checkout-api",
            }),
          },
        },
        {
          metricMonitor: {
            metricViewConfig: metricViewConfigWith({
              "oneuptime.service.name": "checkout-api",
            }),
          },
        },
      ]),
    );

    expect(refs.serviceNames).toEqual(["checkout-api"]);
  });

  test("collects the declared identifier and the filter identity together", () => {
    /*
     * A Kubernetes monitor names its cluster in the step config and can
     * additionally scope itself to a service by filter. Both are real.
     */
    const refs: SeriesResourceRefs = refsFor(
      monitorWithSteps(MonitorType.Kubernetes, [
        {
          kubernetesMonitor: {
            clusterIdentifier: "prod-cluster",
            metricViewConfig: metricViewConfigWith({
              "service.name": "checkout-api",
            }),
          },
        },
      ]),
    );

    expect(refs.kubernetesClusterNames).toEqual(["prod-cluster"]);
    expect(refs.serviceNames).toEqual(["checkout-api"]);
  });
});
