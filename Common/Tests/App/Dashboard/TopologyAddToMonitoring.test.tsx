import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "../../../Types/Monitor/SnmpMonitor/NetworkTopology";
import NetworkDeviceDetailPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkDeviceDetailPanel";

/*
 * Issue #3435, from the operator's side.
 *
 * The topology detail drawer for an unmanaged neighbour used to be a dead
 * end: it showed what the device was ("IP phone", "Cisco IP Phone 8811") and
 * which switch port it hung off, and the only thing anybody could do about it
 * was hide it from the map. This asserts what a person can actually SEE and
 * PRESS in that drawer now — not which props were passed — because the two
 * ways of getting it wrong are both invisible to a source-text check:
 *
 *   - offering the action on a MANAGED device, which already has a device
 *     page and cannot be created again;
 *   - rendering the action for a viewer with no create permission, whose
 *     click can only ever end in a permission error.
 *
 * The panel takes the handler as an optional prop precisely so its caller can
 * make both of those decisions, and this pins that the prop actually gates
 * the button.
 */

const SWITCH_NODE: NetworkTopologyNode = {
  id: "switch-1",
  name: "UN1289LANSWI01",
  isManaged: true,
  kind: "device",
  role: "switch",
  status: "up",
};

const PHONE_NODE: NetworkTopologyNode = {
  id: "unmanaged:sep6026aaf2b46b",
  name: "SEP6026AAF2B46B",
  isManaged: false,
  kind: "unmanaged",
  role: "phone",
  status: "unknown",
  deviceModel: "Cisco IP Phone 8811",
  ipAddress: "10.0.12.41",
};

const PHONE_EDGE: NetworkTopologyEdge = {
  fromNodeId: "switch-1",
  toNodeId: "unmanaged:sep6026aaf2b46b",
  fromPort: "GigabitEthernet1/0/12",
  toPort: "SW PORT",
  protocols: ["cdp"],
};

type RenderPanelOptions = {
  node: NetworkTopologyNode;
  onAddToMonitoring?: ((node: NetworkTopologyNode) => void) | undefined;
  onHideNode?: ((node: NetworkTopologyNode) => void) | undefined;
};

function renderPanel(options: RenderPanelOptions): void {
  const nodeById: Map<string, NetworkTopologyNode> = new Map<
    string,
    NetworkTopologyNode
  >([
    [SWITCH_NODE.id, SWITCH_NODE],
    [PHONE_NODE.id, PHONE_NODE],
  ]);

  render(
    <MemoryRouter>
      <NetworkDeviceDetailPanel
        node={options.node}
        edges={[PHONE_EDGE]}
        nodeById={nodeById}
        onClose={() => {}}
        onSelectEdge={() => {}}
        onHideNode={options.onHideNode}
        onAddToMonitoring={options.onAddToMonitoring}
      />
    </MemoryRouter>,
  );
}

describe("the topology drawer for an unmanaged neighbour", () => {
  afterEach(() => {
    cleanup();
  });

  test("offers to bring the device into monitoring", () => {
    renderPanel({
      node: PHONE_NODE,
      onAddToMonitoring: () => {},
    });

    expect(
      screen.getByTestId("network-topology-add-to-monitoring"),
    ).toBeInTheDocument();
    expect(screen.getByText("Add to Monitoring")).toBeInTheDocument();
  });

  test("hands the node back so the dialog knows what to pre-fill from", () => {
    const onAddToMonitoring: jest.Mock<any, any> = jest.fn() as jest.Mock<
      any,
      any
    >;

    renderPanel({
      node: PHONE_NODE,
      onAddToMonitoring: onAddToMonitoring as unknown as (
        node: NetworkTopologyNode,
      ) => void,
    });

    fireEvent.click(screen.getByTestId("network-topology-add-to-monitoring"));

    expect(onAddToMonitoring).toHaveBeenCalledWith(PHONE_NODE);
  });

  /*
   * Hidden rather than disabled. PermissionGate returns "not allowed, and
   * nothing honest to say" while the permission snapshot is still in flight —
   * every first paint after a login or a project switch — so a disabled
   * button would accuse a permitted user of lacking a permission they hold.
   */
  test("shows no such action to a viewer who cannot create devices", () => {
    renderPanel({ node: PHONE_NODE });

    expect(
      screen.queryByTestId("network-topology-add-to-monitoring"),
    ).not.toBeInTheDocument();
  });

  /*
   * A device already under management has a device page, and the drawer
   * offers that instead. Offering both would invite the operator to create a
   * duplicate of a device they are already monitoring.
   */
  test("a managed device is offered its device page, not an adoption", () => {
    renderPanel({
      node: SWITCH_NODE,
      onAddToMonitoring: () => {},
    });

    expect(
      screen.queryByTestId("network-topology-add-to-monitoring"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Device details")).toBeInTheDocument();
  });

  /*
   * The address is what makes the action worth having — it is the field a
   * device cannot be monitored without — so the drawer has to show it, and
   * for an unmanaged peer it now comes from what the neighbours advertised
   * rather than from an ARP table.
   */
  test("shows the discovered address and platform it will carry over", () => {
    renderPanel({
      node: PHONE_NODE,
      onAddToMonitoring: () => {},
    });

    expect(screen.getByText("10.0.12.41")).toBeInTheDocument();
    expect(screen.getByText("Cisco IP Phone 8811")).toBeInTheDocument();
    expect(screen.getByText("IP phone")).toBeInTheDocument();
  });

  /*
   * Hiding was the only action this drawer had, and it is still the right
   * answer for a peer nobody wants to monitor — a printer, a contractor's
   * laptop. The new action is an addition, not a replacement.
   */
  test("still offers to hide the node, which was the only action before", () => {
    renderPanel({
      node: PHONE_NODE,
      onAddToMonitoring: () => {},
      onHideNode: () => {},
    });

    expect(
      screen.getByTestId("network-topology-hide-node"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("network-topology-add-to-monitoring"),
    ).toBeInTheDocument();
  });
});
