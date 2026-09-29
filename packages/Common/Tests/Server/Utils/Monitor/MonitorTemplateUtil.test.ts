import MonitorTemplateUtil from "../../../../Server/Utils/Monitor/MonitorTemplateUtil";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import logger from "../../../../Server/Utils/Logger";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { JSONObject } from "../../../../Types/JSON";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import IncomingMonitorRequest from "../../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import ServerMonitorResponse from "../../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import DatabaseMonitorResponse, {
  DatabaseMetricGroupUnavailableReason,
} from "../../../../Types/Monitor/DatabaseMonitor/DatabaseMonitorResponse";
import { DatabaseMetricGroup } from "../../../../Types/Monitor/DatabaseMetricCatalog";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * buildTemplateStorageMap defines the variable surface that incident and
 * alert title/description templates can reference for each monitor type;
 * processTemplateString renders against it. The NetworkDevice branch, the
 * series-label fold and the series-context variables have their own suites
 * (MonitorTemplateUtilNetworkDevice / MonitorTemplatePrototypePollution /
 * MonitorTemplateUtilSeriesContext); this suite pins every other branch.
 */

const SERIES_CONTEXT_KEYS: Array<string> = [
  "seriesResourceSuffix",
  "seriesResourceSummary",
  "seriesResourceBlock",
  "seriesDebugCommands",
];

function probeResponse(
  overrides: Partial<ProbeMonitorResponse> = {},
): ProbeMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    monitoredAt: new Date("2026-09-13T00:00:00.000Z"),
    ...overrides,
  };
}

function build(
  monitorType: MonitorType,
  dataToProcess: DataToProcess,
  extra: { monitor?: Monitor; seriesLabels?: JSONObject } = {},
): JSONObject {
  return MonitorTemplateUtil.buildTemplateStorageMap({
    monitorType,
    dataToProcess,
    ...extra,
  });
}

/** The storage map minus the always-present series-context variables. */
function withoutSeriesContext(map: JSONObject): JSONObject {
  const copy: JSONObject = { ...map };
  for (const key of SERIES_CONTEXT_KEYS) {
    delete copy[key];
  }
  return copy;
}

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation(() => {});
  jest.spyOn(logger, "debug").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MonitorTemplateUtil.buildTemplateStorageMap — API / Website", () => {
  test.each([MonitorType.API, MonitorType.Website])(
    "%s exposes the parsed JSON body, headers, status, timing and online flag",
    (monitorType: MonitorType) => {
      const map: JSONObject = build(
        monitorType,
        probeResponse({
          responseBody: '{"status":"degraded","nested":{"count":3}}',
          responseHeaders: { "content-type": "application/json" },
          responseCode: 503,
          responseTimeInMs: 812,
          isOnline: false,
        }),
      );

      expect(withoutSeriesContext(map)).toEqual({
        responseBody: { status: "degraded", nested: { count: 3 } },
        responseHeaders: { "content-type": "application/json" },
        responseStatusCode: 503,
        responseTimeInMs: 812,
        isOnline: false,
      });
    },
  );

  test("a missing body becomes an empty object", () => {
    const map: JSONObject = build(MonitorType.API, probeResponse());
    expect(map["responseBody"]).toEqual({});
  });

  test("an empty-string body becomes an empty object", () => {
    const map: JSONObject = build(
      MonitorType.API,
      probeResponse({ responseBody: "" }),
    );
    expect(map["responseBody"]).toEqual({});
  });

  test("a JSON empty-string literal body is normalised to an empty object", () => {
    const map: JSONObject = build(
      MonitorType.API,
      probeResponse({ responseBody: '""' }),
    );
    expect(map["responseBody"]).toEqual({});
  });

  test("a non-JSON body (e.g. HTML) is kept verbatim as a string", () => {
    const map: JSONObject = build(
      MonitorType.Website,
      probeResponse({ responseBody: "<html>down</html>" }),
    );
    expect(map["responseBody"]).toBe("<html>down</html>");
  });

  test("an already-parsed object body is passed through", () => {
    const body: JSONObject = { ok: true };
    const map: JSONObject = build(
      MonitorType.API,
      probeResponse({ responseBody: body }),
    );
    expect(map["responseBody"]).toEqual({ ok: true });
  });

  test("a JSON array body is exposed as an array", () => {
    const map: JSONObject = build(
      MonitorType.API,
      probeResponse({ responseBody: '[{"id":1},{"id":2}]' }),
    );
    expect(map["responseBody"]).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test("a body field can be rendered in a title", () => {
    const map: JSONObject = build(
      MonitorType.API,
      probeResponse({
        responseBody: '{"error":{"message":"db timeout"}}',
        responseCode: 500,
      }),
    );

    expect(
      MonitorTemplateUtil.processTemplateString({
        value: "API {{responseStatusCode}}: {{responseBody.error.message}}",
        storageMap: map,
      }),
    ).toBe("API 500: db timeout");
  });
});

