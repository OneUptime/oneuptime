import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";
import { JSONObject } from "Common/Types/JSON";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  EvaluateOverTimeType,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import CriteriaFilterUiUtil from "../../FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepHostMonitor from "Common/Types/Monitor/MonitorStepHostMonitor";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import type {
  HostServiceKind as HostServiceKindType,
  HostServiceMonitorLink,
} from "../../FeatureSet/Dashboard/src/Utils/HostServiceMonitorPrefill";
import type { MonitorSeedIds } from "../../FeatureSet/Dashboard/src/Utils/MonitorSeedIds";

/*
 * MONITOR CREATE, OPENED FROM A SERVICE ON A HOST (#10296).
 *
 * The monitor a host's Windows service page or systemd unit page opens
 * Monitor Create on, built by HostServiceMonitorPrefill. These pin what it
 * is a contract with:
 *
 *   - the link: the host's id and the service's name, read back exactly as
 *     they were sent, whatever characters the name has;
 *   - the worker: a Host monitor of that host (bound by id), whose one query
 *     reads the service's state by its name, each minute's highest value,
 *     over five minutes;
 *   - the evaluator: three criteria in the order that makes them exact -
 *     running first (Equal To the running value, Any Value), then not
 *     running (every other state), then stopped reporting (Has No Data) -
 *     the two that are offline opening an incident with the project's most
 *     severe severity, as a new monitor's default offline criteria do;
 *   - the form: MonitorSteps.getValidationError, which blocks Next.
 *
 * What the monitor then does with real samples is driven through the
 * worker's read and the evaluator in
 * Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitorHostService.test.ts.
 */

type PrefillModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/HostServiceMonitorPrefill");

let Prefill: PrefillModule;
let WINDOWS: HostServiceKindType;
let SYSTEMD: HostServiceKindType;

/*
 * Common/UI/Config reads `window` the moment it loads, and the util reaches
 * it through RouteMap (for the Monitor Create route), so the browser stub has
 * to exist before the deferred import runs - as AIInsightMonitorPrefill.test
 * does it.
 */
beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  Prefill = await import(
    "../../FeatureSet/Dashboard/src/Utils/HostServiceMonitorPrefill"
  );
  WINDOWS = Prefill.HostServiceKind.WindowsService;
  SYSTEMD = Prefill.HostServiceKind.SystemdUnit;
});

const HOST_ID: string = "11111111-2222-4333-8444-555555555555";
const OPERATIONAL_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const OFFLINE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000002",
);
const CRITICAL_INCIDENT_ID: ObjectID = new ObjectID(
  "bbbbbbbb-0000-4000-8000-000000000001",
);
const MAJOR_INCIDENT_ID: ObjectID = new ObjectID(
  "bbbbbbbb-0000-4000-8000-000000000002",
);
const HIGH_ALERT_ID: ObjectID = new ObjectID(
  "cccccccc-0000-4000-8000-000000000001",
);
const LOW_ALERT_ID: ObjectID = new ObjectID(
  "cccccccc-0000-4000-8000-000000000002",
);

const SEEDS: MonitorSeedIds = {
  operationalMonitorStatusId: OPERATIONAL_ID,
  offlineMonitorStatusId: OFFLINE_ID,
  rankedIncidentSeverityIds: [CRITICAL_INCIDENT_ID, MAJOR_INCIDENT_ID],
  rankedAlertSeverityIds: [HIGH_ALERT_ID, LOW_ALERT_ID],
};

const NO_SEEDS: MonitorSeedIds = {
  operationalMonitorStatusId: null,
  offlineMonitorStatusId: null,
  rankedIncidentSeverityIds: [],
  rankedAlertSeverityIds: [],
};

const HOST: { id: string; hostIdentifier: string; name: string } = {
  id: HOST_ID,
  hostIdentifier: "web-01.corp.local",
  name: "Web 01",
};

