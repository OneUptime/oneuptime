import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactDOM from "react-dom";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import DashboardWidgetLine from "./DashboardWidgetLine";
import { useIsDashboardWidgetPreview } from "./DashboardWidgetPreview";

export interface HoneycombTileDetail {
  label: string;
  value: string;
}

export interface HoneycombTile {
  id: string;
  label?: string | undefined;
  status: string;
  color: string;
  textColor?: string | undefined;
  route?: Route | undefined;
  tooltip: {
    title: string;
    details?: Array<HoneycombTileDetail> | undefined;
  };
}

export interface HoneycombLegendItem {
  label: string;
  color: string;
}

/*
 * How a tile's tooltip was opened, which its last line answers: a tile
 * reached with the keyboard is opened with Enter (or Space), and one under
 * the pointer with a click.
 */
export type HoneycombTooltipOpener = "keyboard" | "pointer";

export interface DashboardResourceHoneycombProps {
  tiles: Array<HoneycombTile>;
  legend?: Array<HoneycombLegendItem> | undefined;
}

export const HONEYCOMB_TILE_TEST_ID: string = "dashboard-honeycomb-tile";

export const HONEYCOMB_TOOLTIP_TEST_ID: string = "dashboard-honeycomb-tooltip";

// The ring round a tile that has the keyboard's focus.
export const HONEYCOMB_FOCUS_RING_TEST_ID: string =
  "dashboard-honeycomb-focus-ring";

const MIN_HEX_WIDTH: number = 28;
const MAX_HEX_WIDTH: number = 56;
const HEX_GAP: number = 3;
const HEX_HEIGHT_RATIO: number = 1.1547; // h/w for pointy-top hex (2/sqrt(3))
const ROW_VERTICAL_OVERLAP: number = 0.25; // each row sits 25% over the previous

function getReadableTextColor(hexOrRgb: string): string {
  const normalized: string = hexOrRgb.trim();
  let r: number = 0;
  let g: number = 0;
  let b: number = 0;
  if (normalized.startsWith("#")) {
    const hex: string =
      normalized.length === 4
        ? `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`
        : normalized;
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  } else {
    const match: RegExpMatchArray | null =
      normalized.match(/rgba?\(([^)]+)\)/i);
    if (match && match[1]) {
      const parts: Array<string> = match[1].split(",");
      r = parseInt(parts[0] || "0", 10);
      g = parseInt(parts[1] || "0", 10);
      b = parseInt(parts[2] || "0", 10);
    }
  }
  const luminance: number = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1f2937" : "#ffffff";
}

interface HexProps {
  tile: HoneycombTile;
  width: number;
  height: number;
  // The open tooltip's id while it is this tile's (aria-describedby).
  describedById?: string | undefined;
  onHoverStart: (
    tile: HoneycombTile,
    rect: { left: number; top: number; width: number; height: number },
    openedBy: HoneycombTooltipOpener,
  ) => void;
  onHoverEnd: () => void;
}

/*
 * The ring round a tile with the keyboard's focus: its line runs `offset`
 * outside the tile's sides and is `width` thick, drawn in a box `room`
 * larger than the tile on every side - its corners sit further out than
 * its sides, and the line's half width beyond them.
 */
export const HONEYCOMB_FOCUS_RING: {
  offset: number;
  width: number;
  room: number;
} = {
  offset: 2.5,
  width: 2,
  room: 6,
};

/**
 * The corners of the focus ring round a tile of this size: the tile's own
 * hexagon (pointy top, as its clip-path draws it), grown so each side runs
 * HONEYCOMB_FOCUS_RING.offset outside the tile's, in the coordinates of the
 * ring's box.
 */
