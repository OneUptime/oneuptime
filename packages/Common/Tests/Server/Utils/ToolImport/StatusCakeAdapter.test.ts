import { describe, expect, test } from "@jest/globals";
import StatusCakeAdapter, {
  toHost,
} from "../../../../Server/Utils/ToolImport/Adapters/StatusCake/StatusCakeAdapter";
import { ToolImportHttpRequest } from "../../../../Server/Utils/ToolImport/ToolImportHttpClient";
import {
  ToolImportReadContext,
  ToolImportReadError,
} from "../../../../Server/Utils/ToolImport/Types";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import { STATUSCAKE_HOST } from "../../../../Types/ToolImport/ToolImportCatalog";
import {
  makeToolImportNote,
  ToolImportNoteCode,
} from "../../../../Types/ToolImport/ToolImportNote";
import {
  ImportedMonitor,
  ToolImportSnapshot,
} from "../../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../../Types/ToolImport/ToolImportSource";
import {
  BACKUP_HEARTBEAT_ID,
  BASTION_ID,
  CERTIFICATE_ID,
  DATABASE_ID,
  DOCS_ID,
  ERROR_FREE_ID,
  GATEWAY_ID,
  HOME_ID,
  MAIL_ID,
  NAMES_ID,
  ORDERS_ID,
  PUSH_ID,
  SHOP_CERTIFICATE_ID,
  STATUSCAKE_KEY,
  STATUSCAKE_UPTIME,
  statusCakeApi,
  statusCakeError,
  statusCakePage,
} from "./StatusCakeFixtures";
import { FixtureApi, json, RecordingSleep } from "./ToolImportFixtureTransport";

/*
 * The StatusCake adapter against a fixture account in API v1's documented
 * shapes: what each uptime test type, SSL check and heartbeat becomes -
 * the status codes StatusCake alerts on turned into the codes that count
 * as up - and how it reads: only api.statuscake.com, a second apart,
 * page by page, a check's settings read only where the overview is not
 * all of it.
 */

const NOW: number = Date.parse("2026-10-08T12:00:00Z");

function context(
  api: FixtureApi,
  sleep: RecordingSleep = new RecordingSleep({ now: NOW }),
): ToolImportReadContext {
  return {
    transport: api.transport,
    sleep: sleep.sleep,
    now: (): number => {
      return sleep.clock.now;
    },
    maxRequests: 500,
    deadlineAt: NOW + 60 * 60 * 1000,
  };
}