describe("MonitorTemplateUtil.buildTemplateStorageMap — IncomingRequest", () => {
  test("exposes the request body, headers, method and receipt time", () => {
    const receivedAt: Date = new Date("2026-09-13T10:00:00.000Z");
    const request: IncomingMonitorRequest = {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      requestHeaders: { "x-source": "cron" },
      requestBody: { job: "backup" },
      requestMethod: HTTPMethod.POST,
      incomingRequestReceivedAt: receivedAt,
      checkedAt: receivedAt,
    };

    expect(
      withoutSeriesContext(build(MonitorType.IncomingRequest, request)),
    ).toEqual({
      requestBody: { job: "backup" },
      requestHeaders: { "x-source": "cron" },
      requestMethod: HTTPMethod.POST,
      incomingRequestReceivedAt: receivedAt,
    });
  });
});

describe("MonitorTemplateUtil.buildTemplateStorageMap — Ping / IP / Port", () => {
  test.each([MonitorType.Ping, MonitorType.IP, MonitorType.Port])(
    "%s exposes reachability fields only",
    (monitorType: MonitorType) => {
      const map: JSONObject = build(
        monitorType,
        probeResponse({
          isOnline: false,
          responseTimeInMs: 5000,
          failureCause: "Request timed out",
          isTimeout: true,
          responseCode: 200,
        }),
      );

      expect(withoutSeriesContext(map)).toEqual({
        isOnline: false,
        responseTimeInMs: 5000,
        failureCause: "Request timed out",
        isTimeout: true,
      });
    },
  );
});

describe("MonitorTemplateUtil.buildTemplateStorageMap — SSLCertificate", () => {
  test("exposes certificate details", () => {
    const createdAt: Date = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt: Date = new Date("2026-10-01T00:00:00.000Z");

    const map: JSONObject = build(
      MonitorType.SSLCertificate,
      probeResponse({
        isOnline: true,
        failureCause: "",
        sslResponse: {
          isSelfSigned: false,
          createdAt,
          expiresAt,
          commonName: "example.com",
          organizationalUnit: "Ops",
          organization: "Example Inc",
          locality: "London",
          state: "Greater London",
          country: "GB",
          serialNumber: "01AB",
          fingerprint: "AA:BB",
          fingerprint256: "CC:DD",
          issuer: "Not exposed",
        },
      }),
    );

    expect(withoutSeriesContext(map)).toEqual({
      isOnline: true,
      isSelfSigned: false,
      createdAt,
      expiresAt,
      commonName: "example.com",
      organizationalUnit: "Ops",
      organization: "Example Inc",
      locality: "London",
      state: "Greater London",
      country: "GB",
      serialNumber: "01AB",
      fingerprint: "AA:BB",
      fingerprint256: "CC:DD",
      failureCause: "",
    });
  });

  test("a missing certificate leaves details undefined without throwing", () => {
    const map: JSONObject = build(
      MonitorType.SSLCertificate,
      probeResponse({ isOnline: false, failureCause: "ECONNREFUSED" }),
    );

    expect(map["isOnline"]).toBe(false);
    expect(map["failureCause"]).toBe("ECONNREFUSED");
    expect(map["commonName"]).toBeUndefined();
    expect(map["expiresAt"]).toBeUndefined();
  });
});

