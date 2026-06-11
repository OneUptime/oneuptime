import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ProfileUtil from "../../Utils/ProfileUtil";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

export interface DiffFlamegraphProps {
  baselineStartTime: Date;
  baselineEndTime: Date;
  comparisonStartTime: Date;
  comparisonEndTime: Date;
  serviceIds?: Array<ObjectID> | undefined;
  profileType?: string | undefined;
  /**
   * Invoked after each successful load with the merged diff tree (the
   * same line-agnostic merge this graph renders — analysing the raw
   * server tree would split logical frames whose line numbers moved
   * between deploys), or null when the window pair had no data. Lets
   * parents derive views like a most-regressed-functions table
   * without a second fetch of the same data.
   */
  onDataLoaded?: ((root: DiffFlamegraphNode | null) => void) | undefined;
}

export interface DiffFlamegraphNode {
  functionName: string;
  fileName: string;
  lineNumber: number;
  baselineValue: number;
  comparisonValue: number;
  delta: number;
  deltaPercent: number;
  selfBaselineValue: number;
  selfComparisonValue: number;
  selfDelta: number;
  children: DiffFlamegraphNode[];
  frameType: string;
}

interface TooltipData {
  name: string;
  fileName: string;
  lineNumber: number;
  baselineValue: number;
  comparisonValue: number;
  delta: number;
  baselineShare: number;
  comparisonShare: number;
  x: number;
  y: number;
}

/*
 * Share-of-total changes below this many percentage points are treated
 * as sampling noise and rendered neutral — without a floor the graph
 * lights up red/green everywhere and real regressions drown.
 */
const NOISE_FLOOR_PERCENTAGE_POINTS: number = 1;

/**
 * Merge sibling frames that share function + file, summing their
 * values and recursing into their combined children.
 *
 * The server's diff tree matches frames on function + file + line, but
 * source lines shift on every recompile/deploy — exactly the event
 * this comparison exists to analyse — which would split one logical
 * frame into a disjoint "removed" and "added" pair. The line number is
 * kept on the merged node for display only.
 */
function remergeChildren(
  children: Array<DiffFlamegraphNode>,
): Array<DiffFlamegraphNode> {
  const byKey: Map<string, Array<DiffFlamegraphNode>> = new Map();

  for (const child of children) {
    const key: string = `${child.functionName}@${child.fileName}`;
    const bucket: Array<DiffFlamegraphNode> | undefined = byKey.get(key);
    if (bucket) {
      bucket.push(child);
    } else {
      byKey.set(key, [child]);
    }
  }

  const result: Array<DiffFlamegraphNode> = [];

  for (const bucket of byKey.values()) {
    const first: DiffFlamegraphNode = bucket[0]!;

    let baselineValue: number = 0;
    let comparisonValue: number = 0;
    let selfBaselineValue: number = 0;
    let selfComparisonValue: number = 0;
    let lineNumber: number = 0;
    const combinedChildren: Array<DiffFlamegraphNode> = [];

    for (const node of bucket) {
      baselineValue += node.baselineValue;
      comparisonValue += node.comparisonValue;
      selfBaselineValue += node.selfBaselineValue;
      selfComparisonValue += node.selfComparisonValue;
      if (!lineNumber && node.lineNumber) {
        lineNumber = node.lineNumber;
      }
      combinedChildren.push(...node.children);
    }

    const delta: number = comparisonValue - baselineValue;
    const deltaPercent: number =
      baselineValue > 0
        ? (delta / baselineValue) * 100
        : comparisonValue > 0
          ? 100
          : 0;

    result.push({
      functionName: first.functionName,
      fileName: first.fileName,
      lineNumber,
      baselineValue,
      comparisonValue,
      delta,
      deltaPercent,
      selfBaselineValue,
      selfComparisonValue,
      selfDelta: selfComparisonValue - selfBaselineValue,
      frameType: first.frameType,
      children: remergeChildren(combinedChildren),
    });
  }

  result.sort((a: DiffFlamegraphNode, b: DiffFlamegraphNode) => {
    return b.comparisonValue - a.comparisonValue;
  });

  return result;
}

function remergeDiffTree(root: DiffFlamegraphNode): DiffFlamegraphNode {
  return {
    ...root,
    children: remergeChildren(root.children),
  };
}

