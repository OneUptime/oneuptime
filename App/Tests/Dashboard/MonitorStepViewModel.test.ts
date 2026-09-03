import { describe, expect, it } from "@jest/globals";
import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import Hostname from "Common/Types/API/Hostname";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import URL from "Common/Types/API/URL";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import Includes from "Common/Types/BaseDatabase/Includes";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import Search from "Common/Types/BaseDatabase/Search";
import Dictionary from "Common/Types/Dictionary";
import IP from "Common/Types/IP/IP";
import LogSeverity from "Common/Types/Log/LogSeverity";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import MetricsViewConfig from "Common/Types/Metrics/MetricsViewConfig";
import { DatabaseMetricGroup } from "Common/Types/Monitor/DatabaseMetricCatalog";
import DnsRecordType from "Common/Types/Monitor/DnsMonitor/DnsRecordType";
import DomainLookupMethod from "Common/Types/Monitor/DomainMonitor/DomainLookupMethod";
import ExternalStatusPageProviderType from "Common/Types/Monitor/ExternalStatusPageProviderType";
import MonitorStep, { MonitorStepType } from "Common/Types/Monitor/MonitorStep";
import { IoTResourceScope } from "Common/Types/Monitor/MonitorStepIoTMonitor";
import { KubernetesResourceScope } from "Common/Types/Monitor/MonitorStepKubernetesMonitor";
import { ProxmoxResourceScope } from "Common/Types/Monitor/MonitorStepProxmoxMonitor";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import SqlDatabaseType from "Common/Types/Monitor/SqlDatabaseType";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import {
  buildDictionaryValue,
  DictionaryEntryValue,
  DictionaryFilterOperator,
} from "Common/UI/Components/Dictionary/DictionaryFilterOperator";
import MonitorStepViewModel, {
  MonitorStepViewRow,
  MonitorStepViewValueType,
} from "../../FeatureSet/Dashboard/src/Utils/MonitorStepViewModel";

/*
 * WHAT THIS FILE PROTECTS
 *
 * The monitor "Criteria" page renders the step configuration above the
 * criteria. Before MonitorStepViewModel existed, that rendering was an
 * if/else chain in the viewer component covering roughly a third of the
 * monitor types we ship. Every other type — Metrics, the nine
 * infrastructure/telemetry types, DNS, Exceptions, Network Device, SSL
 * Certificate — fell off the end of the chain and rendered NOTHING: the
 * page showed a "Monitor Details" heading with empty space under it while
 * the edit modal showed the full configuration.
 *
 * The failure was silent in the worst way. Nothing threw, nothing warned;
 * a monitor type shipped, its form was built, and the read-only view of it
 * simply never existed. Adding a type is the moment the gap opens, and
 * nothing about adding a type forces anyone to look at the viewer.
 *
 * So the central test here is `getRows` over EVERY active monitor type at
 * once: a type either produces rows, or it is on the explicit list of types
 * that genuinely have no step configuration. There is no third outcome, and
 * a new monitor type cannot quietly become one.
 */

/*
 * Monitor types with no per-step configuration at all. Manual monitors
 * cannot be checked; Server, Incoming Request and Incoming Email are pushed
 * TO us, so there is nothing to configure about the request we send; the
 * Profiles picker is deliberately unbuilt (see MonitorTypeHelper). Anything
 * else showing zero rows is the bug this file exists to catch.
 */
const MONITOR_TYPES_WITHOUT_STEP_CONFIG: Array<MonitorType> = [
  MonitorType.Manual,
  MonitorType.Server,
  MonitorType.IncomingRequest,
  MonitorType.IncomingEmail,
  MonitorType.Profiles,
];

const METRIC_VIEW_CONFIG: MetricsViewConfig = {
  queryConfigs: [
    {
      metricAliasData: {
        metricVariable: "a",
        title: "CPU Usage",
        description: undefined,
        legend: undefined,
        legendUnit: undefined,
      },
      metricQueryData: {
        filterData: {
          metricName: "container.cpu.usage",
          aggegationType: AggregationType.Avg,
        },
        groupByAttributeKeys: ["host.name"],
      },
    },
    {
      metricQueryData: {
        filterData: {
          metricName: "container.memory.usage",
          aggegationType: AggregationType.Max,
        },
      },
    },
  ],
  formulaConfigs: [
    {
      metricAliasData: {
        metricVariable: "c",
        title: "CPU Percent",
        description: undefined,
        legend: undefined,
        legendUnit: undefined,
      },
      metricFormulaData: {
        metricFormula: "a * 100",
      },
    },
  ],
};

function buildStep(data: Partial<MonitorStepType>): MonitorStep {
  const monitorStep: MonitorStep = new MonitorStep();

  monitorStep.data = {
    ...(monitorStep.data as MonitorStepType),
    ...data,
  } as MonitorStepType;

  return monitorStep;
}

/*
 * A fully-configured step for every monitor type that has one. Used by the
 * coverage test below and by the per-type assertions.
 */
