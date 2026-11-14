import { describe, expect, test } from "@jest/globals";
import { NetworkTopologyNode } from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import MonitorNotCheckedReason from "Common/Types/Monitor/MonitorNotCheckedReason";
import { monitorNotCheckedForNode } from "../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyMeta";
import {
  ALL_NODE_KINDS,
  TopologyNodeView,
  TopologyViewModel,
  buildTopologyViewModel,
  statusNoteForNode,
} from "../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyViewModel";
import {
  MONITOR_ARCHIVED_QUALIFIER,
  MONITORING_OFF_QUALIFIER,
  getMonitorNotCheckedQualifier,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusUtil";
import { TopologyPoint } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyGraphUtil";

/*
 * ISSUE #7346: THE NETWORK MAP SAYS WHY A DEVICE READS "UNKNOWN".
 *
 * A monitor-backed device whose bound monitor is turned off or archived has
 * no status: the map draws it "unknown". The device pages put a gray
 * "Monitoring off" or "Monitor archived" pill beside its Pending, with the
 * ways out; the map's drawer said "Unknown" and nothing else. Each device
 * node now carries the reason (NetworkTopologyNode.monitorNotChecked), and
 * these are the rules the drawer and the node's tooltip read it with: only
 * beside "unknown", only for a managed device, only what the payload says in
 * full - and in the device pages' own words.
 */

const MONITOR_ID: string = "66666666-6666-4666-8666-666666666666";

function makeNode(
  overrides?: Partial<NetworkTopologyNode>,
): NetworkTopologyNode {
  return {
    id: "d1",
    name: "branch-ap",
    isManaged: true,
    status: "unknown",
    kind: "device",
    monitorNotChecked: {
      monitorId: MONITOR_ID,
      reason: MonitorNotCheckedReason.MonitoringOff,
    },
    ...overrides,
  };
}

describe("getMonitorNotCheckedQualifier", () => {
  test("monitoring off: the device pages' Monitoring off", () => {
    expect(
      getMonitorNotCheckedQualifier(MonitorNotCheckedReason.MonitoringOff),
    ).toBe(MONITORING_OFF_QUALIFIER);
  });

  test("archived: the device pages' Monitor archived", () => {
    expect(
      getMonitorNotCheckedQualifier(MonitorNotCheckedReason.MonitorArchived),
    ).toBe(MONITOR_ARCHIVED_QUALIFIER);
  });

  // A reason from a newer server is not guessed at.
  test.each([
    { label: "an unknown word", reason: "monitorDeleted" },
    { label: "a different case", reason: "MonitoringOff" },
    { label: "an empty string", reason: "" },
    { label: "null", reason: null },
    { label: "undefined", reason: undefined },
  ])("$label: none", ({ reason }: { reason: string | null | undefined }) => {
    expect(getMonitorNotCheckedQualifier(reason)).toBeNull();
  });
});

describe("monitorNotCheckedForNode", () => {
  test.each([
    MonitorNotCheckedReason.MonitoringOff,
    MonitorNotCheckedReason.MonitorArchived,
  ])(
    "an unknown managed device whose monitor is not checked (%s): its monitor and reason",
    (reason: MonitorNotCheckedReason) => {
      expect(
        monitorNotCheckedForNode(
          makeNode({ monitorNotChecked: { monitorId: MONITOR_ID, reason } }),
        ),
      ).toEqual({ monitorId: MONITOR_ID, reason });
    },
  );

  test("a node from an older payload, with no kind, is a device", () => {
    const node: NetworkTopologyNode = makeNode();
    delete node.kind;

    expect(monitorNotCheckedForNode(node)).toEqual({
      monitorId: MONITOR_ID,
      reason: MonitorNotCheckedReason.MonitoringOff,
    });
  });

  test("the monitor id is trimmed", () => {
    expect(
      monitorNotCheckedForNode(
        makeNode({
          monitorNotChecked: {
            monitorId: `  ${MONITOR_ID}  `,
            reason: MonitorNotCheckedReason.MonitorArchived,
          },
        }),
      )?.monitorId,
    ).toBe(MONITOR_ID);
  });

  test("a node that carries nothing: nothing", () => {
    expect(
      monitorNotCheckedForNode(makeNode({ monitorNotChecked: undefined })),
    ).toBeUndefined();
  });

  /*
   * Only beside "unknown", as the device hero shows the qualifier only
   * beside Pending: a node that still has a status shows that status.
   */
  test.each(["up", "down"] as const)(
    "a node drawn %s: nothing beside it",
    (status: "up" | "down") => {
      expect(monitorNotCheckedForNode(makeNode({ status }))).toBeUndefined();
    },
  );

  test.each([
    { label: "an unmanaged neighbour", overrides: { isManaged: false } },
    {
      label: "an unmanaged node",
      overrides: { kind: "unmanaged" as const },
    },
    {
      label: "a discovered endpoint",
      overrides: { kind: "endpoint" as const, isManaged: false },
    },
  ])(
    "$label: nothing",
    ({ overrides }: { overrides: Partial<NetworkTopologyNode> }) => {
      expect(monitorNotCheckedForNode(makeNode(overrides))).toBeUndefined();
    },
  );

  test.each([
    { label: "an empty monitor id", monitorId: "", reason: "monitoringOff" },
    { label: "a blank monitor id", monitorId: "   ", reason: "monitoringOff" },
    {
      label: "a monitor id that is not a string",
      monitorId: 7,
      reason: "monitoringOff",
    },
    {
      label: "a reason this Dashboard does not know",
      monitorId: MONITOR_ID,
      reason: "monitorDeleted",
    },
    { label: "no reason", monitorId: MONITOR_ID, reason: undefined },
  ])(
    "$label: nothing, rather than a guess",
    ({ monitorId, reason }: { monitorId: unknown; reason: unknown }) => {
      expect(
        monitorNotCheckedForNode(
          makeNode({
            monitorNotChecked: {
              monitorId,
              reason,
            } as unknown as NetworkTopologyNode["monitorNotChecked"],
          }),
        ),
      ).toBeUndefined();
    },
  );
});

describe("statusNoteForNode", () => {
  test("monitoring off: the device pages' Pending sentence for it", () => {
    expect(statusNoteForNode(makeNode())).toBe(
      MONITORING_OFF_QUALIFIER.pendingTooltip,
    );
    expect(statusNoteForNode(makeNode())).toBe(
      "Nothing checks this device — monitoring is turned off for the monitor bound to it.",
    );
  });

  test("archived: the device pages' Pending sentence for it", () => {
    expect(
      statusNoteForNode(
        makeNode({
          monitorNotChecked: {
            monitorId: MONITOR_ID,
            reason: MonitorNotCheckedReason.MonitorArchived,
          },
        }),
      ),
    ).toBe(MONITOR_ARCHIVED_QUALIFIER.pendingTooltip);
  });

  test("a checked device, and a device still drawn with a status: none", () => {
    expect(
      statusNoteForNode(makeNode({ monitorNotChecked: undefined })),
    ).toBeUndefined();
    expect(statusNoteForNode(makeNode({ status: "down" }))).toBeUndefined();
  });
});

describe("buildTopologyViewModel - a node's status note", () => {
  test("each node view carries its own note, and only the node not checked has one", () => {
    const nodes: Array<NetworkTopologyNode> = [
      makeNode({ id: "off", name: "ap-off" }),
      makeNode({
        id: "archived",
        name: "ap-archived",
        monitorNotChecked: {
          monitorId: MONITOR_ID,
          reason: MonitorNotCheckedReason.MonitorArchived,
        },
      }),
      makeNode({
        id: "checked",
        name: "ap-checked",
        status: "up",
        monitorNotChecked: undefined,
      }),
      makeNode({
        id: "plain-unknown",
        name: "ap-unknown",
        monitorNotChecked: undefined,
      }),
    ];
    const positions: Map<string, TopologyPoint> = new Map<
      string,
      TopologyPoint
    >();
    nodes.forEach((node: NetworkTopologyNode, index: number) => {
      positions.set(node.id, { x: index * 100, y: 0 });
    });

    const model: TopologyViewModel = buildTopologyViewModel({
      nodes,
      edges: [],
      positions,
      searchText: "",
      visibleKinds: ALL_NODE_KINDS,
      healthFilterMode: "all",
      focusNodeIds: new Set<string>(),
      selectedNodeId: null,
      selectedEdgeKey: null,
      pinnedNodeIds: new Set<string>(),
    });

    const noteById: Map<string, string | undefined> = new Map<
      string,
      string | undefined
    >();
    model.nodes.forEach((view: TopologyNodeView) => {
      noteById.set(view.id, view.statusNote);
    });

    expect(noteById.get("off")).toBe(MONITORING_OFF_QUALIFIER.pendingTooltip);
    expect(noteById.get("archived")).toBe(
      MONITOR_ARCHIVED_QUALIFIER.pendingTooltip,
    );
    expect(noteById.get("checked")).toBeUndefined();
    expect(noteById.get("plain-unknown")).toBeUndefined();

    // The tooltip's own first line is unchanged: the note is a line of its own.
    const offView: TopologyNodeView | undefined = model.nodes.find(
      (view: TopologyNodeView): boolean => {
        return view.id === "off";
      },
    );
    expect(offView?.tooltip).not.toContain("Nothing checks");
  });
});
