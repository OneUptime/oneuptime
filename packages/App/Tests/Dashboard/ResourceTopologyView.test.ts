import { describe, expect, test } from "@jest/globals";
import {
  ResourceTopologyGraph,
  ResourceTopologyNodeInput,
  buildResourceTopologyGraph,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyModel";
import {
  CARD_PREVIEW,
  CARD_PREVIEW_NARROWED,
  CHIP_MINIMUM,
  CHIP_PREVIEW,
  RELATED_LIMIT,
  ResourceTopologyCardItem,
  ResourceTopologyChipItem,
  ResourceTopologyGroupItem,
  ResourceTopologyOutlineRow,
  ResourceTopologyViewState,
  ResourceTopologyVisible,
  VIEW_BUDGET,
  closeTopologyPart,
  computeResourceTopologyView,
  createResourceTopologyViewState,
  drawnAsChips,
  flattenResourceTopologyView,
  getAutomaticDepth,
  getPartsOpenedWith,
  getTopologyKeyAction,
  getTopologyKeyTarget,
  groupKey,
  openTopologyPart,
  opensByItself,
  revealTopologyPart,
  toggleTopologyGroup,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyView";
import { SECTION_KIND } from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyKinds";

/*
 * What a resource topology shows: how deep it opens by itself, how a large
 * group folds into "+ N more" without ever folding away a problem, and how
 * "Needs attention", a search, a focus and a pinned part narrow the drawing.
 * The estates are shaped like the ones the view was designed for: a vCenter
 * of several datacenters and hundreds of virtual machines, a cluster with
 * thousands of pods.
 */

function part(
  id: string,
  parentId: string | null,
  overrides: Partial<ResourceTopologyNodeInput> = {},
): ResourceTopologyNodeInput {
  return {
    id: id,
    parentId: parentId,
    kind: overrides.kind || "vmware.vm",
    name: overrides.name || id,
    health: overrides.health || "healthy",
    ...overrides,
  };
}

interface EstateShape {
  datacenters: number;
  clustersPerDatacenter: number;
  hostsPerCluster: number;
  vmsPerHost: number;
  datastoresPerDatacenter: number;
  /* VM ids that are critical. */
  criticalVms?: Array<string> | undefined;
}

function vcenterEstate(shape: EstateShape): ResourceTopologyGraph {
  const nodes: Array<ResourceTopologyNodeInput> = [
    part("vcenter", null, { kind: "vmware.vcenter", name: "Prod" }),
  ];
  const critical: Set<string> = new Set<string>(shape.criticalVms || []);

  for (let dc: number = 0; dc < shape.datacenters; dc++) {
    const dcId: string = `dc-${dc}`;
    nodes.push(part(dcId, "vcenter", { kind: "vmware.datacenter" }));

    for (let ds: number = 0; ds < shape.datastoresPerDatacenter; ds++) {
      nodes.push(part(`${dcId}-ds-${ds}`, dcId, { kind: "vmware.datastore" }));
    }

    for (let cl: number = 0; cl < shape.clustersPerDatacenter; cl++) {
      const clusterId: string = `${dcId}-cl-${cl}`;
      nodes.push(part(clusterId, dcId, { kind: "vmware.cluster" }));

      for (let h: number = 0; h < shape.hostsPerCluster; h++) {
        const hostId: string = `${clusterId}-h-${h}`;
        nodes.push(part(hostId, clusterId, { kind: "vmware.host" }));

        for (let v: number = 0; v < shape.vmsPerHost; v++) {
          const vmId: string = `${hostId}-vm-${v}`;
          nodes.push(
            part(vmId, hostId, {
              kind: "vmware.vm",
              health: critical.has(vmId) ? "critical" : "healthy",
            }),
          );
        }
      }
    }
  }

  return buildResourceTopologyGraph({ rootId: "vcenter", nodes: nodes });
}

function findCard(
  card: ResourceTopologyCardItem,
  id: string,
): ResourceTopologyCardItem | null {
  if (card.id === id) {
    return card;
  }

  for (const group of card.groups) {
    for (const item of group.items) {
      if (item.type === "card") {
        const found: ResourceTopologyCardItem | null = findCard(item, id);

        if (found) {
          return found;
        }
      }
    }
  }

  return null;
}

function groupOf(
  card: ResourceTopologyCardItem,
  kind: string,
): ResourceTopologyGroupItem {
  const group: ResourceTopologyGroupItem | undefined = card.groups.find(
    (candidate: ResourceTopologyGroupItem): boolean => {
      return candidate.kind === kind;
    },
  );

  if (!group) {
    throw new Error(`${card.id} has no ${kind} group`);
  }

  return group;
}

function itemIds(group: ResourceTopologyGroupItem): Array<string> {
  return group.items.map(
    (item: ResourceTopologyCardItem | ResourceTopologyChipItem): string => {
      return item.id;
    },
  );
}

function view(
  graph: ResourceTopologyGraph,
  overrides?: Partial<ResourceTopologyViewState>,
): ResourceTopologyVisible {
  return computeResourceTopologyView(
    graph,
    createResourceTopologyViewState(overrides),
  );
}

describe("how deep a resource opens by itself", () => {
  test("a healthy resource opens what is alone where it sits, and leaves its healthy parts closed", () => {
    const graph: ResourceTopologyGraph = vcenterEstate({
      datacenters: 1,
      clustersPerDatacenter: 1,
      hostsPerCluster: 2,
      vmsPerHost: 3,
      datastoresPerDatacenter: 2,
    });
    const visible: ResourceTopologyVisible = view(graph);

    // One datacenter: the only part of the vCenter, so never a lone card.
    expect(findCard(visible.top, "dc-0")!.isOpen).toBe(true);
    // Its cluster has datastores beside it, and nothing wrong inside.
    const cluster: ResourceTopologyCardItem = findCard(
      visible.top,
      "dc-0-cl-0",
    )!;

    expect(cluster.isOpen).toBe(false);
    expect(cluster.canOpen).toBe(true);
    expect(visible.visibleNodeIds.has("dc-0-cl-0-h-0")).toBe(false);
  });

  test("a troubled branch opens down to the trouble; its healthy neighbours stay closed", () => {
    const graph: ResourceTopologyGraph = vcenterEstate({
      datacenters: 1,
      clustersPerDatacenter: 2,
      hostsPerCluster: 3,
      vmsPerHost: 4,
      datastoresPerDatacenter: 2,
      criticalVms: ["dc-0-cl-0-h-1-vm-2"],
    });
    const visible: ResourceTopologyVisible = view(graph);

    for (const open of ["dc-0", "dc-0-cl-0", "dc-0-cl-0-h-1"]) {
      expect({
        part: open,
        isOpen: findCard(visible.top, open)!.isOpen,
      }).toEqual({ part: open, isOpen: true });
    }

    for (const closed of ["dc-0-cl-1", "dc-0-cl-0-h-0", "dc-0-cl-0-h-2"]) {
      expect({
        part: closed,
        isOpen: findCard(visible.top, closed)!.isOpen,
      }).toEqual({ part: closed, isOpen: false });
    }

    // The critical virtual machine is on the map from the first view.
    expect(visible.visibleNodeIds.has("dc-0-cl-0-h-1-vm-2")).toBe(true);
  });

  test("a part opens by itself when something inside needs attention, or it is alone where it sits", () => {
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "root",
      nodes: [
        part("root", null, { kind: "vmware.vcenter" }),
        part("lonely", "root", { kind: "vmware.datacenter" }),
        part("calm", "lonely", { kind: "vmware.cluster" }),
        part("calm-vm", "calm"),
        part("sick", "lonely", { kind: "vmware.cluster" }),
        part("sick-vm", "sick", { health: "warning" }),
        part("bare", "lonely", { kind: "vmware.cluster", health: "critical" }),
      ],
    });

    expect(opensByItself(graph, graph.nodes.get("lonely")!)).toBe(true);
    expect(opensByItself(graph, graph.nodes.get("calm")!)).toBe(false);
    expect(opensByItself(graph, graph.nodes.get("sick")!)).toBe(true);
    // Critical itself but holding nothing: there is nothing to open.
    expect(opensByItself(graph, graph.nodes.get("bare")!)).toBe(false);
    // The only part of "calm", but it holds nothing.
    expect(opensByItself(graph, graph.nodes.get("calm-vm")!)).toBe(false);
  });

  test("a large resource stops opening before the drawing gets unreadable", () => {
    const graph: ResourceTopologyGraph = vcenterEstate({
      datacenters: 1,
      clustersPerDatacenter: 10,
      hostsPerCluster: 12,
      vmsPerHost: 30,
      datastoresPerDatacenter: 30,
    });
    const visible: ResourceTopologyVisible = view(graph);
    const weight: number = visible.cardCount + visible.chipCount / 2;

    expect(graph.nodes.size).toBeGreaterThan(3000);
    expect(weight).toBeLessThanOrEqual(VIEW_BUDGET + 2 * CARD_PREVIEW);
    // The datacenters are open, the clusters say what they hold instead.
    expect(findCard(visible.top, "dc-0")!.isOpen).toBe(true);
    expect(findCard(visible.top, "dc-0-cl-0")!.isOpen).toBe(false);
    expect(findCard(visible.top, "dc-0-cl-0")!.canOpen).toBe(true);
  });

  test("the top always opens, even when its first level alone is large", () => {
    const nodes: Array<ResourceTopologyNodeInput> = [
      part("root", null, { kind: "k8s.cluster" }),
    ];

    for (let index: number = 0; index < 500; index++) {
      nodes.push(part(`ns-${index}`, "root", { kind: "k8s.namespace" }));

      for (let pod: number = 0; pod < 20; pod++) {
        nodes.push(
          part(`pod-${index}-${pod}`, `ns-${index}`, { kind: "k8s.pod" }),
        );
      }
    }

    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "root",
      nodes: nodes,
    });

    expect(getAutomaticDepth(graph, "root")).toBe(1);
    const visible: ResourceTopologyVisible = view(graph);
    const namespaces: ResourceTopologyGroupItem = groupOf(
      visible.top,
      "k8s.namespace",
    );

    expect(namespaces.items).toHaveLength(CARD_PREVIEW);
    expect(namespaces.more?.hiddenCount).toBe(500 - CARD_PREVIEW);
  });

  test("a resource with nothing inside it opens no level", () => {
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "root",
      nodes: [part("root", null)],
    });

    expect(getAutomaticDepth(graph, "root")).toBe(0);
    expect(view(graph).top.canOpen).toBe(false);
  });
});

