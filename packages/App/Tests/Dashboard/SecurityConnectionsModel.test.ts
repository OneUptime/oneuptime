import { beforeAll, describe, expect, test } from "@jest/globals";
import Route from "Common/Types/API/Route";
import { JSONObject } from "Common/Types/JSON";
import {
  ResourceSecurityJson,
  SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
  SecurityConnectedResourceJson,
  SecurityConnectionCertainty,
  SecurityConnectionKind,
  SecurityConnectionReason,
  SecurityConnectionsJson,
  IncidentSecurityJson,
} from "Common/Types/SecurityCase/SecurityConnection";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";

/*
 * What the Connected Signals views and the Security cards draw from the
 * server's answers, and where every link they draw goes: a record's own
 * page, its logs and traces in the explorers filtered to it and pinned to
 * the window, its metrics over the window, a service's exceptions, a
 * cluster's events, a record's topology and inventory item, and Security
 * Events on the events naming a record. An answer an older or a newer
 * server wrote is read defensively.
 *
 * Deferred imports with a browser stub: RouteMap pulls in Common/UI/Config,
 * which reads `window` at module load, and the project comes from the
 * address the reader is on.
 */

type Model =
  typeof import("../../FeatureSet/Dashboard/src/Components/SecurityConnections/SecurityConnectionsModel");

let model: Model;

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const HOST_ID: string = "22222222-2222-4222-8222-222222222222";
const SERVICE_ID: string = "33333333-3333-4333-8333-333333333333";
const CLUSTER_ID: string = "44444444-4444-4444-8444-444444444444";
const DEVICE_ID: string = "55555555-5555-4555-8555-555555555555";
const USER_ID: string = "66666666-6666-4666-8666-666666666666";
const ITEM_ID: string = "77777777-7777-4777-8777-777777777777";
const WINDOW_START: string = "2026-10-25T09:30:00.000Z";
const WINDOW_END: string = "2026-10-25T10:30:00.000Z";
const BASE: string = `/dashboard/${PROJECT_ID}`;

beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: {
      pathname: `${BASE}/security-events/cases`,
      search: "",
      hash: "",
    },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  model = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityConnections/SecurityConnectionsModel"
  );
});

// A link as a reader's browser opens it: its path, and its query read back.
function open(route: Route | null | undefined): {
  path: string;
  query: Record<string, string>;
} {
  expect(route).toBeTruthy();

  const url: globalThis.URL = new globalThis.URL(
    route!.toString(),
    "https://oneuptime.example",
  );
  const query: Record<string, string> = {};

  url.searchParams.forEach((value: string, key: string) => {
    query[key] = value;
  });

  return { path: url.pathname, query };
}

function resource(
  kind: SecurityConnectionKind,
  id: string,
  inventoryItemId?: string,
): Pick<SecurityConnectedResourceJson, "kind" | "id" | "inventoryItemId"> {
  return { kind, id, ...(inventoryItemId ? { inventoryItemId } : {}) };
}

function linksOf(
  kind: SecurityConnectionKind,
  id: string,
  inventoryItemId?: string,
): Record<string, { path: string; query: Record<string, string> }> {
  const links: Record<string, { path: string; query: Record<string, string> }> =
    {};

  for (const link of model.getSignalLinks({
    resource: resource(kind, id, inventoryItemId),
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
  })) {
    links[link.key] = open(link.route);
  }

  return links;
}

