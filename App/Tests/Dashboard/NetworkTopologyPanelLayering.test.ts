import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #3134: opening a device panel on the network map left the map's zoom
 * toolbar painted on top of it. The cause was arithmetic — the toolbar sits at
 * z-20 and the shared SideOver root sat at z-10, both resolved in the same
 * stacking context — so the fix is a number, and a number in one file is only
 * correct relative to numbers in four other files.
 *
 * None of that is expressible as a type or caught by a renderer: the App suite
 * runs in a plain Node environment (App/jest.config.json sets
 * testEnvironment: "node"), and even in jsdom no stylesheet is loaded, so
 * getComputedStyle can never resolve a Tailwind z-* class. The relationships
 * are therefore pinned against the sources, the same way
 * NetworkMapWidgetInvariants pins the Network Map widget's wiring.
 *
 * The invariant being defended: page chrome < SideOver < app-wide overlays.
 * Break any side of it and the panel either hides under a toolbar again, or
 * starts hiding toasts and modals.
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");
const COMMON_ROOT: string = path.join(APP_ROOT, "..", "Common");

const DASHBOARD_SRC: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Dashboard",
  "src",
);

const TOPOLOGY_DIR: string = path.join(DASHBOARD_SRC, "Components", "Topology");

/*
 * Comments are stripped before anything is matched. Several of these files
 * explain the old z-10 behaviour in prose, and an assertion about the code has
 * to read the code rather than the commentary that describes what it replaced.
 */
function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readAppCode(...relativeParts: Array<string>): string {
  return stripComments(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  );
}

function readCommonCode(...relativeParts: Array<string>): string {
  return stripComments(
    fs.readFileSync(path.join(COMMON_ROOT, ...relativeParts), "utf8"),
  );
}

/*
 * Tailwind's z-N utilities only. A bare `z-` prefixed word boundary would also
 * match `z-index` inside an inline style and the `z-` of an arbitrary value.
 */
function zIndexesIn(source: string): Array<number> {
  const matches: Array<string> =
    source.match(/(?<![\w-])z-(\d+)(?![\w-])/g) || [];

  return matches.map((match: string): number => {
    return Number(match.slice(2));
  });
}

function highestZIndexIn(source: string): number {
  const found: Array<number> = zIndexesIn(source);

  return found.length === 0 ? 0 : Math.max(...found);
}

const SIDE_OVER_SOURCE: string = readCommonCode(
  "UI",
  "Components",
  "SideOver",
  "SideOver.tsx",
);

const NETWORK_DEVICE_GRAPH: string = readAppCode(
  "Components",
  "Topology",
  "NetworkDeviceGraph.tsx",
);

/*
 * The single number the whole ladder is anchored on: the z-index the shared
 * SideOver root declares. Everything below compares against this rather than
 * against a literal, so moving the panel moves the whole assertion set with it
 * and the test still fails if the move breaks an ordering.
 */
function sideOverZIndex(): number {
  const match: RegExpMatchArray | null = SIDE_OVER_SOURCE.match(
    /className="relative z-(\d+)"/,
  );

  if (!match || match[1] === undefined) {
    throw new Error(
      "SideOver's root no longer declares a single `relative z-N` class. If the layering approach changed, update this test to match — it is the only thing pinning the panel above the network map's toolbar.",
    );
  }

  return Number(match[1]);
}

