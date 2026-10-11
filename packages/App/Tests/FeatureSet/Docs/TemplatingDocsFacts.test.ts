import { describe, expect, it, jest } from "@jest/globals";

/*
 * MonitorTemplateUtil renders the templates through VMUtil, whose module
 * also loads the sandbox runner, the logger and tracing. Rendering needs
 * none of them.
 */
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return {
    __esModule: true,
    default: {
      runCodeInSandbox: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      error: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (
        _target: unknown,
        _propertyKey: string,
        descriptor: PropertyDescriptor,
      ): PropertyDescriptor => {
        return descriptor;
      };
    },
  };
});

import {
  DocsFence,
  DocsHeading,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import DataToProcess from "Common/Server/Utils/Monitor/DataToProcess";
import IncomingRequestIncidentGrouping, {
  IncomingRequestGroupingItem,
} from "Common/Server/Utils/Monitor/IncomingRequestIncidentGrouping";
import MonitorTemplateUtil, {
  MaxEmailValueLengthInTitle,
} from "Common/Server/Utils/Monitor/MonitorTemplateUtil";
import SeriesContextEnricher from "Common/Server/Utils/Monitor/SeriesContextEnricher";
import { JSONObject } from "Common/Types/JSON";
import { getAllIoTAlertTemplates } from "Common/Types/Monitor/IotAlertTemplates";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import TemplateVariablesCatalog, {
  TemplateVariable,
  TemplateVariableGroup,
} from "Common/UI/Components/MonitorTemplateVariables/TemplateVariablesCatalog";
import FeedMarkdown from "Common/Utils/Markdown/FeedMarkdown";
import fs from "fs";
import path from "path";

/*
 * What the English Incident & Alert Templating page says, held to the code
 * that fills in a criteria's incident and alert templates
 * (MonitorTemplateUtil, VMUtil): every example renders the way the page
 * shows it, every variable table lists exactly what that monitor type's
 * check puts in the template, and the steps name the criteria form as it
 * is drawn. TemplatingAndAgentMonitorDocsTranslations then holds the 16
 * translations to this page.
 */

const PAGE: string = "monitor/incident-alert-templating";
const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");

const PLACEHOLDER: RegExp = /\{\{[^}]*\}\}/;
const TABLE_DELIMITER_ROW: RegExp = /^\|\s*:?-/;
const FIRST_CODE: RegExp = /^`([^`]+)`/;

// The variables MonitorTemplateUtil defines for every monitor.
const ALWAYS_DEFINED: Array<string> = [
  "seriesResourceSuffix",
  "seriesResourceSummary",
  "seriesResourceBlock",
  "seriesDebugCommands",
];

const english: string = readPage("en", PAGE);

function source(relativeToRepo: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativeToRepo), "utf8");
}

/*
 * The text under a heading, up to the next heading of the same or a higher
 * level. A "#" line inside a code sample is the sample's, not a heading.
 */
function sectionOf(heading: string): string {
  const lines: Array<string> = english.split("\n");
  const headings: Array<DocsHeading> = scanMarkdown(english).headings;
  const level: number = heading.indexOf(" ");
  const start: DocsHeading | undefined = headings.find(
    (candidate: DocsHeading): boolean => {
      return (
        candidate.level === level &&
        `${"#".repeat(level)} ${candidate.text}` === heading
      );
    },
  );

  expect({ heading, found: Boolean(start) }).toEqual({ heading, found: true });

  const end: DocsHeading | undefined = headings.find(
    (candidate: DocsHeading): boolean => {
      return candidate.line > start!.line && candidate.level <= level;
    },
  );

  // Heading lines count from 1.
  return lines.slice(start!.line, end ? end.line - 1 : undefined).join("\n");
}

// The code of the fence titled `title` in a text, the one at `index` when several are.
function fenceTitled(text: string, title: string, index: number = 0): string {
  const fences: Array<DocsFence> = scanMarkdown(text).fences.filter(
    (fence: DocsFence): boolean => {
      return fence.info.includes(`title="${title}"`);
    },
  );

  expect({ title, found: fences.length > index }).toEqual({
    title,
    found: true,
  });

  return fences[index]!.code;
}

// The body rows of the tables in a text, as trimmed cells, headers left out.
function tableRows(text: string): Array<Array<string>> {
  const rows: Array<Array<string>> = [];
  let isHeader: boolean = true;

  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) {
      isHeader = true;
      continue;
    }

    if (TABLE_DELIMITER_ROW.test(line)) {
      continue;
    }

    if (isHeader) {
      isHeader = false;
      continue;
    }

    rows.push(
      line
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        }),
    );
  }

  return rows;
}

// The variables the first column of a section's table names, sub-rows left out.
function documentedVariables(heading: string): Array<string> {
  return tableRows(sectionOf(heading))
    .map((cells: Array<string>): string => {
      return (cells[0]!.match(FIRST_CODE)?.[1] as string) || "";
    })
    .filter((name: string): boolean => {
      return name !== "" && !name.includes("[]") && !name.startsWith("{{");
    });
}

function storageMap(
  monitorType: MonitorType,
  data: unknown,
  seriesLabels?: JSONObject | undefined,
): JSONObject {
  return MonitorTemplateUtil.buildTemplateStorageMap({
    monitorType,
    dataToProcess: data as DataToProcess,
    seriesLabels,
  });
}

// The variables a check of this type puts in the template, beyond the ones every monitor has.
function ownVariables(monitorType: MonitorType, data: unknown): Array<string> {
  return Object.keys(storageMap(monitorType, data))
    .filter((key: string): boolean => {
      return !ALWAYS_DEFINED.includes(key);
    })
    .sort();
}

function render(template: string, map: JSONObject): string {
  return MonitorTemplateUtil.processTemplateString({
    value: template,
    storageMap: map,
  });
}

const PROBE: { projectId: ObjectID; monitorId: ObjectID; probeId: ObjectID } = {
  projectId: ObjectID.generate(),
  monitorId: ObjectID.generate(),
  probeId: ObjectID.generate(),
};

// A check of each kind with every field it can report filled in.
const API_CHECK: JSONObject = {
  ...PROBE,
  isOnline: false,
  responseCode: 502,
  responseTimeInMs: 842,
  responseHeaders: { "content-type": "application/json" },
  responseBody: JSON.stringify({
    error: { id: "E42", message: "Upstream timed out", details: {} },
  }),
  failureCause: "",
} as unknown as JSONObject;

const SERVER_CHECK: JSONObject = {
  hostname: "web-03.prod",
  requestReceivedAt: new Date("2026-10-11T09:00:00.000Z"),
  failureCause: "",
  basicInfrastructureMetrics: {
    cpuMetrics: { percentUsed: 87, cores: 8 },
    memoryMetrics: { percentUsed: 74, percentFree: 26, total: 16000000000 },
    diskMetrics: [
      { diskPath: "/", percentUsed: 91, percentFree: 9, total: 100 },
      { diskPath: "/data", percentUsed: 40, percentFree: 60, total: 500 },
    ],
  },
  processes: [
    { pid: 1, name: "systemd", command: "/sbin/init" },
    { pid: 812, name: "nginx", command: "nginx -g daemon off;" },
  ],
} as unknown as JSONObject;

const SNMP_CHECK: JSONObject = {
  ...PROBE,
  isOnline: true,
  snmpResponse: {
    responseTimeInMs: 120,
    failureCause: "",
    isTimeout: false,
    oidResponses: [
      {
        oid: "1.3.6.1.2.1.1.3.0",
        name: "sysUpTime",
        value: 4242,
        type: "TimeTicks",
      },
    ],
    interfaces: [
      {
        name: "Gi0/1",
        alias: "uplink",
        interfaceIndex: 1,
        isAdministrativelyUp: true,
        isOperationallyUp: false,
      },
      {
        name: "Gi0/2",
        alias: "",
        interfaceIndex: 2,
        isAdministrativelyUp: true,
        isOperationallyUp: true,
      },
    ],
    interfaceWalkFailure: "Walk of ifXTable timed out",
    tables: [],
    systemInfo: {
      sysName: "core-switch-01",
      sysDescr: "Cisco IOS Software",
      sysObjectId: "1.3.6.1.4.1.9.1.716",
      sysLocation: "DC1 Rack 42",
    },
  },
  snmpTrapResponse: {
    trapOid: "1.3.6.1.6.3.1.1.5.3",
    sourceIpAddress: "10.0.0.1",
    varbinds: [{ oid: "1.3.6.1.2.1.2.2.1.1.1", value: "1" }],
  },
} as unknown as JSONObject;

// Every documented table, the monitor types it is about, and a check of that type.
const TYPE_TABLES: Array<{
  heading: string;
  monitorTypes: Array<MonitorType>;
  check: unknown;
  // Variables a table names that come from a table walk or a trap, not the check above.
  alsoDocumented?: Array<string>;
}> = [
  {
    heading: "### Website and API Monitors",
    monitorTypes: [MonitorType.API, MonitorType.Website],
    check: API_CHECK,
  },
  {
    heading: "### Incoming Request Monitors",
    monitorTypes: [MonitorType.IncomingRequest],
    check: {
      requestBody: { status: "firing" },
      requestHeaders: { "user-agent": "Alertmanager/0.27.0" },
      requestMethod: "POST",
      incomingRequestReceivedAt: new Date("2026-10-11T09:00:00.000Z"),
    },
  },
  {
    heading: "### Incoming Email Monitors",
    monitorTypes: [MonitorType.IncomingEmail],
    check: {
      emailSubject: "[FAILED] Nightly backup",
      emailFrom: "backup@example.com",
      emailTo: "monitor-[REDACTED]@inbound.example.com",
      emailBody: "The backup failed.",
      emailReceivedAt: new Date("2026-10-11T09:00:00.000Z"),
    },
  },
  {
    heading: "### Ping, IP and Port Monitors",
    monitorTypes: [MonitorType.Ping, MonitorType.IP, MonitorType.Port],
    check: {
      ...PROBE,
      isOnline: false,
      responseTimeInMs: 42,
      failureCause: "Connection refused",
      isTimeout: false,
    },
  },
  {
    heading: "### NTP Monitors",
    monitorTypes: [MonitorType.NTP],
    check: {
      ...PROBE,
      isOnline: true,
      ntpResponse: {
        isSynchronized: true,
        responseTimeInMs: 18,
        failureCause: "",
        isTimeout: false,
        serverAddress: "192.0.2.10",
        port: 123,
        stratum: 2,
        kissCode: "",
        leapIndicator: 0,
        referenceId: "GPS",
        clockOffsetInMs: -12.4,
        roundTripDelayInMs: 9,
        rootDelayInMs: 1,
        rootDispersionInMs: 1,
        serverTime: "2026-10-11T09:00:00.000Z",
        referenceTime: "2026-10-11T08:59:00.000Z",
      },
    },
  },
  {
    heading: "### SSL Certificate Monitors",
    monitorTypes: [MonitorType.SSLCertificate],
    check: {
      ...PROBE,
      isOnline: true,
      failureCause: "",
      sslResponse: {
        isSelfSigned: false,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        expiresAt: new Date("2026-12-01T00:00:00.000Z"),
        commonName: "*.example.com",
        organizationalUnit: "IT",
        organization: "Example",
        locality: "London",
        state: "England",
        country: "GB",
        serialNumber: "01",
        fingerprint: "AA",
        fingerprint256: "BB",
      },
    },
  },
  {
    heading: "### DNS Monitors",
    monitorTypes: [MonitorType.DNS],
    check: {
      ...PROBE,
      isOnline: true,
      dnsResponse: {
        responseTimeInMs: 12,
        failureCause: "",
        isTimeout: false,
        isDnssecValid: true,
        records: [{ type: "A", value: "192.0.2.1", ttl: 300 }],
      },
    },
  },
  {
    heading: "### DNSSEC Monitors",
    monitorTypes: [MonitorType.DNSSEC],
    check: {
      ...PROBE,
      isOnline: true,
      dnssecResponse: {
        responseTimeInMs: 40,
        failureCause: "",
        domainName: "example.com",
        isZoneSigned: true,
        isParentDsPresent: true,
        isChainValid: true,
        resolverConsensusAd: true,
        isNameserverConsistent: true,
        earliestSignatureExpiration: "2026-11-01T00:00:00.000Z",
        daysUntilSignatureExpiry: 21,
        dnskeys: [{}],
        parentDsRecords: [{}],
        rrsigs: [{}],
      },
    },
  },
  {
    heading: "### Domain Monitors",
    monitorTypes: [MonitorType.Domain],
    check: {
      ...PROBE,
      isOnline: true,
      domainResponse: {
        responseTimeInMs: 300,
        failureCause: "",
        domainName: "example.com",
        registrar: "Example Registrar",
        createdDate: "2001-01-01",
        updatedDate: "2026-01-01",
        expiresDate: "2027-01-01",
        nameServers: ["ns1.example.com"],
        domainStatus: ["clientTransferProhibited"],
        dnssec: "signedDelegation",
        lookupMethod: "RDAP",
      },
    },
  },
  {
    heading: "### Server / VM Monitors",
    monitorTypes: [MonitorType.Server],
    check: SERVER_CHECK,
  },
  {
    heading: "### Synthetic Monitors",
    monitorTypes: [MonitorType.SyntheticMonitor],
    check: {
      ...PROBE,
      failureCause: "1 of 1 runs failed",
      syntheticMonitorResponse: [],
    },
  },
  {
    heading: "### Custom JavaScript Code Monitors",
    monitorTypes: [MonitorType.CustomJavaScriptCode],
    check: {
      ...PROBE,
      failureCause: "",
      customCodeMonitorResponse: {
        executionTimeInMS: 120,
        result: { status: "ok" },
        scriptError: "",
        logMessages: ["started"],
      },
    },
  },
  {
    heading: "### Network Device Monitors",
    monitorTypes: [MonitorType.NetworkDevice],
    check: SNMP_CHECK,
    // From a walked SNMP table and a per-row alert's series labels.
    alsoDocumented: ["tables", "snmpTable", "snmpTableRow"],
  },
  {
    heading: "### Database Health Monitors",
    monitorTypes: [MonitorType.Database],
    check: {
      ...PROBE,
      isOnline: true,
      databaseMonitorResponse: {
        isOnline: true,
        responseTimeInMs: 30,
        failureCause: "",
        connectionError: "",
        engineVersion: "PostgreSQL 17.0",
        collectedGroups: ["connections"],
        unavailableGroups: [],
        metrics: { "oneuptime.monitor.database.connections.used.percent": 12 },
      },
    },
  },
  {
    heading: "### External Status Page Monitors",
    monitorTypes: [MonitorType.ExternalStatusPage],
    check: {
      ...PROBE,
      isOnline: true,
      externalStatusPageResponse: {
        isOnline: true,
        responseTimeInMs: 200,
        failureCause: "",
        overallStatus: "major_outage",
        activeIncidentCount: 1,
        provider: "Atlassian Statuspage",
        componentGroupName: "API",
        componentName: "Login",
        componentStatuses: [
          {
            name: "Login",
            status: "major_outage",
            description: "",
            groupName: "API",
          },
        ],
      },
    },
  },
];

describe("Incident & Alert Templating, against the code that fills in templates", () => {
  describe("the examples render as the page shows them", () => {
    it("the title example", () => {
      const basic: string = sectionOf("## Basic usage");
      const map: JSONObject = MonitorTemplateUtil.buildTemplateStorageMap({
        monitorType: MonitorType.API,
        dataToProcess: API_CHECK as unknown as DataToProcess,
        monitor: (() => {
          const monitor: Monitor = new Monitor();
          monitor.name = "Checkout API";
          return monitor;
        })(),
      });

      expect(render(fenceTitled(basic, "Title template"), map)).toBe(
        fenceTitled(basic, "Title as created"),
      );
    });

    it("the loop over an Alertmanager notification", () => {
      const advanced: string = sectionOf("## Advanced usage");
      const map: JSONObject = storageMap(MonitorType.IncomingRequest, {
        requestBody: JSON.parse(fenceTitled(advanced, "Request body")),
      });

      // A line break after the description's last line shows nothing.
      expect(
        render(fenceTitled(advanced, "Description template"), map).trimEnd(),
      ).toBe(fenceTitled(advanced, "Description as created"));
    });

    it("the paths table: each example reads its value", () => {
      const api: JSONObject = storageMap(MonitorType.API, API_CHECK);
      const server: JSONObject = storageMap(MonitorType.Server, SERVER_CHECK);
      const examples: Array<string> = tableRows(
        sectionOf("### Paths into objects and lists"),
      ).map((cells: Array<string>): string => {
        return cells[2]!.replace(/`/g, "");
      });

      expect(examples).toEqual([
        "{{responseBody.error.message}}",
        "{{diskMetrics[0].usagePercent}}",
        "{{processes[last].name}}",
        "{{responseBody}}",
      ]);

      expect(render(examples[0]!, api)).toBe("Upstream timed out");
      expect(render(examples[1]!, server)).toBe("91");
      expect(render(examples[2]!, server)).toBe("nginx");
      expect(JSON.parse(render(examples[3]!, api))).toEqual({
        error: { id: "E42", message: "Upstream timed out", details: {} },
      });
      // `{{list.0}}` reads the same item as `{{list[0]}}`.
      expect(render("{{diskMetrics.0.usagePercent}}", server)).toBe("91");
    });

    it("a hyphen in a field name reads, and a negative index reads nothing", () => {
      const api: JSONObject = storageMap(MonitorType.API, API_CHECK);
      const server: JSONObject = storageMap(MonitorType.Server, SERVER_CHECK);

      expect(english).toContain(
        "A field name can hold a hyphen, as in `{{responseHeaders.content-type}}`. A negative index, such as `[-1]`, reads nothing: use `[last]`.",
      );
      expect(render("{{responseHeaders.content-type}}", api)).toBe(
        "application/json",
      );
      expect(render("{{processes[-1].name}}", server)).toBe(
        "{{processes[-1].name}}",
      );
    });

    it("a placeholder that leads nowhere, or names a value the check did not report, stays as written; an empty value is replaced by nothing", () => {
      const api: JSONObject = storageMap(MonitorType.API, API_CHECK);
      const ping: JSONObject = storageMap(MonitorType.Ping, {
        ...PROBE,
        isOnline: true,
        responseTimeInMs: 12,
        isTimeout: false,
      });
      const email: JSONObject = storageMap(MonitorType.IncomingEmail, {
        emailSubject: "",
      });

      expect(render("{{responseBody.error.code}}", api)).toBe(
        "{{responseBody.error.code}}",
      );
      expect(render("Failed: {{failureCause}}", ping)).toBe(
        "Failed: {{failureCause}}",
      );
      expect(render("[{{emailSubject}}]", email)).toBe("[]");

      const missing: string = sectionOf("### When a value is missing");

      expect(missing).toContain("`{{responseBody.error.id}}` appears as it is");
      expect(missing).toContain(
        "So does a variable this check did not report, such as `failureCause` on a check that did not fail.",
      );
      expect(missing).toContain(
        "A value the check reported as empty text is replaced by nothing.",
      );
    });

    it("every example under Examples renders with no placeholder left", () => {
      const examples: string = sectionOf("## Examples");
      const synthetic: JSONObject = storageMap(MonitorType.SyntheticMonitor, {
        ...PROBE,
        failureCause: "1 of 2 runs failed",
        syntheticMonitorResponse: [
          {
            executionTimeInMS: 2400,
            result: "ok",
            scriptError: "Timeout 30000ms exceeded",
            logMessages: ["Opened the login page"],
            screenshots: { failure: "iVBORw0KGgo=" },
            browserType: "Chromium",
            screenSizeType: "Desktop",
          },
        ],
      });
      const maps: Record<string, JSONObject> = {
        "### A slow API": MonitorTemplateUtil.buildTemplateStorageMap({
          monitorType: MonitorType.API,
          dataToProcess: API_CHECK as unknown as DataToProcess,
          monitor: (() => {
            const monitor: Monitor = new Monitor();
            monitor.name = "Checkout API";
            return monitor;
          })(),
        }),
        "### A certificate about to expire": storageMap(
          MonitorType.SSLCertificate,
          TYPE_TABLES.find((table: { heading: string }) => {
            return table.heading === "### SSL Certificate Monitors";
          })!.check,
        ),
        "### A server that is running out of room": storageMap(
          MonitorType.Server,
          SERVER_CHECK,
        ),
        "### A ping, IP or port check that failed":
          MonitorTemplateUtil.buildTemplateStorageMap({
            monitorType: MonitorType.Port,
            dataToProcess: {
              ...PROBE,
              isOnline: false,
              responseTimeInMs: 5000,
              failureCause: "Connection timed out",
              isTimeout: true,
            } as unknown as DataToProcess,
            monitor: (() => {
              const monitor: Monitor = new Monitor();
              monitor.name = "Payments database port";
              return monitor;
            })(),
          }),
        "### Every run of a synthetic monitor": synthetic,
        "### A custom code check": storageMap(
          MonitorType.CustomJavaScriptCode,
          {
            ...PROBE,
            failureCause: "",
            customCodeMonitorResponse: {
              executionTimeInMS: 120,
              result: "degraded",
              scriptError: "",
              logMessages: ["first", "last"],
            },
          },
        ),
        "### A network device": storageMap(
          MonitorType.NetworkDevice,
          SNMP_CHECK,
        ),
        "### Alertmanager or Grafana alerts": storageMap(
          MonitorType.IncomingRequest,
          {
            requestBody: {
              status: "firing",
              receiver: "payments",
              alerts: [
                {
                  status: "firing",
                  labels: { alertname: "HighLatency" },
                  annotations: { summary: "p95 above 2 s" },
                  generatorURL: "https://grafana.example.com/alerting/1",
                },
              ],
            },
          },
        ),
      };
      const headings: Array<string> = scanMarkdown(examples)
        .headings.filter((heading: DocsHeading): boolean => {
          return heading.level === 3;
        })
        .map((heading: DocsHeading): string => {
          return `### ${heading.text}`;
        });

      expect(headings).toEqual(Object.keys(maps));

      for (const heading of headings) {
        for (const fence of scanMarkdown(sectionOf(heading)).fences) {
          const rendered: string = render(fence.code, maps[heading]!);

          expect({
            heading,
            fence: fence.info,
            left: rendered.match(PLACEHOLDER)?.[0],
          }).toEqual({
            heading,
            fence: fence.info,
            left: undefined,
          });
        }
      }
    });

    it("the screenshot examples put the run's screenshot in an image", () => {
      const screenshot: string = sectionOf("#### Showing a screenshot");
      const map: JSONObject = storageMap(MonitorType.SyntheticMonitor, {
        ...PROBE,
        failureCause: "1 of 1 runs failed",
        syntheticMonitorResponse: [
          {
            executionTimeInMS: 30000,
            result: undefined,
            scriptError: "Timeout 30000ms exceeded",
            logMessages: [],
            screenshots: { "login-page": "iVBORw0KGgo=", failure: "/9j/4AAQ" },
            browserType: "Chromium",
            screenSizeType: "Desktop",
          },
        ],
      });

      expect(
        render(fenceTitled(screenshot, "Description template", 0), map),
      ).toBe(
        "Timeout 30000ms exceeded\n\n![Login page](data:image/png;base64,iVBORw0KGgo=)",
      );
      expect(
        render(fenceTitled(screenshot, "Description template", 1), map),
      ).toContain("![Chromium Desktop](data:image/png;base64,/9j/4AAQ)");
    });
  });

  describe("how a template is filled", () => {
    it("a value in a description is placed as text, while a title keeps it as sent", () => {
      const map: JSONObject = storageMap(MonitorType.IncomingRequest, {
        requestBody: { note: "<!channel> look" },
      });
      const description: string =
        MonitorTemplateUtil.processMarkdownTemplateString({
          value: "{{requestBody.note}}",
          storageMap: map,
        });

      expect(description).not.toContain("<!channel>");
      expect(FeedMarkdown.withoutInvisibleBreaks(description)).toContain(
        "channel",
      );
      expect(render("{{requestBody.note}}", map)).toBe("<!channel> look");
      expect(
        sectionOf("### Values in descriptions and remediation notes"),
      ).toContain(
        "a Slack mention such as `<!channel>` in it shows as text instead of acting",
      );
    });

    it("an Incoming Email value in a title is cut to one line of 150 characters", () => {
      const map: JSONObject = storageMap(MonitorType.IncomingEmail, {
        emailSubject: `${"a".repeat(200)}\nsecond line`,
      });
      const title: JSONObject = MonitorTemplateUtil.buildTitleStorageMap({
        monitorType: MonitorType.IncomingEmail,
        storageMap: map,
      });

      expect(MaxEmailValueLengthInTitle).toBe(150);
      expect((title["emailSubject"] as string).length).toBe(150);
      expect(title["emailSubject"]).not.toContain("\n");
      expect(sectionOf("### Incoming Email Monitors")).toContain(
        "In a title, each of these is cut to one line of at most 150 characters.",
      );
    });

    it("a grouped monitor's labels are variables, under their attribute names, and in seriesLabels", () => {
      const map: JSONObject = storageMap(
        MonitorType.Kubernetes,
        { metricViewConfig: { queryConfigs: [], formulaConfigs: [] } },
        { "host.name": "prod-db-01", "resource.k8s.pod.name": "checkout-7d9f" },
      );

      expect(render("{{host.name}} / {{resource.k8s.pod.name}}", map)).toBe(
        "prod-db-01 / checkout-7d9f",
      );
      expect(map["seriesLabels"]).toEqual({
        "host.name": "prod-db-01",
        "resource.k8s.pod.name": "checkout-7d9f",
      });

      const grouped: string = sectionOf("### Values from a grouped monitor");

      expect(grouped).toContain(
        "Grouping by `host.name` gives `{{host.name}}`, and grouping by `resource.k8s.pod.name` gives `{{resource.k8s.pod.name}}`. `{{seriesLabels}}` holds all of them, as an object.",
      );
    });

    it("a grouped monitor's title gets the series' name when the template does not say it", () => {
      const labels: JSONObject = { "k8s.pod.name": "checkout-7d9f-2xk" };

      expect(
        SeriesContextEnricher.enrichTitle({
          title: "Pod CPU high",
          seriesLabels: labels,
        }),
      ).toContain("checkout-7d9f-2xk");
      expect(
        SeriesContextEnricher.enrichTitle({
          title: "Pod checkout-7d9f-2xk CPU high",
          seriesLabels: labels,
        }),
      ).toBe("Pod checkout-7d9f-2xk CPU high");
      expect(english).toContain(
        "and adds the series' name to the title when your template does not already say it.",
      );
    });

    it("a loop gives its items' fields, @index and this, nests, and writes nothing for what is not a list", () => {
      const map: JSONObject = storageMap(MonitorType.IncomingRequest, {
        requestBody: {
          receiver: "payments",
          tags: ["a", "b"],
          groups: [{ name: "g1", members: [{ id: "m1" }, { id: "m2" }] }],
          notAList: { x: 1 },
          empty: [],
        },
      });

      expect(
        render("{{#each requestBody.tags}}[{{@index}}:{{this}}]{{/each}}", map),
      ).toBe("[0:a][1:b]");
      expect(
        render(
          "{{#each requestBody.groups}}{{name}}:{{#each members}}{{id}},{{/each}}{{/each}}",
          map,
        ),
      ).toBe("g1:m1,m2,");
      // A name the item does not have comes from the template's variables.
      expect(
        render(
          "{{#each requestBody.groups}}{{requestBody.receiver}}{{/each}}",
          map,
        ),
      ).toBe("payments");
      expect(render("a{{#each requestBody.notAList}}x{{/each}}b", map)).toBe(
        "ab",
      );
      expect(render("a{{#each requestBody.empty}}x{{/each}}b", map)).toBe("ab");

      const loop: string = sectionOf("### Looping over a list");

      for (const rule of [
        "`{{@index}}` is the item's position, counting from 0.",
        "`{{this}}` is the item itself, for a list of plain values such as strings.",
        "A loop over a path that is not a list, or over an empty list, writes nothing.",
        "Loops nest: a `{{#each}}` inside another one reads the inner list of each outer item.",
        "A name the item does not have is looked up in the enclosing item, then in the variables of the whole template.",
      ]) {
        expect(loop).toContain(rule);
      }
    });

    it("there is no {{#if}}, and a Database Health metric cannot be picked out of metrics", () => {
      const database: (typeof TYPE_TABLES)[number] = TYPE_TABLES.find(
        (table: { heading: string }) => {
          return table.heading === "### Database Health Monitors";
        },
      )!;
      const map: JSONObject = storageMap(MonitorType.Database, database.check);

      expect(
        render(
          "{{metrics.oneuptime.monitor.database.connections.used.percent}}",
          map,
        ),
      ).toBe("{{metrics.oneuptime.monitor.database.connections.used.percent}}");
      expect(JSON.parse(render("{{metrics}}", map))).toEqual({
        "oneuptime.monitor.database.connections.used.percent": 12,
      });
      expect(render("{{#if isOnline}}up{{/if}}", map)).toBe(
        "{{#if isOnline}}up{{/if}}",
      );
      expect(english).not.toContain("{{#if");
      expect(sectionOf("### Database Health Monitors")).toContain(
        "so a template cannot pick one value out of `metrics`. Place `{{metrics}}` whole, as JSON, or use `{{collectionIssueSummary}}`.",
      );
    });

    it("a named OID is a variable of its own, and a ping-only device fills in isOnline alone", () => {
      const walked: JSONObject = storageMap(
        MonitorType.NetworkDevice,
        SNMP_CHECK,
      );
      const pingOnly: JSONObject = storageMap(MonitorType.NetworkDevice, {
        ...PROBE,
        isOnline: true,
      });

      expect(render("{{sysUpTime}}", walked)).toBe("4242");
      expect(render("{{isOnline}}", pingOnly)).toBe("true");
      expect(render("{{sysName}} {{responseTimeInMs}}", pingOnly)).toBe(
        "{{sysName}} {{responseTimeInMs}}",
      );
    });

    it("an Incoming Request grouping key is named after the path's last segment", () => {
      for (const [groupByJSONPath, variable] of [
        ["requestBody.alerts[*].labels.alertname", "alertname"],
        ["requestBody.alerts[*].fingerprint", "fingerprint"],
      ] as Array<[string, string]>) {
        const items: Array<IncomingRequestGroupingItem> =
          IncomingRequestIncidentGrouping.extractItems({
            requestBody: {
              alerts: [
                {
                  status: "firing",
                  fingerprint: "f1",
                  labels: { alertname: "HighLatency" },
                },
              ],
            },
            grouping: { groupByJSONPath } as never,
          });

        expect(items.length).toBe(1);
        expect(Object.keys(items[0]!.labels)).toEqual([variable]);
        expect(english).toContain(
          `grouping by \`${groupByJSONPath}\` gives \`{{${variable}}}\``,
        );
      }
    });
  });

  describe("the variable tables", () => {
    it("the Monitor table lists what the monitor gives a template where incidents are created", () => {
      const monitor: Monitor = new Monitor();
      monitor.name = "Checkout API";
      monitor.id = ObjectID.generate();
      monitor.monitorType = MonitorType.Website;

      const map: JSONObject = MonitorTemplateUtil.buildTemplateStorageMap({
        monitorType: MonitorType.Website,
        dataToProcess: API_CHECK as unknown as DataToProcess,
        monitor,
      });

      expect(documentedVariables("### Monitor")).toEqual([
        "monitorName",
        "monitorId",
        "monitorType",
      ]);
      expect(render("{{monitorName}}|{{monitorType}}", map)).toBe(
        "Checkout API|Website",
      );
      expect(render("{{monitorId}}", map)).toBe(monitor.id.toString());

      /*
       * The monitor the criteria are evaluated with is read with its name,
       * ID and type only, so a description or slug variable would be left
       * as written: the page lists neither.
       */
      const resource: string = source(
        "packages/Common/Server/Utils/Monitor/MonitorResource.ts",
      );
      const load: string = resource.slice(
        resource.indexOf(
          "const monitor: Monitor | null = await MonitorService.findOneById({",
        ),
        resource.indexOf(
          "props: {",
          resource.indexOf("currentMonitorStatusId"),
        ),
      );

      expect(load).toContain("monitorType: true,");
      expect(load).toContain("name: true,");
      expect(load).not.toContain("description: true");
      expect(load).not.toContain("slug: true");
    });

    it("the affected resource variables are defined for every monitor, empty when it is not grouped", () => {
      expect(documentedVariables("### Affected resource")).toEqual(
        ALWAYS_DEFINED,
      );

      const ungrouped: JSONObject = storageMap(MonitorType.Logs, {});

      for (const variable of ALWAYS_DEFINED) {
        expect(ungrouped[variable]).toBe("");
      }

      const grouped: JSONObject = storageMap(
        MonitorType.Kubernetes,
        { metricViewConfig: { queryConfigs: [], formulaConfigs: [] } },
        { "resource.k8s.pod.name": "checkout-7d9f-2xk" },
      );

      expect(grouped["seriesResourceSummary"]).toContain("checkout-7d9f-2xk");
    });

    it.each(TYPE_TABLES)(
      "$heading lists exactly the variables a check puts in the template",
      (table: (typeof TYPE_TABLES)[number]) => {
        const documented: Array<string> = documentedVariables(table.heading);

        for (const monitorType of table.monitorTypes) {
          const own: Array<string> = ownVariables(
            monitorType,
            table.check,
          ).filter((key: string): boolean => {
            // A named OID becomes a variable of its own: the {{OID_NAME}} row.
            return key !== "sysUpTime";
          });

          expect({ monitorType, variables: [...documented].sort() }).toEqual({
            monitorType,
            variables: [...own, ...(table.alsoDocumented || [])].sort(),
          });
        }
      },
    );

    it.each(TYPE_TABLES)(
      "$heading offers in the editor only variables its table lists",
      (table: (typeof TYPE_TABLES)[number]) => {
        const documented: Array<string> = documentedVariables(table.heading);

        for (const monitorType of table.monitorTypes) {
          const group: TemplateVariableGroup | undefined =
            TemplateVariablesCatalog.getVariables({ monitorType })[2];
          const offered: Array<string> = (group?.variables || []).map(
            (variable: TemplateVariable): string => {
              return variable.key.split(".")[0] as string;
            },
          );

          for (const key of offered) {
            expect({
              monitorType,
              key,
              documented: documented.includes(key),
            }).toEqual({
              monitorType,
              key,
              documented: true,
            });
          }
        }
      },
    );

    it("the metric and infrastructure monitors are exactly the types with metricName", () => {
      const section: string = sectionOf(
        "### Metric and Infrastructure Monitors",
      );
      const withMetricName: Array<string> = Object.values(MonitorType).filter(
        (monitorType: MonitorType): boolean => {
          return (
            "metricName" in
            storageMap(monitorType, {
              metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
            })
          );
        },
      );

      expect(withMetricName).toEqual([
        "Kubernetes",
        "Docker",
        "Host",
        "Podman",
        "Docker Swarm",
        "Proxmox",
        "VMware",
        "Ceph",
        "Storage Array",
        "Metrics",
      ]);
      expect(section).toContain(
        "Metrics, Kubernetes, Docker, Host, Podman, Docker Swarm, Proxmox, VMware, Ceph and Storage Array monitors have one variable of their own:",
      );
      expect(
        documentedVariables("### Metric and Infrastructure Monitors"),
      ).toEqual(["metricName"]);

      const map: JSONObject = storageMap(MonitorType.Docker, {
        metricViewConfig: {
          queryConfigs: [
            {
              metricQueryData: {
                filterData: { metricName: "container.cpu.time" },
              },
            },
          ],
          formulaConfigs: [],
        },
      });

      expect(render("{{metricName}}", map)).toBe("container.cpu.time");
    });

    it("an IoT Device monitor has no metricName, and its templates give each incident {{device.id}}", () => {
      const map: JSONObject = storageMap(
        MonitorType.IoTDevice,
        { metricViewConfig: { queryConfigs: [], formulaConfigs: [] } },
        { "device.id": "sensor-001" },
      );

      expect("metricName" in map).toBe(false);
      expect(render("{{device.id}}", map)).toBe("sensor-001");

      for (const template of getAllIoTAlertTemplates()) {
        const step: MonitorStep = template.getMonitorStep({
          fleetIdentifier: "fleet",
          onlineMonitorStatusId: ObjectID.generate(),
          offlineMonitorStatusId: ObjectID.generate(),
          defaultIncidentSeverityId: ObjectID.generate(),
          defaultAlertSeverityId: ObjectID.generate(),
          monitorName: "Docs",
        });

        expect(
          step.data!.iotMonitor!.metricViewConfig.queryConfigs[0]!
            .metricQueryData.groupByAttributeKeys,
        ).toEqual(["device.id"]);
      }

      expect(sectionOf("### Metric and Infrastructure Monitors")).toContain(
        "An IoT Device monitor has no `metricName`, but a grouped one, as its templates are, has `{{device.id}}`.",
      );
    });

    it("the other monitor types have no variables of their own", () => {
      const others: Array<MonitorType> = [
        MonitorType.Logs,
        MonitorType.Traces,
        MonitorType.Exceptions,
        MonitorType.SecurityEvents,
        MonitorType.Llm,
        MonitorType.SQLQuery,
      ];

      for (const monitorType of others) {
        expect({ monitorType, own: ownVariables(monitorType, {}) }).toEqual({
          monitorType,
          own: [],
        });
      }

      expect(sectionOf("### Other Monitor Types")).toContain(
        "Logs, Traces, Exceptions, Security Events, AI / LLM and SQL Query monitors have no variables of their own.",
      );
    });
  });

  describe("where a template is written, as the criteria form draws it", () => {
    const dashboard: string = "packages/App/FeatureSet/Dashboard/src";

    it("the monitor's Criteria page, and its edit and save buttons", () => {
      expect(source(`${dashboard}/Pages/Monitor/View/SideMenu.tsx`)).toContain(
        'title: "Criteria",',
      );
      expect(source(`${dashboard}/Pages/Monitor/View/Criteria.tsx`)).toContain(
        'editButtonText="Edit Monitoring Criteria"',
      );
      expect(
        source("packages/Common/UI/Components/ModelDetail/CardModelDetail.tsx"),
      ).toContain("submitButtonText={`Save Changes`}");

      const steps: string = sectionOf("## Where you write a template");

      expect(steps).toContain(
        "Go to **Monitors**, open the monitor, and click **Criteria** in its side menu. Click **Edit Monitoring Criteria**.",
      );
      expect(steps).toContain("Click **Save Changes**.");
    });

    it("the Actions toggles that open the incident and the alert", () => {
      const instance: string = source(
        `${dashboard}/Components/Form/Monitor/MonitorCriteriaInstance.tsx`,
      );

      for (const label of [
        'title="Actions"',
        'title="When filters match, declare an incident."',
        'title="When filters match, create an alert."',
      ]) {
        expect(instance).toContain(label);
      }

      expect(sectionOf("## Where you write a template")).toContain(
        "under **Actions**, turn on **When filters match, declare an incident.** or **When filters match, create an alert.**",
      );
    });

    it("the title, description and remediation notes fields, and the variables dialog", () => {
      const incident: string = source(
        `${dashboard}/Components/Form/Monitor/MonitorCriteriaIncidentForm.tsx`,
      );
      const alert: string = source(
        `${dashboard}/Components/Form/Monitor/MonitorCriteriaAlertForm.tsx`,
      );

      expect(incident).toContain('title="Incident Title"');
      expect(incident).toContain('placeholder="e.g., {{monitorName}} is down"');
      expect(incident).toContain('"Learn about dynamic templates"');
      expect(incident).toContain('title="Description"');
      expect(incident).toContain('title="Incident Description"');
      expect(incident).toContain('title="Remediation Notes"');
      expect(incident).toContain("title={MORE_FIELDS_SECTION_TITLE}");
      expect(alert).toContain('title="Alert Title"');
      expect(alert).toContain('title="Alert Description"');
      expect(
        source(
          "packages/Common/UI/Components/MonitorTemplateVariables/TemplateVariablesModal.tsx",
        ),
      ).toContain('title="Dynamic Template Variables"');
      expect(
        source(
          "packages/Common/UI/Components/FoldedSection/FoldedSectionTitles.ts",
        ),
      ).toContain('"More fields"');

      const steps: string = sectionOf("## Where you write a template");

      for (const phrase of [
        "Type the title in **Incident Title** or **Alert Title**, for example `{{monitorName}} is down`.",
        "**Learn about dynamic templates**, next to it, opens **Dynamic Template Variables**",
        "Open **Description** for **Incident Description** or **Alert Description**, and **More fields** for **Remediation Notes**.",
        "**Template variables** lists them under the editor, **Insert variable** in its toolbar opens the same list, and typing `{{` opens it at the cursor.",
      ]) {
        expect(steps).toContain(phrase);
      }
    });
  });
});