describe("groups fold, but never a problem", () => {
  const graph: ResourceTopologyGraph = vcenterEstate({
    datacenters: 1,
    clustersPerDatacenter: 1,
    hostsPerCluster: 1,
    vmsPerHost: 40,
    datastoresPerDatacenter: 0,
    criticalVms: ["dc-0-cl-0-h-0-vm-37", "dc-0-cl-0-h-0-vm-38"],
  });

  test("parts that hold nothing are chips, the rest folded into one '+ N more'", () => {
    const visible: ResourceTopologyVisible = view(graph);
    const vms: ResourceTopologyGroupItem = groupOf(
      findCard(visible.top, "dc-0-cl-0-h-0")!,
      "vmware.vm",
    );

    expect(vms.asChips).toBe(true);
    expect(vms.items).toHaveLength(CHIP_PREVIEW);
    expect(vms.total).toBe(40);
    expect(vms.more).toMatchObject({
      hiddenCount: 40 - CHIP_PREVIEW,
      asChip: true,
      canShowAll: true,
    });
  });

  test("the troubled ones come first, so they are never the ones folded away", () => {
    const visible: ResourceTopologyVisible = view(graph);
    const vms: ResourceTopologyGroupItem = groupOf(
      findCard(visible.top, "dc-0-cl-0-h-0")!,
      "vmware.vm",
    );

    expect(itemIds(vms).slice(0, 2)).toEqual([
      "dc-0-cl-0-h-0-vm-37",
      "dc-0-cl-0-h-0-vm-38",
    ]);
    expect(vms.attention).toBe(2);
    expect(vms.more?.hiddenAttention).toBe(0);
  });

  test("showing a group in full draws all of it, and folds back", () => {
    const key: string = groupKey("dc-0-cl-0-h-0", "vmware.vm");
    const full: ResourceTopologyViewState = toggleTopologyGroup(
      createResourceTopologyViewState(),
      key,
    );
    const vms: ResourceTopologyGroupItem = groupOf(
      findCard(computeResourceTopologyView(graph, full).top, "dc-0-cl-0-h-0")!,
      "vmware.vm",
    );

    expect(vms.items).toHaveLength(40);
    expect(vms.more).toBeNull();
    expect(vms.isShownInFull).toBe(true);
    expect(toggleTopologyGroup(full, key).shownInFull.has(key)).toBe(false);
  });

  test("a few parts with numbers stay cards; many, or ones without, are chips", () => {
    const capacity: Partial<ResourceTopologyNodeInput> = {
      kind: "vmware.datastore",
      facts: [{ label: "Capacity", value: "2 TB" }],
    };
    const few: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "root",
      nodes: [
        part("root", null),
        part("a", "root", capacity),
        part("b", "root", capacity),
      ],
    });
    const many: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "root",
      nodes: [
        part("root", null),
        part("a", "root", capacity),
        part("b", "root", capacity),
        part("c", "root", capacity),
      ],
    });
    const bare: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "root",
      nodes: [
        part("root", null),
        part("a", "root", { kind: "vmware.resourcepool" }),
      ],
    });

    expect(CHIP_MINIMUM).toBe(3);
    expect(groupOf(view(few).top, "vmware.datastore").asChips).toBe(false);
    expect(groupOf(view(few).top, "vmware.datastore").items[0]!.type).toBe(
      "card",
    );
    expect(groupOf(view(many).top, "vmware.datastore").asChips).toBe(true);
    // A card would only repeat a chip's name and status, larger.
    expect(groupOf(view(bare).top, "vmware.resourcepool").asChips).toBe(true);
  });

  test("a part that holds something is never a chip", () => {
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "root",
      nodes: [part("root", null)],
    });

    expect(
      drawnAsChips([graph.nodes.get("root")!], (): boolean => {
        return false;
      }),
    ).toBe(false);
  });

  test("kinds keep the catalog's order: clusters before datastores", () => {
    const visible: ResourceTopologyVisible = view(
      vcenterEstate({
        datacenters: 1,
        clustersPerDatacenter: 2,
        hostsPerCluster: 1,
        vmsPerHost: 1,
        datastoresPerDatacenter: 4,
      }),
    );

    expect(
      findCard(visible.top, "dc-0")!.groups.map(
        (group: ResourceTopologyGroupItem): string => {
          return group.kind;
        },
      ),
    ).toEqual(["vmware.cluster", "vmware.datastore"]);
  });

  test("cards only drawn because a group was shown in full wait to be opened", () => {
    const wide: ResourceTopologyGraph = vcenterEstate({
      datacenters: 1,
      clustersPerDatacenter: 1,
      hostsPerCluster: 12,
      vmsPerHost: 2,
      datastoresPerDatacenter: 0,
    });
    const key: string = groupKey("dc-0-cl-0", "vmware.host");
    const visible: ResourceTopologyVisible = computeResourceTopologyView(
      wide,
      toggleTopologyGroup(createResourceTopologyViewState(), key),
    );
    const hosts: ResourceTopologyGroupItem = groupOf(
      findCard(visible.top, "dc-0-cl-0")!,
      "vmware.host",
    );

    expect(hosts.items).toHaveLength(12);
    const opened: Array<boolean> = hosts.items.map(
      (item: ResourceTopologyCardItem | ResourceTopologyChipItem): boolean => {
        return item.type === "card" && item.isOpen;
      },
    );
    // The previewed ones follow the automatic depth; the rest are closed.
    expect(opened.slice(CARD_PREVIEW).every(Boolean)).toBe(false);
  });
});

