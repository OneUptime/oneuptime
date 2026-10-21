import { describe, expect, test } from "@jest/globals";
import UptimeKumaAdapter, {
  getJsonDepth,
  MAX_JSON_DEPTH,
  MAX_METRICS_LINES,
  parseUntrustedJson,
  readMetricLabels,
} from "../../../../Server/Utils/ToolImport/Adapters/UptimeKuma/UptimeKumaAdapter";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import BadDataException from "../../../../Types/Exception/BadDataException";
import DnsRecordType from "../../../../Types/Monitor/DnsMonitor/DnsRecordType";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import {
  TOOL_IMPORT_MAX_RECORDS_PER_KIND,
  TOOL_IMPORT_MAX_UPLOAD_BYTES,
} from "../../../../Types/ToolImport/ToolImportLimits";
import {
  makeToolImportNote,
  ToolImportNoteCode,
} from "../../../../Types/ToolImport/ToolImportNote";
import ToolImportResourceKind from "../../../../Types/ToolImport/ToolImportResourceKind";
import {
  ImportedMonitor,
  ToolImportSnapshot,
} from "../../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../../Types/ToolImport/ToolImportSource";
import {
  KUMA_IDS,
  KUMA_METRICS_1,
  KUMA_METRICS_2,
  KUMA_SECRETS,
  kumaBackup,
  kumaBackupText,
} from "./UptimeKumaFixtures";

/*
 * The Uptime Kuma adapter reads a file the person uploads - Uptime Kuma's
 * JSON backup or its metrics page - as untrusted text. These hold what
 * each monitor type becomes, that no secret in the backup comes out, and
 * that a file that is too big, too deep, malformed, not Uptime Kuma's, or
 * shaped to reach an object's prototype is refused or read harmlessly.
 */

const NOW: Date = new Date("2026-10-08T12:00:00Z");

function readFile(
  content: string,
  fileName: string = "backup.json",
): ToolImportSnapshot {
  return new UptimeKumaAdapter().readFile({
    content: content,
    fileName: fileName,
    now: NOW,
  });
}

