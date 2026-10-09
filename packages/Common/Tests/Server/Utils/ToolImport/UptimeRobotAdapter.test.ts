import { describe, expect, test } from "@jest/globals";
import UptimeRobotAdapter from "../../../../Server/Utils/ToolImport/Adapters/UptimeRobot/UptimeRobotAdapter";
import {
  ToolImportReadContext,
  ToolImportReadError,
} from "../../../../Server/Utils/ToolImport/Types";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import DnsRecordType from "../../../../Types/Monitor/DnsMonitor/DnsRecordType";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import { UPTIMEROBOT_HOST } from "../../../../Types/ToolImport/ToolImportCatalog";
import {
  makeToolImportNote,
  ToolImportNote,
  ToolImportNoteCode,
} from "../../../../Types/ToolImport/ToolImportNote";
import ToolImportResourceKind from "../../../../Types/ToolImport/ToolImportResourceKind";
import {
  ImportedMonitor,
  ImportedStatusPage,
  ImportedStatusPageResource,
  ToolImportSnapshot,
} from "../../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../../Types/ToolImport/ToolImportSource";
import { FixtureApi, json, RecordingSleep } from "./ToolImportFixtureTransport";
import {
  ADMIN_ID,
  BACKUP_ID,
  CHECKOUT_ID,
  DATABASE_ID,
  EVERYTHING_PAGE_ID,
  GATEWAY_ID,
  HEALTH_ID,
  HOME_ID,
  INTERNAL_PAGE_ID,
  MX_ID,
  OPEN_PORT_ID,
  ORDERS_ID,
  PUBLIC_PAGE_ID,
  SYSLOG_ID,
  UPTIMEROBOT_KEY,
  UPTIMEROBOT_MONITORS,
  uptimeRobotApi,
  uptimeRobotError,
  uptimeRobotPage,
} from "./UptimeRobotFixtures";

