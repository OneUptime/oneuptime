import { readMerakiLinks } from "../../../../Server/Utils/NetworkController/Meraki/MerakiLinkLayer";
import {
  NetworkControllerLink,
  NetworkControllerLinkEnd,
} from "../../../../Server/Utils/NetworkController/NetworkControllerTypes";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * A network's link layer topology (getNetworkTopologyLinkLayer), as the
 * API's specification (v1.75) shapes it: `nodes`, then `links` whose `ends`
 * refer to them by `derivedId`. Each end's `discovered` holds the port at
 * that end.
 */

const NETWORK: string = "L_660";

const switchNode: JSONObject = {
  derivedId: "sw",
  mac: "E0:55:3D:00:00:01",
  type: "device",
  device: {
    serial: "Q2SW-0000-0001",
    name: "UN0660LANSWI01",
    model: "MS130-48P",
    productType: "switch",
  },
};

const routerNode: JSONObject = {
  derivedId: "mx",
  mac: "88:15:44:C8:5D:58",
  type: "device",
  root: true,
  device: {
    serial: "Q2MX-0000-0001",
    name: "UN0660WANRTR01",
    model: "MX85",
    productType: "appliance",
  },
};

const strangerNode: JSONObject = {
  derivedId: "stranger",
  mac: "aa:bb:cc:dd:ee:ff",
  type: "discovered",
  discovered: {
    lldp: {
      chassisId: "11:22:33:44:55:66",
      systemName: "core-switch",
      systemDescription: "Router and Switch Device",
      managementAddress: "10.130.105.154",
    },
    cdp: {
      platform: "cisco C9300-24P",
      deviceId: "core-switch.example.com",
      address: "192.168.1.1",
    },
  },
};

function endOf(
  node: JSONObject,
  port: string,
  protocol: "lldp" | "cdp" = "lldp",
): JSONObject {
  const device: JSONObject | undefined = node["device"] as
    | JSONObject
    | undefined;

  return {
    node: { derivedId: node["derivedId"], type: node["type"] },
    ...(device
      ? { device: { serial: device["serial"], name: device["name"] } }
      : {}),
    discovered: { [protocol]: { portId: port } },
  };
}

function answerOf(
  nodes: Array<JSONObject>,
  links: Array<Array<JSONObject>>,
): JSONObject {
  return {
    nodes: nodes,
    links: links.map((ends: Array<JSONObject>): JSONObject => {
      return { ends: ends, lastReportedAt: "2026-11-01T11:00:00Z" };
    }),
    errors: [],
  };
}

describe("the link from a switch to the router", () => {
  const links: Array<NetworkControllerLink> = readMerakiLinks(
    answerOf(
      [switchNode, routerNode],
      [[endOf(switchNode, "49"), endOf(routerNode, "3")]],
    ),
    NETWORK,
  );

  test("both ends are Meraki devices, each with its port", () => {
    expect(links).toEqual([
      {
        controllerNetworkId: NETWORK,
        protocols: ["lldp"],
        ends: [
          {
            serial: "Q2SW-0000-0001",
            name: "UN0660LANSWI01",
            port: "Port 49",
            mac: "e0:55:3d:00:00:01",
            ip: "",
            platform: "Meraki MS130-48P",
          },
          {
            serial: "Q2MX-0000-0001",
            name: "UN0660WANRTR01",
            port: "Port 3",
            mac: "88:15:44:c8:5d:58",
            ip: "",
            platform: "Meraki MX85",
          },
        ],
      },
    ]);
  });
});

describe("an end that is not a Meraki device", () => {
  test("is known by what it advertised", () => {
    const links: Array<NetworkControllerLink> = readMerakiLinks(
      answerOf(
        [switchNode, strangerNode],
        [[endOf(switchNode, "1"), endOf(strangerNode, "Gi0/1")]],
      ),
      NETWORK,
    );

    expect(links[0]?.ends[1]).toEqual({
      serial: "",
      name: "core-switch",
      port: "Gi0/1",
      mac: "aa:bb:cc:dd:ee:ff",
      ip: "10.130.105.154",
      platform: "cisco C9300-24P",
    });
  });

  test("CDP alone says enough", () => {
    const node: JSONObject = {
      derivedId: "cdp-only",
      type: "discovered",
      discovered: {
        cdp: {
          platform: "IP Phone",
          deviceId: "SEP002F5C7BF3E4",
          managementAddress: "10.7.0.15",
        },
      },
    };
    const links: Array<NetworkControllerLink> = readMerakiLinks(
      answerOf(
        [switchNode, node],
        [[endOf(switchNode, "7"), endOf(node, "Port 1", "cdp")]],
      ),
      NETWORK,
    );

    expect(links[0]?.ends[1]).toMatchObject({
      name: "SEP002F5C7BF3E4",
      ip: "10.7.0.15",
      platform: "IP Phone",
      port: "Port 1",
    });
    expect(links[0]?.protocols).toEqual(["lldp", "cdp"]);
  });

  test("the chassis id stands in for a node with no MAC of its own, when it is one", () => {
    const withoutMac: JSONObject = { ...strangerNode };

    delete withoutMac["mac"];

    expect(
      readMerakiLinks(
        answerOf(
          [switchNode, withoutMac],
          [[endOf(switchNode, "1"), endOf(withoutMac, "Gi0/1")]],
        ),
        NETWORK,
      )[0]?.ends[1]?.mac,
    ).toBe("11:22:33:44:55:66");
  });

  test("a chassis id that is no MAC is not offered as one", () => {
    const node: JSONObject = {
      derivedId: "n",
      type: "discovered",
      discovered: { lldp: { chassisId: "12345", systemName: "x" } },
    };

    expect(
      readMerakiLinks(
        answerOf(
          [switchNode, node],
          [[endOf(switchNode, "1"), endOf(node, "2")]],
        ),
        NETWORK,
      )[0]?.ends[1]?.mac,
    ).toBe("");
  });
});

