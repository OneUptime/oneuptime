import StatusPageGroupNestingLayoutUtil, {
  StatusPageGroupRollupKind,
} from "../../../Utils/StatusPage/GroupNestingLayout";
import ObjectID from "../../../Types/ObjectID";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import StatusPageGroupViewMode from "../../../Types/StatusPage/StatusPageGroupViewMode";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import { describe, expect, test } from "@jest/globals";

/*
 * Every measurement below is taken from the class strings the util actually
 * emits, not from a number written down beside them. A number kept alongside the
 * classes can drift from them silently - and did: an earlier version of these
 * tests passed unchanged with the real indent inflated six fold.
 *
 * Tailwind's default scale: a spacing step is 0.25rem, so `pl-5` is 20px and
 * `ml-2.5` is 10px. Arbitrary values (`pl-[34px]`) are read literally. Where a
 * class has an `sm:` variant, the variant is the wide viewport value.
 */
const TAILWIND_FONT_SIZE_PX: Record<string, number> = {
  "text-xs": 12,
  "text-sm": 14,
  "text-base": 16,
  "text-lg": 18,
  "text-xl": 20,
  "text-2xl": 24,
};

function tokensOf(className: string): Array<string> {
  return className.split(/\s+/).filter((token: string) => {
    return token.length > 0;
  });
}

/*
 * The value that wins at the wide viewport: the `sm:` variant when there is one,
 * otherwise the unprefixed class.
 */
function wideValueOf(
  className: string,
  prefix: string,
  read: (value: string) => number | null,
): number | null {
  let unprefixed: number | null = null;
  let atSm: number | null = null;

  for (const token of tokensOf(className)) {
    if (token.startsWith(`sm:${prefix}`)) {
      atSm = read(token.substring(`sm:${prefix}`.length));
    } else if (token.startsWith(prefix)) {
      unprefixed = read(token.substring(prefix.length));
    }
  }

  return atSm === null ? unprefixed : atSm;
}

function readSpacing(value: string): number | null {
  const arbitrary: RegExpMatchArray | null = value.match(
    /^\[(\d+(?:\.\d+)?)px]$/,
  );

  if (arbitrary) {
    return Number(arbitrary[1]);
  }

  const step: number = Number(value);

  return Number.isFinite(step) ? step * 4 : null;
}

/* The px value of `pl-*` / `ml-*` / `pt-*` in a class string. */
function spacingPx(className: string, prefix: string): number {
  return wideValueOf(className, prefix, readSpacing) || 0;
}

/* The px font size a class string renders at, at the wide viewport. */
function fontSizePx(className: string): number {
  for (const token of tokensOf(className)) {
    const bare: string = token.startsWith("sm:") ? token.substring(3) : token;

    if (TAILWIND_FONT_SIZE_PX[bare] !== undefined && token.startsWith("sm:")) {
      return TAILWIND_FONT_SIZE_PX[bare]!;
    }
  }

  for (const token of tokensOf(className)) {
    if (TAILWIND_FONT_SIZE_PX[token] !== undefined) {
      return TAILWIND_FONT_SIZE_PX[token]!;
    }
  }

  return 0;
}

/*
 * How far one nesting step moves its contents right: the rail's own offset, the
 * 1px rail itself, and the padding that clears it. Read off the body class, so
 * changing the class changes the number.
 */
function nestingStepPx(depth: number): number {
  const bodyClassName: string =
    StatusPageGroupNestingLayoutUtil.getBodyClassName({ depth: depth });

  if (!bodyClassName.includes("border-l")) {
    return spacingPx(bodyClassName, "ml-") + spacingPx(bodyClassName, "pl-");
  }

  return spacingPx(bodyClassName, "ml-") + 1 + spacingPx(bodyClassName, "pl-");
}

/* Where a group title's text starts: the chevron box plus the gap after it. */
function titleTextOffsetPx(): number {
  return (
    spacingPx(StatusPageGroupNestingLayoutUtil.getChevronBoxClassName(), "w-") +
    spacingPx(StatusPageGroupNestingLayoutUtil.getHeaderRowClassName(), "gap-")
  );
}

/*
 * Contract under test - how the overview page draws nested resource groups.
 *
 * The nesting used to be drawn as a card inside a card inside a card, and at
 * three levels deep that puts four borders around one uptime bar, squeezes the
 * bars off the right of a phone, and renders a leaf resource larger than the
 * group heading above it. Every rule below is one of those failures turned into
 * an assertion:
 *
 *   - only the top level is a card; nothing nested adds a surface,
 *   - a group title is never smaller than the resources inside it,
 *   - the indent stops growing before a deep tree runs out of width,
 *   - and no shape of bad data (a negative depth, a parent pointer cycle) may
 *     break the layout or hang the walk.
 */

