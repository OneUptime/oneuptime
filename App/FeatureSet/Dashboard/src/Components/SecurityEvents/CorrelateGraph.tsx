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
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import IconProp from "Common/Types/Icon/IconProp";
import Input from "Common/UI/Components/Input/Input";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import computeLayeredLayout, {
  LayoutPoint,
} from "../../Utils/LayeredGraphLayout";
import {
  CompiledCorrelationQueries,
  CorrelationCondition,
  CorrelationConnector,
  CorrelationFieldKey,
  CorrelationFilter,
  CorrelationOperator,
  compileCorrelationFilter,
  describeCorrelationCondition,
  getEqualityObservables,
  parseCorrelationFilter,
  serializeCorrelationFilter,
} from "../../Utils/SecurityEventCorrelation";
import {
  CLASS_NODE_PREFIX,
  CorrelationGraphData,
  CorrelationGraphNode,
  OBSERVABLE_NODE_PREFIX,
  buildCorrelationGraph,
  dedupeSecurityEvents,
} from "../../Utils/CorrelationGraph";
import CorrelateFilterBuilder, {
  getDefaultCorrelationCondition,
} from "./CorrelateFilterBuilder";
import CorrelateFilterChips from "./CorrelateFilterChips";
import SecurityEventSeverityPill from "./SecurityEventSeverityPill";
import SecurityEventDetail from "./SecurityEventDetail";

/*
 * Entity-neighborhood graph over security events: the applied filter in the
 * middle, one node per event class that matched it, one node per
 * co-occurring observable (capped at the most frequent 30).
 *
 * The filter is either the quick single-observable search (the original
 * UX, kept as a shorthand) or a chain of field/operator/value conditions
 * with one AND/OR connector. AND compiles to a single server query; OR runs
 * one query per condition and unions the results by event id (the analytics
 * query API has no cross-column OR). Filter + time range live in the URL
 * (`q`, `hours` — plus `observable` as a simple deep-link param other pages
 * use), so a correlation is shareable and pivots survive reloads.
 *
 * Clicking a class node opens the matching events below the graph (each row
 * opens the full event detail); clicking an observable node offers pivot
 * actions (focus / add condition / exclude).
 */

const X_GAP: number = 240;
const Y_GAP: number = 140;
const EVENT_LIMIT: number = 200;
const DRILL_DOWN_ROW_LIMIT: number = 50;

const timeRangeOptions: Array<DropdownOption> = [
  { label: "Last 1 hour", value: 1 },
  { label: "Last 6 hours", value: 6 },
  { label: "Last 24 hours", value: 24 },
  { label: "Last 7 days", value: 168 },
  { label: "Last 30 days", value: 720 },
];

const eventSelect: Select<SecurityEvent> = {
  _id: true,
  time: true,
  eventUid: true,
  categoryName: true,
  className: true,
  activityName: true,
  severityName: true,
  statusName: true,
  message: true,
  vendorName: true,
  productName: true,
  ruleId: true,
  ruleName: true,
  mitreTactics: true,
  mitreTechniques: true,
  principalUser: true,
  principalHost: true,
  principalIp: true,
  principalProcess: true,
  targetUser: true,
  targetHost: true,
  targetIp: true,
  targetPort: true,
  targetResource: true,
  observables: true,
  attributes: true,
} as Select<SecurityEvent>;

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

const coObservableNodeStyle: React.CSSProperties = {
  background: "var(--ou-surface-primary, #ffffff)",
  color: "#111827",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  padding: 8,
  fontSize: 12,
  maxWidth: 220,
};

const baseClassNodeStyle: React.CSSProperties = {
  borderRadius: 8,
  padding: 8,
  fontSize: 12,
  maxWidth: 220,
};

/*
 * Class nodes are tinted by the worst severity among their events so the
 * dangerous classes stand out before anyone reads a single count.
 */
