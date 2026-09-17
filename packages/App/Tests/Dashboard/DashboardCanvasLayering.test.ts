import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import DashboardStackingLayers, {
  DASHBOARD_CANVAS_ISOLATION,
} from "Common/UI/Utils/DashboardStackingLayers";

/*
 * Issue #3660: clicking a dashboard tile once made it paint over the
 * toolbar's auto-refresh menu, so opening the picker showed a blank white
 * rectangle where the options should be.
 *
 * The canvas raises a selected tile to a layer of its own so the tile's ring
 * and resize handles clear the neighbours they overhang. That raise was
 * correct; what was missing was a boundary. The positioner the tiles live in
 * is `position: relative` with `z-index: auto`, which creates no stacking
 * context, and neither does anything above it up to the document - so the
 * board's "above my neighbours" and the toolbar's "above the toolbar card"
 * were resolved against each other in the ROOT stacking context, and the
 * bigger number won.
 *
 * The fix is a boundary plus one scale: the positioner isolates, and every
 * layer either side of it is read from Common/UI/Utils/DashboardStackingLayers
 * instead of written inline in each file.
 *
 * None of that is expressible as a type. This suite runs in a plain Node
 * environment (App/jest.config.json sets testEnvironment "node"), and even
 * under jsdom no stylesheet is loaded - Tailwind arrives through the Play CDN
 * at runtime - so getComputedStyle can never resolve a `z-*` or `isolate`
 * class. The relationship is therefore pinned against the sources, the same
 * way MapChromeHeaderLayering pins issue #3373 and NetworkTopologyPanelLayering
 * pins the detail-panel ladder from #3134.
 *
 * The behaviour behind these pins is exercised against a real rendered DOM in
 * Common/Tests/App/Dashboard/DashboardToolbarPopupLayering.test.tsx, and the
 * arithmetic alone in Common/Tests/UI/Utils/DashboardStackingLayers.test.ts.
 */

const REPO_ROOT: string = path.join(__dirname, "..", "..", "..");

/*
 * Comments are stripped before anything is matched. Each of these files
 * explains this bug in prose directly above the code that fixes it, quoting
 * the very identifiers and z-index values the assertions look for, so a
 * matcher that read the commentary would find its anchor in the explanation
 * every time.
 */