describe("opening and closing", () => {
  const graph: ResourceTopologyGraph = vcenterEstate({
    datacenters: 1,
    clustersPerDatacenter: 6,
    hostsPerCluster: 12,
    vmsPerHost: 20,
    datastoresPerDatacenter: 30,
  });

  test("the first view opens the datacenter and leaves its clusters closed", () => {
    const visible: ResourceTopologyVisible = view(graph);

    expect(visible.automaticDepth).toBe(2);
    expect(findCard(visible.top, "dc-0")!.isOpen).toBe(true);
    expect(findCard(visible.top, "dc-0-cl-0")!.isOpen).toBe(false);
  });

  test("opening a part opens what fits inside it, by the same rule", () => {
    const opened: ResourceTopologyViewState = openTopologyPart(
      graph,
      createResourceTopologyViewState(),
      "dc-0-cl-0",
    );
    const cluster: ResourceTopologyCardItem = findCard(
      computeResourceTopologyView(graph, opened).top,
      "dc-0-cl-0",
    )!;

    expect(cluster.isOpen).toBe(true);
    expect(groupOf(cluster, "vmware.host").items).toHaveLength(CARD_PREVIEW);
    // Its hosts' virtual machines would not fit OPEN_BUDGET: they stay closed.
    expect(findCard(cluster, "dc-0-cl-0-h-0")!.isOpen).toBe(false);
    expect(opened.opened).toEqual(new Set<string>(["dc-0-cl-0"]));
    expect(getPartsOpenedWith(graph, "dc-0-cl-0")).toContain("dc-0-cl-0");
  });

  test("a host opened by itself shows its virtual machines", () => {
    const opened: ResourceTopologyViewState = openTopologyPart(
      graph,
      openTopologyPart(graph, createResourceTopologyViewState(), "dc-0-cl-0"),
      "dc-0-cl-0-h-0",
    );
    const host: ResourceTopologyCardItem = findCard(
      computeResourceTopologyView(graph, opened).top,
      "dc-0-cl-0-h-0",
    )!;

    expect(host.isOpen).toBe(true);
    expect(groupOf(host, "vmware.vm").items).toHaveLength(CHIP_PREVIEW);
  });

  test("a part someone opened stays open whatever the canvas allows", () => {
    const opened: ResourceTopologyViewState = openTopologyPart(
      graph,
      createResourceTopologyViewState(),
      "dc-0",
    );
    const visible: ResourceTopologyVisible = computeResourceTopologyView(
      graph,
      opened,
      { maxAutomaticDepth: 1 },
    );
    const automatic: ResourceTopologyVisible = computeResourceTopologyView(
      graph,
      createResourceTopologyViewState(),
      { maxAutomaticDepth: 1 },
    );

    expect(visible.automaticDepth).toBe(1);
    expect(findCard(visible.top, "dc-0")!.isOpen).toBe(true);
    expect(findCard(automatic.top, "dc-0")!.isOpen).toBe(false);
  });

  test("a smaller canvas opens fewer levels, never none", () => {
    expect(
      computeResourceTopologyView(graph, createResourceTopologyViewState(), {
        maxAutomaticDepth: 0,
      }).top.isOpen,
    ).toBe(true);
    expect(
      computeResourceTopologyView(graph, createResourceTopologyViewState(), {
        maxAutomaticDepth: 5,
      }).automaticDepth,
    ).toBe(2);
    expect(
      computeResourceTopologyView(graph, createResourceTopologyViewState(), {
        budget: 4,
      }).automaticDepth,
    ).toBe(1);
  });

  test("closing a part keeps it closed whatever the automatic depth says", () => {
    const closed: ResourceTopologyViewState = closeTopologyPart(
      createResourceTopologyViewState(),
      "dc-0",
    );
    const dc: ResourceTopologyCardItem = findCard(
      computeResourceTopologyView(graph, closed).top,
      "dc-0",
    )!;

    expect(dc.isOpen).toBe(false);
    expect(dc.groups).toEqual([]);
  });

  test("reopening a closed part forgets that it was closed", () => {
    const state: ResourceTopologyViewState = openTopologyPart(
      graph,
      closeTopologyPart(createResourceTopologyViewState(), "dc-0"),
      "dc-0",
    );

    expect(state.closed.has("dc-0")).toBe(false);
    expect(
      findCard(computeResourceTopologyView(graph, state).top, "dc-0")!.isOpen,
    ).toBe(true);
  });
});

