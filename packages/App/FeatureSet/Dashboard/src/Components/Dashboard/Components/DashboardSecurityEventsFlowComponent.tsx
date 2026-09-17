import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ResponsiveContainer,
  Sankey,
  SankeyNodeProps,
  Tooltip,
} from "recharts";
import DashboardSecurityEventsFlowComponent from "Common/Types/Dashboard/DashboardComponents/DashboardSecurityEventsFlowComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import DashboardResourceList from "../Utils/DashboardResourceList";
import API from "Common/UI/Utils/API/API";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import JSONFunctions from "Common/Types/JSONFunctions";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import {
  SecurityEventFlowRecord,
  SecurityEventsFlowData,
  buildSecurityEventsFlow,
  getSecurityEventSeverityColor,
  resolveSecurityEventsFlowMaxEvents,
} from "./SecurityEventsWidgetData";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardSecurityEventsFlowComponent;
}

// Depth of the severity layer in the 3-layer source → class → severity flow.
const SEVERITY_LAYER_DEPTH: number = 2;

const NEUTRAL_NODE_COLOR: string = "#94a3b8";

type RenderSankeyNodeFunction = (nodeProps: SankeyNodeProps) => ReactElement;

/*
 * Custom node renderer: severity-layer nodes take their severity color,
 * every other layer stays neutral slate. Labels sit beside the node —
 * right of it for the first layers, left of it for the last so they do
 * not clip on the container edge.
 */
const renderSankeyNode: RenderSankeyNodeFunction = (
  nodeProps: SankeyNodeProps,
): ReactElement => {
  const { x, y, width, height, payload } = nodeProps;

  const isSeverityLayer: boolean = payload.depth === SEVERITY_LAYER_DEPTH;
  const fill: string = isSeverityLayer
    ? getSecurityEventSeverityColor(payload.name)
    : NEUTRAL_NODE_COLOR;

  const labelOnLeft: boolean = isSeverityLayer;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        fillOpacity={0.9}
        rx={1.5}
      />
      <text
        x={labelOnLeft ? x - 4 : x + width + 4}
        y={y + height / 2}
        textAnchor={labelOnLeft ? "end" : "start"}
        dominantBaseline="middle"
        fontSize={10}
        fill="var(--ou-chart-tick, #64748b)"
      >
        {payload.name}
      </text>
    </g>
  );
};

const DashboardSecurityEventsFlowComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const [flowRecords, setFlowRecords] = useState<
    Array<SecurityEventFlowRecord>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const requestSequenceRef: React.MutableRefObject<number> = useRef<number>(0);

  const fetchData: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const requestSequence: number = ++requestSequenceRef.current;
      const isStale: () => boolean = (): boolean => {
        return requestSequence !== requestSequenceRef.current;
      };

      setIsLoading(true);

      if (DashboardResourceList.isPublic()) {
        setFlowRecords([]);
        setIsLoading(false);
        setError(
          "Security event widgets are not available on public dashboards.",
        );
        return;
      }

      const startAndEndDate: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(
          props.dashboardStartAndEndDate,
        );

      if (!startAndEndDate.startValue || !startAndEndDate.endValue) {
        setIsLoading(false);
        setError("Please select a valid start and end date.");
        return;
      }

      try {
        const query: Query<SecurityEvent> = {
          time: new InBetween<Date>(
            startAndEndDate.startValue,
            startAndEndDate.endValue,
          ),
        };

        const severityFilters: Array<string> = (
          props.component.arguments.severityFilters || []
        ).filter(Boolean);
        if (severityFilters.length > 0) {
          query.severityName = new Includes(severityFilters);
        }

        const listResult: ListResult<SecurityEvent> =
          await AnalyticsModelAPI.getList<SecurityEvent>({
            modelType: SecurityEvent,
            query: query,
            limit: resolveSecurityEventsFlowMaxEvents(
              props.component.arguments.maxEvents,
            ),
            skip: 0,
            select: {
              className: true,
              severityName: true,
              principalHost: true,
              targetHost: true,
              vendorName: true,
            },
            sort: {
              time: SortOrder.Descending,
            },
          });

        if (isStale()) {
          return;
        }

        setFlowRecords(
          listResult.data.map(
            (securityEvent: SecurityEvent): SecurityEventFlowRecord => {
              return {
                className: securityEvent.className as string | undefined,
                severityName: securityEvent.severityName as string | undefined,
                principalHost: securityEvent.principalHost as
                  | string
                  | undefined,
                targetHost: securityEvent.targetHost as string | undefined,
                vendorName: securityEvent.vendorName as string | undefined,
              };
            },
          ),
        );
        setError(null);
      } catch (err: unknown) {
        if (isStale()) {
          return;
        }
        setFlowRecords([]);
        setError(API.getFriendlyErrorMessage(err as Error));
      }

      if (!isStale()) {
        setIsLoading(false);
      }
    }, [
      props.dashboardStartAndEndDate,
      props.component.arguments.severityFilters,
      props.component.arguments.maxEvents,
    ]);

  useEffect(() => {
    void fetchData();
  }, [fetchData, props.refreshTick]);

  const flowData: SecurityEventsFlowData = useMemo(() => {
    return buildSecurityEventsFlow(flowRecords);
  }, [flowRecords]);

  return (
    <div className="flex h-full w-full flex-col">
      {props.component.arguments.title && (
        <div className="mb-1 px-1 text-sm font-medium text-gray-700">
          {props.component.arguments.title}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {isLoading && flowRecords.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <ComponentLoader />
          </div>
        )}
        {!isLoading && error && <ErrorMessage message={error} />}
        {!isLoading && !error && flowData.links.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-gray-400">
            No security events for the selected time range and filters
          </div>
        )}
        {!error && flowData.links.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <Sankey
              data={flowData}
              node={renderSankeyNode}
              link={{ stroke: "#cbd5e1" }}
              nodePadding={16}
              nodeWidth={8}
              margin={{ top: 8, right: 96, bottom: 8, left: 8 }}
            >
              <Tooltip />
            </Sankey>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

function arePropsEqual(prev: ComponentProps, next: ComponentProps): boolean {
  if (
    prev.componentId.toString() !== next.componentId.toString() ||
    prev.refreshTick !== next.refreshTick ||
    prev.isEditMode !== next.isEditMode ||
    prev.isSelected !== next.isSelected ||
    prev.dashboardComponentWidthInPx !== next.dashboardComponentWidthInPx ||
    prev.dashboardComponentHeightInPx !== next.dashboardComponentHeightInPx
  ) {
    return false;
  }

  if (
    !JSONFunctions.deepEqual(
      prev.dashboardStartAndEndDate,
      next.dashboardStartAndEndDate,
    )
  ) {
    return false;
  }

  return (
    JSONFunctions.deepEqual(
      prev.component.arguments,
      next.component.arguments,
    ) && JSONFunctions.deepEqual(prev.variables, next.variables)
  );
}

export default React.memo(
  DashboardSecurityEventsFlowComponentElement,
  arePropsEqual,
);