export function getHoneycombFocusRingPoints(
  width: number,
  height: number,
): string {
  const centerX: number = HONEYCOMB_FOCUS_RING.room + width / 2;
  const centerY: number = HONEYCOMB_FOCUS_RING.room + height / 2;
  // A side moved out by d moves the corners out by d / cos(30deg).
  const radius: number =
    height / 2 + (2 * HONEYCOMB_FOCUS_RING.offset) / Math.sqrt(3);

  return [-90, -30, 30, 90, 150, 210]
    .map((degrees: number): string => {
      const angle: number = (degrees * Math.PI) / 180;
      const x: number = centerX + radius * Math.cos(angle);
      const y: number = centerY + radius * Math.sin(angle);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

/*
 * Whether the focus came from the keyboard, the one the ring is for: a tile
 * clicked with the mouse is opened, and a ring drawn for the moment before
 * that is noise. A browser that does not know :focus-visible draws it on
 * every focus rather than on none.
 */
function isFocusVisible(element: HTMLElement): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
}

const Hex: FunctionComponent<HexProps> = (props: HexProps): ReactElement => {
  const { tile, width, height, onHoverStart, onHoverEnd } = props;
  const [hasKeyboardFocus, setHasKeyboardFocus] = useState<boolean>(false);
  /*
   * A DOM ref is RefObject<HTMLDivElement>, not RefObject<HTMLDivElement |
   * null>. RefObject<T> already declares `current` as `T | null`, so spelling
   * the null out again in T gives a type that is structurally identical but
   * NOT assignable: T is covariant in RefObject, and TypeScript compares two
   * references to the same generic type by variance rather than structurally,
   * so it checks `HTMLDivElement | null` against `HTMLDivElement` and rejects
   * it on the `ref` prop below. Keep the element type here; RefObject adds the
   * null on its own.
   */
  const ref: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);

  const textColor: string =
    tile.textColor || getReadableTextColor(tile.color || "#9ca3af");

  const openTooltip: (openedBy: HoneycombTooltipOpener) => void = (
    openedBy: HoneycombTooltipOpener,
  ) => {
    if (!ref.current) {
      return;
    }
    const rect: DOMRect = ref.current.getBoundingClientRect();
    onHoverStart(
      tile,
      {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      openedBy,
    );
  };

  const onMouseEnter: () => void = () => {
    openTooltip("pointer");
  };

  /*
   * A tile reached with Tab says what it is as one under the pointer does:
   * its tooltip opens on focus and closes on blur. It used to open on the
   * pointer only, so a keyboard reader moved through a row of colors that
   * never said which monitor was which, nor that gray is Disabled.
   *
   * Its last line says how to open the tile the way it was reached:
   * Press Enter to open, for the keyboard's focus (#7347). A click focuses
   * the tile too - that tooltip is the pointer's, and still says Click to
   * open.
   */
  const onFocus: () => void = () => {
    const isKeyboardFocus: boolean = Boolean(
      ref.current && isFocusVisible(ref.current),
    );

    openTooltip(isKeyboardFocus ? "keyboard" : "pointer");
    setHasKeyboardFocus(isKeyboardFocus);
  };

  const onBlur: () => void = () => {
    setHasKeyboardFocus(false);
    onHoverEnd();
  };

  const onClick: () => void = () => {
    if (tile.route) {
      Navigation.navigate(tile.route);
    }
  };

  const isClickable: boolean = Boolean(tile.route);

  /*
   * The tile is clipped to its hexagon, which clips any outline or ring
   * drawn on it too: a focused tile looked like every other one. The ring
   * is a hexagon of its own, drawn round the tile in the box that holds it,
   * in the theme's focus color, and over the tiles beside it while it shows.
   * The box is placed only then, so every other tile paints as it did.
   */
  return (
    <div
      style={hasKeyboardFocus ? { position: "relative", zIndex: 1 } : undefined}
    >
      <div
        ref={ref}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onHoverEnd}
        onFocus={onFocus}
        onBlur={onBlur}
        onClick={onClick}
        role={isClickable ? "button" : undefined}
        tabIndex={isClickable ? 0 : undefined}
        /*
         * A button is named: by what the tile stands for, which its
         * tooltip's title is - most tiles draw no words, and the ones that
         * do draw a short label. Its status and the rest are the open
         * tooltip, which describes it.
         */
        aria-label={isClickable ? tile.tooltip.title : undefined}
        aria-describedby={isClickable ? props.describedById : undefined}
        data-testid={HONEYCOMB_TILE_TEST_ID}
        onKeyDown={
          isClickable
            ? (e: React.KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onClick();
                }
              }
            : undefined
        }
        className={`flex items-center justify-center select-none outline-none transition-opacity duration-100 hover:opacity-90 ${
          isClickable ? "cursor-pointer" : "cursor-default"
        }`}
        style={{
          width: `${width}px`,
          height: `${height}px`,
          backgroundColor: tile.color,
          color: textColor,
          clipPath:
            "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
          fontSize: `${Math.max(8, Math.min(11, Math.floor(width / 5)))}px`,
          fontWeight: 600,
          lineHeight: 1,
          padding: "0 4px",
          textAlign: "center",
          overflow: "hidden",
        }}
      >
        {/*
         * The tile's label, in the middle of its tile, read the way its
         * words are written (#7092): an English name too long for its tile
         * on an Arabic or Persian board is cut at its own end, so tiles
         * whose names share an end still differ. Words that read the
         * board's way are drawn as they were.
         */}
        <DashboardWidgetLine
          as="span"
          text={tile.label || ""}
          className="truncate text-center"
          style={{ maxWidth: `${width * 0.8}px`, pointerEvents: "none" }}
        />
      </div>
      {hasKeyboardFocus && (
        <svg
          aria-hidden="true"
          data-testid={HONEYCOMB_FOCUS_RING_TEST_ID}
          className="pointer-events-none absolute"
          width={width + HONEYCOMB_FOCUS_RING.room * 2}
          height={height + HONEYCOMB_FOCUS_RING.room * 2}
          style={{
            left: -HONEYCOMB_FOCUS_RING.room,
            top: -HONEYCOMB_FOCUS_RING.room,
          }}
        >
          <polygon
            points={getHoneycombFocusRingPoints(width, height)}
            fill="none"
            strokeWidth={HONEYCOMB_FOCUS_RING.width}
            strokeLinejoin="round"
            style={{ stroke: "var(--ou-chart-focus-ring, #4f46e5)" }}
          />
        </svg>
      )}
    </div>
  );
};