function readSource(...relativeParts: Array<string>): string {
  return fs
    .readFileSync(path.join(REPO_ROOT, ...relativeParts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
}

const CANVAS: string = readSource(
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "Dashboard",
  "Canvas",
  "Index.tsx",
);

const TOOLBAR: string = readSource(
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "Dashboard",
  "Toolbar",
  "DashboardToolbar.tsx",
);

const SHELL: string = readSource(
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "Dashboard",
  "DashboardView.tsx",
);

const GRID_DND: string = readSource(
  "Common",
  "UI",
  "Utils",
  "UseDashboardGridDnd.ts",
);

const PUBLIC_PAGE: string = readSource(
  "App",
  "FeatureSet",
  "PublicDashboard",
  "src",
  "Pages",
  "DashboardView",
  "DashboardViewPage.tsx",
);

const PUBLIC_CANVAS: string = readSource(
  "App",
  "FeatureSet",
  "PublicDashboard",
  "src",
  "Components",
  "DashboardCanvas.tsx",
);

/*
 * Throws rather than returning null: an anchor that silently stopped matching
 * would turn every assertion below it into a no-op, which is the one failure
 * mode a source-pinned test cannot afford.
 */
function anchor(source: string, pattern: RegExp, what: string): string {
  const match: RegExpMatchArray | null = source.match(pattern);

  if (!match || match[1] === undefined) {
    throw new Error(
      `Cannot find ${what} any more - the anchor this test reads it with no longer matches. Re-point the anchor, and check that the layering contract from issue #3660 still holds before you do.`,
    );
  }

  return match[1];
}

/**
 * The style object of the canvas positioner - the box tiles are absolutely
 * placed inside, and the only box in the tree that is allowed to isolate.
 */
function positionerStyle(): string {
  return anchor(
    CANVAS,
    /ref=\{positionerRef\}[\s\S]{0,600}?style=\{\{([\s\S]*?)\}\}\s*>/,
    "the canvas positioner's style object",
  );
}

/** The style object the toolbar's auto-refresh panel carries. */
function autoRefreshPanelStyle(): string {
  return anchor(
    TOOLBAR,
    /className="absolute right-0 mt-2 w-56 origin-top-right[^"]*"\s*style=\{\{([^}]*)\}\}/,
    "the auto-refresh menu's panel",
  );
}

/** Tailwind's z-N utilities, which jsdom can never resolve. */
function tailwindZIndexesIn(source: string): Array<number> {
  return Array.from(source.matchAll(/(?<![\w-])z-(\d+)(?![\w-])/g)).map(
    (match: RegExpMatchArray): number => {
      return Number(match[1]);
    },
  );
}

/*
 * Layers the app puts over its pages, read out of the components that own
 * them rather than written down here, so renumbering any of them moves these
 * assertions with it.
 */
const PAGE_CHROME: Array<{ name: string; zIndex: number }> = [
  {
    name: "the shell's sticky header",
    zIndex: Number(
      anchor(
        readSource(
          "Common",
          "UI",
          "Components",
          "MasterPage",
          "MasterPage.tsx",
        ),
        /makeTopSectionUnstick \? "" : "sticky top-0 z-(\d+)"/,
        "the shell's sticky top section",
      ),
    ),
  },
  {
    name: "SideOver",
    zIndex: Number(
      anchor(
        readSource("Common", "UI", "Components", "SideOver", "SideOver.tsx"),
        /className="relative z-(\d+)"/,
        "SideOver's root",
      ),
    ),
  },
  {
    name: "the AI chat panel",
    zIndex: Number(
      anchor(
        readSource(
          "App",
          "FeatureSet",
          "Dashboard",
          "src",
          "Components",
          "AIChat",
          "AIChatPanel.tsx",
        ),
        /className="relative z-(\d+)" role="dialog"/,
        "the AI chat panel's root",
      ),
    ),
  },
  {
    name: "Modal",
    zIndex: Number(
      anchor(
        readSource("Common", "UI", "Components", "Modal", "Modal.tsx"),
        /<div className="relative z-(\d+)">/,
        "Modal's root",
      ),
    ),
  },
];

describe("the dashboard canvas cannot paint over the page (issue #3660)", () => {
  describe("the positioner", () => {
    test("creates a stacking context", () => {
      expect(positionerStyle()).toContain(
        "isolation: DASHBOARD_CANVAS_ISOLATION",
      );
      expect(DASHBOARD_CANVAS_ISOLATION).toBe("isolate");
    });

    test("is also the positioning parent its tiles anchor to", () => {
      /*
       * Isolating alone would scope the z-indexes but leave the absolutely
       * positioned tiles resolving their offsets against some ancestor
       * further up, which is how they would escape the canvas box.
       */
      expect(positionerStyle()).toContain('position: "relative"');
    });

    test("claims no z-index of its own", () => {
      /*
       * An isolated box that also carried a z-index would re-enter the
       * competition it was added to leave, and the whole board would outrank
       * the toolbar again in one piece instead of one tile at a time.
       */
      expect(positionerStyle()).not.toMatch(/zIndex/);
    });

    test("is the only box in the canvas that isolates", () => {
      /*
       * The tempting bigger version of this fix is to isolate the wrapper
       * above it. That also traps ComponentSettingsModal, which the canvas
       * renders OUTSIDE the positioner precisely so it can keep the Modal
       * layer: trapped, its z-50 becomes canvas-local and the AI chat panel
       * paints over the open settings dialog.
       *
       * Isolate the box that holds the tiles, never the box that holds the
       * canvas.
       */
      expect(CANVAS.match(/isolation/g)).toHaveLength(1);
      expect(SHELL).not.toMatch(/isolation/);
      expect(SHELL).not.toMatch(/(?<![\w-])isolate(?![\w-])/);
    });
  });

  describe("every layer the board hands out", () => {
    test("comes from the shared scale, not from a number written in place", () => {
      /*
       * The bug was two files each deciding a layer on its own and never
       * finding out they disagreed. A bare number here is that situation
       * restored.
       */
      const inlineNumbers: Array<string> = Array.from(
        CANVAS.matchAll(/zIndex:\s*(-?\d+)/g),
      ).map((match: RegExpMatchArray): string => {
        return match[0];
      });

      expect(inlineNumbers).toEqual([]);
      expect(CANVAS).toContain(
        "DashboardStackingLayers.canvasSelectedComponent",
      );
      expect(CANVAS).toContain("DashboardStackingLayers.canvasPlaceholder");
    });

    test("including the one the drag code sets imperatively", () => {
      expect(GRID_DND).not.toMatch(/style\.zIndex\s*=\s*"\d+"/);
      expect(GRID_DND).toContain(
        "DashboardStackingLayers.canvasDraggingComponent",
      );
    });

    test("still raises the selected tile, rather than giving the raise up", () => {
      /*
       * The other way to make the report go away is to stop raising the tile
       * at all, which puts its selection ring and its resize handles back
       * under the neighbouring cards they overhang.
       */
      expect(CANVAS).toMatch(
        /zIndex:\s*isSelected && !isActive\s*\?\s*DashboardStackingLayers\.canvasSelectedComponent/,
      );
    });
  });

  describe("the toolbar's auto-refresh menu", () => {
    test("takes its layer from the shared scale", () => {
      expect(autoRefreshPanelStyle()).toContain(
        "zIndex: DashboardStackingLayers.toolbarPopup",
      );
    });

    test("no longer carries a Tailwind layer class jsdom cannot see", () => {
      /*
       * The panel used to be `z-10`. Keeping a class alongside the style
       * would leave two answers to the same question, and the class is the
       * one no test can read.
       */
      const panel: string = anchor(
        TOOLBAR,
        /className="(absolute right-0 mt-2 w-56 origin-top-right[^"]*)"/,
        "the auto-refresh menu's class list",
      );

      expect(tailwindZIndexesIn(panel)).toEqual([]);
    });
  });

  describe("why the isolation is load-bearing", () => {
    /*
     * These are the assertions that stop #3660 being "fixed" by renumbering
     * and deleting the boundary. Each names a layer of app chrome the board's
     * own numbers would outrank in a shared stacking context.
     */
    for (const chrome of PAGE_CHROME) {
      test(`a widget mid-drag would otherwise outrank ${chrome.name}`, () => {
        expect(chrome.zIndex).toBeGreaterThan(0);
        expect(DashboardStackingLayers.canvasDraggingComponent).toBeGreaterThan(
          chrome.zIndex,
        );
      });
    }

    test("and a merely selected widget would outrank the sticky header", () => {
      const header: number = PAGE_CHROME[0]!.zIndex;

      expect(
        DashboardStackingLayers.canvasSelectedComponent,
      ).toBeGreaterThanOrEqual(header);
    });
  });

  describe("the public dashboard", () => {
    test("mounts the same canvas, so it is covered by the same boundary", () => {
      /*
       * The precondition for everything else in this block. Fork the public
       * canvas and the isolation quietly stops covering that surface.
       */
      expect(PUBLIC_CANVAS).toContain(
        '"../../../Dashboard/src/Components/Dashboard/Canvas/Index"',
      );
    });

    test("never raises a tile in the first place", () => {
      /*
       * Its immunity lives in these props, not in the canvas - which is why
       * it is pinned here rather than inferred from the canvas file.
       */
      expect(PUBLIC_PAGE).toMatch(/selectedComponentId=\{null\}/);
      expect(PUBLIC_PAGE).toMatch(/isEditMode=\{false\}/);
    });

    test("opens its own auto-refresh picker through the shared menu", () => {
      /*
       * It uses MoreMenu, which is why it never reproduced the report.
       * Copying the hand-rolled panel back over here would bring the bug with
       * it - now on a surface with no edit mode to notice it.
       */
      expect(PUBLIC_PAGE).toContain("MoreMenu");
      expect(PUBLIC_PAGE).not.toContain("AutoRefreshDropdown");
    });
  });
});