describe("reading Connected Signals' answer", () => {
  test("keeps each record the server knows, with its matches, facts and changes", () => {
    const parsed: SecurityConnectionsJson = model.parseSecurityConnections({
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      resources: [
        {
          kind: SecurityConnectionKind.Host,
          id: HOST_ID,
          name: "web-1",
          certainty: SecurityConnectionCertainty.Exact,
          matches: [
            {
              entityType: "Host",
              entityValue: "web-1",
              certainty: SecurityConnectionCertainty.Exact,
              reason: SecurityConnectionReason.HostName,
              matchedValue: "web-1",
            },
          ],
          activeIncidents: {
            count: 3,
            items: [
              {
                id: "i-1",
                title: "API down",
                number: "INC-7",
                stateName: "Open",
              },
              { title: "no id: dropped" },
            ],
          },
          activeAlerts: null,
          recentChanges: [
            {
              id: "c-1",
              time: "2026-10-25T10:00:00.000Z",
              title: "Deployed 1.2",
            },
            { id: "c-2", title: "no time: dropped" },
          ],
          inventoryItemId: ITEM_ID,
        },
      ],
      hasMoreResources: true,
      unmatched: [{ type: "User", value: "kim" }],
      unreadableKinds: [SecurityConnectionKind.Service, "Planet"],
      failedKinds: [SecurityConnectionKind.User],
    });

    expect(parsed.resources).toHaveLength(1);
    expect(parsed.resources[0]).toMatchObject({
      kind: SecurityConnectionKind.Host,
      id: HOST_ID,
      name: "web-1",
      certainty: SecurityConnectionCertainty.Exact,
      activeIncidents: {
        count: 3,
        items: [
          { id: "i-1", title: "API down", number: "INC-7", stateName: "Open" },
        ],
      },
      // A fact the server did not send is not known: null, never zero.
      activeAlerts: null,
      monitors: null,
      recentChanges: [
        {
          id: "c-1",
          time: "2026-10-25T10:00:00.000Z",
          title: "Deployed 1.2",
          eventType: "change",
        },
      ],
      inventoryItemId: ITEM_ID,
    });
    expect(parsed.hasMoreResources).toBe(true);
    expect(parsed.unmatched).toEqual([
      { type: SecurityEntityType.User, value: "kim" },
    ]);
    expect(parsed.unreadableKinds).toEqual([SecurityConnectionKind.Service]);
    expect(parsed.failedKinds).toEqual([SecurityConnectionKind.User]);
  });

  test("a record of a kind this Dashboard does not know, or without an id, is left out; an unsure one is possible", () => {
    const parsed: SecurityConnectionsJson = model.parseSecurityConnections({
      resources: [
        { kind: "Planet", id: HOST_ID, name: "mars" },
        { kind: SecurityConnectionKind.Host, name: "no id" },
        {
          kind: SecurityConnectionKind.Host,
          id: HOST_ID,
          name: "web-1",
          certainty: "Somewhat",
          matches: [
            { reason: "Telepathy", entityValue: "x" },
            {
              reason: SecurityConnectionReason.ShortHostName,
              entityValue: "web-1",
              matchedValue: "web-1.prod",
            },
          ],
        },
        "not a record",
      ],
    } as unknown as JSONObject);

    expect(parsed.resources).toHaveLength(1);
    expect(parsed.resources[0]!.certainty).toBe(
      SecurityConnectionCertainty.Possible,
    );
    expect(parsed.resources[0]!.matches).toEqual([
      {
        entityType: "",
        entityValue: "web-1",
        certainty: SecurityConnectionCertainty.Possible,
        reason: SecurityConnectionReason.ShortHostName,
        matchedValue: "web-1.prod",
      },
    ]);
    expect(parsed.hasMoreResources).toBe(false);
    expect(parsed.windowStart).toBe("");
  });

  test("an empty answer is an empty one", () => {
    expect(model.parseSecurityConnections({})).toEqual({
      windowStart: "",
      windowEnd: "",
      resources: [],
      hasMoreResources: false,
      unmatched: [],
      unreadableKinds: [],
      failedKinds: [],
    });
  });

  test("leads a record's line with an exact match, else its first", () => {
    const exact: SecurityConnectedResourceJson["matches"][number] = {
      entityType: "IpAddress",
      entityValue: "203.0.113.9",
      certainty: SecurityConnectionCertainty.Exact,
      reason: SecurityConnectionReason.Address,
      matchedValue: "203.0.113.9",
    };
    const possible: SecurityConnectedResourceJson["matches"][number] = {
      ...exact,
      certainty: SecurityConnectionCertainty.Possible,
      reason: SecurityConnectionReason.PrivateAddress,
    };
    const base: SecurityConnectedResourceJson = model.parseSecurityConnections({
      resources: [
        { kind: SecurityConnectionKind.Host, id: HOST_ID, name: "web-1" },
      ],
    }).resources[0]!;

    expect(model.getLeadingMatch({ ...base, matches: [possible, exact] })).toBe(
      exact,
    );
    expect(model.getLeadingMatch({ ...base, matches: [possible] })).toBe(
      possible,
    );
    expect(model.getLeadingMatch({ ...base, matches: [] })).toBeNull();
  });
});