interface TooltipState {
  tile: HoneycombTile;
  rect: { left: number; top: number; width: number; height: number };
  openedBy: HoneycombTooltipOpener;
}

const TOOLTIP_WIDTH: number = 240;
const TOOLTIP_OFFSET: number = 8;

/**
 * Where a tile's tooltip is drawn: outside the widget's card, on the
 * full-screen element while there is one and on the page's body otherwise.
 *
 * Never inside the card. The card is overflow-hidden and transformed
 * (DashboardBaseComponent scales it, scale(1) when still), and any transform
 * makes the card the containing block of a position:fixed descendant: the
 * tooltip was placed against the card, not the window, and the card cut it
 * off - nobody saw it, so a gray tile never said it was a monitor whose
 * monitoring is off (issue #6966).
 *
 * Not on the body while the board is in full screen (DashboardView puts its
 * canvas there with requestFullscreen): the browser then draws only the
 * full-screen element's subtree, and a tooltip on the body is not drawn.
 * The theme class and the reading direction are set on <html>, so the
 * tooltip keeps both wherever it is drawn.
 */
export function getHoneycombTooltipContainer(): HTMLElement {
  const fullscreenElement: Element | null = document.fullscreenElement;

  return fullscreenElement instanceof HTMLElement
    ? fullscreenElement
    : document.body;
}