function link(
  kind: HostServiceKindType,
  serviceName: string,
): HostServiceMonitorLink {
  return { hostId: HOST_ID, kind: kind, serviceName: serviceName };
}

function prefillOf(
  kind: HostServiceKindType,
  serviceName: string,
  seeds: MonitorSeedIds = SEEDS,
): JSONObject {
  const prefill: JSONObject | null = Prefill.buildHostServiceMonitorPrefill({
    link: link(kind, serviceName),
    host: HOST,
    seeds: seeds,
  });

  expect(prefill).not.toBeNull();

  return prefill!;
}

function stepsOf(prefill: JSONObject): MonitorSteps {
  return MonitorSteps.fromJSON(prefill["monitorSteps"] as JSONObject);
}

function stepOf(prefill: JSONObject): MonitorStep {
  return stepsOf(prefill).data!.monitorStepsInstanceArray[0]!;
}

function criteriaOf(prefill: JSONObject): Array<MonitorCriteriaInstance> {
  return stepOf(prefill).data!.monitorCriteria.data!
    .monitorCriteriaInstanceArray;
}

// A Map of the link's parameters, as Monitor Create reads its address.
function paramsOf(route: string): (name: string) => string | null {
  const search: URLSearchParams = new URLSearchParams(
    route.substring(route.indexOf("?") + 1),
  );

  return (name: string): string | null => {
    return search.get(name) || null;
  };
}

describe("the link from a service's page", () => {
  test("rides as ?hostId= and ?windowsService= or ?systemdUnit= on Monitor Create", () => {
    expect(Prefill.HOST_SERVICE_MONITOR_QUERY_PARAMS).toEqual({
      hostId: "hostId",
      windowsService: "windowsService",
      systemdUnit: "systemdUnit",
    });

    const windowsRoute: string = Prefill.getHostServiceMonitorRoute(
      link(WINDOWS, "Spooler"),
    ).toString();

    expect(windowsRoute).toMatch(/\/monitors\/create\?/);
    expect(paramsOf(windowsRoute)("hostId")).toBe(HOST_ID);
    expect(paramsOf(windowsRoute)("windowsService")).toBe("Spooler");
    expect(paramsOf(windowsRoute)("systemdUnit")).toBeNull();

    const unitRoute: string = Prefill.getHostServiceMonitorRoute(
      link(SYSTEMD, "nginx.service"),
    ).toString();

    expect(paramsOf(unitRoute)("systemdUnit")).toBe("nginx.service");
    expect(paramsOf(unitRoute)("windowsService")).toBeNull();
  });

  test("a name comes back exactly as it was sent, whatever characters it has", () => {
    for (const name of [
      "Spooler",
      "MSSQL$SQLEXPRESS",
      "Print Spooler Helper",
      "a&b=c#d?e%f+g~h",
      "Ünïcödé 服务",
      "dev-disk-by\\x2duuid-1234.device",
      "getty@tty1.service",
    ]) {
      for (const kind of [WINDOWS, SYSTEMD]) {
        const route: string = Prefill.getHostServiceMonitorRoute(
          link(kind, name),
        ).toString();

        expect(Prefill.readHostServiceMonitorLink(paramsOf(route))).toEqual(
          link(kind, name),
        );
      }
    }
  });

  test("is not a link without a host id, with a host id that is not one, or without exactly one service", () => {
    const read: (
      params: Record<string, string>,
    ) => HostServiceMonitorLink | null = (
      params: Record<string, string>,
    ): HostServiceMonitorLink | null => {
      return Prefill.readHostServiceMonitorLink(
        (name: string): string | null => {
          return params[name] ?? null;
        },
      );
    };

    expect(read({ windowsService: "Spooler" })).toBeNull();
    expect(read({ hostId: "not-an-id", windowsService: "Spooler" })).toBeNull();
    expect(read({ hostId: HOST_ID })).toBeNull();
    expect(read({ hostId: HOST_ID, windowsService: "   " })).toBeNull();
    expect(
      read({
        hostId: HOST_ID,
        windowsService: "Spooler",
        systemdUnit: "nginx.service",
      }),
    ).toBeNull();
    expect(
      read({ hostId: HOST_ID, windowsService: "x".repeat(257) }),
    ).toBeNull();
    expect(
      read({ hostId: HOST_ID, windowsService: "x".repeat(256) })?.serviceName,
    ).toHaveLength(256);
    // A host id with spaces round it is still the host's.
    expect(
      read({ hostId: ` ${HOST_ID} `, systemdUnit: "sshd.service" }),
    ).toEqual(link(SYSTEMD, "sshd.service"));
  });

  test("Monitor Create knows its address by any of its parameters, and by none of another link's", () => {
    const has: (params: Record<string, string>) => boolean = (
      params: Record<string, string>,
    ): boolean => {
      return Prefill.isHostServiceMonitorAddress(
        (name: string): string | null => {
          return params[name] ?? null;
        },
      );
    };

    expect(has({ hostId: HOST_ID })).toBe(true);
    expect(has({ windowsService: "Spooler" })).toBe(true);
    expect(has({ systemdUnit: "nginx.service" })).toBe(true);
    expect(has({ aiInsightId: HOST_ID })).toBe(false);
    expect(has({ monitorType: "Host" })).toBe(false);
  });
});