describe("network topology detail panel layering", () => {
  test("the panel outranks the map's zoom toolbar, which is what issue #3134 reported", () => {
    const toolbar: RegExpMatchArray | null = NETWORK_DEVICE_GRAPH.match(
      /className="absolute right-2 top-2 z-(\d+)[^"]*"/,
    );

    expect(toolbar).not.toBeNull();

    const toolbarZIndex: number = Number(toolbar![1]);

    expect(toolbarZIndex).toBeGreaterThan(0);
    expect(sideOverZIndex()).toBeGreaterThan(toolbarZIndex);
  });

  test("every overlay the network map paints stays under the panel", () => {
    /*
     * Not just the toolbar. The map also floats a custom-layout chip, a
     * filtered-empty scrim, a no-search-matches pill and a zoom hint, and any
     * one of them creeping above the panel reproduces the same bug.
     */
    for (const zIndex of zIndexesIn(NETWORK_DEVICE_GRAPH)) {
      expect(zIndex).toBeLessThan(sideOverZIndex());
    }
  });

  test("no other topology surface has crept above the panel either", () => {
    const files: Array<string> = fs
      .readdirSync(TOPOLOGY_DIR)
      .filter((name: string): boolean => {
        return name.endsWith(".tsx");
      });

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source: string = readAppCode("Components", "Topology", file);

      expect([file, highestZIndexIn(source) < sideOverZIndex()]).toEqual([
        file,
        true,
      ]);
    }
  });

  test("the panel stays under the overlays that are mounted ahead of the page", () => {
    /*
     * Toast and the AI chat panel are rendered in App.tsx BEFORE the routed
     * page, so an equal z-index would be broken in the panel's favour by
     * document order and they would vanish behind it. They have to be strictly
     * higher, not merely equal.
     */
    const toast: number = highestZIndexIn(
      readCommonCode("UI", "Components", "Toast", "Toast.tsx"),
    );
    const aiChatPanel: number = highestZIndexIn(
      readAppCode("Components", "AIChat", "AIChatPanel.tsx"),
    );

    expect(toast).toBeGreaterThan(sideOverZIndex());
    expect(aiChatPanel).toBeGreaterThan(sideOverZIndex());
  });

  test("a modal opened from or beside a panel still wins", () => {
    const modal: number = highestZIndexIn(
      readCommonCode("UI", "Components", "Modal", "Modal.tsx"),
    );

    expect(modal).toBeGreaterThan(sideOverZIndex());
  });

  test("portalled dropdown menus still open over the panel", () => {
    const dropdownMenuZIndex: string = readCommonCode(
      "UI",
      "Components",
      "Dropdown",
      "DropdownMenuZIndex.ts",
    );

    const match: RegExpMatchArray | null = dropdownMenuZIndex.match(
      /DROPDOWN_MENU_Z_INDEX: number = (\d+)/,
    );

    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThan(sideOverZIndex());
  });

  test("the panel is portalled, so a future z-indexed ancestor cannot trap it again", () => {
    expect(SIDE_OVER_SOURCE).toContain("createPortal");

    /*
     * And it follows the fullscreen element. Only the fullscreen element's own
     * subtree reaches the browser's top layer, so a panel appended to <body>
     * while the map is fullscreen is not painted at all — clicking a device
     * would look like nothing happened.
     */
    expect(SIDE_OVER_SOURCE).toContain("document.fullscreenElement");
    expect(SIDE_OVER_SOURCE).toContain("fullscreenchange");
  });

  test("the panel no longer paints a dead scrollbar track beside the page's own", () => {
    expect(SIDE_OVER_SOURCE).not.toContain("overflow-y-scroll");
    expect(SIDE_OVER_SOURCE).toContain("overflow-y-auto");
    expect(SIDE_OVER_SOURCE).toContain("overscroll-contain");
  });

  test("the panel is not sized in viewport units, which include the scrollbar", () => {
    expect(SIDE_OVER_SOURCE).not.toContain("w-screen");
  });

  test("the panel shares the page scroll lock rather than keeping its own", () => {
    /*
     * Workflow's Run panel is a SideOver that opens a ConfirmModal. Two
     * private counters would race over document.body.style and leave the page
     * either scrolling under an open dialog or locked with nothing on screen.
     */
    expect(SIDE_OVER_SOURCE).toContain("PageScrollLock");
    expect(readCommonCode("UI", "Components", "Modal", "Modal.tsx")).toContain(
      "PageScrollLock",
    );
  });

  test("the panel does not claim aria-modal and hijack Modal's dialog stack", () => {
    /*
     * Modal picks the topmost dialog with
     * querySelectorAll('[role="dialog"][aria-modal="true"]') and takes the last
     * match in tree order. A portalled panel is always last, so claiming
     * aria-modal would permanently disable Escape, backdrop dismissal and
     * initial focus on every modal underneath it.
     */
    expect(SIDE_OVER_SOURCE).toContain('role="dialog"');
    expect(SIDE_OVER_SOURCE).not.toContain('aria-modal="true"');
  });

  test("the two topology panels stay mutually exclusive", () => {
    /*
     * The panel has no backdrop by design — you can click straight from one
     * device to the next — so the view, not the component, is what stops two
     * panels stacking on top of each other.
     */
    const liveView: string = readAppCode(
      "Components",
      "Topology",
      "NetworkTopologyLiveView.tsx",
    );

    const onNodeClick: RegExpMatchArray | null = liveView.match(
      /onNodeClick=\{[\s\S]*?\}\}/,
    );
    const onEdgeClick: RegExpMatchArray | null = liveView.match(
      /onEdgeClick=\{[\s\S]*?\}\}/,
    );

    expect(onNodeClick).not.toBeNull();
    expect(onEdgeClick).not.toBeNull();

    expect(onNodeClick![0]).toContain("setSelectedEdgeKey(null)");
    expect(onEdgeClick![0]).toContain("setSelectedNodeId(null)");
  });
});
