import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import ProfileSample from "Common/Models/AnalyticsModels/ProfileSample";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ProfileUtil, { ParsedStackFrame } from "../../Utils/ProfileUtil";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";

export interface ProfileFlamegraphProps {
  profileId: string;
  profileType?: string | undefined;
}

interface FlamegraphNode {
  name: string;
  fileName: string;
  lineNumber: number;
  frameType: string;
  selfValue: number;
  totalValue: number;
  children: Map<string, FlamegraphNode>;
}

interface TooltipData {
  name: string;
  fileName: string;
  selfValue: number;
  totalValue: number;
  x: number;
  y: number;
}

const ProfileFlamegraph: FunctionComponent<ProfileFlamegraphProps> = (
  props: ProfileFlamegraphProps,
): ReactElement => {
  const [samples, setSamples] = useState<Array<ProfileSample>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [zoomStack, setZoomStack] = useState<Array<FlamegraphNode>>([]);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  const loadSamples: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");

      const result: ListResult<ProfileSample> =
        await AnalyticsModelAPI.getList({
          modelType: ProfileSample,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            profileId: props.profileId,
            ...(props.profileType ? { profileType: props.profileType } : {}),
          },
          select: {
            stacktrace: true,
            frameTypes: true,
            value: true,
            profileType: true,
          },
          limit: 10000,
          skip: 0,
          sort: {
            value: SortOrder.Descending,
          },
        });

      setSamples(result.data || []);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadSamples();
  }, [props.profileId, props.profileType]);

  const rootNode: FlamegraphNode = useMemo(() => {
    const root: FlamegraphNode = {
      name: "root",
      fileName: "",
      lineNumber: 0,
      frameType: "",
      selfValue: 0,
      totalValue: 0,
      children: new Map<string, FlamegraphNode>(),
    };

    for (const sample of samples) {
      const stacktrace: Array<string> = sample.stacktrace || [];
      const frameTypes: Array<string> = sample.frameTypes || [];
      const value: number = sample.value || 0;

      let currentNode: FlamegraphNode = root;
      root.totalValue += value;

      // Walk from root to leaf (stacktrace is ordered root-to-leaf)
      for (let i: number = 0; i < stacktrace.length; i++) {
        const frame: string = stacktrace[i]!;
        const frameType: string =
          i < frameTypes.length ? frameTypes[i]! : "unknown";

        let child: FlamegraphNode | undefined =
          currentNode.children.get(frame);

        if (!child) {
          const parsed: ParsedStackFrame = ProfileUtil.parseStackFrame(frame);
          child = {
            name: parsed.functionName,
            fileName: parsed.fileName,
            lineNumber: parsed.lineNumber,
            frameType,
            selfValue: 0,
            totalValue: 0,
            children: new Map<string, FlamegraphNode>(),
          };
          currentNode.children.set(frame, child);
        }

        child.totalValue += value;

        // Last frame in the stack is the leaf -- add self value
        if (i === stacktrace.length - 1) {
          child.selfValue += value;
        }

        currentNode = child;
      }
    }

    return root;
  }, [samples]);

  const activeRoot: FlamegraphNode = useMemo(() => {
    if (zoomStack.length > 0) {
      return zoomStack[zoomStack.length - 1]!;
    }
    return rootNode;
  }, [rootNode, zoomStack]);

  const handleClickNode: (node: FlamegraphNode) => void = useCallback(
    (node: FlamegraphNode): void => {
      if (node.children.size > 0) {
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

  const handleMouseEnter: (
    node: FlamegraphNode,
    event: React.MouseEvent,
  ) => void = useCallback(
    (node: FlamegraphNode, event: React.MouseEvent): void => {
      setTooltip({
        name: node.name,
        fileName: node.fileName,
        selfValue: node.selfValue,
        totalValue: node.totalValue,
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
          void loadSamples();
        }}
      />
    );
  }

  if (samples.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        No profile samples found for this profile.
      </div>
    );
  }

  const renderNode: (
    node: FlamegraphNode,
    parentTotal: number,
    depth: number,
    offsetFraction: number,
    widthFraction: number,
  ) => ReactElement | null = (
    node: FlamegraphNode,
    parentTotal: number,
    depth: number,
    offsetFraction: number,
    widthFraction: number,
  ): ReactElement | null => {
    if (widthFraction < 0.005) {
      return null;
    }

    const bgColor: string = ProfileUtil.getFrameTypeColor(node.frameType);
    const percentage: number =
      parentTotal > 0 ? (node.totalValue / parentTotal) * 100 : 0;

    const children: Array<FlamegraphNode> = Array.from(
      node.children.values(),
    ).sort((a: FlamegraphNode, b: FlamegraphNode) => {
      return b.totalValue - a.totalValue;
    });

    let childOffset: number = 0;

    return (
      <React.Fragment key={`${node.name}-${depth}-${offsetFraction}`}>
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
          title={`${node.name} (${percentage.toFixed(1)}%)`}
        >
          {widthFraction > 0.03 ? node.name : ""}
        </div>
        {children.map((child: FlamegraphNode) => {
          const childWidth: number =
            node.totalValue > 0
              ? (child.totalValue / node.totalValue) * widthFraction
              : 0;
          const currentOffset: number = offsetFraction + childOffset;
          childOffset += childWidth;

          return renderNode(
            child,
            node.totalValue,
            depth + 1,
            currentOffset,
            childWidth,
          );
        })}
      </React.Fragment>
    );
  };

  const getMaxDepth: (node: FlamegraphNode, depth: number) => number = (
    node: FlamegraphNode,
    depth: number,
  ): number => {
    let max: number = depth;
    for (const child of node.children.values()) {
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
            Zoomed into: {activeRoot.name}
          </span>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center space-x-4 text-xs text-gray-600">
        <span className="font-medium">Frame Types:</span>
        {[
          "kernel",
          "native",
          "jvm",
          "cpython",
          "go",
          "v8js",
          "unknown",
        ].map((type: string) => {
          return (
            <span key={type} className="flex items-center space-x-1">
              <span
                className={`inline-block w-3 h-3 rounded ${ProfileUtil.getFrameTypeColor(type)}`}
              />
              <span>{type}</span>
            </span>
          );
        })}
      </div>

      <div
        className="relative w-full overflow-x-auto border border-gray-200 rounded bg-white"
        style={{ height: `${height}px` }}
      >
        {renderNode(activeRoot, activeRoot.totalValue, 0, 0, 1)}
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
            Self: {tooltip.selfValue.toLocaleString()}
          </div>
          <div>Total: {tooltip.totalValue.toLocaleString()}</div>
        </div>
      )}
    </div>
  );
};

export default ProfileFlamegraph;