const HoneycombTooltip: FunctionComponent<{
  state: TooltipState;
  id: string;
}> = ({ state, id }: { state: TooltipState; id: string }): ReactElement => {
  const translator: Translator = useTranslator();
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    placement: "above" | "below";
  }>({ left: 0, top: 0, placement: "above" });
  const ref: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const tooltipHeight: number = ref.current?.offsetHeight || 100;
    const viewportWidth: number = window.innerWidth;
    const viewportHeight: number = window.innerHeight;

    let left: number =
      state.rect.left + state.rect.width / 2 - TOOLTIP_WIDTH / 2;
    left = Math.max(8, Math.min(viewportWidth - TOOLTIP_WIDTH - 8, left));

    const spaceAbove: number = state.rect.top;
    const placement: "above" | "below" =
      spaceAbove < tooltipHeight + TOOLTIP_OFFSET + 8 ? "below" : "above";

    const top: number =
      placement === "above"
        ? Math.max(8, state.rect.top - tooltipHeight - TOOLTIP_OFFSET)
        : Math.min(
            viewportHeight - tooltipHeight - 8,
            state.rect.top + state.rect.height + TOOLTIP_OFFSET,
          );

    setPosition({ left, top, placement });
  }, [state.rect.left, state.rect.top, state.rect.width, state.rect.height]);

  const details: Array<HoneycombTileDetail> = state.tile.tooltip.details || [];

  /*
   * Drawn outside the widget's card, where its viewport coordinates hold
   * (getHoneycombTooltipContainer): a widget's card is overflow-hidden and
   * transformed (scale), which makes position:fixed relative to the card -
   * so the card cut the tooltip off, and on an Arabic or Persian board it
   * was drawn past the card's right edge, out of sight.
   */
  return ReactDOM.createPortal(
    <div
      ref={ref}
      id={id}
      role="tooltip"
      data-testid={HONEYCOMB_TOOLTIP_TEST_ID}
      className="fixed z-50 pointer-events-none rounded-lg border border-gray-200 bg-white shadow-xl"
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
        width: `${TOOLTIP_WIDTH}px`,
      }}
    >
      <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2">
        <span
          className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: state.tile.color }}
        ></span>
        <DashboardWidgetLine
          as="span"
          text={state.tile.tooltip.title}
          className="text-xs font-semibold text-gray-800 truncate"
        />
      </div>
      <div className="px-3 py-2 space-y-1">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-gray-400">
            {translator.translateText("Status")}
          </span>
          <span className="font-medium text-gray-700 truncate">
            {translator.translateText(state.tile.status)}
          </span>
        </div>
        {details.map((d: HoneycombTileDetail, i: number) => {
          return (
            <div
              key={i}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="text-gray-400">
                {translator.translateText(d.label)}
              </span>
              <DashboardWidgetLine
                as="span"
                text={d.value}
                className="font-medium text-gray-700 truncate"
              />
            </div>
          );
        })}
        {/*
         * How to open the tile, the way it was reached (#7347) - the
         * tile's description to a screen reader too (aria-describedby).
         */}
        {state.tile.route && (
          <div className="text-[10px] text-gray-400 pt-1.5 border-t border-gray-100 mt-1.5">
            {state.openedBy === "keyboard"
              ? translator.translateText("Press Enter to open")
              : translator.translateText("Click to open")}
          </div>
        )}
      </div>
    </div>,
    getHoneycombTooltipContainer(),
  );
};

const DashboardResourceHoneycomb: FunctionComponent<
  DashboardResourceHoneycombProps
