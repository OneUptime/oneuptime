import { describe, expect, test } from "@jest/globals";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import URL from "../../../Types/API/URL";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import DnsRecordType from "../../../Types/Monitor/DnsMonitor/DnsRecordType";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  buildToolImportMonitor,
  getToolImportMonitorMatchKey,
  getToolImportMonitorProblem,
  TOOL_IMPORT_MONITOR_TYPES,
  ToolImportBuiltMonitor,
  ToolImportMonitorDefaults,
} from "../../../Types/ToolImport/ToolImportMonitorBuilder";
import { ImportedMonitor } from "../../../Types/ToolImport/ToolImportSnapshot";

/*
 * What a monitor of an uptime tool becomes: the monitor type, the steps a
 * probe runs and the criteria that say up or down - made the way the
 * Create Monitor form makes them, changed only where the tool said
 * something else. Every monitor built here passes MonitorStep's own
 * validation, the same the API runs on a monitor a person saves.
 */

const DEFAULTS: ToolImportMonitorDefaults = {
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  warningAlertSeverityId: ObjectID.generate(),
};

function monitor(overrides: Partial<ImportedMonitor>): ImportedMonitor {
  return {
    sourceId: "m1",
    name: "Home page",
    sourceType: "http",
    monitorType: MonitorType.Website,
    destination: "https://example.com",
    isPaused: false,
    notes: [],
    ...overrides,
  };
}

function build(overrides: Partial<ImportedMonitor>): ToolImportBuiltMonitor {
  return buildToolImportMonitor({
    monitor: monitor(overrides),
    defaults: DEFAULTS,
  });
}

function stepOf(built: ToolImportBuiltMonitor): MonitorStep {
  const step: MonitorStep | undefined =
    built.monitorSteps?.data?.monitorStepsInstanceArray[0];

  if (!step) {
    throw new Error("The monitor has no step.");
  }

  return step;
}

function criteriaOf(
  built: ToolImportBuiltMonitor,
): Array<MonitorCriteriaInstance> {
  return stepOf(built).data!.monitorCriteria.data!.monitorCriteriaInstanceArray;
}

function filtersOf(instance: MonitorCriteriaInstance): Array<{
  checkOn: CheckOn;
  filterType: FilterType | undefined;
  value: unknown;
}> {
  return instance.data!.filters.map((filter: CriteriaFilter) => {
    return {
      checkOn: filter.checkOn,
      filterType: filter.filterType,
      value: filter.value,
    };
  });
}

function isValid(built: ToolImportBuiltMonitor): boolean {
  return (
    MonitorStep.getValidationError(stepOf(built), built.monitorType) === null
  );
}