describe("MonitorTemplateUtil.buildTemplateStorageMap — Server", () => {
  function serverResponse(
    overrides: Partial<ServerMonitorResponse> = {},
  ): ServerMonitorResponse {
    return {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      hostname: "db-01",
      requestReceivedAt: new Date("2026-09-13T09:00:00.000Z"),
      onlyCheckRequestReceivedAt: false,
      failureCause: "",
      ...overrides,
    };
  }

  test("exposes hostname, receipt time and flattened infrastructure metrics", () => {
    const response: ServerMonitorResponse = serverResponse({
      basicInfrastructureMetrics: {
        cpuMetrics: { percentUsed: 91.5, cores: 8 },
        memoryMetrics: {
          total: 16000,
          free: 1000,
          used: 15000,
          percentUsed: 93.75,
          percentFree: 6.25,
        },
        diskMetrics: [
          {
            diskPath: "/",
            percentUsed: 80,
            percentFree: 20,
            total: 500,
            free: 100,
            used: 400,
            device: "/dev/sda1",
          },
        ],
      },
      processes: [
        {
          pid: 42,
          name: "postgres",
          command: "postgres -D /data",
          cpuPercent: 50,
        },
      ],
    });

    expect(withoutSeriesContext(build(MonitorType.Server, response))).toEqual({
      hostname: "db-01",
      requestReceivedAt: response.requestReceivedAt,
      failureCause: "",
      cpuUsagePercent: 91.5,
      cpuCores: 8,
      memoryUsagePercent: 93.75,
      memoryFreePercent: 6.25,
      memoryTotalBytes: 16000,
      diskMetrics: [
        { diskPath: "/", usagePercent: 80, freePercent: 20, totalBytes: 500 },
      ],
      processes: [{ pid: 42, name: "postgres", command: "postgres -D /data" }],
    });
  });

  test("a heartbeat without metrics or processes exposes only the base fields", () => {
    const response: ServerMonitorResponse = serverResponse({
      failureCause: "No heartbeat",
    });

    expect(withoutSeriesContext(build(MonitorType.Server, response))).toEqual({
      hostname: "db-01",
      requestReceivedAt: response.requestReceivedAt,
      failureCause: "No heartbeat",
    });
  });

  test("a disk list renders through an each loop", () => {
    const map: JSONObject = build(
      MonitorType.Server,
      serverResponse({
        basicInfrastructureMetrics: {
          cpuMetrics: { percentUsed: 1, cores: 1 },
          memoryMetrics: {
            total: 1,
            free: 1,
            used: 0,
            percentUsed: 0,
            percentFree: 100,
          },
          diskMetrics: [
            {
              diskPath: "/",
              percentUsed: 10,
              percentFree: 90,
              total: 1,
              free: 1,
              used: 0,
            },
            {
              diskPath: "/var",
              percentUsed: 95,
              percentFree: 5,
              total: 1,
              free: 0,
              used: 1,
            },
          ],
        },
      }),
    );

    expect(
      MonitorTemplateUtil.processTemplateString({
        value: "{{#each diskMetrics}}{{diskPath}}={{usagePercent}}% {{/each}}",
        storageMap: map,
      }),
    ).toBe("/=10% /var=95% ");
  });
});

describe("MonitorTemplateUtil.buildTemplateStorageMap — CustomJavaScriptCode", () => {
  test("exposes the script result, error, logs and timing", () => {
    const map: JSONObject = build(
      MonitorType.CustomJavaScriptCode,
      probeResponse({
        failureCause: "Script threw",
        customCodeMonitorResponse: {
          result: { healthy: false },
          scriptError: "TypeError: x is undefined",
          logMessages: ["starting", "failed"],
          capturedMetrics: [],
          executionTimeInMS: 120,
        },
      }),
    );

    expect(withoutSeriesContext(map)).toEqual({
      executionTimeInMs: 120,
      result: { healthy: false },
      scriptError: "TypeError: x is undefined",
      logMessages: ["starting", "failed"],
      failureCause: "Script threw",
    });
  });

  test("logMessages defaults to an empty list when there is no script response", () => {
    const map: JSONObject = build(
      MonitorType.CustomJavaScriptCode,
      probeResponse(),
    );

    expect(map["logMessages"]).toEqual([]);
    expect(map["result"]).toBeUndefined();
    expect(map["executionTimeInMs"]).toBeUndefined();
  });
});

