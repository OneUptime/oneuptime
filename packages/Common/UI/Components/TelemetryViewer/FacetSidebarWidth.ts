/*
 * HOW WIDE THE FILTERS SIDEBAR IS.
 *
 * "The sidebar has a fixed width, which can make longer service names
 * difficult to read." (issue #5773). The filters sidebar beside every
 * telemetry list - Logs (LogsFacetSidebar) and Traces, Metrics, Exceptions
 * and Security Events (TelemetryFacetSidebar) - was a fixed 14rem, so a
 * service called payments-reconciliation-worker read "payments-reconci…"
 * with nothing to do about it. Its edge can now be dragged
 * (FacetSidebarResizeHandle): wider to read long names whole, narrower to
 * give the list the room. A double-click fits it to the names it lists, the
 * keyboard moves it too, and the width is remembered for the person
 * (useFacetSidebarWidth).
 *
 * What this file holds is the arithmetic, apart from React and the page, so
 * its rules are pinned by unit tests:
 *
 *   - Until a person sizes it, the sidebar is the 14rem it always was.
 *   - It is never narrower than 11rem, where a row still shows a name, its
 *     bar and its count, and never wider than 40rem - nor wider than half
 *     the room it shares with the list, so the list always keeps the other
 *     half, however wide a width was kept on a larger screen. The half is a
 *     CSS rule too (FACET_SIDEBAR_WIDTH_CLASS_NAME), so a window made
 *     narrower later keeps the list its room without anything measured.
 *   - One width for every explorer: the names that are too long in one -
 *     services, hosts, pods - are the same in the others, so a sidebar made
 *     wide enough on Metrics is wide enough on Logs and Traces too.
 *
 * React-free on purpose: App's tests may import it.
 */

// Until a person sizes it: 14rem, the width the sidebar always had (w-56).
export const FACET_SIDEBAR_DEFAULT_WIDTH_IN_PX: number = 224;

/*
 * The least it may be: 11rem, a row's check box, a few letters of its name,
 * its bar and its count.
 */
export const FACET_SIDEBAR_MIN_WIDTH_IN_PX: number = 176;

// The most it may be: 40rem shows a long pod or host name whole.
export const FACET_SIDEBAR_MAX_WIDTH_IN_PX: number = 640;

/*
 * The most of the facets + list area it may take, whatever width was kept:
 * the list keeps the rest. FACET_SIDEBAR_WIDTH_CLASS_NAME says the same in
 * CSS (md:max-w-[50%]).
 */
export const FACET_SIDEBAR_MAX_SHARE_OF_ROOM: number = 0.5;

/*
 * How far one press of an arrow key moves the edge: 16px, or 64px with
 * Shift - the steps of a table column's edge (ColumnWidths).
 */
export const FACET_SIDEBAR_RESIZE_STEP_IN_PX: number = 16;
export const FACET_SIDEBAR_RESIZE_LARGE_STEP_IN_PX: number = 64;

/*
 * The CSS property the kept width is written in, on the sidebar itself:
 * during a drag the handle writes it there directly each frame, and the
 * sidebar's own style writes it once the edge is let go.
 */
export const FACET_SIDEBAR_WIDTH_PROPERTY: string = "--ou-facet-sidebar-width";

/*
 * The sidebar's width from md up: the kept width, else 14rem, and never
 * more than half the room (FACET_SIDEBAR_MAX_SHARE_OF_ROOM). Below md the
 * sidebar stacks above the list at full width (w-full), and no width a
 * person kept applies there.
 */
export const FACET_SIDEBAR_WIDTH_CLASS_NAME: string =
  "md:w-[var(--ou-facet-sidebar-width,14rem)] md:max-w-[50%]";

/*
 * A name's box and what fits in it are read in whole pixels, each rounded:
 * one more pixel, so a name fitted to its sidebar is never cut by the part
 * of a pixel the rounding took off.
 */
export const FACET_SIDEBAR_FIT_ROUNDING_IN_PX: number = 1;

/*
 * The most the sidebar may be drawn in a facets + list area this wide (its
 * content box, in pixels): half of it, and never more than 40rem - nor less
 * than 11rem, the least it is ever drawn. An area not measured (0, or none)
 * leaves only the 40rem.
 */
