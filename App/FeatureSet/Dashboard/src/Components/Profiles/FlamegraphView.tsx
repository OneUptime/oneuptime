import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ProfileUtil, { ModuleCategory } from "../../Utils/ProfileUtil";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

/**
 * Normalised flame graph node. Both the single-profile loader and the
 * aggregated loader get a pre-built tree from the server and produce
 * this shape before handing off to {@link FlamegraphView} for
 * rendering.
 */
export interface FlamegraphNode {
  name: string;
  fileName: string;
  lineNumber: number;
  frameType: string;
  category: ModuleCategory;
  selfValue: number;
  totalValue: number;
  children: Array<FlamegraphNode>;
}

/**
 * Wire shape returned by /telemetry/profiles/flamegraph. Matches
 * `ProfileFlamegraphNode` on the server. Shared here because every
 * loader that talks to that endpoint needs to convert it to a
 * {@link FlamegraphNode} before rendering.
 */
export interface ServerFlamegraphNode {
  functionName: string;
  fileName: string;
  lineNumber: number;
  selfValue: number;
  totalValue: number;
  children: Array<ServerFlamegraphNode>;
  frameType: string;
}

/**
 * Recursively convert the server's wire shape to the client's
 * FlamegraphNode, inferring the module category from the filename
 * (so color-by-module works identically across every flame graph
 * surface).
 */
export function normaliseServerFlamegraphNode(
  node: ServerFlamegraphNode | null,
): FlamegraphNode {
  if (!node) {
    return {
      name: "(all)",
      fileName: "",
      lineNumber: 0,
      frameType: "",
      category: "unknown",
      selfValue: 0,
      totalValue: 0,
      children: [],
    };
  }
  return {
    name: node.functionName || "(root)",
    fileName: node.fileName || "",
    lineNumber: node.lineNumber || 0,
    frameType: node.frameType || "",
    category: ProfileUtil.getModuleCategory(node.fileName || ""),
    selfValue: Number(node.selfValue || 0),
    totalValue: Number(node.totalValue || 0),
    children: (node.children || []).map(normaliseServerFlamegraphNode),
  };
}

export interface FlamegraphViewProps {
  root: FlamegraphNode;
  unit: string;
  /**
   * Show a compact variant (no legend, no toolbar). Used when the flame
   * graph is embedded inside a larger card — e.g. the home page summary.
   */
  compact?: boolean | undefined;
  /**
   * Height override (pixels). By default we size to the max depth.
   */
  maxHeight?: number | undefined;
  /**
   * True when the server hit its sample limit while building the tree.
   * The graph then only covers the largest stacks, so percentages are
   * of the sampled subset — the banner tells the user that.
   */
  truncated?: boolean | undefined;
}

const FRAME_HEIGHT: number = 22;

/*
 * Tooltip box dimensions used for edge-of-viewport flipping. The
 * tooltip is positioned imperatively (no React state on mousemove), so
 * these have to be known up front rather than measured per render.
 */
const TOOLTIP_WIDTH: number = 340;
const TOOLTIP_HEIGHT: number = 140;

/**
 * Pure rendering component for a flame graph. Handles zoom, search,
 * "only my code", tooltip, and keyboard shortcuts. Does not fetch data.
 */