describe("going to a part pins it", () => {
  const graph: ResourceTopologyGraph = vcenterEstate({
    datacenters: 1,
    clustersPerDatacenter: 12,
    hostsPerCluster: 12,
    vmsPerHost: 30,
    datastoresPerDatacenter: 0,
  });

  test("every part above it opens and it is drawn even inside a folded group", () => {
    const target: string = "dc-0-cl-11-h-11-vm-29";
    const state: ResourceTopologyViewState = revealTopologyPart(
      graph,
      createResourceTopologyViewState(),
      target,
    );
    const visible: ResourceTopologyVisible = computeResourceTopologyView(
      graph,
      state,
    );

    expect(visible.visibleNodeIds.has(target)).toBe(true);
    expect(findCard(visible.top, "dc-0-cl-11")!.isOpen).toBe(true);
    expect(findCard(visible.top, "dc-0-cl-11-h-11")!.isOpen).toBe(true);

    const vms: ResourceTopologyGroupItem = groupOf(
      findCard(visible.top, "dc-0-cl-11-h-11")!,
      "vmware.vm",
    );

    // The pinned VM joins the preview; it pushes none of the others out.
    expect(vms.items).toHaveLength(CHIP_PREVIEW + 1);
    expect(itemIds(vms)).toContain(target);
  });

  test("a part that is not there pins nothing", () => {
    const state: ResourceTopologyViewState = createResourceTopologyViewState();

    expect(revealTopologyPart(graph, state, "gone")).toBe(state);
  });
});

describe("Needs attention", () => {
  const graph: ResourceTopologyGraph = vcenterEstate({
    datacenters: 2,
    clustersPerDatacenter: 4,
    hostsPerCluster: 8,
    vmsPerHost: 20,
    datastoresPerDatacenter: 10,
    criticalVms: ["dc-1-cl-3-h-7-vm-19", "dc-0-cl-0-h-0-vm-0"],
  });

  test("keeps only the troubled parts and the path to each, opened", () => {
    const visible: ResourceTopologyVisible = view(graph, {
      filter: "attention",
    });

    expect(visible.isNarrowed).toBe(true);
    expect(Array.from(visible.visibleNodeIds).sort()).toEqual(
      [
        "vcenter",
        "dc-0",
        "dc-0-cl-0",
        "dc-0-cl-0-h-0",
        "dc-0-cl-0-h-0-vm-0",
        "dc-1",
        "dc-1-cl-3",
        "dc-1-cl-3-h-7",
        "dc-1-cl-3-h-7-vm-19",
      ].sort(),
    );
    expect(visible.attentionShown).toBe(2);
  });

  test("with nothing troubled, only the resource is left", () => {
    const quiet: ResourceTopologyGraph = vcenterEstate({
      datacenters: 1,
      clustersPerDatacenter: 1,
      hostsPerCluster: 1,
      vmsPerHost: 3,
      datastoresPerDatacenter: 1,
    });
    const visible: ResourceTopologyVisible = view(quiet, {
      filter: "attention",
    });

    expect(Array.from(visible.visibleNodeIds)).toEqual(["vcenter"]);
    expect(visible.top.canOpen).toBe(false);
  });
});