describe("MonitorTemplateUtil.buildTemplateStorageMap — SyntheticMonitor", () => {
  test("exposes one entry per browser / screen-size run", () => {
    const map: JSONObject = build(
      MonitorType.SyntheticMonitor,
      probeResponse({
        failureCause: "1 of 2 runs failed",
        syntheticMonitorResponse: [
          {
            result: "ok",
            logMessages: ["a"],
            capturedMetrics: [],
            executionTimeInMS: 1000,
            browserType: "Chromium" as any,
            screenSizeType: "Desktop" as any,
          },
          {
            result: undefined,
            scriptError: "Timeout",
            logMessages: undefined as unknown as Array<string>,
            capturedMetrics: [],
            executionTimeInMS: 30000,
            browserType: "Firefox" as any,
            screenSizeType: "Mobile" as any,
            screenshots: { final: "base64" },
          },
        ],
      }),
    );

    expect(withoutSeriesContext(map)).toEqual({
      syntheticResponses: [
        {
          executionTimeInMs: 1000,
          result: "ok",
          scriptError: undefined,
          logMessages: ["a"],
          screenshots: undefined,
          browserType: "Chromium",
          screenSizeType: "Desktop",
        },
        {
          executionTimeInMs: 30000,
          result: undefined,
          scriptError: "Timeout",
          logMessages: [],
          screenshots: { final: "base64" },
          browserType: "Firefox",
          screenSizeType: "Mobile",
        },
      ],
      failureCause: "1 of 2 runs failed",
    });
  });

  test("no runs yields an empty syntheticResponses list", () => {
    const map: JSONObject = build(
      MonitorType.SyntheticMonitor,
      probeResponse(),
    );
    expect(map["syntheticResponses"]).toEqual([]);
  });

  test("an indexed run renders in a template", () => {
    const map: JSONObject = build(
      MonitorType.SyntheticMonitor,
      probeResponse({
        syntheticMonitorResponse: [
          {
            result: undefined,
            scriptError: "selector not found",
            logMessages: [],
            capturedMetrics: [],
            executionTimeInMS: 5,
            browserType: "Webkit" as any,
            screenSizeType: "Tablet" as any,
          },
        ],
      }),
    );

    expect(
      MonitorTemplateUtil.processTemplateString({
        value:
          "{{syntheticResponses[0].browserType}}: {{syntheticResponses[0].scriptError}}",
        storageMap: map,
      }),
    ).toBe("Webkit: selector not found");
  });
});

describe("MonitorTemplateUtil.buildTemplateStorageMap — DNS", () => {
  test("exposes status fields, records and the flat record value list", () => {
    const map: JSONObject = build(
      MonitorType.DNS,
      probeResponse({
        isOnline: true,
        dnsResponse: {
          isOnline: true,
          responseTimeInMs: 14,
          failureCause: "",
          isTimeout: false,
          isDnssecValid: true,
          records: [
            { type: "A" as any, value: "10.0.0.1", ttl: 300 },
            { type: "A" as any, value: "10.0.0.2" },
          ],
        },
      }),
    );

    expect(withoutSeriesContext(map)).toEqual({
      isOnline: true,
      responseTimeInMs: 14,
      failureCause: "",
      isTimeout: false,
      isDnssecValid: true,
      records: [
        { type: "A", value: "10.0.0.1", ttl: 300 },
        { type: "A", value: "10.0.0.2", ttl: undefined },
      ],
      recordValues: ["10.0.0.1", "10.0.0.2"],
    });
  });

  test("no DNS response leaves records off the map", () => {
    const map: JSONObject = build(
      MonitorType.DNS,
      probeResponse({ isOnline: false }),
    );

    expect(map["isOnline"]).toBe(false);
    expect("records" in map).toBe(false);
    expect("recordValues" in map).toBe(false);
  });
});