function refusal(content: string): string {
  try {
    readFile(content);
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("The file was read, not refused.");
}

function monitorOf(snapshot: ToolImportSnapshot, id: string): ImportedMonitor {
  const found: ImportedMonitor | undefined = (snapshot.monitors || []).find(
    (monitor: ImportedMonitor): boolean => {
      return monitor.sourceId === id;
    },
  );

  if (!found) {
    throw new Error(`No monitor ${id}`);
  }

  return found;
}

const id: (name: string) => string = (name: string): string => {
  return String(KUMA_IDS[name]);
};

describe("UptimeKumaAdapter: a backup", () => {
  test("every monitor once, in the backup's order, then the certificate monitors; groups and records that are not monitors left out", () => {
    const snapshot: ToolImportSnapshot = readFile(kumaBackupText());

    expect(snapshot.source).toBe(ToolImportSource.UptimeKuma);
    expect(snapshot.readAt).toBe(NOW.toISOString());
    // The file's name stands for the account.
    expect(snapshot.accountName).toBe("backup.json");
    expect(
      (snapshot.monitors || []).map((monitor: ImportedMonitor) => {
        return monitor.sourceId;
      }),
    ).toEqual([
      id("home"),
      id("orders"),
      id("checkout"),
      id("errorFree"),
      id("health"),
      id("database"),
      id("gateway"),
      id("mail"),
      id("backup"),
      id("support"),
      id("container"),
      id("inverted"),
      id("paused"),
      id("admin"),
      `${id("home")}:certificate`,
    ]);
    expect(snapshot.notes).toEqual([]);
  });

  test("an HTTP monitor keeps its codes, its description and that it does not follow redirects; a faster pace is said", () => {
    expect(monitorOf(readFile(kumaBackupText()), id("home"))).toEqual({
      sourceId: id("home"),
      name: "Home page",
      description: "The front page",
      sourceType: "http",
      monitorType: MonitorType.Website,
      destination: "https://example.com",
      httpMethod: HTTPMethod.GET,
      followRedirects: false,
      timeoutSeconds: 48,
      intervalSeconds: 30,
      acceptedStatusCodes: [
        { from: 200, to: 299 },
        { from: 301, to: 301 },
      ],
      isPaused: false,
      notes: [
        makeToolImportNote(ToolImportNoteCode.MonitorIntervalChanged, {
          every: 30,
          oneUptimeEvery: 60,
        }),
      ],
    });
  });

  test("a monitor that warns before its certificate expires gets an SSL certificate monitor", () => {
    expect(
      monitorOf(readFile(kumaBackupText()), `${id("home")}:certificate`),
    ).toMatchObject({
      name: "Home page certificate",
      monitorType: MonitorType.SSLCertificate,
      destination: "https://example.com",
      intervalSeconds: 3600,
    });
  });

  test("a POST with headers is an API monitor, its secret header left out and its long wait said", () => {
    const orders: ImportedMonitor = monitorOf(
      readFile(kumaBackupText()),
      id("orders"),
    );

    expect(orders).toMatchObject({
      monitorType: MonitorType.API,
      httpMethod: HTTPMethod.POST,
      requestHeaders: { "X-Team": "shop" },
      requestBody: '{"ping":true}',
    });
    expect(orders.notes).toEqual([
      makeToolImportNote(ToolImportNoteCode.MonitorHeaderLeftOut, {
        header: "Authorization",
      }),
      makeToolImportNote(ToolImportNoteCode.MonitorTimeoutShortened, {
        timeout: 90,
      }),
    ]);
  });

  test("keyword monitors look for the word, or for it missing; a JSON query is an API monitor without its query", () => {
    const snapshot: ToolImportSnapshot = readFile(kumaBackupText());

    expect(monitorOf(snapshot, id("checkout")).keyword).toEqual({
      value: "Pay now",
      isPresent: true,
      isCaseSensitive: true,
    });
    expect(monitorOf(snapshot, id("errorFree")).keyword).toEqual({
      value: "Exception",
      isPresent: false,
      isCaseSensitive: true,
    });
    expect(monitorOf(snapshot, id("health"))).toMatchObject({
      sourceType: "json-query",
      monitorType: MonitorType.API,
      notes: [makeToolImportNote(ToolImportNoteCode.MonitorAssertionsLeftOut)],
    });
  });

  test("port, ping and DNS monitors keep their host, port, record type and server", () => {
    const snapshot: ToolImportSnapshot = readFile(kumaBackupText());

    expect(monitorOf(snapshot, id("database"))).toEqual({
      sourceId: id("database"),
      name: "Database",
      sourceType: "port",
      monitorType: MonitorType.Port,
      destination: "db.example.com",
      port: 5432,
      timeoutSeconds: 10,
      intervalSeconds: 300,
      isPaused: false,
      notes: [],
    });
    expect(monitorOf(snapshot, id("gateway"))).toMatchObject({
      monitorType: MonitorType.Ping,
      destination: "10.0.0.1",
      intervalSeconds: 60,
    });
    expect(monitorOf(snapshot, id("mail"))).toMatchObject({
      monitorType: MonitorType.DNS,
      destination: "example.com",
      dnsRecordType: DnsRecordType.MX,
      dnsServer: "1.1.1.1",
    });
  });

  test("a push monitor waits its interval and every retry, and gets a new address; a manual monitor stays manual", () => {
    const snapshot: ToolImportSnapshot = readFile(kumaBackupText());

    expect(monitorOf(snapshot, id("backup"))).toMatchObject({
      monitorType: MonitorType.IncomingRequest,
      // A day, then two retries ten minutes apart.
      heartbeatTimeoutSeconds: 86400 + 2 * 600,
      notes: [
        makeToolImportNote(ToolImportNoteCode.MonitorNewHeartbeatAddress),
      ],
    });
    expect(monitorOf(snapshot, id("support"))).toMatchObject({
      monitorType: MonitorType.Manual,
      notes: [],
    });
  });

  test("Docker and upside down monitors are named as left out; a paused one comes over paused", () => {
    const snapshot: ToolImportSnapshot = readFile(kumaBackupText());

    expect(monitorOf(snapshot, id("container"))).toMatchObject({
      sourceType: "Docker",
      monitorType: null,
    });
    expect(monitorOf(snapshot, id("inverted"))).toMatchObject({
      monitorType: null,
      destination: "https://old.example.com",
      skipReason: makeToolImportNote(ToolImportNoteCode.MonitorUpsideDown),
    });
    expect(monitorOf(snapshot, id("paused"))).toMatchObject({
      isPaused: true,
      notes: [makeToolImportNote(ToolImportNoteCode.MonitorPaused)],
    });
  });

  test("no password, token or push key in the backup comes out; a sign-in is said", () => {
    const snapshot: ToolImportSnapshot = readFile(kumaBackupText());
    const everything: string = JSON.stringify(snapshot);

    for (const secret of KUMA_SECRETS) {
      expect(everything).not.toContain(secret);
    }

    expect(monitorOf(snapshot, id("admin")).notes).toEqual([
      makeToolImportNote(ToolImportNoteCode.MonitorSignInLeftOut),
    ]);
  });

  test("a file saved with a byte order mark reads the same", () => {
    const plain: ToolImportSnapshot = readFile(kumaBackupText());
    const marked: ToolImportSnapshot = readFile(
      `${String.fromCharCode(0xfeff)}${kumaBackupText()}`,
    );

    expect(marked.monitors).toEqual(plain.monitors);
  });

  test("a backup with more monitors than one read collects stops at the limit, and says so", () => {
    const many: Array<Record<string, unknown>> = Array.from(
      { length: TOOL_IMPORT_MAX_RECORDS_PER_KIND + 5 },
      (_value: unknown, index: number) => {
        return {
          id: index + 1,
          name: `Site ${index + 1}`,
          type: "ping",
          hostname: `10.0.${Math.floor(index / 250)}.${index % 250}`,
          interval: 60,
          active: true,
        };
      },
    );

    const snapshot: ToolImportSnapshot = readFile(
      JSON.stringify(kumaBackup(many)),
    );

    expect(snapshot.monitors).toHaveLength(TOOL_IMPORT_MAX_RECORDS_PER_KIND);
    expect(snapshot.notes).toEqual([
      makeToolImportNote(ToolImportNoteCode.ReadLimitReached, {
        kind: ToolImportResourceKind.Monitor,
        limit: TOOL_IMPORT_MAX_RECORDS_PER_KIND,
      }),
    ]);
  });
});

describe("UptimeKumaAdapter: a file it must not trust", () => {
  test("a file larger than an import reads is refused before it is read", () => {
    const padding: string = " ".repeat(TOOL_IMPORT_MAX_UPLOAD_BYTES);

    expect(refusal(`${kumaBackupText()}${padding}`)).toBe(
      "This file is larger than 10 MB, which is more than an import reads.",
    );
  });

  test("the size is counted in bytes, not characters", () => {
    // Three bytes each in UTF-8: just over the limit in bytes, a third of it in characters.
    const wide: string = "€".repeat(
      Math.ceil(TOOL_IMPORT_MAX_UPLOAD_BYTES / 3) + 1,
    );

    expect(refusal(`{"monitorList":[],"pad":"${wide}"}`)).toBe(
      "This file is larger than 10 MB, which is more than an import reads.",
    );
  });

  test("JSON that is not valid is refused with a plain message", () => {
    expect(refusal('{"monitorList": [ {"id": 1, ')).toBe(
      "This file is not an Uptime Kuma backup: it is not valid JSON.",
    );
  });

  test("JSON nested deeper than a backup ever is, is refused before it is parsed", () => {
    const deep: string = `{"monitorList":${"[".repeat(MAX_JSON_DEPTH + 1)}${"]".repeat(MAX_JSON_DEPTH + 1)}}`;

    expect(refusal(deep)).toBe(
      "This file is not an Uptime Kuma backup: it is nested deeper than a backup is.",
    );
    // A million brackets cost one pass, not a stack.
    expect(refusal(`{"a":${"[".repeat(1_000_000)}`)).toBe(
      "This file is not an Uptime Kuma backup: it is nested deeper than a backup is.",
    );
  });

  test("brackets inside strings do not count as nesting", () => {
    expect(getJsonDepth('{"a":"[[[[[[{{{{\\"]]]"}')).toBe(1);
    expect(getJsonDepth('[{"a":[1,2]}]')).toBe(3);
    expect(getJsonDepth("")).toBe(0);
  });

  test("a JSON file that is not a backup is refused", () => {
    expect(refusal('{"version":"1.23.0","notificationList":[]}')).toBe(
      "This file is not an Uptime Kuma backup: it has no list of monitors.",
    );
    expect(refusal('{"monitorList":{"0":{"id":1}}}')).toBe(
      "This file is not an Uptime Kuma backup: it has no list of monitors.",
    );
  });

  test("a file that is neither a backup nor a metrics page is refused", () => {
    for (const content of [
      "id,name,url\n1,Home,https://example.com",
      '[{"id":1,"type":"http"}]',
      "<html><body>Uptime Kuma</body></html>",
      "monitor_status 1",
    ]) {
      expect(refusal(content)).toBe(
        "This is not an Uptime Kuma backup or metrics file. Upload the JSON file Settings > Backup > Export gives, or the page /metrics shows.",
      );
    }
  });

  test("a backup with no monitors, or only groups, is refused", () => {
    expect(refusal(JSON.stringify(kumaBackup([])))).toBe(
      "This Uptime Kuma file has no monitors in it.",
    );
    expect(
      refusal(
        JSON.stringify(
          kumaBackup([{ id: 1, name: "Production", type: "group" }]),
        ),
      ),
    ).toBe("This Uptime Kuma file has no monitors in it.");
  });

  test("keys that name an object's machinery are dropped, and nothing reaches a prototype", () => {
    const hostile: string = `{
      "__proto__": { "polluted": "top" },
      "constructor": { "prototype": { "polluted": "constructor" } },
      "monitorList": [
        {
          "id": 1,
          "name": "Home page",
          "type": "http",
          "url": "https://example.com",
          "__proto__": { "polluted": "monitor", "type": "docker" },
          "headers": "{\\"__proto__\\": {\\"polluted\\": \\"header\\"}, \\"X-Team\\": \\"shop\\"}"
        }
      ]
    }`;

    const snapshot: ToolImportSnapshot = readFile(hostile);

    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
    expect(monitorOf(snapshot, "1")).toMatchObject({
      sourceType: "http",
      monitorType: MonitorType.API,
      requestHeaders: { "X-Team": "shop" },
    });
    expect(Object.keys(monitorOf(snapshot, "1").requestHeaders || {})).toEqual([
      "X-Team",
    ]);

    const parsed: Record<string, unknown> = parseUntrustedJson(
      '{"__proto__":{"a":1},"constructor":1,"prototype":2,"kept":3}',
    ) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["kept"]);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  });

  test("headers that are not a JSON object, or nested too deep, are read as none", () => {
    const snapshot: ToolImportSnapshot = readFile(
      JSON.stringify(
        kumaBackup([
          {
            id: 1,
            name: "Broken headers",
            type: "http",
            url: "https://example.com",
            headers: "X-Team: shop",
          },
          {
            id: 2,
            name: "Deep headers",
            type: "http",
            url: "https://example.com",
            headers: `{"a":${"[".repeat(MAX_JSON_DEPTH + 2)}${"]".repeat(MAX_JSON_DEPTH + 2)}}`,
          },
        ]),
      ),
    );

    for (const sourceId of ["1", "2"]) {
      expect(monitorOf(snapshot, sourceId)).toMatchObject({
        monitorType: MonitorType.Website,
      });
      expect(monitorOf(snapshot, sourceId).requestHeaders).toBeUndefined();
    }
  });

  test("names are one line and cut to the column; descriptions are cut too", () => {
    const snapshot: ToolImportSnapshot = readFile(
      JSON.stringify(
        kumaBackup([
          {
            id: 1,
            name: `Line one\nline two\t${"x".repeat(300)}`,
            description: "d".repeat(2000),
            type: "ping",
            hostname: "10.0.0.1",
          },
        ]),
      ),
    );

    const monitor: ImportedMonitor = monitorOf(snapshot, "1");
    expect(monitor.name.startsWith("Line one line two x")).toBe(true);
    expect(monitor.name.length).toBe(100);
    expect(monitor.description!.length).toBe(500);
  });
});