describe("search", () => {
  const graph: ResourceTopologyGraph = vcenterEstate({
    datacenters: 1,
    clustersPerDatacenter: 3,
    hostsPerCluster: 4,
    vmsPerHost: 40,
    datastoresPerDatacenter: 2,
  });

  test("keeps the matches and the path to them, everything else out", () => {
    const visible: ResourceTopologyVisible = view(graph, {
      search: "cl-2-h-3-vm-17",
    });

    expect(visible.matchCount).toBe(1);
    expect(visible.visibleNodeIds.has("dc-0-cl-2-h-3-vm-17")).toBe(true);
    expect(visible.visibleNodeIds.has("dc-0-cl-1")).toBe(false);
    expect(visible.visibleNodeIds.has("dc-0-ds-0")).toBe(false);
    const vm: ResourceTopologyChipItem = groupOf(
      findCard(visible.top, "dc-0-cl-2-h-3")!,
      "vmware.vm",
    ).items[0] as ResourceTopologyChipItem;

    expect(vm.isMatch).toBe(true);
  });

  test("shows more matches per group than an unfiltered view does", () => {
    const visible: ResourceTopologyVisible = view(graph, { search: "vm-1" });
    const vms: ResourceTopologyGroupItem = groupOf(
      findCard(visible.top, "dc-0-cl-0-h-0")!,
      "vmware.vm",
    );

    // vm-1 and vm-10 ... vm-19
    expect(vms.total).toBe(11);
    expect(vms.items).toHaveLength(11);
    expect(CARD_PREVIEW_NARROWED).toBeGreaterThan(CARD_PREVIEW);
  });

  test("a matched part can be opened to see what is inside it", () => {
    const named: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "vcenter",
      nodes: [
        part("vcenter", null, { kind: "vmware.vcenter" }),
        part("esx", "vcenter", { kind: "vmware.host", name: "esx-payments" }),
        ...Array.from({ length: 30 }, (_value: unknown, index: number) => {
          return part(`vm-${index}`, "esx", { name: `guest-${index}` });
        }),
      ],
    });
    const state: ResourceTopologyViewState = createResourceTopologyViewState({
      search: "payments",
    });
    const closedMatch: ResourceTopologyCardItem = findCard(
      computeResourceTopologyView(named, state).top,
      "esx",
    )!;

    expect(closedMatch.isMatch).toBe(true);
    // The VMs inside it do not match, but the host can still open.
    expect(closedMatch.canOpen).toBe(true);
    expect(closedMatch.isOpen).toBe(false);

    const opened: ResourceTopologyCardItem = findCard(
      computeResourceTopologyView(named, openTopologyPart(named, state, "esx"))
        .top,
      "esx",
    )!;

    expect(opened.isOpen).toBe(true);
    expect(groupOf(opened, "vmware.vm").total).toBe(30);
  });

  test("a host found by its name is the one match; what runs on it is drawn inside it", () => {
    // Each virtual machine's line names the host it runs on.
    const named: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "vcenter",
      nodes: [
        part("vcenter", null, { kind: "vmware.vcenter" }),
        part("esx", "vcenter", {
          kind: "vmware.host",
          name: "esx101.ams.acme.example",
        }),
        part("esx-2", "vcenter", {
          kind: "vmware.host",
          name: "esx102.ams.acme.example",
        }),
        ...Array.from({ length: 9 }, (_value: unknown, index: number) => {
          return part(`vm-${index}`, "esx", {
            name: `guest-${index}`,
            context: "esx101.ams.acme.example",
          });
        }),
      ],
    });
    const visible: ResourceTopologyVisible = view(named, {
      search: "esx101",
    });
    const host: ResourceTopologyCardItem = findCard(visible.top, "esx")!;

    // "1 part matches your search", and only the host is marked as a match.
    expect(visible.matchCount).toBe(1);
    expect(host.isMatch).toBe(true);
    // Its machines are drawn inside it, open, but not marked one by one.
    expect(host.isOpen).toBe(true);
    const guests: ResourceTopologyGroupItem = groupOf(host, "vmware.vm");

    expect(guests.total).toBe(9);
    expect(
      guests.items.some(
        (item: ResourceTopologyCardItem | ResourceTopologyChipItem) => {
          return item.isMatch;
        },
      ),
    ).toBe(false);
    // The other host is not drawn.
    expect(visible.visibleNodeIds.has("esx-2")).toBe(false);
  });

  test("a search with no match leaves only the resource", () => {
    const visible: ResourceTopologyVisible = view(graph, {
      search: "nothing-like-this",
    });

    expect(visible.matchCount).toBe(0);
    expect(Array.from(visible.visibleNodeIds)).toEqual(["vcenter"]);
  });

  test("search and Needs attention together keep troubled matches only", () => {
    const troubled: ResourceTopologyGraph = vcenterEstate({
      datacenters: 1,
      clustersPerDatacenter: 1,
      hostsPerCluster: 1,
      vmsPerHost: 30,
      datastoresPerDatacenter: 0,
      criticalVms: ["dc-0-cl-0-h-0-vm-12"],
    });
    const visible: ResourceTopologyVisible = view(troubled, {
      search: "vm-1",
      filter: "attention",
    });

    expect(visible.visibleNodeIds.has("dc-0-cl-0-h-0-vm-12")).toBe(true);
    expect(visible.visibleNodeIds.has("dc-0-cl-0-h-0-vm-13")).toBe(false);
  });
});

