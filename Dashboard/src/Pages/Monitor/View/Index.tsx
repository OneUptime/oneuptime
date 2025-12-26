import LabelsElement from "Common/UI/Components/Label/Labels";
import DisabledWarning from "../../../Components/Monitor/DisabledWarning";
import IncomingMonitorLink from "../../../Components/Monitor/IncomingRequestMonitor/IncomingMonitorLink";
import ServerMonitorDocumentation from "../../../Components/Monitor/ServerMonitor/Documentation";
import Summary from "../../../Components/Monitor/SummaryView/Summary";
import ProbeUtil from "../../../Utils/Probe";
import PageComponentProps from "../../PageComponentProps";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Black, Gray500, Green, Red500 } from "Common/Types/BrandColors";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import ServerMonitorResponse from "Common/Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import MonitorUptimeGraph from "Common/UI/Components/MonitorGraphs/Uptime";
import UptimeUtil from "Common/UI/Components/MonitorGraphs/UptimeUtil";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import AnalyticsModelAPI, {
  ListResult as AnalyticsListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorProbe, {
  MonitorStepProbeResponse,
} from "Common/Models/DatabaseModels/MonitorProbe";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import Probe from "Common/Models/DatabaseModels/Probe";
import MonitorLog from "Common/Models/AnalyticsModels/MonitorLog";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import useAsyncEffect from "use-async-effect";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import LogMonitorPreview from "../../../Components/Monitor/LogMonitor/LogMonitorPreview";
import TraceTable from "../../../Components/Traces/TraceTable";
import { MonitorStepTraceMonitorUtil } from "Common/Types/Monitor/MonitorStepTraceMonitor";
import MetricMonitorPreview from "../../../Components/Monitor/MetricMonitor/MetricMonitorPreview";
import MonitorFeedElement from "../../../Components/Monitor/MonitorFeed";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import MonitorEvaluationSummary from "Common/Types/Monitor/MonitorEvaluationSummary";

const MonitorView: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [statusTimelines, setStatusTimelines] = useState<
    Array<MonitorStatusTimeline>
  >([]);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const startDate: Date = OneUptimeDate.getSomeDaysAgo(90);
  const endDate: Date = OneUptimeDate.getCurrentDate();
  const [downTimeMonitorStatues, setDowntimeMonitorStatues] = useState<
    Array<MonitorStatus>
  >([]);
  const [currentMonitorStatus, setCurrentMonitorStatus] = useState<
    MonitorStatus | undefined
  >(undefined);

  const [monitorType, setMonitorType] = useState<MonitorType | undefined>(
    undefined,
  );

  const [monitor, setMonitor] = useState<Monitor | null>(null);

  const [probes, setProbes] = useState<Array<Probe>>([]);

  const [probeResponses, setProbeResponses] = useState<
    Array<MonitorStepProbeResponse> | undefined
  >(undefined);

  const [incomingMonitorRequest, setIncomingMonitorRequest] = useState<
    IncomingMonitorRequest | undefined
  >(undefined);

  const [serverMonitorResponse, setServerMonitorResponse] = useState<
    ServerMonitorResponse | undefined
  >(undefined);

  const [latestEvaluationSummary, setLatestEvaluationSummary] = useState<
    MonitorEvaluationSummary | undefined
  >(undefined);

  const getUptimePercent: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <></>;
    }

    const uptimePercent: number = UptimeUtil.calculateUptimePercentage(
      statusTimelines,
      UptimePrecision.THREE_DECIMAL,
      downTimeMonitorStatues,
    );

    return (
      <div
        className="font-medium mt-5"
        style={{
          color: currentMonitorStatus?.color?.toString() || Green.toString(),
        }}
      >
        {uptimePercent}% uptime
      </div>
    );
  };

  useAsyncEffect(async () => {
    await fetchItem();
  }, []);

  const fetchItem: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      await API.get({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          "/monitor/refresh-status/" + modelId.toString(),
        ),
      });

      const monitorStatus: ListResult<MonitorStatusTimeline> =
        await ModelAPI.getList({
          modelType: MonitorStatusTimeline,
          query: {
            createdAt: new InBetween(startDate, endDate),
            monitorId: modelId,
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            createdAt: true,
            monitorId: true,
            startsAt: true,
            endsAt: true,
            monitorStatus: {
              name: true,
              color: true,
              isOperationalState: true,
              priority: true,
            },
          },
          sort: {
            createdAt: SortOrder.Ascending,
          },
        });

      const item: Monitor | null = await ModelAPI.getItem({
        modelType: Monitor,
        id: modelId,
        select: {
          monitorType: true,
          currentMonitorStatus: {
            name: true,
            color: true,
          },
          incomingRequestSecretKey: true,
          incomingRequestMonitorHeartbeatCheckedAt: true,
          serverMonitorSecretKey: true,
          serverMonitorRequestReceivedAt: true,
          incomingMonitorRequest: true,
          serverMonitorResponse: true,
          isNoProbeEnabledOnThisMonitor: true,
          isAllProbesDisconnectedFromThisMonitor: true,
          telemetryMonitorLastMonitorAt: true,
          telemetryMonitorNextMonitorAt: true,
          monitorSteps: true,
        },
      });

      setMonitor(item);

      if (item?._id && ProjectUtil.getCurrentProjectId()) {
        try {
          const monitorLogResult: AnalyticsListResult<MonitorLog> =
            await AnalyticsModelAPI.getList({
              modelType: MonitorLog,
              query: {
                projectId: ProjectUtil.getCurrentProjectId()!.toString(),
                monitorId: item._id.toString(),
              },
              limit: 1,
              skip: 0,
              select: {
                logBody: true,
              },
              sort: {
                time: SortOrder.Descending,
              },
            });

          if (monitorLogResult.data.length > 0) {
            const latestLog: MonitorLog | undefined = monitorLogResult.data[0];

            if (latestLog?.logBody) {
              const evaluationSummary: MonitorEvaluationSummary | undefined = (
                latestLog.logBody as unknown as {
                  evaluationSummary?: MonitorEvaluationSummary | undefined;
                }
              )?.evaluationSummary;

              setLatestEvaluationSummary(evaluationSummary);
            } else {
              setLatestEvaluationSummary(undefined);
            }
          } else {
            setLatestEvaluationSummary(undefined);
          }
        } catch {
          setLatestEvaluationSummary(undefined);
        }
      } else {
        setLatestEvaluationSummary(undefined);
      }

      if (item?.incomingMonitorRequest) {
        setIncomingMonitorRequest(item.incomingMonitorRequest);
      }

      if (item?.serverMonitorResponse) {
        setServerMonitorResponse(item.serverMonitorResponse);
      }

      const monitorStatuses: ListResult<MonitorStatus> = await ModelAPI.getList(
        {
          modelType: MonitorStatus,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            priority: true,
            isOperationalState: true,
            name: true,
            color: true,
          },
          sort: {
            priority: SortOrder.Ascending,
          },
        },
      );

      if (!item) {
        setError(ExceptionMessages.MonitorNotFound);
        return;
      }

      setMonitorType(item.monitorType);
      setCurrentMonitorStatus(item.currentMonitorStatus);
      setDowntimeMonitorStatues(
        monitorStatuses.data.filter((status: MonitorStatus) => {
          return !status.isOperationalState;
        }),
      );
      setStatusTimelines(monitorStatus.data);

      const isMonitoredByProbe: boolean = item.monitorType
        ? MonitorTypeHelper.isProbableMonitor(item.monitorType)
        : false;

      if (isMonitoredByProbe) {
        // get a list of probes
        const probes: Array<Probe> = await ProbeUtil.getAllProbes();
        setProbes(probes);

        // get probe responses for this monitor

        const monitorProbes: ListResult<MonitorProbe> = await ModelAPI.getList({
          modelType: MonitorProbe,
          query: {
            monitorId: modelId,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          sort: {
            createdAt: SortOrder.Descending,
          },
          select: {
            probeId: true,
            lastMonitoringLog: true,
          },
        });

        const probeMonitorResponses: Array<MonitorStepProbeResponse> = [];

        for (let i: number = 0; i < monitorProbes.data.length; i++) {
          const monitorProbe: MonitorProbe | undefined = monitorProbes.data[i];

          if (!monitorProbe) {
            continue;
          }

          if (!monitorProbe.probeId) {
            continue;
          }

          if (!monitorProbe.lastMonitoringLog) {
            continue;
          }

          probeMonitorResponses.push(monitorProbe?.lastMonitoringLog);
        }

        setProbeResponses(probeMonitorResponses);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <Fragment>
      {monitor && monitor.isAllProbesDisconnectedFromThisMonitor && (
        <Alert
          type={AlertType.DANGER}
          className="cursor-pointer"
          onClick={() => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.MONITOR_VIEW_PROBES]!,
                {
                  modelId: modelId,
                },
              ),
            );
          }}
          strongTitle="Probes Disconnected"
          title={
            "This monitor is not being monitored because all probes are disconnected. Please click here to check probes for this monitor."
          }
        />
      )}

      {monitor && monitor.isNoProbeEnabledOnThisMonitor && (
        <Alert
          type={AlertType.DANGER}
          className="cursor-pointer"
          onClick={() => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.MONITOR_VIEW_PROBES]!,
                {
                  modelId: modelId,
                },
              ),
            );
          }}
          strongTitle="Probes Not Enabled"
          title={
            "This monitor is not being monitored because all probes are disabled for this monitor. Please click here to check probes for this monitor."
          }
        />
      )}

      <DisabledWarning monitorId={modelId} />

      {/* Monitor View  */}
      <CardModelDetail<Monitor>
        name="Monitor Details"
        formSteps={[
          {
            title: "Monitor Info",
            id: "monitor-info",
          },
          {
            title: "Labels",
            id: "labels",
          },
        ]}
        cardProps={{
          title: "Monitor Details",
          description: "Here are more details for this monitor.",
        }}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            stepId: "monitor-info",
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Monitor Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            stepId: "monitor-info",
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description",
          },
          {
            field: {
              labels: true,
            },
            stepId: "labels",
            title: "Labels ",
            description:
              "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Labels",
          },
        ]}
        modelDetailProps={{
          selectMoreFields: {
            disableActiveMonitoring: true,
            isNoProbeEnabledOnThisMonitor: true,
            isAllProbesDisconnectedFromThisMonitor: true,
          },
          showDetailsInNumberOfColumns: 2,
          modelType: Monitor,
          id: "model-detail-monitors",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Monitor ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                name: true,
              },
              title: "Monitor Name",
            },
            {
              field: {
                currentMonitorStatus: {
                  color: true,
                  name: true,
                },
              },
              title: "Current Status",
              fieldType: FieldType.Element,
              getElement: (item: Monitor): ReactElement => {
                if (!item["currentMonitorStatus"]) {
                  throw new BadDataException("Monitor Status not found");
                }

                if (item && item["disableActiveMonitoring"]) {
                  return (
                    <Statusbubble
                      color={Gray500}
                      text={"Disabled"}
                      shouldAnimate={false}
                    />
                  );
                }

                if (item && item.isNoProbeEnabledOnThisMonitor) {
                  return (
                    <Statusbubble
                      shouldAnimate={false}
                      color={Red500}
                      text={"Probes Not Enabled"}
                    />
                  );
                }

                if (item && item.isAllProbesDisconnectedFromThisMonitor) {
                  return (
                    <Statusbubble
                      shouldAnimate={false}
                      color={Red500}
                      text={"Probes Disconnected"}
                    />
                  );
                }

                return (
                  <Statusbubble
                    color={item.currentMonitorStatus.color || Black}
                    shouldAnimate={true}
                    text={item.currentMonitorStatus.name || "Unknown"}
                  />
                );
              },
            },

            {
              field: {
                monitorType: true,
              },
              title: "Monitor Type",
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: Monitor): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
            },
          ],
          modelId: modelId,
        }}
      />

      {/* Heartbeat URL */}
      {monitorType === MonitorType.IncomingRequest &&
      monitor?.incomingRequestSecretKey &&
      !incomingMonitorRequest ? (
        <IncomingMonitorLink secretKey={monitor?.incomingRequestSecretKey} />
      ) : (
        <></>
      )}

      {monitorType === MonitorType.Server &&
      monitor?.serverMonitorSecretKey &&
      !monitor.serverMonitorRequestReceivedAt ? (
        <ServerMonitorDocumentation
          secretKey={monitor?.serverMonitorSecretKey}
        />
      ) : (
        <></>
      )}

      <Card
        title="Uptime Graph"
        description="Here the 90 day uptime history of this monitor."
        rightElement={getUptimePercent()}
      >
        <MonitorUptimeGraph
          error={error}
          items={statusTimelines}
          startDate={OneUptimeDate.getSomeDaysAgo(90)}
          endDate={OneUptimeDate.getCurrentDate()}
          isLoading={isLoading}
          defaultBarColor={Green}
          downtimeMonitorStatuses={downTimeMonitorStatues}
        />
      </Card>

      <Summary
        monitorType={monitorType!}
        probes={probes}
        incomingMonitorRequest={incomingMonitorRequest}
        incomingRequestMonitorHeartbeatCheckedAt={
          monitor?.incomingRequestMonitorHeartbeatCheckedAt
        }
        probeMonitorResponses={probeResponses}
        serverMonitorResponse={serverMonitorResponse}
        telemetryMonitorSummary={{
          lastCheckedAt: monitor?.telemetryMonitorLastMonitorAt,
          nextCheckAt: monitor?.telemetryMonitorNextMonitorAt,
        }}
        evaluationSummary={latestEvaluationSummary}
      />

      {monitor?.monitorType === MonitorType.Logs &&
        monitor.monitorSteps &&
        monitor.monitorSteps.data?.monitorStepsInstanceArray &&
        monitor.monitorSteps.data?.monitorStepsInstanceArray.length > 0 && (
          <div>
            <Card
              title={"Logs Preview"}
              description={
                "Preview of the logs that match the filter of this monitor."
              }
            >
              <LogMonitorPreview
                monitorStepLogMonitor={
                  monitor.monitorSteps.data?.monitorStepsInstanceArray[0]?.data
                    ?.logMonitor
                }
              />
            </Card>
          </div>
        )}

      {monitor?.monitorType === MonitorType.Metrics &&
        monitor.monitorSteps &&
        monitor.monitorSteps.data?.monitorStepsInstanceArray &&
        monitor.monitorSteps.data?.monitorStepsInstanceArray.length > 0 && (
          <div>
            <MetricMonitorPreview
              monitorStepMetricMonitor={
                monitor.monitorSteps.data?.monitorStepsInstanceArray[0]?.data
                  ?.metricMonitor
              }
            />
          </div>
        )}

      {monitor?.monitorType === MonitorType.Traces &&
        monitor.monitorSteps &&
        monitor.monitorSteps.data?.monitorStepsInstanceArray &&
        monitor.monitorSteps.data?.monitorStepsInstanceArray.length > 0 &&
        monitor.monitorSteps.data?.monitorStepsInstanceArray[0] &&
        monitor.monitorSteps.data?.monitorStepsInstanceArray[0]!.data &&
        monitor.monitorSteps.data?.monitorStepsInstanceArray[0]!.data!
          .traceMonitor && (
          <TraceTable
            spanQuery={MonitorStepTraceMonitorUtil.toQuery(
              monitor.monitorSteps.data!.monitorStepsInstanceArray[0]!.data!
                .traceMonitor!,
            )}
          />
        )}

      <MonitorFeedElement monitorId={modelId} />
    </Fragment>
  );
};

export default MonitorView;