describe("which monitors can be built", () => {
  test("only the monitor types an import makes, each with the address it needs", () => {
    expect(TOOL_IMPORT_MONITOR_TYPES).toEqual([
      MonitorType.Website,
      MonitorType.API,
      MonitorType.Ping,
      MonitorType.Port,
      MonitorType.SSLCertificate,
      MonitorType.DNS,
      MonitorType.IncomingRequest,
      MonitorType.Manual,
    ]);

    expect(getToolImportMonitorProblem(monitor({ monitorType: null }))).toBe(
      "type",
    );
    expect(
      getToolImportMonitorProblem(monitor({ monitorType: MonitorType.Logs })),
    ).toBe("type");
    expect(
      getToolImportMonitorProblem(monitor({ destination: undefined })),
    ).toBe("address");
    expect(getToolImportMonitorProblem(monitor({ destination: "  " }))).toBe(
      "address",
    );
    expect(getToolImportMonitorProblem(monitor({}))).toBeNull();
  });

  test("a web address must be http or https", () => {
    expect(
      getToolImportMonitorProblem(
        monitor({ destination: "ftp://files.example.com" }),
      ),
    ).toBe("address");
    expect(
      getToolImportMonitorProblem(monitor({ destination: "not a url at all" })),
    ).toBe("address");
    expect(
      getToolImportMonitorProblem(
        monitor({
          monitorType: MonitorType.API,
          destination: "http://10.0.0.5:8080/health",
        }),
      ),
    ).toBeNull();
  });

  test("a host, a port and a name to look up are each checked", () => {
    expect(
      getToolImportMonitorProblem(
        monitor({ monitorType: MonitorType.Ping, destination: "example.com" }),
      ),
    ).toBeNull();
    expect(
      getToolImportMonitorProblem(
        monitor({ monitorType: MonitorType.Ping, destination: "10.0.0.1" }),
      ),
    ).toBeNull();

    for (const port of [undefined, 0, 70000, 3.5]) {
      expect({
        port,
        problem: getToolImportMonitorProblem(
          monitor({
            monitorType: MonitorType.Port,
            destination: "db.example.com",
            port: port,
          }),
        ),
      }).toEqual({ port, problem: "address" });
    }

    expect(
      getToolImportMonitorProblem(
        monitor({
          monitorType: MonitorType.Port,
          destination: "db.example.com",
          port: 5432,
        }),
      ),
    ).toBeNull();

    expect(
      getToolImportMonitorProblem(
        monitor({ monitorType: MonitorType.DNS, destination: "example.com." }),
      ),
    ).toBeNull();
    expect(
      getToolImportMonitorProblem(
        monitor({ monitorType: MonitorType.DNS, destination: "exa mple.com" }),
      ),
    ).toBe("address");
  });

  test("a heartbeat and a manual monitor need no address", () => {
    expect(
      getToolImportMonitorProblem(
        monitor({
          monitorType: MonitorType.IncomingRequest,
          destination: undefined,
        }),
      ),
    ).toBeNull();
    expect(
      getToolImportMonitorProblem(
        monitor({ monitorType: MonitorType.Manual, destination: undefined }),
      ),
    ).toBeNull();
  });
});

describe("what a monitor is recognised by", () => {
  test("the same check is the same key, however the tool wrote it", () => {
    expect(
      getToolImportMonitorMatchKey({
        monitorType: MonitorType.Website,
        destination: "HTTPS://Example.com/Status",
      }),
    ).toBe(
      getToolImportMonitorMatchKey({
        monitorType: MonitorType.Website,
        destination: "https://example.com/status",
      }),
    );
    expect(
      getToolImportMonitorMatchKey({
        monitorType: MonitorType.Port,
        destination: "DB.example.com",
        port: 5432,
      }),
    ).toBe("db.example.com:5432");
    expect(
      getToolImportMonitorMatchKey({
        monitorType: MonitorType.DNS,
        destination: "Example.com.",
        dnsRecordType: DnsRecordType.MX,
      }),
    ).toBe("example.com MX");
    expect(
      getToolImportMonitorMatchKey({
        monitorType: MonitorType.DNS,
        destination: "example.com",
      }),
    ).toBe("example.com A");
  });

  test("a check of nothing has no key", () => {
    expect(
      getToolImportMonitorMatchKey({
        monitorType: MonitorType.IncomingRequest,
        destination: undefined,
      }),
    ).toBeNull();
    expect(
      getToolImportMonitorMatchKey({
        monitorType: null,
        destination: "https://example.com",
      }),
    ).toBeNull();
  });
});

