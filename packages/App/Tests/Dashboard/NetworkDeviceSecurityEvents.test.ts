import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import Route from "Common/Types/API/Route";
import { JSONObject } from "Common/Types/JSON";
import {
  ResourceSecurityScopeJson,
  SecurityConnectionKind,
} from "Common/Types/SecurityCase/SecurityConnection";
import { SECURITY_EVENT_SCOPE_QUERY_KEY } from "Common/Types/SecurityEvent/SecurityEventScope";
import { ActiveFilter } from "Common/UI/Components/TelemetryViewer/types";
import {
  DEVICE_SECURITY_EVENTS_CHIP_KEY,
  DEVICE_SECURITY_EVENTS_NAMING_LABEL,
  DEVICE_SECURITY_EVENTS_NO_SEARCH_REASON,
  DEVICE_SECURITY_EVENTS_OWN_LOGS_LABEL,
  DEVICE_SECURITY_EVENTS_SCOPE_SUMMARY,
  getDeviceSecurityEventsChip,
  isDeviceSecurityEventsScopeReadable,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceSecurityEventsScope";

/*
 * A NETWORK DEVICE'S SECURITY EVENTS PAGE (issue #5769).
 *
 * A customer investigating a router had to leave it for Security Events
 * and search there. Now every device has a Security Events page of its
 * own, beside its Logs: the Security Events explorer on the events about
 * the device - read from the syslog it sends the probe, or naming it from
 * any other source - the ones its Security card on Overview counts, whose
 * count opens it.
 *
 * Pinned here without rendering: how the page's answer is read, where the
 * card's count goes, the locked chip, and the page's wiring into the
 * device's routes, layout, breadcrumbs and menu (App's node environment
 * cannot render the pages; Common/Tests/App/Dashboard renders them).
 */

type Model =
  typeof import("../../FeatureSet/Dashboard/src/Components/SecurityConnections/SecurityConnectionsModel");

let model: Model;

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const DEVICE_ID: string = "55555555-5555-4555-8555-555555555555";
const HOST_ID: string = "22222222-2222-4222-8222-222222222222";
const BASE: string = `/dashboard/${PROJECT_ID}`;

beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: {
      pathname: `${BASE}/network-devices/${DEVICE_ID}`,
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

function deviceScope(
  overrides: Partial<ResourceSecurityScopeJson> = {},
): ResourceSecurityScopeJson {
  return {
    kind: SecurityConnectionKind.NetworkDevice,
    id: DEVICE_ID,
    name: "HQ Firewall",
    values: ["hq firewall", "fw.hq.example", "203.0.113.7"],
    isSearchedByLogs: false,
    scope: {
      observables: [
        "hq firewall",
        "HQ FIREWALL",
        "fw.hq.example",
        "FW.HQ.EXAMPLE",
        "203.0.113.7",
      ],
      attributeKey: "networkDevice.id",
      attributeValues: [DEVICE_ID],
    },
    ...overrides,
  };
}

describe("reading what a device's page reads under", () => {
  test("the scope, the device's name and its identities, as the server said them", () => {
    expect(
      model.parseResourceSecurityScope(deviceScope() as unknown as JSONObject),
    ).toEqual(deviceScope());
  });

  test("a scope is read as the server compiles it: bounded strings, an attribute only with values", () => {
    const parsed: ResourceSecurityScopeJson = model.parseResourceSecurityScope({
      kind: SecurityConnectionKind.NetworkDevice,
      id: DEVICE_ID,
      name: "HQ Firewall",
      values: ["hq firewall", 7, "", null],
      isSearchedByLogs: "yes",
      scope: {
        observables: [" hq firewall ", 9, "hq firewall"],
        attributeKey: "networkDevice.id",
        attributeValues: [],
      },
    } as unknown as JSONObject);

    expect(parsed.values).toEqual(["hq firewall"]);
    expect(parsed.isSearchedByLogs).toBe(false);
    expect(parsed.scope).toEqual({ observables: ["hq firewall"] });
  });

  test("an answer with no scope is a scope that matches nothing - never every event", () => {
    const parsed: ResourceSecurityScopeJson = model.parseResourceSecurityScope({
      kind: SecurityConnectionKind.NetworkDevice,
      id: DEVICE_ID,
    } as JSONObject);

    expect(parsed.scope).toEqual({ observables: [] });
    expect(parsed.name).toBe("");
    expect(parsed.values).toEqual([]);
    expect(isDeviceSecurityEventsScopeReadable(parsed)).toBe(false);
  });

  test("an unknown kind reads as a host's, as the Security card's answer does", () => {
    expect(
      model.parseResourceSecurityScope({
        kind: "Spaceship",
        id: DEVICE_ID,
      } as JSONObject).kind,
    ).toBe(SecurityConnectionKind.Host);
  });
});

describe("the Security card's count on a device opens the device's own page", () => {
  const now: Date = new Date("2026-10-25T12:00:00.000Z");

  test("over the card's week, on the device's Security Events page", () => {
    const route: { path: string; query: Record<string, string> } = open(
      model.getRecordSecurityEventsRoute({
        security: {
          kind: SecurityConnectionKind.NetworkDevice,
          id: DEVICE_ID,
          values: ["hq firewall"],
          windowDays: 7,
          isSearchedByLogs: false,
        },
        now,
      }),
    );

    expect(route.path).toBe(
      `${BASE}/network-devices/${DEVICE_ID}/security-events`,
    );
    expect(route.query["range"]).toBe("Custom");
    expect(new Date(route.query["start"]!).toISOString()).toBe(
      "2026-10-18T12:00:00.000Z",
    );
    expect(new Date(route.query["end"]!).toISOString()).toBe(now.toISOString());
    // The page carries its own scope: no search to spell it.
    expect(route.query["search"]).toBeUndefined();
  });

  test("even a device with nothing to name: its own logs are still its own", () => {
    expect(
      open(
        model.getRecordSecurityEventsRoute({
          security: {
            kind: SecurityConnectionKind.NetworkDevice,
            id: DEVICE_ID,
            values: [],
            windowDays: 7,
            isSearchedByLogs: false,
          },
          now,
        }),
      ).path,
    ).toBe(`${BASE}/network-devices/${DEVICE_ID}/security-events`);
  });

  test("a device id that is not one opens nothing", () => {
    expect(
      model.getRecordSecurityEventsRoute({
        security: {
          kind: SecurityConnectionKind.NetworkDevice,
          id: "router-1",
          values: ["router-1"],
          windowDays: 7,
          isSearchedByLogs: false,
        },
        now,
      }),
    ).toBeNull();
  });

  test("only a device has a page of its own: a host still opens the Events explorer", () => {
    expect(Object.keys(model.RECORD_SECURITY_EVENTS_PAGES)).toEqual([
      SecurityConnectionKind.NetworkDevice,
    ]);

    const host: { path: string; query: Record<string, string> } = open(
      model.getRecordSecurityEventsRoute({
        security: {
          kind: SecurityConnectionKind.Host,
          id: HOST_ID,
          values: ["web-1"],
          windowDays: 7,
          isSearchedByLogs: false,
        },
        now,
      }),
    );

    expect(host.path).toBe(`${BASE}/security-events`);
    expect(decodeURIComponent(host.query["search"]!)).toBe("observable:web-1");
  });
});

describe("the page's locked chip", () => {
  test("names the device, and cannot be taken off", () => {
    const chip: ActiveFilter = getDeviceSecurityEventsChip(deviceScope());

    expect(chip).toMatchObject({
      facetKey: SECURITY_EVENT_SCOPE_QUERY_KEY,
      value: DEVICE_ID,
      displayKey: DEVICE_SECURITY_EVENTS_CHIP_KEY,
      displayValue: "HQ Firewall",
      readOnly: true,
    });
    expect(DEVICE_SECURITY_EVENTS_CHIP_KEY).toBe("Network Device");
  });

  test("its tooltip says both ways an event is the device's: its own logs, and naming it", () => {
    const chip: ActiveFilter = getDeviceSecurityEventsChip(deviceScope());

    expect(chip.lockedDetail?.scopeSummary).toBe(
      DEVICE_SECURITY_EVENTS_SCOPE_SUMMARY,
    );
    expect(chip.lockedDetail?.scopeMatches).toEqual([
      expect.objectContaining({
        label: DEVICE_SECURITY_EVENTS_OWN_LOGS_LABEL,
        values: ["HQ Firewall"],
      }),
      expect.objectContaining({
        label: DEVICE_SECURITY_EVENTS_NAMING_LABEL,
        values: ["hq firewall", "fw.hq.example", "203.0.113.7"],
      }),
    ]);
    // There is no search to copy: the Events search cannot spell the OR.
    expect(chip.lockedDetail?.searchToken).toBeUndefined();
    expect(chip.lockedDetail?.searchTokenUnavailableReason).toBe(
      DEVICE_SECURITY_EVENTS_NO_SEARCH_REASON,
    );
  });

  test("a device with nothing to name lists its own logs alone", () => {
    const chip: ActiveFilter = getDeviceSecurityEventsChip(
      deviceScope({
        values: [],
        scope: {
          observables: [],
          attributeKey: "networkDevice.id",
          attributeValues: [DEVICE_ID],
        },
      }),
    );

    expect(chip.lockedDetail?.scopeMatches).toEqual([
      expect.objectContaining({ label: DEVICE_SECURITY_EVENTS_OWN_LOGS_LABEL }),
    ]);
  });

  test("a device with no name is named by its id", () => {
    expect(
      getDeviceSecurityEventsChip(deviceScope({ name: "  " })).displayValue,
    ).toBe(DEVICE_ID);
  });

  test("a scope with something to match is readable; one with nothing is not", () => {
    expect(isDeviceSecurityEventsScopeReadable(deviceScope())).toBe(true);
    expect(
      isDeviceSecurityEventsScopeReadable(
        deviceScope({ scope: { observables: [] } }),
      ),
    ).toBe(false);
  });
});

/*
 * THE WIRING, read from the source, comments stripped and whitespace
 * squashed, as NetworkDeviceActivityWiring reads the Incidents and Alerts
 * tabs'.
 */
const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const WHITESPACE: RegExp = /\s+/g;

function readCode(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1")
    .replace(WHITESPACE, " ");
}

// The route map holds `/*`, which a comment stripper misreads: read whole.
function readWhole(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(WHITESPACE, " ");
}

describe("the page's wiring", () => {
  const PAGE: string = "NETWORK_DEVICE_VIEW_SECURITY_EVENTS";

  test("is a page of the device at :id/security-events", () => {
    expect(readCode("Utils/PageMap.ts")).toContain(`${PAGE} = "${PAGE}",`);
    expect(readCode("Utils/RouteMap.ts")).toContain(
      `[PageMap.${PAGE}]: \`\${RouteParams.ModelID}/security-events\`,`,
    );
    expect(readWhole("Utils/RouteMap.ts")).toContain(
      `[PageMap.${PAGE}]: new Route( \`/dashboard/\${RouteParams.ProjectID}/network-devices/\${ NetworkDeviceRoutePath[PageMap.${PAGE}] }\`, ),`,
    );
  });

  test("is routed to its page, in the device's own layout", () => {
    const routes: string = readCode("Routes/NetworkDeviceRoutes.tsx");

    expect(routes).toContain(
      `path={RouteUtil.getLastPathForKey( PageMap.${PAGE}, )} element={ <NetworkDeviceSecurityEvents {...props} pageRoute={ RouteMap[PageMap.${PAGE}] as Route } /> }`,
    );
    expect(routes).toMatch(
      /NetworkDeviceSecurityEvents[^;]*from "\.\.\/Pages\/NetworkDevice\/View\/SecurityEvents"/,
    );
    expect(readCode("Pages/Network/Layout.tsx")).toContain(`PageMap.${PAGE},`);
  });

  test("its breadcrumbs end in Security Events, under the device", () => {
    expect(readCode("Pages/NetworkDevice/Utils/Breadcrumbs.ts")).toContain(
      `BuildBreadcrumbLinksByTitles( PageMap.${PAGE}, ["Project", "Network", "View Device", "Security Events"], )`,
    );
  });

  test("the device's menu lists it right after Logs", () => {
    const menu: string = readCode("Pages/NetworkDevice/View/SideMenu.tsx");
    const logs: number = menu.indexOf('title: "Logs"');
    const security: number = menu.indexOf('title: "Security Events"');
    const monitors: number = menu.indexOf('title: "Monitors"');

    expect(logs).toBeGreaterThan(-1);
    expect(security).toBeGreaterThan(logs);
    expect(monitors).toBeGreaterThan(security);
    expect(menu).toContain(`RouteMap[PageMap.${PAGE}] as Route`);
  });

  test("the page reads the device's scope from the server, and hands it to the explorer", () => {
    const page: string = readCode(
      "Pages/NetworkDevice/View/SecurityEvents.tsx",
    );

    expect(page).toContain("SecurityCaseApi.getResourceSecurityScope({");
    expect(page).toContain("kind: SecurityConnectionKind.NetworkDevice");
    expect(page).toContain("<SecurityEventsViewer");
    expect(page).toContain("scope={viewerScope}");
  });

  test("the scope is asked of its own route, as the Security card's answer is", () => {
    expect(readCode("Components/SecurityCase/SecurityCaseApi.ts")).toContain(
      'post("/security-case/resource-security-scope", {',
    );
  });
});

describe("the page's words are keys of every locale", () => {
  const LOCALES: string = path.join(DASHBOARD_SRC, "Locales");
  const KEYS: Array<string> = [
    DEVICE_SECURITY_EVENTS_SCOPE_SUMMARY,
    DEVICE_SECURITY_EVENTS_OWN_LOGS_LABEL,
    DEVICE_SECURITY_EVENTS_NAMING_LABEL,
    DEVICE_SECURITY_EVENTS_NO_SEARCH_REASON,
    "No security events for this device yet",
    "Send this device's syslog to a probe. Its {{logs}} page says how.",
    "Turn on Your logs, on the Security Events {{connections}} page.",
    "Read in a device's syslog: {{formats}}.",
    "Network Device",
    "Security Events",
  ];

  test.each(
    fs
      .readdirSync(LOCALES)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      })
      .sort(),
  )("%s", (file: string) => {
    const locale: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(LOCALES, file), "utf8"),
    ) as Record<string, unknown>;

    for (const key of KEYS) {
      expect(Object.prototype.hasOwnProperty.call(locale, key)).toBe(true);
    }
  });
});
