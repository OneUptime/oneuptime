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

export interface DiffFlamegraphProps {
  baselineStartTime: Date;
  baselineEndTime: Date;
  comparisonStartTime: Date;
  comparisonEndTime: Date;
  serviceIds?: Array<ObjectID> | undefined;
  profileType?: string | undefined;
}

interface DiffFlamegraphNode {
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
  baselineValue: number;
  comparisonValue: number;
  delta: number;
  deltaPercent: number;
  x: number;
  y: number;
}

const DiffFlamegraph: FunctionComponent<DiffFlamegraphProps> = (
  props: DiffFlamegraphProps,
): ReactElement => {
  const [rootNode, setRootNode] = useState<DiffFlamegraphNode | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [zoomStack, setZoomStack] = useState<Array<DiffFlamegraphNode>>([]);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  const loadDiffFlamegraph: () => Promise<void> = async (): Promise<void> => {
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
            profileType: props.profileType,
          },
          headers: {
            ...ModelAPI.getCommonHeaders(),
          },
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const data: DiffFlamegraphNode = response.data[
        "diffFlamegraph"
      ] as unknown as DiffFlamegraphNode;
      setRootNode(data);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadDiffFlamegraph();
  }, [
    props.baselineStartTime,
    props.baselineEndTime,
    props.comparisonStartTime,
    props.comparisonEndTime,
    props.serviceIds,
    props.profileType,
  ]);

  const activeRoot: DiffFlamegraphNode | null = useMemo(() => {
    if (zoomStack.length > 0) {
      return zoomStack[zoomStack.length - 1]!;
    }
    return rootNode;
  }, [rootNode, zoomStack]);

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
        baselineValue: node.baselineValue,
        comparisonValue: node.comparisonValue,
        delta: node.delta,
        deltaPercent: node.deltaPercent,
        x: event.clientX,
        y: event.clientY,
      });
    },
    [],
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
          void loadDiffFlamegraph();
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

  const getDeltaColor: (deltaPercent: number) => string = (
    deltaPercent: number,
  ): string => {
    if (deltaPercent > 50) {
      return "bg-red-600";
    }
    if (deltaPercent > 20) {
      return "bg-red-500";
    }
    if (deltaPercent > 5) {
      return "bg-red-400";
    }
    if (deltaPercent > 0) {
      return "bg-red-300";
    }
    if (deltaPercent < -50) {
      return "bg-green-600";
    }
    if (deltaPercent < -20) {
      return "bg-green-500";
    }
    if (deltaPercent < -5) {
      return "bg-green-400";
    }
    if (deltaPercent < 0) {
      return "bg-green-300";
    }
    return "bg-gray-400";
  };

  const renderNode: (
    node: DiffFlamegraphNode,
    _parentMax: number,
    depth: number,
    offsetFraction: number,
    widthFraction: number,
  ) => ReactElement | null = (
    node: DiffFlamegraphNode,
    _parentMax: number,
    depth: number,
    offsetFraction: number,
    widthFraction: number,
  ): ReactElement | null => {
    if (widthFraction < 0.005) {
      return null;
    }

    const bgColor: string = getDeltaColor(node.deltaPercent);
    const maxValue: number = Math.max(node.baselineValue, node.comparisonValue);

    let childOffset: number = 0;

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
          title={`${node.functionName} (${node.deltaPercent >= 0 ? "+" : ""}${node.deltaPercent.toFixed(1)}%)`}
        >
          {widthFraction > 0.03 ? node.functionName : ""}
        </div>
        {node.children.map((child: DiffFlamegraphNode) => {
          const childMax: number = Math.max(
            child.baselineValue,
            child.comparisonValue,
          );
          const childWidth: number =
            maxValue > 0 ? (childMax / maxValue) * widthFraction : 0;
          const currentOffset: number = offsetFraction + childOffset;
          childOffset += childWidth;

          return renderNode(
            child,
            maxValue,
            depth + 1,
            currentOffset,
            childWidth,
          );
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
          <span>Got slower</span>
        </span>
        <span className="flex items-center space-x-1">
          <span className="inline-block w-3 h-3 rounded bg-green-500" />
          <span>Got faster</span>
        </span>
        <span className="flex items-center space-x-1">
          <span className="inline-block w-3 h-3 rounded bg-gray-400" />
          <span>No change</span>
        </span>
      </div>

      <div
        className="relative w-full overflow-x-auto border border-gray-200 rounded bg-white"
        style={{ height: `${height}px` }}
      >
        {renderNode(
          activeRoot,
          Math.max(activeRoot.baselineValue, activeRoot.comparisonValue),
          0,
          0,
          1,
        )}
      </div>

      {tooltip && (
        <div
          className="fixed z-50 bg-gray-900 text-white text-xs rounded px-3 py-2 pointer-events-none shadow-lg"
          style={{
            left: `${tooltip.x + 12}px`,
            top: `${tooltip.y + 12}px`,
          }}
        >
          <div className="font-semibold">{tooltip.name}</div>
          {tooltip.fileName && (
            <div className="text-gray-300">{tooltip.fileName}</div>
          )}
          <div className="mt-1">
            Before:{" "}
            {ProfileUtil.formatProfileValue(tooltip.baselineValue, "nanoseconds")}
          </div>
          <div>
            After:{" "}
            {ProfileUtil.formatProfileValue(
              tooltip.comparisonValue,
              "nanoseconds",
            )}
          </div>
          <div
            className={
              tooltip.delta > 0
                ? "text-red-300"
                : tooltip.delta < 0
                  ? "text-green-300"
                  : ""
            }
          >
            Change: {tooltip.delta > 0 ? "+" : ""}
            {tooltip.delta.toLocaleString()} (
            {tooltip.deltaPercent >= 0 ? "+" : ""}
            {tooltip.deltaPercent.toFixed(1)}%)
          </div>
        </div>
      )}
    </div>
  );
};

export default DiffFlamegraph;
