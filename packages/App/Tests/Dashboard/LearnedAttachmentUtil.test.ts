import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  LearnedAttachment,
  learnedAttachmentForNode,
  portLabelForEdgeEnd,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/EndpointNodeUtil";

/*
 * Issue #3489. A register, a handset or a kiosk that only answers ping has
 * no LLDP or CDP to report, so until now its cable had to be typed in by
 * hand. The topology builder can now place it from the switch's forwarding
 * table — the "fdb" edge that used to end at an anonymous endpoint node
 * ends at the managed device itself — and the drawers need one answer to
 * "where is this plugged in?". This is the function that gives it, and
 * what it must refuse to answer is as important as what it says: a switch
 * is the FROM end of every fdb edge on it and is attached to none of them.
 */

const SWITCH: NetworkTopologyNode = {
  id: "switch-1",
  name: "switch-01",
  isManaged: true,
  kind: "device",
  role: "switch",
  status: "up",
};

const OTHER_SWITCH: NetworkTopologyNode = {
  id: "switch-0",
  name: "switch-00",
  isManaged: true,
  kind: "device",
  role: "switch",
  status: "up",
};

const REGISTER: NetworkTopologyNode = {
  id: "pos-1",
  name: "pos-register-01",
  isManaged: true,
  kind: "device",
  role: "host",
  status: "up",
  macAddress: "aa:bb:cc:dd:ee:ff",
  vlanId: 42,
};

const NODE_BY_ID: Map<string, NetworkTopologyNode> = new Map<
  string,
  NetworkTopologyNode
>([
  [SWITCH.id, SWITCH],
  [OTHER_SWITCH.id, OTHER_SWITCH],
  [REGISTER.id, REGISTER],
]);

type MakeEdgeFunction = (
  overrides?: Partial<NetworkTopologyEdge>,
) => NetworkTopologyEdge;

const learnedEdge: MakeEdgeFunction = (
  overrides?: Partial<NetworkTopologyEdge>,
): NetworkTopologyEdge => {
  return {
    fromNodeId: SWITCH.id,
    toNodeId: REGISTER.id,
    fromPort: "Gi0/12",
    protocols: ["fdb"],
    parentNodeId: SWITCH.id,
    ...overrides,
  };
};

