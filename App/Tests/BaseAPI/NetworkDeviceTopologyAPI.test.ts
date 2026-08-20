import { mockRouter } from "Common/Tests/Server/API/Helpers";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import NetworkInterfaceService from "Common/Server/Services/NetworkInterfaceService";
import NetworkEndpointService from "Common/Server/Services/NetworkEndpointService";
import NetworkDeviceLinkService from "Common/Server/Services/NetworkDeviceLinkService";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import NetworkDeviceLinkRuleService from "Common/Server/Services/NetworkDeviceLinkRuleService";
import NetworkTopologySuppressionService from "Common/Server/Services/NetworkTopologySuppressionService";
import CommonAPI from "Common/Server/API/CommonAPI";
import Response from "Common/Server/Utils/Response";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkInterface from "Common/Models/DatabaseModels/NetworkInterface";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
    },
  };
});

jest.mock("Common/Server/API/CommonAPI", () => {
  return {
    __esModule: true,
    default: {
      getDatabaseCommonInteractionProps: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/NetworkInterfaceService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/NetworkEndpointService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/NetworkDeviceLinkService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/MonitorStatusService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/NetworkDeviceLinkRuleService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/NetworkTopologySuppressionService", () => {
  return {
    __esModule: true,
    default: { getSuppressedNodeKeys: jest.fn() },
  };
});

/*
 * Importing the API module registers its route on the mocked router so the
 * handler can be invoked directly, with every service call observable.
 */
import NetworkDeviceTopologyAPI from "../../FeatureSet/BaseAPI/API/NetworkDeviceTopology";

new NetworkDeviceTopologyAPI().getRouter();

const projectId: ObjectID = ObjectID.generate();

const commonAPI: { getDatabaseCommonInteractionProps: jest.Mock } =
  CommonAPI as unknown as { getDatabaseCommonInteractionProps: jest.Mock };
const deviceService: { findBy: jest.Mock } =
  NetworkDeviceService as unknown as { findBy: jest.Mock };
const interfaceService: { findBy: jest.Mock } =
  NetworkInterfaceService as unknown as { findBy: jest.Mock };
const endpointService: { findBy: jest.Mock } =
  NetworkEndpointService as unknown as { findBy: jest.Mock };
const deviceLinkService: { findBy: jest.Mock } =
  NetworkDeviceLinkService as unknown as { findBy: jest.Mock };
const monitorStatusService: { findBy: jest.Mock } =
  MonitorStatusService as unknown as { findBy: jest.Mock };
const linkRuleService: { findBy: jest.Mock } =
  NetworkDeviceLinkRuleService as unknown as { findBy: jest.Mock };
const suppressionService: { getSuppressedNodeKeys: jest.Mock } =
  NetworkTopologySuppressionService as unknown as {
    getSuppressedNodeKeys: jest.Mock;
  };
const responseUtil: { sendJsonObjectResponse: jest.Mock } =
  Response as unknown as { sendJsonObjectResponse: jest.Mock };

const mockResponse: ExpressResponse = {} as ExpressResponse;

type CallTopologyFunction = (body: JSONObject) => Promise<NextFunction>;

const callTopology: CallTopologyFunction = async (
  body: JSONObject,
): Promise<NextFunction> => {
  const next: NextFunction = jest.fn() as unknown as NextFunction;
  const req: ExpressRequest = { body: body } as unknown as ExpressRequest;
  await mockRouter
    .match("post", "/network-device/topology")
    .handlerFunction(req, mockResponse, next);
  return next;
};

function makeDevice(name: string): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice(ObjectID.generate());
  device.name = name;
  return device;
}

function makeInterface(deviceId: ObjectID, index: number): NetworkInterface {
  const row: NetworkInterface = new NetworkInterface(ObjectID.generate());
  row.networkDeviceId = deviceId;
  row.interfaceIndex = index;
  row.name = `Gi0/${index}`;
  row.isOperationallyUp = true;
  return row;
}

function lastInterfaceQuery(): JSONObject {
  return interfaceService.findBy.mock.calls[0]![0] as JSONObject;
}

function lastResponseBody(): JSONObject {
  expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  return responseUtil.sendJsonObjectResponse.mock.calls[0]![2] as JSONObject;
}

/*
 * QueryHelper.any() compiles to a TypeORM Raw operator whose object-literal
 * parameters carry the id list; this digs the list back out so a test can
 * pin exactly which device ids the query was scoped to.
 */
function idsInAnyOperator(operator: unknown): Array<string> {
  const parameters: JSONObject = (operator as JSONObject)[
    "objectLiteralParameters"
  ] as JSONObject;
  return Object.values(parameters)[0] as Array<string>;
}

describe("POST /network-device/topology", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue({
      tenantId: projectId,
    } as never);
    deviceService.findBy.mockResolvedValue([] as never);
    interfaceService.findBy.mockResolvedValue([] as never);
    endpointService.findBy.mockResolvedValue([] as never);
    deviceLinkService.findBy.mockResolvedValue([] as never);
    monitorStatusService.findBy.mockResolvedValue([] as never);
    linkRuleService.findBy.mockResolvedValue([] as never);
    suppressionService.getSuppressedNodeKeys.mockResolvedValue(
      new Set<string>() as never,
    );
  });

  /*
   * Regression: the interface query used to be project-wide with a 10,000
   * row cap, so a site-scoped request could spend the whole cap on devices
   * that are not on the map and come back with none of its own interfaces —
   * every edge rendering with no up/down state, port name or utilization.
   */
  test("scopes the interface query to the devices actually in the graph", async () => {
    const siteId: ObjectID = ObjectID.generate();
    const deviceA: NetworkDevice = makeDevice("store-sw1");
    const deviceB: NetworkDevice = makeDevice("store-sw2");
    deviceService.findBy.mockResolvedValue([deviceA, deviceB] as never);

    const next: NextFunction = await callTopology({
      siteId: siteId.toString(),
    });
    expect(next).not.toHaveBeenCalled();

    // The device query is site-scoped...
    const deviceQuery: JSONObject = (
      deviceService.findBy.mock.calls[0]![0] as JSONObject
    )["query"] as JSONObject;
    expect((deviceQuery["siteId"] as ObjectID).toString()).toBe(
      siteId.toString(),
    );

    // ...and the interface query follows it, rather than staying project-wide.
    const interfaceQuery: JSONObject = lastInterfaceQuery()[
      "query"
    ] as JSONObject;
    expect((interfaceQuery["projectId"] as ObjectID).toString()).toBe(
      projectId.toString(),
    );
    expect(idsInAnyOperator(interfaceQuery["networkDeviceId"])).toEqual([
      deviceA.id!.toString(),
      deviceB.id!.toString(),
    ]);
  });

  test("skips the interface query entirely when the graph has no devices", async () => {
    deviceService.findBy.mockResolvedValue([] as never);

    await callTopology({});

    expect(interfaceService.findBy).not.toHaveBeenCalled();
    expect(endpointService.findBy).not.toHaveBeenCalled();
  });

  test("enriches nodes with the interface rows the scoped query returned", async () => {
    const device: NetworkDevice = makeDevice("store-sw1");
    deviceService.findBy.mockResolvedValue([device] as never);
    interfaceService.findBy.mockResolvedValue([
      makeInterface(device.id!, 1),
    ] as never);

    await callTopology({ siteId: ObjectID.generate().toString() });

    const body: JSONObject = lastResponseBody();
    expect((body["nodes"] as Array<JSONObject>).length).toBe(1);
    expect((body["nodes"] as Array<JSONObject>)[0]!["name"]).toBe("store-sw1");
  });

  /*
   * isTruncated drives a "only part of it is shown, use search to narrow it
   * down" banner — a statement about missing DEVICES. Interface-cap loss
   * leaves every node and edge present and search cannot fix it, so it must
   * not raise that flag.
   */
  test("a full interface page does not set isTruncated, it sets interfacesTruncated", async () => {
    const device: NetworkDevice = makeDevice("core-sw1");
    deviceService.findBy.mockResolvedValue([device] as never);

    const rows: Array<NetworkInterface> = [];
    for (let index: number = 0; index < LIMIT_PER_PROJECT; index++) {
      rows.push(makeInterface(device.id!, index));
    }
    interfaceService.findBy.mockResolvedValue(rows as never);

    await callTopology({ siteId: ObjectID.generate().toString() });

    const body: JSONObject = lastResponseBody();
    expect(body["isTruncated"]).toBe(false);
    expect(body["interfacesTruncated"]).toBe(true);
  });

  test("a full device page sets isTruncated and leaves interfacesTruncated false", async () => {
    const devices: Array<NetworkDevice> = [];
    for (let index: number = 0; index < LIMIT_PER_PROJECT; index++) {
      devices.push(makeDevice(`sw-${index}`));
    }
    deviceService.findBy.mockResolvedValue(devices as never);
    interfaceService.findBy.mockResolvedValue([] as never);

    await callTopology({});

    const body: JSONObject = lastResponseBody();
    expect(body["isTruncated"]).toBe(true);
    expect(body["interfacesTruncated"]).toBe(false);
  });

  test("neither flag is set for a small graph", async () => {
    deviceService.findBy.mockResolvedValue([makeDevice("sw1")] as never);

    await callTopology({});

    const body: JSONObject = lastResponseBody();
    expect(body["isTruncated"]).toBe(false);
    expect(body["interfacesTruncated"]).toBe(false);
  });
});