/*
 * The UptimeRobot adapter against a fixture UptimeRobot in the v3 API's
 * documented shapes: what each kind of monitor becomes (and which are named
 * as left out), what a public status page shows, and how the read behaves -
 * the fixed host, the key in a Bearer header, one request every six
 * seconds, cursor paging, and a refused key or list. Nothing here reaches
 * a real UptimeRobot.
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
  api: FixtureApi = uptimeRobotApi(),
  sleep?: RecordingSleep,
): Promise<ToolImportSnapshot> {
  return await new UptimeRobotAdapter().read(
    { source: ToolImportSource.UptimeRobot, apiKey: UPTIMEROBOT_KEY },
    context(api, sleep),
  );
}

function monitorOf(snapshot: ToolImportSnapshot, id: number | string): ImportedMonitor {
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

function pageOf(snapshot: ToolImportSnapshot, id: number): ImportedStatusPage {
  return (snapshot.statusPages || []).find(
    (page: ImportedStatusPage): boolean => {
      return page.sourceId === String(id);
    },
  )!;
}

function codes(notes: Array<ToolImportNote>): Array<ToolImportNoteCode> {
  return notes.map((note: ToolImportNote): ToolImportNoteCode => {
    return note.code;
  });
}

describe("UptimeRobotAdapter: what an UptimeRobot account becomes", () => {
  test("every monitor comes in the account's order, its certificate monitors last; the account is named by its email", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(snapshot.source).toBe(ToolImportSource.UptimeRobot);
    expect(snapshot.accountName).toBe("ops@acme.com");
    expect(
      (snapshot.monitors || []).map((monitor: ImportedMonitor) => {
        return monitor.sourceId;
      }),
    ).toEqual([
      ...UPTIMEROBOT_MONITORS.map((monitor: Record<string, unknown>) => {
        return String(monitor["id"]);
      }),
      `${HOME_ID}:certificate`,
    ]);
    // An uptime tool brings no people, teams or schedules.
    expect(snapshot.people).toEqual([]);
    expect(snapshot.schedules).toEqual([]);
  });

  test("an HTTP monitor is a Website monitor with its status codes, pace and wait", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(monitorOf(snapshot, HOME_ID)).toEqual({
      sourceId: String(HOME_ID),
      name: "Home page",
      sourceType: "http",
      monitorType: MonitorType.Website,
      destination: "https://example.com",
      httpMethod: HTTPMethod.GET,
      followRedirects: true,
      timeoutSeconds: 30,
      intervalSeconds: 300,
      acceptedStatusCodes: [{ from: 200, to: 399 }],
      isPaused: false,
      notes: [],
    });
  });

  test("a monitor that warns before its certificate expires also gets an SSL certificate monitor, warning as far ahead as its last reminder", async () => {
    const certificate: ImportedMonitor = monitorOf(
      await read(),
      `${HOME_ID}:certificate`,
    );

    expect(certificate).toMatchObject({
      name: "Home page certificate",
      monitorType: MonitorType.SSLCertificate,
      destination: "https://example.com",
      certificateExpiryWarningDays: 30,
      intervalSeconds: 3600,
      isPaused: false,
    });
  });

  test("a keyword monitor looks for its keyword where UptimeRobot did, by GET, and says it now matches case", async () => {
    const checkout: ImportedMonitor = monitorOf(await read(), CHECKOUT_ID);

    expect(checkout).toMatchObject({
      sourceType: "keyword",
      monitorType: MonitorType.Website,
      httpMethod: HTTPMethod.GET,
      followRedirects: false,
      intervalSeconds: 60,
      acceptedStatusCodes: [{ from: 200, to: 299 }],
      // Alert when it is missing: up while it is there.
      keyword: { value: "Pay now", isPresent: true, isCaseSensitive: false },
    });
    expect(codes(checkout.notes)).toEqual([
      ToolImportNoteCode.MonitorKeywordCaseSensitive,
    ]);
  });

  test("a POST with headers and a JSON body is an API monitor, without its secret header, paused as it was", async () => {
    const orders: ImportedMonitor = monitorOf(await read(), ORDERS_ID);

    expect(orders).toMatchObject({
      monitorType: MonitorType.API,
      httpMethod: HTTPMethod.POST,
      requestHeaders: { "Content-Type": "application/json" },
      requestBody: '{"ping":true}',
      isPaused: true,
    });
    expect(orders.notes).toEqual([
      makeToolImportNote(ToolImportNoteCode.MonitorHeaderLeftOut, {
        header: "Authorization",
      }),
      makeToolImportNote(ToolImportNoteCode.MonitorTimeoutShortened, {
        timeout: 90,
      }),
      makeToolImportNote(ToolImportNoteCode.MonitorPaused),
    ]);
  });

  test("ping and port monitors keep their host, port and wait; a faster pace than OneUptime's is said", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(monitorOf(snapshot, GATEWAY_ID)).toMatchObject({
      sourceType: "ping",
      monitorType: MonitorType.Ping,
      destination: "10.0.0.1",
      intervalSeconds: 30,
      notes: [
        makeToolImportNote(ToolImportNoteCode.MonitorIntervalChanged, {
          every: 30,
          oneUptimeEvery: 60,
        }),
      ],
    });
    expect(monitorOf(snapshot, DATABASE_ID)).toMatchObject({
      monitorType: MonitorType.Port,
      destination: "db.example.com",
      port: 5432,
      timeoutSeconds: 10,
      notes: [],
    });
  });

  test("a port monitor that alerts while the port is open is left out, with the reason", async () => {
    expect(monitorOf(await read(), OPEN_PORT_ID)).toEqual({
      sourceId: String(OPEN_PORT_ID),
      name: "Telnet must stay shut",
      sourceType: "port",
      monitorType: null,
      destination: "legacy.example.com",
      isPaused: false,
      skipReason: makeToolImportNote(ToolImportNoteCode.MonitorUpsideDown),
      notes: [],
    });
  });

  test("a heartbeat waits its interval and grace, and says it gets a new address", async () => {
    expect(monitorOf(await read(), BACKUP_ID)).toEqual({
      sourceId: String(BACKUP_ID),
      name: "Nightly backup",
      sourceType: "heartbeat",
      monitorType: MonitorType.IncomingRequest,
      intervalSeconds: 86400,
      heartbeatTimeoutSeconds: 90000,
      isPaused: false,
      notes: [
        makeToolImportNote(ToolImportNoteCode.MonitorNewHeartbeatAddress),
      ],
    });
  });

  test("a DNS monitor looks up the record it checked, and says its expected answers stay behind", async () => {
    expect(monitorOf(await read(), MX_ID)).toMatchObject({
      monitorType: MonitorType.DNS,
      destination: "example.com",
      dnsRecordType: DnsRecordType.MX,
      notes: [makeToolImportNote(ToolImportNoteCode.MonitorDnsAnswersLeftOut)],
    });
  });

  test("UDP is named as left out; an API monitor's assertions and a sign-in are said", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(monitorOf(snapshot, SYSLOG_ID)).toMatchObject({
      sourceType: "UDP",
      monitorType: null,
      destination: "logs.example.com",
    });
    expect(codes(monitorOf(snapshot, HEALTH_ID).notes)).toEqual([
      ToolImportNoteCode.MonitorAssertionsLeftOut,
    ]);
    expect(monitorOf(snapshot, HEALTH_ID).sourceType).toBe("API");
    // It reads the answer as JSON: an API monitor, though a plain GET.
    expect(monitorOf(snapshot, HEALTH_ID).monitorType).toBe(MonitorType.API);
    expect(monitorOf(snapshot, HEALTH_ID).requestHeaders).toBeUndefined();
    expect(codes(monitorOf(snapshot, ADMIN_ID).notes)).toEqual([
      ToolImportNoteCode.MonitorSignInLeftOut,
    ]);
  });

  test("a public status page shows the monitors it names, in its order, with its uptime and bars, its domain and logo said", async () => {
    const page: ImportedStatusPage = pageOf(await read(), PUBLIC_PAGE_ID);

    expect(page).toEqual({
      sourceId: String(PUBLIC_PAGE_ID),
      name: "Public status",
      pageTitle: "Public status",
      isPublic: true,
      allowsEmailSubscribers: true,
      isHiddenFromSearchEngines: true,
      groups: [],
      resources: [
        {
          key: String(CHECKOUT_ID),
          monitorSourceId: String(CHECKOUT_ID),
          displayName: "Checkout",
          showUptimePercent: true,
          showStatusHistoryChart: false,
        },
        {
          key: String(HOME_ID),
          monitorSourceId: String(HOME_ID),
          displayName: "Home page",
          showUptimePercent: true,
          showStatusHistoryChart: false,
        },
      ],
      notes: [
        makeToolImportNote(ToolImportNoteCode.StatusPageCustomDomain, {
          domain: "status.example.com",
        }),
        makeToolImportNote(ToolImportNoteCode.StatusPageBrandingLeftOut),
      ],
    });
  });

  test("a page chosen by tag shows the tagged monitors; a page with a password comes over private", async () => {
    const page: ImportedStatusPage = pageOf(await read(), INTERNAL_PAGE_ID);

    expect(
      page.resources.map((resource: ImportedStatusPageResource) => {
        return [
          resource.monitorSourceId,
          resource.showUptimePercent,
          resource.showStatusHistoryChart,
        ];
      }),
    ).toEqual([[String(HOME_ID), false, true]]);
    expect(page.isPublic).toBe(false);
    expect(page.allowsEmailSubscribers).toBe(false);
    expect(codes(page.notes)).toEqual([ToolImportNoteCode.StatusPagePrivate]);
  });

  test("a page that names neither monitors nor tags shows every monitor", async () => {
    const page: ImportedStatusPage = pageOf(await read(), EVERYTHING_PAGE_ID);

    expect(page.resources).toHaveLength(UPTIMEROBOT_MONITORS.length);
    expect(page.notes).toEqual([]);
  });

  test("maintenance windows are counted, not brought over", async () => {
    expect((await read()).notes).toEqual([
      makeToolImportNote(ToolImportNoteCode.MaintenanceWindowsNotRead, {
        count: 2,
      }),
    ]);
  });
});

describe("UptimeRobotAdapter: how it reads", () => {
  test("only api.uptimerobot.com, with the key as a Bearer token, one request every six seconds", async () => {
    const api: FixtureApi = uptimeRobotApi();
    const sleep: RecordingSleep = new RecordingSleep({ now: NOW });

    await read(api, sleep);

    expect(
      new Set(
        api.urls.map((url: URL) => {
          return url.host;
        }),
      ),
    ).toEqual(new Set([UPTIMEROBOT_HOST]));
    expect(
      api.requests.every((request: { headers: Record<string, string> }) => {
        return request.headers["Authorization"] === `Bearer ${UPTIMEROBOT_KEY}`;
      }),
    ).toBe(true);
    // A request before each but the first waits out the six seconds.
    expect(sleep.waits).toEqual(
      new Array(api.requests.length - 1).fill(6000),
    );
  });

  test("lists are read page by page, the cursor the last id of the page before", async () => {
    const [first, second] = [
      UPTIMEROBOT_MONITORS.slice(0, 2),
      UPTIMEROBOT_MONITORS.slice(2, 4),
    ];
    const api: FixtureApi = uptimeRobotApi()
      .add({
        path: "/v3/monitors",
        answers: [json(uptimeRobotPage(first!, CHECKOUT_ID))],
      })
      .add({
        path: "/v3/monitors",
        query: { cursor: String(CHECKOUT_ID) },
        answers: [json(uptimeRobotPage(second!))],
      });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(
      api.callsTo("/v3/monitors").map((url: URL) => {
        return [url.searchParams.get("limit"), url.searchParams.get("cursor")];
      }),
    ).toEqual([
      ["200", null],
      ["200", String(CHECKOUT_ID)],
    ]);
    expect(
      (snapshot.monitors || [])
        .filter((monitor: ImportedMonitor) => {
          return !monitor.sourceId.includes(":");
        })
        .map((monitor: ImportedMonitor) => {
          return monitor.sourceId;
        }),
    ).toEqual(
      [...first!, ...second!].map((monitor: Record<string, unknown>) => {
        return String(monitor["id"]);
      }),
    );
  });

  test("a page that does not move the cursor on ends the list, rather than loop", async () => {
    const one: Array<Record<string, unknown>> = UPTIMEROBOT_MONITORS.slice(0, 1);
    const api: FixtureApi = uptimeRobotApi()
      .add({
        path: "/v3/monitors",
        answers: [json(uptimeRobotPage(one, HOME_ID))],
      })
      .add({
        path: "/v3/monitors",
        query: { cursor: String(HOME_ID) },
        answers: [json(uptimeRobotPage(one, HOME_ID))],
      });

    await read(api);

    expect(api.callsTo("/v3/monitors")).toHaveLength(2);
  });

  test("a refused key stops the read with what to check", async () => {
    const api: FixtureApi = uptimeRobotApi().add({
      path: "/v3/user/me",
      answers: [json(uptimeRobotError(401, "Unauthorized"), 401)],
    });

    await expect(read(api)).rejects.toThrow(ToolImportReadError);
    await expect(read(uptimeRobotApi().add({
      path: "/v3/user/me",
      answers: [json(uptimeRobotError(401, "Unauthorized"), 401)],
    }))).rejects.toThrow(
      "UptimeRobot did not accept the API key. Check that you copied the whole key",
    );
  });

  test("status pages the key may not read are said, and the monitors still come", async () => {
    const api: FixtureApi = uptimeRobotApi().add({
      path: "/v3/psps",
      answers: [json(uptimeRobotError(403, "Forbidden"), 403)],
    });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(snapshot.statusPages).toEqual([]);
    expect(snapshot.monitors!.length).toBeGreaterThan(0);
    expect(snapshot.notes).toContainEqual(
      makeToolImportNote(ToolImportNoteCode.CouldNotRead, {
        kind: ToolImportResourceKind.StatusPage,
      }),
    );
  });

  test("maintenance windows the key may not read say nothing", async () => {
    const api: FixtureApi = uptimeRobotApi().add({
      path: "/v3/maintenance-windows",
      answers: [json(uptimeRobotError(403, "Forbidden"), 403)],
    });

    expect((await read(api)).notes).toEqual([]);
  });

  test("told to slow down, it waits and asks again", async () => {
    const api: FixtureApi = uptimeRobotApi().add({
      path: "/v3/monitors",
      answers: [
        json(uptimeRobotError(429, "Too Many Requests"), 429, {
          "retry-after": "30",
        }),
        json(uptimeRobotPage(UPTIMEROBOT_MONITORS)),
      ],
    });
    const sleep: RecordingSleep = new RecordingSleep({ now: NOW });

    const snapshot: ToolImportSnapshot = await read(api, sleep);

    expect(api.callsTo("/v3/monitors")).toHaveLength(2);
    expect(sleep.waits).toContain(30000);
    expect(snapshot.monitors!.length).toBe(UPTIMEROBOT_MONITORS.length + 1);
  });
});