describe("the step: this service's state on this host", () => {
  test("a Windows service: windows.service.status by its name, on the host bound by id", () => {
    const hostMonitor: MonitorStepHostMonitor =
      Prefill.buildHostServiceMonitorStep({
        kind: WINDOWS,
        serviceName: "Spooler",
        host: HOST,
      });

    expect(hostMonitor.hostIdentifier).toBe("web-01.corp.local");
    expect(hostMonitor.resourceId).toBe(HOST_ID);
    expect(hostMonitor.rollingTime).toBe(RollingTime.Past5Minutes);
    expect(hostMonitor.metricViewConfig.formulaConfigs).toEqual([]);
    expect(hostMonitor.metricViewConfig.queryConfigs).toHaveLength(1);

    const query: JSONObject = hostMonitor.metricViewConfig.queryConfigs[0]!
      .metricQueryData as unknown as JSONObject;

    expect(query).toEqual({
      filterData: {
        metricName: "windows.service.status",
        // The host is the worker's to add, from the step's host.
        attributes: { name: "Spooler" },
        aggegationType: MetricsAggregationType.Max,
        aggregateBy: {},
      },
    });
    // One series: the step names one service, so nothing is grouped.
    expect(
      hostMonitor.metricViewConfig.queryConfigs[0]!.metricQueryData
        .groupByAttributeKeys,
    ).toBeUndefined();
    expect(
      hostMonitor.metricViewConfig.queryConfigs[0]!.metricAliasData
        ?.metricVariable,
    ).toBe("service_status");
  });

  test("a systemd unit: the active point of systemd.unit.state, by the unit's resource attribute", () => {
    const hostMonitor: MonitorStepHostMonitor =
      Prefill.buildHostServiceMonitorStep({
        kind: SYSTEMD,
        serviceName: "nginx.service",
        host: HOST,
      });

    const filterData: JSONObject = hostMonitor.metricViewConfig.queryConfigs[0]!
      .metricQueryData.filterData as unknown as JSONObject;

    expect(filterData["metricName"]).toBe("systemd.unit.state");
    expect(filterData["attributes"]).toEqual({
      "resource.systemd.unit.name": "nginx.service",
      "systemd.unit.active_state": "active",
    });
    expect(filterData["aggegationType"]).toBe(MetricsAggregationType.Max);
    expect(
      hostMonitor.metricViewConfig.queryConfigs[0]!.metricAliasData
        ?.metricVariable,
    ).toBe("unit_active");
  });

  test("the attribute names are the ones the service pages read", () => {
    const windowsServices: string = fs.readFileSync(
      nodePath.resolve(
        __dirname,
        "../../FeatureSet/Dashboard/src/Pages/Host/Utils/WindowsServices.ts",
      ),
      "utf8",
    );
    const systemdUnits: string = fs.readFileSync(
      nodePath.resolve(
        __dirname,
        "../../FeatureSet/Dashboard/src/Pages/Host/Utils/SystemdUnits.ts",
      ),
      "utf8",
    );

    expect(windowsServices).toContain(
      'WINDOWS_SERVICE_METRIC_NAME: string = "windows.service.status"',
    );
    expect(windowsServices).toContain('SERVICE_NAME_ATTR: string = "name"');
    expect(systemdUnits).toContain(
      'SYSTEMD_UNIT_STATE_METRIC_NAME: string = "systemd.unit.state"',
    );
    expect(systemdUnits).toContain(
      'SYSTEMD_UNIT_NAME_ATTR: string = "resource.systemd.unit.name"',
    );
  });

  test("a host id that is not one binds nothing: the host name still names the host", () => {
    const hostMonitor: MonitorStepHostMonitor =
      Prefill.buildHostServiceMonitorStep({
        kind: WINDOWS,
        serviceName: "Spooler",
        host: { id: "nope", hostIdentifier: "web-01" },
      });

    expect(hostMonitor.resourceId).toBeUndefined();
    expect(hostMonitor.hostIdentifier).toBe("web-01");
  });
});