export const getFacetSidebarMaxWidth: (
  roomWidth?: number | null | undefined,
) => number = (roomWidth?: number | null | undefined): number => {
  if (
    roomWidth === null ||
    roomWidth === undefined ||
    !Number.isFinite(roomWidth) ||
    roomWidth <= 0
  ) {
    return FACET_SIDEBAR_MAX_WIDTH_IN_PX;
  }

  return Math.max(
    FACET_SIDEBAR_MIN_WIDTH_IN_PX,
    Math.min(
      FACET_SIDEBAR_MAX_WIDTH_IN_PX,
      Math.floor(roomWidth * FACET_SIDEBAR_MAX_SHARE_OF_ROOM),
    ),
  );
};

/*
 * A width a person asked for, as the sidebar is drawn: whole pixels, no
 * narrower than 11rem, no wider than maxWidth (getFacetSidebarMaxWidth) or
 * 40rem.
 */
export const clampFacetSidebarWidth: (
  width: number,
  maxWidth?: number | undefined,
) => number = (width: number, maxWidth?: number | undefined): number => {
  const most: number = Math.max(
    FACET_SIDEBAR_MIN_WIDTH_IN_PX,
    Math.min(
      FACET_SIDEBAR_MAX_WIDTH_IN_PX,
      maxWidth !== undefined && Number.isFinite(maxWidth)
        ? maxWidth
        : FACET_SIDEBAR_MAX_WIDTH_IN_PX,
    ),
  );

  if (!Number.isFinite(width)) {
    return FACET_SIDEBAR_MIN_WIDTH_IN_PX;
  }

  return Math.round(
    Math.min(most, Math.max(FACET_SIDEBAR_MIN_WIDTH_IN_PX, width)),
  );
};

/*
 * Where a dragged edge puts the sidebar: as much wider as the pointer moved
 * away from it - to the right on a page that reads left to right, to the
 * left on one that reads right to left, where the sidebar stands at the
 * right and its edge is its left side.
 */
export const getPointerResizedFacetSidebarWidth: (data: {
  startWidth: number;
  startX: number;
  x: number;
  isRightToLeft: boolean;
  maxWidth: number;
}) => number = (data: {
  startWidth: number;
  startX: number;
  x: number;
  isRightToLeft: boolean;
  maxWidth: number;
}): number => {
  const moved: number = data.isRightToLeft
    ? data.startX - data.x
    : data.x - data.startX;

  return clampFacetSidebarWidth(data.startWidth + moved, data.maxWidth);
};

// What a key pressed on the sidebar's edge asks for.
export type FacetSidebarResizeKeyResult =
  | { kind: "width"; width: number }
  // Back to the width the sidebar has until a person sizes it.
  | { kind: "default" }
  // Not a key the edge answers: it goes on to the page (Tab, a shortcut).
  | null;

/*
 * The keyboard's way to size the sidebar, on its focused edge (a
 * separator, as WAI-ARIA's window splitter), the keys a table column's edge
 * answers (ColumnWidths' getKeyboardResizedWidth): the arrow keys move the
 * edge the way they point - so on a right-to-left page the left arrow
 * widens it - 16px a press, 64px with Shift; Home makes it as narrow as it
 * goes, End (or Enter, as a double-click does) fits it to the names it
 * lists, and Delete or Backspace gives it back its own 14rem. With nothing
 * to fit (fitWidth null: no names listed yet), End and Enter leave it be.
 */