/*
 * --- Site-scoped link rules (issue #3260) ---
 *
 * A link rule links every device carrying ALL the child labels to the SINGLE
 * device carrying ALL the parent labels. "Single" needs a universe to be
 * single in, and until the `scope` column existed that universe was whatever
 * the topology query happened to return. On the global map — every site at
 * once — fourteen units' routers all carried `SubCategory:Router`, the rule
 * reported `ambiguousParent`, and EVERY rule-derived uplink disappeared,
 * including the thirteen that were never ambiguous.
 *
 * These tests exercise the whole endpoint rather than the resolver, because
 * the parts that actually broke live at this seam: the columns the device
 * query asks for, and the fact that rule links reach the client as edges of
 * the built topology rather than as a list of their own.
 */

import Label from "Common/Models/DatabaseModels/Label";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkDeviceLinkRule from "Common/Models/DatabaseModels/NetworkDeviceLinkRule";
import NetworkDeviceLinkRuleUtil from "Common/Utils/Monitor/NetworkDeviceLinkRuleUtil";

function makeLabel(): Label {
  return new Label(ObjectID.generate());
}

function makeSite(name: string): NetworkSite {
  const site: NetworkSite = new NetworkSite(ObjectID.generate());
  site.name = name;
  return site;
}

/*
 * A device that knows where it lives. Both halves matter and they come from
 * the same row: siteId is what the resolver groups on, and site.name is the
 * only thing a warning has to call a site by — reading the name off the
 * device row rather than a separate site query is what keeps a viewer from
 * being told the name of a site they cannot read.
 *
 * Passing `null` for the site leaves siteId genuinely undefined, which is the
 * state a device has before anyone has assigned it.
 */
