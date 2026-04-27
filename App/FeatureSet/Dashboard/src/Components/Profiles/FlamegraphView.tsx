import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import ProfileUtil, { ModuleCategory } from "../../Utils/ProfileUtil";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

/**
 * Normalised flame graph node. Both the single-profile loader (which
 * builds a tree from raw ProfileSample records) and the aggregated
 * loader (which gets a pre-built tree from the server) produce this
 * shape before handing off to {@link FlamegraphView} for rendering.
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
}

interface TooltipData {
  node: FlamegraphNode;
  x: number;
  y: number;
}

const FRAME_HEIGHT: number = 22;

/**
 * Pure rendering component for a flame graph. Handles zoom, search,
 * "only my code", tooltip, and keyboard shortcuts. Does not fetch data.
 */
const FlamegraphView: FunctionComponent<FlamegraphViewProps> = (
  props: FlamegraphViewProps,
): ReactElement => {
  const [zoomStack, setZoomStack] = useState<Array<FlamegraphNode>>([]);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [search, setSearch] = useState<string>("");
  const [onlyOwnCode, setOnlyOwnCode] = useState<boolean>(false);

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
      const target: HTMLElement | null = e.target as HTMLElement | null;
      const inInput: boolean =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (e.key === "/" && !inInput) {
        e.preventDefault();
        const el: HTMLElement | null =
          document.getElementById("flamegraph-search");
        el?.focus();
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

  const renderNode: (
    node: FlamegraphNode,
    depth: number,
    offsetFraction: number,
    widthFraction: number,
  ) => ReactElement | null = (
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
            setTooltip({ node, x: e.clientX, y: e.clientY });
          }}
          onMouseMove={(e: React.MouseEvent) => {
            setTooltip((t: TooltipData | null) => {
              return t ? { ...t, x: e.clientX, y: e.clientY } : t;
            });
          }}
          onMouseLeave={() => {
            setTooltip(null);
          }}
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
  };

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
    <div className="w-full">
      {!props.compact && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Icon
                icon={IconProp.Search}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400"
              />
              <input
                id="flamegraph-search"
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

      <div
        className="relative w-full overflow-x-auto border border-gray-200 rounded-lg bg-gradient-to-b from-gray-50/50 to-white"
        style={{ height: `${height}px` }}
      >
        {renderNode(activeRoot, 0, 0, 1)}
      </div>

      {tooltip && (
        <Tooltip
          node={tooltip.node}
          rootTotal={activeRoot.totalValue}
          unit={props.unit}
          x={tooltip.x}
          y={tooltip.y}
        />
      )}
    </div>
  );
};

interface TooltipProps {
  node: FlamegraphNode;
  rootTotal: number;
  unit: string;
  x: number;
  y: number;
}

const Tooltip: FunctionComponent<TooltipProps> = (
  props: TooltipProps,
): ReactElement => {
  const totalPct: number =
    props.rootTotal > 0 ? (props.node.totalValue / props.rootTotal) * 100 : 0;
  const selfPct: number =
    props.rootTotal > 0 ? (props.node.selfValue / props.rootTotal) * 100 : 0;

  const tipWidth: number = 340;
  const tipHeight: number = 140;
  const left: number =
    props.x + tipWidth + 20 > window.innerWidth
      ? props.x - tipWidth - 12
      : props.x + 12;
  const top: number =
    props.y + tipHeight + 20 > window.innerHeight
      ? props.y - tipHeight - 12
      : props.y + 12;

  return (
    <div
      className="fixed z-50 bg-gray-900 text-white text-xs rounded-md px-3 py-2.5 pointer-events-none shadow-xl ring-1 ring-black/20"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${tipWidth}px`,
      }}
    >
      <div className="font-semibold text-sm break-all">{props.node.name}</div>
      {props.node.fileName && (
        <div className="text-gray-300 mt-0.5 break-all text-[11px]">
          {ProfileUtil.formatFileName(props.node.fileName, 64)}
          {props.node.lineNumber > 0 ? `:${props.node.lineNumber}` : ""}
        </div>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <div className="text-gray-400 text-[10px] uppercase tracking-wider">
            Self
          </div>
          <div className="font-mono">
            {ProfileUtil.formatProfileValue(props.node.selfValue, props.unit)}
          </div>
          <div className="text-gray-400 text-[10px]">
            {ProfileUtil.formatPercent(selfPct)} of window
          </div>
        </div>
        <div>
          <div className="text-gray-400 text-[10px] uppercase tracking-wider">
            Total (with callees)
          </div>
          <div className="font-mono">
            {ProfileUtil.formatProfileValue(props.node.totalValue, props.unit)}
          </div>
          <div className="text-gray-400 text-[10px]">
            {ProfileUtil.formatPercent(totalPct)} of window
          </div>
        </div>
      </div>
      <div className="mt-2 text-[10px] text-gray-400">
        {ProfileUtil.getModuleCategoryLabel(props.node.category)}
        {props.node.children.length > 0 ? " · click to zoom in" : ""}
      </div>
    </div>
  );
};

export default FlamegraphView;
