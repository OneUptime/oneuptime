import { describe, expect, test } from "@jest/globals";
import AtlassianStatuspageAdapter from "../../../../Server/Utils/ToolImport/Adapters/AtlassianStatuspage/AtlassianStatuspageAdapter";
import { ToolImportHttpRequest } from "../../../../Server/Utils/ToolImport/ToolImportHttpClient";
import {
  ToolImportReadContext,
  ToolImportReadError,
} from "../../../../Server/Utils/ToolImport/Types";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import { ATLASSIAN_STATUSPAGE_HOST } from "../../../../Types/ToolImport/ToolImportCatalog";
import { TOOL_IMPORT_MAX_RECORDS_PER_KIND } from "../../../../Types/ToolImport/ToolImportLimits";
import {
  makeToolImportNote,
  ToolImportNote,
  ToolImportNoteCode,
} from "../../../../Types/ToolImport/ToolImportNote";
import ToolImportResourceKind from "../../../../Types/ToolImport/ToolImportResourceKind";
import {
  ImportedStatusPage,
  ImportedStatusPageResource,
  ImportedStatusPageSubscriber,
  ToolImportSnapshot,
} from "../../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../../Types/ToolImport/ToolImportSource";
import {
  API_ID,
  DATABASE_ID,
  EMAIL_ID,
  INTERNAL_PAGE_ID,
  PUBLIC_PAGE_ID,
  STATUSPAGE_KEY,
  STATUSPAGE_PAGES,
  statuspageApi,
  statuspageError,
  statuspagePaged,
  statuspageSubscribers,
  WEB_APP_ID,
  WEBSITE_GROUP_ID,
} from "./AtlassianStatuspageFixtures";
import { FixtureApi, json, RecordingSleep } from "./ToolImportFixtureTransport";

/*
 * The Atlassian Statuspage adapter against a fixture organization in REST
 * API v1's documented shapes: pages become status pages, components manual
 * monitors the pages show, component groups the pages' groups, confirmed
 * email subscribers subscribers - and the read itself: only
 * api.statuspage.io, the key as an OAuth header, one request a second,
 * pages counted from 0 or from 1 read the same, and subscribers an earlier
 * import brought over read past, so each import reads the next ones.
 */

const NOW: number = Date.parse("2026-10-08T12:00:00Z");

function context(
  api: FixtureApi,
  sleep: RecordingSleep = new RecordingSleep({ now: NOW }),
  importedSubscriberIds?: ReadonlySet<string>,
): ToolImportReadContext {
  return {
    transport: api.transport,
    sleep: sleep.sleep,
    now: (): number => {
      return sleep.clock.now;
    },
    maxRequests: 500,
    deadlineAt: NOW + 60 * 60 * 1000,
    importedSubscriberIds: importedSubscriberIds,
  };
}

async function read(
  api: FixtureApi = statuspageApi(),
  sleep?: RecordingSleep,
  importedSubscriberIds?: ReadonlySet<string>,
): Promise<ToolImportSnapshot> {
  return await new AtlassianStatuspageAdapter().read(
    {
      source: ToolImportSource.AtlassianStatuspage,
      region: "",
      apiKey: STATUSPAGE_KEY,
    },
    context(api, sleep, importedSubscriberIds),
  );
}

function pageOf(snapshot: ToolImportSnapshot, id: string): ImportedStatusPage {
  return (snapshot.statusPages || []).find(
    (page: ImportedStatusPage): boolean => {
      return page.sourceId === id;
    },
  )!;
}

const SUBSCRIBERS_PATH: string = `/v1/pages/${PUBLIC_PAGE_ID}/subscribers`;