describe("MonitorTemplateUtil.buildTemplateStorageMap — Domain", () => {
  test("exposes WHOIS/RDAP registration details", () => {
    const map: JSONObject = build(
      MonitorType.Domain,
      probeResponse({
        isOnline: true,
        domainResponse: {
          isOnline: true,
          responseTimeInMs: 300,
          failureCause: "",
          domainName: "example.com",
          registrar: "Registrar Inc",
          createdDate: "2000-01-01",
          updatedDate: "2025-01-01",
          expiresDate: "2027-01-01",
          nameServers: ["ns1.example.com", "ns2.example.com"],
          domainStatus: ["clientTransferProhibited"],
          dnssec: "unsigned",
          lookupMethod: "RDAP" as any,
          registrarUrl: "not exposed",
        },
      }),
    );

    expect(withoutSeriesContext(map)).toEqual({
      isOnline: true,
      responseTimeInMs: 300,
      failureCause: "",
      domainName: "example.com",
      registrar: "Registrar Inc",
      createdDate: "2000-01-01",
      updatedDate: "2025-01-01",
      expiresDate: "2027-01-01",
      nameServers: ["ns1.example.com", "ns2.example.com"],
      domainStatus: ["clientTransferProhibited"],
      dnssec: "unsigned",
      lookupMethod: "RDAP",
    });
  });
});

describe("MonitorTemplateUtil.buildTemplateStorageMap — DNSSEC", () => {
  test("exposes chain status and record counts rather than the raw records", () => {
    const map: JSONObject = build(
      MonitorType.DNSSEC,
      probeResponse({
        isOnline: true,
        dnssecResponse: {
          isOnline: true,
          responseTimeInMs: 90,
          failureCause: "",
          domainName: "example.com",
          isZoneSigned: true,
          dnskeys: [
            { flags: 257, algorithm: 13 },
            { flags: 256, algorithm: 13 },
          ],
          parentDsRecords: [
            { keyTag: 1, algorithm: 13, digestType: 2, digest: "ab" },
          ],
          isParentDsPresent: true,
          rrsigs: [],
          earliestSignatureExpiration: "2026-09-20T00:00:00Z",
          daysUntilSignatureExpiry: 7,
          resolverChecks: [],
          resolverConsensusAd: true,
          nameserverChecks: [],
          isNameserverConsistent: false,
          isChainValid: true,
        },
      }),
    );

    expect(withoutSeriesContext(map)).toEqual({
      isOnline: true,
      responseTimeInMs: 90,
      failureCause: "",
      domainName: "example.com",
      isZoneSigned: true,
      isParentDsPresent: true,
      isChainValid: true,
      resolverConsensusAd: true,
      isNameserverConsistent: false,
      earliestSignatureExpiration: "2026-09-20T00:00:00Z",
      daysUntilSignatureExpiry: 7,
      dnskeyCount: 2,
      dsRecordCount: 1,
      rrsigCount: 0,
    });
  });

  test("no DNSSEC response leaves counts undefined", () => {
    const map: JSONObject = build(MonitorType.DNSSEC, probeResponse());
    expect(map["dnskeyCount"]).toBeUndefined();
    expect(map["dsRecordCount"]).toBeUndefined();
    expect(map["rrsigCount"]).toBeUndefined();
  });
});

