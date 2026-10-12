import { describe, expect, test } from "@jest/globals";
import PingdomAdapter from "../../../../Server/Utils/ToolImport/Adapters/Pingdom/PingdomAdapter";
import {
  ToolImportReadContext,
  ToolImportReadError,
} from "../../../../Server/Utils/ToolImport/Types";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import { PINGDOM_HOST } from "../../../../Types/ToolImport/ToolImportCatalog";
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
  CUSTOM_ID,
  DATABASE_ID,
  GATEWAY_ID,
  HOME_ID,
  INBOX_ID,
  LOGIN_ID,
  MAIL_ID,
  NAMES_ID,
  ORDERS_ID,
  PINGDOM_CHECKS,
  PINGDOM_TOKEN,
  pingdomApi,
  pingdomError,
  PLAIN_ID,
  REDIS_ID,
  SYSLOG_ID,
  TRANSACTION_ID,
} from "./PingdomFixtures";
import { FixtureApi, json, RecordingSleep } from "./ToolImportFixtureTransport";

/*
 * The Pingdom adapter against a fixture Pingdom in API 3.1's documented
 * shapes: what each check type becomes, which are named as left out, and
 * how it reads - only api.pingdom.com, the token as a Bearer header, a
 * check's settings read only when it has any.
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
  api: FixtureApi = pingdomApi(),
  sleep?: RecordingSleep,
): Promise<ToolImportSnapshot> {
  return await new PingdomAdapter().read(
    { source: ToolImportSource.Pingdom, region: "", apiKey: PINGDOM_TOKEN },
    context(api, sleep),
  );
}

function monitorOf(
  snapshot: ToolImportSnapshot,
  id: number | string,
): ImportedMonitor {
  const found: ImportedMonitor | undefined = (snapshot.monitors || []).find(
    (monitor: ImportedMonitor): boolean => {
      return monitor.sourceId === String(id);
    },
  );

  if (!found) {
    throw new Error(`No monitor ${id}`);
  }

  return found;
}

describe("PingdomAdapter: what a Pingdom account becomes", () => {
  test("every check in the account's order, then the transaction checks, then the certificate monitors", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(snapshot.source).toBe(ToolImportSource.Pingdom);
    expect(
      (snapshot.monitors || []).map((monitor: ImportedMonitor) => {
        return monitor.sourceId;
      }),
    ).toEqual([
      ...PINGDOM_CHECKS.map((check: Record<string, unknown>) => {
        return String(check["id"]);
      }),
      `transaction:${TRANSACTION_ID}`,
      `${HOME_ID}:certificate`,
    ]);
    expect(snapshot.readAt).toBe(new Date(NOW + 11 * 500).toISOString());
  });

  test("an HTTP check is a Website monitor on its address, with the text it should contain, matched by case", async () => {
    expect(monitorOf(await read(), HOME_ID)).toEqual({
      sourceId: String(HOME_ID),
      name: "Home page",
      sourceType: "HTTP",
      monitorType: MonitorType.Website,
      destination: "https://example.com/",
      httpMethod: HTTPMethod.GET,
      followRedirects: undefined,
      timeoutSeconds: undefined,
      intervalSeconds: 300,
      isPaused: false,
      keyword: { value: "Welcome", isPresent: true, isCaseSensitive: true },
      // Pingdom's own user agent is not a header the check chose.
      notes: [],
    });
  });

  test("a check that is down while its certificate expires soon gets an SSL certificate monitor warning that far ahead", async () => {
    expect(monitorOf(await read(), `${HOME_ID}:certificate`)).toEqual({
      sourceId: `${HOME_ID}:certificate`,
      name: "Home page certificate",
      sourceType: "certificate",
      monitorType: MonitorType.SSLCertificate,
      destination: "https://example.com/",
      intervalSeconds: 3600,
      isPaused: false,
      certificateExpiryWarningDays: 14,
      notes: [],
    });
  });

  test("a check that posts data is an API monitor on its port, its secret header left out, paused as it was", async () => {
    const orders: ImportedMonitor = monitorOf(await read(), ORDERS_ID);

    expect(orders).toMatchObject({
      monitorType: MonitorType.API,
      destination: "https://api.example.com:8443/orders",
      httpMethod: HTTPMethod.POST,
      requestHeaders: { "X-Team": "shop" },
      requestBody: '{"ping":true}',
      intervalSeconds: 60,
      isPaused: true,
    });
    expect(orders.notes).toEqual([
      makeToolImportNote(ToolImportNoteCode.MonitorHeaderLeftOut, {
        header: "X-Api-Key",
      }),
      makeToolImportNote(ToolImportNoteCode.MonitorPaused),
    ]);
  });

  test("text that should not be there, headers as lines, and a sign-in that is said, not copied", async () => {
    const login: ImportedMonitor = monitorOf(await read(), LOGIN_ID);

    expect(login).toMatchObject({
      monitorType: MonitorType.API,
      destination: "http://login.example.com/login",
      httpMethod: HTTPMethod.GET,
      requestHeaders: { "X-Env": "prod" },
      keyword: { value: "Error", isPresent: false, isCaseSensitive: true },
      intervalSeconds: 900,
    });
    expect(login.notes).toEqual([
      makeToolImportNote(ToolImportNoteCode.MonitorSignInLeftOut),
    ]);
    expect(JSON.stringify(login)).not.toContain("admin");
  });

  test("no certificate monitor where the check ignores certificates, or never warns", async () => {
    const ids: Array<string> = ((await read()).monitors || []).map(
      (monitor: ImportedMonitor) => {
        return monitor.sourceId;
      },
    );

    expect(ids).not.toContain(`${ORDERS_ID}:certificate`);
    expect(ids).not.toContain(`${LOGIN_ID}:certificate`);
    expect(ids).not.toContain(`${PLAIN_ID}:certificate`);
  });

  test("TCP checks are Port monitors; one that talks to the port says only the port is checked", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(monitorOf(snapshot, DATABASE_ID)).toEqual({
      sourceId: String(DATABASE_ID),
      name: "Database",
      sourceType: "TCP",
      monitorType: MonitorType.Port,
      destination: "db.example.com",
      port: 5432,
      intervalSeconds: 300,
      isPaused: false,
      notes: [],
    });
    expect(monitorOf(snapshot, REDIS_ID)).toMatchObject({
      port: 6379,
      notes: [
        makeToolImportNote(ToolImportNoteCode.MonitorChecksPortOnly, {
          protocol: "TCP",
        }),
      ],
    });
  });

  test("mail checks are Port monitors on their protocol's port, secure or not", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(monitorOf(snapshot, MAIL_ID)).toMatchObject({
      sourceType: "SMTP",
      monitorType: MonitorType.Port,
      destination: "mail.example.com",
      port: 465,
      notes: [
        makeToolImportNote(ToolImportNoteCode.MonitorChecksPortOnly, {
          protocol: "SMTP",
        }),
      ],
    });
    expect(monitorOf(snapshot, INBOX_ID)).toMatchObject({
      sourceType: "IMAP",
      port: 143,
      intervalSeconds: 1800,
    });
  });

  test("ping and DNS checks keep their host and name server; a DNS check's expected address is said", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(monitorOf(snapshot, GATEWAY_ID)).toMatchObject({
      monitorType: MonitorType.Ping,
      destination: "10.0.0.1",
      intervalSeconds: 60,
      notes: [],
    });
    expect(monitorOf(snapshot, NAMES_ID)).toMatchObject({
      monitorType: MonitorType.DNS,
      destination: "example.com",
      dnsServer: "8.8.8.8",
      intervalSeconds: 3600,
      notes: [makeToolImportNote(ToolImportNoteCode.MonitorDnsAnswersLeftOut)],
    });
  });

  test("UDP, custom HTTP and transaction checks are named as left out", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(monitorOf(snapshot, SYSLOG_ID)).toMatchObject({
      sourceType: "UDP",
      monitorType: null,
      destination: "logs.example.com",
    });
    expect(monitorOf(snapshot, CUSTOM_ID)).toMatchObject({
      sourceType: "custom HTTP",
      monitorType: null,
    });
    expect(monitorOf(snapshot, `transaction:${TRANSACTION_ID}`)).toEqual({
      sourceId: `transaction:${TRANSACTION_ID}`,
      name: "Checkout flow",
      sourceType: "transaction",
      monitorType: null,
      isPaused: false,
      notes: [],
    });
  });

  test("maintenance windows are counted, not brought over", async () => {
    expect((await read()).notes).toEqual([
      makeToolImportNote(ToolImportNoteCode.MaintenanceWindowsNotRead, {
        count: 3,
      }),
    ]);
  });
});

describe("PingdomAdapter: how it reads", () => {
  test("only api.pingdom.com, the token as a Bearer header, half a second apart", async () => {
    const api: FixtureApi = pingdomApi();
    const sleep: RecordingSleep = new RecordingSleep({ now: NOW });

    await read(api, sleep);

    expect(
      new Set(
        api.urls.map((url: URL) => {
          return url.host;
        }),
      ),
    ).toEqual(new Set([PINGDOM_HOST]));
    expect(
      api.requests.every((request: { headers: Record<string, string> }) => {
        return request.headers["Authorization"] === `Bearer ${PINGDOM_TOKEN}`;
      }),
    ).toBe(true);
    expect(sleep.waits).toEqual(new Array(api.requests.length - 1).fill(500));
    expect(
      api.callsTo("/api/3.1/checks")[0]!.searchParams.get("include_tags"),
    ).toBe("true");
  });

  test("a check's settings are read only for the checks that have any", async () => {
    const api: FixtureApi = pingdomApi();

    await read(api);

    for (const id of [GATEWAY_ID, SYSLOG_ID, CUSTOM_ID]) {
      expect(api.callsTo(`/api/3.1/checks/${id}`)).toHaveLength(0);
    }

    for (const id of [HOME_ID, ORDERS_ID, DATABASE_ID, NAMES_ID]) {
      expect(api.callsTo(`/api/3.1/checks/${id}`)).toHaveLength(1);
    }
  });

  test("a check deleted while reading is left out, and the rest still come", async () => {
    const api: FixtureApi = pingdomApi().add({
      path: `/api/3.1/checks/${DATABASE_ID}`,
      answers: [json(pingdomError(404, "Check not found"), 404)],
    });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(
      (snapshot.monitors || []).some((monitor: ImportedMonitor) => {
        return monitor.sourceId === String(DATABASE_ID);
      }),
    ).toBe(false);
    expect(snapshot.monitors).toHaveLength(PINGDOM_CHECKS.length + 1);
  });

  test("a refused token stops the read with what to check", async () => {
    const api: FixtureApi = pingdomApi().add({
      path: "/api/3.1/checks",
      answers: [json(pingdomError(401, "Invalid token"), 401)],
    });

    const failure: unknown = await read(api).catch((error: unknown) => {
      return error;
    });

    expect(failure).toBeInstanceOf(ToolImportReadError);
    expect((failure as Error).message).toBe(
      "Pingdom did not accept the API key. Check that you copied the whole token, and that it is an API token from My Pingdom > Settings > Pingdom API.",
    );
    expect((failure as Error).message).not.toContain(PINGDOM_TOKEN);
  });

  test("transaction checks and maintenance windows the token may not read say nothing", async () => {
    const api: FixtureApi = pingdomApi()
      .add({
        path: "/api/3.1/tms/check",
        answers: [json(pingdomError(403, "Forbidden"), 403)],
      })
      .add({
        path: "/api/3.1/maintenance",
        answers: [json(pingdomError(403, "Forbidden"), 403)],
      });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(snapshot.notes).toEqual([]);
    expect(snapshot.monitors).toHaveLength(PINGDOM_CHECKS.length + 1);
  });

  test("a check with no id is skipped", async () => {
    const api: FixtureApi = pingdomApi().add({
      path: "/api/3.1/checks",
      answers: [
        json({
          checks: [{ name: "Ghost", type: "http", hostname: "ghost.example" }],
        }),
      ],
    });

    expect(
      ((await read(api)).monitors || []).map((monitor: ImportedMonitor) => {
        return monitor.sourceId;
      }),
    ).toEqual([`transaction:${TRANSACTION_ID}`]);
  });
});