describe("focus", () => {
  function relatedEstate(relatedCount: number): ResourceTopologyGraph {
    const nodes: Array<ResourceTopologyNodeInput> = [
      part("cluster", null, { kind: "k8s.cluster" }),
      part("nodes", "cluster", {
        kind: "section",
        isSection: true,
        name: "Nodes",
      }),
      part("ns", "cluster", { kind: "k8s.namespace" }),
      part("deploy", "ns", { kind: "k8s.deployment" }),
      part("other-deploy", "ns", { kind: "k8s.deployment" }),
      part("other-pod", "other-deploy", { kind: "k8s.pod" }),
    ];
    const relations: Array<{
      from: string;
      to: string;
      label: string;
      inverseLabel: string;
    }> = [];

    for (let index: number = 0; index < relatedCount; index++) {
      nodes.push(part(`node-${index}`, "nodes", { kind: "k8s.node" }));
      nodes.push(part(`pod-${index}`, "deploy", { kind: "k8s.pod" }));
      relations.push({
        from: `pod-${index}`,
        to: `node-${index}`,
        label: "Runs on",
        inverseLabel: "Runs here",
      });
    }

    relations.push({
      from: "deploy",
      to: "node-0",
      label: "Runs on",
      inverseLabel: "Runs here",
    });

    return buildResourceTopologyGraph({
      rootId: "cluster",
      nodes: nodes,
      relations: relations,
    });
  }

  test("draws the lineage, the part and everything inside it — nothing else", () => {
    const graph: ResourceTopologyGraph = relatedEstate(3);
    const visible: ResourceTopologyVisible = view(graph, {
      focusId: "deploy",
    });

    expect(visible.focusId).toBe("deploy");
    expect(visible.visibleNodeIds.has("other-deploy")).toBe(false);
    expect(visible.visibleNodeIds.has("other-pod")).toBe(false);
    expect(visible.visibleNodeIds.has("pod-2")).toBe(true);
    expect(findCard(visible.top, "deploy")!.isFocus).toBe(true);
    // The lineage shows one part per level: the path only.
    expect(visible.top.groups).toHaveLength(1);
    expect(groupOf(visible.top, "k8s.namespace").items).toHaveLength(1);
  });

  test("draws what the focused part is related to beside it", () => {
    const graph: ResourceTopologyGraph = relatedEstate(1);
    const visible: ResourceTopologyVisible = view(graph, {
      focusId: "deploy",
    });

    expect(visible.related).toEqual([
      { nodeId: "node-0", label: "Runs on", direction: "out" },
    ]);
    expect(visible.visibleNodeIds.has("node-0")).toBe(true);
  });

  test("draws at most RELATED_LIMIT related parts and counts the rest", () => {
    const graph: ResourceTopologyGraph = relatedEstate(RELATED_LIMIT + 5);
    const visible: ResourceTopologyVisible = view(graph, {
      focusId: "node-0",
    });

    expect(visible.related.length).toBeLessThanOrEqual(RELATED_LIMIT);
    // node-0 runs pod-0 and the deployment: both related, both shown.
    expect(
      visible.related.map((item: { nodeId: string }): string => {
        return item.nodeId;
      }),
    ).toEqual(expect.arrayContaining(["pod-0", "deploy"]));
  });

  test("a focus on the resource itself, or on a part that is gone, is no focus", () => {
    const graph: ResourceTopologyGraph = relatedEstate(2);

    expect(view(graph, { focusId: "cluster" }).focusId).toBeNull();
    expect(view(graph, { focusId: "gone" }).focusId).toBeNull();
  });

  test("filters narrow inside the focused part only", () => {
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "root",
      nodes: [
        part("root", null),
        part("a", "root", { kind: "vmware.host" }),
        part("a-bad", "a", { health: "critical" }),
        part("b", "root", { kind: "vmware.host" }),
        part("b-bad", "b", { health: "critical" }),
      ],
    });
    const visible: ResourceTopologyVisible = view(graph, {
      focusId: "a",
      filter: "attention",
    });

    expect(visible.visibleNodeIds.has("a-bad")).toBe(true);
    expect(visible.visibleNodeIds.has("b-bad")).toBe(false);
  });
});

describe("a first view with room to spare opens healthy parts too", () => {
  const graph: ResourceTopologyGraph = vcenterEstate({
    datacenters: 2,
    clustersPerDatacenter: 2,
    hostsPerCluster: 2,
    vmsPerHost: 2,
    datastoresPerDatacenter: 1,
  });

  test("with opensAll, every part within the depth opens, healthy or not", () => {
    const calm: ResourceTopologyVisible = computeResourceTopologyView(
      graph,
      createResourceTopologyViewState(),
      { maxAutomaticDepth: 2 },
    );
    const all: ResourceTopologyVisible = computeResourceTopologyView(
      graph,
      createResourceTopologyViewState(),
      { maxAutomaticDepth: 2, opensAll: true },
    );

    expect(findCard(calm.top, "dc-0")!.isOpen).toBe(false);
    expect(findCard(all.top, "dc-0")!.isOpen).toBe(true);
    expect(findCard(all.top, "dc-1")!.isOpen).toBe(true);
    // Only as deep as asked: the clusters stay closed.
    expect(findCard(all.top, "dc-0-cl-0")!.isOpen).toBe(false);
  });

  test("the depth a budget allows counts healthy parts when they open too", () => {
    expect(getAutomaticDepth(graph, "vcenter")).toBe(1);
    expect(
      getAutomaticDepth(graph, "vcenter", VIEW_BUDGET, true),
    ).toBeGreaterThan(1);
  });

  test("a part a person closed stays closed, room or not", () => {
    const visible: ResourceTopologyVisible = computeResourceTopologyView(
      graph,
      closeTopologyPart(createResourceTopologyViewState(), "dc-1"),
      { maxAutomaticDepth: 3, opensAll: true },
    );

    expect(findCard(visible.top, "dc-1")!.isOpen).toBe(false);
    expect(findCard(visible.top, "dc-0")!.isOpen).toBe(true);
  });
});

describe("opening a part opens the way to its trouble with it", () => {
  test("its troubled parts open with it; its healthy ones stay closed", () => {
    const graph: ResourceTopologyGraph = vcenterEstate({
      datacenters: 2,
      clustersPerDatacenter: 1,
      hostsPerCluster: 4,
      vmsPerHost: 3,
      datastoresPerDatacenter: 0,
      criticalVms: ["dc-1-cl-0-h-2-vm-1"],
    });
    expect(getPartsOpenedWith(graph, "dc-1-cl-0")).toEqual([
      "dc-1-cl-0",
      "dc-1-cl-0-h-2",
    ]);

    // Opening the datacenter opens its cluster and the host in trouble.
    const state: ResourceTopologyViewState = openTopologyPart(
      graph,
      createResourceTopologyViewState(),
      "dc-1",
    );

    expect(state.opened).toEqual(
      new Set<string>(["dc-1", "dc-1-cl-0", "dc-1-cl-0-h-2"]),
    );

    const visible: ResourceTopologyVisible = computeResourceTopologyView(
      graph,
      state,
      { maxAutomaticDepth: 1 },
    );

    expect(findCard(visible.top, "dc-1-cl-0-h-2")!.isOpen).toBe(true);
    expect(findCard(visible.top, "dc-1-cl-0-h-0")!.isOpen).toBe(false);
    expect(findCard(visible.top, "dc-0")!.isOpen).toBe(false);
  });
});