function buildStepForMonitorType(monitorType: MonitorType): MonitorStep {
  switch (monitorType) {
    case MonitorType.API:
      return buildStep({
        monitorDestination: URL.fromString("https://api.example.com/health"),
        requestType: HTTPMethod.POST,
        requestBody: '{"ping":true}',
        requestHeaders: { Authorization: "Bearer token" },
        doNotFollowRedirects: true,
        allowSelfSignedCertificates: true,
        requestTimeoutInMs: 5000,
        retryCount: 2,
      });
    case MonitorType.Website:
      return buildStep({
        monitorDestination: URL.fromString("https://example.com"),
        doNotFollowRedirects: false,
      });
    case MonitorType.Ping:
      return buildStep({
        monitorDestination: new Hostname("ping.example.com"),
      });
    case MonitorType.IP:
      return buildStep({ monitorDestination: new IP("10.0.0.4") });
    case MonitorType.Port:
      return buildStep({
        monitorDestination: new Hostname("db.example.com"),
        monitorDestinationPort: new Port(5432),
      });
    case MonitorType.SSLCertificate:
      return buildStep({
        monitorDestination: URL.fromString("https://secure.example.com"),
      });
    case MonitorType.CustomJavaScriptCode:
      return buildStep({ customCode: "return { data: 1 };" });
    case MonitorType.SyntheticMonitor:
      return buildStep({
        customCode: "await page.goto('https://example.com');",
        browserTypes: [BrowserType.Chromium],
        screenSizeTypes: [ScreenSizeType.Desktop],
        retryCountOnError: 2,
      });
    case MonitorType.Domain:
      return buildStep({
        domainMonitor: {
          domainName: "example.com",
          lookupMethod: DomainLookupMethod.Auto,
          timeout: 10000,
          retries: 3,
        },
      });
    case MonitorType.DNS:
      return buildStep({
        dnsMonitor: {
          queryName: "example.com",
          recordType: DnsRecordType.A,
          hostname: "8.8.8.8",
          port: 53,
          timeout: 5000,
          retries: 3,
        },
      });
    case MonitorType.DNSSEC:
      return buildStep({
        dnssecMonitor: {
          domainName: "example.com",
          resolvers: ["1.1.1.1", "8.8.8.8"],
          checkNameserverConsistency: true,
          signatureExpiryWarningDays: 7,
          timeout: 10000,
          retries: 3,
        },
      });
    case MonitorType.SQLQuery:
      return buildStep({
        sqlMonitor: {
          databaseType: SqlDatabaseType.PostgreSQL,
          host: "db.example.com",
          port: 5432,
          databaseName: "orders",
          username: "readonly",
          password: "super-secret-password",
          useWindowsIntegratedAuthentication: false,
          useSsl: true,
          rejectUnauthorizedSsl: true,
          query: "SELECT count(*) FROM orders;",
          connectionTimeoutInMs: 10000,
          statementTimeoutInMs: 15000,
          maxRows: 100,
        },
      });
    case MonitorType.Database:
      return buildStep({
        databaseMonitor: {
          databaseType: SqlDatabaseType.MySQL,
          host: "replica.example.com",
          port: 3306,
          databaseName: "warehouse",
          username: "oneuptime_monitor",
          password: "super-secret-database-password",
          useWindowsIntegratedAuthentication: false,
          useSsl: true,
          rejectUnauthorizedSsl: true,
          connectionTimeoutInMs: 10000,
          statementTimeoutInMs: 5000,
          enabledMetricGroups: [
            DatabaseMetricGroup.Connections,
            DatabaseMetricGroup.Throughput,
            DatabaseMetricGroup.Locks,
          ],
        },
      });
    case MonitorType.ExternalStatusPage:
      return buildStep({
        externalStatusPageMonitor: {
          statusPageUrl: "https://status.example.com",
          provider: ExternalStatusPageProviderType.Auto,
          componentGroupName: "APIs",
          componentName: "Checkout API",
          timeout: 10000,
          retries: 3,
        },
      });
    case MonitorType.Logs:
      return buildStep({
        logMonitor: {
          attributes: { "service.name": "checkout" },
          body: "timeout",
          severityTexts: [LogSeverity.Error],
          telemetryServiceIds: [
            new ObjectID("11111111-1111-4111-8111-111111111111"),
          ],
          entityKeys: ["host:web-1"],
          lastXSecondsOfLogs: 300,
        },
      });
    case MonitorType.SecurityEvents:
      return buildStep({
        securityEventsMonitor: {
          attributes: { "principal.hostname": "web-1" },
          messageContains: "failed login",
          severityNames: [OcsfSeverity.High],
          classNames: ["Authentication"],
          telemetryServiceIds: [
            new ObjectID("11111111-1111-4111-8111-111111111111"),
          ],
          lastXSecondsOfEvents: 300,
        },
      });
    case MonitorType.Traces:
      return buildStep({
        traceMonitor: {
          attributes: { "http.route": "/checkout" },
          spanStatuses: [SpanStatus.Error],
          telemetryServiceIds: [
            new ObjectID("22222222-2222-4222-8222-222222222222"),
          ],
          entityKeys: ["pod:checkout-1"],
          lastXSecondsOfSpans: 120,
          spanName: "POST /checkout",
        },
      });
    case MonitorType.Exceptions:
      return buildStep({
        exceptionMonitor: {
          telemetryServiceIds: [
            new ObjectID("33333333-3333-4333-8333-333333333333"),
          ],
          entityKeys: ["container:api"],
          exceptionTypes: ["TypeError"],
          message: "undefined is not a function",
          includeResolved: true,
          includeArchived: false,
          lastXSecondsOfExceptions: 600,
        },
      });
    case MonitorType.NetworkDevice:
      return buildStep({
        networkDeviceMonitor: {
          networkDeviceId: "44444444-4444-4444-8444-444444444444",
          monitorInterfaces: true,
          collectEndpoints: false,
          oids: [],
        },
      });
    case MonitorType.Metrics:
      return buildStep({
        metricMonitor: {
          metricViewConfig: METRIC_VIEW_CONFIG,
          rollingTime: RollingTime.Past30Minutes,
          telemetryServiceIds: [
            new ObjectID("55555555-5555-4555-8555-555555555555"),
          ],
        },
      });
    case MonitorType.Kubernetes:
      return buildStep({
        kubernetesMonitor: {
          clusterIdentifier: "prod-cluster",
          resourceScope: KubernetesResourceScope.Workload,
          resourceFilters: {
            namespace: "payments",
            workloadType: "deployment",
            workloadName: "checkout",
          },
          metricViewConfig: METRIC_VIEW_CONFIG,
          rollingTime: RollingTime.Past5Minutes,
        },
      });
    case MonitorType.Docker:
      return buildStep({
        dockerMonitor: {
          hostIdentifier: "docker-host-1",
          containerFilters: {
            containerName: "checkout",
            containerImage: "checkout:latest",
          },
          metricViewConfig: METRIC_VIEW_CONFIG,
          rollingTime: RollingTime.Past5Minutes,
        },
      });
    case MonitorType.Podman:
      return buildStep({
        podmanMonitor: {
          hostIdentifier: "podman-host-1",
          containerFilters: { containerName: "billing" },
          metricViewConfig: METRIC_VIEW_CONFIG,
          rollingTime: RollingTime.Past5Minutes,
        },
      });
    case MonitorType.Host:
      return buildStep({
        hostMonitor: {
          hostIdentifier: "web-1",
          metricViewConfig: METRIC_VIEW_CONFIG,
          rollingTime: RollingTime.Past15Minutes,
        },
      });
    case MonitorType.Proxmox:
      return buildStep({
        proxmoxMonitor: {
          clusterIdentifier: "pve-cluster",
          resourceFilters: {
            scope: ProxmoxResourceScope.Guest,
            guestId: "qemu/100",
          },
          metricViewConfig: METRIC_VIEW_CONFIG,
          rollingTime: RollingTime.Past1Hour,
        },
      });
    case MonitorType.DockerSwarm:
      return buildStep({
        dockerSwarmMonitor: {
          clusterIdentifier: "swarm-cluster",
          resourceFilters: { serviceName: "api", nodeName: "swarm-node-2" },
          metricViewConfig: METRIC_VIEW_CONFIG,
          rollingTime: RollingTime.Past5Minutes,
        },
      });
    case MonitorType.Ceph:
      return buildStep({
        cephMonitor: {
          clusterIdentifier: "ceph-cluster",
          resourceFilters: { osdId: "osd.3", poolId: "2" },
          metricViewConfig: METRIC_VIEW_CONFIG,
          rollingTime: RollingTime.Past5Minutes,
        },
      });
    case MonitorType.IoTDevice:
      return buildStep({
        iotMonitor: {
          fleetIdentifier: "fleet-a",
          resourceFilters: {
            scope: IoTResourceScope.Device,
            deviceId: "device-9",
            deviceType: "sensor",
          },
          metricViewConfig: METRIC_VIEW_CONFIG,
          rollingTime: RollingTime.Past10Minutes,
        },
      });
    default:
      return buildStep({});
  }
}