describe("AtlassianStatuspageAdapter: what a Statuspage organization becomes", () => {
  test("every page the key sees is a status page; each component is a manual monitor, in the page's order", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(snapshot.source).toBe(ToolImportSource.AtlassianStatuspage);
    // Two pages: no one name for the account.
    expect(snapshot.accountName).toBeUndefined();
    expect(
      (snapshot.statusPages || []).map((page: ImportedStatusPage) => {
        return page.sourceId;
      }),
    ).toEqual([PUBLIC_PAGE_ID, INTERNAL_PAGE_ID]);
    expect(snapshot.monitors).toEqual([
      {
        sourceId: EMAIL_ID,
        name: "Email delivery",
        sourceType: "component",
        monitorType: MonitorType.Manual,
        isPaused: false,
        notes: [],
      },
      {
        sourceId: WEB_APP_ID,
        name: "Web app",
        description: "The app",
        sourceType: "component",
        monitorType: MonitorType.Manual,
        isPaused: false,
        notes: [],
      },
      {
        sourceId: API_ID,
        name: "API",
        sourceType: "component",
        monitorType: MonitorType.Manual,
        isPaused: false,
        // Its status today is not copied: it starts operational.
        notes: [makeToolImportNote(ToolImportNoteCode.MonitorStatusNotCopied)],
      },
      {
        sourceId: DATABASE_ID,
        name: "Database",
        sourceType: "component",
        monitorType: MonitorType.Manual,
        isPaused: false,
        notes: [makeToolImportNote(ToolImportNoteCode.MonitorStatusNotCopied)],
      },
    ]);
    expect(snapshot.notes).toEqual([]);
  });

  test("a public page keeps its groups, what it shows and its description; its domain, logo and other subscribers are said", async () => {
    expect(pageOf(await read(), PUBLIC_PAGE_ID)).toEqual({
      sourceId: PUBLIC_PAGE_ID,
      name: "Acme",
      pageTitle: "Acme",
      pageDescription: "Live status of Acme",
      isPublic: true,
      allowsEmailSubscribers: true,
      allowsSubscribersToChooseResources: true,
      isHiddenFromSearchEngines: false,
      groups: [
        {
          key: WEBSITE_GROUP_ID,
          name: "Website",
          description: "Public website",
        },
      ],
      resources: [
        {
          key: EMAIL_ID,
          monitorSourceId: EMAIL_ID,
          groupKey: undefined,
          displayName: "Email delivery",
          displayDescription: undefined,
          showUptimePercent: true,
          showStatusHistoryChart: true,
        },
        {
          key: WEB_APP_ID,
          monitorSourceId: WEB_APP_ID,
          groupKey: WEBSITE_GROUP_ID,
          displayName: "Web app",
          displayDescription: "The app",
          showUptimePercent: true,
          showStatusHistoryChart: true,
        },
        {
          key: API_ID,
          monitorSourceId: API_ID,
          groupKey: WEBSITE_GROUP_ID,
          displayName: "API",
          displayDescription: undefined,
          // Not showcased: no uptime bars.
          showUptimePercent: false,
          showStatusHistoryChart: false,
        },
      ],
      notes: [
        makeToolImportNote(ToolImportNoteCode.StatusPageCustomDomain, {
          domain: "status.acme.com",
        }),
        makeToolImportNote(ToolImportNoteCode.StatusPageBrandingLeftOut),
        // Two by text message and one by webhook.
        makeToolImportNote(ToolImportNoteCode.SubscribersLeftOut, {
          count: 3,
        }),
      ],
    });
  });

  test("a page only team members may see comes over private, with its own subscription and search settings", async () => {
    expect(pageOf(await read(), INTERNAL_PAGE_ID)).toEqual({
      sourceId: INTERNAL_PAGE_ID,
      name: "Internal",
      pageTitle: "Internal",
      isPublic: false,
      allowsEmailSubscribers: false,
      allowsSubscribersToChooseResources: false,
      isHiddenFromSearchEngines: true,
      groups: [],
      resources: [
        {
          key: DATABASE_ID,
          monitorSourceId: DATABASE_ID,
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

  test("confirmed email subscribers come with the components they follow", async () => {
    const subscribers: Array<ImportedStatusPageSubscriber> =
      (await read()).statusPageSubscribers || [];

    expect(subscribers).toEqual([
      {
        sourceId: "sub1",
        email: "ann@example.com",
        statusPageSourceId: PUBLIC_PAGE_ID,
        resourceKeys: [],
        notes: [],
      },
      {
        sourceId: "sub2",
        email: "bob@example.com",
        statusPageSourceId: PUBLIC_PAGE_ID,
        resourceKeys: [WEB_APP_ID],
        notes: [],
      },
      {
        sourceId: "sub3",
        email: "carol@example.com",
        statusPageSourceId: PUBLIC_PAGE_ID,
        resourceKeys: [API_ID],
        notes: [],
      },
    ]);
  });

  test("an organization with one page is named after it", async () => {
    const api: FixtureApi = statuspageApi().add({
      path: "/v1/pages",
      answers: [json([STATUSPAGE_PAGES[0]])],
    });

    expect((await read(api)).accountName).toBe("Acme");
  });
});

describe("AtlassianStatuspageAdapter: how it reads", () => {
  test("only api.statuspage.io, the key as an OAuth header, one request a second; only active email subscribers are asked for", async () => {
    const api: FixtureApi = statuspageApi();
    const sleep: RecordingSleep = new RecordingSleep({ now: NOW });

    await read(api, sleep);

    expect(
      new Set(
        api.urls.map((url: URL) => {
          return url.host;
        }),
      ),
    ).toEqual(new Set([ATLASSIAN_STATUSPAGE_HOST]));
    expect(
      api.requests.every((request: ToolImportHttpRequest) => {
        return request.headers["Authorization"] === `OAuth ${STATUSPAGE_KEY}`;
      }),
    ).toBe(true);
    expect(sleep.waits).toEqual(new Array(api.requests.length - 1).fill(1000));

    const asked: URL = api.callsTo(SUBSCRIBERS_PATH)[0]!;
    expect(asked.searchParams.get("type")).toBe("email");
    expect(asked.searchParams.get("state")).toBe("active");
    expect(asked.searchParams.get("limit")).toBe("100");
    // The first page is asked for without a number.
    expect(asked.searchParams.get("page")).toBeNull();
  });

  test("a list counted from 0 is read page after page", async () => {
    const api: FixtureApi = statuspageApi()
      .add({
        path: SUBSCRIBERS_PATH,
        answers: [json(statuspageSubscribers(100, 0))],
      })
      .add({
        path: SUBSCRIBERS_PATH,
        query: { page: "1" },
        answers: [json(statuspageSubscribers(100, 100))],
      })
      .add({
        path: SUBSCRIBERS_PATH,
        query: { page: "2" },
        answers: [json(statuspageSubscribers(20, 200))],
      });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(api.callsTo(SUBSCRIBERS_PATH)).toHaveLength(3);
    expect(snapshot.statusPageSubscribers).toHaveLength(220);
  });

  test("a list counted from 1 answers page 1 as the first page again: read once, and the rest still come", async () => {
    const api: FixtureApi = statuspageApi()
      .add({
        path: SUBSCRIBERS_PATH,
        answers: [json(statuspageSubscribers(100, 0))],
      })
      .add({
        path: SUBSCRIBERS_PATH,
        query: { page: "1" },
        answers: [json(statuspageSubscribers(100, 0))],
      })
      .add({
        path: SUBSCRIBERS_PATH,
        query: { page: "2" },
        answers: [json(statuspageSubscribers(100, 100))],
      })
      .add({
        path: SUBSCRIBERS_PATH,
        query: { page: "3" },
        answers: [json(statuspageSubscribers(20, 200))],
      });

    const subscribers: Array<ImportedStatusPageSubscriber> =
      (await read(api)).statusPageSubscribers || [];

    expect(subscribers).toHaveLength(220);
    expect(
      new Set(
        subscribers.map((subscriber: ImportedStatusPageSubscriber) => {
          return subscriber.sourceId;
        }),
      ).size,
    ).toBe(220);
  });

  test("a list that ignores the page number is read once, not forever", async () => {
    const api: FixtureApi = statuspageApi().add({
      path: SUBSCRIBERS_PATH,
      answers: [json(statuspageSubscribers(100, 0))],
    });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(api.callsTo(SUBSCRIBERS_PATH)).toHaveLength(3);
    expect(snapshot.statusPageSubscribers).toHaveLength(100);
  });

  test("a page with more subscribers than one read collects stops at the limit, and says so", async () => {
    const api: FixtureApi = statuspageApi().add({
      path: SUBSCRIBERS_PATH,
      answers: [
        (_request: ToolImportHttpRequest, url: URL) => {
          const page: number = Number(url.searchParams.get("page") || "0");
          return json(statuspageSubscribers(100, page * 100));
        },
      ],
    });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(snapshot.statusPageSubscribers).toHaveLength(
      TOOL_IMPORT_MAX_RECORDS_PER_KIND,
    );
    expect(snapshot.notes).toEqual([
      makeToolImportNote(ToolImportNoteCode.ReadLimitReached, {
        kind: ToolImportResourceKind.StatusPageSubscriber,
        limit: TOOL_IMPORT_MAX_RECORDS_PER_KIND,
      }),
    ]);
  });

  test("subscribers the key may not read are said once, and their count is not asked for", async () => {
    const api: FixtureApi = statuspageApi()
      .add({
        path: SUBSCRIBERS_PATH,
        answers: [json(statuspageError("Forbidden"), 403)],
      })
      .add({
        path: `/v1/pages/${INTERNAL_PAGE_ID}/subscribers`,
        answers: [json(statuspageError("Forbidden"), 403)],
      });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(snapshot.statusPageSubscribers).toEqual([]);
    expect(snapshot.statusPages).toHaveLength(2);
    expect(snapshot.notes).toEqual([
      makeToolImportNote(ToolImportNoteCode.CouldNotRead, {
        kind: ToolImportResourceKind.StatusPageSubscriber,
      }),
    ]);
    expect(api.callsTo(`${SUBSCRIBERS_PATH}/count`)).toHaveLength(0);
  });

  test("a key that sees no page stops the read with what to check", async () => {
    const api: FixtureApi = statuspageApi().add({
      path: "/v1/pages",
      answers: [json([])],
    });

    const failure: unknown = await read(api).catch((error: unknown) => {
      return error;
    });

    expect(failure).toBeInstanceOf(ToolImportReadError);
    expect((failure as Error).message).toBe(
      "The API key can see no Statuspage page. Check that you copied the whole key, and that it is an API key from your avatar > API info in Statuspage. Only an account owner can create one.",
    );
  });

  test("a refused key stops the read with what to check", async () => {
    const api: FixtureApi = statuspageApi().add({
      path: "/v1/pages",
      answers: [json(statuspageError("Unauthorized"), 401)],
    });

    const failure: unknown = await read(api).catch((error: unknown) => {
      return error;
    });

    expect(failure).toBeInstanceOf(ToolImportReadError);
    expect((failure as Error).message).toMatch(
      /^Atlassian Statuspage did not accept the API key\. /,
    );
    expect((failure as Error).message).not.toContain(STATUSPAGE_KEY);
  });
});

describe("AtlassianStatuspageAdapter: subscribers an earlier import brought over", () => {
  const LIMIT: number = TOOL_IMPORT_MAX_RECORDS_PER_KIND;

  const READ_LIMIT_REACHED: ToolImportNote = makeToolImportNote(
    ToolImportNoteCode.ReadLimitReached,
    {
      kind: ToolImportResourceKind.StatusPageSubscriber,
      limit: LIMIT,
    },
  );

  // The public page with `total` email subscribers, sub-0 on.
  function pageWithSubscribers(total: number): FixtureApi {
    return statuspageApi().add({
      path: SUBSCRIBERS_PATH,
      answers: [statuspagePaged(statuspageSubscribers(total, 0))],
    });
  }

  function idsOf(snapshot: ToolImportSnapshot): Array<string> {
    return (snapshot.statusPageSubscribers || []).map(
      (subscriber: ImportedStatusPageSubscriber): string => {
        return subscriber.sourceId;
      },
    );
  }

  function subscriberIds(from: number, count: number): Array<string> {
    return statuspageSubscribers(count, from).map(
      (subscriber: Record<string, unknown>): string => {
        return subscriber["id"] as string;
      },
    );
  }

  test("are read past without being counted: each read collects the next ones, until none are left", async () => {
    const total: number = 2 * LIMIT + 2000;

    const first: ToolImportSnapshot = await read(pageWithSubscribers(total));

    expect(idsOf(first)).toEqual(subscriberIds(0, LIMIT));
    expect(first.notes).toEqual([READ_LIMIT_REACHED]);

    // The first ones came over: the next read collects the ones after them.
    const second: ToolImportSnapshot = await read(
      pageWithSubscribers(total),
      undefined,
      new Set<string>(idsOf(first)),
    );

    expect(idsOf(second)).toEqual(subscriberIds(LIMIT, LIMIT));
    expect(second.notes).toEqual([READ_LIMIT_REACHED]);

    // And the one after that, the rest - reading every page to get there.
    const api: FixtureApi = pageWithSubscribers(total);
    const third: ToolImportSnapshot = await read(
      api,
      undefined,
      new Set<string>([...idsOf(first), ...idsOf(second)]),
    );

    expect(idsOf(third)).toEqual(subscriberIds(2 * LIMIT, 2000));
    expect(third.notes).toEqual([]);
    expect(api.callsTo(SUBSCRIBERS_PATH)).toHaveLength(total / 100 + 1);
  });

  test("a page of them is not taken for a page that repeats; page 1 of a list counted from 1 still is", async () => {
    const api: FixtureApi = statuspageApi()
      .add({
        path: SUBSCRIBERS_PATH,
        answers: [json(statuspageSubscribers(100, 0))],
      })
      .add({
        path: SUBSCRIBERS_PATH,
        query: { page: "1" },
        answers: [json(statuspageSubscribers(100, 0))],
      })
      .add({
        path: SUBSCRIBERS_PATH,
        query: { page: "2" },
        answers: [json(statuspageSubscribers(100, 100))],
      })
      .add({
        path: SUBSCRIBERS_PATH,
        query: { page: "3" },
        answers: [json(statuspageSubscribers(20, 200))],
      });

    // Every subscriber of the first page came over before.
    const snapshot: ToolImportSnapshot = await read(
      api,
      undefined,
      new Set<string>(subscriberIds(0, 100)),
    );

    expect(idsOf(snapshot)).toEqual(subscriberIds(100, 120));
    expect(api.callsTo(SUBSCRIBERS_PATH)).toHaveLength(4);
  });

  test("only subscribers are read past: every component and group is read, however many pages they take", async () => {
    const components: Array<Record<string, unknown>> = Array.from(
      { length: 250 },
      (_value: unknown, index: number): Record<string, unknown> => {
        return {
          id: `cmp-${index}`,
          name: `Component ${index}`,
          status: "operational",
          position: index,
          group_id: `grp-${index % 120}`,
          showcase: true,
          group: false,
        };
      },
    );
    const groups: Array<Record<string, unknown>> = Array.from(
      { length: 120 },
      (_value: unknown, index: number): Record<string, unknown> => {
        return { id: `grp-${index}`, name: `Group ${index}`, position: index };
      },
    );
    const api: FixtureApi = statuspageApi()
      .add({
        path: `/v1/pages/${PUBLIC_PAGE_ID}/components`,
        answers: [statuspagePaged(components)],
      })
      .add({
        path: `/v1/pages/${PUBLIC_PAGE_ID}/component-groups`,
        answers: [statuspagePaged(groups)],
      });

    // Even ids of components and groups given as brought over are read.
    const snapshot: ToolImportSnapshot = await read(
      api,
      undefined,
      new Set<string>(["sub1", "sub3", "cmp-0", "cmp-249", "grp-0"]),
    );
    const page: ImportedStatusPage = pageOf(snapshot, PUBLIC_PAGE_ID);

    expect(page.resources).toHaveLength(250);
    expect(page.groups).toHaveLength(120);
    expect(
      page.resources.every((resource: ImportedStatusPageResource): boolean => {
        return Boolean(resource.groupKey);
      }),
    ).toBe(true);
    // The public page's 250 and the internal page's one.
    expect(snapshot.monitors).toHaveLength(251);
    expect(idsOf(snapshot)).toEqual(["sub2"]);
    expect(snapshot.notes).toEqual([]);
  });
});