describe("a map about calls: lanes always open, every call's ends shown", () => {
  function hostGraph(): ResourceTopologyGraph {
    const nodes: Array<ResourceTopologyNodeInput> = [
      part("host", null, { kind: "entity:Host" }),
      part("callers", "host", {
        kind: SECTION_KIND,
        isSection: true,
        name: "Called by",
      }),
      part("caller", "callers", { kind: "entity:Service" }),
    ];

    for (let index: number = 0; index < 12; index++) {
      nodes.push(
        part(`container-${index}`, "host", { kind: "entity:Container" }),
      );

      for (let service: number = 0; service < 3; service++) {
        nodes.push(
          part(`service-${index}-${service}`, `container-${index}`, {
            kind: "entity:Service",
          }),
        );
      }
    }

    return buildResourceTopologyGraph({
      rootId: "host",
      nodes: nodes,
      relations: [
        {
          from: "caller",
          to: "service-11-2",
          label: "Calls",
          inverseLabel: "Called by",
        },
      ],
    });
  }

  test("a lane's section is open whatever the depth, and even when closed", () => {
    const graph: ResourceTopologyGraph = hostGraph();
    const always: ReadonlySet<string> = new Set<string>(["callers"]);
    const visible: ResourceTopologyVisible = computeResourceTopologyView(
      graph,
      closeTopologyPart(createResourceTopologyViewState(), "callers"),
      { maxAutomaticDepth: 1, alwaysOpen: always },
    );

    expect(findCard(visible.top, "callers")!.isOpen).toBe(true);
    expect(visible.visibleNodeIds.has("caller")).toBe(true);
    expect(
      findCard(
        computeResourceTopologyView(graph, createResourceTopologyViewState(), {
          maxAutomaticDepth: 1,
        }).top,
        "callers",
      )!.isOpen,
    ).toBe(false);
  });

  test("a part at the end of a call is shown, its container opened, even past the preview", () => {
    const graph: ResourceTopologyGraph = hostGraph();
    const visible: ResourceTopologyVisible = computeResourceTopologyView(
      graph,
      createResourceTopologyViewState(),
      { maxAutomaticDepth: 1, reveal: ["caller", "service-11-2"] },
    );

    // container-11 is past the eight-card preview, yet drawn and open.
    expect(findCard(visible.top, "container-11")!.isOpen).toBe(true);
    expect(visible.visibleNodeIds.has("service-11-2")).toBe(true);
    // A reveal is not a pin a person made.
    expect(createResourceTopologyViewState().pinned.size).toBe(0);
  });

  test("a person can still close the part a revealed one is in", () => {
    const graph: ResourceTopologyGraph = hostGraph();
    const visible: ResourceTopologyVisible = computeResourceTopologyView(
      graph,
      closeTopologyPart(createResourceTopologyViewState(), "container-11"),
      { reveal: ["service-11-2"] },
    );

    expect(findCard(visible.top, "container-11")!.isOpen).toBe(false);
    expect(visible.visibleNodeIds.has("service-11-2")).toBe(false);
  });
});

describe("what each card and group tells the map", () => {
  const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
    rootId: "array",
    nodes: [
      part("array", null, { kind: "storage.array" }),
      part("hardware", "array", {
        kind: SECTION_KIND,
        isSection: true,
        name: "Hardware",
      }),
      ...Array.from({ length: 30 }, (_value: unknown, index: number) => {
        return part(`drive-${index}`, "hardware", {
          kind: "storage.drive",
          health: index === 29 ? "critical" : "healthy",
        });
      }),
    ],
  });

  test("a group lists every part it holds, drawn or folded, in the order it draws them", () => {
    const visible: ResourceTopologyVisible = view(graph);
    const drives: ResourceTopologyGroupItem = groupOf(
      findCard(visible.top, "hardware")!,
      "storage.drive",
    );

    expect(drives.memberIds).toHaveLength(30);
    // The critical drive leads, so the map's line to it is red.
    expect(drives.memberIds[0]).toBe("drive-29");
    expect(drives.items.length).toBeLessThan(drives.memberIds.length);
    expect(drives.memberIds.slice(0, drives.items.length)).toEqual(
      itemIds(drives),
    );
  });

  test("a card says whether it is a section", () => {
    const visible: ResourceTopologyVisible = view(graph);

    expect(findCard(visible.top, "hardware")!.isSection).toBe(true);
    expect(visible.top.isSection).toBe(false);
  });
});

