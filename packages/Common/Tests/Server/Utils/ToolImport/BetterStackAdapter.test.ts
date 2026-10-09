import { describe, expect, test } from "@jest/globals";
import BetterStackAdapter from "../../../../Server/Utils/ToolImport/Adapters/BetterStack/BetterStackAdapter";
import { ToolImportHttpRequest } from "../../../../Server/Utils/ToolImport/ToolImportHttpClient";
import {
  ToolImportReadContext,
  ToolImportReadError,
} from "../../../../Server/Utils/ToolImport/Types";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import { BETTER_STACK_HOST } from "../../../../Types/ToolImport/ToolImportCatalog";
import { TOOL_IMPORT_MAX_RECORDS_PER_KIND } from "../../../../Types/ToolImport/ToolImportLimits";
import {
  makeToolImportNote,
  ToolImportNoteCode,
} from "../../../../Types/ToolImport/ToolImportNote";
import ToolImportResourceKind from "../../../../Types/ToolImport/ToolImportResourceKind";
import {
  ImportedMonitor,
  ImportedStatusPage,
  ImportedStatusPageSubscriber,
  ToolImportSnapshot,
} from "../../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../../Types/ToolImport/ToolImportSource";
import {
  BACKUP_HEARTBEAT_ID,
  BETTER_STACK_MONITORS,
  BETTER_STACK_TOKEN,
  betterStackApi,
  betterStackError,
  betterStackPage,
  CHECKOUT_ID,
  DATABASE_ID,
  ERROR_FREE_ID,
  GATEWAY_ID,
  HOME_ID,
  INTERNAL_PAGE_ID,
  MAIL_ID,
  NAMES_ID,
  ORDERS_ID,
  PUBLIC_PAGE_ID,
  SIGNUP_ID,
  SYNC_HEARTBEAT_ID,
  SYSLOG_ID,
} from "./BetterStackFixtures";
import { FixtureApi, json, RecordingSleep } from "./ToolImportFixtureTransport";