const CORPORATE: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const REGION_ONE: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const REGION_TWO: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const MARKET: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const UNIT: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

/* Depths well past anything the write path allows. */
const ABSURD_DEPTHS: Array<number> = [5, 6, 9, 10, 11, 25, 100, 1000];

function makeGroup(data: {
  id: ObjectID;
  name: string;
  parentId?: ObjectID | undefined;
  order?: number | undefined;
  viewMode?: StatusPageGroupViewMode | undefined;
}): StatusPageGroup {
  const group: StatusPageGroup = new StatusPageGroup();
  group._id = data.id.toString();
  group.name = data.name;

  if (data.parentId) {
    group.parentStatusPageGroupId = data.parentId;
  }

  if (data.order !== undefined) {
    group.order = data.order;
  }

  if (data.viewMode) {
    group.viewMode = data.viewMode;
  }

  return group;
}

function makeResource(data: {
  id: ObjectID;
  name: string;
  groupId?: ObjectID | undefined;
  showStatusHistoryChart?: boolean | undefined;
  withMonitor?: boolean | undefined;
  monitorGroupId?: ObjectID | undefined;
}): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = data.id.toString();
  resource.displayName = data.name;

  if (data.groupId) {
    resource.statusPageGroupId = data.groupId;
  }

  if (data.showStatusHistoryChart !== undefined) {
    resource.showStatusHistoryChart = data.showStatusHistoryChart;
  }

  /*
   * The page only draws a resource that resolves to a monitor or a monitor
   * group, so a fixture without one is how "nothing to draw" is expressed.
   */
  if (data.withMonitor !== false && !data.monitorGroupId) {
    const monitor: Monitor = new Monitor();
    monitor._id = data.id.toString();
    resource.monitor = monitor;
  }

  if (data.monitorGroupId) {
    resource.monitorGroupId = data.monitorGroupId;
  }

  return resource;
}

/*
 * Corporate
 *   Region 1000
 *     Market 1001
 *       Unit 0152
 *   Region 2000
 */
function makeHierarchy(): Array<StatusPageGroup> {
  return [
    makeGroup({ id: CORPORATE, name: "Corporate", order: 1 }),
    makeGroup({
      id: REGION_ONE,
      name: "Region 1000",
      parentId: CORPORATE,
      order: 2,
    }),
    makeGroup({
      id: MARKET,
      name: "Market 1001",
      parentId: REGION_ONE,
      order: 3,
    }),
    makeGroup({ id: UNIT, name: "Unit 0152", parentId: MARKET, order: 4 }),
    makeGroup({
      id: REGION_TWO,
      name: "Region 2000",
      parentId: CORPORATE,
      order: 5,
    }),
  ];
}