describe("moving through the map from the keyboard", () => {
  // One datacenter: open by itself; two clusters, one open; datastores as chips.
  const graph: ResourceTopologyGraph = vcenterEstate({
    datacenters: 1,
    clustersPerDatacenter: 2,
    hostsPerCluster: 2,
    vmsPerHost: 2,
    datastoresPerDatacenter: 14,
    criticalVms: ["dc-0-cl-0-h-0-vm-0"],
  });
  const visible: ResourceTopologyVisible = view(graph);
  const dc: ResourceTopologyCardItem = findCard(visible.top, "dc-0")!;
  const datastores: ResourceTopologyGroupItem = groupOf(dc, "vmware.datastore");

  test("down and up go between the parts side by side, group after group", () => {
    // Clusters first (catalog order), then the datastores.
    expect(getTopologyKeyAction(visible, "dc-0-cl-0", "next")).toEqual({
      type: "move",
      itemId: "dc-0-cl-1",
    });
    expect(getTopologyKeyAction(visible, "dc-0-cl-1", "next")).toEqual({
      type: "move",
      itemId: "dc-0-ds-0",
    });
    expect(getTopologyKeyAction(visible, "dc-0-ds-0", "previous")).toEqual({
      type: "move",
      itemId: "dc-0-cl-1",
    });
    expect(getTopologyKeyAction(visible, "dc-0-cl-0", "previous")).toBeNull();
  });

  test("a group's '+ N more' is reached like a part, and nothing is past the last", () => {
    const more: string = datastores.more!.id;
    const lastChip: string = itemIds(datastores)[datastores.items.length - 1]!;

    expect(getTopologyKeyAction(visible, lastChip, "next")).toEqual({
      type: "move",
      itemId: more,
    });
    expect(getTopologyKeyAction(visible, more, "next")).toBeNull();
    expect(getTopologyKeyAction(visible, "dc-0-cl-0", "last")).toEqual({
      type: "move",
      itemId: more,
    });
    expect(getTopologyKeyAction(visible, more, "first")).toEqual({
      type: "move",
      itemId: "dc-0-cl-0",
    });
    expect(getTopologyKeyAction(visible, more, "back")).toEqual({
      type: "move",
      itemId: "dc-0",
    });
  });

  test("forward opens a closed part, and goes into an open one", () => {
    expect(findCard(visible.top, "dc-0-cl-1")!.isOpen).toBe(false);
    expect(getTopologyKeyAction(visible, "dc-0-cl-1", "forward")).toEqual({
      type: "open",
      nodeId: "dc-0-cl-1",
    });
    expect(getTopologyKeyAction(visible, "dc-0-cl-0", "forward")).toEqual({
      type: "move",
      itemId: "dc-0-cl-0-h-0",
    });
    expect(getTopologyKeyAction(visible, "vcenter", "forward")).toEqual({
      type: "move",
      itemId: "dc-0",
    });
    // A datastore holds nothing: forward goes nowhere.
    expect(getTopologyKeyAction(visible, "dc-0-ds-0", "forward")).toBeNull();
  });

  test("back closes an open part, then goes out to what holds it; the resource stays", () => {
    expect(getTopologyKeyAction(visible, "dc-0-cl-0", "back")).toEqual({
      type: "close",
      nodeId: "dc-0-cl-0",
    });
    expect(getTopologyKeyAction(visible, "dc-0-cl-1", "back")).toEqual({
      type: "move",
      itemId: "dc-0",
    });
    expect(getTopologyKeyAction(visible, "dc-0-ds-3", "back")).toEqual({
      type: "move",
      itemId: "dc-0",
    });
    expect(getTopologyKeyAction(visible, "vcenter", "back")).toBeNull();
    expect(getTopologyKeyAction(visible, "vcenter", "next")).toBeNull();
  });

  test("a part that is not drawn goes nowhere", () => {
    expect(getTopologyKeyAction(visible, "dc-0-cl-1-h-0", "next")).toBeNull();
    expect(getTopologyKeyAction(visible, "gone", "forward")).toBeNull();
  });

  test("an item the map draws no button for is passed over, on in the same direction", () => {
    // As if the second cluster and the first datastore were lanes' headings.
    const noButton: Set<string> = new Set<string>(["dc-0-cl-1", "dc-0-ds-0"]);
    const hasButton: (id: string) => boolean = (id: string): boolean => {
      return !noButton.has(id);
    };

    expect(
      getTopologyKeyTarget(visible, "dc-0-cl-0", "next", hasButton),
    ).toEqual({ type: "move", itemId: "dc-0-ds-1" });
    expect(
      getTopologyKeyTarget(visible, "dc-0-ds-1", "previous", hasButton),
    ).toEqual({ type: "move", itemId: "dc-0-cl-0" });
    // Opening and closing are not moves: nothing to pass over.
    expect(
      getTopologyKeyTarget(visible, "dc-0-cl-0", "back", hasButton),
    ).toEqual({ type: "close", nodeId: "dc-0-cl-0" });
    // With every item drawn, it is the plain move.
    expect(
      getTopologyKeyTarget(visible, "dc-0-cl-0", "next", (): boolean => {
        return true;
      }),
    ).toEqual(getTopologyKeyAction(visible, "dc-0-cl-0", "next"));
  });

  test("back out of a part whose holder has no button goes on out", () => {
    const hasButton: (id: string) => boolean = (id: string): boolean => {
      return id !== "dc-0";
    };

    // The datastore's holder, dc-0, has no button: on out to the vCenter.
    expect(
      getTopologyKeyTarget(visible, "dc-0-ds-3", "back", hasButton),
    ).toEqual({ type: "move", itemId: "vcenter" });
    // With nothing drawn at all, a key goes nowhere, and stops.
    expect(
      getTopologyKeyTarget(visible, "dc-0-cl-0", "next", (): boolean => {
        return false;
      }),
    ).toBeNull();
  });
});

describe("the list reads the same view top down", () => {
  test("every card, group heading, chip and '+ N more', each one level deeper", () => {
    const graph: ResourceTopologyGraph = vcenterEstate({
      datacenters: 1,
      clustersPerDatacenter: 1,
      hostsPerCluster: 1,
      vmsPerHost: 14,
      datastoresPerDatacenter: 0,
    });
    const rows: Array<ResourceTopologyOutlineRow> = flattenResourceTopologyView(
      view(graph),
    );

    expect(rows[0]!.item.id).toBe("vcenter");
    expect(rows[0]!.level).toBe(0);
    expect(rows[1]!.item.type).toBe("group");
    expect(rows[1]!.level).toBe(1);
    expect(rows[2]!.item.id).toBe("dc-0");
    expect(rows[2]!.level).toBe(2);

    const more: ResourceTopologyOutlineRow | undefined = rows.find(
      (row: ResourceTopologyOutlineRow): boolean => {
        return row.item.type === "more";
      },
    );

    expect(more).toBeDefined();
    expect(
      rows.filter((row: ResourceTopologyOutlineRow): boolean => {
        return row.item.type === "chip";
      }),
    ).toHaveLength(CHIP_PREVIEW);
  });
});
