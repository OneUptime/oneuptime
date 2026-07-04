import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";

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

export interface DashboardResourceHoneycombProps {
  tiles: Array<HoneycombTile>;
  legend?: Array<HoneycombLegendItem> | undefined;
}

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
  onHoverStart: (
    tile: HoneycombTile,
    rect: { left: number; top: number; width: number; height: number },
  ) => void;
  onHoverEnd: () => void;
}

const Hex: FunctionComponent<HexProps> = (props: HexProps): ReactElement => {
  const { tile, width, height, onHoverStart, onHoverEnd } = props;
  const ref: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);

  const textColor: string =
    tile.textColor || getReadableTextColor(tile.color || "#9ca3af");

  const onMouseEnter: () => void = () => {
    if (!ref.current) {
      return;
    }
    const rect: DOMRect = ref.current.getBoundingClientRect();
    onHoverStart(tile, {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    });
  };

  const onClick: () => void = () => {
    if (tile.route) {
      Navigation.navigate(tile.route);
    }
  };

  const isClickable: boolean = Boolean(tile.route);

  return (
    <div
      ref={ref}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onHoverEnd}
      onClick={onClick}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
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
      className={`flex items-center justify-center select-none transition-opacity duration-100 hover:opacity-90 ${
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
      <span
        className="truncate"
        style={{ maxWidth: `${width * 0.8}px`, pointerEvents: "none" }}
      >
        {tile.label || ""}
      </span>
    </div>
  );
};

interface TooltipState {
  tile: HoneycombTile;
  rect: { left: number; top: number; width: number; height: number };
}

const TOOLTIP_WIDTH: number = 240;
const TOOLTIP_OFFSET: number = 8;

const HoneycombTooltip: FunctionComponent<{ state: TooltipState }> = ({
  state,
}: {
  state: TooltipState;
}): ReactElement => {
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

  return (
    <div
      ref={ref}
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
        <span className="text-xs font-semibold text-gray-800 truncate">
          {state.tile.tooltip.title}
        </span>
      </div>
      <div className="px-3 py-2 space-y-1">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-gray-400">Status</span>
          <span className="font-medium text-gray-700 truncate">
            {state.tile.status}
          </span>
        </div>
        {details.map((d: HoneycombTileDetail, i: number) => {
          return (
            <div
              key={i}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="text-gray-400">{d.label}</span>
              <span className="font-medium text-gray-700 truncate">
                {d.value}
              </span>
            </div>
          );
        })}
        {state.tile.route && (
          <div className="text-[10px] text-gray-400 pt-1.5 border-t border-gray-100 mt-1.5">
            Click to open
          </div>
        )}
      </div>
    </div>
  );
};

const DashboardResourceHoneycomb: FunctionComponent<
  DashboardResourceHoneycombProps
> = (props: DashboardResourceHoneycombProps): ReactElement => {
  const containerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [tooltipState, setTooltipState] = useState<TooltipState | null>(null);

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
    const tileCount: number = props.tiles.length || 1;
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
  }, [containerWidth, props.tiles.length]);

  const rows: Array<Array<HoneycombTile>> = useMemo(() => {
    const result: Array<Array<HoneycombTile>> = [];
    let current: Array<HoneycombTile> = [];
    let isOffsetRow: boolean = false;
    let capacity: number = colsPerEvenRow;

    for (const tile of props.tiles) {
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
  }, [props.tiles, colsPerEvenRow]);

  const onHoverStart: (
    tile: HoneycombTile,
    rect: { left: number; top: number; width: number; height: number },
  ) => void = (
    tile: HoneycombTile,
    rect: { left: number; top: number; width: number; height: number },
  ) => {
    setTooltipState({ tile, rect });
  };

  const onHoverEnd: () => void = () => {
    setTooltipState(null);
  };

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
                paddingLeft:
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
                <span className="text-[10px] text-gray-500">{item.label}</span>
              </div>
            );
          })}
        </div>
      )}
      {tooltipState && <HoneycombTooltip state={tooltipState} />}
    </div>
  );
};

export default DashboardResourceHoneycomb;
