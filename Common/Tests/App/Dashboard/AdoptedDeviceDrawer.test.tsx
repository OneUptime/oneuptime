import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "../../../Types/Monitor/SnmpMonitor/NetworkTopology";
import NetworkDeviceDetailPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkDeviceDetailPanel";
import NetworkLinkDetailPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkLinkDetailPanel";

/*
 * Issue #3489, from the operator's side.
 *
 * A register that only answers ping used to float on the map until somebody
 * typed its cable in under Device Links. Now the switch's forwarding table
 * places it, and the two drawers have to SAY so — because a line that
 * appeared on its own, ending at a port nobody typed, is a line the operator
 * will otherwise distrust. This asserts what a person can read in each
 * drawer, not which helper produced it:
 *
 *   - the device drawer names the switch, the port and the VLAN, and says
 *     the attachment was learned rather than drawn;
 *   - its Links list shows the switch port instead of the "?" the device's
 *     own, silent end used to print;
 *   - the link drawer calls the link learned, explains the hierarchy in
 *     forwarding-table terms rather than as something "declared", and labels
 *     the device end by the switch port it is attached through.
 */

const SWITCH_NODE: NetworkTopologyNode = {
  id: "switch-1",
  name: "switch-01",
  isManaged: true,
  kind: "device",
  role: "switch",
  status: "up",
};

const REGISTER_NODE: NetworkTopologyNode = {
  id: "pos-1",
  name: "pos-register-01",
  isManaged: true,
  kind: "device",
  role: "host",
  status: "up",
  macAddress: "aa:bb:cc:dd:ee:ff",
  ipAddress: "10.0.5.20",
  vlanId: 42,
};

const ROUTER_NODE: NetworkTopologyNode = {
  id: "router-1",
  name: "edge-rtr-01",
  isManaged: true,
  kind: "device",
  role: "router",
  status: "up",
  macAddress: "aa:bb:cc:dd:ee:01",
};

const LEARNED_EDGE: NetworkTopologyEdge = {
  fromNodeId: SWITCH_NODE.id,
  toNodeId: REGISTER_NODE.id,
  fromPort: "Gi0/12",
  fromInterface: { interfaceIndex: 12, isOperationallyUp: true },
  protocols: ["fdb"],
  parentNodeId: SWITCH_NODE.id,
};

/*
 * A router's MAC is learned on the port that leads towards it, so the
 * builder declares no parent for it — the layout keeps inferring.
 */
const LEARNED_UPLINK_EDGE: NetworkTopologyEdge = {
  fromNodeId: SWITCH_NODE.id,
  toNodeId: ROUTER_NODE.id,
  fromPort: "Gi0/48",
  protocols: ["fdb"],
};

const LLDP_EDGE: NetworkTopologyEdge = {
  fromNodeId: SWITCH_NODE.id,
  toNodeId: REGISTER_NODE.id,
  fromPort: "Gi0/12",
  toPort: "eth0",
  protocols: ["lldp"],
  parentNodeId: SWITCH_NODE.id,
};

const NODE_BY_ID: Map<string, NetworkTopologyNode> = new Map<
  string,
  NetworkTopologyNode
>([
  [SWITCH_NODE.id, SWITCH_NODE],
  [REGISTER_NODE.id, REGISTER_NODE],
  [ROUTER_NODE.id, ROUTER_NODE],
]);

function renderDevicePanel(
  node: NetworkTopologyNode,
  edges: Array<NetworkTopologyEdge>,
): void {
  render(
    <MemoryRouter>
      <NetworkDeviceDetailPanel
        node={node}
        edges={edges}
        nodeById={NODE_BY_ID}
        onClose={() => {}}
        onSelectEdge={() => {}}
      />
    </MemoryRouter>,
  );
}

function renderLinkPanel(edge: NetworkTopologyEdge): void {
  render(
    <MemoryRouter>
      <NetworkLinkDetailPanel
        edge={edge}
        fromNode={NODE_BY_ID.get(edge.fromNodeId)}
        toNode={NODE_BY_ID.get(edge.toNodeId)}
        onClose={() => {}}
      />
    </MemoryRouter>,
  );
}

