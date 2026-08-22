import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  MarkerType,
  Node,
  ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import API from "Common/UI/Utils/API/API";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Includes from "Common/Types/BaseDatabase/Includes";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Input from "Common/UI/Components/Input/Input";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import computeLayeredLayout, {
  LayoutPoint,
} from "../../Utils/LayeredGraphLayout";

/*
 * Entity-neighborhood graph: the searched observable in the middle, one node
 * per event class that mentioned it, and one node per co-occurring observable
 * (capped at the most frequent 30). Clicking an observable node re-centers
 * the graph on it.
 */

const X_GAP: number = 240;
const Y_GAP: number = 140;
const MAX_CO_OBSERVABLES: number = 30;
const EVENT_LIMIT: number = 200;

const OBSERVABLE_NODE_PREFIX: string = "observable:";
const CLASS_NODE_PREFIX: string = "class:";

const timeRangeOptions: Array<DropdownOption> = [
  { label: "Last 1 hour", value: 1 },
  { label: "Last 6 hours", value: 6 },
  { label: "Last 24 hours", value: 24 },
  { label: "Last 7 days", value: 168 },
];

const centerNodeStyle: React.CSSProperties = {
  background: "#4f46e5",
  color: "#ffffff",
  border: "1px solid #4338ca",
  borderRadius: 8,
  padding: 10,
  fontSize: 12,
  fontWeight: 600,
  maxWidth: 220,
};

const classNodeStyle: React.CSSProperties = {
  background: "#fff7ed",
  color: "#9a3412",
  border: "1px solid #fdba74",
  borderRadius: 8,
  padding: 8,
  fontSize: 12,
  maxWidth: 220,
};

const coObservableNodeStyle: React.CSSProperties = {
  background: "var(--ou-surface-primary, #ffffff)",
  color: "#111827",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  padding: 8,
  fontSize: 12,
  maxWidth: 220,
};