function classNodeStyle(
  worstSeverity: OcsfSeverity | undefined,
): React.CSSProperties {
  switch (worstSeverity) {
    case OcsfSeverity.Fatal:
    case OcsfSeverity.Critical:
      return {
        ...baseClassNodeStyle,
        background: "#fef2f2",
        color: "#7f1d1d",
        border: "1px solid #f87171",
      };
    case OcsfSeverity.High:
      return {
        ...baseClassNodeStyle,
        background: "#fff7ed",
        color: "#9a3412",
        border: "1px solid #fdba74",
      };
    case OcsfSeverity.Medium:
      return {
        ...baseClassNodeStyle,
        background: "#fefce8",
        color: "#854d0e",
        border: "1px solid #fde047",
      };
    case OcsfSeverity.Low:
      return {
        ...baseClassNodeStyle,
        background: "#eff6ff",
        color: "#1e40af",
        border: "1px solid #93c5fd",
      };
    default:
      return {
        ...baseClassNodeStyle,
        background: "#f9fafb",
        color: "#374151",
        border: "1px solid #cbd5e1",
      };
  }
}

function singleObservableFilter(observable: string): CorrelationFilter {
  return {
    conditions: [
      {
        field: CorrelationFieldKey.Observable,
        operator: CorrelationOperator.Equals,
        value: observable,
      },
    ],
    connector: "and",
  };
}

/*
 * The quick input mirrors the applied filter only when the filter is
 * exactly one "Observable is X" condition — anything richer belongs to the
 * builder.
 */
function quickValueForFilter(filter: CorrelationFilter | null): string {
  if (
    filter &&
    filter.conditions.length === 1 &&
    filter.conditions[0]!.field === CorrelationFieldKey.Observable &&
    filter.conditions[0]!.operator === CorrelationOperator.Equals
  ) {
    return filter.conditions[0]!.value;
  }
  return "";
}