describe("a Website or API monitor", () => {
  test("the usual codes and no keyword keep the Create Monitor form's own criteria", () => {
    const built: ToolImportBuiltMonitor = build({ intervalSeconds: 300 });
    const step: MonitorStep = stepOf(built);

    expect(built.monitorType).toBe(MonitorType.Website);
    expect(isValid(built)).toBe(true);
    expect(step.data!.monitorDestination).toBeInstanceOf(URL);
    expect(step.data!.monitorDestination!.toString()).toBe(
      "https://example.com/",
    );
    expect(step.data!.requestType).toBe(HTTPMethod.GET);
    expect(built.monitoringInterval).toBe("*/5 * * * *");

    const defaults: MonitorStep = MonitorStep.getDefaultMonitorStep({
      monitorName: "Home page",
      monitorType: MonitorType.Website,
      ...DEFAULTS,
    });

    expect(
      criteriaOf(built).map((instance: MonitorCriteriaInstance) => {
        return filtersOf(instance);
      }),
    ).toEqual(
      defaults.data!.monitorCriteria.data!.monitorCriteriaInstanceArray.map(
        (instance: MonitorCriteriaInstance) => {
          return filtersOf(instance);
        },
      ),
    );
  });

  test("one range of codes and a keyword: offline first on anything else, then online", () => {
    const built: ToolImportBuiltMonitor = build({
      acceptedStatusCodes: [{ from: 200, to: 299 }],
      keyword: { value: "Welcome", isPresent: true, isCaseSensitive: true },
    });
    const [offline, online] = criteriaOf(built);

    expect(isValid(built)).toBe(true);
    expect(criteriaOf(built)).toHaveLength(2);

    expect(offline!.data!.monitorStatusId?.toString()).toBe(
      DEFAULTS.offlineMonitorStatusId.toString(),
    );
    expect(offline!.data!.filterCondition).toBe(FilterCondition.Any);
    expect(offline!.data!.createIncidents).toBe(true);
    expect(offline!.data!.incidents[0]!.incidentSeverityId?.toString()).toBe(
      DEFAULTS.defaultIncidentSeverityId.toString(),
    );
    expect(filtersOf(offline!)).toEqual([
      {
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.False,
        value: undefined,
      },
      {
        checkOn: CheckOn.ResponseStatusCode,
        filterType: FilterType.LessThan,
        value: 200,
      },
      {
        checkOn: CheckOn.ResponseStatusCode,
        filterType: FilterType.GreaterThan,
        value: 299,
      },
      {
        checkOn: CheckOn.ResponseBody,
        filterType: FilterType.NotContains,
        value: "Welcome",
      },
    ]);

    expect(online!.data!.monitorStatusId?.toString()).toBe(
      DEFAULTS.onlineMonitorStatusId.toString(),
    );
    expect(online!.data!.filterCondition).toBe(FilterCondition.All);
    expect(online!.data!.createIncidents).toBe(false);
    expect(filtersOf(online!)).toEqual([
      {
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.True,
        value: undefined,
      },
      {
        checkOn: CheckOn.ResponseStatusCode,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 200,
      },
      {
        checkOn: CheckOn.ResponseStatusCode,
        filterType: FilterType.LessThan,
        value: 300,
      },
      {
        checkOn: CheckOn.ResponseBody,
        filterType: FilterType.Contains,
        value: "Welcome",
      },
    ]);
  });

  test("a keyword that must be missing is the other way round", () => {
    const [offline, online] = criteriaOf(
      build({
        keyword: { value: "Error", isPresent: false, isCaseSensitive: true },
      }),
    );

    expect(filtersOf(offline!).pop()).toEqual({
      checkOn: CheckOn.ResponseBody,
      filterType: FilterType.Contains,
      value: "Error",
    });
    expect(filtersOf(online!).pop()).toEqual({
      checkOn: CheckOn.ResponseBody,
      filterType: FilterType.NotContains,
      value: "Error",
    });
  });

  test("several ranges: one online criteria per range, then offline for everything else", () => {
    const built: ToolImportBuiltMonitor = build({
      acceptedStatusCodes: [
        { from: 200, to: 299 },
        { from: 401, to: 401 },
      ],
    });
    const instances: Array<MonitorCriteriaInstance> = criteriaOf(built);

    expect(isValid(built)).toBe(true);
    expect(instances).toHaveLength(3);
    expect(filtersOf(instances[0]!).slice(1)).toEqual([
      {
        checkOn: CheckOn.ResponseStatusCode,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 200,
      },
      {
        checkOn: CheckOn.ResponseStatusCode,
        filterType: FilterType.LessThan,
        value: 300,
      },
    ]);
    expect(filtersOf(instances[1]!).slice(1)).toEqual([
      {
        checkOn: CheckOn.ResponseStatusCode,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 401,
      },
      {
        checkOn: CheckOn.ResponseStatusCode,
        filterType: FilterType.LessThan,
        value: 402,
      },
    ]);
    expect(instances[2]!.data!.monitorStatusId?.toString()).toBe(
      DEFAULTS.offlineMonitorStatusId.toString(),
    );
    expect(filtersOf(instances[2]!)).toEqual([
      {
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.False,
        value: undefined,
      },
      {
        checkOn: CheckOn.ResponseStatusCode,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 100,
      },
    ]);
  });

  test("an API monitor sends its method, headers and body, and can stop following redirects", () => {
    const built: ToolImportBuiltMonitor = build({
      monitorType: MonitorType.API,
      destination: "https://api.example.com/orders",
      httpMethod: HTTPMethod.POST,
      requestHeaders: { "Content-Type": "application/json" },
      requestBody: '{"ping":true}',
      followRedirects: false,
    });
    const step: MonitorStep = stepOf(built);

    expect(isValid(built)).toBe(true);
    expect(step.data!.requestType).toBe(HTTPMethod.POST);
    expect(step.data!.requestHeaders).toEqual({
      "Content-Type": "application/json",
    });
    expect(step.data!.requestBody).toBe('{"ping":true}');
    expect(step.data!.doNotFollowRedirects).toBe(true);
  });

  test("a Website monitor loads with GET, or HEAD when the tool did, and sends nothing else", () => {
    expect(
      stepOf(build({ httpMethod: HTTPMethod.HEAD })).data!.requestType,
    ).toBe(HTTPMethod.HEAD);

    const step: MonitorStep = stepOf(
      build({
        httpMethod: HTTPMethod.POST,
        requestHeaders: { Accept: "text/html" },
        requestBody: '{"a":1}',
      }),
    );

    expect(step.data!.requestType).toBe(HTTPMethod.GET);
    expect(step.data!.requestHeaders).toBeUndefined();
    expect(step.data!.requestBody).toBeUndefined();
  });

  test("a wait is kept, up to the longest OneUptime waits", () => {
    expect(stepOf(build({ timeoutSeconds: 10 })).data!.requestTimeoutInMs).toBe(
      10000,
    );
    expect(
      stepOf(build({ timeoutSeconds: 120 })).data!.requestTimeoutInMs,
    ).toBe(60000);
  });
});