describe("what Connected Signals says first", () => {
  function connections(
    overrides: Partial<SecurityConnectionsJson> = {},
  ): SecurityConnectionsJson {
    return {
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      resources: [],
      hasMoreResources: false,
      unmatched: [],
      unreadableKinds: [],
      failedKinds: [],
      ...overrides,
    };
  }

  const web1: SecurityConnectedResourceJson = connectedRecord(
    SecurityConnectionCertainty.Exact,
    HOST_ID,
  );

  function connectedRecord(
    certainty: SecurityConnectionCertainty,
    id: string,
  ): SecurityConnectedResourceJson {
    return {
      kind: SecurityConnectionKind.Host,
      id,
      name: id,
      certainty,
      matches: [],
      activeIncidents: null,
      activeAlerts: null,
      monitors: null,
      recentChanges: null,
    };
  }

  test("the records, whatever else it says", () => {
    expect(
      model.getConnectedSignalsState(
        connections({
          resources: [web1],
          unmatched: [{ type: SecurityEntityType.Host, value: "kiosk-17" }],
          unreadableKinds: [SecurityConnectionKind.User],
          failedKinds: [SecurityConnectionKind.Service],
        }),
      ),
    ).toBe("records");
  });

  test("nothing found is said only when every kind of record was read", () => {
    const looked: Partial<SecurityConnectionsJson> = {
      unmatched: [{ type: SecurityEntityType.Host, value: "kiosk-17" }],
    };

    expect(model.getConnectedSignalsState(connections(looked))).toBe(
      "nothing-found",
    );
    // A kind the role cannot see, or one that failed, may still hold it.
    expect(
      model.getConnectedSignalsState(
        connections({
          ...looked,
          unreadableKinds: [SecurityConnectionKind.User],
        }),
      ),
    ).toBe("partly-read");
    expect(
      model.getConnectedSignalsState(
        connections({
          ...looked,
          failedKinds: [SecurityConnectionKind.KubernetesCluster],
        }),
      ),
    ).toBe("partly-read");
    // Nothing was looked up everywhere, and a kind could not be read: partly read, not "nothing to look up".
    expect(
      model.getConnectedSignalsState(
        connections({ unreadableKinds: [SecurityConnectionKind.User] }),
      ),
    ).toBe("partly-read");
  });

  test("a case naming no host, address or user has nothing to look up", () => {
    expect(model.getConnectedSignalsState(connections())).toBe(
      "nothing-to-look-up",
    );
  });

  test("exact records first, the possible ones in a group of their own, each in the server's order", () => {
    const exactA: SecurityConnectedResourceJson = connectedRecord(
      SecurityConnectionCertainty.Exact,
      HOST_ID,
    );
    const exactB: SecurityConnectedResourceJson = connectedRecord(
      SecurityConnectionCertainty.Exact,
      CLUSTER_ID,
    );
    const possibleA: SecurityConnectedResourceJson = connectedRecord(
      SecurityConnectionCertainty.Possible,
      DEVICE_ID,
    );
    const possibleB: SecurityConnectedResourceJson = connectedRecord(
      SecurityConnectionCertainty.Possible,
      ITEM_ID,
    );

    expect(
      model.getConnectedSignalsGroups({
        resources: [exactA, possibleA, exactB, possibleB],
      }),
    ).toEqual({ exact: [exactA, exactB], possible: [possibleA, possibleB] });
    expect(model.getConnectedSignalsGroups({ resources: [] })).toEqual({
      exact: [],
      possible: [],
    });
  });
});

