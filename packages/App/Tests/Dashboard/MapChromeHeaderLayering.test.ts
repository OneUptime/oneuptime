import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #3373: on the Topology page the network map's zoom toolbar appeared
 * pinned to the top-right of the browser viewport, painted over the navbar,
 * once the page was scrolled.
 *
 * It was never actually pinned. The toolbar is `absolute` inside a container
 * that also sets `overflow-hidden`, so it can only ever travel with the map.
 * What the report captured is the band of scroll in which the map's top edge
 * has slid UNDER the app header — and in that band the toolbar was painted on
 * top of the header instead of behind it.
 *
 * The cause is arithmetic in the wrong stacking context. The shell sticks its
 * header at z-10 (Common/UI/Components/MasterPage/MasterPage.tsx) and <main>
 * is its SIBLING, with no z-index and no isolation. `position: relative` with
 * z-index:auto creates no stacking context either, so a map's z-20 toolbar and
 * its z-10 overlays were compared against the header's z-10 directly in the
 * root context. 20 beats 10, and 10 ties 10 — which page content wins, because
 * <main> comes after the header in tree order.
 *
 * The fix is one word per canvas: `isolate`. A stacking-context-forming box
 * with z-index:auto paints at level 0 of its parent context, so the whole map
 * collapses to a single entry strictly below the header while its overlays
 * keep their order relative to each other.
 *
 * None of that is expressible as a type or catchable by a renderer: the App
 * suite runs in a plain Node environment (App/jest.config.json sets
 * testEnvironment "node"), and even under jsdom no stylesheet is loaded —
 * Tailwind arrives through the Play CDN at runtime — so getComputedStyle can
 * never resolve a `z-*` or `isolate` class. The relationship is therefore
 * pinned against the sources, the same way NetworkTopologyPanelLayering pins
 * the detail-panel ladder from issue #3134.
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");
const COMMON_ROOT: string = path.join(APP_ROOT, "..", "Common");

const DASHBOARD_SRC: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Dashboard",
  "src",
);

/*
 * Comments are stripped before anything is matched, and every assertion below
 * is indexed into the STRIPPED text. Each of these components explains this
 * bug in prose directly above the container it fixes, quoting the very z-index
 * values the assertions look for — so a matcher that read the commentary would
 * find the map's chrome "declared" before its own container every time.
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

interface ZIndexUse {
  value: number;
  index: number;
}

/*
 * Tailwind's z-N utilities only, with the position each one is declared at. A
 * bare `z-` word boundary would also match `z-index` inside an inline style
 * and the `z-` of an arbitrary value.
 */
function zIndexUsesIn(source: string): Array<ZIndexUse> {
  const uses: Array<ZIndexUse> = [];
  const pattern: RegExp = /(?<![\w-])z-(\d+)(?![\w-])/g;

  let match: RegExpExecArray | null = pattern.exec(source);

  while (match !== null) {
    uses.push({ value: Number(match[1]), index: match.index });
    match = pattern.exec(source);
  }

  return uses;
}

const MASTER_PAGE: string = readCommonCode(
  "UI",
  "Components",
  "MasterPage",
  "MasterPage.tsx",
);

/*
 * The number every assertion here is measured against, read out of the shell
 * rather than written down, so moving the header moves the whole assertion set
 * with it.
 */
function appHeaderZIndex(): number {
  const match: RegExpMatchArray | null = MASTER_PAGE.match(
    /makeTopSectionUnstick \? "" : "sticky top-0 z-(\d+)"/,
  );

  if (!match || match[1] === undefined) {
    throw new Error(
      "MasterPage no longer sticks its top section with a single `sticky top-0 z-N` class. Issue #3373 depends on page content never outranking that layer — if the shell's layering changed, update this test to match.",
    );
  }

  return Number(match[1]);
}

interface MapSurface {
  name: string;
  parts: Array<string>;
  /*
   * Matches the canvas ELEMENT, capturing its class list in group 1.
   *
   * Anchoring on the element rather than on "the first className that mentions
   * isolate" is the whole point of this field. These files each declare small
   * presentational subcomponents above the map, and any one of them could grow
   * a stacking context of its own for an unrelated reason. A matcher that took
   * the first `isolate` in the file would then be satisfied by a button group
   * while the canvas itself had quietly lost its isolation — the block would
   * stay green with #3373 fully reintroduced.
   */
  canvas: RegExp;
}

/*
 * Every in-page canvas that floats chrome over itself. Add new ones here: the
 * bug is a property of the shape, not of any one map, and a canvas that reuses
 * this pattern without isolating reproduces #3373 exactly.
 */