const CorrelateGraph: FunctionComponent = (): ReactElement => {
  const [inputValue, setInputValue] = useState<string>("");
  const [searchedObservable, setSearchedObservable] = useState<string>("");
  const [timeRangeInHours, setTimeRangeInHours] = useState<number>(24);
  const [events, setEvents] = useState<Array<SecurityEvent>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const flowInstance: React.MutableRefObject<ReactFlowInstance | null> =
    useRef<ReactFlowInstance | null>(null);

  const fetchEvents: (observable: string, hours: number) => Promise<void> =
    useCallback(async (observable: string, hours: number): Promise<void> => {
      if (!observable) {
        return;
      }

      setIsLoading(true);
      setError("");

      try {
        const endDate: Date = OneUptimeDate.getCurrentDate();
        const startDate: Date = OneUptimeDate.getSomeHoursAgo(hours);

        const query: Query<SecurityEvent> = {
          observables: new Includes([observable]),
          time: new InBetween<Date>(startDate, endDate),
        } as Query<SecurityEvent>;

        const listResult: ListResult<SecurityEvent> =
          await AnalyticsModelAPI.getList<SecurityEvent>({
            modelType: SecurityEvent,
            query: query,
            limit: EVENT_LIMIT,
            skip: 0,
            select: {
              className: true,
              severityName: true,
              message: true,
              principalUser: true,
              principalHost: true,
              principalIp: true,
              targetUser: true,
              targetHost: true,
              targetIp: true,
              observables: true,
              time: true,
            },
            sort: {
              time: SortOrder.Descending,
            },
            requestOptions: {},
          });

        setEvents(listResult.data);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      } finally {
        setIsLoading(false);
      }
    }, []);

  const searchObservable: (observable: string) => void = useCallback(
    (observable: string): void => {
      const trimmed: string = observable.trim();
      if (!trimmed) {
        return;
      }
      setInputValue(trimmed);
      setSearchedObservable(trimmed);
    },
    [],
  );

  useEffect(() => {
    if (searchedObservable) {
      fetchEvents(searchedObservable, timeRangeInHours).catch(
        (err: unknown) => {
          setError(API.getFriendlyMessage(err));
        },
      );
    }
  }, [searchedObservable, timeRangeInHours, fetchEvents]);

  const { nodes, edges } = useMemo((): {
    nodes: Array<Node>;
    edges: Array<Edge>;
  } => {
    if (!searchedObservable || events.length === 0) {
      return { nodes: [], edges: [] };
    }

    const centerId: string = `${OBSERVABLE_NODE_PREFIX}${searchedObservable}`;

    // Events per class, and co-occurring observables per class.
    const classCounts: Map<string, number> = new Map<string, number>();
    const coObservableCounts: Map<string, number> = new Map<string, number>();
    const classToCoObservable: Map<string, Map<string, number>> = new Map<
      string,
      Map<string, number>
    >();

    for (const event of events) {
      const className: string = event.className || "Unclassified";
      classCounts.set(className, (classCounts.get(className) || 0) + 1);

      const seenInEvent: Set<string> = new Set<string>();
      for (const observable of event.observables || []) {
        if (
          !observable ||
          observable === searchedObservable ||
          seenInEvent.has(observable)
        ) {
          continue;
        }
        seenInEvent.add(observable);
        coObservableCounts.set(
          observable,
          (coObservableCounts.get(observable) || 0) + 1,
        );
        const observableCounts: Map<string, number> =
          classToCoObservable.get(className) || new Map<string, number>();
        observableCounts.set(
          observable,
          (observableCounts.get(observable) || 0) + 1,
        );
        classToCoObservable.set(className, observableCounts);
      }
    }

    // Cap co-observables at the most frequent ones.
    const topCoObservables: Set<string> = new Set<string>(
      Array.from(coObservableCounts.entries())
        .sort((a: [string, number], b: [string, number]): number => {
          if (b[1] !== a[1]) {
            return b[1] - a[1];
          }
          return a[0].localeCompare(b[0]);
        })
        .slice(0, MAX_CO_OBSERVABLES)
        .map((entry: [string, number]) => {
          return entry[0];
        }),
    );

    const nodeIds: Array<string> = [centerId];
    const layoutEdges: Array<{ from: string; to: string }> = [];
    const builtEdges: Array<Edge> = [];

    for (const [className, count] of classCounts) {
      const classId: string = `${CLASS_NODE_PREFIX}${className}`;
      nodeIds.push(classId);
      layoutEdges.push({ from: centerId, to: classId });
      builtEdges.push({
        id: `${centerId}->${classId}`,
        source: centerId,
        target: classId,
        type: "smoothstep",
        animated: true,
        label: count.toString(),
        labelStyle: { fontSize: 10, fill: "#6b7280" },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8" },
        style: { stroke: "#94a3b8" },
      });
    }

    for (const [className, observableCounts] of classToCoObservable) {
      for (const [observable, count] of observableCounts) {
        if (!topCoObservables.has(observable)) {
          continue;
        }
        const classId: string = `${CLASS_NODE_PREFIX}${className}`;
        const coId: string = `${OBSERVABLE_NODE_PREFIX}${observable}`;
        if (!nodeIds.includes(coId)) {
          nodeIds.push(coId);
        }
        layoutEdges.push({ from: classId, to: coId });
        builtEdges.push({
          id: `${classId}->${coId}`,
          source: classId,
          target: coId,
          type: "smoothstep",
          label: count.toString(),
          labelStyle: { fontSize: 10, fill: "#6b7280" },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#cbd5e1" },
          style: { stroke: "#cbd5e1" },
        });
      }
    }

    const layout: Map<string, LayoutPoint> = computeLayeredLayout(
      nodeIds,
      layoutEdges,
      { xGap: X_GAP, yGap: Y_GAP },
    );

    const builtNodes: Array<Node> = nodeIds.map((nodeId: string): Node => {
      const point: LayoutPoint = layout.get(nodeId) || { x: 0, y: 0 };
      const isCenter: boolean = nodeId === centerId;
      const isClass: boolean = nodeId.startsWith(CLASS_NODE_PREFIX);
      const label: string = isClass
        ? `${nodeId.substring(CLASS_NODE_PREFIX.length)} (${
            classCounts.get(nodeId.substring(CLASS_NODE_PREFIX.length)) || 0
          })`
        : nodeId.substring(OBSERVABLE_NODE_PREFIX.length);

      let style: React.CSSProperties = coObservableNodeStyle;
      if (isCenter) {
        style = centerNodeStyle;
      } else if (isClass) {
        style = classNodeStyle;
      }

      return {
        id: nodeId,
        position: point,
        data: { label },
        style,
      };
    });

    return { nodes: builtNodes, edges: builtEdges };
  }, [events, searchedObservable]);

  /*
   * Re-fit when the graph changes. A new controlled `nodes` array wipes
   * React Flow's measured dimensions, and fitView no-ops (returns false)
   * until nodes re-measure — retry on animation frames until it lands.
   */
  useEffect(() => {
    let raf: number = 0;
    let attempts: number = 20;
    const tryFit: () => void = (): void => {
      const didFit: boolean = Boolean(
        flowInstance.current &&
          nodes.length > 0 &&
          flowInstance.current.fitView({ padding: 0.2 }),
      );
      if (!didFit && attempts > 0) {
        attempts--;
        raf = requestAnimationFrame(tryFit);
      }
    };
    tryFit();
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [nodes.length, searchedObservable]);

  const getGraphContent: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error) {
      return <ErrorMessage message={error} />;
    }

    if (!searchedObservable) {
      return (
        <EmptyState
          id="security-events-correlate-empty"
          icon={IconProp.Graph}
          title="Correlate an observable"
          description="Enter a hostname, user, or IP address above to see every event class that mentioned it and the observables it co-occurred with."
        />
      );
    }

    if (events.length === 0) {
      return (
        <EmptyState
          id="security-events-correlate-no-results"
          icon={IconProp.Search}
          title="No events found"
          description={`No security events mention "${searchedObservable}" in the selected time range. Try a longer range or a different observable.`}
        />
      );
    }

    return (
      <div style={{ height: "65vh", width: "100%" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView={true}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={true}
          nodesConnectable={false}
          elementsSelectable={true}
          onInit={(instance: ReactFlowInstance) => {
            flowInstance.current = instance;
          }}
          onNodeClick={(_event: React.MouseEvent, node: Node) => {
            if (node.id.startsWith(OBSERVABLE_NODE_PREFIX)) {
              searchObservable(
                node.id.substring(OBSERVABLE_NODE_PREFIX.length),
              );
            }
          }}
        >
          <Controls showInteractive={false} />
          <Background
            variant={BackgroundVariant.Dots}
            gap={16}
            size={1}
            color="var(--ou-chart-grid, #cbd5e1)"
          />
        </ReactFlow>
      </div>
    );
  };

  return (
    <Fragment>
      <div className="mb-3 flex flex-col md:flex-row md:items-end gap-3">
        <div className="md:w-80">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Observable
          </label>
          <Input
            dataTestId="security-events-correlate-observable"
            placeholder="hostname, user, or IP address"
            value={inputValue}
            onChange={(value: string) => {
              setInputValue(value);
            }}
            onEnterPress={() => {
              searchObservable(inputValue);
            }}
          />
        </div>
        <div className="md:w-48">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Time Range
          </label>
          <Dropdown
            options={timeRangeOptions}
            initialValue={
              timeRangeOptions.find((option: DropdownOption) => {
                return option.value === timeRangeInHours;
              }) || timeRangeOptions[2]
            }
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              if (typeof value === "number") {
                setTimeRangeInHours(value);
              }
            }}
          />
        </div>
        <div>
          <Button
            title="Correlate"
            buttonStyle={ButtonStyleType.PRIMARY}
            icon={IconProp.Graph}
            disabled={!inputValue.trim() || isLoading}
            onClick={() => {
              searchObservable(inputValue);
            }}
          />
        </div>
        {searchedObservable && !isLoading && !error && events.length > 0 && (
          <p className="text-xs text-gray-500 md:ml-auto">
            {events.length === EVENT_LIMIT
              ? `Showing the ${EVENT_LIMIT} most recent matching events.`
              : `${events.length} matching event${
                  events.length === 1 ? "" : "s"
                }.`}{" "}
            Click an observable node to re-center the graph on it.
          </p>
        )}
      </div>

      {getGraphContent()}
    </Fragment>
  );
};

export default CorrelateGraph;