describe("the criteria", () => {
  test("three, in the order that makes them exact: running, not running, stopped reporting", () => {
    const criteria: Array<MonitorCriteriaInstance> = criteriaOf(
      prefillOf(WINDOWS, "Spooler"),
    );

    expect(
      criteria.map((instance: MonitorCriteriaInstance): string | undefined => {
        return instance.data!.name;
      }),
    ).toEqual([
      "Spooler is running on Web 01",
      "Spooler is not running on Web 01",
      "Spooler stopped reporting on Web 01",
    ]);
  });

  test("running: the service reported Running (4) in some minute of the time range, and the monitor is online", () => {
    const running: MonitorCriteriaInstance = criteriaOf(
      prefillOf(WINDOWS, "Spooler"),
    )[0]!;

    expect(running.data!.filters).toEqual([
      {
        checkOn: CheckOn.MetricValue,
        filterType: FilterType.EqualTo,
        value: 4,
        metricMonitorOptions: {
          metricAlias: "service_status",
          metricAggregationType: EvaluateOverTimeType.AnyValue,
        },
      },
    ]);
    expect(running.data!.monitorStatusId?.toString()).toBe(
      OPERATIONAL_ID.toString(),
    );
    expect(running.data!.changeMonitorStatus).toBe(true);
    expect(running.data!.createIncidents).toBe(false);
    expect(running.data!.createAlerts).toBe(false);
    expect(running.data!.incidents).toEqual([]);
    expect(running.data!.isEnabled).toBe(true);
  });

  test("not running: every other state, below Running or above it, and the monitor goes offline with an incident", () => {
    const notRunning: MonitorCriteriaInstance = criteriaOf(
      prefillOf(WINDOWS, "Spooler"),
    )[1]!;

    expect(notRunning.data!.filterCondition).toBe(FilterCondition.Any);
    expect(
      notRunning.data!.filters.map((filter: CriteriaFilter) => {
        return {
          filterType: filter.filterType,
          value: filter.value,
          aggregation: filter.metricMonitorOptions?.metricAggregationType,
          alias: filter.metricMonitorOptions?.metricAlias,
        };
      }),
    ).toEqual([
      {
        filterType: FilterType.LessThan,
        value: 4,
        aggregation: EvaluateOverTimeType.AnyValue,
        alias: "service_status",
      },
      {
        filterType: FilterType.GreaterThan,
        value: 4,
        aggregation: EvaluateOverTimeType.AnyValue,
        alias: "service_status",
      },
    ]);
    expect(notRunning.data!.monitorStatusId?.toString()).toBe(
      OFFLINE_ID.toString(),
    );
    expect(notRunning.data!.changeMonitorStatus).toBe(true);
  });

  test("the two conditions say exactly 'not Running': every state code but 4, the documented 0 and any other", () => {
    const filterTypes: Array<FilterType | undefined> = criteriaOf(
      prefillOf(WINDOWS, "Spooler"),
    )[1]!.data!.filters.map((filter: CriteriaFilter) => {
      return filter.filterType;
    });

    const matches: (code: number) => boolean = (code: number): boolean => {
      return filterTypes.some((filterType: FilterType | undefined) => {
        return filterType === FilterType.LessThan ? code < 4 : code > 4;
      });
    };

    for (const code of [0, 1, 2, 3, 4, 5, 6, 7, 8, 255]) {
      expect({ code: code, notRunning: matches(code) }).toEqual({
        code: code,
        notRunning: code !== 4,
      });
    }
  });

  test("stopped reporting: no state at all in the time range (Has No Data), offline with an incident of its own", () => {
    const notReporting: MonitorCriteriaInstance = criteriaOf(
      prefillOf(WINDOWS, "Spooler"),
    )[2]!;

    expect(notReporting.data!.filters).toEqual([
      {
        checkOn: CheckOn.MetricValue,
        filterType: FilterType.IsEmpty,
        value: undefined,
        metricMonitorOptions: {
          metricAlias: "service_status",
          metricAggregationType: EvaluateOverTimeType.AnyValue,
        },
      },
    ]);
    expect(notReporting.data!.monitorStatusId?.toString()).toBe(
      OFFLINE_ID.toString(),
    );
    expect(notReporting.data!.incidents[0]!.title).toBe(
      "Spooler stopped reporting on Web 01",
    );
  });

  test("the incidents are a new monitor's defaults: the most severe severity, resolving themselves, the alert filled in and off", () => {
    for (const instance of criteriaOf(prefillOf(WINDOWS, "Spooler")).slice(1)) {
      expect(instance.data!.createIncidents).toBe(true);
      expect(instance.data!.incidents).toHaveLength(1);
      expect(instance.data!.incidents[0]!.incidentSeverityId?.toString()).toBe(
        CRITICAL_INCIDENT_ID.toString(),
      );
      expect(instance.data!.incidents[0]!.autoResolveIncident).toBe(true);
      expect(instance.data!.incidents[0]!.onCallPolicyIds).toEqual([]);
      expect(instance.data!.incidents[0]!.title).toBe(instance.data!.name);

      expect(instance.data!.createAlerts).toBe(false);
      expect(instance.data!.alerts[0]!.alertSeverityId?.toString()).toBe(
        HIGH_ALERT_ID.toString(),
      );
      expect(instance.data!.alerts[0]!.autoResolveAlert).toBe(true);
    }
  });

  test("an incident's description names neither the service nor the host: it is drawn as Markdown, and a service is named by whoever installed it", () => {
    for (const kind of [WINDOWS, SYSTEMD]) {
      for (const instance of criteriaOf(
        prefillOf(kind, "[evil](https://example.com)"),
      ).slice(1)) {
        expect(instance.data!.incidents[0]!.description).not.toContain("evil");
        expect(instance.data!.incidents[0]!.description).not.toContain(
          "Web 01",
        );
        // The title is plain text, and does name them.
        expect(instance.data!.incidents[0]!.title).toContain("[evil]");
      }
    }
  });

  test("a systemd unit: active is 1 on its active point, and not active is anything below it", () => {
    const criteria: Array<MonitorCriteriaInstance> = criteriaOf(
      prefillOf(SYSTEMD, "nginx.service"),
    );
    const running: MonitorCriteriaInstance = criteria[0]!;
    const notRunning: MonitorCriteriaInstance = criteria[1]!;
    const notReporting: MonitorCriteriaInstance = criteria[2]!;

    expect(running.data!.name).toBe("nginx.service is active on Web 01");
    expect(running.data!.filters[0]!.filterType).toBe(FilterType.EqualTo);
    expect(running.data!.filters[0]!.value).toBe(1);
    expect(
      running.data!.filters[0]!.metricMonitorOptions?.metricAggregationType,
    ).toBe(EvaluateOverTimeType.AnyValue);

    expect(notRunning.data!.name).toBe("nginx.service is not active on Web 01");
    expect(
      notRunning.data!.filters.map((filter: CriteriaFilter) => {
        return [filter.filterType, filter.value];
      }),
    ).toEqual([[FilterType.LessThan, 1]]);

    expect(notReporting.data!.name).toBe(
      "nginx.service stopped reporting on Web 01",
    );
    expect(notReporting.data!.filters[0]!.filterType).toBe(FilterType.IsEmpty);
    expect(
      notReporting.data!.filters[0]!.metricMonitorOptions?.metricAlias,
    ).toBe("unit_active");
  });

  test("every condition is one the criteria form offers for a metric value, so the form draws it and keeps it", () => {
    /*
     * The form offers no Not Equal To for a metric value, and a condition it
     * does not offer draws as an empty dropdown - which is why "not Running"
     * is "below or above Running", checked after Running.
     */
    const offered: Array<unknown> =
      CriteriaFilterUiUtil.getFilterTypeOptionsByCheckOn(
        CheckOn.MetricValue,
      ).map((option: DropdownOption): unknown => {
        return option.value;
      });

    expect(offered).not.toContain(FilterType.NotEqualTo);

    for (const kind of [WINDOWS, SYSTEMD]) {
      for (const instance of criteriaOf(prefillOf(kind, "svc"))) {
        for (const filter of instance.data!.filters) {
          expect(filter.checkOn).toBe(CheckOn.MetricValue);
          expect(offered).toContain(filter.filterType);
        }
      }
    }

    // And the aggregation each is read with is one the form offers.
    expect(
      CriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter(
        criteriaOf(prefillOf(WINDOWS, "svc"))[0]!.data!.filters[0],
        MonitorType.Host,
      ),
    ).toContain(EvaluateOverTimeType.AnyValue);
  });

  test("a project with no statuses or severities gets criteria that leave those parts off, not criteria that cannot be saved", () => {
    const criteria: Array<MonitorCriteriaInstance> = criteriaOf(
      prefillOf(WINDOWS, "Spooler", NO_SEEDS),
    );

    for (const instance of criteria) {
      expect(instance.data!.monitorStatusId).toBeUndefined();
      expect(instance.data!.changeMonitorStatus).toBe(false);
      expect(instance.data!.incidents).toEqual([]);
      expect(instance.data!.alerts).toEqual([]);
      expect(instance.data!.createIncidents).toBe(false);
      expect(
        MonitorCriteriaInstance.getValidationError(instance, MonitorType.Host),
      ).toBeNull();
    }
  });
});