describe("the device drawer for a device placed by a forwarding table", () => {
  afterEach(() => {
    cleanup();
  });

  test("says which switch port it was learned on, and that it was learned", () => {
    renderDevicePanel(REGISTER_NODE, [LEARNED_EDGE]);

    const attachment: HTMLElement = screen.getByTestId(
      "network-topology-learned-attachment",
    );
    expect(attachment).toHaveTextContent("switch-01");
    expect(attachment).toHaveTextContent("Gi0/12");
    expect(attachment).toHaveTextContent("VLAN 42");
    expect(screen.getByText("Connected to")).toBeInTheDocument();
    expect(screen.getByText(/forwarding or ARP table/)).toBeInTheDocument();
    expect(screen.getByText(/re-cabled/)).toBeInTheDocument();
  });

  test("shows the MAC and the VLAN the table knew the device by", () => {
    renderDevicePanel(REGISTER_NODE, [LEARNED_EDGE]);

    expect(screen.getByText("MAC address")).toBeInTheDocument();
    expect(screen.getByText("aa:bb:cc:dd:ee:ff")).toBeInTheDocument();
    expect(screen.getByText("VLAN")).toBeInTheDocument();
    expect(screen.getByText("VLAN 42")).toBeInTheDocument();
    expect(screen.getByText("10.0.5.20")).toBeInTheDocument();
  });

  /*
   * The grey sub-line under a link names THIS device's port. A register has
   * no port to name — it answers ping and nothing else — and the line used
   * to print "?", which reads as "we do not know where this goes" about the
   * one link the map is surest of.
   */
  test("lists the switch port under Links instead of a question mark", () => {
    renderDevicePanel(REGISTER_NODE, [LEARNED_EDGE]);

    expect(screen.getByText("Links (1)")).toBeInTheDocument();
    expect(screen.getByText("Gi0/12")).toBeInTheDocument();
    expect(screen.queryByText("?")).not.toBeInTheDocument();
  });

  test("keeps the device's own port when a discovery protocol reported it too", () => {
    renderDevicePanel(REGISTER_NODE, [
      { ...LLDP_EDGE, protocols: ["lldp", "fdb"] },
    ]);

    expect(screen.getByText("eth0")).toBeInTheDocument();
    expect(screen.queryByText("Gi0/12")).not.toBeInTheDocument();
  });

  test("says nothing about an attachment for a device joined by LLDP alone", () => {
    renderDevicePanel(REGISTER_NODE, [LLDP_EDGE]);

    expect(
      screen.queryByTestId("network-topology-learned-attachment"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Connected to")).not.toBeInTheDocument();
  });

  test("says nothing about an attachment for the switch that did the learning", () => {
    renderDevicePanel(SWITCH_NODE, [LEARNED_EDGE]);

    expect(
      screen.queryByTestId("network-topology-learned-attachment"),
    ).not.toBeInTheDocument();
    // Its own end of the edge is the port it learned the register on.
    expect(screen.getByText("Gi0/12")).toBeInTheDocument();
  });

  test("still offers the device page — the device is managed, not adopted", () => {
    renderDevicePanel(REGISTER_NODE, [LEARNED_EDGE]);

    expect(screen.getByText("Device details")).toBeInTheDocument();
    expect(
      screen.queryByTestId("network-topology-add-to-monitoring"),
    ).not.toBeInTheDocument();
  });
});

/*
 * The same attachment, merged into a link the operator had typed in the
 * other way round - device first, switch second. The switch is the TO end
 * now, and the builder's learnedByNodeId is what keeps both drawers
 * pointing at the right port.
 */
const REVERSED_LEARNED_EDGE: NetworkTopologyEdge = {
  fromNodeId: REGISTER_NODE.id,
  toNodeId: SWITCH_NODE.id,
  toPort: "Gi0/12",
  toInterface: { interfaceIndex: 12, isOperationallyUp: true },
  protocols: ["manual", "fdb"],
  parentNodeId: SWITCH_NODE.id,
  learnedByNodeId: SWITCH_NODE.id,
};

describe("a learned link stored switch-second", () => {
  afterEach(() => {
    cleanup();
  });

  test("the device drawer still names the switch port", () => {
    renderDevicePanel(REGISTER_NODE, [REVERSED_LEARNED_EDGE]);

    const attachment: HTMLElement = screen.getByTestId(
      "network-topology-learned-attachment",
    );
    expect(attachment).toHaveTextContent("switch-01");
    expect(attachment).toHaveTextContent("Gi0/12");
  });

  test("the link drawer names the switch as the learner, not the from end", () => {
    renderLinkPanel(REVERSED_LEARNED_EDGE);

    expect(screen.getByText(/learned/, { selector: "div" })).toHaveTextContent(
      "switch-01 learned pos-register-01's MAC address on Gi0/12",
    );
    expect(
      screen.getByText("Attached via switch-01 Gi0/12"),
    ).toBeInTheDocument();
  });
});

describe("the link drawer for a learned link", () => {
  afterEach(() => {
    cleanup();
  });

  test("calls it learned, and explains the hierarchy in the table's own terms", () => {
    renderLinkPanel(LEARNED_EDGE);

    expect(screen.getByText("Learned link")).toBeInTheDocument();
    expect(
      screen.getByText(
        /in its forwarding or ARP table, so the Parent-Child view draws/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/on Gi0\/12/)).toBeInTheDocument();
    expect(
      screen.queryByText(/declared, not inferred/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("network-topology-learned-link-note"),
    ).not.toBeInTheDocument();
  });

  test("labels the silent device end by the switch port it is attached through", () => {
    renderLinkPanel(LEARNED_EDGE);

    expect(
      screen.getByText("Attached via switch-01 Gi0/12"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Unknown interface")).not.toBeInTheDocument();
  });

  test("notes what the table did and did not establish when no parent was declared", () => {
    renderLinkPanel(LEARNED_UPLINK_EDGE);

    const note: HTMLElement = screen.getByTestId(
      "network-topology-learned-link-note",
    );
    expect(note).toHaveTextContent("switch-01");
    expect(note).toHaveTextContent("edge-rtr-01");
    expect(note).toHaveTextContent("on Gi0/48");
    expect(note).toHaveTextContent("forwarding or ARP table");
    expect(screen.getByText("Learned link")).toBeInTheDocument();
    expect(
      screen.queryByText(/declared, not inferred/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Attached via switch-01 Gi0/48"),
    ).toBeInTheDocument();
  });

  test("a discovered link still reads exactly as it did", () => {
    renderLinkPanel(LLDP_EDGE);

    expect(screen.getByText("Network link")).toBeInTheDocument();
    expect(screen.getByText(/declared, not inferred/)).toBeInTheDocument();
    expect(
      screen.queryByTestId("network-topology-learned-link-note"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("eth0")).toBeInTheDocument();
  });
});

/*
 * The hierarchy sentence, when the parent is not the learner. A rule or a
 * hand-drawn link said the firewall is the parent; the switch's table
 * learned the firewall's MAC on its uplink. Two facts - and fused into one
 * sentence they read "the firewall learned the switch's MAC", which is
 * backwards.
 */
describe("the link drawer when the parent was declared by somebody else", () => {
  afterEach(() => {
    cleanup();
  });

  const FIREWALL_NODE: NetworkTopologyNode = {
    id: "fw-1",
    name: "edge-fw-01",
    isManaged: true,
    kind: "device",
    role: "firewall",
    status: "up",
  };

  test("states what the table learned and who is the declared parent, separately", () => {
    NODE_BY_ID.set(FIREWALL_NODE.id, FIREWALL_NODE);
    renderLinkPanel({
      fromNodeId: FIREWALL_NODE.id,
      toNodeId: SWITCH_NODE.id,
      fromPort: "eth1",
      toPort: "Gi0/48",
      protocols: ["manual", "fdb"],
      parentNodeId: FIREWALL_NODE.id,
      learnedByNodeId: SWITCH_NODE.id,
    });

    const sentence: HTMLElement = screen.getByText(/learned/, {
      selector: "div",
    });
    expect(sentence).toHaveTextContent(
      "switch-01 learned edge-fw-01's MAC address on Gi0/48",
    );
    expect(sentence).toHaveTextContent("edge-fw-01 is the declared parent");
    expect(sentence).not.toHaveTextContent("edge-fw-01 learned");
  });

  test("a pair a discovery protocol also reports is not called a learned link", () => {
    renderLinkPanel({
      fromNodeId: SWITCH_NODE.id,
      toNodeId: REGISTER_NODE.id,
      fromPort: "Gi0/12",
      toPort: "eth0",
      protocols: ["lldp", "fdb"],
      learnedByNodeId: SWITCH_NODE.id,
    });

    expect(screen.getByText("Network link")).toBeInTheDocument();
    expect(screen.queryByText("Learned link")).not.toBeInTheDocument();
  });
});