const CorrelateGraph: FunctionComponent = (): ReactElement => {
  const [quickValue, setQuickValue] = useState<string>("");
  const [draftConditions, setDraftConditions] = useState<
    Array<CorrelationCondition>
  >([]);
  const [draftConnector, setDraftConnector] =
    useState<CorrelationConnector>("and");
  const [isBuilderOpen, setIsBuilderOpen] = useState<boolean>(false);
  const [appliedFilter, setAppliedFilter] = useState<CorrelationFilter | null>(
    null,
  );
  const [timeRangeInHours, setTimeRangeInHours] = useState<number>(24);
  const [events, setEvents] = useState<Array<SecurityEvent>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [isTruncated, setIsTruncated] = useState<boolean>(false);
  const [selectedObservable, setSelectedObservable] = useState<string>("");
  const [drillDownClassName, setDrillDownClassName] = useState<string>("");
  const [detailEvent, setDetailEvent] = useState<SecurityEvent | null>(null);

  const flowInstance: React.MutableRefObject<ReactFlowInstance | null> =
    useRef<ReactFlowInstance | null>(null);
  const fetchRequestId: React.MutableRefObject<number> = useRef<number>(0);

  const syncUrl: (filter: CorrelationFilter | null, hours: number) => void =
    useCallback((filter: CorrelationFilter | null, hours: number): void => {
      Navigation.setQueryString({
        q: filter ? serializeCorrelationFilter(filter) : null,
        hours: filter ? String(hours) : null,
        observable: null,
      });
    }, []);

  const applyFilter: (filter: CorrelationFilter | null) => void = useCallback(
    (filter: CorrelationFilter | null): void => {
      setAppliedFilter(filter);
      setQuickValue(quickValueForFilter(filter));
      setDraftConditions(filter ? [...filter.conditions] : []);
      setDraftConnector(filter ? filter.connector : "and");
      setSelectedObservable("");
      setDrillDownClassName("");
      setDetailEvent(null);
      syncUrl(filter, timeRangeInHours);
    },
    [syncUrl, timeRangeInHours],
  );

  // Seed from the URL — deep links from the events table and shared views.
  useEffect(() => {
    const rawHours: string | null = Navigation.getQueryStringByName("hours");
    let initialHours: number = 24;
    if (rawHours) {
      const parsedHours: number = parseInt(rawHours, 10);
      if (
        timeRangeOptions.some((option: DropdownOption) => {
          return option.value === parsedHours;
        })
      ) {
        initialHours = parsedHours;
        setTimeRangeInHours(parsedHours);
      }
    }

    const parsedFilter: CorrelationFilter | null = parseCorrelationFilter(
      Navigation.getQueryStringByName("q"),
    );
    const rawObservable: string | null =
      Navigation.getQueryStringByName("observable");

    const initialFilter: CorrelationFilter | null =
      parsedFilter ||
      (rawObservable && rawObservable.trim()
        ? singleObservableFilter(rawObservable.trim())
        : null);

    if (initialFilter) {
      setAppliedFilter(initialFilter);
      setQuickValue(quickValueForFilter(initialFilter));
      setDraftConditions([...initialFilter.conditions]);
      setDraftConnector(initialFilter.connector);
      if (initialFilter.conditions.length > 1) {
        setIsBuilderOpen(true);
      }
      syncUrl(initialFilter, initialHours);
    }
    // Mount-only: the URL is an input here, not a subscription.
  }, []);

  useEffect(() => {
    if (!appliedFilter) {
      setEvents([]);
      setError("");
      setIsTruncated(false);
      return;
    }

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!projectId) {
      return;
    }

    const endDate: Date = OneUptimeDate.getCurrentDate();
    const startDate: Date = OneUptimeDate.getSomeHoursAgo(timeRangeInHours);

    const compiled: CompiledCorrelationQueries = compileCorrelationFilter(
      appliedFilter,
      {
        projectId: projectId,
        startDate: startDate,
        endDate: endDate,
      },
    );

    if (compiled.error) {
      setError(compiled.error);
      setEvents([]);
      setIsTruncated(false);
      return;
    }

    if (compiled.queries.length === 0) {
      setEvents([]);
      setError("");
      setIsTruncated(false);
      return;
    }

    const requestId: number = ++fetchRequestId.current;
    setIsLoading(true);
    setError("");

    const fetchAll: () => Promise<void> = async (): Promise<void> => {
      try {
        const listResults: Array<ListResult<SecurityEvent>> = await Promise.all(
          compiled.queries.map(
            (
              query: Query<SecurityEvent>,
            ): Promise<ListResult<SecurityEvent>> => {
              return AnalyticsModelAPI.getList<SecurityEvent>({
                modelType: SecurityEvent,
                query: query,
                limit: EVENT_LIMIT,
                skip: 0,
                select: eventSelect,
                sort: {
                  time: SortOrder.Descending,
                },
                requestOptions: {},
              });
            },
          ),
        );

        if (requestId !== fetchRequestId.current) {
          return; // A newer correlation superseded this one.
        }

        setEvents(
          dedupeSecurityEvents(
            listResults.map((listResult: ListResult<SecurityEvent>) => {
              return listResult.data;
            }),
          ),
        );
        setIsTruncated(
          listResults.some((listResult: ListResult<SecurityEvent>) => {
            return listResult.data.length >= EVENT_LIMIT;
          }),
        );
      } catch (err) {
        if (requestId === fetchRequestId.current) {
          setError(API.getFriendlyMessage(err));
        }
      } finally {
        if (requestId === fetchRequestId.current) {
          setIsLoading(false);
        }
      }
    };

    fetchAll().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    });
  }, [appliedFilter, timeRangeInHours]);

  const graphData: CorrelationGraphData = useMemo((): CorrelationGraphData => {
    if (!appliedFilter || events.length === 0) {
      return { nodes: [], edges: [], droppedCoObservableCount: 0 };
    }

    const centerLabel: string =
      appliedFilter.conditions.length === 1
        ? describeCorrelationCondition(appliedFilter.conditions[0]!)
        : `${appliedFilter.conditions.length} conditions (${
            appliedFilter.connector === "or" ? "ANY" : "ALL"
          })`;

    return buildCorrelationGraph({
      events: events,
      centerLabel: centerLabel,
      excludedObservables: getEqualityObservables(appliedFilter),
    });
  }, [events, appliedFilter]);

  const { nodes, edges } = useMemo((): {
    nodes: Array<Node>;
    edges: Array<Edge>;
  } => {
    if (graphData.nodes.length === 0) {
      return { nodes: [], edges: [] };
    }

    const layout: Map<string, LayoutPoint> = computeLayeredLayout(
      graphData.nodes.map((node: CorrelationGraphNode) => {
        return node.id;
      }),
      graphData.edges.map((edge: { from: string; to: string }) => {
        return { from: edge.from, to: edge.to };
      }),
      { xGap: X_GAP, yGap: Y_GAP },
    );

    const builtNodes: Array<Node> = graphData.nodes.map(
      (node: CorrelationGraphNode): Node => {
        const point: LayoutPoint = layout.get(node.id) || { x: 0, y: 0 };

        let style: React.CSSProperties = coObservableNodeStyle;
        let label: string = node.label;
        if (node.kind === "center") {
          style = centerNodeStyle;
        } else if (node.kind === "class") {
          style = classNodeStyle(node.worstSeverity);
          label = `${node.label} (${node.count || 0})`;
        }

        return {
          id: node.id,
          position: point,
          data: { label },
          style,
        };
      },
    );

    const builtEdges: Array<Edge> = graphData.edges.map(
      (edge: { id: string; from: string; to: string; count: number }): Edge => {
        const isCenterEdge: boolean = edge.from === "center";
        return {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          type: "smoothstep",
          animated: isCenterEdge,
          label: edge.count.toString(),
          labelStyle: { fontSize: 10, fill: "#6b7280" },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isCenterEdge ? "#94a3b8" : "#cbd5e1",
          },
          style: { stroke: isCenterEdge ? "#94a3b8" : "#cbd5e1" },
        };
      },
    );

    return { nodes: builtNodes, edges: builtEdges };
  }, [graphData]);

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
  }, [nodes.length, appliedFilter]);

  const appendCondition: (condition: CorrelationCondition) => void =
    useCallback(
      (condition: CorrelationCondition): void => {
        if (!appliedFilter) {
          applyFilter({ conditions: [condition], connector: "and" });
          return;
        }
        applyFilter({
          conditions: [...appliedFilter.conditions, condition],
          connector: appliedFilter.connector,
        });
      },
      [appliedFilter, applyFilter],
    );

  const drillDownEvents: Array<SecurityEvent> =
    useMemo((): Array<SecurityEvent> => {
      if (!drillDownClassName) {
        return [];
      }
      return events.filter((event: SecurityEvent) => {
        return (event.className || "Unclassified") === drillDownClassName;
      });
    }, [events, drillDownClassName]);

  /*
   * Excluding in OR mode would just add a near-match-everything branch —
   * "is not X" only narrows when it ANDs with the rest of the filter.
   */
  const canExclude: boolean =
    !appliedFilter ||
    appliedFilter.connector === "and" ||
    appliedFilter.conditions.length === 0;

  const getObservableActionBar: () => ReactElement = (): ReactElement => {
    if (!selectedObservable) {
      return <Fragment />;
    }

    return (
      <div
        data-testid="correlate-observable-actions"
        className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2"
      >
        <span className="text-xs text-gray-600">
          Selected observable:{" "}
          <span className="font-mono font-medium text-gray-900">
            {selectedObservable}
          </span>
        </span>
        <Button
          dataTestId="correlate-action-focus"
          title="Focus"
          tooltip="Start a new correlation on this observable"
          buttonStyle={ButtonStyleType.OUTLINE}
          buttonSize={ButtonSize.Small}
          icon={IconProp.Graph}
          onClick={() => {
            applyFilter(singleObservableFilter(selectedObservable));
          }}
        />
        <Button
          dataTestId="correlate-action-add"
          title={
            appliedFilter && appliedFilter.connector === "or"
              ? "Add OR condition"
              : "Add AND condition"
          }
          tooltip="Narrow or widen the current correlation with this observable"
          buttonStyle={ButtonStyleType.OUTLINE}
          buttonSize={ButtonSize.Small}
          icon={IconProp.Add}
          onClick={() => {
            appendCondition({
              field: CorrelationFieldKey.Observable,
              operator: CorrelationOperator.Equals,
              value: selectedObservable,
            });
          }}
        />
        {canExclude && (
          <Button
            dataTestId="correlate-action-exclude"
            title="Exclude"
            tooltip="Hide events that mention this observable"
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            icon={IconProp.Minus}
            onClick={() => {
              appendCondition({
                field: CorrelationFieldKey.Observable,
                operator: CorrelationOperator.NotEquals,
                value: selectedObservable,
              });
            }}
          />
        )}
        <Button
          dataTestId="correlate-action-dismiss"
          title="Dismiss"
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
          buttonSize={ButtonSize.Small}
          onClick={() => {
            setSelectedObservable("");
          }}
        />
      </div>
    );
  };

  const getDrillDownPanel: () => ReactElement = (): ReactElement => {
    if (!drillDownClassName) {
      return <Fragment />;
    }

    const visibleEvents: Array<SecurityEvent> = drillDownEvents.slice(
      0,
      DRILL_DOWN_ROW_LIMIT,
    );

    return (
      <div
        data-testid="correlate-drilldown"
        className="mt-3 rounded-lg border border-gray-200 bg-white"
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
          <p className="text-sm font-medium text-gray-900">
            {drillDownClassName}{" "}
            <span className="text-gray-500 font-normal">
              — {drillDownEvents.length} matching event
              {drillDownEvents.length === 1 ? "" : "s"}
            </span>
          </p>
          <div className="flex items-center gap-2">
            {(!appliedFilter || appliedFilter.connector === "and") && (
              <Button
                dataTestId="correlate-drilldown-filter-class"
                title="Filter to this class"
                buttonStyle={ButtonStyleType.OUTLINE}
                buttonSize={ButtonSize.Small}
                icon={IconProp.Filter}
                onClick={() => {
                  appendCondition({
                    field: CorrelationFieldKey.EventClass,
                    operator: CorrelationOperator.Equals,
                    value: drillDownClassName,
                  });
                }}
              />
            )}
            <Button
              dataTestId="correlate-drilldown-close"
              title="Close"
              buttonStyle={ButtonStyleType.SECONDARY_LINK}
              buttonSize={ButtonSize.Small}
              onClick={() => {
                setDrillDownClassName("");
              }}
            />
          </div>
        </div>
        <ul className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
          {visibleEvents.map(
            (event: SecurityEvent, index: number): ReactElement => {
              return (
                <li key={index}>
                  <button
                    type="button"
                    data-testid={`correlate-drilldown-event-${index}`}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-gray-50"
                    onClick={() => {
                      setDetailEvent(event);
                    }}
                  >
                    <span className="w-24 shrink-0 text-xs text-gray-500">
                      {event.time
                        ? OneUptimeDate.fromNow(new Date(event.time))
                        : "-"}
                    </span>
                    <SecurityEventSeverityPill
                      severityName={event.severityName}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
                      {event.message || "-"}
                    </span>
                    <span className="hidden md:block w-40 shrink-0 truncate text-xs text-gray-500">
                      {event.principalUser || event.principalHost || ""}
                    </span>
                  </button>
                </li>
              );
            },
          )}
        </ul>
        {drillDownEvents.length > DRILL_DOWN_ROW_LIMIT && (
          <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
            Showing the {DRILL_DOWN_ROW_LIMIT} most recent — narrow the filter
            or time range to see the rest.
          </p>
        )}
      </div>
    );
  };

  const getGraphContent: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error) {
      return <ErrorMessage message={error} />;
    }

    if (!appliedFilter) {
      return (
        <EmptyState
          id="security-events-correlate-empty"
          icon={IconProp.Graph}
          title="Correlate security events"
          description="Enter a hostname, user, or IP address above — or build a multi-condition filter (host AND ip, user OR user) with Add filters — to see every event class that matched and the observables they co-occurred with."
        />
      );
    }

    if (events.length === 0) {
      return (
        <EmptyState
          id="security-events-correlate-no-results"
          icon={IconProp.Search}
          title="No events found"
          description="No security events match this filter in the selected time range. Try a longer range or fewer conditions."
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
              setSelectedObservable(
                node.id.substring(OBSERVABLE_NODE_PREFIX.length),
              );
              return;
            }
            if (node.id.startsWith(CLASS_NODE_PREFIX)) {
              setDrillDownClassName(
                node.id.substring(CLASS_NODE_PREFIX.length),
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

  const hasDraftToApply: boolean = isBuilderOpen
    ? draftConditions.length > 0
    : Boolean(quickValue.trim());

  return (
    <Fragment>
      <div className="mb-3 flex flex-col md:flex-row md:items-end gap-3">
        {!isBuilderOpen && (
          <div className="md:w-80">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Observable
            </label>
            <Input
              dataTestId="security-events-correlate-observable"
              placeholder="hostname, user, or IP address"
              value={quickValue}
              onChange={(value: string) => {
                setQuickValue(value);
              }}
              onEnterPress={() => {
                if (quickValue.trim()) {
                  applyFilter(singleObservableFilter(quickValue.trim()));
                }
              }}
            />
          </div>
        )}
        <div className="md:w-48">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Time Range
          </label>
          <Dropdown
            options={timeRangeOptions}
            value={
              timeRangeOptions.find((option: DropdownOption) => {
                return option.value === timeRangeInHours;
              }) || timeRangeOptions[2]
            }
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              if (typeof value === "number") {
                setTimeRangeInHours(value);
                if (appliedFilter) {
                  syncUrl(appliedFilter, value);
                }
              }
            }}
          />
        </div>
        <div className="flex items-end gap-2">
          <Button
            title="Correlate"
            dataTestId="security-events-correlate-button"
            buttonStyle={ButtonStyleType.PRIMARY}
            icon={IconProp.Graph}
            disabled={!hasDraftToApply || isLoading}
            onClick={() => {
              if (isBuilderOpen) {
                applyFilter({
                  conditions: draftConditions,
                  connector: draftConnector,
                });
                return;
              }
              if (quickValue.trim()) {
                applyFilter(singleObservableFilter(quickValue.trim()));
              }
            }}
          />
          <Button
            title={isBuilderOpen ? "Simple search" : "Add filters"}
            dataTestId="security-events-correlate-toggle-builder"
            buttonStyle={ButtonStyleType.OUTLINE}
            icon={IconProp.Filter}
            onClick={() => {
              if (isBuilderOpen) {
                setIsBuilderOpen(false);
                setQuickValue(quickValueForFilter(appliedFilter));
                return;
              }
              // Seed the builder from what is already on screen.
              if (draftConditions.length === 0) {
                if (quickValue.trim()) {
                  setDraftConditions(
                    singleObservableFilter(quickValue.trim()).conditions,
                  );
                } else {
                  setDraftConditions([getDefaultCorrelationCondition()]);
                }
              }
              setIsBuilderOpen(true);
            }}
          />
        </div>
        {appliedFilter && !isLoading && !error && events.length > 0 && (
          <p className="text-xs text-gray-500 md:ml-auto">
            {events.length} matching event{events.length === 1 ? "" : "s"}.
            {isTruncated
              ? ` At least one search hit the ${EVENT_LIMIT}-event cap — treat counts as lower bounds.`
              : ""}{" "}
            Click a class node to inspect its events, or an observable node to
            pivot.
          </p>
        )}
      </div>

      {isBuilderOpen && (
        <div className="mb-3">
          <CorrelateFilterBuilder
            conditions={draftConditions}
            connector={draftConnector}
            onChange={(
              conditions: Array<CorrelationCondition>,
              connector: CorrelationConnector,
            ) => {
              setDraftConditions(conditions);
              setDraftConnector(connector);
            }}
          />
        </div>
      )}

      {appliedFilter && (
        <div className="mb-3">
          <CorrelateFilterChips
            filter={appliedFilter}
            onRemoveCondition={(index: number) => {
              const remaining: Array<CorrelationCondition> =
                appliedFilter.conditions.filter(
                  (
                    _condition: CorrelationCondition,
                    conditionIndex: number,
                  ) => {
                    return conditionIndex !== index;
                  },
                );
              applyFilter(
                remaining.length > 0
                  ? {
                      conditions: remaining,
                      connector: appliedFilter.connector,
                    }
                  : null,
              );
            }}
            onClearAll={() => {
              applyFilter(null);
            }}
          />
        </div>
      )}

      {getObservableActionBar()}

      {getGraphContent()}

      {getDrillDownPanel()}

      {detailEvent && (
        <SecurityEventDetail
          securityEvent={detailEvent}
          onClose={() => {
            setDetailEvent(null);
          }}
          onCorrelateObservable={(observable: string) => {
            setDetailEvent(null);
            setDrillDownClassName("");
            applyFilter(singleObservableFilter(observable));
          }}
        />
      )}
    </Fragment>
  );
};

export default CorrelateGraph;