describe("the other monitor types", () => {
  test("a Ping monitor checks its host, as often as the tool did", () => {
    const built: ToolImportBuiltMonitor = build({
      monitorType: MonitorType.Ping,
      destination: "example.com",
      intervalSeconds: 60,
    });

    expect(isValid(built)).toBe(true);
    expect(stepOf(built).data!.monitorDestination!.toString()).toBe(
      "example.com",
    );
    expect(built.monitoringInterval).toBe("* * * * *");
  });

  test("a Port monitor checks its host and port", () => {
    const built: ToolImportBuiltMonitor = build({
      monitorType: MonitorType.Port,
      destination: "db.example.com",
      port: 5432,
    });

    expect(isValid(built)).toBe(true);
    expect(stepOf(built).data!.monitorDestinationPort!.toNumber()).toBe(5432);
  });

  test("a DNS monitor looks the name up, with its record type and server", () => {
    const built: ToolImportBuiltMonitor = build({
      monitorType: MonitorType.DNS,
      destination: "example.com.",
      dnsRecordType: DnsRecordType.MX,
      dnsServer: "1.1.1.1",
    });

    expect(isValid(built)).toBe(true);
    expect(stepOf(built).data!.dnsMonitor).toMatchObject({
      queryName: "example.com",
      recordType: DnsRecordType.MX,
      hostname: "1.1.1.1",
    });
  });

  test("an SSL Certificate monitor warns as many days ahead as the tool did", () => {
    const built: ToolImportBuiltMonitor = build({
      monitorType: MonitorType.SSLCertificate,
      certificateExpiryWarningDays: 21,
    });
    const days: Array<unknown> = criteriaOf(built).flatMap(
      (instance: MonitorCriteriaInstance) => {
        return instance
          .data!.filters.filter((filter: CriteriaFilter) => {
            return filter.checkOn === CheckOn.ExpiresInDays;
          })
          .map((filter: CriteriaFilter) => {
            return filter.value;
          });
      },
    );

    expect(isValid(built)).toBe(true);
    expect(days.length).toBeGreaterThan(0);
    expect(
      days.every((value: unknown) => {
        return value === 21;
      }),
    ).toBe(true);
  });

  test("a heartbeat is down once nothing has arrived for the time allowed, rounded up to minutes", () => {
    const built: ToolImportBuiltMonitor = build({
      monitorType: MonitorType.IncomingRequest,
      destination: undefined,
      heartbeatTimeoutSeconds: 330,
      intervalSeconds: 300,
    });
    const [offline, online] = criteriaOf(built);

    expect(isValid(built)).toBe(true);
    expect(built.monitoringInterval).toBeUndefined();
    expect(filtersOf(offline!)).toEqual([
      {
        checkOn: CheckOn.IncomingRequest,
        filterType: FilterType.NotRecievedInMinutes,
        value: 6,
      },
    ]);
    expect(offline!.data!.monitorStatusId?.toString()).toBe(
      DEFAULTS.offlineMonitorStatusId.toString(),
    );
    expect(filtersOf(online!)).toEqual([
      {
        checkOn: CheckOn.IncomingRequest,
        filterType: FilterType.RecievedInMinutes,
        value: 6,
      },
    ]);
  });

  test("a heartbeat with no time said waits its interval, or an hour", () => {
    expect(
      filtersOf(
        criteriaOf(
          build({
            monitorType: MonitorType.IncomingRequest,
            destination: undefined,
            intervalSeconds: 120,
          }),
        )[0]!,
      )[0]!.value,
    ).toBe(2);
    expect(
      filtersOf(
        criteriaOf(
          build({
            monitorType: MonitorType.IncomingRequest,
            destination: undefined,
          }),
        )[0]!,
      )[0]!.value,
    ).toBe(60);
  });

  test("a Manual monitor has no steps: someone sets its status", () => {
    expect(
      build({ monitorType: MonitorType.Manual, destination: undefined }),
    ).toEqual({ monitorType: MonitorType.Manual });
  });

  test("a monitor that cannot be built is refused, never half made", () => {
    expect(() => {
      return build({ monitorType: null, sourceType: "udp" });
    }).toThrow("OneUptime has no monitor for udp checks.");
    expect(() => {
      return build({ destination: "ftp://example.com" });
    }).toThrow("OneUptime cannot read the address ftp://example.com.");
  });

  test("every type and shape an adapter makes passes the API's own validation", () => {
    const shapes: Array<Partial<ImportedMonitor>> = [
      {},
      { monitorType: MonitorType.API, httpMethod: HTTPMethod.DELETE },
      { acceptedStatusCodes: [{ from: 100, to: 599 }] },
      {
        acceptedStatusCodes: [
          { from: 200, to: 204 },
          { from: 301, to: 302 },
          { from: 404, to: 404 },
        ],
        keyword: { value: "ok", isPresent: true, isCaseSensitive: false },
      },
      { monitorType: MonitorType.Ping, destination: "2001:db8::1" },
      { monitorType: MonitorType.Port, destination: "10.0.0.1", port: 1 },
      { monitorType: MonitorType.DNS, destination: "_sip._tcp.example.com" },
      { monitorType: MonitorType.SSLCertificate },
      {
        monitorType: MonitorType.IncomingRequest,
        destination: undefined,
        heartbeatTimeoutSeconds: 86400 * 7,
      },
    ];

    for (const shape of shapes) {
      const built: ToolImportBuiltMonitor = build(shape);

      expect({ shape, valid: isValid(built) }).toEqual({ shape, valid: true });
    }
  });
});