describe("MonitorTemplateUtil.buildTemplateStorageMap — Database", () => {
  function databaseResponse(
    overrides: Partial<DatabaseMonitorResponse> = {},
  ): DatabaseMonitorResponse {
    return {
      isOnline: true,
      responseTimeInMs: 22,
      failureCause: "",
      metrics: {},
      collectedGroups: [],
      unavailableGroups: [],
      connectionError: null,
      ...overrides,
    };
  }

  test("exposes groups, metrics and a one-line collection issue summary", () => {
    const map: JSONObject = build(
      MonitorType.Database,
      probeResponse({
        isOnline: true,
        databaseMonitorResponse: databaseResponse({
          engineVersion: "PostgreSQL 17.2",
          metrics: { ["DatabaseConnections" as any]: 12 },
          collectedGroups: [DatabaseMetricGroup.Connections],
          unavailableGroups: [
            {
              group: DatabaseMetricGroup.Replication,
              reason: DatabaseMetricGroupUnavailableReason.MissingPermission,
              message: "permission denied for pg_stat_replication",
              remediation: "GRANT pg_monitor TO monitoring_user",
            },
            {
              group: DatabaseMetricGroup.Locks,
              reason: DatabaseMetricGroupUnavailableReason.Timeout,
              message: "query timed out",
            },
          ],
        }),
      }),
    );

    expect(withoutSeriesContext(map)).toEqual({
      isOnline: true,
      responseTimeInMs: 22,
      failureCause: "",
      connectionError: null,
      engineVersion: "PostgreSQL 17.2",
      collectedGroups: ["Connections"],
      unavailableGroups: [
        {
          group: "Replication",
          reason: "MissingPermission",
          message: "permission denied for pg_stat_replication",
          remediation: "GRANT pg_monitor TO monitoring_user",
        },
        {
          group: "Locks",
          reason: "Timeout",
          message: "query timed out",
          remediation: undefined,
        },
      ],
      collectionIssueSummary:
        "Replication: permission denied for pg_stat_replication; Locks: query timed out",
      metrics: { DatabaseConnections: 12 },
    });
  });

  test("full collection yields an empty summary string", () => {
    const map: JSONObject = build(
      MonitorType.Database,
      probeResponse({ databaseMonitorResponse: databaseResponse() }),
    );
    expect(map["collectionIssueSummary"]).toBe("");
    expect(map["unavailableGroups"]).toEqual([]);
  });

  test("no database response still defines the list and map defaults", () => {
    const map: JSONObject = build(
      MonitorType.Database,
      probeResponse({ isOnline: false }),
    );

    expect(map["isOnline"]).toBe(false);
    expect(map["collectedGroups"]).toEqual([]);
    expect(map["unavailableGroups"]).toEqual([]);
    expect(map["collectionIssueSummary"]).toBe("");
    expect(map["metrics"]).toEqual({});
  });
});

describe("MonitorTemplateUtil.buildTemplateStorageMap — metric-backed types", () => {
  const metricTypes: Array<MonitorType> = [
    MonitorType.Metrics,
    MonitorType.Kubernetes,
    MonitorType.Docker,
    MonitorType.Host,
    MonitorType.Podman,
    MonitorType.DockerSwarm,
    MonitorType.Proxmox,
    MonitorType.VMware,
    MonitorType.Ceph,
  ];

  function metricResponse(queryConfigs: Array<unknown>): MetricMonitorResponse {
    return {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      metricResult: [],
      metricViewConfig: { queryConfigs, formulaConfigs: [] } as any,
    };
  }

  test.each(metricTypes)(
    "%s exposes the first query's metric name",
    (monitorType: MonitorType) => {
      const map: JSONObject = build(
        monitorType,
        metricResponse([
          {
            metricQueryData: {
              filterData: { metricName: "k8s.pod.cpu.utilization" },
            },
          },
          { metricQueryData: { filterData: { metricName: "second" } } },
        ]),
      );

      expect(withoutSeriesContext(map)).toEqual({
        metricName: "k8s.pod.cpu.utilization",
      });
    },
  );

  test("no query configs yields an empty metric name", () => {
    expect(build(MonitorType.Metrics, metricResponse([]))["metricName"]).toBe(
      "",
    );
  });

  test("a query without filter data yields an empty metric name", () => {
    expect(
      build(MonitorType.Metrics, metricResponse([{ metricQueryData: {} }]))[
        "metricName"
      ],
    ).toBe("");
  });

  test("a response without a view config yields an empty metric name", () => {
    expect(
      build(MonitorType.Kubernetes, {} as unknown as DataToProcess)[
        "metricName"
      ],
    ).toBe("");
  });
});

