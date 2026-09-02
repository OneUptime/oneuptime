import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  endpointTooltipForNode,
  isEndpointNode,
  isFdbEdge,
  isInferredEdge,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/EndpointNodeUtil";

describe("isEndpointNode", () => {
  test("true only for kind === 'endpoint'", () => {
    const endpoint: NetworkTopologyNode = {
      id: "endpoint:aa",
      name: "pos-1",
      isManaged: false,
      status: "unknown",
      kind: "endpoint",
    };
    const device: NetworkTopologyNode = {
      id: "device-1",
      name: "core",
      isManaged: true,
      status: "up",
      kind: "device",
    };
    const unmanaged: NetworkTopologyNode = {
      id: "unmanaged:x",
      name: "peer",
      isManaged: false,
      status: "unknown",
      kind: "unmanaged",
    };
    expect(isEndpointNode(endpoint)).toBe(true);
    expect(isEndpointNode(device)).toBe(false);
    expect(isEndpointNode(unmanaged)).toBe(false);
  });

  test("legacy nodes without a kind are never endpoints", () => {
    const legacy: NetworkTopologyNode = {
      id: "device-legacy",
      name: "old payload",
      isManaged: false,
      status: "unknown",
    };
    expect(isEndpointNode(legacy)).toBe(false);
  });
});

describe("isFdbEdge", () => {
  const base: NetworkTopologyEdge = { fromNodeId: "a", toNodeId: "b" };

  test("true when protocols include 'fdb'", () => {
    expect(isFdbEdge({ ...base, protocols: ["fdb"] })).toBe(true);
    expect(isFdbEdge({ ...base, protocols: ["lldp", "fdb"] })).toBe(true);
  });

  test("false for discovery-protocol and legacy edges", () => {
    expect(isFdbEdge({ ...base, protocols: ["lldp"] })).toBe(false);
    expect(isFdbEdge({ ...base, protocols: ["lldp", "cdp"] })).toBe(false);
    expect(isFdbEdge({ ...base, protocols: [] })).toBe(false);
    // Legacy payloads carry no protocols at all.
    expect(isFdbEdge(base)).toBe(false);
  });

  test("STILL true for an inferred uplink — deliberately, do not 'fix' this", () => {
    /*
     * Issue #3489. An inferred edge carries "fdb" too, because the
     * forwarding database genuinely is where its evidence came from, and
     * the tier heuristics that read isFdbEdge draw a BETTER map for it: a
     * ping-monitored till with an unknown role belongs one level under the
     * core, which is exactly where an FDB edge puts it.
     *
     * Narrowing this to "fdb without inferred" would silently move every
     * inferred uplink up a tier, so it is pinned here rather than left to
     * somebody's reading of the word "fdb".
     */
    expect(isFdbEdge({ ...base, protocols: ["fdb", "inferred"] })).toBe(true);
    expect(
      isFdbEdge({ ...base, protocols: ["manual", "fdb", "inferred"] }),
    ).toBe(true);
  });
});

describe("isInferredEdge", () => {
  const base: NetworkTopologyEdge = { fromNodeId: "a", toNodeId: "b" };

  test("true when protocols include 'inferred'", () => {
    expect(isInferredEdge({ ...base, protocols: ["fdb", "inferred"] })).toBe(
      true,
    );
    expect(
      isInferredEdge({ ...base, protocols: ["manual", "fdb", "inferred"] }),
    ).toBe(true);
  });

  test("false for a plain FDB attachment", () => {
    /*
     * The distinction this function exists for: an "fdb" edge on its own
     * runs to an anonymous MAC on a port, while an inferred one runs
     * between two managed devices. Anything that styles or describes an
     * edge as "a MAC learned on a port" has to ask this, not isFdbEdge.
     */
    expect(isInferredEdge({ ...base, protocols: ["fdb"] })).toBe(false);
  });

  test("false for discovery-protocol, manual and legacy edges", () => {
    expect(isInferredEdge({ ...base, protocols: ["lldp"] })).toBe(false);
    expect(isInferredEdge({ ...base, protocols: ["lldp", "cdp"] })).toBe(false);
    expect(isInferredEdge({ ...base, protocols: ["manual"] })).toBe(false);
    expect(isInferredEdge({ ...base, protocols: [] })).toBe(false);
    // Legacy payloads carry no protocols at all.
    expect(isInferredEdge(base)).toBe(false);
    expect(isInferredEdge({ ...base, protocols: undefined })).toBe(false);
  });
});

describe("endpointTooltipForNode", () => {
  const base: NetworkTopologyNode = {
    id: "endpoint:aa",
    name: "pos-1",
    isManaged: false,
    status: "unknown",
    kind: "endpoint",
  };

  test("joins every present identity field in order", () => {
    expect(
      endpointTooltipForNode({
        ...base,
        macAddress: "aa:bb:cc:dd:ee:ff",
        ipAddress: "10.0.0.12",
        vendor: "Zebra",
        classification: "printer",
      }),
    ).toBe(
      "pos-1 (endpoint) — aa:bb:cc:dd:ee:ff · 10.0.0.12 · Zebra · printer",
    );
  });

  test("skips absent fields without leaving separators behind", () => {
    expect(
      endpointTooltipForNode({
        ...base,
        macAddress: "aa:bb:cc:dd:ee:ff",
        classification: "camera",
      }),
    ).toBe("pos-1 (endpoint) — aa:bb:cc:dd:ee:ff · camera");
  });

  test("name-only endpoints get no dangling dash", () => {
    expect(endpointTooltipForNode(base)).toBe("pos-1 (endpoint)");
  });

  test("appends 'VLAN <n>' when the endpoint carries a vlanId", () => {
    expect(
      endpointTooltipForNode({
        ...base,
        macAddress: "aa:bb:cc:dd:ee:ff",
        ipAddress: "10.0.0.12",
        vendor: "Zebra",
        classification: "printer",
        vlanId: 12,
      }),
    ).toBe(
      "pos-1 (endpoint) — aa:bb:cc:dd:ee:ff · 10.0.0.12 · Zebra · printer · VLAN 12",
    );
  });

  test("VLAN 0 still renders (0 is a valid VLAN id, not 'absent')", () => {
    expect(
      endpointTooltipForNode({
        ...base,
        vlanId: 0,
      }),
    ).toBe("pos-1 (endpoint) — VLAN 0");
  });

  test("VLAN-only identity gets no leading separator", () => {
    expect(
      endpointTooltipForNode({
        ...base,
        vlanId: 42,
      }),
    ).toBe("pos-1 (endpoint) — VLAN 42");
  });
});