describe("learnedAttachmentForNode", () => {
  test("reads the learner from learnedByNodeId when the switch is the TO end", () => {
    /*
     * An attachment merged into a link stored device->switch keeps that
     * link's ends. The builder stamps which end learned so this does not
     * have to guess from the direction.
     */
    const reversed: NetworkTopologyEdge = {
      fromNodeId: REGISTER.id,
      toNodeId: SWITCH.id,
      toPort: "Gi0/12",
      toInterface: { interfaceIndex: 12, isOperationallyUp: false },
      protocols: ["manual", "fdb"],
      parentNodeId: SWITCH.id,
      learnedByNodeId: SWITCH.id,
    };

    const attachment: LearnedAttachment | undefined = learnedAttachmentForNode(
      REGISTER,
      [reversed],
      NODE_BY_ID,
    );

    expect(attachment).toEqual({
      switchNodeId: "switch-1",
      switchName: "switch-01",
      port: "Gi0/12",
      vlanId: 42,
      isSwitchPortDown: true,
    });
  });

  test("the switch at the TO end of a stamped edge is still attached to nothing", () => {
    const reversed: NetworkTopologyEdge = {
      fromNodeId: REGISTER.id,
      toNodeId: SWITCH.id,
      protocols: ["fdb"],
      learnedByNodeId: SWITCH.id,
    };

    expect(
      learnedAttachmentForNode(SWITCH, [reversed], NODE_BY_ID),
    ).toBeUndefined();
  });

  test("a payload without the stamp is read the old way: the from end learned", () => {
    const attachment: LearnedAttachment | undefined = learnedAttachmentForNode(
      REGISTER,
      [learnedEdge({ learnedByNodeId: undefined })],
      NODE_BY_ID,
    );

    expect(attachment?.switchNodeId).toBe("switch-1");
  });

  test("names the switch, its port and the VLAN for the learned end of an fdb edge", () => {
    const attachment: LearnedAttachment | undefined = learnedAttachmentForNode(
      REGISTER,
      [learnedEdge()],
      NODE_BY_ID,
    );

    expect(attachment).toEqual({
      switchNodeId: "switch-1",
      switchName: "switch-01",
      port: "Gi0/12",
      vlanId: 42,
      isSwitchPortDown: false,
    });
  });

  test("prefers the interface row's name, then the advertised port, then if<index>", () => {
    expect(
      learnedAttachmentForNode(
        REGISTER,
        [
          learnedEdge({
            fromPort: "stale-label",
            fromInterface: { interfaceIndex: 12, interfaceName: "xe-0/0/12" },
          }),
        ],
        NODE_BY_ID,
      )?.port,
    ).toBe("xe-0/0/12");

    expect(
      learnedAttachmentForNode(
        REGISTER,
        [
          learnedEdge({
            fromPort: "Gi0/12",
            fromInterface: { interfaceIndex: 12 },
          }),
        ],
        NODE_BY_ID,
      )?.port,
    ).toBe("Gi0/12");

    expect(
      learnedAttachmentForNode(
        REGISTER,
        [
          learnedEdge({
            fromPort: undefined,
            fromInterface: { interfaceIndex: 12 },
          }),
        ],
        NODE_BY_ID,
      )?.port,
    ).toBe("if12");
  });

  test("leaves the port undefined when nothing identifies the switch end", () => {
    const attachment: LearnedAttachment | undefined = learnedAttachmentForNode(
      REGISTER,
      [learnedEdge({ fromPort: undefined, fromInterface: undefined })],
      NODE_BY_ID,
    );

    expect(attachment?.port).toBeUndefined();
    expect(attachment?.switchName).toBe("switch-01");
  });

  test("carries no VLAN when the table stamped none on the device", () => {
    const untagged: NetworkTopologyNode = { ...REGISTER, vlanId: undefined };

    expect(
      learnedAttachmentForNode(untagged, [learnedEdge()], NODE_BY_ID)?.vlanId,
    ).toBeUndefined();
  });

  test("is nothing for an endpoint node — that is the row that matched no device", () => {
    const endpoint: NetworkTopologyNode = {
      id: "endpoint:aa",
      name: "aa:bb:cc:dd:ee:01",
      isManaged: false,
      kind: "endpoint",
      status: "unknown",
    };

    expect(
      learnedAttachmentForNode(
        endpoint,
        [learnedEdge({ toNodeId: endpoint.id })],
        NODE_BY_ID,
      ),
    ).toBeUndefined();
  });

  test("is nothing for an unmanaged peer, which LLDP or CDP placed", () => {
    const peer: NetworkTopologyNode = {
      id: "unmanaged:peer",
      name: "peer",
      isManaged: false,
      kind: "unmanaged",
      status: "unknown",
    };

    expect(
      learnedAttachmentForNode(
        peer,
        [learnedEdge({ toNodeId: peer.id })],
        NODE_BY_ID,
      ),
    ).toBeUndefined();
  });

  test("is nothing for a device joined by discovery protocols alone", () => {
    expect(
      learnedAttachmentForNode(
        REGISTER,
        [
          learnedEdge({ protocols: ["lldp"] }),
          learnedEdge({
            fromNodeId: OTHER_SWITCH.id,
            protocols: ["lldp", "cdp"],
          }),
          // A legacy edge with no protocols at all is an LLDP/CDP link.
          learnedEdge({ protocols: undefined }),
        ],
        NODE_BY_ID,
      ),
    ).toBeUndefined();
  });

  test("is nothing for the switch that did the learning", () => {
    /*
     * The switch is the FROM end: it has the register hanging off it, and
     * is attached to nothing by that edge. Claiming otherwise would tell
     * an operator their core switch is "connected to pos-register-01 on
     * Gi0/12".
     */
    expect(
      learnedAttachmentForNode(SWITCH, [learnedEdge()], NODE_BY_ID),
    ).toBeUndefined();
  });

  test("picks the lowest switch id when two tables claim the device, whatever the edge order", () => {
    const fromSwitch1: NetworkTopologyEdge = learnedEdge();
    const fromSwitch0: NetworkTopologyEdge = learnedEdge({
      fromNodeId: OTHER_SWITCH.id,
      fromPort: "Gi0/3",
    });

    expect(
      learnedAttachmentForNode(REGISTER, [fromSwitch1, fromSwitch0], NODE_BY_ID)
        ?.switchNodeId,
    ).toBe("switch-0");
    expect(
      learnedAttachmentForNode(REGISTER, [fromSwitch0, fromSwitch1], NODE_BY_ID)
        ?.switchNodeId,
    ).toBe("switch-0");
  });

  test("flags the switch port when its interface row reports it down", () => {
    expect(
      learnedAttachmentForNode(
        REGISTER,
        [learnedEdge({ fromInterface: { isOperationallyUp: false } })],
        NODE_BY_ID,
      )?.isSwitchPortDown,
    ).toBe(true);

    expect(
      learnedAttachmentForNode(
        REGISTER,
        [learnedEdge({ fromInterface: { isOperationallyUp: true } })],
        NODE_BY_ID,
      )?.isSwitchPortDown,
    ).toBe(false);

    // No interface row at all is "not known to be down", not "down".
    expect(
      learnedAttachmentForNode(REGISTER, [learnedEdge()], NODE_BY_ID)
        ?.isSwitchPortDown,
    ).toBe(false);
  });

  test("falls back to the switch id when the switch is not on the map", () => {
    const attachment: LearnedAttachment | undefined = learnedAttachmentForNode(
      REGISTER,
      [learnedEdge()],
      new Map<string, NetworkTopologyNode>([[REGISTER.id, REGISTER]]),
    );

    expect(attachment?.switchName).toBe("switch-1");
  });

  test("treats a managed node from a payload without a kind as a device", () => {
    const legacy: NetworkTopologyNode = {
      id: REGISTER.id,
      name: REGISTER.name,
      isManaged: true,
      status: "up",
    };

    expect(
      learnedAttachmentForNode(legacy, [learnedEdge()], NODE_BY_ID)
        ?.switchNodeId,
    ).toBe("switch-1");
  });
});

describe("portLabelForEdgeEnd", () => {
  test("follows the same precedence as describeEndpoint, without the placeholder", () => {
    expect(
      portLabelForEdgeEnd({ interfaceName: "xe-0/0/7" }, "stale-label"),
    ).toBe("xe-0/0/7");
    expect(portLabelForEdgeEnd({ interfaceIndex: 3 }, "Gi0/3")).toBe("Gi0/3");
    expect(portLabelForEdgeEnd({ interfaceIndex: 7 }, undefined)).toBe("if7");
    expect(portLabelForEdgeEnd(undefined, undefined)).toBeUndefined();
    expect(portLabelForEdgeEnd({}, undefined)).toBeUndefined();
  });
});