> = (props: DashboardResourceHoneycombProps): ReactElement => {
  const containerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [tooltipState, setTooltipState] = useState<TooltipState | null>(null);
  const translator: Translator = useTranslator();
  // The open tooltip's id, which describes the tile it is open for.
  const tooltipId: string = `dashboard-honeycomb-tooltip-${useId()}`;

  /*
   * In the widget's live preview a tile opens nothing (issue #6859): it
   * sits over a board being edited, and the tile's page would take the
   * unsaved widgets with it. The tiles are drawn as on the board, with no
   * button, no pointer and no "Click to open" under them.
   */
  const isPreview: boolean = useIsDashboardWidgetPreview();
  const tiles: Array<HoneycombTile> = useMemo((): Array<HoneycombTile> => {
    if (!isPreview) {
      return props.tiles;
    }

    return props.tiles.map((tile: HoneycombTile): HoneycombTile => {
      return { ...tile, route: undefined };
    });
  }, [props.tiles, isPreview]);

  useEffect(() => {
    const el: HTMLDivElement | null = containerRef.current;
    if (!el) {
      return;
    }
    setContainerWidth(el.clientWidth);
    const observer: ResizeObserver = new ResizeObserver(
      (entries: Array<ResizeObserverEntry>) => {
        for (const entry of entries) {
          setContainerWidth(entry.contentRect.width);
        }
      },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  const { hexWidth, hexHeight, colsPerEvenRow } = useMemo(() => {
    const tileCount: number = tiles.length || 1;
    const usableWidth: number = Math.max(0, containerWidth - 16); // padding

    // Aim for a roughly square-ish layout
    const targetCols: number = Math.max(
      4,
      Math.min(24, Math.ceil(Math.sqrt(tileCount * 1.8))),
    );

    let computedWidth: number = Math.floor(
      (usableWidth - HEX_GAP * (targetCols - 1)) / targetCols,
    );
    computedWidth = Math.max(
      MIN_HEX_WIDTH,
      Math.min(MAX_HEX_WIDTH, computedWidth),
    );

    const cols: number = Math.max(
      1,
      Math.floor((usableWidth + HEX_GAP) / (computedWidth + HEX_GAP)),
    );

    return {
      hexWidth: computedWidth,
      hexHeight: computedWidth * HEX_HEIGHT_RATIO,
      colsPerEvenRow: cols,
    };
  }, [containerWidth, tiles.length]);

  const rows: Array<Array<HoneycombTile>> = useMemo(() => {
    const result: Array<Array<HoneycombTile>> = [];
    let current: Array<HoneycombTile> = [];
    let isOffsetRow: boolean = false;
    let capacity: number = colsPerEvenRow;

    for (const tile of tiles) {
      if (current.length >= capacity) {
        result.push(current);
        current = [];
        isOffsetRow = !isOffsetRow;
        capacity = isOffsetRow
          ? Math.max(1, colsPerEvenRow - 1)
          : colsPerEvenRow;
      }
      current.push(tile);
    }
    if (current.length > 0) {
      result.push(current);
    }
    return result;
  }, [tiles, colsPerEvenRow]);

  const onHoverStart: (
    tile: HoneycombTile,
    rect: { left: number; top: number; width: number; height: number },
    openedBy: HoneycombTooltipOpener,
  ) => void = (
    tile: HoneycombTile,
    rect: { left: number; top: number; width: number; height: number },
    openedBy: HoneycombTooltipOpener,
  ) => {
    setTooltipState({ tile, rect, openedBy });
  };

  const onHoverEnd: () => void = () => {
    setTooltipState(null);
  };

  /*
   * Entering or leaving full screen moves the board, and where its tooltip
   * is drawn (getHoneycombTooltipContainer): the place the tooltip was set
   * at from the tile no longer holds, so it closes, and the next hover
   * opens it again where the tile now is.
   */
  useEffect(() => {
    const onFullscreenChange: () => void = (): void => {
      setTooltipState(null);
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  /*
   * Escape closes the tooltip, opened by the pointer or by the keyboard,
   * and leaves the focus where it is: a tooltip over the next row of tiles
   * is put away without moving off the tile (WCAG 1.4.13). The next hover
   * or focus opens it again.
   */
  const isTooltipOpen: boolean = tooltipState !== null;

  useEffect(() => {
    if (!isTooltipOpen) {
      return;
    }

    const onKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (event.key === "Escape" || event.key === "Esc") {
        setTooltipState(null);
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isTooltipOpen]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-auto flex flex-col"
    >
      <div className="flex-1 px-2 pt-2 pb-1">
        {rows.map((row: Array<HoneycombTile>, rowIdx: number) => {
          return (
            <div
              key={rowIdx}
              className="flex"
              style={{
                gap: `${HEX_GAP}px`,
                marginTop:
                  rowIdx === 0 ? 0 : `${-hexHeight * ROW_VERTICAL_OVERLAP}px`,
                paddingInlineStart:
                  rowIdx % 2 === 1 ? `${(hexWidth + HEX_GAP) / 2}px` : 0,
              }}
            >
              {row.map((tile: HoneycombTile) => {
                return (
                  <Hex
                    key={tile.id}
                    tile={tile}
                    width={hexWidth}
                    height={hexHeight}
                    describedById={
                      tooltipState?.tile.id === tile.id ? tooltipId : undefined
                    }
                    onHoverStart={onHoverStart}
                    onHoverEnd={onHoverEnd}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
      {props.legend && props.legend.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2 pt-1 border-t border-gray-100 bg-gray-50/50">
          {props.legend.map((item: HoneycombLegendItem, i: number) => {
            return (
              <div key={i} className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: item.color }}
                ></span>
                <span className="text-[10px] text-gray-500">
                  {translator.translateText(item.label)}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {tooltipState && <HoneycombTooltip state={tooltipState} id={tooltipId} />}
    </div>
  );
};

export default DashboardResourceHoneycomb;