const MAP_SURFACES: Array<MapSurface> = [
  {
    name: "the network topology map",
    parts: ["Components", "Topology", "NetworkDeviceGraph.tsx"],
    // The only box in the file sized against `isFullscreen`.
    canvas: /className="([^"]*)"\s*style=\{\{\s*height: isFullscreen/,
  },
  {
    name: "the site geo map",
    parts: ["Components", "NetworkSite", "SiteGeoMap.tsx"],
    canvas: /ref=\{containerRef\}\s*className="([^"]*)"/,
  },
  {
    name: "the site container graph",
    parts: ["Components", "NetworkSite", "SiteContainerGraph.tsx"],
    canvas: /ref=\{canvasElement\}\s*className="([^"]*)"/,
  },
];

/*
 * Throws rather than returning null: an anchor that silently stopped matching
 * would turn every assertion below it into a no-op, which is the one failure
 * mode a source-pinned test cannot afford.
 */
function canvasOf(source: string, surface: MapSurface): RegExpMatchArray {
  const match: RegExpMatchArray | null = source.match(surface.canvas);

  if (!match || match[1] === undefined || match.index === undefined) {
    throw new Error(
      `Cannot find ${surface.name}'s canvas element any more — the anchor in MAP_SURFACES no longer matches ${surface.parts.join("/")}. Re-point it at the element that owns the map's floating chrome and check that element still carries \`relative isolate\`, or issue #3373 is unguarded.`,
    );
  }

  return match;
}

describe("map chrome cannot paint over the app header", () => {
  test("the shell still sticks its header at a z-index page content could outrank", () => {
    expect(appHeaderZIndex()).toBeGreaterThan(0);
  });

  for (const surface of MAP_SURFACES) {
    describe(surface.name, () => {
      const source: string = readAppCode(...surface.parts);
      const canvas: RegExpMatchArray = canvasOf(source, surface);
      const classList: string = canvas[1]!;

      test("its canvas creates a stacking context", () => {
        expect([surface.name, classList]).toEqual([
          surface.name,
          expect.stringMatching(/(?<![\w-])isolate(?![\w-])/),
        ]);
      });

      test("that canvas is also the positioning parent its overlays anchor to", () => {
        /*
         * `isolation: isolate` alone would scope the z-indexes but leave the
         * absolutely-positioned overlays resolving their offsets against some
         * ancestor further up, which is how they would escape the canvas box.
         */
        expect(classList).toMatch(/(?<![\w-])relative(?![\w-])/);
      });

      test("the canvas claims no z-index of its own", () => {
        /*
         * An isolated box that also carried a z-index would re-enter the
         * competition it was added to leave, and a z-20 canvas beats the
         * header just as loudly as a z-20 toolbar did.
         */
        expect(zIndexUsesIn(classList)).toEqual([]);
      });

      test("every overlay it floats is declared inside that canvas", () => {
        /*
         * Source order, not proven nesting — but these components each hold a
         * single canvas, so chrome declared before it is chrome the isolation
         * cannot reach, and that is worth failing on.
         */
        const uses: Array<ZIndexUse> = zIndexUsesIn(source);

        expect(uses.length).toBeGreaterThan(0);

        for (const use of uses) {
          expect([`z-${use.value}`, use.index > canvas.index!]).toEqual([
            `z-${use.value}`,
            true,
          ]);
        }
      });

      test("its chrome would otherwise outrank the header, which is why the isolation is load-bearing", () => {
        /*
         * This is the assertion that stops #3373 being "fixed" by quietly
         * lowering the toolbar instead. Ties count: <main> is rendered after
         * the sticky header, so equal z-indexes are broken in the page's
         * favour and a z-10 overlay covers a z-10 header.
         */
        const highest: number = Math.max(
          ...zIndexUsesIn(source).map((use: ZIndexUse): number => {
            return use.value;
          }),
        );

        expect(highest).toBeGreaterThanOrEqual(appHeaderZIndex());
      });
    });
  }

  test("the shell does NOT isolate <main>, which would look like the same fix and break every modal", () => {
    /*
     * The tempting one-line version of this fix is `isolate` on
     * <main id="main-content">, which would stop any page from outranking the
     * header ever again. It also breaks the product: App.tsx mounts
     * AIChatPanel and the command palette as MasterPage children — inside
     * <main> — and Modal and AIChatPanel render in place rather than through
     * a portal. Isolating <main> caps all of them at level 0, so the opaque
     * header paints over every modal backdrop and the AI drawer, and the
     * portalled SideOver starts painting over open modals.
     *
     * Isolate the canvas that floats the chrome, never the page that holds it.
     */
    const main: RegExpMatchArray | null = MASTER_PAGE.match(
      /id="main-content"[\s\S]{0,400}?className="([^"]*)"/,
    );

    if (!main || main[1] === undefined) {
      throw new Error(
        'MasterPage\'s <main id="main-content"> no longer declares a className. Re-check that page content still cannot paint over the sticky header before updating this test.',
      );
    }

    expect(main[1]).not.toMatch(/(?<![\w-])isolate(?![\w-])/);
  });
});