function makeSitedDevice(
  name: string,
  site: NetworkSite | null,
  labels: Array<Label>,
): NetworkDevice {
  const device: NetworkDevice = makeDevice(name);
  if (site) {
    device.siteId = site.id!;
    device.site = site;
  }
  device.labels = labels;
  return device;
}

function makeLinkRule(
  name: string,
  childLabels: Array<Label>,
  parentLabels: Array<Label>,
  scope: string | undefined,
): NetworkDeviceLinkRule {
  const rule: NetworkDeviceLinkRule = new NetworkDeviceLinkRule(
    ObjectID.generate(),
  );
  rule.name = name;
  rule.isEnabled = true;
  rule.childDeviceLabels = childLabels;
  rule.parentDeviceLabels = parentLabels;
  /*
   * Left unset rather than set to "Project" for the project-scope cases: an
   * absent column is what every rule written before #3260 actually holds, and
   * that NULL reading as Project is the compatibility promise being pinned.
   */
  if (scope !== undefined) {
    rule.scope = scope;
  }
  return rule;
}

interface SiteStar {
  site: NetworkSite;
  router: NetworkDevice;
  switches: Array<NetworkDevice>;
}

/*
 * One site's worth of the shape the issue is about: a single router carrying
 * the parent label and some switches carrying the child label, all in the
 * same site.
 */