async function read(
  api: FixtureApi = statusCakeApi(),
  sleep?: RecordingSleep,
): Promise<ToolImportSnapshot> {
  return await new StatusCakeAdapter().read(
    { source: ToolImportSource.StatusCake, apiKey: STATUSCAKE_KEY },
    context(api, sleep),
  );
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

const uptime: (id: string) => string = (id: string): string => {
  return `uptime-${id}`;
};

describe("StatusCakeAdapter: what a StatusCake account becomes", () => {
  test("uptime checks, then heartbeats, then SSL checks, then the certificates uptime checks watch", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(snapshot.source).toBe(ToolImportSource.StatusCake);
    expect(
      (snapshot.monitors || []).map((monitor: ImportedMonitor) => {
        return monitor.sourceId;
      }),
    ).toEqual([
      ...STATUSCAKE_UPTIME.map((test: Record<string, unknown>) => {
        return uptime(String(test["id"]));
      }),
      `heartbeat-${BACKUP_HEARTBEAT_ID}`,
      `ssl-${CERTIFICATE_ID}`,
      `ssl-${SHOP_CERTIFICATE_ID}`,
      `${uptime(HOME_ID)}:certificate`,
    ]);
    expect(snapshot.notes).toEqual([
      makeToolImportNote(ToolImportNoteCode.MaintenanceWindowsNotRead, {
        count: 1,
      }),
    ]);
  });

  test("an HTTP check is a Website monitor up on every code StatusCake does not alert on", async () => {
    expect(monitorOf(await read(), uptime(HOME_ID))).toEqual({
      sourceId: uptime(HOME_ID),
      name: "Home page",
      sourceType: "HTTP",
      monitorType: MonitorType.Website,
      destination: "https://example.com",
      httpMethod: HTTPMethod.GET,
      followRedirects: true,
      timeoutSeconds: 15,
      intervalSeconds: 300,
      acceptedStatusCodes: [
        { from: 100, to: 403 },
        { from: 405, to: 499 },
        { from: 501, to: 501 },
        { from: 505, to: 599 },
      ],
      keyword: { value: "Welcome", isPresent: true, isCaseSensitive: true },
      isPaused: false,
      notes: [],
    });
  });

  test("an HTTP check that alerts before its certificate expires also gets an SSL certificate monitor", async () => {
    expect(
      monitorOf(await read(), `${uptime(HOME_ID)}:certificate`),
    ).toEqual({
      sourceId: `${uptime(HOME_ID)}:certificate`,
      name: "Home page certificate",
      sourceType: "certificate",
      monitorType: MonitorType.SSLCertificate,
      destination: "https://example.com",
      intervalSeconds: 3600,
      isPaused: false,
      notes: [],
    });
  });

  test("a check that posts raw JSON is an API monitor, its custom headers read from their JSON, a secret one left out", async () => {
    const orders: ImportedMonitor = monitorOf(await read(), uptime(ORDERS_ID));

    expect(orders).toMatchObject({
      monitorType: MonitorType.API,
      httpMethod: HTTPMethod.POST,
      requestHeaders: { "X-Team": "shop" },
      requestBody: '{"ping":true}',
      followRedirects: false,
      intervalSeconds: 60,
    });
    // No status codes listed: OneUptime's own every 2xx and 3xx.
    expect(orders.acceptedStatusCodes).toBeUndefined();
    expect(orders.notes).toEqual([
      makeToolImportNote(ToolImportNoteCode.MonitorHeaderLeftOut, {
        header: "X-Auth-Token",
      }),
    ]);
    expect(JSON.stringify(orders)).not.toContain("orders-secret");
  });

  test("a HEAD check stays a HEAD; a check rate of 0 is as often as OneUptime checks; paused stays paused", async () => {
    expect(monitorOf(await read(), uptime(DOCS_ID))).toMatchObject({
      sourceType: "HEAD",
      monitorType: MonitorType.Website,
      httpMethod: HTTPMethod.HEAD,
      intervalSeconds: 60,
      isPaused: true,
      notes: [makeToolImportNote(ToolImportNoteCode.MonitorPaused)],
    });
  });

  test("text the page must not contain is looked for missing", async () => {
    expect(monitorOf(await read(), uptime(ERROR_FREE_ID))).toMatchObject({
      keyword: { value: "Exception", isPresent: false, isCaseSensitive: true },
      intervalSeconds: 1800,
      notes: [],
    });
  });

  test("ping, TCP, SMTP and SSH checks keep their host and port; the mail and shell protocols are checked as a port", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(monitorOf(snapshot, uptime(GATEWAY_ID))).toMatchObject({
      monitorType: MonitorType.Ping,
      destination: "10.0.0.1",
      notes: [
        makeToolImportNote(ToolImportNoteCode.MonitorIntervalChanged, {
          every: 30,
          oneUptimeEvery: 60,
        }),
      ],
    });
    expect(monitorOf(snapshot, uptime(DATABASE_ID))).toMatchObject({
      sourceType: "TCP",
      monitorType: MonitorType.Port,
      destination: "db.example.com",
      port: 5432,
      timeoutSeconds: 10,
      notes: [],
    });
    expect(monitorOf(snapshot, uptime(MAIL_ID))).toMatchObject({
      sourceType: "SMTP",
      port: 25,
      notes: [
        makeToolImportNote(ToolImportNoteCode.MonitorChecksPortOnly, {
          protocol: "SMTP",
        }),
      ],
    });
    expect(monitorOf(snapshot, uptime(BASTION_ID))).toMatchObject({
      sourceType: "SSH",
      destination: "bastion.example.com",
      port: 2222,
      notes: [
        makeToolImportNote(ToolImportNoteCode.MonitorChecksPortOnly, {
          protocol: "SSH",
        }),
      ],
    });
  });

  test("a DNS check asks the server it names, and says its expected addresses stay behind", async () => {
    expect(monitorOf(await read(), uptime(NAMES_ID))).toMatchObject({
      monitorType: MonitorType.DNS,
      destination: "example.com",
      dnsServer: "8.8.8.8",
      notes: [makeToolImportNote(ToolImportNoteCode.MonitorDnsAnswersLeftOut)],
    });
  });

  test("a test type the import does not know is named as left out", async () => {
    expect(monitorOf(await read(), uptime(PUSH_ID))).toMatchObject({
      sourceType: "PUSH",
      monitorType: null,
    });
  });

  test("an SSL check warns as far ahead as its first alert; one written without https is read over https", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(monitorOf(snapshot, `ssl-${CERTIFICATE_ID}`)).toEqual({
      sourceId: `ssl-${CERTIFICATE_ID}`,
      name: "example.com certificate",
      sourceType: "SSL",
      monitorType: MonitorType.SSLCertificate,
      destination: "https://example.com",
      intervalSeconds: 86400,
      certificateExpiryWarningDays: 30,
      isPaused: false,
      notes: [],
    });
    expect(monitorOf(snapshot, `ssl-${SHOP_CERTIFICATE_ID}`)).toEqual({
      sourceId: `ssl-${SHOP_CERTIFICATE_ID}`,
      name: "shop.example.com certificate",
      sourceType: "SSL",
      monitorType: MonitorType.SSLCertificate,
      destination: "https://shop.example.com",
      intervalSeconds: 3600,
      isPaused: true,
      notes: [makeToolImportNote(ToolImportNoteCode.MonitorPaused)],
    });
  });

  test("a heartbeat waits its period, and says it gets a new address", async () => {
    expect(monitorOf(await read(), `heartbeat-${BACKUP_HEARTBEAT_ID}`)).toEqual(
      {
        sourceId: `heartbeat-${BACKUP_HEARTBEAT_ID}`,
        name: "Nightly backup",
        sourceType: "heartbeat",
        monitorType: MonitorType.IncomingRequest,
        intervalSeconds: 86400,
        heartbeatTimeoutSeconds: 86400,
        isPaused: false,
        notes: [
          makeToolImportNote(ToolImportNoteCode.MonitorNewHeartbeatAddress),
        ],
      },
    );
  });

  test("a host is read out of an address written any way", () => {
    expect(toHost("ssh://bastion.example.com:2222/")).toBe(
      "bastion.example.com",
    );
    expect(toHost(" db.example.com:5432 ")).toBe("db.example.com");
    expect(toHost("https://example.com/path?x=1#y")).toBe("example.com");
    expect(toHost("10.0.0.1")).toBe("10.0.0.1");
    // An IPv6 address keeps its colons.
    expect(toHost("2001:db8::1")).toBe("2001:db8::1");
  });
});