describe("MonitorTemplateUtil.buildTemplateStorageMap — ExternalStatusPage", () => {
  test("exposes overall status, scope and component statuses", () => {
    const map: JSONObject = build(
      MonitorType.ExternalStatusPage,
      probeResponse({
        isOnline: true,
        externalStatusPageResponse: {
          isOnline: true,
          overallStatus: "major_outage",
          activeIncidentCount: 2,
          responseTimeInMs: 150,
          failureCause: "",
          provider: "Atlassian Statuspage",
          componentGroupName: "APIs",
          componentName: "REST API",
          rawBody: "not exposed",
          componentStatuses: [
            {
              name: "REST API",
              status: "major_outage",
              description: "Errors",
              groupName: "APIs",
            },
            { name: "Dashboard", status: "operational" },
          ],
        },
      }),
    );

    expect(withoutSeriesContext(map)).toEqual({
      isOnline: true,
      responseTimeInMs: 150,
      failureCause: "",
      overallStatus: "major_outage",
      activeIncidentCount: 2,
      provider: "Atlassian Statuspage",
      componentGroup: "APIs",
      componentName: "REST API",
      componentStatuses: [
        {
          name: "REST API",
          status: "major_outage",
          description: "Errors",
          groupName: "APIs",
        },
        {
          name: "Dashboard",
          status: "operational",
          description: undefined,
          groupName: undefined,
        },
      ],
    });
  });

  test("no response leaves componentStatuses off the map", () => {
    const map: JSONObject = build(
      MonitorType.ExternalStatusPage,
      probeResponse({ isOnline: false }),
    );
    expect(map["isOnline"]).toBe(false);
    expect("componentStatuses" in map).toBe(false);
  });
});

describe("MonitorTemplateUtil.buildTemplateStorageMap — types without a branch", () => {
  test.each([MonitorType.Manual, MonitorType.Logs, MonitorType.Traces])(
    "%s exposes only the series-context variables",
    (monitorType: MonitorType) => {
      const map: JSONObject = build(monitorType, probeResponse());
      expect(Object.keys(map).sort()).toEqual([...SERIES_CONTEXT_KEYS].sort());
    },
  );
});

describe("MonitorTemplateUtil.buildTemplateStorageMap — monitor identity", () => {
  function monitor(overrides: Partial<Monitor> = {}): Monitor {
    const model: Monitor = new Monitor();
    Object.assign(model, overrides);
    return model;
  }

  test("exposes name, id, description, slug and type", () => {
    const id: ObjectID = ObjectID.generate();
    const map: JSONObject = build(MonitorType.Ping, probeResponse(), {
      monitor: monitor({
        id,
        name: "Edge router",
        description: "Pings the edge",
        slug: "edge-router",
        monitorType: MonitorType.Ping,
      }),
    });

    expect(map["monitorName"]).toBe("Edge router");
    expect(map["monitorId"]).toBe(id.toString());
    expect(map["monitorDescription"]).toBe("Pings the edge");
    expect(map["monitorSlug"]).toBe("edge-router");
    expect(map["monitorType"]).toBe(MonitorType.Ping);
  });

  test("identity is exposed even for types without a data branch", () => {
    const map: JSONObject = build(MonitorType.Manual, probeResponse(), {
      monitor: monitor({ name: "Manual one" }),
    });
    expect(map["monitorName"]).toBe("Manual one");
  });

  test("unset identity fields are not added to the map", () => {
    const map: JSONObject = build(MonitorType.Ping, probeResponse(), {
      monitor: monitor({ name: "Only a name" }),
    });

    expect(map["monitorName"]).toBe("Only a name");
    for (const key of [
      "monitorId",
      "monitorDescription",
      "monitorSlug",
      "monitorType",
    ]) {
      expect(key in map).toBe(false);
    }
  });

  test("no monitor means no identity fields", () => {
    const map: JSONObject = build(MonitorType.Ping, probeResponse());
    expect("monitorName" in map).toBe(false);
    expect("monitorId" in map).toBe(false);
  });

  test("identity renders alongside monitor data in one template", () => {
    const map: JSONObject = build(
      MonitorType.Ping,
      probeResponse({ failureCause: "Host unreachable" }),
      { monitor: monitor({ name: "Edge router" }) },
    );

    expect(
      MonitorTemplateUtil.processTemplateString({
        value: "{{monitorName}} is down: {{failureCause}}",
        storageMap: map,
      }),
    ).toBe("Edge router is down: Host unreachable");
  });
});