export const getKeyboardResizedFacetSidebarWidth: (data: {
  key: string;
  shiftKey: boolean;
  width: number;
  fitWidth: number | null;
  maxWidth: number;
  isRightToLeft: boolean;
}) => FacetSidebarResizeKeyResult = (data: {
  key: string;
  shiftKey: boolean;
  width: number;
  fitWidth: number | null;
  maxWidth: number;
  isRightToLeft: boolean;
}): FacetSidebarResizeKeyResult => {
  const step: number = data.shiftKey
    ? FACET_SIDEBAR_RESIZE_LARGE_STEP_IN_PX
    : FACET_SIDEBAR_RESIZE_STEP_IN_PX;

  switch (data.key) {
    case "ArrowRight":
    case "ArrowLeft": {
      const isWider: boolean =
        (data.key === "ArrowRight") !== Boolean(data.isRightToLeft);

      return {
        kind: "width",
        width: clampFacetSidebarWidth(
          data.width + (isWider ? step : -step),
          data.maxWidth,
        ),
      };
    }
    case "Home":
      return {
        kind: "width",
        width: clampFacetSidebarWidth(
          FACET_SIDEBAR_MIN_WIDTH_IN_PX,
          data.maxWidth,
        ),
      };
    case "End":
    case "Enter":
      return {
        kind: "width",
        width:
          data.fitWidth === null
            ? clampFacetSidebarWidth(data.width, data.maxWidth)
            : clampFacetSidebarWidth(data.fitWidth, data.maxWidth),
      };
    case "Delete":
    case "Backspace":
      return { kind: "default" };
    default:
      return null;
  }
};

/*
 * As wide as the sidebar needs to be to show every name it lists whole.
 * Each name says what it lacks (a positive number of pixels: it is cut
 * short) or what it has to spare (a negative one: it shows whole with room
 * left over) at the width the sidebar is drawn at now
 * (FacetSidebarMeasure's getFacetNameShortfalls); the name that lacks the
 * most decides. Never narrower than the sidebar's own 14rem - a list of
 * short names fits back to it, not to a sliver - and never wider than
 * maxWidth: a name longer than that stays cut short, and shows whole under
 * the pointer as it always did. With no names listed (still loading, or an
 * empty window), there is nothing to fit: null.
 */
export const getFacetSidebarFitWidth: (data: {
  width: number;
  nameShortfalls: ReadonlyArray<number>;
  maxWidth: number;
}) => number | null = (data: {
  width: number;
  nameShortfalls: ReadonlyArray<number>;
  maxWidth: number;
}): number | null => {
  const shortfalls: Array<number> = data.nameShortfalls.filter(
    (shortfall: number): boolean => {
      return Number.isFinite(shortfall);
    },
  );

  if (shortfalls.length === 0 || !Number.isFinite(data.width)) {
    return null;
  }

  const wanted: number =
    Math.ceil(data.width + Math.max(...shortfalls)) +
    FACET_SIDEBAR_FIT_ROUNDING_IN_PX;

  return clampFacetSidebarWidth(
    Math.max(FACET_SIDEBAR_DEFAULT_WIDTH_IN_PX, wanted),
    data.maxWidth,
  );
};

/*
 * A stored width read back. Anything on the way in is untrusted - written by
 * an older release, edited by hand, half written - so only a finite number
 * of pixels is kept, held to what the sidebar may be; anything else is no
 * width at all, and the sidebar is its own 14rem.
 */
export const readFacetSidebarWidth: (value: unknown) => number | null = (
  value: unknown,
): number | null => {
  const width: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;

  if (!Number.isFinite(width) || width <= 0) {
    return null;
  }

  return clampFacetSidebarWidth(width);
};

/*
 * The sidebar's style: the kept width, in the property its width class
 * reads - nothing at all while no width is kept, so the class's own 14rem
 * applies.
 */
export const getFacetSidebarWidthStyle: (
  width: number | null | undefined,
) => Record<string, string> | undefined = (
  width: number | null | undefined,
): Record<string, string> | undefined => {
  if (width === null || width === undefined || !Number.isFinite(width)) {
    return undefined;
  }

  return {
    [FACET_SIDEBAR_WIDTH_PROPERTY]: `${clampFacetSidebarWidth(width)}px`,
  };
};

/*
 * Where the width is remembered: one entry per person (UserPreferences'
 * FacetSidebarWidth), so two people who share a browser - an on-call
 * laptop, a screen in the office - keep their own. A page with no one
 * signed in keeps one for whoever reads it.
 */
export const FACET_SIDEBAR_WIDTH_ANONYMOUS_PERSON: string = "anyone";

export const getFacetSidebarWidthPreferenceKey: (
  personId?: string | null | undefined,
) => string = (personId?: string | null | undefined): string => {
  return (personId || "").trim() || FACET_SIDEBAR_WIDTH_ANONYMOUS_PERSON;
};
