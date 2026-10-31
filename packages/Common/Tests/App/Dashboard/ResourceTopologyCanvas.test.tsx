import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { Edge, EdgeTypes, Node, NodeTypes } from "reactflow";
import ResourceTopologyMap, {
  ResourceTopologyArrangement,
  getLaneViewOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyMap";
import {
  ResourceTopologyGraph,
  ResourceTopologyNodeInput,
  buildResourceTopologyGraph,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyModel";
import { SECTION_KIND } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyKinds";
import {
  InsideHealthBar,
  ResourceTopologyHeadingWords,
  StatusLine,
  TOPOLOGY_DETAIL_CLASS,
  TOPOLOGY_TOGGLE_CLASS,
  createTopologyHeadingMeasure,
  getTopologyHeadingWords,
  getTopologyToggleColors,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyNodes";
import {
  CANVAS_RULES,
  RELATED_SPINE_OFFSET,
  getRelatedBranchPoints,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyCanvas";
import { RESOURCE_TOPOLOGY_SELECTED_COLOR } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyLook";
import { ResourceTopologyGroupItem } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyView";
import { ResourceTopologyHeadingWidth } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyLayout";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * The map a person reads - the customer's "box inside a box" redrawn as a
 * tree of cards joined by lines - in jsdom. React Flow cannot lay anything
 * out here, so it is replaced by a stand-in that draws every node with the
 * map's own node components and every line with its own edge components,
 * in the order React Flow is handed them. Everything else is the real
 * page: the view, the layout, the cards, their buttons and the keys.
 *
 * What the browser suite (packages/E2E/ResourceTopology) checks instead:
 * where things land on screen, framing, zoom and the real React Flow.
 */

interface MockFlowProps {
  nodes: Array<Node>;
  edges: Array<Edge>;
  nodeTypes: NodeTypes;
  edgeTypes: EdgeTypes;
  children?: React.ReactNode;
}

let mockFlow: MockFlowProps | null = null;
let mockZoom: number = 1;
let mockControls: Record<string, unknown> | null = null;

jest.mock("reactflow", () => {
  return {
    __esModule: true,
    MarkerType: { ArrowClosed: "arrowclosed" },
    BackgroundVariant: { Dots: "dots" },
    Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
    Background: () => {
      return null;
    },
    Controls: (props: Record<string, unknown>) => {
      mockControls = props;

      return null;
    },
    Handle: () => {
      return null;
    },
    BaseEdge: () => {
      return null;
    },
    useNodesInitialized: (): boolean => {
      return false;
    },
    useReactFlow: () => {
      return {
        fitView: (): boolean => {
          return true;
        },
        setViewport: (): void => {},
      };
    },
    useStoreApi: () => {
      return {
        getState: () => {
          return {
            domNode: null,
            nodeInternals: new Map(),
            panBy: (): void => {},
          };
        },
      };
    },
    useStore: (
      selector: (state: { transform: [number, number, number] }) => unknown,
    ): unknown => {
      return selector({ transform: [0, 0, mockZoom] });
    },
    default: (props: MockFlowProps) => {
      mockFlow = props;

      return (
        <div data-testid="mock-flow">
          {props.nodes.map((node: Node) => {
            const NodeComponent: React.ComponentType<{
              id: string;
              data: unknown;
              type: string;
            }> = props.nodeTypes[node.type || ""] as React.ComponentType<{
              id: string;
              data: unknown;
              type: string;
            }>;

            return (
              <div
                key={node.id}
                className="react-flow__node"
                data-node-id={node.id}
                data-x={String(node.position.x)}
                data-y={String(node.position.y)}
              >
                <NodeComponent
                  id={node.id}
                  data={node.data}
                  type={node.type || ""}
                />
              </div>
            );
          })}
          <svg>
            {props.edges.map((edge: Edge) => {
              const EdgeComponent: React.ComponentType<{
                id: string;
                source: string;
                target: string;
                data: unknown;
              }> = props.edgeTypes[edge.type || ""] as React.ComponentType<{
                id: string;
                source: string;
                target: string;
                data: unknown;
              }>;

              return (
                <EdgeComponent
                  key={edge.id}
                  id={edge.id}
                  source={edge.source}
                  target={edge.target}
                  data={edge.data}
                />
              );
            })}
          </svg>
          {props.children}
        </div>
      );
    },
  };
});

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

/*
 * vcenter-prod
 *   Amsterdam (datacenter, the only one: open by itself)
 *     ams-prod (cluster that needs attention, a critical host inside: open)
 *       esx-1 (critical, holds 2 virtual machines)
 *       esx-2 (healthy, holds 1)
 *     ams-dev (cluster, healthy: closed)
 *       esx-3 (holds 1)
 *     ssd-1 ... ssd-3 (datastores: chips)
 */
function vcenterGraph(): ResourceTopologyGraph {
  return buildResourceTopologyGraph({
    rootId: "vc",
    nodes: [
      part("vc", null, { kind: "vmware.vcenter", name: "vcenter-prod" }),
      part("ams", "vc", { kind: "vmware.datacenter", name: "Amsterdam" }),
      part("ams-prod", "ams", {
        kind: "vmware.cluster",
        name: "ams-prod",
        health: "warning",
        status: { text: "1 of 2 hosts effective" },
      }),
      part("esx-1", "ams-prod", {
        kind: "vmware.host",
        name: "esx-1",
        health: "critical",
        status: { text: "Not responding" },
        facts: [
          { label: "CPU", value: "97%", tone: "critical" },
          { label: "Memory", value: "40%" },
          { label: "Disk", value: "10%" },
        ],
      }),
      part("vm-1", "esx-1", { name: "web-01" }),
      part("vm-2", "esx-1", { name: "db-01" }),
      part("esx-2", "ams-prod", { kind: "vmware.host", name: "esx-2" }),
      part("vm-3", "esx-2", { name: "cache-01" }),
      part("ams-dev", "ams", { kind: "vmware.cluster", name: "ams-dev" }),
      part("esx-3", "ams-dev", { kind: "vmware.host", name: "esx-3" }),
      part("vm-4", "esx-3", { name: "build-01" }),
      part("ssd-1", "ams", { kind: "vmware.datastore", name: "ssd-1" }),
      part("ssd-2", "ams", { kind: "vmware.datastore", name: "ssd-2" }),
      part("ssd-3", "ams", { kind: "vmware.datastore", name: "ssd-3" }),
    ],
  });
}

/* A host whose service is called from outside and calls a database. */
function hostGraph(): ResourceTopologyGraph {
  return buildResourceTopologyGraph({
    rootId: "host",
    nodes: [
      part("host", null, { kind: "entity:Host", name: "web-01" }),
      part("container", "host", { kind: "entity:Container", name: "api" }),
      part("checkout", "container", {
        kind: "entity:Service",
        name: "checkout",
      }),
      part("callers", "host", {
        kind: SECTION_KIND,
        isSection: true,
        name: "Called by",
      }),
      part("mobile", "callers", { kind: "entity:Service", name: "mobile" }),
      part("calls", "host", {
        kind: SECTION_KIND,
        isSection: true,
        name: "Talks to",
      }),
      part("db", "calls", { kind: "entity:Service", name: "orders-db" }),
    ],
    relations: [
      {
        from: "mobile",
        to: "checkout",
        label: "Calls",
        inverseLabel: "Called by",
        detail: "120/min",
      },
      {
        from: "checkout",
        to: "db",
        label: "Calls",
        inverseLabel: "Called by",
        detail: "80/min",
        health: "critical",
      },
    ],
  });
}

function renderMap(
  arrangements: Array<ResourceTopologyArrangement> = [
    { id: "vcenter", label: "Hosts and clusters", graph: vcenterGraph() },
  ],
): void {
  render(
    <MemoryRouter>
      <ResourceTopologyMap
        arrangements={arrangements}
        searchPlaceholder="Find a host, virtual machine or datastore…"
      />
    </MemoryRouter>,
  );
}

function card(id: string): HTMLElement {
  return screen.getByTestId(`resource-topology-card-${id}`);
}

// The button that picks a part: its card's main button, or its chip.
function partButton(id: string): HTMLElement {
  return (
    screen.queryByTestId(`resource-topology-select-${id}`) ||
    screen.getByTestId(`resource-topology-chip-${id}`)
  );
}

function focusedItem(): string | null {
  return (document.activeElement as HTMLElement | null)?.getAttribute(
    "data-topology-item",
  ) as string | null;
}

function press(key: string, options: Partial<KeyboardEventInit> = {}): void {
  fireEvent.keyDown(document.activeElement as HTMLElement, {
    key: key,
    ...options,
  });
}

function branchTone(target: string): string | null {
  return screen
    .getByTestId(`resource-topology-branch-${target}`)
    .getAttribute("data-tone");
}

beforeEach(() => {
  mockFlow = null;
  mockZoom = 1;
  mockControls = null;
  document.documentElement.removeAttribute("dir");
  window.history.replaceState({}, "", "/topology");
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
});

describe("every part is a card of its own, joined by lines - never a box inside a box", () => {
  test("parts are cards side by side on the map; nothing is drawn inside another", () => {
    renderMap();

    for (const id of ["vc", "ams", "ams-prod", "esx-1", "esx-2", "ams-dev"]) {
      expect(card(id)).toBeVisible();
    }

    // No part's card holds another part's card, or any box at all.
    const cards: Array<HTMLElement> = screen.getAllByTestId(
      /^resource-topology-card-/,
    );

    for (const outer of cards) {
      for (const inner of cards) {
        if (outer !== inner) {
          expect(outer.contains(inner)).toBe(false);
        }
      }
    }

    expect(screen.queryAllByTestId(/^resource-topology-box-/)).toHaveLength(0);
    // Each card is a node of its own; headings are nodes of their own.
    expect(
      mockFlow!.nodes.filter((node: Node): boolean => {
        return node.type === "resourceTopologyHeading";
      }).length,
    ).toBeGreaterThan(0);
  });

  test("a group is a heading that says what is under it and what needs attention", () => {
    renderMap();
    const clusters: HTMLElement = screen.getByTestId(
      "resource-topology-group-ams|vmware.cluster",
    );

    expect(clusters).toHaveTextContent("Clusters");
    expect(clusters).toHaveTextContent("2");
    expect(clusters).toHaveTextContent("1 needs attention");
    // The datastores hold nothing: small chips under their heading.
    expect(
      screen.getByTestId("resource-topology-group-ams|vmware.datastore"),
    ).toHaveTextContent("Datastores");
    expect(screen.getByTestId("resource-topology-chip-ssd-1")).toBeVisible();
  });

  test("the way to trouble is open from the start; a healthy branch is one closed card", () => {
    renderMap();

    expect(card("ams-prod")).toHaveAttribute("data-open", "true");
    expect(card("esx-1")).toHaveAttribute("data-health", "critical");
    // ams-dev is healthy: closed, saying what it holds.
    expect(card("ams-dev")).toHaveAttribute("data-open", "false");
    expect(card("ams-dev")).toHaveTextContent("1 ESXi Host");
    expect(screen.queryByTestId("resource-topology-card-esx-3")).toBeNull();
  });

  test("a part that holds others has a bar of how its insides are doing", () => {
    renderMap();
    const bar: HTMLElement = within(card("ams-prod")).getByTestId(
      "resource-topology-inside-bar",
    );
    const segments: Array<string | null> = Array.from(
      bar.querySelectorAll("[data-health]"),
    ).map((segment: Element): string | null => {
      return segment.getAttribute("data-health");
    });

    // esx-1 is critical; esx-2 and three virtual machines are healthy.
    expect(segments).toEqual(["critical", "healthy"]);
    expect(bar).toHaveAttribute("title", "Critical 1 · Healthy 4");
    expect(bar).toHaveAttribute("aria-hidden", "true");
  });
});

describe("opening and closing a part", () => {
  test("a closed part's round button says what opening it shows, and opens it", () => {
    renderMap();
    const open: HTMLElement = screen.getByTestId(
      "resource-topology-open-ams-dev",
    );

    expect(open).toHaveAttribute("aria-expanded", "false");
    expect(open).toHaveAttribute("title", "Open");
    expect(open).toHaveAccessibleName(
      "Open ams-dev, 1 ESXi Host · 1 Virtual Machine",
    );

    fireEvent.click(open);

    const close: HTMLElement = screen.getByTestId(
      "resource-topology-close-ams-dev",
    );

    expect(close).toHaveAttribute("aria-expanded", "true");
    expect(close).toHaveAttribute("title", "Close");
    expect(close).toHaveAccessibleName("Close ams-dev");
    expect(card("esx-3")).toBeVisible();
    expect(card("ams-dev")).toHaveAttribute("data-open", "true");

    fireEvent.click(close);
    expect(screen.queryByTestId("resource-topology-card-esx-3")).toBeNull();
    expect(
      screen.getByTestId("resource-topology-open-ams-dev"),
    ).toHaveAttribute("aria-expanded", "false");
  });

  test("the open button counts what needs attention inside", () => {
    renderMap();
    fireEvent.click(screen.getByTestId("resource-topology-close-ams-prod"));

    expect(
      screen.getByTestId("resource-topology-open-ams-prod"),
    ).toHaveAccessibleName(
      "Open ams-prod, 2 ESXi Hosts · 3 Virtual Machines, 1 is critical",
    );
  });

  test("the resource itself has no round button: it is always open", () => {
    renderMap();

    expect(screen.queryByTestId("resource-topology-open-vc")).toBeNull();
    expect(screen.queryByTestId("resource-topology-close-vc")).toBeNull();
  });

  test("the round button is a quiet disc on the card's surface, open or closed", () => {
    /*
     * A filled indigo disc on every open part was the loudest thing on the
     * map - louder than the red and amber it is read by, and the colour of
     * the picked part's path. Open, the disc keeps the card's surface and
     * only its ring and chevron take the accent.
     */
    const open: ReturnType<typeof getTopologyToggleColors> =
      getTopologyToggleColors(true);
    const closed: ReturnType<typeof getTopologyToggleColors> =
      getTopologyToggleColors(false);

    expect(open.background).toBe("var(--ou-surface-primary, #ffffff)");
    expect(closed.background).toBe(open.background);
    expect(open.color).toBe(RESOURCE_TOPOLOGY_SELECTED_COLOR);
    // Its ring is the accent mixed into the theme's border, not the accent.
    expect(open.border).toContain("color-mix");
    expect(open.border).toContain(RESOURCE_TOPOLOGY_SELECTED_COLOR);
    expect(open.border).toContain("var(--ou-border-default");
    expect(closed.border).toBe("var(--ou-border-strong, #d1d5db)");
    expect(closed.color).toBe("var(--ou-text-secondary, #4b5563)");

    renderMap();
    const close: HTMLElement = screen.getByTestId(
      "resource-topology-close-ams-prod",
    );
    const opener: HTMLElement = screen.getByTestId(
      "resource-topology-open-ams-dev",
    );

    /*
     * Drawn from those colours: the accent on the chevron, never as a fill
     * (jsdom keeps a plain colour and drops a var() or color-mix()), and
     * both carry the class the hover rule reads.
     */
    const accent: string = "rgb(99, 102, 241)";

    expect(close.style.color).toBe(accent);
    expect(close.style.backgroundColor).not.toBe(accent);
    expect(close.getAttribute("style")).not.toContain(`background: ${accent}`);
    expect(opener.style.color).not.toBe(accent);
    expect(close).toHaveClass(TOPOLOGY_TOGGLE_CLASS);
    expect(opener).toHaveClass(TOPOLOGY_TOGGLE_CLASS);
    // Under the pointer, the ring and chevron take the accent.
    expect(CANVAS_RULES).toContain(
      `.${TOPOLOGY_TOGGLE_CLASS}:hover{border-color:${RESOURCE_TOPOLOGY_SELECTED_COLOR} !important;color:${RESOURCE_TOPOLOGY_SELECTED_COLOR} !important}`,
    );
    expect(
      screen.getByTestId("resource-topology-canvas").querySelector("style")
        ?.textContent,
    ).toBe(CANVAS_RULES);
  });
});

describe("what a card says under its name", () => {
  test("a part with neither a status nor a number says what it is, never a dot alone", () => {
    renderMap();
    const line: HTMLElement = within(card("ams")).getByTestId(
      "resource-topology-status-line",
    );

    // Amsterdam is a datacenter, with no status of its own.
    expect(line).toHaveTextContent("Datacenter");
  });

  test("a part with a status or a number says that, not its kind again", () => {
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "vc",
      nodes: [
        part("vc", null, { kind: "vmware.vcenter", name: "vcenter-prod" }),
        part("ams", "vc", { kind: "vmware.datacenter", name: "Amsterdam" }),
        part("cl", "ams", {
          kind: "vmware.cluster",
          name: "ams-prod",
          health: "warning",
          facts: [{ label: "Effective hosts", value: "3/4" }],
        }),
        part("esx", "cl", {
          kind: "vmware.host",
          name: "esx-1",
          status: { text: "Reporting" },
        }),
        part("vm", "esx", { name: "web-01" }),
      ],
    });

    renderMap([{ id: "vcenter", label: "Hosts", graph: graph }]);

    const cluster: HTMLElement = within(card("cl")).getByTestId(
      "resource-topology-status-line",
    );

    expect(cluster).toHaveTextContent("Effective hosts3/4");
    expect(cluster).not.toHaveTextContent("Cluster");
    expect(
      within(card("esx")).getByTestId("resource-topology-status-line"),
    ).not.toHaveTextContent("ESXi Host");
  });

  test("a number keeps its own order on a page read from right to left", () => {
    render(
      <StatusLine
        health="healthy"
        status=""
        facts={[
          { label: "Requests", value: "600/min" },
          { label: "Errors", value: "0.2%" },
        ]}
      />,
    );

    /*
     * In a right-to-left line "600/min" was drawn "min/600": each value is
     * isolated, so it reads in its own order whatever the page's.
     */
    expect(
      Array.from(
        screen
          .getByTestId("resource-topology-status-line")
          .querySelectorAll("bdi"),
      ).map((element: Element): string | null => {
        return element.textContent;
      }),
    ).toEqual(["600/min", "0.2%"]);
  });
});

describe("a heading's words", () => {
  const english: Translator = createTranslator(undefined);

  function group(
    overrides: Partial<ResourceTopologyGroupItem>,
  ): ResourceTopologyGroupItem {
    return {
      type: "group",
      id: "group:ams|vmware.cluster",
      parentId: "ams",
      kind: "vmware.cluster",
      groupKey: "ams|vmware.cluster",
      total: 12,
      attention: 0,
      isShownInFull: false,
      asChips: false,
      items: [],
      more: null,
      memberIds: [],
      ...overrides,
    };
  }

  test("say the kind, the count, what needs attention and how to show the rest", () => {
    const words: ResourceTopologyHeadingWords = getTopologyHeadingWords(
      english,
      {
        group: group({
          attention: 3,
          more: {
            type: "more",
            id: "more:ams|vmware.cluster",
            parentId: "ams",
            kind: "vmware.cluster",
            groupKey: "ams|vmware.cluster",
            asChip: false,
            hiddenCount: 4,
            hiddenAttention: 0,
            canShowAll: true,
          },
        }),
      },
      null,
    );

    expect(words).toEqual({
      title: "Clusters",
      count: "12",
      attention: "3 need attention",
      action: "Show all 12",
      canFold: false,
      canShowAll: true,
    });
    expect(
      getTopologyHeadingWords(
        english,
        { group: group({ isShownInFull: true }) },
        null,
      ).action,
    ).toBe("Show fewer");
    expect(
      getTopologyHeadingWords(english, { group: group({}) }, null),
    ).toEqual({
      title: "Clusters",
      count: "12",
      attention: "",
      action: "",
      canFold: false,
      canShowAll: false,
    });
  });

  test("over a lane, the lane's own name and how many parts it holds", () => {
    const graph: ResourceTopologyGraph = hostGraph();

    expect(
      getTopologyHeadingWords(
        english,
        { laneSectionId: "calls", laneCount: 1 },
        graph.nodes.get("calls")!,
      ),
    ).toEqual({
      title: "Talks to",
      count: "1",
      attention: "",
      action: "",
      canFold: false,
      canShowAll: false,
    });
  });

  test("are measured in the page's font for the layout: every word, gap and the padding", () => {
    const measured: Array<[string, string]> = [];
    // Ten pixels a character, whatever the font.
    const tenPerCharacter: (text: string, font: string) => number = (
      text: string,
      font: string,
    ): number => {
      measured.push([text, font]);

      return text.length * 10;
    };
    const width: ResourceTopologyHeadingWidth = createTopologyHeadingMeasure(
      english,
      vcenterGraph(),
      tenPerCharacter,
    );
    const heading: { group: ResourceTopologyGroupItem } = {
      group: group({ attention: 1 }),
    };
    /*
     * "CLUSTERS" (80, and 0.44px letter spacing a character), "12" (20),
     * "·" (10) and "1 needs attention" (170); 8px between the four, 6 of
     * padding before them and 4 after (a button's focus ring), with 6% to
     * spare.
     */
    const words: number = 80 + 0.44 * 8 + 20 + 10 + 170;

    expect(width(heading)).toBe(Math.ceil((6 + 4 + words + 8 * 3) * 1.06));
    // The title is measured as it is drawn: upper case, semibold.
    expect(measured[0]![0]).toBe("CLUSTERS");
    expect(measured[0]![1]).toContain("600 11px");
    expect(measured[0]![1]).toContain("Inter");
    // The same words are measured once.
    const calls: number = measured.length;

    width(heading);
    expect(measured.length).toBe(calls);
  });

  test("where nothing can measure text, a heading has no width of its own", () => {
    // A test's document lays no text out: the layout keeps its least widths.
    expect(
      createTopologyHeadingMeasure(
        english,
        vcenterGraph(),
      )({
        group: group({}),
      }),
    ).toBe(0);
    expect(
      createTopologyHeadingMeasure(english, vcenterGraph(), (): number => {
        return 0;
      })({ group: group({ attention: 2 }) }),
    ).toBe(0);
  });

  test("a group's heading puts a dot between its count and what needs attention", () => {
    renderMap();
    const clusters: HTMLElement = screen.getByTestId(
      "resource-topology-group-ams|vmware.cluster",
    );

    // "2" and "1 needs attention" never read as one number, "2 1".
    expect(clusters).toHaveTextContent("Clusters2·1 needs attention");

    const dot: HTMLElement | undefined = Array.from(
      clusters.querySelectorAll("span"),
    ).find((span: HTMLSpanElement): boolean => {
      return span.textContent === "·";
    });

    expect(dot).toHaveAttribute("aria-hidden", "true");
    // Without anything that needs attention, there is no dot.
    expect(
      screen.getByTestId("resource-topology-group-ams|vmware.datastore"),
    ).not.toHaveTextContent("·");
  });
});

describe("lines say where trouble is", () => {
  test("the line to a group is red when a critical part lies that way, grey when all is well", () => {
    renderMap();

    // vcenter -> datacenters: the critical host is that way.
    expect(branchTone("group:vc|vmware.datacenter")).toBe("critical");
    expect(branchTone("group:ams|vmware.cluster")).toBe("critical");
    expect(branchTone("group:ams|vmware.datastore")).toBe("calm");
  });

  test("picking a part lights the way from the resource to it", () => {
    renderMap();
    fireEvent.click(partButton("esx-2"));

    expect(branchTone("group:vc|vmware.datacenter")).toBe("path");
    expect(branchTone("group:ams|vmware.cluster")).toBe("path");
    expect(branchTone("group:ams-prod|vmware.host")).toBe("path");
    expect(branchTone("group:ams|vmware.datastore")).toBe("calm");
    // The lit lines are drawn last, over the others.
    const tones: Array<string | null> = Array.from(
      document.querySelectorAll("[data-testid^='resource-topology-branch-']"),
    ).map((path: Element): string | null => {
      return path.getAttribute("data-tone");
    });

    expect(tones.slice(-3)).toEqual(["path", "path", "path"]);
    expect(partButton("esx-2")).toHaveAttribute("aria-pressed", "true");
  });

  test("a map about calls keeps its lanes open and draws every call, coloured by how it is doing", () => {
    renderMap([
      {
        id: "host",
        label: "Host",
        graph: hostGraph(),
        alwaysShowRelations: true,
        relationLegend: "Calls per minute, red or amber when they fail",
        lanes: { left: ["callers"], right: ["calls"] },
      },
    ]);

    expect(screen.getByTestId("resource-topology-lane-callers")).toBeVisible();
    expect(screen.getByTestId("resource-topology-lane-calls")).toBeVisible();
    // The service at both ends of the calls: its container opened for it.
    expect(partButton("checkout")).toBeVisible();

    const relations: Array<Edge> = mockFlow!.edges.filter((edge: Edge) => {
      return edge.type === "resourceTopologyRelation";
    });

    expect(
      relations.map((edge: Edge): string => {
        return edge.id;
      }),
    ).toEqual(["relation:mobile->checkout", "relation:checkout->db"]);
    expect(
      (relations[1]!.style as React.CSSProperties | undefined)?.stroke,
    ).toBe("#dc2626");
    expect(relations[0]!.label).toBe("120/min");
    expect(screen.getByTestId("resource-topology-legend")).toHaveTextContent(
      "Calls per minute, red or amber when they fail",
    );
  });

  test("a focused part's related column is joined by one square spine, not a fan of curves", () => {
    window.history.replaceState({}, "", "/topology?focus=checkout");
    renderMap([{ id: "host", label: "Host", graph: hostGraph() }]);

    const related: Array<Edge> = mockFlow!.edges.filter((edge: Edge) => {
      return edge.type === "resourceTopologyRelatedBranch";
    });

    // mobile calls checkout; checkout calls the database.
    expect(
      related
        .map((edge: Edge): string => {
          return `${edge.id} ${(edge.data as { relatedEnd: string }).relatedEnd}`;
        })
        .sort(),
    ).toEqual(
      [
        "relation:checkout->db target",
        "relation:mobile->checkout source",
      ].sort(),
    );

    // The column's heading says what they are: no arrow on each.
    for (const edge of related) {
      expect(edge.markerEnd).toBeUndefined();
    }
  });

  test("the spine stands before the related column, whichever side it is on", () => {
    const focus: { x: number; y: number } = { x: 300, y: 100 };

    // The column after the drawing: out, along, down the spine and in.
    expect(getRelatedBranchPoints(focus, { x: 600, y: 260 })).toEqual([
      [300, 100],
      [600 - RELATED_SPINE_OFFSET, 100],
      [600 - RELATED_SPINE_OFFSET, 260],
      [600, 260],
    ]);
    // Read from right to left, the column is before it: mirrored.
    expect(getRelatedBranchPoints(focus, { x: 0, y: 40 })).toEqual([
      [300, 100],
      [RELATED_SPINE_OFFSET, 100],
      [RELATED_SPINE_OFFSET, 40],
      [0, 40],
    ]);
    // Lines to a dozen parts leave by one trunk to one spine.
    const spines: Set<number> = new Set<number>(
      [100, 160, 220, 280].map((y: number): number => {
        return getRelatedBranchPoints(focus, { x: 600, y: y })[1]![0];
      }),
    );

    expect(spines.size).toBe(1);
  });

  test("a map with lanes shows each call's ends; one without asks for nothing", () => {
    const options: ReturnType<typeof getLaneViewOptions> = getLaneViewOptions(
      hostGraph(),
      { left: ["callers"], right: ["calls"] },
    );

    expect(options.alwaysOpen).toEqual(new Set<string>(["callers", "calls"]));
    expect([...(options.reveal || [])].sort()).toEqual(
      ["checkout", "db", "mobile"].sort(),
    );
    expect(getLaneViewOptions(hostGraph(), undefined)).toEqual({
      alwaysOpen: undefined,
      reveal: undefined,
    });
    expect(getLaneViewOptions(hostGraph(), { left: [], right: [] })).toEqual({
      alwaysOpen: undefined,
      reveal: undefined,
    });
  });
});

describe("the keyboard moves through the map like a tree", () => {
  test("right goes into a part, down and up between the parts beside it", () => {
    renderMap();
    partButton("vc").focus();

    press("ArrowRight");
    expect(focusedItem()).toBe("ams");
    press("ArrowRight");
    expect(focusedItem()).toBe("ams-prod");
    press("ArrowDown");
    expect(focusedItem()).toBe("ams-dev");
    press("ArrowDown");
    expect(focusedItem()).toBe("ssd-1");
    press("ArrowUp");
    expect(focusedItem()).toBe("ams-dev");
    press("End");
    expect(focusedItem()).toBe("ssd-3");
    press("Home");
    expect(focusedItem()).toBe("ams-prod");
  });

  test("right on a closed part opens it; left closes an open one, then goes back out", () => {
    renderMap();
    partButton("ams-dev").focus();

    press("ArrowRight");
    expect(card("ams-dev")).toHaveAttribute("data-open", "true");
    expect(card("esx-3")).toBeVisible();

    press("ArrowLeft");
    expect(card("ams-dev")).toHaveAttribute("data-open", "false");

    press("ArrowLeft");
    expect(focusedItem()).toBe("ams");
  });

  test("on a page read from right to left, left goes in and right comes back", () => {
    document.documentElement.setAttribute("dir", "rtl");
    renderMap();

    expect(screen.getByTestId("resource-topology-canvas")).toHaveAttribute(
      "data-direction",
      "rtl",
    );
    partButton("vc").focus();
    press("ArrowLeft");
    expect(focusedItem()).toBe("ams");
    press("ArrowRight");
    expect(card("ams")).toHaveAttribute("data-open", "false");
  });

  test("a key with a modifier, or one that is not an arrow, is left alone", () => {
    renderMap();
    partButton("vc").focus();

    press("ArrowRight", { shiftKey: true });
    press("ArrowRight", { ctrlKey: true });
    press("a");
    expect(focusedItem()).toBe("vc");
  });

  test("an arrow that goes nowhere still does not scroll the page", () => {
    renderMap();
    const root: HTMLElement = partButton("vc");
    root.focus();
    const event: KeyboardEvent = new KeyboardEvent("keydown", {
      key: "ArrowUp",
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      root.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(focusedItem()).toBe("vc");
  });
});

describe("what a screen reader is told", () => {
  test("the map is a named group that says how its keys work", () => {
    renderMap();
    const canvas: HTMLElement = screen.getByTestId("resource-topology-canvas");

    expect(canvas).toHaveAttribute("role", "group");
    expect(canvas).toHaveAccessibleName("Topology map");
    expect(canvas).toHaveAccessibleDescription(
      "On a part, the Up and Down arrows move between the parts beside it, the Right arrow opens it and goes in, and the Left arrow closes it and goes back out.",
    );
  });

  test("read from right to left, it names the other arrows", () => {
    document.documentElement.setAttribute("dir", "rtl");
    renderMap();

    expect(
      screen.getByTestId("resource-topology-canvas"),
    ).toHaveAccessibleDescription(
      "On a part, the Up and Down arrows move between the parts beside it, the Left arrow opens it and goes in, and the Right arrow closes it and goes back out.",
    );
  });

  test("each part is a button named for what it is and how it is doing", () => {
    renderMap();

    expect(partButton("esx-1")).toHaveAccessibleName(
      "esx-1, ESXi Host, Not responding",
    );
    expect(partButton("ssd-2")).toHaveAccessibleName("ssd-2, Datastore");
  });
});

describe("level of detail", () => {
  test("zoomed far out, the map drops the cards' small print", () => {
    mockZoom = 0.3;
    renderMap();
    const canvas: HTMLElement = screen.getByTestId("resource-topology-canvas");

    expect(canvas).toHaveAttribute("data-detail", "far");
    // The rule that hides it rides with the canvas, not a run-time utility.
    expect(canvas.querySelector("style")?.textContent).toContain(
      `[data-detail="far"] .${TOPOLOGY_DETAIL_CLASS}{display:none`,
    );
    // The small print is marked, the name is not.
    expect(
      card("ams-prod").querySelectorAll(`.${TOPOLOGY_DETAIL_CLASS}`).length,
    ).toBeGreaterThan(0);
  });

  test("at a readable zoom everything is drawn", () => {
    mockZoom = 0.8;
    renderMap();

    expect(screen.getByTestId("resource-topology-canvas")).toHaveAttribute(
      "data-detail",
      "near",
    );
  });
});

describe("the zoom buttons", () => {
  test("sit where a line starts: bottom left, or bottom right read right to left", () => {
    renderMap();
    expect(mockControls?.["position"]).toBe("bottom-left");
    expect(mockControls?.["showInteractive"]).toBe(false);
    // Fit frames the drawing the way the map does, from the top.
    expect(typeof mockControls?.["onFitView"]).toBe("function");

    cleanup();
    document.documentElement.setAttribute("dir", "rtl");
    renderMap();
    expect(mockControls?.["position"]).toBe("bottom-right");
  });
});

describe("the legend", () => {
  test("says what the lines between parts are, on the map only", () => {
    renderMap();
    const legend: HTMLElement = screen.getByTestId("resource-topology-legend");

    expect(legend).toHaveTextContent("What is inside");
    expect(legend).toHaveTextContent("Related, for the part you pick");

    fireEvent.click(screen.getByTestId("resource-topology-display-list"));
    expect(
      screen.getByTestId("resource-topology-legend"),
    ).not.toHaveTextContent("What is inside");
  });
});

describe("a card's status line", () => {
  test("keeps the status whole and adds at most two numbers after it", () => {
    render(
      <StatusLine
        health="critical"
        status="Not responding"
        facts={[
          { label: "CPU", value: "97%", tone: "critical" },
          { label: "Memory", value: "40%" },
          { label: "Disk", value: "10%" },
        ]}
      />,
    );
    const line: HTMLElement = screen.getByTestId(
      "resource-topology-status-line",
    );

    expect(line).toHaveTextContent("Not responding");
    expect(line).toHaveTextContent("CPU97%");
    expect(line).toHaveTextContent("Memory40%");
    expect(line).not.toHaveTextContent("Disk");
    // A number that does not fit wraps out of sight, whole.
    expect(line.style.flexWrap).toBe("wrap");
    expect(line.style.overflow).toBe("hidden");
    expect(line.style.height).toBe("16px");
    expect(line.firstElementChild).toHaveTextContent("Not responding");
  });

  test("draws no bar for a part that holds nothing", () => {
    const graph: ResourceTopologyGraph = vcenterGraph();
    const { container } = render(
      <InsideHealthBar node={graph.nodes.get("ssd-1")!} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