function makeSiteStar(
  siteName: string,
  switchCount: number,
  routerLabel: Label,
  switchLabel: Label,
): SiteStar {
  const site: NetworkSite = makeSite(siteName);
  const switches: Array<NetworkDevice> = [];
  for (let index: number = 0; index < switchCount; index++) {
    switches.push(
      makeSitedDevice(`${siteName}-sw${index}`, site, [switchLabel]),
    );
  }
  return {
    site: site,
    router: makeSitedDevice(`${siteName}-rtr`, site, [routerLabel]),
    switches: switches,
  };
}

function devicesOf(stars: Array<SiteStar>): Array<NetworkDevice> {
  const devices: Array<NetworkDevice> = [];
  for (const star of stars) {
    devices.push(star.router);
    devices.push(...star.switches);
  }
  return devices;
}

interface Issue3260Fixture {
  devices: Array<NetworkDevice>;
  // The thirteen units whose router is unmistakable.
  healthy: Array<SiteStar>;
  // Unit 14, the one with two routers.
  broken: SiteStar;
}

/*
 * The reported topology, rebuilt: fourteen units, each with one router
 * carrying `SubCategory:Router` and one switch carrying the child label —
 * except Unit 14, which has a second router. Thirteen of the fourteen
 * questions this rule asks have a single obvious answer; only the fourteenth
 * does not.
 */
function makeIssue3260Fixture(
  routerLabel: Label,
  switchLabel: Label,
): Issue3260Fixture {
  const stars: Array<SiteStar> = [];
  for (let unit: number = 1; unit <= 14; unit++) {
    stars.push(makeSiteStar(`Unit ${unit}`, 1, routerLabel, switchLabel));
  }
  const broken: SiteStar = stars[13]!;
  const secondRouter: NetworkDevice = makeSitedDevice(
    "Unit 14-rtr-b",
    broken.site,
    [routerLabel],
  );
  return {
    devices: [...devicesOf(stars), secondRouter],
    healthy: stars.slice(0, 13),
    broken: broken,
  };
}

/*
 * Rule links do not travel as a list of their own: the handler pushes them
 * into manualLinkInput and NetworkTopologyUtil.buildTopology merges them into
 * the edge map, so what the client sees is edges whose node ids are the
 * device ids themselves. Every assertion about what a rule drew therefore has
 * to read the built graph.
 */
function edgePairs(body: JSONObject): Array<string> {
  return (body["edges"] as Array<JSONObject>)
    .map((edge: JSONObject) => {
      return `${edge["fromNodeId"] as string}->${edge["toNodeId"] as string}`;
    })
    .sort();
}

function uplinkPair(child: NetworkDevice, parent: NetworkDevice): string {
  return `${child.id!.toString()}->${parent.id!.toString()}`;
}

function warningsIn(body: JSONObject): Array<JSONObject> {
  return body["linkRuleWarnings"] as Array<JSONObject>;
}

function resetTopologyMocks(): void {
  jest.clearAllMocks();
  commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue({
    tenantId: projectId,
  } as never);
  deviceService.findBy.mockResolvedValue([] as never);
  interfaceService.findBy.mockResolvedValue([] as never);
  endpointService.findBy.mockResolvedValue([] as never);
  deviceLinkService.findBy.mockResolvedValue([] as never);
  monitorStatusService.findBy.mockResolvedValue([] as never);
  linkRuleService.findBy.mockResolvedValue([] as never);
  suppressionService.getSuppressedNodeKeys.mockResolvedValue(
    new Set<string>() as never,
  );
}