function getRows(monitorType: MonitorType): Array<MonitorStepViewRow> {
  return MonitorStepViewModel.getRows({
    monitorStep: buildStepForMonitorType(monitorType),
    monitorType: monitorType,
  });
}

function getRow(
  monitorType: MonitorType,
  key: string,
): MonitorStepViewRow | undefined {
  return getRows(monitorType).find((row: MonitorStepViewRow) => {
    return row.key === key;
  });
}

function getRowTitles(monitorType: MonitorType): Array<string> {
  return getRows(monitorType).map((row: MonitorStepViewRow) => {
    return row.title;
  });
}

describe("MonitorStepViewModel.getRows — coverage across monitor types", () => {
  it.each(
    MonitorTypeHelper.getActiveMonitorTypes().filter(
      (monitorType: MonitorType) => {
        return !MONITOR_TYPES_WITHOUT_STEP_CONFIG.includes(monitorType);
      },
    ),
  )(
    "renders at least one configuration row for %s monitors",
    (monitorType: MonitorType) => {
      const rows: Array<MonitorStepViewRow> = getRows(monitorType);

      expect(rows.length).toBeGreaterThan(0);
    },
  );

  it.each(MONITOR_TYPES_WITHOUT_STEP_CONFIG)(
    "renders no configuration rows for %s monitors, which have no step config",
    (monitorType: MonitorType) => {
      expect(
        MonitorStepViewModel.getRows({
          monitorStep: buildStep({}),
          monitorType: monitorType,
        }),
      ).toEqual([]);
    },
  );

  it("gives every row a unique key so Detail cannot collapse two rows into one", () => {
    for (const monitorType of MonitorTypeHelper.getActiveMonitorTypes()) {
      const keys: Array<string> = getRows(monitorType).map(
        (row: MonitorStepViewRow) => {
          return row.key;
        },
      );

      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("gives every row a title, a description and a placeholder", () => {
    for (const monitorType of MonitorTypeHelper.getActiveMonitorTypes()) {
      for (const row of getRows(monitorType)) {
        expect(row.title.length).toBeGreaterThan(0);
        expect(row.description.length).toBeGreaterThan(0);
        expect(row.placeholder.length).toBeGreaterThan(0);
      }
    }
  });

  it("returns no rows when the step carries no data at all", () => {
    const emptyStep: MonitorStep = new MonitorStep();
    emptyStep.data = undefined;

    expect(
      MonitorStepViewModel.getRows({
        monitorStep: emptyStep,
        monitorType: MonitorType.API,
      }),
    ).toEqual([]);

    expect(
      MonitorStepViewModel.getRows({
        monitorStep: undefined,
        monitorType: MonitorType.API,
      }),
    ).toEqual([]);
  });
});

describe("MonitorStepViewModel.getRows — probe monitors", () => {
  it("shows the API destination, method, body and headers", () => {
    expect(getRow(MonitorType.API, "monitorDestination")?.value).toBe(
      "https://api.example.com/health",
    );
    expect(getRow(MonitorType.API, "requestType")?.value).toBe(HTTPMethod.POST);
    expect(getRow(MonitorType.API, "requestBody")?.value).toBe('{"ping":true}');
    expect(getRow(MonitorType.API, "requestHeaders")?.value).toEqual({
      Authorization: "Bearer token",
    });
  });

  it("shows per-step timeout and retry overrides only when the user set them", () => {
    expect(getRow(MonitorType.API, "requestTimeoutInMs")?.value).toBe(
      "5000 ms",
    );
    expect(getRow(MonitorType.API, "retryCount")?.value).toBe(2);

    const withoutOverrides: Array<MonitorStepViewRow> =
      MonitorStepViewModel.getRows({
        monitorStep: buildStep({
          monitorDestination: URL.fromString("https://example.com"),
        }),
        monitorType: MonitorType.API,
      });

    expect(
      withoutOverrides.find((row: MonitorStepViewRow) => {
        return row.key === "requestTimeoutInMs";
      }),
    ).toBeUndefined();
  });

  it("shows the port monitor's destination and port", () => {
    expect(getRow(MonitorType.Port, "monitorDestination")?.value).toBe(
      "db.example.com",
    );
    expect(getRow(MonitorType.Port, "monitorDestinationPort")?.value).toBe(
      "5432",
    );
  });

  it("shows the SSL certificate monitor's destination, which used to render nothing", () => {
    expect(
      getRow(MonitorType.SSLCertificate, "monitorDestination")?.value,
    ).toBe(
      // URL.toString() renders the root path explicitly.
      "https://secure.example.com/",
    );
  });

  it("labels the IP monitor's destination as an IP address", () => {
    expect(getRow(MonitorType.IP, "monitorDestination")?.title).toBe(
      "IP Address",
    );
    expect(getRow(MonitorType.IP, "monitorDestination")?.value).toBe(
      "10.0.0.4",
    );
  });

  it("renders a destination row with a placeholder rather than dropping it when unset", () => {
    const rows: Array<MonitorStepViewRow> = MonitorStepViewModel.getRows({
      monitorStep: buildStep({}),
      monitorType: MonitorType.Ping,
    });

    const destination: MonitorStepViewRow | undefined = rows.find(
      (row: MonitorStepViewRow) => {
        return row.key === "monitorDestination";
      },
    );

    expect(destination).toBeDefined();
    expect(destination?.value).toBeUndefined();
    expect(destination?.placeholder).toBe("No data entered");
  });

  it("confirms mTLS is configured without ever exposing the certificate", () => {
    const rows: Array<MonitorStepViewRow> = MonitorStepViewModel.getRows({
      monitorStep: buildStep({
        monitorDestination: URL.fromString("https://mtls.example.com"),
        tlsClientCertificate: "-----BEGIN CERTIFICATE-----SECRET",
        tlsClientKey: "-----BEGIN PRIVATE KEY-----SECRET",
        tlsClientKeyPassphrase: "passphrase",
      }),
      monitorType: MonitorType.API,
    });

    const certificateRow: MonitorStepViewRow | undefined = rows.find(
      (row: MonitorStepViewRow) => {
        return row.key === "tlsClientCertificate";
      },
    );

    expect(certificateRow?.value).toBe("Configured");

    const serialized: string = JSON.stringify(rows);
    expect(serialized).not.toContain("BEGIN CERTIFICATE");
    expect(serialized).not.toContain("BEGIN PRIVATE KEY");
    expect(serialized).not.toContain("passphrase");
  });

  it("omits the mTLS row entirely when no client certificate is configured", () => {
    expect(getRow(MonitorType.Website, "tlsClientCertificate")).toBeUndefined();
  });

  it("shows synthetic monitor browsers, screen sizes and retry count", () => {
    expect(getRow(MonitorType.SyntheticMonitor, "browserTypes")?.value).toEqual(
      [BrowserType.Chromium],
    );
    expect(
      getRow(MonitorType.SyntheticMonitor, "screenSizeTypes")?.value,
    ).toEqual([ScreenSizeType.Desktop]);
    expect(
      getRow(MonitorType.SyntheticMonitor, "retryCountOnError")?.value,
    ).toBe(2);
  });

  it("renders custom code as JavaScript so it is syntax highlighted", () => {
    expect(
      getRow(MonitorType.CustomJavaScriptCode, "customCode")?.valueType,
    ).toBe(MonitorStepViewValueType.JavaScript);
  });
});

describe("MonitorStepViewModel.getRows — DNS, domain and database monitors", () => {
  it("shows the DNS query, record type and resolver, which used to render nothing", () => {
    expect(getRow(MonitorType.DNS, "queryName")?.value).toBe("example.com");
    expect(getRow(MonitorType.DNS, "recordType")?.value).toBe(DnsRecordType.A);
    expect(getRow(MonitorType.DNS, "dnsServer")?.value).toBe("8.8.8.8");
  });

  it("tells the operator the system resolver is used when no DNS server is set", () => {
    const rows: Array<MonitorStepViewRow> = MonitorStepViewModel.getRows({
      monitorStep: buildStep({
        dnsMonitor: {
          queryName: "example.com",
          recordType: DnsRecordType.CNAME,
          hostname: "",
          port: 53,
          timeout: 5000,
          retries: 3,
        },
      }),
      monitorType: MonitorType.DNS,
    });

    const dnsServer: MonitorStepViewRow | undefined = rows.find(
      (row: MonitorStepViewRow) => {
        return row.key === "dnsServer";
      },
    );

    expect(dnsServer?.value).toBeUndefined();
    expect(dnsServer?.placeholder).toBe("System default resolver");
  });

  it("shows the domain name and lookup method", () => {
    expect(getRow(MonitorType.Domain, "domainName")?.value).toBe("example.com");
    expect(getRow(MonitorType.Domain, "lookupMethod")?.value).toBe(
      DomainLookupMethod.Auto,
    );
  });

  it("falls back to the Auto lookup method for steps saved before it existed", () => {
    const rows: Array<MonitorStepViewRow> = MonitorStepViewModel.getRows({
      monitorStep: buildStep({
        domainMonitor: {
          domainName: "legacy.example.com",
        } as MonitorStepType["domainMonitor"],
      }),
      monitorType: MonitorType.Domain,
    });

    expect(
      rows.find((row: MonitorStepViewRow) => {
        return row.key === "lookupMethod";
      })?.value,
    ).toBe(DomainLookupMethod.Auto);
  });

  it("shows the DNSSEC zone and its resolvers", () => {
    expect(getRow(MonitorType.DNSSEC, "dnssecDomainName")?.value).toBe(
      "example.com",
    );
    expect(getRow(MonitorType.DNSSEC, "dnssecResolvers")?.value).toEqual([
      "1.1.1.1",
      "8.8.8.8",
    ]);
  });

  it("summarizes the SQL connection and shows the query", () => {
    expect(getRow(MonitorType.SQLQuery, "sqlDatabase")?.value).toBe(
      "PostgreSQL · db.example.com:5432/orders",
    );
    expect(getRow(MonitorType.SQLQuery, "sqlQuery")?.value).toBe(
      "SELECT count(*) FROM orders;",
    );
  });

  it("never exposes the SQL password", () => {
    expect(JSON.stringify(getRows(MonitorType.SQLQuery))).not.toContain(
      "super-secret-password",
    );
  });

  it("summarizes the database connection and the groups it collects", () => {
    expect(getRow(MonitorType.Database, "databaseConnection")?.value).toBe(
      "MySQL · replica.example.com:3306/warehouse",
    );
    expect(getRow(MonitorType.Database, "databaseUsername")?.value).toBe(
      "oneuptime_monitor",
    );
    expect(getRow(MonitorType.Database, "databaseMetricGroups")?.value).toEqual(
      [
        DatabaseMetricGroup.Connections,
        DatabaseMetricGroup.Throughput,
        DatabaseMetricGroup.Locks,
      ],
    );
    expect(
      getRow(MonitorType.Database, "databaseStatementTimeoutInMs")?.value,
    ).toBe("5000 ms");
  });

  /*
   * The credential never reaches this page in any form. There is not even a
   * masked row for it: a row titled "Password" whose value is dots still
   * tells a reader the field is set, and a step often holds a
   * {{monitorSecrets.name}} reference there, which names the secret.
   */
  it("never exposes the database password", () => {
    const rows: Array<MonitorStepViewRow> = getRows(MonitorType.Database);

    expect(JSON.stringify(rows)).not.toContain(
      "super-secret-database-password",
    );

    for (const row of rows) {
      expect(row.key.toLowerCase()).not.toContain("password");
      expect(row.title.toLowerCase()).not.toContain("password");
    }
  });

  it("shows the external status page URL, provider and component filters", () => {
    expect(getRow(MonitorType.ExternalStatusPage, "statusPageUrl")?.value).toBe(
      "https://status.example.com",
    );
    expect(
      getRow(MonitorType.ExternalStatusPage, "componentGroupName")?.value,
    ).toBe("APIs");
    expect(getRow(MonitorType.ExternalStatusPage, "componentName")?.value).toBe(
      "Checkout API",
    );
  });
});

describe("MonitorStepViewModel.getRows — telemetry monitors", () => {
  it("shows the log filter, window, severity and attributes", () => {
    expect(getRow(MonitorType.Logs, "logBody")?.value).toBe("timeout");
    expect(getRow(MonitorType.Logs, "lastXSecondsOfLogs")?.value).toBe(
      "5 minutes",
    );
    expect(getRow(MonitorType.Logs, "severityTexts")?.value).toEqual([
      LogSeverity.Error,
    ]);
    expect(getRow(MonitorType.Logs, "logAttributes")?.value).toEqual({
      "service.name": "checkout",
    });
  });

  it("carries telemetry service ids as strings for the viewer to resolve", () => {
    const row: MonitorStepViewRow | undefined = getRow(
      MonitorType.Logs,
      "logTelemetryServices",
    );

    expect(row?.valueType).toBe(MonitorStepViewValueType.TelemetryServices);
    expect(row?.value).toEqual(["11111111-1111-4111-8111-111111111111"]);
  });

  it("names span statuses instead of printing their numeric OTel codes", () => {
    expect(getRow(MonitorType.Traces, "spanStatuses")?.value).toEqual([
      "Error",
    ]);
    expect(getRow(MonitorType.Traces, "spanName")?.value).toBe(
      "POST /checkout",
    );
    expect(getRow(MonitorType.Traces, "lastXSecondsOfSpans")?.value).toBe(
      "2 minutes",
    );
  });

  it("shows exception monitor configuration, which used to render nothing", () => {
    expect(getRow(MonitorType.Exceptions, "exceptionMessage")?.value).toBe(
      "undefined is not a function",
    );
    expect(getRow(MonitorType.Exceptions, "exceptionTypes")?.value).toEqual([
      "TypeError",
    ]);
    expect(
      getRow(MonitorType.Exceptions, "lastXSecondsOfExceptions")?.value,
    ).toBe("10 minutes");
    expect(getRow(MonitorType.Exceptions, "includeResolved")?.value).toBe(true);
    expect(getRow(MonitorType.Exceptions, "includeArchived")?.value).toBe(
      false,
    );
  });

  it("shows the network device the monitor alerts on, which used to render nothing", () => {
    const row: MonitorStepViewRow | undefined = getRow(
      MonitorType.NetworkDevice,
      "networkDeviceId",
    );

    expect(row?.valueType).toBe(MonitorStepViewValueType.NetworkDevice);
    expect(row?.value).toBe("44444444-4444-4444-8444-444444444444");
  });
});

/*
 * WHY THIS BLOCK EXISTS
 *
 * "Filter by Attributes" grew an operator dropdown, and only the implicit
 * `=` still stores a bare string. Every other operator stores an operator
 * instance (`Search`, `Includes`, `IsNull`, ...) — or, once the step has
 * been read back from storage, the `{_type, value}` JSON those serialize to.
 *
 * The three attribute rows used to leave the view model typed JSON, so
 * `Detail` ran them through `JSON.stringify` and the criteria page printed
 * the wire shape where the operator belonged:
 *
 *   { "env": { "_type": "Search", "value": "web" } }
 *
 * for a monitor that means `env: contains web`. Nothing threw — the JSON
 * branch stringifies rather than handing an object to React — so the row
 * was unreadable without ever being a failure that showed up anywhere but
 * on the page itself. That is why it outlived the fix for the criteria
 * modal crash sitting right next to it.
 *
 * Every operator is pinned here, on every monitor type that has an
 * attribute row, because "renders as its own internals" is exactly the bug
 * that a spot check of one operator walks straight past.
 */

interface AttributeFilterFixture {
  label: string;
  monitorType: MonitorType;
  rowKey: string;
  buildStepWithAttributes: (
    attributes: Dictionary<DictionaryEntryValue>,
  ) => MonitorStep;
}

/*
 * The step shapes declare `attributes` as a map of scalars, which stopped
 * being true when the operator dropdown shipped. Production reads it back
 * through that same lie (see `toAttributeFilters`), so the fixtures store
 * values the way the form actually writes them rather than the way the
 * type claims.
 */
function asStoredAttributes(
  attributes: Dictionary<DictionaryEntryValue>,
): Dictionary<string | number | boolean> {
  return attributes as unknown as Dictionary<string | number | boolean>;
}

const ATTRIBUTE_FILTER_FIXTURES: Array<AttributeFilterFixture> = [
  {
    label: "log",
    monitorType: MonitorType.Logs,
    rowKey: "logAttributes",
    buildStepWithAttributes: (
      attributes: Dictionary<DictionaryEntryValue>,
    ): MonitorStep => {
      const step: MonitorStep = buildStepForMonitorType(MonitorType.Logs);
      const data: MonitorStepType = step.data as MonitorStepType;

      data.logMonitor = {
        ...data.logMonitor!,
        attributes: asStoredAttributes(attributes),
      };

      return step;
    },
  },
  {
    label: "trace",
    monitorType: MonitorType.Traces,
    rowKey: "spanAttributes",
    buildStepWithAttributes: (
      attributes: Dictionary<DictionaryEntryValue>,
    ): MonitorStep => {
      const step: MonitorStep = buildStepForMonitorType(MonitorType.Traces);
      const data: MonitorStepType = step.data as MonitorStepType;

      data.traceMonitor = {
        ...data.traceMonitor!,
        attributes: asStoredAttributes(attributes),
      };

      return step;
    },
  },
  {
    label: "security events",
    monitorType: MonitorType.SecurityEvents,
    rowKey: "securityEventAttributes",
    buildStepWithAttributes: (
      attributes: Dictionary<DictionaryEntryValue>,
    ): MonitorStep => {
      const step: MonitorStep = buildStepForMonitorType(
        MonitorType.SecurityEvents,
      );
      const data: MonitorStepType = step.data as MonitorStepType;

      data.securityEventsMonitor = {
        ...data.securityEventsMonitor!,
        attributes: asStoredAttributes(attributes),
      };

      return step;
    },
  },
];

interface AttributeOperatorCase {
  label: string;
  operator: DictionaryFilterOperator;
  rawValue: string;
  rawValues?: Array<string> | undefined;
  rendersAs: string;
}

const ATTRIBUTE_OPERATOR_CASES: Array<AttributeOperatorCase> = [
  {
    label: "equals",
    operator: DictionaryFilterOperator.EqualTo,
    rawValue: "web",
    // Bare, because `=` is the implicit operator and how these have always read.
    rendersAs: "web",
  },
  {
    label: "does not equal",
    operator: DictionaryFilterOperator.NotEqual,
    rawValue: "web",
    rendersAs: "does not equal web",
  },
  {
    label: "is any of",
    operator: DictionaryFilterOperator.IsAnyOf,
    rawValue: "",
    rawValues: ["web", "api"],
    rendersAs: "is any of web, api",
  },
  {
    label: "is none of",
    operator: DictionaryFilterOperator.IsNoneOf,
    rawValue: "",
    rawValues: ["web", "api"],
    rendersAs: "is none of web, api",
  },
  {
    label: "contains",
    operator: DictionaryFilterOperator.Contains,
    rawValue: "web",
    rendersAs: "contains web",
  },
  {
    label: "does not contain",
    operator: DictionaryFilterOperator.NotContains,
    rawValue: "web",
    rendersAs: "does not contain web",
  },
  {
    label: "starts with",
    operator: DictionaryFilterOperator.StartsWith,
    rawValue: "web",
    rendersAs: "starts with web",
  },
  {
    label: "ends with",
    operator: DictionaryFilterOperator.EndsWith,
    rawValue: "web",
    rendersAs: "ends with web",
  },
  {
    label: "matches",
    operator: DictionaryFilterOperator.Matches,
    rawValue: "web-*",
    rendersAs: "matches web-*",
  },
  {
    label: "does not match",
    operator: DictionaryFilterOperator.NotMatches,
    rawValue: "web-*",
    rendersAs: "does not match web-*",
  },
  {
    label: "greater than",
    operator: DictionaryFilterOperator.GreaterThan,
    rawValue: "500",
    rendersAs: "greater than 500",
  },
  {
    label: "greater than or equal",
    operator: DictionaryFilterOperator.GreaterThanOrEqual,
    rawValue: "500",
    rendersAs: "greater than or equal 500",
  },
  {
    label: "less than",
    operator: DictionaryFilterOperator.LessThan,
    rawValue: "500",
    rendersAs: "less than 500",
  },
  {
    label: "less than or equal",
    operator: DictionaryFilterOperator.LessThanOrEqual,
    rawValue: "500",
    rendersAs: "less than or equal 500",
  },
  {
    label: "is empty",
    operator: DictionaryFilterOperator.IsEmpty,
    rawValue: "",
    rendersAs: "is empty",
  },
  {
    label: "is not empty",
    operator: DictionaryFilterOperator.IsNotEmpty,
    rawValue: "",
    rendersAs: "is not empty",
  },
];

function getAttributeRow(
  fixture: AttributeFilterFixture,
  attributes: Dictionary<DictionaryEntryValue>,
): MonitorStepViewRow | undefined {
  return MonitorStepViewModel.getRows({
    monitorStep: fixture.buildStepWithAttributes(attributes),
    monitorType: fixture.monitorType,
  }).find((row: MonitorStepViewRow) => {
    return row.key === fixture.rowKey;
  });
}

describe("MonitorStepViewModel.getRows — attribute filter operators", () => {
  /*
   * The cases below are the whole point of this block, so an operator added
   * to the dropdown must not be able to slip past them untested.
   */
  it("names every operator the dropdown offers", () => {
    const covered: Array<string> = ATTRIBUTE_OPERATOR_CASES.map(
      (operatorCase: AttributeOperatorCase) => {
        return String(operatorCase.operator);
      },
    ).sort();

    expect(covered).toEqual(Object.values(DictionaryFilterOperator).sort());
  });

  it("covers every monitor type whose step carries attribute filters", () => {
    const covered: Array<MonitorType> = ATTRIBUTE_FILTER_FIXTURES.map(
      (fixture: AttributeFilterFixture) => {
        return fixture.monitorType;
      },
    );

    expect(covered).toEqual([
      MonitorType.Logs,
      MonitorType.Traces,
      MonitorType.SecurityEvents,
    ]);
  });
});

describe.each(ATTRIBUTE_FILTER_FIXTURES)(
  "MonitorStepViewModel.getRows — $label monitor attribute filters",
  (fixture: AttributeFilterFixture) => {
    it.each(ATTRIBUTE_OPERATOR_CASES)(
      'renders "$label" as text instead of the operator object it is stored as',
      (operatorCase: AttributeOperatorCase) => {
        const row: MonitorStepViewRow | undefined = getAttributeRow(fixture, {
          env: buildDictionaryValue({
            operator: operatorCase.operator,
            rawValue: operatorCase.rawValue,
            rawValues: operatorCase.rawValues,
          }),
        });

        /*
         * A JSON row would be handed to `JSON.stringify`; a dictionary of
         * strings is tabulated as-is. The value type is half the fix.
         */
        expect(row?.valueType).toBe(
          MonitorStepViewValueType.DictionaryOfStrings,
        );
        expect(row?.value).toEqual({ env: operatorCase.rendersAs });
      },
    );

    it("names the operator for a step read back from storage as raw JSON", () => {
      /*
       * What the API actually returns: the operator instances serialized to
       * their `{_type, value}` form, never rehydrated into classes. That
       * shape printed verbatim on the page before this fix.
       */
      const row: MonitorStepViewRow | undefined = getAttributeRow(fixture, {
        env: new Search<string>(
          "web",
        ).toJSON() as unknown as DictionaryEntryValue,
        tier: new Includes([
          "web",
          "api",
        ]).toJSON() as unknown as DictionaryEntryValue,
        region: new IsNull().toJSON() as unknown as DictionaryEntryValue,
      });

      expect(row?.value).toEqual({
        env: "contains web",
        tier: "is any of web, api",
        region: "is empty",
      });
    });

    it("renders every value as a string, whatever the operator mix", () => {
      const attributes: Dictionary<DictionaryEntryValue> = {};

      for (const operatorCase of ATTRIBUTE_OPERATOR_CASES) {
        attributes[operatorCase.label] = buildDictionaryValue({
          operator: operatorCase.operator,
          rawValue: operatorCase.rawValue,
          rawValues: operatorCase.rawValues,
        });
      }

      const row: MonitorStepViewRow | undefined = getAttributeRow(
        fixture,
        attributes,
      );

      const values: Array<unknown> = Object.values(
        row?.value as Dictionary<string>,
      );

      expect(values).toHaveLength(ATTRIBUTE_OPERATOR_CASES.length);

      for (const value of values) {
        expect(typeof value).toBe("string");
      }
    });

    it("shows the operator alone when a membership filter names no values", () => {
      /*
       * An empty `Includes` is a no-op downstream — StatementGenerator skips
       * the predicate rather than emitting `IN ()` — so there is nothing to
       * list after the label.
       */
      const row: MonitorStepViewRow | undefined = getAttributeRow(fixture, {
        env: buildDictionaryValue({
          operator: DictionaryFilterOperator.IsAnyOf,
          rawValue: "",
          rawValues: [],
        }),
      });

      expect(row?.value).toEqual({ env: "is any of" });
    });

    it("keeps a plain string filter unchanged, as saved before operators shipped", () => {
      const row: MonitorStepViewRow | undefined = getAttributeRow(fixture, {
        "service.name": "checkout",
      });

      expect(row?.value).toEqual({ "service.name": "checkout" });
    });

    it("drops the row when no attributes are configured", () => {
      expect(getAttributeRow(fixture, {})).toBeUndefined();
    });
  },
);

describe("MonitorStepViewModel.getRows — metric-backed monitors", () => {
  const METRIC_MONITOR_TYPES: Array<MonitorType> = [
    MonitorType.Metrics,
    MonitorType.Kubernetes,
    MonitorType.Docker,
    MonitorType.Podman,
    MonitorType.Host,
    MonitorType.Proxmox,
    MonitorType.DockerSwarm,
    MonitorType.Ceph,
    MonitorType.IoTDevice,
  ];

  it.each(METRIC_MONITOR_TYPES)(
    "names the metrics a %s monitor queries",
    (monitorType: MonitorType) => {
      expect(getRow(monitorType, "metricNames")?.value).toEqual([
        "CPU Usage (container.cpu.usage · Avg)",
        "container.memory.usage · Max",
      ]);
    },
  );

  it.each(METRIC_MONITOR_TYPES)(
    "shows the rolling window a %s monitor evaluates over",
    (monitorType: MonitorType) => {
      const row: MonitorStepViewRow | undefined = getRow(
        monitorType,
        "rollingTime",
      );

      expect(row?.title).toBe("Time Range");
      expect(typeof row?.value).toBe("string");
      expect((row?.value as string).length).toBeGreaterThan(0);
    },
  );

  it.each(METRIC_MONITOR_TYPES)(
    "shows formulas and group-by keys for a %s monitor",
    (monitorType: MonitorType) => {
      expect(getRow(monitorType, "metricFormulas")?.value).toEqual([
        "CPU Percent (a * 100)",
      ]);
      expect(getRow(monitorType, "metricGroupBy")?.value).toEqual([
        "host.name",
      ]);
    },
  );

  it("shows the Kubernetes cluster, scope and resource filters", () => {
    expect(getRow(MonitorType.Kubernetes, "clusterIdentifier")?.value).toBe(
      "prod-cluster",
    );
    expect(getRow(MonitorType.Kubernetes, "resourceScope")?.value).toBe(
      KubernetesResourceScope.Workload,
    );
    expect(getRow(MonitorType.Kubernetes, "namespace")?.value).toBe("payments");
    expect(getRow(MonitorType.Kubernetes, "workloadName")?.value).toBe(
      "checkout",
    );
  });

  it("drops Kubernetes filter rows that are not set instead of showing blanks", () => {
    const rows: Array<MonitorStepViewRow> = MonitorStepViewModel.getRows({
      monitorStep: buildStep({
        kubernetesMonitor: {
          clusterIdentifier: "prod-cluster",
          resourceScope: KubernetesResourceScope.Cluster,
          resourceFilters: {},
          metricViewConfig: METRIC_VIEW_CONFIG,
          rollingTime: RollingTime.Past5Minutes,
        },
      }),
      monitorType: MonitorType.Kubernetes,
    });

    const keys: Array<string> = rows.map((row: MonitorStepViewRow) => {
      return row.key;
    });

    expect(keys).toContain("clusterIdentifier");
    expect(keys).not.toContain("namespace");
    expect(keys).not.toContain("podName");
  });

  it("shows the Docker host and container filters", () => {
    expect(getRow(MonitorType.Docker, "hostIdentifier")?.value).toBe(
      "docker-host-1",
    );
    expect(getRow(MonitorType.Docker, "containerName")?.value).toBe("checkout");
    expect(getRow(MonitorType.Docker, "containerImage")?.value).toBe(
      "checkout:latest",
    );
  });

  it("shows the Podman host and container filter", () => {
    expect(getRow(MonitorType.Podman, "hostIdentifier")?.value).toBe(
      "podman-host-1",
    );
    expect(getRow(MonitorType.Podman, "containerName")?.value).toBe("billing");
  });

  it("shows the Host monitor's host", () => {
    expect(getRow(MonitorType.Host, "hostIdentifier")?.value).toBe("web-1");
    expect(getRowTitles(MonitorType.Host)).toContain("Host");
  });

  it("shows the Proxmox cluster, scope and guest", () => {
    expect(getRow(MonitorType.Proxmox, "clusterIdentifier")?.value).toBe(
      "pve-cluster",
    );
    expect(getRow(MonitorType.Proxmox, "proxmoxScope")?.value).toBe(
      ProxmoxResourceScope.Guest,
    );
    expect(getRow(MonitorType.Proxmox, "proxmoxGuestId")?.value).toBe(
      "qemu/100",
    );
  });

  it("shows the Docker Swarm cluster, service and node", () => {
    expect(getRow(MonitorType.DockerSwarm, "clusterIdentifier")?.value).toBe(
      "swarm-cluster",
    );
    expect(getRow(MonitorType.DockerSwarm, "swarmServiceName")?.value).toBe(
      "api",
    );
    expect(getRow(MonitorType.DockerSwarm, "swarmNodeName")?.value).toBe(
      "swarm-node-2",
    );
  });

  it("shows the Ceph cluster, OSD and pool", () => {
    expect(getRow(MonitorType.Ceph, "clusterIdentifier")?.value).toBe(
      "ceph-cluster",
    );
    expect(getRow(MonitorType.Ceph, "cephOsdId")?.value).toBe("osd.3");
    expect(getRow(MonitorType.Ceph, "cephPoolId")?.value).toBe("2");
  });

  it("shows the IoT fleet, scope and device", () => {
    expect(getRow(MonitorType.IoTDevice, "fleetIdentifier")?.value).toBe(
      "fleet-a",
    );
    expect(getRow(MonitorType.IoTDevice, "iotScope")?.value).toBe(
      IoTResourceScope.Device,
    );
    expect(getRow(MonitorType.IoTDevice, "iotDeviceId")?.value).toBe(
      "device-9",
    );
  });

  it("still renders the identity row when a metric monitor has no metrics selected yet", () => {
    const rows: Array<MonitorStepViewRow> = MonitorStepViewModel.getRows({
      monitorStep: buildStep({
        hostMonitor: {
          hostIdentifier: "web-9",
          metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
          rollingTime: RollingTime.Past5Minutes,
        },
      }),
      monitorType: MonitorType.Host,
    });

    const metricNames: MonitorStepViewRow | undefined = rows.find(
      (row: MonitorStepViewRow) => {
        return row.key === "metricNames";
      },
    );

    expect(metricNames?.value).toEqual([]);
    expect(metricNames?.placeholder).toBe("No metrics selected");
  });
});

describe("MonitorStepViewModel metric helpers", () => {
  it("prefers the alias title and falls back to the bare metric name", () => {
    expect(
      MonitorStepViewModel.getMetricQueryTitles(METRIC_VIEW_CONFIG),
    ).toEqual([
      "CPU Usage (container.cpu.usage · Avg)",
      "container.memory.usage · Max",
    ]);
  });

  it("drops queries that name no metric at all", () => {
    expect(
      MonitorStepViewModel.getMetricQueryTitles({
        queryConfigs: [{ metricQueryData: { filterData: {} } }],
        formulaConfigs: [],
      }),
    ).toEqual([]);
  });

  it("survives a metric view config saved by an older build", () => {
    expect(
      MonitorStepViewModel.getMetricQueryTitles(
        undefined as unknown as MetricsViewConfig,
      ),
    ).toEqual([]);

    expect(
      MonitorStepViewModel.getMetricQueryTitles({
        queryConfigs: null,
        formulaConfigs: null,
      } as unknown as MetricsViewConfig),
    ).toEqual([]);
  });

  it("de-duplicates group-by keys across queries", () => {
    expect(
      MonitorStepViewModel.getMetricGroupByKeys({
        queryConfigs: [
          {
            metricQueryData: {
              filterData: { metricName: "a" },
              groupByAttributeKeys: ["host.name", "service.name"],
            },
          },
          {
            metricQueryData: {
              filterData: { metricName: "b" },
              groupByAttributeKeys: ["host.name"],
            },
          },
        ],
        formulaConfigs: [],
      }),
    ).toEqual(["host.name", "service.name"]);
  });

  it("reads the metric view config out of whichever telemetry shape the step uses", () => {
    expect(
      MonitorStepViewModel.getMetricsViewConfig(
        buildStepForMonitorType(MonitorType.Ceph),
      ).queryConfigs,
    ).toHaveLength(2);

    expect(
      MonitorStepViewModel.getMetricsViewConfig(
        buildStepForMonitorType(MonitorType.API),
      ),
    ).toEqual({ queryConfigs: [], formulaConfigs: [] });
  });

  it("reads the rolling time out of whichever telemetry shape the step uses", () => {
    expect(
      MonitorStepViewModel.getRollingTime(
        buildStepForMonitorType(MonitorType.IoTDevice),
      ),
    ).toBe(RollingTime.Past10Minutes);

    expect(
      MonitorStepViewModel.getRollingTime(
        buildStepForMonitorType(MonitorType.Proxmox),
      ),
    ).toBe(RollingTime.Past1Hour);

    expect(
      MonitorStepViewModel.getRollingTime(
        buildStepForMonitorType(MonitorType.API),
      ),
    ).toBeUndefined();

    expect(MonitorStepViewModel.getRollingTime(undefined)).toBeUndefined();
  });

  it("offers a chart preview for every metric-backed monitor type and no others", () => {
    for (const monitorType of [
      MonitorType.Metrics,
      MonitorType.Kubernetes,
      MonitorType.Docker,
      MonitorType.Podman,
      MonitorType.Host,
      MonitorType.Proxmox,
      MonitorType.DockerSwarm,
      MonitorType.Ceph,
      MonitorType.IoTDevice,
    ]) {
      expect(MonitorStepViewModel.hasMetricPreview(monitorType)).toBe(true);
    }

    for (const monitorType of [
      MonitorType.API,
      MonitorType.Website,
      MonitorType.Logs,
      MonitorType.Traces,
      MonitorType.Exceptions,
      MonitorType.Manual,
    ]) {
      expect(MonitorStepViewModel.hasMetricPreview(monitorType)).toBe(false);
    }
  });
});