describe("MonitorTemplateUtil.buildTemplateStorageMap — failure containment", () => {
  test("a throwing payload is logged and still returns the series-context variables", () => {
    const hostile: DataToProcess = {} as unknown as DataToProcess;
    Object.defineProperty(hostile, "isOnline", {
      get: (): never => {
        throw new Error("boom");
      },
    });

    const map: JSONObject = build(MonitorType.Ping, hostile, {
      monitor: (() => {
        const model: Monitor = new Monitor();
        model.name = "Still named";
        return model;
      })(),
    });

    expect(logger.error).toHaveBeenCalled();
    expect(map["monitorName"]).toBe("Still named");
    for (const key of SERIES_CONTEXT_KEYS) {
      expect(map[key]).toBe("");
    }
    expect("isOnline" in map).toBe(false);
  });

  test("series labels are folded even onto a branch's own data", () => {
    const map: JSONObject = build(
      MonitorType.Ping,
      probeResponse({ isOnline: true }),
      { seriesLabels: { "host.name": "web-1", region: "eu" } },
    );

    expect(map["isOnline"]).toBe(true);
    expect(map["host"]).toEqual({ name: "web-1" });
    expect(map["region"]).toBe("eu");
    expect(map["seriesLabels"]).toEqual({ "host.name": "web-1", region: "eu" });
  });

  test("null and undefined label values are not folded", () => {
    const map: JSONObject = build(MonitorType.Metrics, {} as DataToProcess, {
      seriesLabels: { kept: "yes", dropped: null, "a.b": undefined as any },
    });

    expect(map["kept"]).toBe("yes");
    expect("dropped" in map).toBe(false);
    expect("a" in map).toBe(false);
  });

  test("a dotted label replaces a scalar at the same prefix with a nested object", () => {
    const map: JSONObject = build(
      MonitorType.Metrics,
      {
        metricViewConfig: {
          queryConfigs: [
            { metricQueryData: { filterData: { metricName: "cpu" } } },
          ],
        },
      } as unknown as DataToProcess,
      { seriesLabels: { "metricName.unit": "%" } },
    );

    expect(map["metricName"]).toEqual({ unit: "%" });
  });
});

describe("MonitorTemplateUtil.processTemplateString", () => {
  test.each([undefined, ""])(
    "%j renders as an empty string",
    (value: string | undefined) => {
      expect(
        MonitorTemplateUtil.processTemplateString({
          value,
          storageMap: { a: 1 },
        }),
      ).toBe("");
    },
  );

  test("text without placeholders is returned unchanged", () => {
    expect(
      MonitorTemplateUtil.processTemplateString({
        value: "Plain title",
        storageMap: { a: 1 },
      }),
    ).toBe("Plain title");
  });

  test("replaces top-level and nested placeholders", () => {
    expect(
      MonitorTemplateUtil.processTemplateString({
        value: "{{a}} / {{b.c}}",
        storageMap: { a: 1, b: { c: "two" } },
      }),
    ).toBe("1 / two");
  });

  test("replaces a repeated placeholder everywhere", () => {
    expect(
      MonitorTemplateUtil.processTemplateString({
        value: "{{x}}-{{x}}-{{x}}",
        storageMap: { x: "y" },
      }),
    ).toBe("y-y-y");
  });

  test("an unknown placeholder is left in place", () => {
    expect(
      MonitorTemplateUtil.processTemplateString({
        value: "value: {{missing}}",
        storageMap: {},
      }),
    ).toBe("value: {{missing}}");
  });

  test("a failure inside the renderer returns the original template", () => {
    const hostileMap: JSONObject = {};
    Object.defineProperty(hostileMap, "boom", {
      enumerable: true,
      get: (): never => {
        throw new Error("renderer blew up");
      },
    });

    expect(
      MonitorTemplateUtil.processTemplateString({
        value: "Title {{boom}}",
        storageMap: hostileMap,
      }),
    ).toBe("Title {{boom}}");
  });
});
