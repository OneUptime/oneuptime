import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import NetworkTopology, {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "../../../Types/Monitor/SnmpMonitor/NetworkTopology";
import NetworkDeviceGraph, {
  ComponentProps as GraphProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkDeviceGraph";
import { TopologyPoint } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyGraphUtil";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ISSUE #6606: THE NETWORK MAP'S BRANCHES, SEARCH AND LAYOUTS, RENDERED.
 *
 * In the parent-and-child layout every device with something below it has
 * a control under its name that folds its branch away (and says "+6" once
 * folded), the map's controls fold or open the whole tree, a branch in
 * focus shows only that branch with the path back up, and many leaves hang
 * from a comb. In any layout a search says how many devices it matched,
 * steps through them and rings the one it is on, and a custom layout can be
 * set aside for the original one.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const device: (
  id: string,
  name: string,
  role: NetworkTopologyNode["role"],
) => NetworkTopologyNode = (
  id: string,
  name: string,
  role: NetworkTopologyNode["role"],
): NetworkTopologyNode => {
  return {
    id: id,
    name: name,
    role: role,
    isManaged: true,
    kind: "device",
    status: "up",
  };
};

const endpoint: (id: string, name: string) => NetworkTopologyNode = (
  id: string,
  name: string,
): NetworkTopologyNode => {
  return {
    id: id,
    name: name,
    isManaged: false,
    kind: "endpoint",
    status: "unknown",
  };
};

const NODES: Array<NetworkTopologyNode> = [
  device("core", "Core router", "router"),
  device("sw-a", "Switch A", "switch"),
  device("sw-b", "Switch B", "switch"),
];
const EDGES: Array<NetworkTopologyEdge> = [
  { fromNodeId: "core", toNodeId: "sw-a", protocols: ["lldp"] },
  { fromNodeId: "core", toNodeId: "sw-b", protocols: ["lldp"] },
];
for (let index: number = 1; index <= 6; index++) {
  NODES.push(endpoint(`till-${index}`, `Till ${index}`));
  EDGES.push({
    fromNodeId: "sw-a",
    toNodeId: `till-${index}`,
    protocols: ["fdb"],
  });
}
for (let index: number = 1; index <= 2; index++) {
  NODES.push(endpoint(`cam-${index}`, `Camera ${index}`));
  EDGES.push({
    fromNodeId: "sw-b",
    toNodeId: `cam-${index}`,
    protocols: ["fdb"],
  });
}

const TOPOLOGY: NetworkTopology = { nodes: NODES, edges: EDGES };

let onCollapsedNodeIdsChange: MockFunction;
let onFocusedBranchChange: MockFunction;
let onShowOriginalLayoutChange: MockFunction;

function renderMap(overrides?: Partial<GraphProps>): {
  rerender: (next?: Partial<GraphProps>) => void;
} {
  const propsFor: (next?: Partial<GraphProps>) => GraphProps = (
    next?: Partial<GraphProps>,
  ): GraphProps => {
    return {
      topology: TOPOLOGY,
      layoutMode: "parentChild",
      onCollapsedNodeIdsChange: (next: ReadonlySet<string>) => {
        onCollapsedNodeIdsChange(next);
      },
      onFocusedBranchChange: (nodeId: string | null) => {
        onFocusedBranchChange(nodeId);
      },
      onShowOriginalLayoutChange: (isShowing: boolean) => {
        onShowOriginalLayoutChange(isShowing);
      },
      ...overrides,
      ...next,
    };
  };
  const { rerender } = render(<NetworkDeviceGraph {...propsFor()} />);
  return {
    rerender: (next?: Partial<GraphProps>): void => {
      rerender(<NetworkDeviceGraph {...propsFor(next)} />);
    },
  };
}

function lastCollapsed(): Array<string> {
  const calls: Array<Array<unknown>> = onCollapsedNodeIdsChange.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return [...(calls[calls.length - 1]![0] as ReadonlySet<string>)].sort();
}

function nodeOpacity(nodeId: string): string | null {
  return screen
    .getByTestId(`network-topology-node-${nodeId}`)
    .getAttribute("opacity");
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: readLocale("de") },
      fa: { translation: readLocale("fa") },
      en: { translation: readLocale("en") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  onCollapsedNodeIdsChange = getJestMockFunction();
  onFocusedBranchChange = getJestMockFunction();
  onShowOriginalLayoutChange = getJestMockFunction();
  await i18next.changeLanguage("en");
});

afterEach(() => {
  cleanup();
});

describe("folding a branch from under its device", () => {
  test("every device with something below it has a control that folds it", () => {
    renderMap();
    for (const [id, name] of [
      ["core", "Core router"],
      ["sw-a", "Switch A"],
      ["sw-b", "Switch B"],
    ]) {
      const toggle: HTMLElement = screen.getByTestId(
        `network-topology-branch-toggle-${id}`,
      );
      expect(toggle).toHaveAttribute("role", "button");
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(toggle).toHaveAttribute("aria-label", `Collapse ${name}`);
      expect(toggle).toHaveAttribute("data-collapsed", "false");
    }
    // A device with nothing below it has none.
    expect(
      screen.queryByTestId("network-topology-branch-toggle-till-1"),
    ).not.toBeInTheDocument();
  });

  test("a click folds the branch", () => {
    renderMap();
    fireEvent.click(screen.getByTestId("network-topology-branch-toggle-sw-a"));
    expect(lastCollapsed()).toEqual(["sw-a"]);
  });

  test("Enter and Space fold it from the keyboard", () => {
    renderMap();
    const toggle: HTMLElement = screen.getByTestId(
      "network-topology-branch-toggle-sw-b",
    );
    fireEvent.keyDown(toggle, { key: "Enter" });
    expect(lastCollapsed()).toEqual(["sw-b"]);
    fireEvent.keyDown(toggle, { key: " " });
    expect(onCollapsedNodeIdsChange).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(toggle, { key: "a" });
    expect(onCollapsedNodeIdsChange).toHaveBeenCalledTimes(2);
  });

  test("a folded branch is drawn as its device and a count of what it holds", () => {
    renderMap({ collapsedNodeIds: new Set<string>(["sw-a"]) });
    const toggle: HTMLElement = screen.getByTestId(
      "network-topology-branch-toggle-sw-a",
    );
    expect(toggle).toHaveAttribute("data-collapsed", "true");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute(
      "aria-label",
      "Expand Switch A: 6 devices below it",
    );
    expect(toggle).toHaveTextContent("+6");
    for (let index: number = 1; index <= 6; index++) {
      expect(
        screen.queryByTestId(`network-topology-node-till-${index}`),
      ).not.toBeInTheDocument();
    }
    // Everything else is still there.
    expect(screen.getByTestId("network-topology-node-cam-1")).toBeVisible();
    expect(
      screen.getByTestId("network-topology-visible-count"),
    ).toHaveTextContent("Showing 5 of 11 devices");
    // Clicking it opens the branch again.
    fireEvent.click(toggle);
    expect(lastCollapsed()).toEqual([]);
  });

  test("the count says one device the way a sentence does", () => {
    const nodes: Array<NetworkTopologyNode> = [
      device("core", "Core router", "router"),
      device("sw", "Switch", "switch"),
      endpoint("ep", "Printer"),
    ];
    renderMap({
      topology: {
        nodes: nodes,
        edges: [
          { fromNodeId: "core", toNodeId: "sw" },
          { fromNodeId: "sw", toNodeId: "ep" },
        ],
      },
      collapsedNodeIds: new Set<string>(["sw"]),
    });
    expect(
      screen.getByTestId("network-topology-branch-toggle-sw"),
    ).toHaveAttribute("aria-label", "Expand Switch: 1 device below it");
  });

  test("a press on the control is not the start of a drag or a pan", () => {
    renderMap();
    const toggle: HTMLElement = screen.getByTestId(
      "network-topology-branch-toggle-sw-a",
    );
    fireEvent.pointerDown(toggle, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(toggle, { pointerId: 1, button: 0 });
    fireEvent.click(toggle);
    expect(onCollapsedNodeIdsChange).toHaveBeenCalledTimes(1);
  });

  test("focus from the keyboard is ringed; focus from a click is not", () => {
    const originalMatches: (selectors: string) => boolean =
      Element.prototype.matches;
    let isFocusVisible: boolean = true;
    Element.prototype.matches = function (selectors: string): boolean {
      if (selectors === ":focus-visible") {
        return isFocusVisible;
      }
      return originalMatches.call(this, selectors);
    };
    try {
      renderMap();
      const toggle: HTMLElement = screen.getByTestId(
        "network-topology-branch-toggle-sw-a",
      );
      fireEvent.focus(toggle);
      expect(
        screen.getByTestId("network-topology-branch-toggle-focus-sw-a"),
      ).toBeInTheDocument();
      fireEvent.blur(toggle);
      expect(
        screen.queryByTestId("network-topology-branch-toggle-focus-sw-a"),
      ).not.toBeInTheDocument();

      isFocusVisible = false;
      fireEvent.focus(toggle);
      expect(
        screen.queryByTestId("network-topology-branch-toggle-focus-sw-a"),
      ).not.toBeInTheDocument();
    } finally {
      Element.prototype.matches = originalMatches;
    }
  });

  test("in German, the controls are worded in German", async () => {
    await act(async () => {
      await i18next.changeLanguage("de");
    });
    renderMap({ collapsedNodeIds: new Set<string>(["sw-a"]) });
    expect(
      screen.getByTestId("network-topology-branch-toggle-sw-b"),
    ).toHaveAttribute("aria-label", "Switch B einklappen");
    expect(
      screen.getByTestId("network-topology-branch-toggle-sw-a"),
    ).toHaveAttribute("aria-label", "Switch A erweitern: 6 Geräte darunter");
    expect(screen.getByTestId("network-topology-collapse-all")).toHaveAttribute(
      "aria-label",
      "Alle Zweige einklappen",
    );
  });

  test("in Persian, the folded count is written in Persian digits", async () => {
    await act(async () => {
      await i18next.changeLanguage("fa");
    });
    renderMap({ collapsedNodeIds: new Set<string>(["sw-a"]) });
    expect(
      screen.getByTestId("network-topology-branch-toggle-sw-a"),
    ).toHaveTextContent("+۶");
  });
});

describe("folding and opening the whole tree", () => {
  test("Collapse all folds every branch below the top", () => {
    renderMap();
    const collapseAll: HTMLElement = screen.getByTestId(
      "network-topology-collapse-all",
    );
    expect(collapseAll).toHaveAttribute("aria-label", "Collapse all branches");
    expect(collapseAll).not.toBeDisabled();
    // Nothing is folded, so there is nothing to open.
    expect(screen.getByTestId("network-topology-expand-all")).toBeDisabled();
    fireEvent.click(collapseAll);
    expect(lastCollapsed()).toEqual(["sw-a", "sw-b"]);
  });

  test("Expand all opens everything; Collapse all has nothing more to fold", () => {
    renderMap({ collapsedNodeIds: new Set<string>(["sw-a", "sw-b"]) });
    expect(screen.getByTestId("network-topology-collapse-all")).toBeDisabled();
    fireEvent.click(screen.getByTestId("network-topology-expand-all"));
    expect(lastCollapsed()).toEqual([]);
  });

  test("other layouts draw no branches: no controls, and the folds change nothing", () => {
    renderMap({
      layoutMode: "force",
      collapsedNodeIds: new Set<string>(["sw-a"]),
    });
    expect(
      screen.queryByTestId("network-topology-collapse-all"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("network-topology-branch-toggles"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("network-topology-node-till-1")).toBeVisible();
  });
});

describe("many leaves hang from a comb", () => {
  test("the six tills under Switch A are wired by one comb path", () => {
    renderMap();
    const comb: HTMLElement = screen.getByTestId("network-topology-comb-sw-a");
    expect(comb.tagName.toLowerCase()).toBe("path");
    expect(comb.getAttribute("d")).toMatch(/^M [-\d.]+ [-\d.]+ L /);
    // Two cameras are a plain row, with no comb.
    expect(
      screen.queryByTestId("network-topology-comb-sw-b"),
    ).not.toBeInTheDocument();
  });

  test("folded away, the comb goes with the branch", () => {
    renderMap({ collapsedNodeIds: new Set<string>(["sw-a"]) });
    expect(
      screen.queryByTestId("network-topology-comb-sw-a"),
    ).not.toBeInTheDocument();
  });
});

describe("one branch on its own", () => {
  test("only the branch is drawn, under the path back up the tree", () => {
    renderMap({ focusedBranchNodeId: "sw-a" });
    expect(screen.getByTestId("network-topology-node-sw-a")).toBeVisible();
    expect(screen.getByTestId("network-topology-node-till-4")).toBeVisible();
    expect(
      screen.queryByTestId("network-topology-node-sw-b"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("network-topology-node-core"),
    ).not.toBeInTheDocument();

    const chip: HTMLElement = screen.getByTestId("network-topology-focus-chip");
    expect(chip).toHaveAttribute("aria-label", "Branch shown on the map");
    expect(within(chip).getByText("Switch A").closest("li")).toHaveAttribute(
      "aria-current",
      "location",
    );
    fireEvent.click(screen.getByTestId("network-topology-focus-ancestor-core"));
    expect(onFocusedBranchChange).toHaveBeenLastCalledWith("core");
    fireEvent.click(
      within(chip).getByRole("button", { name: "Show whole map" }),
    );
    expect(onFocusedBranchChange).toHaveBeenLastCalledWith(null);
  });

  test("a device with nothing below it, or one not on the map, narrows nothing", () => {
    renderMap({ focusedBranchNodeId: "till-1" });
    expect(
      screen.queryByTestId("network-topology-focus-chip"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("network-topology-node-sw-b")).toBeVisible();
    cleanup();
    renderMap({ focusedBranchNodeId: "gone" });
    expect(screen.getByTestId("network-topology-node-sw-b")).toBeVisible();
  });

  test("Collapse all and Expand all work inside the branch in focus only", () => {
    renderMap({
      focusedBranchNodeId: "sw-a",
      collapsedNodeIds: new Set<string>(["sw-b"]),
    });
    /*
     * Below Switch A nothing has a branch of its own to fold, and the fold
     * on Switch B is outside the branch: neither control would change
     * anything on screen.
     */
    expect(screen.getByTestId("network-topology-collapse-all")).toBeDisabled();
    expect(screen.getByTestId("network-topology-expand-all")).toBeDisabled();
  });

  test("narrowed to the top of the tree, Collapse all keeps the folds already made", () => {
    renderMap({
      focusedBranchNodeId: "core",
      collapsedNodeIds: new Set<string>(["sw-b"]),
    });
    fireEvent.click(screen.getByTestId("network-topology-collapse-all"));
    expect(lastCollapsed()).toEqual(["sw-a", "sw-b"]);
    cleanup();
    renderMap({
      focusedBranchNodeId: "core",
      collapsedNodeIds: new Set<string>(["sw-a", "sw-b"]),
    });
    fireEvent.click(screen.getByTestId("network-topology-expand-all"));
    expect(lastCollapsed()).toEqual([]);
  });

  test("other layouts draw no branches, so none is narrowed to", () => {
    renderMap({ layoutMode: "tiered", focusedBranchNodeId: "sw-a" });
    expect(screen.getByTestId("network-topology-node-sw-b")).toBeVisible();
    expect(
      screen.queryByTestId("network-topology-focus-chip"),
    ).not.toBeInTheDocument();
  });
});

describe("the original layout, with the custom one kept aside", () => {
  const moved: Map<string, TopologyPoint> = new Map<string, TopologyPoint>([
    ["sw-b", { x: 5, y: 7 }],
  ]);

  test("once something is moved, the reader can switch between the two", () => {
    renderMap({ positionOverrides: moved });
    const chip: HTMLElement = screen.getByTestId(
      "network-topology-custom-layout-chip",
    );
    const custom: HTMLElement = within(chip).getByTestId(
      "network-topology-show-custom-layout",
    );
    const original: HTMLElement = within(chip).getByTestId(
      "network-topology-show-original-layout",
    );
    expect(custom).toHaveTextContent("Custom layout · 1 moved");
    expect(custom).toHaveAttribute("aria-pressed", "true");
    expect(original).toHaveTextContent("Original layout");
    expect(original).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("network-topology-node-sw-b")).toHaveAttribute(
      "data-x",
      "5",
    );
    fireEvent.click(original);
    expect(onShowOriginalLayoutChange).toHaveBeenLastCalledWith(true);
  });

  test("shown, the moved device is back where the layout puts it, and Reset waits", () => {
    renderMap({ positionOverrides: moved, isShowingOriginalLayout: true });
    expect(
      screen.getByTestId("network-topology-show-original-layout"),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByTestId("network-topology-node-sw-b").getAttribute("data-x"),
    ).not.toBe("5");
    expect(screen.getByTestId("network-topology-reset-layout")).toBeDisabled();
    fireEvent.click(screen.getByTestId("network-topology-show-custom-layout"));
    expect(onShowOriginalLayoutChange).toHaveBeenLastCalledWith(false);
  });

  test("with nothing moved there is no choice to offer", () => {
    renderMap({ isShowingOriginalLayout: true });
    expect(
      screen.queryByTestId("network-topology-custom-layout-chip"),
    ).not.toBeInTheDocument();
  });
});

describe("search finds a device, and shows where it hangs", () => {
  test("the map says how many devices matched", () => {
    renderMap({ searchText: "Till" });
    expect(
      screen.getByTestId("network-topology-search-count"),
    ).toHaveTextContent("6 matches");
  });

  test("next and previous step through them and ring the one they are on", () => {
    renderMap({ searchText: "Till" });
    fireEvent.click(screen.getByTestId("network-topology-next-match"));
    expect(
      screen.getByTestId("network-topology-search-count"),
    ).toHaveTextContent("1 of 6");
    expect(screen.getAllByTestId(/^network-topology-located-/)).toHaveLength(1);
    fireEvent.click(screen.getByTestId("network-topology-previous-match"));
    fireEvent.click(screen.getByTestId("network-topology-previous-match"));
    expect(
      screen.getByTestId("network-topology-search-count"),
    ).toHaveTextContent("5 of 6");
  });

  test("Enter in the search box, from outside the map, steps to the next match", () => {
    const { rerender } = renderMap({
      searchText: "Camera",
      locateNextMatchRequest: 0,
    });
    rerender({ searchText: "Camera", locateNextMatchRequest: 1 });
    expect(
      screen.getByTestId("network-topology-search-count"),
    ).toHaveTextContent("1 of 2");
    rerender({ searchText: "Camera", locateNextMatchRequest: 2 });
    expect(
      screen.getByTestId("network-topology-search-count"),
    ).toHaveTextContent("2 of 2");
  });

  test("the path down to a match stays bright; the rest of the map fades", () => {
    renderMap({ searchText: "Till 3" });
    expect(nodeOpacity("till-3")).toBe("1");
    expect(nodeOpacity("sw-a")).toBe("1");
    expect(nodeOpacity("core")).toBe("1");
    expect(nodeOpacity("sw-b")).toBe("0.2");
    expect(nodeOpacity("till-4")).toBe("0.2");
  });

  test("a match inside a folded branch is said, with the way to bring it on", () => {
    renderMap({
      searchText: "Till 3",
      collapsedNodeIds: new Set<string>(["sw-a"]),
    });
    const chip: HTMLElement = screen.getByTestId(
      "network-topology-hidden-search-matches",
    );
    expect(chip).toHaveTextContent("1 match isn't shown");
    // The folded switch that holds it stays bright.
    expect(nodeOpacity("sw-a")).toBe("1");
    fireEvent.click(within(chip).getByRole("button", { name: "Show on map" }));
    expect(lastCollapsed()).toEqual([]);
  });

  test("matches on the map and in a folded branch: the folded ones are offered too", () => {
    renderMap({
      searchText: "Ti",
      collapsedNodeIds: new Set<string>(["sw-a"]),
      topology: {
        nodes: [...NODES, endpoint("cam-3", "Tiny camera")],
        edges: [
          ...EDGES,
          { fromNodeId: "sw-b", toNodeId: "cam-3", protocols: ["fdb"] },
        ],
      },
    });
    expect(
      screen.getByTestId("network-topology-search-count"),
    ).toHaveTextContent("1 match");
    fireEvent.click(screen.getByTestId("network-topology-show-hidden-matches"));
    expect(lastCollapsed()).toEqual([]);
  });

  test("a match outside the branch in focus widens the map back", () => {
    renderMap({ searchText: "Camera 2", focusedBranchNodeId: "sw-a" });
    fireEvent.click(screen.getByRole("button", { name: "Show on map" }));
    expect(onFocusedBranchChange).toHaveBeenLastCalledWith(null);
  });

  test("a search that matches nothing still says so", () => {
    renderMap({ searchText: "no such device" });
    expect(
      screen.getByTestId("network-topology-no-search-matches"),
    ).toHaveTextContent('Nothing matches "no such device"');
  });
});