/*
 * The Better Stack adapter against a fixture team in the Uptime API v2's
 * documented shapes: what each monitor type and heartbeat becomes, what a
 * status page's sections, resources and subscribers become, and how it
 * reads - only incidents.betterstack.com, page by page, with lists the
 * token may not read said rather than failed.
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
  api: FixtureApi = betterStackApi(),
  sleep?: RecordingSleep,
): Promise<ToolImportSnapshot> {
  return await new BetterStackAdapter().read(
    {
      source: ToolImportSource.BetterStack,
      region: "",
      apiKey: BETTER_STACK_TOKEN,
    },
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

function pageOf(snapshot: ToolImportSnapshot, id: string): ImportedStatusPage {
  return (snapshot.statusPages || []).find(
    (page: ImportedStatusPage): boolean => {
      return page.sourceId === id;
    },
  )!;
}

const monitorId: (id: string) => string = (id: string): string => {
  return `monitor-${id}`;
};

describe("BetterStackAdapter: what a Better Stack team becomes", () => {
  test("monitors, then heartbeats, then items tracked by hand, then certificate monitors; the team is named", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(snapshot.source).toBe(ToolImportSource.BetterStack);
    expect(snapshot.accountName).toBe("Acme");
    expect(
      (snapshot.monitors || []).map((monitor: ImportedMonitor) => {
        return monitor.sourceId;
      }),
    ).toEqual([
      monitorId(HOME_ID),
      monitorId(CHECKOUT_ID),
      monitorId(ERROR_FREE_ID),
      monitorId(ORDERS_ID),
      monitorId(GATEWAY_ID),
      monitorId(DATABASE_ID),
      monitorId(MAIL_ID),
      monitorId(NAMES_ID),
      monitorId(SYSLOG_ID),
      monitorId(SIGNUP_ID),
      `heartbeat-${BACKUP_HEARTBEAT_ID}`,
      `heartbeat-${SYNC_HEARTBEAT_ID}`,
      `item-${PUBLIC_PAGE_ID}-64`,
      `${monitorId(HOME_ID)}:certificate`,
    ]);
    expect(snapshot.notes).toEqual([]);
  });

  test("a status monitor is a Website monitor, up on any 2xx, at the closest pace OneUptime offers", async () => {
    expect(monitorOf(await read(), monitorId(HOME_ID))).toEqual({
      sourceId: monitorId(HOME_ID),
      name: "Home page",
      sourceType: "status",
      monitorType: MonitorType.Website,
      destination: "https://example.com",
      httpMethod: HTTPMethod.GET,
      followRedirects: true,
      timeoutSeconds: 30,
      intervalSeconds: 180,
      acceptedStatusCodes: [{ from: 200, to: 299 }],
      isPaused: false,
      notes: [
        makeToolImportNote(ToolImportNoteCode.MonitorIntervalChanged, {
          every: 180,
          oneUptimeEvery: 120,
        }),
      ],
    });
  });

  test("a monitor that warns before its certificate expires gets an SSL certificate monitor", async () => {
    expect(
      monitorOf(await read(), `${monitorId(HOME_ID)}:certificate`),
    ).toMatchObject({
      name: "Home page certificate",
      monitorType: MonitorType.SSLCertificate,
      destination: "https://example.com",
      certificateExpiryWarningDays: 14,
      intervalSeconds: 3600,
    });
  });

  test("keyword monitors look for the word, matched by case; keyword absence looks for it missing", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(monitorOf(snapshot, monitorId(CHECKOUT_ID))).toMatchObject({
      sourceType: "keyword",
      monitorType: MonitorType.Website,
      // HEAD brings no page to look in.
      httpMethod: HTTPMethod.GET,
      followRedirects: false,
      keyword: { value: "Pay now", isPresent: true, isCaseSensitive: true },
      notes: [],
    });
    expect(monitorOf(snapshot, monitorId(ERROR_FREE_ID))).toMatchObject({
      sourceType: "keyword absence",
      keyword: { value: "Exception", isPresent: false, isCaseSensitive: true },
    });
  });

  test("an expected status code monitor that posts is an API monitor up on its codes, without its secrets", async () => {
    const snapshot: ToolImportSnapshot = await read();
    const orders: ImportedMonitor = monitorOf(snapshot, monitorId(ORDERS_ID));

    expect(orders).toMatchObject({
      sourceType: "expected status code",
      monitorType: MonitorType.API,
      httpMethod: HTTPMethod.POST,
      requestHeaders: { "X-Team": "shop" },
      requestBody: '{"ping":true}',
      acceptedStatusCodes: [
        { from: 200, to: 202 },
        { from: 204, to: 204 },
      ],
      isPaused: true,
    });
    expect(orders.notes).toEqual([
      makeToolImportNote(ToolImportNoteCode.MonitorHeaderLeftOut, {
        header: "Authorization",
      }),
      makeToolImportNote(ToolImportNoteCode.MonitorSignInLeftOut),
      makeToolImportNote(ToolImportNoteCode.MonitorPaused),
    ]);

    const everything: string = JSON.stringify(snapshot);
    expect(everything).not.toContain("never-read");
    expect(everything).not.toContain("orders-secret");
  });

  test("ping, TCP (its timeout in milliseconds) and mail monitors; a mail monitor checks its first port", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(monitorOf(snapshot, monitorId(GATEWAY_ID))).toMatchObject({
      monitorType: MonitorType.Ping,
      destination: "10.0.0.1",
      notes: [
        makeToolImportNote(ToolImportNoteCode.MonitorIntervalChanged, {
          every: 30,
          oneUptimeEvery: 60,
        }),
      ],
    });
    expect(monitorOf(snapshot, monitorId(DATABASE_ID))).toMatchObject({
      sourceType: "TCP",
      monitorType: MonitorType.Port,
      destination: "db.example.com",
      port: 5432,
      timeoutSeconds: 5,
      notes: [],
    });
    expect(monitorOf(snapshot, monitorId(MAIL_ID))).toMatchObject({
      sourceType: "SMTP",
      monitorType: MonitorType.Port,
      port: 25,
      notes: [
        makeToolImportNote(ToolImportNoteCode.MonitorChecksPortOnly, {
          protocol: "SMTP",
        }),
      ],
    });
  });

  test("a DNS monitor looks up the name it queries, asking the server it names", async () => {
    expect(monitorOf(await read(), monitorId(NAMES_ID))).toMatchObject({
      monitorType: MonitorType.DNS,
      destination: "example.com",
      dnsServer: "1.1.1.1",
      notes: [makeToolImportNote(ToolImportNoteCode.MonitorDnsAnswersLeftOut)],
    });
  });

  test("UDP and Playwright monitors are named as left out", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(monitorOf(snapshot, monitorId(SYSLOG_ID))).toMatchObject({
      sourceType: "UDP",
      monitorType: null,
    });
    expect(monitorOf(snapshot, monitorId(SIGNUP_ID))).toMatchObject({
      sourceType: "Playwright",
      monitorType: null,
      destination: "https://example.com/signup",
    });
  });

  test("heartbeats wait their period and grace, apart from a monitor with the same id", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(monitorOf(snapshot, `heartbeat-${BACKUP_HEARTBEAT_ID}`)).toEqual({
      sourceId: `heartbeat-${BACKUP_HEARTBEAT_ID}`,
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
    expect(monitorOf(snapshot, `heartbeat-${SYNC_HEARTBEAT_ID}`)).toMatchObject(
      {
        name: "Hourly sync",
        heartbeatTimeoutSeconds: 3600,
        isPaused: true,
        notes: [
          makeToolImportNote(ToolImportNoteCode.MonitorNewHeartbeatAddress),
          makeToolImportNote(ToolImportNoteCode.MonitorPaused),
        ],
      },
    );
    expect(monitorOf(snapshot, monitorId(SYNC_HEARTBEAT_ID)).name).toBe(
      "Checkout",
    );
  });

  test("a status page's sections are its groups and what it shows its resources, in the page's order", async () => {
    const page: ImportedStatusPage = pageOf(await read(), PUBLIC_PAGE_ID);

    expect(page.groups).toEqual([
      { key: "50", name: "API" },
      { key: "51", name: "Website" },
    ]);
    expect(page.resources).toEqual([
      {
        key: "62",
        monitorSourceId: monitorId(ORDERS_ID),
        groupKey: "50",
        displayName: "Orders",
        displayDescription: undefined,
        showUptimePercent: false,
        showStatusHistoryChart: false,
      },
      {
        key: "61",
        monitorSourceId: monitorId(HOME_ID),
        groupKey: "51",
        displayName: "Home page",
        displayDescription: "Our website",
        showUptimePercent: true,
        showStatusHistoryChart: true,
      },
      {
        key: "63",
        monitorSourceId: `heartbeat-${SYNC_HEARTBEAT_ID}`,
        groupKey: "51",
        displayName: "Sync",
        displayDescription: undefined,
        showUptimePercent: true,
        showStatusHistoryChart: true,
      },
      {
        key: "64",
        monitorSourceId: `item-${PUBLIC_PAGE_ID}-64`,
        groupKey: undefined,
        displayName: "Support desk",
        displayDescription: undefined,
        showUptimePercent: false,
        showStatusHistoryChart: false,
      },
    ]);
  });

  test("an item tracked by hand becomes a manual monitor; a resource OneUptime cannot show is named", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(monitorOf(snapshot, `item-${PUBLIC_PAGE_ID}-64`)).toEqual({
      sourceId: `item-${PUBLIC_PAGE_ID}-64`,
      name: "Support desk",
      sourceType: "manually tracked item",
      monitorType: MonitorType.Manual,
      isPaused: false,
      notes: [],
    });
    expect(pageOf(snapshot, PUBLIC_PAGE_ID).notes).toEqual([
      makeToolImportNote(ToolImportNoteCode.StatusPageResourceNotSupported, {
        name: "Deploys",
      }),
      makeToolImportNote(ToolImportNoteCode.StatusPageCustomDomain, {
        domain: "status.acme.com",
      }),
      makeToolImportNote(ToolImportNoteCode.StatusPageBrandingLeftOut),
    ]);
  });

  test("a public page keeps its history, subscriptions and search setting; a page behind a password comes over private", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(pageOf(snapshot, PUBLIC_PAGE_ID)).toMatchObject({
      name: "Acme",
      pageTitle: "Acme",
      isPublic: true,
      historyDays: 90,
      allowsEmailSubscribers: true,
      allowsSubscribersToChooseResources: true,
      isHiddenFromSearchEngines: false,
    });
    expect(pageOf(snapshot, INTERNAL_PAGE_ID)).toEqual({
      sourceId: INTERNAL_PAGE_ID,
      name: "Internal",
      pageTitle: "Internal",
      isPublic: false,
      historyDays: undefined,
      allowsEmailSubscribers: false,
      allowsSubscribersToChooseResources: false,
      isHiddenFromSearchEngines: true,
      groups: [],
      resources: [
        {
          key: "66",
          monitorSourceId: monitorId(DATABASE_ID),
          groupKey: undefined,
          displayName: "Database",
          displayDescription: undefined,
          showUptimePercent: true,
          showStatusHistoryChart: true,
        },
      ],
      notes: [makeToolImportNote(ToolImportNoteCode.StatusPagePrivate)],
    });
  });

  test("email subscribers come with the parts they follow; one who never confirmed is named, not brought", async () => {
    const subscribers: Array<ImportedStatusPageSubscriber> =
      (await read()).statusPageSubscribers || [];

    expect(subscribers).toEqual([
      {
        sourceId: "71",
        email: "ann@example.com",
        statusPageSourceId: PUBLIC_PAGE_ID,
        resourceKeys: [],
        notes: [],
      },
      {
        sourceId: "72",
        email: "bob@example.com",
        statusPageSourceId: PUBLIC_PAGE_ID,
        resourceKeys: [],
        skipReason: makeToolImportNote(
          ToolImportNoteCode.SubscriberNotConfirmed,
        ),
        notes: [],
      },
      {
        sourceId: "73",
        email: "carol@example.com",
        statusPageSourceId: PUBLIC_PAGE_ID,
        resourceKeys: ["61", "63"],
        notes: [],
      },
    ]);
  });
});

describe("BetterStackAdapter: how it reads", () => {
  test("only incidents.betterstack.com, the token as a Bearer header, 250 a page", async () => {
    const api: FixtureApi = betterStackApi();
    const sleep: RecordingSleep = new RecordingSleep({ now: NOW });

    await read(api, sleep);

    expect(
      new Set(
        api.urls.map((url: URL) => {
          return url.host;
        }),
      ),
    ).toEqual(new Set([BETTER_STACK_HOST]));
    expect(
      api.requests.every((request: ToolImportHttpRequest) => {
        return (
          request.headers["Authorization"] === `Bearer ${BETTER_STACK_TOKEN}`
        );
      }),
    ).toBe(true);
    expect(
      api.urls.every((url: URL) => {
        return url.searchParams.get("per_page") === "250";
      }),
    ).toBe(true);
    expect(sleep.waits).toEqual(new Array(api.requests.length - 1).fill(300));
  });

  test("a list is read page after page while it says there is a next one", async () => {
    const api: FixtureApi = betterStackApi()
      .add({
        path: "/api/v2/monitors",
        query: { page: "1" },
        answers: [
          json(
            betterStackPage(
              BETTER_STACK_MONITORS.slice(0, 2),
              "https://incidents.betterstack.com/api/v2/monitors?page=2",
            ),
          ),
        ],
      })
      .add({
        path: "/api/v2/monitors",
        query: { page: "2" },
        answers: [json(betterStackPage(BETTER_STACK_MONITORS.slice(2, 3)))],
      });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(api.callsTo("/api/v2/monitors")).toHaveLength(2);
    expect(
      (snapshot.monitors || [])
        .filter((monitor: ImportedMonitor) => {
          return monitor.sourceId.startsWith("monitor-");
        })
        .map((monitor: ImportedMonitor) => {
          return monitor.sourceId;
        }),
    ).toEqual([
      monitorId(HOME_ID),
      monitorId(CHECKOUT_ID),
      monitorId(ERROR_FREE_ID),
      `${monitorId(HOME_ID)}:certificate`,
    ]);
  });

  test("a team with more monitors than one read collects stops at the limit, and says so", async () => {
    const api: FixtureApi = betterStackApi().add({
      path: "/api/v2/monitors",
      answers: [
        (_request: ToolImportHttpRequest, url: URL) => {
          const page: number = Number(url.searchParams.get("page"));

          return json(
            betterStackPage(
              Array.from({ length: 250 }, (_value: unknown, index: number) => {
                return {
                  id: String(page * 1000 + index),
                  type: "monitor",
                  attributes: {
                    pronounceable_name: `Site ${page}-${index}`,
                    monitor_type: "status",
                    url: `https://site-${page}-${index}.example.com`,
                  },
                };
              }),
              "https://incidents.betterstack.com/api/v2/monitors?page=next",
            ),
          );
        },
      ],
    });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(api.callsTo("/api/v2/monitors")).toHaveLength(
      TOOL_IMPORT_MAX_RECORDS_PER_KIND / 250,
    );
    expect(snapshot.monitors).toHaveLength(TOOL_IMPORT_MAX_RECORDS_PER_KIND);
    expect(snapshot.notes).toContainEqual(
      makeToolImportNote(ToolImportNoteCode.ReadLimitReached, {
        kind: ToolImportResourceKind.Monitor,
        limit: TOOL_IMPORT_MAX_RECORDS_PER_KIND,
      }),
    );
  });

  test("a refused token stops the read with what to check", async () => {
    const api: FixtureApi = betterStackApi().add({
      path: "/api/v2/monitors",
      answers: [json(betterStackError("Invalid Team API token"), 401)],
    });

    const failure: unknown = await read(api).catch((error: unknown) => {
      return error;
    });

    expect(failure).toBeInstanceOf(ToolImportReadError);
    expect((failure as Error).message).toBe(
      "Better Stack did not accept the API key. Check that you copied the whole token, and that it is a team's Uptime API token from Better Stack > API tokens > Team-based tokens.",
    );
  });

  test("status pages the token may not read are said, and the monitors still come", async () => {
    const api: FixtureApi = betterStackApi().add({
      path: "/api/v2/status-pages",
      answers: [json(betterStackError("Forbidden"), 403)],
    });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(snapshot.statusPages).toEqual([]);
    expect(snapshot.statusPageSubscribers).toEqual([]);
    expect(snapshot.notes).toEqual([
      makeToolImportNote(ToolImportNoteCode.CouldNotRead, {
        kind: ToolImportResourceKind.StatusPage,
      }),
    ]);
    // No page, so no item tracked by hand either.
    expect(snapshot.monitors).toHaveLength(
      BETTER_STACK_MONITORS.length - 1 + 3,
    );
  });

  test("subscribers the token may not read are said once, and the pages still come", async () => {
    const api: FixtureApi = betterStackApi()
      .add({
        path: `/api/v2/status-pages/${PUBLIC_PAGE_ID}/subscribers`,
        answers: [json(betterStackError("Forbidden"), 403)],
      })
      .add({
        path: `/api/v2/status-pages/${INTERNAL_PAGE_ID}/subscribers`,
        answers: [json(betterStackError("Forbidden"), 403)],
      });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(snapshot.statusPages).toHaveLength(2);
    expect(snapshot.statusPageSubscribers).toEqual([]);
    expect(snapshot.notes).toEqual([
      makeToolImportNote(ToolImportNoteCode.CouldNotRead, {
        kind: ToolImportResourceKind.StatusPageSubscriber,
      }),
    ]);
  });
});