describe("StatusPageGroupNestingLayoutUtil", () => {
  describe("getVisualDepth", () => {
    test("passes a normal depth straight through", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.getVisualDepth({ depth: 0 }),
      ).toBe(0);
      expect(
        StatusPageGroupNestingLayoutUtil.getVisualDepth({ depth: 1 }),
      ).toBe(1);
      expect(
        StatusPageGroupNestingLayoutUtil.getVisualDepth({ depth: 3 }),
      ).toBe(3);
    });

    test("clamps at MaxIndentedDepth so a deep tree keeps its width", () => {
      for (const depth of ABSURD_DEPTHS) {
        expect(
          StatusPageGroupNestingLayoutUtil.getVisualDepth({ depth: depth }),
        ).toBe(StatusPageGroupNestingLayoutUtil.MaxIndentedDepth);
      }
    });

    /*
     * Depth comes from a recursive render today, but a bad number must degrade
     * to the top level rather than produce a class like `pl-NaN`.
     */
    test.each([[-1], [-10], [Number.NEGATIVE_INFINITY], [Number.NaN]])(
      "treats %p as the top level",
      (depth: number) => {
        expect(
          StatusPageGroupNestingLayoutUtil.getVisualDepth({ depth: depth }),
        ).toBe(0);
      },
    );

    test("treats positive infinity as the top level rather than returning it", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.getVisualDepth({
          depth: Number.POSITIVE_INFINITY,
        }),
      ).toBe(0);
    });

    test("floors a fractional depth", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.getVisualDepth({ depth: 2.9 }),
      ).toBe(2);
      expect(
        StatusPageGroupNestingLayoutUtil.getVisualDepth({ depth: 0.9 }),
      ).toBe(0);
    });

    test("never decreases as depth increases", () => {
      let previous: number = StatusPageGroupNestingLayoutUtil.getVisualDepth({
        depth: 0,
      });

      for (let depth: number = 1; depth <= 30; depth++) {
        const current: number = StatusPageGroupNestingLayoutUtil.getVisualDepth(
          {
            depth: depth,
          },
        );

        expect(current).toBeGreaterThanOrEqual(previous);
        previous = current;
      }
    });
  });

  describe("isRootLevel", () => {
    test("only the top level, and anything that degrades to it, is root", () => {
      expect(StatusPageGroupNestingLayoutUtil.isRootLevel({ depth: 0 })).toBe(
        true,
      );
      expect(StatusPageGroupNestingLayoutUtil.isRootLevel({ depth: -5 })).toBe(
        true,
      );
      expect(
        StatusPageGroupNestingLayoutUtil.isRootLevel({ depth: Number.NaN }),
      ).toBe(true);
      expect(StatusPageGroupNestingLayoutUtil.isRootLevel({ depth: 1 })).toBe(
        false,
      );
      expect(StatusPageGroupNestingLayoutUtil.isRootLevel({ depth: 12 })).toBe(
        false,
      );
    });
  });

  describe("title sizing", () => {
    /*
     * The regression this guards: resource names rendered at text-lg while a
     * nested group heading rendered at text-sm, so the leaf looked more
     * important than the branch it hung off. Both sides are measured off the
     * class strings that render, so shrinking either one fails here.
     */
    test("a group title is never smaller than the resources inside it", () => {
      const resourcePx: number = fontSizePx(
        StatusPageGroupNestingLayoutUtil.getResourceTitleClassName(),
      );

      expect(resourcePx).toBeGreaterThan(0);

      for (let depth: number = 0; depth <= 30; depth++) {
        expect(
          fontSizePx(
            StatusPageGroupNestingLayoutUtil.getTitleClassName({
              depth: depth,
            }),
          ),
        ).toBeGreaterThanOrEqual(resourcePx);
      }
    });

    test("title size never grows as the hierarchy gets deeper", () => {
      let previous: number = fontSizePx(
        StatusPageGroupNestingLayoutUtil.getTitleClassName({ depth: 0 }),
      );

      expect(previous).toBeGreaterThan(0);

      for (let depth: number = 1; depth <= 30; depth++) {
        const current: number = fontSizePx(
          StatusPageGroupNestingLayoutUtil.getTitleClassName({ depth: depth }),
        );

        expect(current).toBeGreaterThan(0);
        expect(current).toBeLessThanOrEqual(previous);
        previous = current;
      }
    });

    test("the top level outranks everything below it", () => {
      expect(
        fontSizePx(
          StatusPageGroupNestingLayoutUtil.getTitleClassName({ depth: 0 }),
        ),
      ).toBeGreaterThan(
        fontSizePx(
          StatusPageGroupNestingLayoutUtil.getTitleClassName({ depth: 1 }),
        ),
      );
    });

    /*
     * A group title is heavier than a resource name at the same size - that is
     * what separates a heading from a reading when the rail is the only other
     * cue.
     */
    test("a group title is heavier than a resource name", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.getResourceTitleClassName(),
      ).toContain("font-medium");

      for (let depth: number = 0; depth <= 12; depth++) {
        const className: string =
          StatusPageGroupNestingLayoutUtil.getTitleClassName({ depth: depth });

        expect(className).toContain("font-semibold");
        expect(className).toContain("text-gray-900");
      }
    });

    test("nested titles are all styled the same - depth is shown by the rail", () => {
      const atOne: string = StatusPageGroupNestingLayoutUtil.getTitleClassName({
        depth: 1,
      });

      for (let depth: number = 2; depth <= 12; depth++) {
        expect(
          StatusPageGroupNestingLayoutUtil.getTitleClassName({ depth: depth }),
        ).toBe(atOne);
      }
    });
  });

  describe("getContainerClassName", () => {
    test("the top level is a card", () => {
      const className: string =
        StatusPageGroupNestingLayoutUtil.getContainerClassName({ depth: 0 });

      expect(className).toContain("bg-white");
      expect(className).toContain("rounded-xl");
      expect(className).toContain("shadow");
    });

    /*
     * The headline regression: a nested group must not introduce a surface of
     * its own. Asserted as the absence of each surface class rather than as an
     * empty string, so a future non-surface class (`relative`, say) does not
     * fail the test while a returning card still does.
     */
    test("nothing nested adds a card, a border or a background", () => {
      for (let depth: number = 1; depth <= 12; depth++) {
        const className: string =
          StatusPageGroupNestingLayoutUtil.getContainerClassName({
            depth: depth,
          });

        expect(className).not.toMatch(/\bbg-/);
        expect(className).not.toMatch(/\bborder/);
        expect(className).not.toMatch(/\brounded/);
        expect(className).not.toMatch(/\bshadow/);
        expect(className).not.toMatch(/\bp[xytblr]?-/);
      }
    });
  });

  describe("getBodyClassName", () => {
    test("the top level body has no rail - the card edge is the boundary", () => {
      const className: string =
        StatusPageGroupNestingLayoutUtil.getBodyClassName({ depth: 0 });

      expect(className).not.toContain("border-l");
      expect(className).not.toContain("pl-");
      expect(StatusPageGroupNestingLayoutUtil.showRail({ depth: 0 })).toBe(
        false,
      );
    });

    test("every nested body hangs off exactly one hairline rail", () => {
      for (let depth: number = 1; depth <= 12; depth++) {
        const className: string =
          StatusPageGroupNestingLayoutUtil.getBodyClassName({ depth: depth });

        expect(className).toContain("border-l");
        // border-l, not border-l-2: one hairline, however deep it goes.
        expect(className).not.toContain("border-l-2");
        expect(className).toContain("border-gray-200");
        expect(className).toMatch(/pl-/);
        expect(
          StatusPageGroupNestingLayoutUtil.showRail({ depth: depth }),
        ).toBe(true);
      }
    });

    test("the indent tightens past MaxIndentedDepth instead of growing", () => {
      expect(
        nestingStepPx(StatusPageGroupNestingLayoutUtil.MaxIndentedDepth),
      ).toBeLessThan(nestingStepPx(1));
    });

    /*
     * A sub group is meant to read as hanging off its parent's title, not off
     * the parent's chevron, so one nesting step moves its contents to where the
     * parent's title text starts. Both sides are measured off the classes that
     * render: the chevron box and header gap on one side, the body's margin,
     * rail and padding on the other.
     */
    test("a nesting step lands a sub group's contents at its parent's title", () => {
      const offset: number = titleTextOffsetPx();

      expect(offset).toBeGreaterThan(0);
      expect(nestingStepPx(1)).toBeGreaterThan(offset - 3);
      expect(nestingStepPx(1)).toBeLessThanOrEqual(offset);
    });

    test("the top level costs no indent at all", () => {
      expect(nestingStepPx(0)).toBe(0);
    });

    test("every nesting step costs something, so the rails stay apart", () => {
      for (let depth: number = 1; depth <= 12; depth++) {
        expect(nestingStepPx(depth)).toBeGreaterThan(0);
      }
    });

    test("the indent never grows as the hierarchy gets deeper", () => {
      let previous: number = nestingStepPx(1);

      for (let depth: number = 2; depth <= 30; depth++) {
        const current: number = nestingStepPx(depth);

        expect(current).toBeLessThanOrEqual(previous);
        previous = current;
      }
    });

    /*
     * The write path caps nesting at StatusPageGroupTreeUtil.MaxNestingDepth
     * (10), so a fully nested resource is indented by the sum of ten steps. The
     * status page content column is max-w-5xl minus padding, about 984px, and
     * the uptime bars have to stay readable inside what is left.
     */
    test("the deepest nesting the write path allows costs a quarter of the column", () => {
      let total: number = 0;

      for (let depth: number = 1; depth <= 10; depth++) {
        total += nestingStepPx(depth);
      }

      expect(total).toBeGreaterThan(0);
      expect(total).toBeLessThan(250);
    });

    /* Every step past the cap has to be cheap, or depth 20 runs off the page. */
    test("a step past the cap costs no more than 20px", () => {
      expect(
        nestingStepPx(StatusPageGroupNestingLayoutUtil.MaxIndentedDepth + 5),
      ).toBeLessThanOrEqual(20);
    });

    test("the rail is placed under its parent's chevron, not flush left", () => {
      expect(
        spacingPx(
          StatusPageGroupNestingLayoutUtil.getBodyClassName({ depth: 1 }),
          "ml-",
        ),
      ).toBeGreaterThan(0);
    });

    test("depths beyond the cap all render the same tightened indent", () => {
      const atCap: string = StatusPageGroupNestingLayoutUtil.getBodyClassName({
        depth: StatusPageGroupNestingLayoutUtil.MaxIndentedDepth,
      });

      for (const depth of ABSURD_DEPTHS) {
        expect(
          StatusPageGroupNestingLayoutUtil.getBodyClassName({ depth: depth }),
        ).toBe(atCap);
      }
    });

    test("a bad depth falls back to the top level body", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.getBodyClassName({
          depth: Number.NaN,
        }),
      ).toBe(StatusPageGroupNestingLayoutUtil.getBodyClassName({ depth: 0 }));
    });
  });

  describe("getHeaderClassName", () => {
    test("the header is a focusable control that pushes its two ends apart", () => {
      for (let depth: number = 0; depth <= 12; depth++) {
        const className: string =
          StatusPageGroupNestingLayoutUtil.getHeaderClassName({ depth: depth });

        expect(tokensOf(className)).toContain("flex");
        expect(className).toContain("justify-between");
        expect(className).toContain("focus-visible:ring-2");
      }
    });

    /*
     * The hover background bleeds to the edge of the content column via equal
     * and opposite margin and padding, and the width has to pay for both margins
     * or the box is over-constrained: the browser then drops margin-right (CSS
     * 2.1 10.3.3) and every rollup lands 16px short of the card edge the resource
     * readings sit on. `w-full` is exactly that mistake.
     */
    test("the bleed is symmetric and paid for, so the rollup lines up with the readings below", () => {
      for (let depth: number = 0; depth <= 12; depth++) {
        const className: string =
          StatusPageGroupNestingLayoutUtil.getHeaderClassName({ depth: depth });

        const bleedPerSide: number = spacingPx(className, "-mx-");

        expect(bleedPerSide).toBeGreaterThan(0);
        expect(spacingPx(className, "px-")).toBe(bleedPerSide);

        /* A button shrink wraps without a width, even as a flex container. */
        expect(tokensOf(className)).not.toContain("w-full");
        expect(className).toContain(
          `w-[calc(100%+${(bleedPerSide * 2) / 16}rem)]`,
        );
      }
    });
  });

  describe("spacing and chrome tokens", () => {
    /*
     * Measured, not restated: the description's indent has to equal the chevron
     * box plus the gap after it, both of which are classes on the header.
     */
    test("the description lines up with the title, not the chevron", () => {
      const offset: number = titleTextOffsetPx();

      expect(offset).toBeGreaterThan(0);
      expect(
        spacingPx(
          StatusPageGroupNestingLayoutUtil.getDescriptionClassName(),
          "pl-",
        ),
      ).toBe(offset);
    });

    test("the ungrouped card is the same surface as a top level group", () => {
      const card: string =
        StatusPageGroupNestingLayoutUtil.getUngroupedResourcesCardClassName();

      expect(card).toContain("bg-white");
      expect(card).toContain("rounded-xl");
      expect(card).toContain("shadow");
    });

    /*
     * A rollup and a resource reading are the same kind of number, so they are
     * set at the same size - measured off both class strings rather than
     * asserting the literals one of them happens to contain.
     */
    test("a rollup is sized like the resource readings below it", () => {
      expect(
        fontSizePx(StatusPageGroupNestingLayoutUtil.getRollupClassName()),
      ).toBe(
        fontSizePx(
          StatusPageGroupNestingLayoutUtil.getResourceTitleClassName(),
        ),
      );
      expect(StatusPageGroupNestingLayoutUtil.getRollupClassName()).toContain(
        "flex-shrink-0",
      );
    });

    test("a rollup is marked with a dot so it does not read as a resource's own", () => {
      const dot: string =
        StatusPageGroupNestingLayoutUtil.getRollupDotClassName();

      expect(dot).toContain("rounded-full");
      expect(dot).toContain("flex-shrink-0");
      expect(
        StatusPageGroupNestingLayoutUtil.getRollupLabelClassName(),
      ).toContain("tabular-nums");
    });

    test("the sub group list is spaced at every depth", () => {
      for (let depth: number = 0; depth <= 12; depth++) {
        expect(
          StatusPageGroupNestingLayoutUtil.getSubGroupListClassName({
            depth: depth,
          }),
        ).toMatch(/space-y-/);
      }
    });

    /*
     * justify-between is inert without flex, and the axis exists precisely to
     * push "90 days ago" and "Today" to opposite ends.
     */
    test("the time axis pushes its two ends apart", () => {
      const axis: string =
        StatusPageGroupNestingLayoutUtil.getTimeAxisClassName();

      expect(tokensOf(axis)).toContain("flex");
      expect(tokensOf(axis)).toContain("justify-between");
    });

    test("the resource list carries its own rhythm", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.getResourceListClassName(),
      ).toMatch(/space-y-/);
    });

    test("the sub group count badge is a quiet pill", () => {
      const badge: string =
        StatusPageGroupNestingLayoutUtil.getSubGroupCountBadgeClassName();

      expect(badge).toContain("rounded-full");
      expect(badge).toContain("text-gray-500");
      expect(badge).toContain("flex-shrink-0");
    });
  });

  describe("getRollupKind", () => {
    test("a healthy group configured for uptime shows its uptime percent", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.getRollupKind({
          showUptimePercent: true,
          showCurrentStatus: true,
          isCurrentlyDown: false,
          uptimePercent: 99.9,

          resourceCountInSubtree: 1,
        }),
      ).toBe(StatusPageGroupRollupKind.UptimePercent);
    });

    /*
     * "99.9% uptime" next to a group that is down right now is not what a
     * visitor came to read.
     */
    test("a group that is down shows its status, not a percent", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.getRollupKind({
          showUptimePercent: true,
          showCurrentStatus: true,
          isCurrentlyDown: true,
          uptimePercent: 99.9,

          resourceCountInSubtree: 1,
        }),
      ).toBe(StatusPageGroupRollupKind.CurrentStatus);
    });

    /*
     * A group with nothing under it has no uptime to average. Showing a zero
     * would read as an outage.
     */
    test("a group with no uptime to report shows nothing rather than a zero", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.getRollupKind({
          showUptimePercent: true,
          showCurrentStatus: true,
          isCurrentlyDown: false,
          uptimePercent: null,

          resourceCountInSubtree: 1,
        }),
      ).toBe(StatusPageGroupRollupKind.None);
    });

    test("a group configured for status only shows its status", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.getRollupKind({
          showUptimePercent: false,
          showCurrentStatus: true,
          isCurrentlyDown: false,
          uptimePercent: 100,

          resourceCountInSubtree: 1,
        }),
      ).toBe(StatusPageGroupRollupKind.CurrentStatus);
    });

    test("a group configured for neither shows nothing", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.getRollupKind({
          showUptimePercent: false,
          showCurrentStatus: false,
          isCurrentlyDown: false,
          uptimePercent: 100,

          resourceCountInSubtree: 1,
        }),
      ).toBe(StatusPageGroupRollupKind.None);
    });

    test("a group that is down and shows no status shows nothing", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.getRollupKind({
          showUptimePercent: true,
          showCurrentStatus: false,
          isCurrentlyDown: true,
          uptimePercent: 99.9,

          resourceCountInSubtree: 1,
        }),
      ).toBe(StatusPageGroupRollupKind.None);
    });

    test("a zero percent uptime is still a percent, not nothing", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.getRollupKind({
          showUptimePercent: true,
          showCurrentStatus: true,
          isCurrentlyDown: false,
          uptimePercent: 0,

          resourceCountInSubtree: 1,
        }),
      ).toBe(StatusPageGroupRollupKind.UptimePercent);
    });

    /*
     * A hierarchy is drawn while it is still being filled in, so groups with
     * nothing under them yet are on the page. The rolled up status defaults to
     * Operational when it finds no resources to look at, and publishing that
     * would be telling visitors that a group containing no monitors is healthy.
     */
    test("a group with nothing under it shows no rollup, whatever it is configured for", () => {
      for (const showUptimePercent of [true, false]) {
        for (const showCurrentStatus of [true, false]) {
          expect(
            StatusPageGroupNestingLayoutUtil.getRollupKind({
              showUptimePercent: showUptimePercent,
              showCurrentStatus: showCurrentStatus,
              isCurrentlyDown: false,
              uptimePercent: null,
              resourceCountInSubtree: 0,
            }),
          ).toBe(StatusPageGroupRollupKind.None);
        }
      }
    });

    /*
     * The count is of the whole subtree, so a holder group whose own resource
     * list is empty still reports for the monitors nested under it.
     */
    test("a holder group reports the resources nested below it", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.getRollupKind({
          showUptimePercent: false,
          showCurrentStatus: true,
          isCurrentlyDown: false,
          uptimePercent: null,
          resourceCountInSubtree: 12,
        }),
      ).toBe(StatusPageGroupRollupKind.CurrentStatus);
    });
  });

  describe("shouldShowSubGroupDivider", () => {
    /*
     * Without the line, a group's last resource reads as the first row of the
     * first sub group below it.
     */
    test("a line is drawn only between own resources and sub groups", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.shouldShowSubGroupDivider({
          hasOwnResources: true,
          subGroupCount: 1,
        }),
      ).toBe(true);
      expect(
        StatusPageGroupNestingLayoutUtil.shouldShowSubGroupDivider({
          hasOwnResources: true,
          subGroupCount: 0,
        }),
      ).toBe(false);
      expect(
        StatusPageGroupNestingLayoutUtil.shouldShowSubGroupDivider({
          hasOwnResources: false,
          subGroupCount: 3,
        }),
      ).toBe(false);
      expect(
        StatusPageGroupNestingLayoutUtil.shouldShowSubGroupDivider({
          hasOwnResources: false,
          subGroupCount: 0,
        }),
      ).toBe(false);
    });

    test("the divider is a hairline with padding, not a margin", () => {
      const divider: string =
        StatusPageGroupNestingLayoutUtil.getSubGroupDividerClassName();

      expect(divider).toContain("border-t");
      expect(divider).toMatch(/pt-/);
    });
  });

  describe("shouldRenderOwnResources", () => {
    /*
     * A group that exists only to hold sub groups is not empty - the sub groups
     * are its content - so it must not render the "no resources" message.
     */
    test("a holder group with sub groups renders no resource list of its own", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.shouldRenderOwnResources({
          ownResourceCount: 0,
          subGroupCount: 2,
        }),
      ).toBe(false);
    });

    test("a group with resources always renders them", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.shouldRenderOwnResources({
          ownResourceCount: 1,
          subGroupCount: 0,
        }),
      ).toBe(true);
      expect(
        StatusPageGroupNestingLayoutUtil.shouldRenderOwnResources({
          ownResourceCount: 4,
          subGroupCount: 3,
        }),
      ).toBe(true);
    });

    /*
     * A truly empty group still renders the list, because that is where the
     * "no resources added to this group" message lives.
     */
    test("a group with neither resources nor sub groups still renders the list", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.shouldRenderOwnResources({
          ownResourceCount: 0,
          subGroupCount: 0,
        }),
      ).toBe(true);
    });
  });

  /*
   * The overview page used to gate its whole resources-and-groups block on
   * `statusPageResources.length > 0`. That made a status page carrying a fully
   * built group hierarchy and no monitors render nothing at all: the operator
   * created their groups, saw them listed in the dashboard, and got an empty
   * public page until the first monitor was attached to one of them.
   *
   * Groups are content. These two gates are what says so, and they have to
   * agree with each other - a page that renders its hierarchy must not also
   * render an empty state above it saying there is nothing here.
   */
  describe("shouldRenderResourcesSection", () => {
    test("renders for a page with groups and no resources at all", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.shouldRenderResourcesSection({
          statusPageResourceCount: 0,
          statusPageGroupCount: 1,
        }),
      ).toBe(true);
    });

    /* The size the bug was reported at. */
    test("renders for a large hierarchy with no resources", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.shouldRenderResourcesSection({
          statusPageResourceCount: 0,
          statusPageGroupCount: 1506,
        }),
      ).toBe(true);
    });

    test("renders for a page with resources and no groups", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.shouldRenderResourcesSection({
          statusPageResourceCount: 3,
          statusPageGroupCount: 0,
        }),
      ).toBe(true);
    });

    test("renders for a page with both", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.shouldRenderResourcesSection({
          statusPageResourceCount: 3,
          statusPageGroupCount: 4,
        }),
      ).toBe(true);
    });

    test("renders nothing for a page with neither", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.shouldRenderResourcesSection({
          statusPageResourceCount: 0,
          statusPageGroupCount: 0,
        }),
      ).toBe(false);
    });
  });

  describe("shouldRenderOverviewEmptyState", () => {
    type EmptyStateInput = Parameters<
      typeof StatusPageGroupNestingLayoutUtil.shouldRenderOverviewEmptyState
    >[0];

    function emptyPage(overrides: Partial<EmptyStateInput> = {}): boolean {
      return StatusPageGroupNestingLayoutUtil.shouldRenderOverviewEmptyState({
        statusPageResourceCount: 0,
        statusPageGroupCount: 0,
        activeIncidentCount: 0,
        activeEpisodeCount: 0,
        activeScheduledMaintenanceCount: 0,
        activeAnnouncementCount: 0,
        ...overrides,
      });
    }

    test("a page with nothing on it shows the empty state", () => {
      expect(emptyPage()).toBe(true);
    });

    /*
     * The half of the bug the visitor actually saw: 1506 groups on the page,
     * and an "all clear, nothing to see" panel rendered instead of them.
     */
    test("a page with groups and no resources does not show the empty state", () => {
      expect(emptyPage({ statusPageGroupCount: 1506 })).toBe(false);
    });

    test("a page with resources does not show the empty state", () => {
      expect(emptyPage({ statusPageResourceCount: 1 })).toBe(false);
    });

    test.each([
      ["an active incident", "activeIncidentCount"],
      ["an active episode", "activeEpisodeCount"],
      ["a scheduled maintenance event", "activeScheduledMaintenanceCount"],
      ["an announcement", "activeAnnouncementCount"],
    ])(
      "%s suppresses the empty state on its own",
      (_name: string, key: string) => {
        expect(emptyPage({ [key]: 1 } as Partial<EmptyStateInput>)).toBe(false);
      },
    );

    /*
     * The two gates are read off the same two counts, and the page renders
     * both of them. If they ever disagree the visitor sees an empty state
     * stacked on top of the hierarchy it claims is not there, so the
     * relationship is asserted over every combination rather than sampled.
     */
    test("never contradicts shouldRenderResourcesSection", () => {
      const counts: Array<number> = [0, 1, 2, 1506];

      for (const statusPageResourceCount of counts) {
        for (const statusPageGroupCount of counts) {
          const rendersSection: boolean =
            StatusPageGroupNestingLayoutUtil.shouldRenderResourcesSection({
              statusPageResourceCount: statusPageResourceCount,
              statusPageGroupCount: statusPageGroupCount,
            });

          const rendersEmptyState: boolean = emptyPage({
            statusPageResourceCount: statusPageResourceCount,
            statusPageGroupCount: statusPageGroupCount,
          });

          expect(rendersSection && rendersEmptyState).toBe(false);
          expect(rendersSection || rendersEmptyState).toBe(true);
        }
      }
    });
  });

  describe("shouldRenderTimeAxis", () => {
    const CHARTED: ObjectID = new ObjectID(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    const UNCHARTED: ObjectID = new ObjectID(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );

    test("a group with a charted resource of its own draws one axis", () => {
      const groups: Array<StatusPageGroup> = makeHierarchy();

      expect(
        StatusPageGroupNestingLayoutUtil.shouldRenderTimeAxis({
          statusPageGroup: groups[0]!,
          statusPageResources: [
            makeResource({
              id: CHARTED,
              name: "Corporate API",
              groupId: CORPORATE,
              showStatusHistoryChart: true,
            }),
          ],
        }),
      ).toBe(true);
    });

    /*
     * The axis belongs next to the bars it labels. A sub group's bars are
     * indented past this group's, and a sub group may be collapsed, so this
     * group's axis must not claim to describe them.
     */
    test("a descendant's charted resource does not put an axis on the parent", () => {
      const groups: Array<StatusPageGroup> = makeHierarchy();

      expect(
        StatusPageGroupNestingLayoutUtil.shouldRenderTimeAxis({
          statusPageGroup: groups[0]!,
          statusPageResources: [
            makeResource({
              id: CHARTED,
              name: "Unit 0152 API",
              groupId: UNIT,
              showStatusHistoryChart: true,
            }),
          ],
        }),
      ).toBe(false);
    });

    test("a group whose resources draw no history chart draws no axis", () => {
      const groups: Array<StatusPageGroup> = makeHierarchy();

      expect(
        StatusPageGroupNestingLayoutUtil.shouldRenderTimeAxis({
          statusPageGroup: groups[0]!,
          statusPageResources: [
            makeResource({
              id: UNCHARTED,
              name: "Corporate API",
              groupId: CORPORATE,
              showStatusHistoryChart: false,
            }),
          ],
        }),
      ).toBe(false);
    });

    /*
     * A grid group draws a matrix of cells rather than bars over a window, so a
     * "90 days ago ... Today" axis would be labelling something that is not
     * there.
     */
    test("a grid view group draws no axis", () => {
      const gridGroup: StatusPageGroup = makeGroup({
        id: CORPORATE,
        name: "Corporate",
        order: 1,
        viewMode: StatusPageGroupViewMode.Grid,
      });

      expect(
        StatusPageGroupNestingLayoutUtil.shouldRenderTimeAxis({
          statusPageGroup: gridGroup,
          statusPageResources: [
            makeResource({
              id: CHARTED,
              name: "Corporate API",
              groupId: CORPORATE,
              showStatusHistoryChart: true,
            }),
          ],
        }),
      ).toBe(false);
    });

    test("a list view group draws one", () => {
      const listGroup: StatusPageGroup = makeGroup({
        id: CORPORATE,
        name: "Corporate",
        order: 1,
        viewMode: StatusPageGroupViewMode.List,
      });

      expect(
        StatusPageGroupNestingLayoutUtil.shouldRenderTimeAxis({
          statusPageGroup: listGroup,
          statusPageResources: [
            makeResource({
              id: CHARTED,
              name: "Corporate API",
              groupId: CORPORATE,
              showStatusHistoryChart: true,
            }),
          ],
        }),
      ).toBe(true);
    });

    test("the ungrouped block draws an axis for its own resources", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.shouldRenderTimeAxis({
          statusPageGroup: null,
          statusPageResources: [
            makeResource({
              id: CHARTED,
              name: "Ungrouped",
              showStatusHistoryChart: true,
            }),
          ],
        }),
      ).toBe(true);
    });

    test("a grouped resource does not put an axis on the ungrouped block", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.shouldRenderTimeAxis({
          statusPageGroup: null,
          statusPageResources: [
            makeResource({
              id: CHARTED,
              name: "Corporate API",
              groupId: CORPORATE,
              showStatusHistoryChart: true,
            }),
          ],
        }),
      ).toBe(false);
    });

    test("a resource with nothing to draw cannot bring an axis with it", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.shouldRenderTimeAxis({
          statusPageGroup: null,
          statusPageResources: [
            makeResource({
              id: CHARTED,
              name: "Ungrouped",
              showStatusHistoryChart: true,
              withMonitor: false,
            }),
          ],
        }),
      ).toBe(false);
    });

    test("a monitor group resource can bring an axis with it", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.shouldRenderTimeAxis({
          statusPageGroup: null,
          statusPageResources: [
            makeResource({
              id: CHARTED,
              name: "Ungrouped",
              showStatusHistoryChart: true,
              withMonitor: false,
              monitorGroupId: UNCHARTED,
            }),
          ],
        }),
      ).toBe(true);
    });

    test("an empty page has no axis", () => {
      expect(
        StatusPageGroupNestingLayoutUtil.shouldRenderTimeAxis({
          statusPageGroup: null,
          statusPageResources: [],
        }),
      ).toBe(false);
    });
  });
});
