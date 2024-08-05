import DashboardLogsViewer from "../Logs/LogsViewer";
import SpanStatusElement from "../Span/SpanStatusElement";
import SpanViewer from "../Span/SpanViewer";
import TelemetryServiceElement from "..//TelemetryService/TelemetryServiceElement";
import DashboardNavigation from "../../Utils/Navigation";
import SpanUtil, {
  DivisibilityFactor,
  IntervalUnit,
} from "../../Utils/SpanUtil";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Color from "Common/Types/Color";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import Card from "CommonUI/src/Components/Card/Card";
import { getRefreshButton } from "CommonUI/src/Components/Card/CardButtons/Refresh";
import ErrorMessage from "CommonUI/src/Components/ErrorMessage/ErrorMessage";
import { GanttChartBar } from "CommonUI/src/Components/GanttChart/Bar/Index";
import GanttChart, {
  GanttChartProps,
} from "CommonUI/src/Components/GanttChart/Index";
import { GanttChartRow } from "CommonUI/src/Components/GanttChart/Row/Row";
import PageLoader from "CommonUI/src/Components/Loader/PageLoader";
import SideOver, {
  SideOverSize,
} from "CommonUI/src/Components/SideOver/SideOver";
import API from "CommonUI/src/Utils/API/API";
import AnalyticsModelAPI from "CommonUI/src/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ListResult from "CommonUI/src/Utils/BaseDatabase/ListResult";
import Select from "CommonUI/src/Utils/BaseDatabase/Select";
import ModelAPI from "CommonUI/src/Utils/ModelAPI/ModelAPI";
import Span, { SpanStatus } from "Common/AppModels/AnalyticsModels/Span";
import TelemetryService from "Common/Models/DatabaseModels/TelemetryService";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  traceId: string;
}

type BarTooltipFunctionProps = {
  span: Span;
  timelineStartTimeUnixNano: number;
  divisibilityFactor: DivisibilityFactor;
};

type GetBarTooltipFunction = (data: BarTooltipFunctionProps) => ReactElement;