const FlamegraphView: FunctionComponent<FlamegraphViewProps> = (
  props: FlamegraphViewProps,
): ReactElement => {
  const [zoomStack, setZoomStack] = useState<Array<FlamegraphNode>>([]);
  const [hoveredNode, setHoveredNode] = useState<FlamegraphNode | null>(null);
  const [search, setSearch] = useState<string>("");
  const [onlyOwnCode, setOnlyOwnCode] = useState<boolean>(false);

  /*
   * Several flame graphs can be on screen at once (e.g. dashboard
   * cards), so the search input id must be unique per instance —
   * otherwise the "/" hotkey would focus a different instance's input.
   */
  const searchInputId: string = useId();

  const containerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const searchInputRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);
  const tooltipRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

  /*
   * Mouse position and hover state live in refs so mousemove never
   * triggers a React render — re-rendering the whole frame tree on
   * every pixel of pointer travel makes large graphs unusable.
   */
  const mousePositionRef: React.MutableRefObject<{ x: number; y: number }> =
    useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isPointerInsideRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  /*
   * A reload (refresh, time-range change) produces a new root object.
   * Any zoom path into the old tree is stale — keeping it would show a
   * frozen view of data that no longer exists.
   */
  useEffect(() => {
    setZoomStack([]);
    setHoveredNode(null);
  }, [props.root]);

  const activeRoot: FlamegraphNode =
    zoomStack.length > 0 ? zoomStack[zoomStack.length - 1]! : props.root;

  /*
   * Find the hottest self value across the whole tree so we can scale
   * color intensity proportionally.
   */
  const maxSelfValue: number = useMemo(() => {
    let max: number = 0;
    const walk: (n: FlamegraphNode) => void = (n: FlamegraphNode): void => {
      if (n.selfValue > max) {
        max = n.selfValue;
      }
      for (const c of n.children) {
        walk(c);
      }
    };
    walk(props.root);
    return max;
  }, [props.root]);

  const searchMatchedValue: number = useMemo(() => {
    if (!search.trim()) {
      return 0;
    }
    const q: string = search.toLowerCase();
    let matched: number = 0;
    const walk: (n: FlamegraphNode) => void = (n: FlamegraphNode): void => {
      if (
        n.name.toLowerCase().includes(q) ||
        n.fileName.toLowerCase().includes(q)
      ) {
        matched += n.selfValue;
      }
      for (const c of n.children) {
        walk(c);
      }
    };
    walk(activeRoot);
    return matched;
  }, [search, activeRoot]);

  useEffect(() => {
    const handler: (e: KeyboardEvent) => void = (e: KeyboardEvent): void => {
      /*
       * Multiple instances may be mounted at once and they all listen
       * on window — only react when this instance is the one the user
       * is interacting with (pointer over it, or focus inside it).
       */
      const hasFocusWithin: boolean = Boolean(
        containerRef.current &&
          document.activeElement &&
          containerRef.current.contains(document.activeElement),
      );
      if (!isPointerInsideRef.current && !hasFocusWithin) {
        return;
      }

      const target: HTMLElement | null = e.target as HTMLElement | null;
      const inInput: boolean =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (e.key === "/" && !inInput) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }

      if (e.key === "Escape") {
        if (zoomStack.length > 0) {
          setZoomStack([]);
        } else if (search) {
          setSearch("");
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [zoomStack, search]);

  /*
   * Position the tooltip box next to the cursor by writing styles
   * directly — bypassing React state means mousemove costs one style
   * write instead of a full tree re-render.
   */
  const positionTooltip: () => void = useCallback((): void => {
    const el: HTMLDivElement | null = tooltipRef.current;
    if (!el) {
      return;
    }
    const x: number = mousePositionRef.current.x;
    const y: number = mousePositionRef.current.y;
    const left: number =
      x + TOOLTIP_WIDTH + 20 > window.innerWidth
        ? x - TOOLTIP_WIDTH - 12
        : x + 12;
    const top: number =
      y + TOOLTIP_HEIGHT + 20 > window.innerHeight
        ? y - TOOLTIP_HEIGHT - 12
        : y + 12;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, []);

  /*
   * The tooltip element only exists after the hover render commits, so
   * the first positioning has to happen here (before paint) rather
   * than in the mouseenter handler.
   */
  useLayoutEffect(() => {
    positionTooltip();
  }, [hoveredNode, positionTooltip]);

  const handleClickNode: (node: FlamegraphNode) => void = useCallback(
    (node: FlamegraphNode): void => {
      if (node.children.length > 0) {
        setZoomStack((prev: Array<FlamegraphNode>) => {
          return [...prev, node];
        });
      }
    },
    [],
  );

  const handleZoomOut: () => void = useCallback((): void => {
    setZoomStack((prev: Array<FlamegraphNode>) => {
      return prev.slice(0, prev.length - 1);
    });
  }, []);

  const handleResetZoom: () => void = useCallback((): void => {
    setZoomStack([]);
  }, []);

  const handleFrameMouseEnter: (
    node: FlamegraphNode,
    e: React.MouseEvent,
  ) => void = useCallback((node: FlamegraphNode, e: React.MouseEvent): void => {
    mousePositionRef.current = { x: e.clientX, y: e.clientY };
    setHoveredNode(node);
  }, []);

  const handleFrameMouseMove: (e: React.MouseEvent) => void = useCallback(
    (e: React.MouseEvent): void => {
      mousePositionRef.current = { x: e.clientX, y: e.clientY };
      positionTooltip();
    },
    [positionTooltip],
  );

  const handleFrameMouseLeave: () => void = useCallback((): void => {
    setHoveredNode(null);
  }, []);

  const renderNode: (
    node: FlamegraphNode,
    depth: number,
    offsetFraction: number,
    widthFraction: number,
  ) => ReactElement | null = useCallback(
    (
      node: FlamegraphNode,
      depth: number,
      offsetFraction: number,
      widthFraction: number,
    ): ReactElement | null => {
      if (widthFraction < 0.002) {
        return null;
      }

      const isOwn: boolean = node.category === "own";
      const q: string = search.trim().toLowerCase();
      const dimmed: boolean =
        (onlyOwnCode && !isOwn && depth > 0) ||
        (q.length > 0 &&
          !node.name.toLowerCase().includes(q) &&
          !node.fileName.toLowerCase().includes(q));

      const intensity: number =
        maxSelfValue > 0 ? Math.max(0.35, node.selfValue / maxSelfValue) : 0.5;

      const style: { bg: string; text: string; border: string } =
        ProfileUtil.getModuleFrameStyle(node.category, intensity);

      const children: Array<FlamegraphNode> = [...node.children].sort(
        (a: FlamegraphNode, b: FlamegraphNode) => {
          return b.totalValue - a.totalValue;
        },
      );

      let childOffset: number = 0;
      const showLabel: boolean = widthFraction > 0.025;

      return (
        <React.Fragment key={`${node.name}-${depth}-${offsetFraction}`}>
          <div
            className={`absolute border ${style.border} ${style.bg} ${style.text} ${
              dimmed ? "opacity-25" : "opacity-100"
            } cursor-pointer overflow-hidden text-[11px] font-medium leading-[22px] px-1.5 truncate hover:brightness-110 transition-[opacity] duration-100`}
            style={{
              left: `${offsetFraction * 100}%`,
              width: `${widthFraction * 100}%`,
              top: `${depth * FRAME_HEIGHT}px`,
              height: `${FRAME_HEIGHT - 1}px`,
            }}
            onClick={() => {
              handleClickNode(node);
            }}
            onMouseEnter={(e: React.MouseEvent) => {
              handleFrameMouseEnter(node, e);
            }}
            onMouseMove={handleFrameMouseMove}
            onMouseLeave={handleFrameMouseLeave}
          >
            {showLabel ? node.name : ""}
          </div>
          {children.map((child: FlamegraphNode) => {
            const childWidth: number =
              node.totalValue > 0
                ? (child.totalValue / node.totalValue) * widthFraction
                : 0;
            const currentOffset: number = offsetFraction + childOffset;
            childOffset += childWidth;
            return renderNode(child, depth + 1, currentOffset, childWidth);
          })}
        </React.Fragment>
      );
    },
    [
      search,
      onlyOwnCode,
      maxSelfValue,
      handleClickNode,
      handleFrameMouseEnter,
      handleFrameMouseMove,
      handleFrameMouseLeave,
    ],
  );

  /*
   * The tree is memoised so hover-driven renders (which only swap the
   * tooltip) reuse the same element — React bails out of reconciling
   * thousands of frame divs when the element identity is unchanged.
   */
  const treeElements: ReactElement | null = useMemo(() => {
    return renderNode(activeRoot, 0, 0, 1);
  }, [renderNode, activeRoot]);

  const getMaxDepth: (node: FlamegraphNode, depth: number) => number = (
    node: FlamegraphNode,
    depth: number,
  ): number => {
    let max: number = depth;
    for (const child of node.children) {
      const childDepth: number = getMaxDepth(child, depth + 1);
      if (childDepth > max) {
        max = childDepth;
      }
    }
    return max;
  };

  const maxDepth: number = getMaxDepth(activeRoot, 0);
  let height: number = Math.max(4, maxDepth + 1) * FRAME_HEIGHT + 8;
  if (props.maxHeight && height > props.maxHeight) {
    height = props.maxHeight;
  }

  const totalFormatted: string = ProfileUtil.formatProfileValue(
    activeRoot.totalValue,
    props.unit,
  );
  const searchPct: number =
    activeRoot.totalValue > 0
      ? (searchMatchedValue / activeRoot.totalValue) * 100
      : 0;

  const hoveredSelfPct: number =
    hoveredNode && activeRoot.totalValue > 0
      ? (hoveredNode.selfValue / activeRoot.totalValue) * 100
      : 0;
  const hoveredTotalPct: number =
    hoveredNode && activeRoot.totalValue > 0
      ? (hoveredNode.totalValue / activeRoot.totalValue) * 100
      : 0;

  if (!props.root || props.root.totalValue === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
          <Icon icon={IconProp.ChartBar} className="h-5 w-5 text-gray-400" />
        </div>
        <p className="text-sm font-medium text-gray-900 mb-1">No data yet</p>
        <p className="text-xs text-gray-500 max-w-sm mx-auto">
          No samples were captured in this window. Try expanding the time range,
          or check that your profiler agent is running.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full"
      onMouseEnter={() => {
        isPointerInsideRef.current = true;
      }}
      onMouseLeave={() => {
        isPointerInsideRef.current = false;
      }}
    >
      {!props.compact && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Icon
                icon={IconProp.Search}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400"
              />
              <input
                id={searchInputId}
                ref={searchInputRef}
                type="text"
                placeholder="Search functions or files…   ( / )"
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                value={search}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setSearch(e.target.value);
                }}
              />
            </div>

            <label className="inline-flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer px-2.5 py-1.5 rounded-md border border-gray-300 hover:bg-gray-50 select-none">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                checked={onlyOwnCode}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setOnlyOwnCode(e.target.checked);
                }}
              />
              Only my code
            </label>

            {zoomStack.length > 0 && (
              <>
                <button
                  className="px-2.5 py-1.5 text-xs font-medium bg-white hover:bg-gray-50 text-gray-700 rounded-md border border-gray-300"
                  onClick={handleZoomOut}
                >
                  ← Back
                </button>
                <button
                  className="px-2.5 py-1.5 text-xs font-medium bg-white hover:bg-gray-50 text-gray-700 rounded-md border border-gray-300"
                  onClick={handleResetZoom}
                >
                  Reset zoom
                </button>
              </>
            )}

            <div className="ml-auto text-xs text-gray-500">
              <span className="font-medium text-gray-700">Total: </span>
              {totalFormatted}
              {search.trim() && (
                <span className="ml-3">
                  <span className="font-medium text-gray-700">Matched: </span>
                  {ProfileUtil.formatPercent(searchPct)}
                </span>
              )}
            </div>
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] text-gray-600">
            <span className="font-medium text-gray-700">Legend:</span>
            {(
              [
                { key: "own" as ModuleCategory, label: "Your code" },
                { key: "vendor" as ModuleCategory, label: "Dependencies" },
                { key: "runtime" as ModuleCategory, label: "Runtime" },
                { key: "native" as ModuleCategory, label: "Native / kernel" },
              ] as Array<{ key: ModuleCategory; label: string }>
            ).map((item: { key: ModuleCategory; label: string }) => {
              const s: { bg: string } = ProfileUtil.getModuleFrameStyle(
                item.key,
                0.8,
              );
              return (
                <span key={item.key} className="flex items-center gap-1.5">
                  <span className={`inline-block w-3 h-3 rounded-sm ${s.bg}`} />
                  <span>{item.label}</span>
                </span>
              );
            })}
            <span className="ml-auto text-gray-400">
              Click a frame to zoom · Esc to reset
            </span>
          </div>

          {zoomStack.length > 0 && (
            <div className="mb-2 text-xs text-gray-500 flex items-center gap-1.5">
              <Icon icon={IconProp.Filter} className="h-3 w-3" />
              Zoomed into{" "}
              <span className="font-mono text-gray-800">{activeRoot.name}</span>
            </div>
          )}
        </>
      )}

      {props.truncated && (
        <div className="mb-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <Icon
            icon={IconProp.Alert}
            className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-amber-500"
          />
          <span>
            Data is truncated to the largest stacks — the sample limit was hit.
            Percentages are of the sampled subset, not the full window.
          </span>
        </div>
      )}

      <div
        className="relative w-full overflow-x-auto border border-gray-200 rounded-lg bg-gradient-to-b from-gray-50/50 to-white"
        style={{ height: `${height}px` }}
      >
        {treeElements}
      </div>

      {hoveredNode && (
        <div
          ref={tooltipRef}
          className="fixed z-50 bg-gray-900 text-white text-xs rounded-md px-3 py-2.5 pointer-events-none shadow-xl ring-1 ring-black/20"
          style={{ width: `${TOOLTIP_WIDTH}px` }}
        >
          <div className="font-semibold text-sm break-all">
            {hoveredNode.name}
          </div>
          {hoveredNode.fileName && (
            <div className="text-gray-300 mt-0.5 break-all text-[11px]">
              {ProfileUtil.formatFileName(hoveredNode.fileName, 64)}
              {hoveredNode.lineNumber > 0 ? `:${hoveredNode.lineNumber}` : ""}
            </div>
          )}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <div className="text-gray-400 text-[10px] uppercase tracking-wider">
                self
              </div>
              <div className="font-mono">
                {ProfileUtil.formatProfileValue(
                  hoveredNode.selfValue,
                  props.unit,
                )}
              </div>
              <div className="text-gray-400 text-[10px]">
                {ProfileUtil.formatPercent(hoveredSelfPct)} of visible
              </div>
            </div>
            <div>
              <div className="text-gray-400 text-[10px] uppercase tracking-wider">
                total
              </div>
              <div className="font-mono">
                {ProfileUtil.formatProfileValue(
                  hoveredNode.totalValue,
                  props.unit,
                )}
              </div>
              <div className="text-gray-400 text-[10px]">
                {ProfileUtil.formatPercent(hoveredTotalPct)} of visible
              </div>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-gray-400">
            {ProfileUtil.getModuleCategoryLabel(hoveredNode.category)}
            {hoveredNode.children.length > 0 ? " · click to zoom in" : ""}
          </div>
        </div>
      )}
    </div>
  );
};

export default FlamegraphView;