describe("UptimeKumaAdapter: a metrics page", () => {
  test("every monitor once, by name, from the status lines only; groups left out; checked at OneUptime's default pace", () => {
    const snapshot: ToolImportSnapshot = readFile(
      KUMA_METRICS_1,
      "metrics.txt",
    );

    expect(
      (snapshot.monitors || []).map((monitor: ImportedMonitor) => {
        return [monitor.sourceId, monitor.name, monitor.monitorType];
      }),
    ).toEqual([
      ["name:home page", "Home page", MonitorType.Website],
      ["name:database", "Database", MonitorType.Port],
      ["name:gateway", "Gateway", MonitorType.Ping],
      ["name:nightly backup", "Nightly backup", MonitorType.IncomingRequest],
      ['name:shop "eu", {main}', 'Shop "EU", {main}', MonitorType.Website],
      ["name:worker container", "Worker container", null],
    ]);
    expect(snapshot.notes).toEqual([
      makeToolImportNote(ToolImportNoteCode.MonitorsFromMetricsFile),
    ]);
    expect(snapshot.accountName).toBe("metrics.txt");
  });

  test("addresses, hosts and ports are read; 'null' is no value", () => {
    const snapshot: ToolImportSnapshot = readFile(KUMA_METRICS_1);

    expect(monitorOf(snapshot, "name:home page")).toMatchObject({
      destination: "https://example.com",
      // The page does not say how often: OneUptime's default pace.
      intervalSeconds: undefined,
    });
    expect(monitorOf(snapshot, "name:database")).toMatchObject({
      destination: "db.example.com",
      port: 5432,
    });
    // A push monitor's interval is not on the page: it waits an hour.
    expect(monitorOf(snapshot, "name:nightly backup")).toMatchObject({
      heartbeatTimeoutSeconds: 3600,
    });
  });

  test("Uptime Kuma 2 names each monitor's id, so two monitors with one name both come", () => {
    const snapshot: ToolImportSnapshot = readFile(KUMA_METRICS_2);

    expect(
      (snapshot.monitors || []).map((monitor: ImportedMonitor) => {
        return [monitor.sourceId, monitor.destination];
      }),
    ).toEqual([
      ["1", "https://example.com"],
      ["2", "https://example.com/copy"],
    ]);
  });

  test("a metrics page longer than Uptime Kuma ever writes is refused", () => {
    // Well under the size limit: one monitor line, then empty lines.
    const long: string = `monitor_status{monitor_name="A",monitor_type="ping",monitor_hostname="10.0.0.1"} 1${"\n".repeat(MAX_METRICS_LINES)}x`;

    expect(refusal(long)).toBe(
      "This metrics file is longer than an Uptime Kuma metrics page can be.",
    );
  });

  test("a metrics page with no monitor lines in reach is refused", () => {
    expect(
      refusal(
        "# HELP monitor_status Monitor Status\n# TYPE monitor_status gauge\n",
      ),
    ).toBe(
      "This is not an Uptime Kuma backup or metrics file. Upload the JSON file Settings > Backup > Export gives, or the page /metrics shows.",
    );
  });
});