const TraceExplorer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [telemetryServices, setTelemetryServices] = React.useState<
    TelemetryService[]
  >([]);

  const [selectedSpans, setSelectedSpans] = React.useState<string[]>([]);

  const traceIdFromUrl: string = props.traceId;

  const [error, setError] = React.useState<string | null>(null);

  const [isLoading, setIsLoading] = React.useState<boolean>(false);

  const [spans, setSpans] = React.useState<Span[]>([]);

  const [traceId, setTraceId] = React.useState<string | null>(null);

  const [ganttChart, setGanttChart] = React.useState<GanttChartProps | null>(
    null,
  );

  const [divisibilityFactor, setDivisibilityFactor] =
    React.useState<DivisibilityFactor>({
      divisibilityFactorNumber: 1000,
      intervalUnit: IntervalUnit.Milliseconds,
    });

  const fetchItems: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);

      // get trace with this id and then get all the parentSpanId with this traceid.

      const telemetryServices: ListResult<TelemetryService> =
        await ModelAPI.getList<TelemetryService>({
          query: {
            projectId: DashboardNavigation.getProjectId()!,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          modelType: TelemetryService,
          sort: {
            name: SortOrder.Ascending,
          },
          select: {
            name: true,
            _id: true,
            serviceColor: true,
          },
        });

      setTelemetryServices(telemetryServices.data);

      const select: Select<Span> = {
        startTime: true,
        endTime: true,
        startTimeUnixNano: true,
        endTimeUnixNano: true,
        name: true,
        traceId: true,
        parentSpanId: true,
        spanId: true,
        kind: true,
        serviceId: true,
        durationUnixNano: true,
        statusCode: true,
      };

      // now get all the spans with the traceId

      const traceId: string = traceIdFromUrl;

      setTraceId(traceId);

      const allSpans: ListResult<Span> = await AnalyticsModelAPI.getList<Span>({
        modelType: Span,
        select: select,
        query: {
          traceId: traceId,
        },
        sort: {
          startTimeUnixNano: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
      });

      const spans: Span[] = [...allSpans.data];

      setSpans(spans);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  const getBarTooltip: GetBarTooltipFunction = (
    data: BarTooltipFunctionProps,
  ): ReactElement => {
    const { span, timelineStartTimeUnixNano, divisibilityFactor } = data;

    return (
      <div className="px-1 min-w-56 cursor-default">
        <div className="bar-tooltip-title text-sm text-gray-700 font-medium my-2">
          {span.name}
        </div>
        <div className="bar-tooltip-description text-gray-600 text-xs space-y-1.5 my-2">
          <div className="">
            <div className="font-semibold">Span ID:</div>{" "}
            <div>{span.spanId?.toString()}</div>
          </div>
          <div className="">
            <div className="font-semibold">Span Status:</div>{" "}
            <div>
              <SpanStatusElement
                spanStatusCode={span.statusCode!}
                traceId={span.traceId?.toString()}
                title={
                  "Status: " +
                  SpanUtil.getSpanStatusCodeFriendlyName(span.statusCode!)
                }
                titleClassName="mt-0.5"
              />{" "}
            </div>
          </div>
          <div className="">
            <div className="font-semibold">Seen at:</div>{" "}
            <div>{OneUptimeDate.getDateAsFormattedString(span.startTime!)}</div>
          </div>
          <div className="">
            <div className="font-semibold">Start:</div>{" "}
            <div>
              {SpanUtil.getSpanStartsAtAsString({
                timelineStartTimeUnixNano,
                divisibilityFactor: divisibilityFactor,
                spanStartTimeUnixNano: span.startTimeUnixNano!,
              })}
            </div>
          </div>
          <div className="">
            <div className="font-semibold">End:</div>{" "}
            <div>
              {SpanUtil.getSpanEndsAtAsString({
                timelineStartTimeUnixNano,
                divisibilityFactor: divisibilityFactor,
                spanEndTimeUnixNano: span.startTimeUnixNano!,
              })}
            </div>
          </div>
          <div className="">
            <div className="font-semibold">Duration:</div>{" "}
            <div>
              {SpanUtil.getSpanDurationAsString({
                spanDurationInUnixNano: span.durationUnixNano!,
                divisibilityFactor: divisibilityFactor,
              })}
            </div>
          </div>
          <div className="">
            <div className="font-semibold">Span Kind:</div>{" "}
            <div>{SpanUtil.getSpanKindFriendlyName(span.kind!)}</div>
          </div>
        </div>
      </div>
    );
  };

  type SpanToBarFunctionProps = {
    span: Span;
    timelineStartTimeUnixNano: number;
    divisibilityFactor: DivisibilityFactor;
  };

  type SpanToBarFunction = (data: SpanToBarFunctionProps) => GanttChartBar;

  const spanToBar: SpanToBarFunction = (
    data: SpanToBarFunctionProps,
  ): GanttChartBar => {
    const { span, timelineStartTimeUnixNano, divisibilityFactor } = data;

    const spanColor: {
      barColor: Color;
    } = SpanUtil.getGanttChartBarColor({
      span: span,
      telemetryServices: telemetryServices,
    });

    return {
      id: span.spanId!,
      label:
        span.statusCode === SpanStatus.Error ? (
          <div className="mt-0.5">
            <SpanStatusElement
              spanStatusCode={span.statusCode!}
              traceId={span.traceId?.toString()}
              title={
                "Status: " +
                SpanUtil.getSpanStatusCodeFriendlyName(span.statusCode!)
              }
            />
          </div>
        ) : (
          <></>
        ),
      barColor: spanColor.barColor,
      barTimelineStart:
        (span.startTimeUnixNano! - timelineStartTimeUnixNano) /
        divisibilityFactor.divisibilityFactorNumber,
      barTimelineEnd:
        (span.endTimeUnixNano! - timelineStartTimeUnixNano) /
        divisibilityFactor.divisibilityFactorNumber,
      rowId: span.spanId!,
      tooltip: getBarTooltip({
        span,
        timelineStartTimeUnixNano,
        divisibilityFactor: divisibilityFactor,
      }),
    };
  };

  type GetBarsFunctionProps = {
    rootSpan: Span;
    allSpans: Span[];
    timelineStartTimeUnixNano: number;
    divisibilityFactor: DivisibilityFactor;
  };

  type GetRowDescriptionFunction = (data: {
    telemetryService: TelemetryService;
    span: Span;
  }) => ReactElement;

  const getRowDescription: GetRowDescriptionFunction = (data: {
    telemetryService: TelemetryService;
    span: Span;
  }): ReactElement => {
    const { telemetryService } = data;

    return (
      <div className="flex space-x-5">
        <TelemetryServiceElement
          telemetryService={telemetryService}
          telemetryServiceNameClassName="mt-0.5"
        />
      </div>
    );
  };

  type GetRowsFunction = (data: GetBarsFunctionProps) => Array<GanttChartRow>;

  const getRows: GetRowsFunction = (
    data: GetBarsFunctionProps,
  ): Array<GanttChartRow> => {
    const {
      rootSpan,
      allSpans,
      timelineStartTimeUnixNano,
      divisibilityFactor,
    } = data;

    if (!rootSpan) {
      return [];
    }

    const telemetryService: TelemetryService | undefined =
      telemetryServices.find((service: TelemetryService) => {
        return service._id?.toString() === rootSpan.serviceId?.toString();
      });

    const rootRow: GanttChartRow = {
      rowInfo: {
        title: <div>{rootSpan.name!}</div>,
        description: telemetryService ? (
          getRowDescription({
            telemetryService,
            span: rootSpan,
          })
        ) : (
          <></>
        ),
        id: ObjectID.generate().toString(),
      },
      bars: [
        spanToBar({
          span: rootSpan,
          timelineStartTimeUnixNano,
          divisibilityFactor,
        }),
      ],
      childRows: [],
    };

    const currentSpan: Span = rootSpan;

    const currentSpanId: string | undefined = currentSpan.spanId;

    const childSpans: Array<Span> = allSpans.filter((span: Span) => {
      return span.parentSpanId?.toString() === currentSpanId?.toString();
    });

    for (const span of childSpans) {
      const childRows: Array<GanttChartRow> | null = getRows({
        rootSpan: span,
        allSpans,
        timelineStartTimeUnixNano,
        divisibilityFactor,
      });

      for (const row of childRows) {
        rootRow.childRows.push(row);
      }
    }

    return [rootRow];
  };

  React.useEffect(() => {
    fetchItems().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  React.useEffect(() => {
    // convert spans to gantt chart

    if (spans.length === 0) {
      return;
    }

    let timelineStartTimeUnixNano: number = spans[0]!.startTimeUnixNano!;

    let timelineEndTimeUnixNano: number =
      spans[spans.length - 1]!.endTimeUnixNano!;

    for (const span of spans) {
      if (span.startTimeUnixNano! < timelineStartTimeUnixNano) {
        timelineStartTimeUnixNano = span.startTimeUnixNano!;
      }

      if (span.endTimeUnixNano! > timelineEndTimeUnixNano) {
        timelineEndTimeUnixNano = span.endTimeUnixNano!;
      }
    }

    const startTimeline: number = 0;

    const divisibilityFactor: DivisibilityFactor =
      SpanUtil.getDivisibilityFactor(
        timelineEndTimeUnixNano - timelineStartTimeUnixNano,
      );

    setDivisibilityFactor(divisibilityFactor);

    const divisibilityFactorNumber: number =
      divisibilityFactor.divisibilityFactorNumber;

    const endTimeline: number =
      (timelineEndTimeUnixNano - timelineStartTimeUnixNano) /
      divisibilityFactorNumber; // divide by 1000 to convert from nanoseconds to ms

    const intervalTemp: number = Math.round(endTimeline / 100) * 10;

    const numberOfDigitsInIntervalTemp: number = intervalTemp.toString().length;

    const interval: number = Math.pow(10, numberOfDigitsInIntervalTemp);

    const ganttChart: GanttChartProps = {
      id: "chart",
      selectedBarIds: selectedSpans,
      rows: getRows({
        rootSpan: spans[0]!,
        allSpans: spans,
        timelineStartTimeUnixNano,
        divisibilityFactor,
      }),
      onBarSelectChange(barIds: Array<string>) {
        setSelectedSpans(barIds);
      },
      timeline: {
        start: startTimeline,
        end: Math.ceil(endTimeline / interval) * interval,
        interval: interval,
        intervalUnit: divisibilityFactor.intervalUnit,
      },
    };

    setGanttChart(ganttChart);
  }, [spans, selectedSpans]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage error={error} />;
  }

  return (
    <Fragment>
      <div className="mb-8">
        <Card
          title={"Traces"}
          description={"Traces for the request operation."}
          buttons={[
            {
              ...getRefreshButton(),
              className: "py-0 pr-0 pl-1 mt-1",
              onClick: async () => {
                await fetchItems();
              },
              disabled: isLoading,
            },
          ]}
        >
          <div className="overflow-x-auto">
            {ganttChart ? (
              <GanttChart chart={ganttChart} />
            ) : (
              <ErrorMessage error={"No spans found"} />
            )}
          </div>
        </Card>

        {traceId && (
          <div className="mt-5">
            <DashboardLogsViewer
              id={"traces-logs-viewer"}
              noLogsMessage="No logs found for this trace."
              traceIds={[traceId]}
              enableRealtime={false}
            />
          </div>
        )}

        {selectedSpans.length > 0 && (
          <SideOver
            title="View Span"
            description="View the span details."
            onClose={() => {
              setSelectedSpans([]);
            }}
            size={SideOverSize.Large}
          >
            <SpanViewer
              id={"span-viewer"}
              openTelemetrySpanId={selectedSpans[0] as string}
              traceStartTimeInUnixNano={spans[0]!.startTimeUnixNano!}
              onClose={() => {
                setSelectedSpans([]);
              }}
              telemetryService={
                telemetryServices.find((service: TelemetryService) => {
                  const selectedSpan: Span | undefined = spans.find(
                    (span: Span) => {
                      return span.spanId?.toString() === selectedSpans[0]!;
                    },
                  );

                  if (!selectedSpan) {
                    throw new BadDataException("Selected span not found"); // this should never happen
                  }

                  return (
                    service._id?.toString() ===
                    selectedSpan.serviceId?.toString()
                  );
                })!
              }
              divisibilityFactor={divisibilityFactor}
            />
          </SideOver>
        )}
      </div>
    </Fragment>
  );
};

export default TraceExplorer;