describe("reading a record's and an incident's Security", () => {
  test("a record's: what it was searched for, its counts, its open cases and its risk", () => {
    const security: ResourceSecurityJson = model.parseResourceSecurity({
      kind: SecurityConnectionKind.Host,
      id: HOST_ID,
      name: "web-1",
      isInUse: true,
      windowDays: 7,
      values: ["web-1", "", 7, "203.0.113.9"],
      entity: { type: "Host", value: "web-1" },
      eventCount: 12,
      findingCount: 2,
      maxSeverityId: 4,
      lastSeen: "2026-10-25T10:00:00.000Z",
      openCases: {
        count: 4,
        items: [
          {
            id: "c-1",
            number: "SEC-1",
            title: "Brute force",
            priorityName: "High",
          },
          { number: "no id" },
        ],
      },
      risk: { score: 64, entityValue: "web-1", entityType: "Host" },
    } as unknown as JSONObject);

    expect(security).toMatchObject({
      kind: SecurityConnectionKind.Host,
      isInUse: true,
      values: ["web-1", "203.0.113.9"],
      entity: { type: SecurityEntityType.Host, value: "web-1" },
      eventCount: 12,
      openCases: {
        count: 4,
        items: [
          {
            id: "c-1",
            number: "SEC-1",
            title: "Brute force",
            priorityName: "High",
          },
        ],
      },
      risk: { score: 64, entityValue: "web-1", entityType: "Host" },
    });
    expect(model.hasResourceSecurityNews(security)).toBe(true);
  });

  test("cases the reader cannot read are not known; no risk is none; a quiet record has no news", () => {
    const security: ResourceSecurityJson = model.parseResourceSecurity({
      kind: SecurityConnectionKind.Service,
      id: SERVICE_ID,
      isInUse: true,
      openCases: null,
      risk: { score: 0 },
    });

    expect(security.openCases).toBeNull();
    expect(security.risk).toBeNull();
    expect(security.windowDays).toBe(7);
    expect(security.lastSeen).toBeNull();
    expect(model.hasResourceSecurityNews(security)).toBe(false);
    expect(
      model.hasResourceSecurityNews({
        ...security,
        openCases: { count: 1, items: [] },
      }),
    ).toBe(true);
  });

  test("an incident's: the cases that declared it, and the open ones naming what it affects", () => {
    const security: IncidentSecurityJson = model.parseIncidentSecurity({
      declaredBy: [{ id: "c-1", number: "SEC-1", title: "Brute force" }],
      namingItsResources: [
        {
          id: "c-2",
          number: "SEC-2",
          title: "Cryptominer",
          resources: [
            { kind: SecurityConnectionKind.Host, id: HOST_ID, name: "web-1" },
            { kind: "Planet", id: HOST_ID, name: "mars" },
            { kind: SecurityConnectionKind.Host, name: "no id" },
          ],
        },
        { title: "no id" },
      ],
      namingItsResourcesCount: 5,
    } as unknown as JSONObject);

    expect(security).toEqual({
      declaredBy: [{ id: "c-1", number: "SEC-1", title: "Brute force" }],
      namingItsResources: [
        {
          id: "c-2",
          number: "SEC-2",
          title: "Cryptominer",
          resources: [
            { kind: SecurityConnectionKind.Host, id: HOST_ID, name: "web-1" },
          ],
        },
      ],
      namingItsResourcesCount: 5,
    });
  });
});