describe("readMetricLabels", () => {
  test("reads each label, unescaping quotes, backslashes and line breaks", () => {
    expect(
      readMetricLabels(
        'monitor_status{monitor_name="A \\"quoted\\" \\\\ name\\nnext",monitor_type="http"} 1',
      ),
    ).toEqual({
      monitor_name: 'A "quoted" \\ name\nnext',
      monitor_type: "http",
    });
  });

  test("a comma or brace inside a value is part of it", () => {
    expect(
      readMetricLabels(
        'monitor_status{monitor_name="a,b}c",monitor_type="ping"} 0',
      ),
    ).toEqual({ monitor_name: "a,b}c", monitor_type: "ping" });
  });

  test("other metrics, and lines that are not whole, are not read", () => {
    expect(
      readMetricLabels('monitor_response_time{monitor_name="A"} 1'),
    ).toBeNull();
    expect(readMetricLabels("# TYPE monitor_status gauge")).toBeNull();
    expect(
      readMetricLabels('monitor_status{monitor_name="unclosed'),
    ).toBeNull();
    expect(
      readMetricLabels("monitor_status{monitor_name=unquoted} 1"),
    ).toBeNull();
    expect(readMetricLabels('monitor_status{monitor_name="A"')).toBeNull();
    expect(readMetricLabels("monitor_status{monitor_name")).toBeNull();
  });

  test("an empty label set is read as none", () => {
    expect(readMetricLabels("monitor_status{} 1")).toEqual({});
  });

  test("a label named after an object's machinery is dropped, and the labels have no prototype to reach", () => {
    const labels: Record<string, string> | null = readMetricLabels(
      'monitor_status{__proto__="x",constructor="y",monitor_name="A"} 1',
    );

    expect(labels).toEqual({ monitor_name: "A" });
    expect(Object.getPrototypeOf(labels)).toBeNull();
    expect(({} as Record<string, unknown>)["x"]).toBeUndefined();
  });
});
