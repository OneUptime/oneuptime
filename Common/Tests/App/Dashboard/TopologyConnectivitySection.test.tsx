import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "../../../Types/Monitor/SnmpMonitor/NetworkTopology";
import NetworkDeviceDetailPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkDeviceDetailPanel";

/*
 * Issue #3745, from the operator's side of the drawer.
 *
 * The Connectivity section is two children — a read-only latency trend and
 * the Ping / Traceroute buttons — and the two things worth defending are
 * WHO gets it (a managed device, never a neighbour or an endpoint) and
 * WHICH half a viewer without the create permission gets (the trend, not
 * the buttons). Both children are stubbed to strings so the assertions are
 * about the panel's decisions, not about metrics or polling — those have
 * their own tests — and so the stubs can echo the props they were handed.
 */

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceLatencyTrend",
  () => {
    return {
      __esModule: true,
      default: (props: { networkDeviceId: { toString: () => string } }) => {
        return `latency-trend-stub:${props.networkDeviceId.toString()}`;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceDiagnostics",
  () => {
    return {
      __esModule: true,
      default: (props: { networkDeviceId: { toString: () => string } }) => {
        return `diagnostics-stub:${props.networkDeviceId.toString()}`;
      },
    };
  },
);

const SWITCH_NODE: NetworkTopologyNode = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "core-sw-01",
  isManaged: true,
  kind: "device",
  role: "switch",
  status: "up",
  ipAddress: "10.0.0.1",
};

const PHONE_NODE: NetworkTopologyNode = {
  id: "unmanaged:sep6026aaf2b46b",
  name: "SEP6026AAF2B46B",
  isManaged: false,
  kind: "unmanaged",
  role: "phone",
  status: "unknown",
  ipAddress: "10.0.12.41",
};

const ENDPOINT_NODE: NetworkTopologyNode = {
  id: "endpoint:aabbccddeeff",
  name: "aa:bb:cc:dd:ee:ff",
  isManaged: true,
  kind: "endpoint",
  status: "unknown",
  macAddress: "aa:bb:cc:dd:ee:ff",
};

const EDGE: NetworkTopologyEdge = {
  fromNodeId: SWITCH_NODE.id,
  toNodeId: PHONE_NODE.id,
  fromPort: "Gi1/0/12",
  protocols: ["cdp"],
};

type RenderPanelOptions = {
  node: NetworkTopologyNode;
  canRunDiagnostics?: boolean | undefined;
  onHideNode?: ((node: NetworkTopologyNode) => void) | undefined;
};

function renderPanel(options: RenderPanelOptions): void {
  const nodeById: Map<string, NetworkTopologyNode> = new Map<
    string,
    NetworkTopologyNode
  >([
    [SWITCH_NODE.id, SWITCH_NODE],
    [PHONE_NODE.id, PHONE_NODE],
    [ENDPOINT_NODE.id, ENDPOINT_NODE],
  ]);

  render(
    <MemoryRouter>
      <NetworkDeviceDetailPanel
        node={options.node}
        edges={[EDGE]}
        nodeById={nodeById}
        onClose={() => {}}
        onSelectEdge={() => {}}
        onHideNode={options.onHideNode}
        canRunDiagnostics={options.canRunDiagnostics}
      />
    </MemoryRouter>,
  );
}

describe("the Connectivity section of the topology drawer", () => {
  afterEach(() => {
    cleanup();
  });

  test("a managed device gets the trend and, with permission, the buttons", () => {
    renderPanel({ node: SWITCH_NODE, canRunDiagnostics: true });

    const section: HTMLElement = screen.getByTestId(
      "network-topology-connectivity",
    );

    expect(section).toBeInTheDocument();
    expect(screen.getByText("Connectivity")).toBeInTheDocument();
    expect(section).toHaveTextContent(`latency-trend-stub:${SWITCH_NODE.id}`);
    expect(section).toHaveTextContent(`diagnostics-stub:${SWITCH_NODE.id}`);
  });

  /*
   * Hidden, not disabled — the trend is read-only and stays; only the
   * buttons that create a row go. PermissionGate says "not allowed, nothing
   * honest to say" on every first paint after a login, and a disabled Ping
   * would accuse a permitted operator of lacking a permission they hold.
   */
  test("without the permission the trend stays and the buttons go", () => {
    renderPanel({ node: SWITCH_NODE, canRunDiagnostics: false });

    const section: HTMLElement = screen.getByTestId(
      "network-topology-connectivity",
    );

    expect(section).toHaveTextContent(`latency-trend-stub:${SWITCH_NODE.id}`);
    expect(section).not.toHaveTextContent("diagnostics-stub");
  });

  test("the prop is optional, and absent means no buttons", () => {
    renderPanel({ node: SWITCH_NODE });

    expect(
      screen.getByTestId("network-topology-connectivity"),
    ).toHaveTextContent("latency-trend-stub");
    expect(screen.queryByText(/diagnostics-stub/)).not.toBeInTheDocument();
  });

  test("an unmanaged neighbour has no row to ping from, so no section", () => {
    renderPanel({ node: PHONE_NODE, canRunDiagnostics: true });

    expect(
      screen.queryByTestId("network-topology-connectivity"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/latency-trend-stub/)).not.toBeInTheDocument();
    expect(screen.queryByText(/diagnostics-stub/)).not.toBeInTheDocument();
  });

  test("an endpoint learned from a forwarding table gets no section either", () => {
    renderPanel({ node: ENDPOINT_NODE, canRunDiagnostics: true });

    expect(
      screen.queryByTestId("network-topology-connectivity"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/latency-trend-stub/)).not.toBeInTheDocument();
  });

  test("the rest of the drawer is as it was", () => {
    renderPanel({
      node: SWITCH_NODE,
      canRunDiagnostics: true,
      onHideNode: () => {},
    });

    expect(screen.getByText("Device details")).toBeInTheDocument();
    expect(
      screen.getByTestId("network-topology-hide-node"),
    ).toBeInTheDocument();
    expect(screen.getByText("Links (1)")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.1")).toBeInTheDocument();
  });

  test("the section sits above the Links list", () => {
    renderPanel({ node: SWITCH_NODE, canRunDiagnostics: true });

    const section: HTMLElement = screen.getByTestId(
      "network-topology-connectivity",
    );
    const links: HTMLElement = screen.getByText("Links (1)");

    // Not contained in the section, so the mask is exactly "following".
    expect(section.compareDocumentPosition(links)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});