describe("POST /network-device/topology — site-scoped link rules", () => {
  beforeEach(() => {
    resetTopologyMocks();
  });

  /*
   * Site scoping is only as good as the columns it reads. An unselected
   * siteId comes back undefined on every row, which normalises to "no site" —
   * so a site-scoped rule would skip the entire fleet and report it as
   * unassigned devices. site.name is what lets a failing site be NAMED
   * instead of appearing as "an unnamed site"; it rides on the device row
   * because NetworkSite.name is readable on a relation query, so no separate
   * site query (which would 403 a device-only role and take the whole map
   * down with it) is needed.
   */
  test("asks the device query for the site columns site scoping depends on", async () => {
    await callTopology({});

    const select: JSONObject = (
      deviceService.findBy.mock.calls[0]![0] as JSONObject
    )["select"] as JSONObject;
    expect(select["siteId"]).toBe(true);
    expect(select["site"]).toEqual({ name: true });
    // The labels the rules match on still have to come back too.
    expect(select["labels"]).toEqual({ _id: true });
  });

  /*
   * An unselected scope column arrives as undefined, and undefined parses to
   * Project by design — so forgetting it here would not throw or warn, it
   * would quietly resolve every Site rule the operator saved at project
   * scope and put the map straight back to the #3260 behaviour.
   */
  test("asks the rule query for the scope column", async () => {
    await callTopology({});

    const select: JSONObject = (
      linkRuleService.findBy.mock.calls[0]![0] as JSONObject
    )["select"] as JSONObject;
    expect(select["scope"]).toBe(true);
  });

  /*
   * The core of site scoping: the same "exactly one parent" question asked
   * once per site. Two sites, each with its own router, must produce two
   * separate stars — and crucially no edge between a switch in one site and
   * the router in the other, which is the cable nobody has.
   */
  test("a site-scoped rule draws one star per site and never across sites", async () => {
    const routerLabel: Label = makeLabel();
    const switchLabel: Label = makeLabel();
    const unitA: SiteStar = makeSiteStar("Unit A", 2, routerLabel, switchLabel);
    const unitB: SiteStar = makeSiteStar("Unit B", 2, routerLabel, switchLabel);

    deviceService.findBy.mockResolvedValue(devicesOf([unitA, unitB]) as never);
    linkRuleService.findBy.mockResolvedValue([
      makeLinkRule("Uplink to router", [switchLabel], [routerLabel], "Site"),
    ] as never);

    await callTopology({});

    const body: JSONObject = lastResponseBody();

    /*
     * Exactly these four edges — the equality is what rules out a cross-site
     * pair, since any extra edge would fail it.
     */
    expect(edgePairs(body)).toEqual(
      [
        uplinkPair(unitA.switches[0]!, unitA.router),
        uplinkPair(unitA.switches[1]!, unitA.router),
        uplinkPair(unitB.switches[0]!, unitB.router),
        uplinkPair(unitB.switches[1]!, unitB.router),
      ].sort(),
    );

    /*
     * A rule is stated in child and parent labels, so unlike a hand-drawn
     * cable it knows which end is up without anyone saying — the edge has to
     * carry that as parentNodeId or the layout draws a bag of peers.
     */
    for (const edge of body["edges"] as Array<JSONObject>) {
      expect(edge["protocols"]).toEqual(["manual"]);
      expect(edge["name"]).toBe("Uplink to router");
      expect(edge["parentNodeId"]).toBe(edge["toNodeId"]);
    }

    // Nothing failed anywhere, so the rule owes the operator no explanation.
    expect(warningsIn(body)).toEqual([]);
  });

  /*
   * ISSUE #3260, THE BROKEN HALF — now the documented meaning of Project
   * scope rather than a bug. One ambiguity in Unit 14 makes the single
   * project-wide question unanswerable, and all fourteen stars vanish. Pinned
   * so that "Project" keeps meaning exactly what every rule saved before the
   * column existed already meant.
   */
  test("issue #3260: a Project-scoped rule over fourteen units' routers draws nothing at all", async () => {
    const routerLabel: Label = makeLabel();
    const switchLabel: Label = makeLabel();
    const fixture: Issue3260Fixture = makeIssue3260Fixture(
      routerLabel,
      switchLabel,
    );

    deviceService.findBy.mockResolvedValue(fixture.devices as never);
    linkRuleService.findBy.mockResolvedValue([
      makeLinkRule(
        "Uplink to router",
        [switchLabel],
        [routerLabel],
        // No scope column at all: the state of every pre-#3260 rule row.
        undefined,
      ),
    ] as never);

    await callTopology({});

    const body: JSONObject = lastResponseBody();

    // Not "most of the map" — none of it, including the thirteen good sites.
    expect(edgePairs(body)).toEqual([]);

    const warnings: Array<JSONObject> = warningsIn(body);
    expect(warnings.length).toBe(1);
    expect(warnings[0]!["reason"]).toBe("ambiguousParent");
    // Fifteen routers across fourteen units, counted project-wide.
    expect(warnings[0]!["message"]).toBe(
      "15 devices carry the parent labels. Exactly one must, or there is no way to tell which is the uplink.",
    );
  });

  /*
   * ISSUE #3260, THE FIXED HALF — the same devices and the same labels, with
   * the scope column set. Thirteen sites draw, the fourteenth is named, and
   * the account of it is ONE warning row: the banner's length is bounded by
   * the number of rules the operator wrote, not by the number of sites in
   * their project.
   */
  test("issue #3260: the same rule at Site scope draws the thirteen good units and names the fourteenth", async () => {
    const routerLabel: Label = makeLabel();
    const switchLabel: Label = makeLabel();
    const fixture: Issue3260Fixture = makeIssue3260Fixture(
      routerLabel,
      switchLabel,
    );

    deviceService.findBy.mockResolvedValue(fixture.devices as never);
    linkRuleService.findBy.mockResolvedValue([
      makeLinkRule("Uplink to router", [switchLabel], [routerLabel], "Site"),
    ] as never);

    await callTopology({});

    const body: JSONObject = lastResponseBody();

    expect(edgePairs(body)).toEqual(
      fixture.healthy
        .map((star: SiteStar) => {
          return uplinkPair(star.switches[0]!, star.router);
        })
        .sort(),
    );

    /*
     * Unit 14's switch is still floating — site scoping does not guess a
     * parent, it just stops one site's ambiguity from erasing the others.
     */
    const brokenChildId: string = fixture.broken.switches[0]!.id!.toString();
    expect(
      edgePairs(body).some((pair: string) => {
        return pair.includes(brokenChildId);
      }),
    ).toBe(false);

    /*
     * One row, not fourteen: getWarning summarises the whole rule, and the
     * coverage fraction is what tells the operator the map is mostly working
     * rather than mostly broken.
     */
    const warnings: Array<JSONObject> = warningsIn(body);
    expect(warnings.length).toBe(1);
    expect(warnings[0]!["reason"]).toBe("ambiguousParent");
    expect(warnings[0]!["message"]).toBe(
      "Drawing in 13 of 14 sites. 2 devices carry the parent labels in Unit 14. Exactly one must, or there is no way to tell which is the uplink.",
    );
  });

  /*
   * The silence case, and it is the one that decides whether the banner is
   * read at all. A parent label like `SubCategory:Router` exists in nearly
   * every site by construction, so a rule that reported every site it touched
   * would produce a wall of text on a perfectly healthy map and be ignored
   * inside a week.
   */
  test("a fully healthy fourteen-site rule returns no warnings whatsoever", async () => {
    const routerLabel: Label = makeLabel();
    const switchLabel: Label = makeLabel();
    const stars: Array<SiteStar> = [];
    for (let unit: number = 1; unit <= 14; unit++) {
      stars.push(makeSiteStar(`Unit ${unit}`, 2, routerLabel, switchLabel));
    }

    deviceService.findBy.mockResolvedValue(devicesOf(stars) as never);
    linkRuleService.findBy.mockResolvedValue([
      makeLinkRule("Uplink to router", [switchLabel], [routerLabel], "Site"),
    ] as never);

    await callTopology({});

    const body: JSONObject = lastResponseBody();
    expect(edgePairs(body).length).toBe(28);
    expect(warningsIn(body)).toEqual([]);
  });

  /*
   * Truncation is a fact about the QUERY, not about the rule, so it is
   * admitted by the endpoint rather than baked into the resolver's sentences.
   * It matters most under site scoping: a cut-off device list can strand a
   * whole site whose router simply was not in the first page of rows, and
   * without this note the operator would go looking for a labelling mistake
   * that does not exist.
   */
  test("every warning admits it when the device list was truncated", async () => {
    const routerLabel: Label = makeLabel();
    const switchLabel: Label = makeLabel();

    const devices: Array<NetworkDevice> = [];
    for (let index: number = 0; index < LIMIT_PER_PROJECT; index++) {
      devices.push(
        makeSitedDevice(`sw-${index}`, null, index === 0 ? [switchLabel] : []),
      );
    }
    deviceService.findBy.mockResolvedValue(devices as never);
    // Nobody carries the parent label — possibly only because of the cap.
    linkRuleService.findBy.mockResolvedValue([
      makeLinkRule("Uplink to router", [switchLabel], [routerLabel], undefined),
    ] as never);

    await callTopology({});

    const body: JSONObject = lastResponseBody();
    expect(body["isTruncated"]).toBe(true);

    const warnings: Array<JSONObject> = warningsIn(body);
    expect(warnings.length).toBe(1);
    for (const warning of warnings) {
      expect(
        (warning["message"] as string).endsWith(
          NetworkDeviceLinkRuleUtil.TRUNCATED_DEVICE_LIST_NOTE,
        ),
      ).toBe(true);
    }
    // The resolver's own sentence survives in front of the caveat.
    expect(warnings[0]!["message"]).toBe(
      `No device carries the parent labels, so there is nothing to uplink to. ${NetworkDeviceLinkRuleUtil.TRUNCATED_DEVICE_LIST_NOTE}`,
    );
  });

  /*
   * The other side of the same coin: when the whole fleet was returned there
   * is nothing to hedge about, and hedging anyway would teach the operator to
   * discount every warning they ever read.
   */
  test("a complete device list leaves the truncation caveat off the warning", async () => {
    const routerLabel: Label = makeLabel();
    const switchLabel: Label = makeLabel();

    deviceService.findBy.mockResolvedValue([
      makeSitedDevice("sw1", null, [switchLabel]),
      makeSitedDevice("sw2", null, []),
    ] as never);
    linkRuleService.findBy.mockResolvedValue([
      makeLinkRule("Uplink to router", [switchLabel], [routerLabel], undefined),
    ] as never);

    await callTopology({});

    const body: JSONObject = lastResponseBody();
    expect(body["isTruncated"]).toBe(false);

    const warnings: Array<JSONObject> = warningsIn(body);
    expect(warnings.length).toBe(1);
    for (const warning of warnings) {
      expect(warning["message"]).not.toContain(
        NetworkDeviceLinkRuleUtil.TRUNCATED_DEVICE_LIST_NOTE,
      );
    }
  });

  /*
   * A device with no site is EXCLUDED from a site-scoped rule — not pooled
   * with the other unassigned devices (which would ask "exactly one parent
   * among everything nobody has filed yet", a question no operator posed) and
   * not given a singleton site. It must not break the sites that do resolve,
   * and it must be said out loud, because the fix here is "assign this device
   * to a site" and nothing else on the map would ever suggest that.
   */
  test("a device with no siteId is skipped by a site-scoped rule and reported, not silently dropped", async () => {
    const routerLabel: Label = makeLabel();
    const switchLabel: Label = makeLabel();
    const unit: SiteStar = makeSiteStar("Unit A", 1, routerLabel, switchLabel);
    const unassigned: NetworkDevice = makeSitedDevice("spare-sw", null, [
      switchLabel,
    ]);

    // The state of a device nobody has filed yet: no column, not an empty one.
    expect(unassigned.siteId).toBeUndefined();

    deviceService.findBy.mockResolvedValue([
      ...devicesOf([unit]),
      unassigned,
    ] as never);
    linkRuleService.findBy.mockResolvedValue([
      makeLinkRule("Uplink to router", [switchLabel], [routerLabel], "Site"),
    ] as never);

    await callTopology({});

    const body: JSONObject = lastResponseBody();

    // Unit A still draws, and the unassigned switch is on no edge at all.
    expect(edgePairs(body)).toEqual([
      uplinkPair(unit.switches[0]!, unit.router),
    ]);

    const warnings: Array<JSONObject> = warningsIn(body);
    expect(warnings.length).toBe(1);
    expect(warnings[0]!["reason"]).toBe("devicesWithoutSite");
    /*
     * No "Drawing in 1 of 1 sites." preamble: a coverage fraction over a
     * single applicable site says nothing the sentence after it does not.
     */
    expect(warnings[0]!["message"]).toBe(
      "1 device carrying the child labels is not assigned to a site, so this site-scoped rule skips it.",
    );
  });
});