describe("StatusCakeAdapter: how it reads", () => {
  test("only api.statuscake.com, the key as a Bearer header, one request a second", async () => {
    const api: FixtureApi = statusCakeApi();
    const sleep: RecordingSleep = new RecordingSleep({ now: NOW });

    await read(api, sleep);

    expect(
      new Set(
        api.urls.map((url: URL) => {
          return url.host;
        }),
      ),
    ).toEqual(new Set([STATUSCAKE_HOST]));
    expect(
      api.requests.every((request: ToolImportHttpRequest) => {
        return request.headers["Authorization"] === `Bearer ${STATUSCAKE_KEY}`;
      }),
    ).toBe(true);
    expect(sleep.waits).toEqual(new Array(api.requests.length - 1).fill(1000));
  });

  test("a ping check's overview is all of it; every other check's settings are read once", async () => {
    const api: FixtureApi = statusCakeApi();

    await read(api);

    expect(api.callsTo(`/v1/uptime/${GATEWAY_ID}`)).toHaveLength(0);

    for (const id of [HOME_ID, ORDERS_ID, DATABASE_ID, NAMES_ID]) {
      expect(api.callsTo(`/v1/uptime/${id}`)).toHaveLength(1);
    }
  });

  test("lists are read page by page up to the page count", async () => {
    const api: FixtureApi = statusCakeApi()
      .add({
        path: "/v1/uptime",
        query: { page: "1" },
        answers: [json(statusCakePage(STATUSCAKE_UPTIME.slice(0, 2), 2, 1))],
      })
      .add({
        path: "/v1/uptime",
        query: { page: "2" },
        answers: [json(statusCakePage(STATUSCAKE_UPTIME.slice(4, 5), 2, 2))],
      });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(
      api.callsTo("/v1/uptime").map((url: URL) => {
        return [url.searchParams.get("page"), url.searchParams.get("limit")];
      }),
    ).toEqual([
      ["1", "100"],
      ["2", "100"],
    ]);
    expect(
      (snapshot.monitors || [])
        .filter((monitor: ImportedMonitor) => {
          return monitor.sourceId.startsWith("uptime-");
        })
        .map((monitor: ImportedMonitor) => {
          return monitor.sourceId;
        }),
    ).toEqual([
      uptime(HOME_ID),
      uptime(ORDERS_ID),
      uptime(GATEWAY_ID),
      `${uptime(HOME_ID)}:certificate`,
    ]);
  });

  test("a check deleted while reading is left out, and the rest still come", async () => {
    const api: FixtureApi = statusCakeApi().add({
      path: `/v1/uptime/${DATABASE_ID}`,
      answers: [json(statusCakeError("Not found"), 404)],
    });

    const ids: Array<string> = ((await read(api)).monitors || []).map(
      (monitor: ImportedMonitor) => {
        return monitor.sourceId;
      },
    );

    expect(ids).not.toContain(uptime(DATABASE_ID));
    expect(ids).toContain(uptime(MAIL_ID));
  });

  test("a refused key stops the read with what to check", async () => {
    const api: FixtureApi = statusCakeApi().add({
      path: "/v1/uptime",
      answers: [json(statusCakeError("Unauthorized"), 401)],
    });

    const failure: unknown = await read(api).catch((error: unknown) => {
      return error;
    });

    expect(failure).toBeInstanceOf(ToolImportReadError);
    expect((failure as Error).message).toBe(
      "StatusCake did not accept the API key. Check that you copied the whole key, and that it is an API key from your StatusCake account panel.",
    );
  });

  test("SSL checks, heartbeats and maintenance windows the plan does not have are read as none", async () => {
    const api: FixtureApi = statusCakeApi()
      .add({
        path: "/v1/ssl",
        answers: [json(statusCakeError("Forbidden"), 403)],
      })
      .add({
        path: "/v1/heartbeat",
        answers: [json(statusCakeError("Not found"), 404)],
      })
      .add({
        path: "/v1/maintenance-windows",
        answers: [json(statusCakeError("Forbidden"), 403)],
      });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(snapshot.notes).toEqual([]);
    expect(snapshot.monitors).toHaveLength(STATUSCAKE_UPTIME.length + 1);
  });

  test("told to slow down, it waits as long as asked and tries again", async () => {
    const api: FixtureApi = statusCakeApi().add({
      path: "/v1/ssl",
      answers: [
        json(statusCakeError("Too many requests"), 429, {
          "retry-after": "20",
        }),
        json(statusCakePage([])),
      ],
    });
    const sleep: RecordingSleep = new RecordingSleep({ now: NOW });

    await read(api, sleep);

    expect(api.callsTo("/v1/ssl")).toHaveLength(2);
    expect(sleep.waits).toContain(20000);
  });
});