describe("Monitor Create's initial values", () => {
  test("a Host monitor named after the service and the host, which says what it does", () => {
    const prefill: JSONObject = prefillOf(WINDOWS, "Spooler");

    expect(prefill["monitorType"]).toBe(MonitorType.Host);
    expect(prefill["name"]).toBe("Spooler on Web 01");
    expect(prefill["description"]).toBe(
      "Opens an incident when the Windows service Spooler on Web 01 is not running, or when its status stops arriving.",
    );

    const unit: JSONObject = prefillOf(SYSTEMD, "nginx.service");

    expect(unit["name"]).toBe("nginx.service on Web 01");
    expect(unit["description"]).toBe(
      "Opens an incident when the systemd unit nginx.service on Web 01 is not active, or when its state stops arriving.",
    );
  });

  test("a host with no name of its own is named by its host name", () => {
    const prefill: JSONObject | null = Prefill.buildHostServiceMonitorPrefill({
      link: link(WINDOWS, "W3SVC"),
      host: { id: HOST_ID, hostIdentifier: "iis-02", name: "  " },
      seeds: SEEDS,
    });

    expect(prefill!["name"]).toBe("W3SVC on iis-02");
  });

  test("the steps survive the form's round trip and pass the validation that blocks Next", () => {
    for (const kind of [WINDOWS, SYSTEMD]) {
      const steps: MonitorSteps = stepsOf(prefillOf(kind, "Spooler"));

      expect(steps.data!.defaultMonitorStatusId?.toString()).toBe(
        OPERATIONAL_ID.toString(),
      );
      expect(steps.data!.monitorStepsInstanceArray).toHaveLength(1);
      expect(
        MonitorSteps.getValidationError(steps, MonitorType.Host),
      ).toBeNull();
      expect(
        MonitorCriteria.getValidationError(
          steps.data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria,
          MonitorType.Host,
        ),
      ).toBeNull();
      expect(
        steps.data!.monitorStepsInstanceArray[0]!.data!.hostMonitor
          ?.hostIdentifier,
      ).toBe("web-01.corp.local");
    }
  });

  test("a long name is cut to what a monitor's name holds", () => {
    const prefill: JSONObject = prefillOf(WINDOWS, "S".repeat(250));

    expect(Array.from(prefill["name"] as string).length).toBeLessThanOrEqual(
      100,
    );
    // The step still reads the whole name: the metric is matched on it.
    expect(
      (
        stepOf(prefill).data!.hostMonitor!.metricViewConfig.queryConfigs[0]!
          .metricQueryData.filterData as unknown as JSONObject
      )["attributes"],
    ).toEqual({ name: "S".repeat(250) });
  });

  test("nothing without a host name to read the host's metrics by, or without a service", () => {
    expect(
      Prefill.buildHostServiceMonitorPrefill({
        link: link(WINDOWS, "Spooler"),
        host: { id: HOST_ID, hostIdentifier: " " },
        seeds: SEEDS,
      }),
    ).toBeNull();
    expect(
      Prefill.buildHostServiceMonitorPrefill({
        link: link(WINDOWS, " "),
        host: HOST,
        seeds: SEEDS,
      }),
    ).toBeNull();
  });

  test("the host the step is bound to is the link's when the host is handed in without its id", () => {
    const prefill: JSONObject | null = Prefill.buildHostServiceMonitorPrefill({
      link: link(SYSTEMD, "sshd.service"),
      host: { hostIdentifier: "db-01" },
      seeds: SEEDS,
    });

    expect(stepOf(prefill!).data!.hostMonitor!.resourceId).toBe(HOST_ID);
  });
});