describe("what one security event names", () => {
  test("its typed columns, typed by their column, then its observables; never a process", () => {
    expect(
      model.getSecurityEventEntities({
        principalUser: "kim@acme.example",
        principalIp: " 203.0.113.9 ",
        targetHost: "web-1",
        processName: "sshd",
        observables: ["web-1", "198.51.100.4"],
      }),
    ).toEqual([
      { type: SecurityEntityType.User, value: "kim@acme.example" },
      { type: SecurityEntityType.Host, value: "web-1" },
      { type: SecurityEntityType.IpAddress, value: "203.0.113.9" },
      { type: SecurityEntityType.IpAddress, value: "198.51.100.4" },
    ]);
  });
});

describe("where a connection's links go", () => {
  test("each record's own page", () => {
    expect(
      open(model.getConnectedRecordRoute(SecurityConnectionKind.Host, HOST_ID))
        .path,
    ).toBe(`${BASE}/host/${HOST_ID}`);
    expect(
      open(
        model.getConnectedRecordRoute(
          SecurityConnectionKind.KubernetesCluster,
          CLUSTER_ID,
        ),
      ).path,
    ).toBe(`${BASE}/kubernetes/${CLUSTER_ID}`);
    expect(
      open(
        model.getConnectedRecordRoute(
          SecurityConnectionKind.Service,
          SERVICE_ID,
        ),
      ).path,
    ).toBe(`${BASE}/service/${SERVICE_ID}`);
    expect(
      open(model.getConnectedRecordRoute(SecurityConnectionKind.User, USER_ID))
        .path,
    ).toBe(`${BASE}/users/${USER_ID}`);
    // An id that is not one links nowhere.
    expect(
      model.getConnectedRecordRoute(SecurityConnectionKind.Host, "web-1"),
    ).toBeNull();
  });

  test("a host's logs and traces filtered to it and pinned to the window, its metrics over it, its topology", () => {
    const links: Record<
      string,
      { path: string; query: Record<string, string> }
    > = linksOf(SecurityConnectionKind.Host, HOST_ID);

    expect(Object.keys(links)).toEqual([
      "logs",
      "traces",
      "metrics",
      "topology",
    ]);
    expect(links["logs"]!.path).toBe(`${BASE}/logs`);
    expect(JSON.parse(links["logs"]!.query["filters"]!)).toEqual([
      ["hostId", [HOST_ID]],
    ]);
    expect(links["logs"]!.query["range"]).toBe("Custom");
    expect(new Date(links["logs"]!.query["start"]!).toISOString()).toBe(
      WINDOW_START,
    );
    expect(new Date(links["logs"]!.query["end"]!).toISOString()).toBe(
      WINDOW_END,
    );
    expect(links["traces"]!.path).toBe(`${BASE}/traces`);
    expect(links["metrics"]!.path).toBe(`${BASE}/host/${HOST_ID}/metrics`);
    expect(links["metrics"]!.query["range"]).toBe("Custom");
    expect(links["topology"]!.path).toBe(`${BASE}/host/${HOST_ID}/topology`);
  });

  test("a service's by its id, and its exceptions", () => {
    const links: Record<
      string,
      { path: string; query: Record<string, string> }
    > = linksOf(SecurityConnectionKind.Service, SERVICE_ID);

    expect(Object.keys(links)).toEqual([
      "logs",
      "traces",
      "metrics",
      "exceptions",
    ]);
    expect(JSON.parse(links["logs"]!.query["filters"]!)).toEqual([
      ["primaryEntityId", [SERVICE_ID]],
    ]);
    expect(JSON.parse(links["exceptions"]!.query["filters"]!)).toEqual([
      ["primaryEntityId", SERVICE_ID],
    ]);
    expect(links["exceptions"]!.query["status"]).toBe("all");
  });

  test("a cluster's events; a device's own logs page; a user's page is the link", () => {
    expect(
      Object.keys(
        linksOf(SecurityConnectionKind.KubernetesCluster, CLUSTER_ID),
      ),
    ).toEqual(["logs", "traces", "metrics", "events", "topology"]);
    expect(
      JSON.parse(
        linksOf(SecurityConnectionKind.KubernetesCluster, CLUSTER_ID)["logs"]!
          .query["filters"]!,
      ),
    ).toEqual([["kubernetesClusterId", [CLUSTER_ID]]]);

    const device: Record<
      string,
      { path: string; query: Record<string, string> }
    > = linksOf(SecurityConnectionKind.NetworkDevice, DEVICE_ID);

    expect(Object.keys(device)).toEqual(["logs", "metrics"]);
    expect(device["logs"]!.path).toBe(
      `${BASE}/network-devices/${DEVICE_ID}/logs`,
    );
    expect(linksOf(SecurityConnectionKind.User, USER_ID)).toEqual({});
  });

  test("its inventory item, when Inventory has one", () => {
    expect(
      linksOf(SecurityConnectionKind.Host, HOST_ID, ITEM_ID)["inventory"]!.path,
    ).toBe(`${BASE}/inventory/item/${ITEM_ID}`);
  });

  test("a window it cannot read leaves the links open on their own range", () => {
    const [logs] = model.getSignalLinks({
      resource: resource(SecurityConnectionKind.Host, HOST_ID),
      windowStart: WINDOW_END,
      windowEnd: WINDOW_START,
    });

    expect(open(logs!.route).query["range"]).toBeUndefined();
    expect(
      model.getSignalLinks({
        resource: resource(SecurityConnectionKind.Host, "web-1"),
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      }),
    ).toEqual([]);
  });

  test("Security Events on the events naming a record over the card's week", () => {
    const now: Date = new Date("2026-10-25T12:00:00.000Z");
    const host: { path: string; query: Record<string, string> } = open(
      model.getRecordSecurityEventsRoute({
        security: {
          kind: SecurityConnectionKind.Host,
          id: HOST_ID,
          values: ["web-1", "203.0.113.9"],
          windowDays: 7,
        },
        now,
      }),
    );

    expect(host.path).toBe(`${BASE}/security-events`);
    expect(decodeURIComponent(host.query["search"]!)).toBe(
      "observable:(web-1 OR 203.0.113.9)",
    );

    const one: { path: string; query: Record<string, string> } = open(
      model.getRecordSecurityEventsRoute({
        security: {
          kind: SecurityConnectionKind.User,
          id: USER_ID,
          values: ["kim@acme.example"],
          windowDays: 7,
        },
        now,
      }),
    );

    expect(decodeURIComponent(one.query["search"]!)).toBe(
      "observable:kim@acme.example",
    );

    // A service's: the events read from its logs.
    const service: { path: string; query: Record<string, string> } = open(
      model.getRecordSecurityEventsRoute({
        security: {
          kind: SecurityConnectionKind.Service,
          id: SERVICE_ID,
          values: [],
          windowDays: 7,
        },
        now,
      }),
    );

    expect(decodeURIComponent(service.query["search"]!)).toBe(
      `@${SECURITY_LOG_RESOURCE_ID_ATTRIBUTE}:${SERVICE_ID}`,
    );

    // Nothing to search for opens nothing.
    expect(
      model.getRecordSecurityEventsRoute({
        security: {
          kind: SecurityConnectionKind.Host,
          id: HOST_ID,
          values: [],
          windowDays: 7,
        },
        now,
      }),
    ).toBeNull();
  });

  test("an incident, an alert, a monitor and a case each open their own page", () => {
    expect(open(model.getIncidentRoute(HOST_ID)).path).toBe(
      `${BASE}/incidents/${HOST_ID}`,
    );
    expect(open(model.getAlertRoute(HOST_ID)).path).toBe(
      `${BASE}/alerts/${HOST_ID}`,
    );
    expect(open(model.getMonitorRoute(HOST_ID)).path).toBe(
      `${BASE}/monitors/${HOST_ID}`,
    );
    expect(open(model.getSecurityCaseRoute(HOST_ID)).path).toBe(
      `${BASE}/security-events/cases/${HOST_ID}`,
    );
    expect(model.getIncidentRoute("INC-7")).toBeNull();
  });
});