const DiffFlamegraph: FunctionComponent<DiffFlamegraphProps> = (
  props: DiffFlamegraphProps,
): ReactElement => {
  const [rootNode, setRootNode] = useState<DiffFlamegraphNode | null>(null);
  const [isTruncated, setIsTruncated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [zoomStack, setZoomStack] = useState<Array<DiffFlamegraphNode>>([]);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  /*
   * The selector pill stores either a category (e.g. "cpu") or a raw
   * type — expand it to the raw type strings agents actually emit so
   * the server filters with IN (...) instead of a literal equality
   * that would miss rows.
   */
  const queryProfileTypes: Array<string> | undefined =
    ProfileUtil.getQueryProfileTypes(props.profileType);

  /*
   * Values are not always nanoseconds — memory profiles are bytes,
   * goroutine profiles are counts. Derive the unit from what is being
   * queried so the tooltip doesn't mislabel a 4 GB allocation as time.
   */
  const unit: string =
    queryProfileTypes && queryProfileTypes.length > 0
      ? ProfileUtil.getProfileTypeUnit(queryProfileTypes[0]!)
      : "nanoseconds";

  const loadDiffFlamegraph: (
    isCancelled: () => boolean,
  ) => Promise<void> = async (isCancelled: () => boolean): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/telemetry/profiles/diff-flamegraph",
          ),
          data: {
            baselineStartTime: props.baselineStartTime.toISOString(),
            baselineEndTime: props.baselineEndTime.toISOString(),
            comparisonStartTime: props.comparisonStartTime.toISOString(),
            comparisonEndTime: props.comparisonEndTime.toISOString(),
            serviceIds: props.serviceIds?.map((id: ObjectID) => {
              return id.toString();
            }),
            profileTypes: queryProfileTypes,
          },
          headers: {
            ...ModelAPI.getCommonHeaders(),
          },
        });

      if (isCancelled()) {
        return;
      }

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const data: DiffFlamegraphNode = response.data[
        "diffFlamegraph"
      ] as unknown as DiffFlamegraphNode;
      setRootNode(data);
      setIsTruncated(Boolean(response.data["truncated"]));

      /*
       * Hand consumers the merged tree (not the raw one) so anything
       * they derive agrees frame-for-frame with what this graph
       * paints. Null signals "nothing to analyse" — either no tree at
       * all, or a tree with zero weight on both sides (which this
       * graph renders as its empty state).
       */
      if (props.onDataLoaded) {
        const hasData: boolean = Boolean(
          data && (data.baselineValue > 0 || data.comparisonValue > 0),
        );
        props.onDataLoaded(hasData ? remergeDiffTree(data) : null);
      }
    } catch (err) {
      if (!isCancelled()) {
        setError(API.getFriendlyMessage(err));
      }
    } finally {
      if (!isCancelled()) {
        setIsLoading(false);
      }
    }
  };

  /*
   * Date/array props are compared by value (epoch millis / joined ids)
   * so a parent re-render with fresh-but-equal object identities doesn't
   * refire the fetch; the cancelled flag keeps a slow stale response
   * from overwriting a newer one.
   */
  useEffect(() => {
    let cancelled: boolean = false;
    void loadDiffFlamegraph(() => {
      return cancelled;
    });
    return () => {
      cancelled = true;
    };
  }, [
    props.baselineStartTime.getTime(),
    props.baselineEndTime.getTime(),
    props.comparisonStartTime.getTime(),
    props.comparisonEndTime.getTime(),
    props.serviceIds
      ? props.serviceIds
          .map((id: ObjectID) => {
            return id.toString();
          })
          .join(",")
      : "all",
    props.profileType,
  ]);

  const mergedRoot: DiffFlamegraphNode | null = useMemo(() => {
    return rootNode ? remergeDiffTree(rootNode) : null;
  }, [rootNode]);

  /*
   * A reload produces a new tree — any zoom path into the old one is
   * stale and would show data that no longer exists.
   */
  useEffect(() => {
    setZoomStack([]);
    setTooltip(null);
  }, [mergedRoot]);

  const activeRoot: DiffFlamegraphNode | null = useMemo(() => {
    if (zoomStack.length > 0) {
      return zoomStack[zoomStack.length - 1]!;
    }
    return mergedRoot;
  }, [mergedRoot, zoomStack]);

  /*
   * Color and percentages are normalised per Pyroscope: each frame's
   * share of its own tree's total, so a window where the service
   * simply did 2x more work doesn't paint every frame red. Totals come
   * from the full tree (not the zoomed subtree) so colors are stable
   * while zooming.
   */
  const rootBaselineTotal: number = mergedRoot?.baselineValue || 0;
  const rootComparisonTotal: number = mergedRoot?.comparisonValue || 0;

  const getShareDelta: (node: DiffFlamegraphNode) => number = useCallback(
    (node: DiffFlamegraphNode): number => {
      const baselineShare: number =
        rootBaselineTotal > 0
          ? (node.baselineValue / rootBaselineTotal) * 100
          : 0;
      const comparisonShare: number =
        rootComparisonTotal > 0
          ? (node.comparisonValue / rootComparisonTotal) * 100
          : 0;
      return comparisonShare - baselineShare;
    },
    [rootBaselineTotal, rootComparisonTotal],
  );

  const handleClickNode: (node: DiffFlamegraphNode) => void = useCallback(
    (node: DiffFlamegraphNode): void => {
      if (node.children.length > 0) {
        setZoomStack((prev: Array<DiffFlamegraphNode>) => {
          return [...prev, node];
        });
      }
    },
    [],
  );

  const handleZoomOut: () => void = useCallback((): void => {
    setZoomStack((prev: Array<DiffFlamegraphNode>) => {
      return prev.slice(0, prev.length - 1);
    });
  }, []);

  const handleResetZoom: () => void = useCallback((): void => {
    setZoomStack([]);
  }, []);

  const handleMouseEnter: (
    node: DiffFlamegraphNode,
    event: React.MouseEvent,
  ) => void = useCallback(
    (node: DiffFlamegraphNode, event: React.MouseEvent): void => {
      setTooltip({
        name: node.functionName,
        fileName: node.fileName,
        lineNumber: node.lineNumber,
        baselineValue: node.baselineValue,
        comparisonValue: node.comparisonValue,
        delta: node.delta,
        baselineShare:
          rootBaselineTotal > 0
            ? (node.baselineValue / rootBaselineTotal) * 100
            : 0,
        comparisonShare:
          rootComparisonTotal > 0
            ? (node.comparisonValue / rootComparisonTotal) * 100
            : 0,
        x: event.clientX,
        y: event.clientY,
      });
    },
    [rootBaselineTotal, rootComparisonTotal],
  );

  const handleMouseLeave: () => void = useCallback((): void => {
    setTooltip(null);
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          void loadDiffFlamegraph(() => {
            return false;
          });
        }}
      />
    );
  }

  if (
    !activeRoot ||
    (activeRoot.baselineValue === 0 && activeRoot.comparisonValue === 0)
  ) {
    return (
      <div className="p-8 text-center text-gray-500">
        No performance data found in the selected time ranges. Try adjusting the
        time periods.
      </div>
    );
  }

  const getDeltaColor: (node: DiffFlamegraphNode) => string = (
    node: DiffFlamegraphNode,
  ): string => {
    const shareDelta: number = getShareDelta(node);

    if (Math.abs(shareDelta) < NOISE_FLOOR_PERCENTAGE_POINTS) {
      return "bg-gray-400";
    }

    /*
     * A frame with no baseline at all is usually new code (or a
     * renamed symbol), not a measured regression — cap it below the
     * strongest intensity so genuine 10x regressions still stand out.
     */
    const isNewFrame: boolean =
      node.baselineValue === 0 && node.comparisonValue > 0;

    if (shareDelta > 0) {
      if (shareDelta > 10) {
        return isNewFrame ? "bg-red-500" : "bg-red-600";
      }
      if (shareDelta > 5) {
        return "bg-red-500";
      }
      if (shareDelta > 2.5) {
        return "bg-red-400";
      }
      return "bg-red-300";
    }

    if (shareDelta < -10) {
      return "bg-green-600";
    }
    if (shareDelta < -5) {
      return "bg-green-500";
    }
    if (shareDelta < -2.5) {
      return "bg-green-400";
    }
    return "bg-green-300";
  };

  const renderNode: (
    node: DiffFlamegraphNode,
    depth: number,
    offsetFraction: number,
    widthFraction: number,
  ) => ReactElement | null = (
    node: DiffFlamegraphNode,
    depth: number,
    offsetFraction: number,
    widthFraction: number,
  ): ReactElement | null => {
    if (widthFraction < 0.005) {
      return null;
    }

    const bgColor: string = getDeltaColor(node);
    const maxValue: number = Math.max(node.baselineValue, node.comparisonValue);

    /*
     * Each frame's width is max(baseline, comparison), and the sum of
     * children's maxima can exceed the parent's own maximum (one child
     * grew while a sibling shrank). Scale by whichever is larger so
     * children always fit inside the parent's box.
     */
    const childMaxSum: number = node.children.reduce(
      (sum: number, child: DiffFlamegraphNode) => {
        return sum + Math.max(child.baselineValue, child.comparisonValue);
      },
      0,
    );
    const childDenominator: number = Math.max(maxValue, childMaxSum);

    let childOffset: number = 0;

    const shareDelta: number = getShareDelta(node);

    return (
      <React.Fragment key={`${node.functionName}-${depth}-${offsetFraction}`}>
        <div
          className={`absolute h-6 border border-white/30 cursor-pointer overflow-hidden text-xs text-white leading-6 px-1 truncate ${bgColor} hover:opacity-80`}
          style={{
            left: `${offsetFraction * 100}%`,
            width: `${widthFraction * 100}%`,
            top: `${depth * 26}px`,
          }}
          onClick={() => {
            handleClickNode(node);
          }}
          onMouseEnter={(e: React.MouseEvent) => {
            handleMouseEnter(node, e);
          }}
          onMouseLeave={handleMouseLeave}
          title={`${node.functionName} (${shareDelta >= 0 ? "+" : ""}${shareDelta.toFixed(1)}% of total)`}
        >
          {widthFraction > 0.03 ? node.functionName : ""}
        </div>
        {node.children.map((child: DiffFlamegraphNode) => {
          const childMax: number = Math.max(
            child.baselineValue,
            child.comparisonValue,
          );
          const childWidth: number =
            childDenominator > 0
              ? (childMax / childDenominator) * widthFraction
              : 0;
          const currentOffset: number = offsetFraction + childOffset;
          childOffset += childWidth;

          return renderNode(child, depth + 1, currentOffset, childWidth);
        })}
      </React.Fragment>
    );
  };

  const getMaxDepth: (node: DiffFlamegraphNode, depth: number) => number = (
    node: DiffFlamegraphNode,
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
  const height: number = (maxDepth + 1) * 26 + 10;

  const tooltipShareDelta: number | null = tooltip
    ? tooltip.comparisonShare - tooltip.baselineShare
    : null;

  return (
    <div className="w-full">
      {zoomStack.length > 0 && (
        <div className="mb-3 flex items-center space-x-2">
          <button
            className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded border border-gray-300"
            onClick={handleZoomOut}
          >
            Zoom Out
          </button>
          <button
            className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded border border-gray-300"
            onClick={handleResetZoom}
          >
            Reset Zoom
          </button>
          <span className="text-sm text-gray-500">
            Zoomed into: {activeRoot.functionName}
          </span>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center space-x-4 text-xs text-gray-600">
        <span className="font-medium">What the colors mean:</span>
        <span className="flex items-center space-x-1">
          <span className="inline-block w-3 h-3 rounded bg-red-500" />
          <span>Bigger share of total (worse)</span>
        </span>
        <span className="flex items-center space-x-1">
          <span className="inline-block w-3 h-3 rounded bg-green-500" />
          <span>Smaller share of total (better)</span>
        </span>
        <span className="flex items-center space-x-1">
          <span className="inline-block w-3 h-3 rounded bg-gray-400" />
          <span>No meaningful change</span>
        </span>
      </div>

      {isTruncated && (
        <div className="mb-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <Icon
            icon={IconProp.Alert}
            className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-amber-500"
          />
          <span>
            Data is truncated to the largest stacks — the sample limit was hit.
            Percentages are of the sampled subset, not the full comparison
            windows.
          </span>
        </div>
      )}

      <div
        className="relative w-full overflow-x-auto border border-gray-200 rounded bg-white"
        style={{ height: `${height}px` }}
      >
        {renderNode(activeRoot, 0, 0, 1)}
      </div>

      {tooltip && tooltipShareDelta !== null && (
        <div
          className="fixed z-50 bg-gray-900 text-white text-xs rounded px-3 py-2 pointer-events-none shadow-lg"
          style={{
            left: `${tooltip.x + 12}px`,
            top: `${tooltip.y + 12}px`,
          }}
        >
          <div className="font-semibold">{tooltip.name}</div>
          {tooltip.fileName && (
            <div className="text-gray-300">
              {tooltip.fileName}
              {tooltip.lineNumber > 0 ? `:${tooltip.lineNumber}` : ""}
            </div>
          )}
          <div className="mt-1">
            Before:{" "}
            {ProfileUtil.formatProfileValue(tooltip.baselineValue, unit)} (
            {tooltip.baselineShare.toFixed(1)}% of total)
          </div>
          <div>
            After:{" "}
            {ProfileUtil.formatProfileValue(tooltip.comparisonValue, unit)} (
            {tooltip.comparisonShare.toFixed(1)}% of total)
          </div>
          <div
            className={
              Math.abs(tooltipShareDelta) < NOISE_FLOOR_PERCENTAGE_POINTS
                ? "text-gray-300"
                : tooltipShareDelta > 0
                  ? "text-red-300"
                  : "text-green-300"
            }
          >
            Change: {tooltip.delta >= 0 ? "+" : "-"}
            {ProfileUtil.formatProfileValue(
              Math.abs(tooltip.delta),
              unit,
            )} · {tooltipShareDelta >= 0 ? "+" : ""}
            {tooltipShareDelta.toFixed(1)}% of total
          </div>
        </div>
      )}
    </div>
  );
};

export default DiffFlamegraph;
