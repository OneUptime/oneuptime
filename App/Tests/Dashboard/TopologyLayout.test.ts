import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import { computeTopologyLayout } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyLayout";

const WIDTH: number = 1000;
const HEIGHT: number = 700;
const MARGIN: number = 48;

const sampleNodes: Array<NetworkTopologyNode> = [
  { id: "a", name: "Core Switch", isManaged: true, status: "up" },
  { id: "b", name: "Edge Router", isManaged: true, status: "down" },
  {
    id: "unmanaged:c",
    name: "Unknown Peer",
    isManaged: false,
    status: "unknown",
  },
];

const sampleEdges: Array<NetworkTopologyEdge> = [
  { fromNodeId: "a", toNodeId: "b" },
  { fromNodeId: "b", toNodeId: "unmanaged:c" },
];

describe("computeTopologyLayout", () => {
  test("returns finite, in-bounds coordinates for a 3-node/2-edge sample", () => {
    const layout: Map<string, { x: number; y: number }> = computeTopologyLayout(
      sampleNodes,
      sampleEdges,
      WIDTH,
      HEIGHT,
    );

    expect(layout.size).toBe(3);

    for (const node of sampleNodes) {
      const point: { x: number; y: number } | undefined = layout.get(node.id);
      expect(point).toBeDefined();
      expect(Number.isFinite(point!.x)).toBe(true);
      expect(Number.isFinite(point!.y)).toBe(true);
      expect(point!.x).toBeGreaterThanOrEqual(MARGIN);
      expect(point!.x).toBeLessThanOrEqual(WIDTH - MARGIN);
      expect(point!.y).toBeGreaterThanOrEqual(MARGIN);
      expect(point!.y).toBeLessThanOrEqual(HEIGHT - MARGIN);
    }
  });

  test("is deterministic — identical inputs yield identical coordinates", () => {
    const first: Map<string, { x: number; y: number }> = computeTopologyLayout(
      sampleNodes,
      sampleEdges,
      WIDTH,
      HEIGHT,
    );
    const second: Map<string, { x: number; y: number }> = computeTopologyLayout(
      sampleNodes,
      sampleEdges,
      WIDTH,
      HEIGHT,
    );

    for (const node of sampleNodes) {
      expect(first.get(node.id)).toEqual(second.get(node.id));
    }
  });

  test("returns an empty map for empty topology", () => {
    const layout: Map<string, { x: number; y: number }> = computeTopologyLayout(
      [],
      [],
      WIDTH,
      HEIGHT,
    );
    expect(layout.size).toBe(0);
  });
});