describe("where it is wired", () => {
  const readDashboardSource: (...parts: Array<string>) => string = (
    ...parts: Array<string>
  ): string => {
    return fs.readFileSync(
      nodePath.resolve(__dirname, "../../FeatureSet/Dashboard/src", ...parts),
      "utf8",
    );
  };

  test("Monitor Create reads the link, the host and the project's statuses and severities", () => {
    const source: string = readDashboardSource(
      "Pages",
      "Monitor",
      "Create.tsx",
    );

    expect(source).toContain("isHostServiceMonitorAddress(readParam)");
    expect(source).toContain("readHostServiceMonitorLink(readParam)");
    expect(source).toContain("preSeedFromHostServiceLink");
    expect(source).toContain("buildHostServiceMonitorPrefill({");
    expect(source).toContain("fetchMonitorSeedIds()");
    expect(source).toContain("modelType: Host,");
  });

  test("both service pages draw the Monitors card, each for its kind of service", () => {
    expect(
      readDashboardSource("Pages", "Host", "View", "ServiceView.tsx"),
    ).toContain("kind={HostServiceKind.WindowsService}");
    expect(
      readDashboardSource("Pages", "Host", "View", "SystemdUnitView.tsx"),
    ).toContain("kind={HostServiceKind.SystemdUnit}");
  });
});