describe("a stack", () => {
  test("the member named on the end is the device", () => {
    const stack: JSONObject = {
      derivedId: "stack-1",
      type: "stack",
      stack: { id: 98765, name: "Corp Stack", members: [] },
    };

    const links: Array<NetworkControllerLink> = readMerakiLinks(
      answerOf(
        [stack, routerNode],
        [
          [
            {
              node: { derivedId: "stack-1", type: "stack" },
              device: { serial: "Q2UN-E55E-KO6L", name: "Study Switch 2" },
              discovered: { lldp: { portId: "Port 20" } },
            },
            endOf(routerNode, "3"),
          ],
        ],
      ),
      NETWORK,
    );

    expect(links[0]?.ends[0]).toMatchObject({
      serial: "Q2UN-E55E-KO6L",
      name: "Study Switch 2",
      port: "Port 20",
    });
  });
});

describe("what says nothing", () => {
  test("Meraki's own example: a link with one end", () => {
    expect(
      readMerakiLinks(
        answerOf([switchNode], [[endOf(switchNode, "20")]]),
        NETWORK,
      ),
    ).toEqual([]);
  });

  test("a link between two strangers belongs to no device here", () => {
    const other: JSONObject = { ...strangerNode, derivedId: "other" };

    expect(
      readMerakiLinks(
        answerOf(
          [strangerNode, other],
          [[endOf(strangerNode, "1"), endOf(other, "2")]],
        ),
        NETWORK,
      ),
    ).toEqual([]);
  });

  test("a device's link to itself", () => {
    expect(
      readMerakiLinks(
        answerOf(
          [switchNode],
          [[endOf(switchNode, "51"), endOf(switchNode, "52")]],
        ),
        NETWORK,
      ),
    ).toEqual([]);
  });

  test("an end that refers to no node and names nobody", () => {
    expect(
      readMerakiLinks(
        answerOf(
          [switchNode],
          [
            [
              endOf(switchNode, "1"),
              { node: { derivedId: "missing" }, discovered: {} },
            ],
          ],
        ),
        NETWORK,
      ),
    ).toEqual([]);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a list", []],
    ["text", "topology"],
    ["no links", { nodes: [switchNode] }],
    ["links that are not a list", { nodes: [], links: "many" }],
    ["rows that are not objects", { nodes: [7], links: [null, "x"] }],
    ["ends that are not a list", { nodes: [], links: [{ ends: "two" }] }],
    ["ends that are not objects", { nodes: [], links: [{ ends: [1, 2] }] }],
  ])("%s", (_label: string, body: unknown) => {
    expect(readMerakiLinks(body, NETWORK)).toEqual([]);
  });
});

describe("repeats", () => {
  test("one pair of ports listed twice, either way round, is one link", () => {
    expect(
      readMerakiLinks(
        answerOf(
          [switchNode, routerNode],
          [
            [endOf(switchNode, "49"), endOf(routerNode, "3")],
            [endOf(routerNode, "3"), endOf(switchNode, "49")],
          ],
        ),
        NETWORK,
      ),
    ).toHaveLength(1);
  });

  test("two cables between one pair are two links", () => {
    expect(
      readMerakiLinks(
        answerOf(
          [switchNode, routerNode],
          [
            [endOf(switchNode, "49"), endOf(routerNode, "3")],
            [endOf(switchNode, "50"), endOf(routerNode, "4")],
          ],
        ),
        NETWORK,
      ),
    ).toHaveLength(2);
  });
});

describe("outside text", () => {
  test("is cleaned and cut, and an address must be one", () => {
    const node: JSONObject = {
      derivedId: "n",
      type: "discovered",
      discovered: {
        lldp: {
          systemName: `long\u0007${"x".repeat(1000)}`,
          managementAddress: "not an address",
        },
      },
    };
    const end: NetworkControllerLinkEnd | undefined = readMerakiLinks(
      answerOf(
        [switchNode, node],
        [[endOf(switchNode, "1"), endOf(node, "2")]],
      ),
      NETWORK,
    )[0]?.ends[1];

    expect(end?.name.startsWith("long x")).toBe(true);
    expect(end?.name.length).toBeLessThanOrEqual(128);
    expect(end?.ip).toBe("");
  });
});
