import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  endpointTooltipForNode,
  isEndpointNode,
  isFdbEdge,
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
});
