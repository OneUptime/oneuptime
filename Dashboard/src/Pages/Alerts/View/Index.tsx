import ChangeAlertState from "../../../Components/Alert/ChangeState";
import LabelsElement from "Common/UI/Components/Label/Labels";
import OnCallDutyPoliciesView from "../../../Components/OnCallPolicy/OnCallPolicies";
import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Black } from "Common/Types/BrandColors";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Pill from "Common/UI/Components/Pill/Pill";
import ProbeElement from "Common/UI/Components/Probe/Probe";
import FieldType from "Common/UI/Components/Types/FieldType";
import BaseAPI from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
import Label from "Common/Models/DatabaseModels/Label";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import UserElement from "../../../Components/User/User";
import Card from "Common/UI/Components/Card/Card";
import DashboardLogsViewer from "../../../Components/Logs/LogsViewer";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import JSONFunctions from "Common/Types/JSONFunctions";
import TraceTable from "../../../Components/Traces/TraceTable";
import MonitorElement from "../../../Components/Monitor/Monitor";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import MetricView from "../../../Components/Metrics/MetricView";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import HeaderAlert, {
  HeaderAlertType,
} from "Common/UI/Components/HeaderAlert/HeaderAlert";
import IconProp from "Common/Types/Icon/IconProp";
import ColorSwatch from "Common/Types/ColorSwatch";
import AlertFeedElement from "../../../Components/Alert/AlertFeed";
import ExceptionInstanceTable from "../../../Components/Exceptions/ExceptionInstanceTable";
import Query from "Common/Types/BaseDatabase/Query";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Span from "Common/Models/AnalyticsModels/Span";
import Log from "Common/Models/AnalyticsModels/Log";

const AlertView: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [alertStateTimeline, setAlertStateTimeline] = useState<
    AlertStateTimeline[]
  >([]);
  const [alertStates, setAlertStates] = useState<AlertState[]>([]);

  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [telemetryQuery, setTelemetryQuery] = useState<TelemetryQuery | null>(
    null,
  );

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);

      const alertTimelines: ListResult<AlertStateTimeline> =
        await ModelAPI.getList({
          modelType: AlertStateTimeline,
          query: {
            alertId: modelId,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            startsAt: true,
            createdByUser: {
              name: true,
              email: true,
              profilePictureId: true,
            },
            alertStateId: true,
          },
          sort: {
            startsAt: SortOrder.Ascending,
          },
        });

      const alertStates: ListResult<AlertState> = await ModelAPI.getList({
        modelType: AlertState,
        query: {},
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          name: true,
          isAcknowledgedState: true,
          isResolvedState: true,
        },
        sort: {},
      });

      const alert: Alert | null = await ModelAPI.getItem({
        id: modelId,
        modelType: Alert,
        select: {
          telemetryQuery: true,
        },
      });

      let telemetryQuery: TelemetryQuery | null = null;

      if (alert?.telemetryQuery) {
        telemetryQuery = JSONFunctions.deserialize(
          alert?.telemetryQuery as any,
        ) as any;
      }

      setTelemetryQuery(telemetryQuery);
      setAlertStates(alertStates.data as AlertState[]);
      setAlertStateTimeline(alertTimelines.data as AlertStateTimeline[]);
      setError("");
    } catch (err) {
      setError(BaseAPI.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(BaseAPI.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  type GetAlertStateFunction = () => AlertState | undefined;

  const getAcknowledgeState: GetAlertStateFunction = ():
    | AlertState
    | undefined => {
    return alertStates.find((state: AlertState) => {
      return state.isAcknowledgedState;
    });
  };

  const getResolvedState: GetAlertStateFunction = ():
    | AlertState
    | undefined => {
    return alertStates.find((state: AlertState) => {
      return state.isResolvedState;
    });
  };

  type getTimeFunction = () => string;

  const getTimeToAcknowledge: getTimeFunction = (): string => {
    const alertStartTime: Date = alertStateTimeline[0]?.startsAt || new Date();

    const acknowledgeTime: Date | undefined = alertStateTimeline.find(
      (timeline: AlertStateTimeline) => {
        return (
          timeline.alertStateId?.toString() ===
          getAcknowledgeState()?._id?.toString()
        );
      },
    )?.startsAt;

    const resolveTime: Date | undefined = alertStateTimeline.find(
      (timeline: AlertStateTimeline) => {
        return (
          timeline.alertStateId?.toString() ===
          getResolvedState()?._id?.toString()
        );
      },
    )?.startsAt;

    if (!acknowledgeTime && !resolveTime) {
      return (
        "Not yet " +
        (getAcknowledgeState()?.name?.toLowerCase() || "acknowledged")
      );
    }

    if (!acknowledgeTime && resolveTime) {
      return OneUptimeDate.convertMinutesToDaysHoursAndMinutes(
        OneUptimeDate.getDifferenceInMinutes(resolveTime, alertStartTime),
      );
    }

    return OneUptimeDate.convertMinutesToDaysHoursAndMinutes(
      OneUptimeDate.getDifferenceInMinutes(acknowledgeTime!, alertStartTime),
    );
  };

  const getTimeToResolve: getTimeFunction = (): string => {
    const alertStartTime: Date = alertStateTimeline[0]?.startsAt || new Date();

    const resolveTime: Date | undefined = alertStateTimeline.find(
      (timeline: AlertStateTimeline) => {
        return (
          timeline.alertStateId?.toString() ===
          getResolvedState()?._id?.toString()
        );
      },
    )?.startsAt;

    if (!resolveTime) {
      return (
        "Not yet " + (getResolvedState()?.name?.toLowerCase() || "resolved")
      );
    }

    return OneUptimeDate.convertMinutesToDaysHoursAndMinutes(
      OneUptimeDate.getDifferenceInMinutes(resolveTime, alertStartTime),
    );
  };

  type GetInfoCardFunction = (value: string) => ReactElement;

  const getInfoCardValue: GetInfoCardFunction = (
    value: string,
  ): ReactElement => {
    return <div className="font-medium text-gray-900 text-lg">{value}</div>;
  };

  return (
    <Fragment>
      {/* Alert View  */}
      <CardModelDetail<Alert>
        name="Alert Details"
        cardProps={{
          title: "Alert Details",
          description: "Here are more details for this alert.",
        }}
        isEditable={true}
        formSteps={[
          {
            title: "Alert Details",
            id: "alert-details",
          },
          {
            title: "Labels",
            id: "labels",
          },
        ]}
        formFields={[
          {
            field: {
              title: true,
            },
            title: "Alert Title",
            stepId: "alert-details",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Alert Title",
            validation: {
              minLength: 2,
            },
          },

          {
            field: {
              alertSeverity: true,
            },
            title: "Alert Severity",
            description: "What type of alert is this?",
            fieldType: FormFieldSchemaType.Dropdown,
            stepId: "alert-details",
            dropdownModal: {
              type: AlertSeverity,
              labelField: "name",
              valueField: "_id",
            },
            required: true,
            placeholder: "Alert Severity",
          },
          {
            field: {
              labels: true,
            },
            title: "Labels ",
            stepId: "labels",
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
            createdByUser: {
              _id: true,
              name: true,
              email: true,
              profilePictureId: true,
            },
          },
          onBeforeFetch: async (): Promise<JSONObject> => {
            // get ack alert.

            const alertTimelines: ListResult<AlertStateTimeline> =
              await ModelAPI.getList({
                modelType: AlertStateTimeline,
                query: {
                  alertId: modelId,
                },
                limit: LIMIT_PER_PROJECT,
                skip: 0,
                select: {
                  _id: true,

                  createdAt: true,
                  createdByUser: {
                    name: true,
                    email: true,
                    profilePictureId: true,
                  },
                  alertState: {
                    name: true,
                    isResolvedState: true,
                    isAcknowledgedState: true,
                  },
                },
                sort: {},
              });

            return alertTimelines;
          },
          showDetailsInNumberOfColumns: 2,
          modelType: Alert,
          id: "model-detail-alerts",
          fields: [
            {
              field: {
                alertNumber: true,
              },
              title: "Alert Number",
              fieldType: FieldType.Element,
              getElement: (item: Alert): ReactElement => {
                if (!item.alertNumber) {
                  return <>-</>;
                }

                return (
                  <div className="inline-flex items-center gap-2">
                    <div className="inline-flex items-center px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-100">
                      <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider mr-2">
                        ALT
                      </span>
                      <span className="text-xl font-bold text-amber-600">
                        {item.alertNumber}
                      </span>
                    </div>
                  </div>
                );
              },
            },
            {
              field: {
                _id: true,
              },
              title: "Alert ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                title: true,
              },
              title: "Alert Title",
              fieldType: FieldType.Text,
            },

            {
              field: {
                currentAlertState: {
                  color: true,
                  name: true,
                },
              },
              title: "Current State",
              fieldType: FieldType.Entity,
              getElement: (item: Alert): ReactElement => {
                if (!item["currentAlertState"]) {
                  throw new BadDataException("Alert Status not found");
                }

                return (
                  <Pill
                    color={item.currentAlertState.color || Black}
                    text={item.currentAlertState.name || "Unknown"}
                  />
                );
              },
            },
            {
              field: {
                alertSeverity: {
                  color: true,
                  name: true,
                },
              },
              title: "Alert Severity",
              fieldType: FieldType.Entity,
              getElement: (item: Alert): ReactElement => {
                if (!item["alertSeverity"]) {
                  throw new BadDataException("Alert Severity not found");
                }

                return (
                  <Pill
                    color={item.alertSeverity.color || Black}
                    text={item.alertSeverity.name || "Unknown"}
                  />
                );
              },
            },
            {
              field: {
                monitor: {
                  name: true,
                  _id: true,
                },
              },
              title: "Monitors Affected",
              fieldType: FieldType.Element,
              getElement: (item: Alert): ReactElement => {
                return <MonitorElement monitor={item["monitor"]!} />;
              },
            },
            {
              field: {
                onCallDutyPolicies: {
                  name: true,
                  _id: true,
                },
              },
              title: "On-Call Duty Policies",
              fieldType: FieldType.Element,
              getElement: (item: Alert): ReactElement => {
                return (
                  <OnCallDutyPoliciesView
                    onCallPolicies={item.onCallDutyPolicies || []}
                  />
                );
              },
            },
            {
              field: {
                createdAt: true,
              },
              title: "Declared At",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                createdByProbe: {
                  name: true,
                  iconFileId: true,
                },
              },
              title: "Declared By",
              fieldType: FieldType.Element,
              getElement: (item: Alert): ReactElement => {
                if (item.createdByProbe) {
                  return <ProbeElement probe={item.createdByProbe} />;
                }

                if (item.createdByUser) {
                  return <UserElement user={item.createdByUser} />;
                }

                return <p>Unknown</p>;
              },
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
              getElement: (item: Alert): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
          ],
          modelId: modelId,
        }}
      />

      <ChangeAlertState
        alertId={modelId}
        onActionComplete={async () => {
          await fetchData();
        }}
      />

      <div className="flex space-x-5 mt-5 mb-5 w-full justify-between">
        <InfoCard
          title={`${getAcknowledgeState()?.name || "Acknowledged"} in`}
          value={getInfoCardValue(getTimeToAcknowledge())}
          className="w-1/2"
        />
        <InfoCard
          title={`${getResolvedState()?.name || "Resolved"} in`}
          value={getInfoCardValue(getTimeToResolve())}
          className="w-1/2"
        />
      </div>

      {telemetryQuery &&
        telemetryQuery.telemetryType === TelemetryType.Log &&
        telemetryQuery.telemetryQuery && (
          <div>
            <Card title={"Logs"} description={"Logs for this alert."}>
              <DashboardLogsViewer
                id="logs-preview"
                logQuery={telemetryQuery.telemetryQuery as Query<Log>}
                limit={10}
                noLogsMessage="No logs found"
              />
            </Card>
          </div>
        )}

      {telemetryQuery &&
        telemetryQuery.telemetryType === TelemetryType.Trace &&
        telemetryQuery.telemetryQuery && (
          <div>
            <TraceTable
              spanQuery={telemetryQuery.telemetryQuery as Query<Span>}
            />
          </div>
        )}

      {telemetryQuery &&
        telemetryQuery.telemetryType === TelemetryType.Metric &&
        telemetryQuery.metricViewData && (
          <Card
            title={"Metrics"}
            description={"Metrics for this alert."}
            rightElement={
              telemetryQuery.metricViewData.startAndEndDate ? (
                <HeaderAlert
                  icon={IconProp.Clock}
                  onClick={() => {
                    // do nothing!
                  }}
                  title={OneUptimeDate.getInBetweenDatesAsFormattedString(
                    telemetryQuery.metricViewData.startAndEndDate,
                  )}
                  alertType={HeaderAlertType.INFO}
                  colorSwatch={ColorSwatch.Blue}
                />
              ) : (
                <></>
              )
            }
          >
            <MetricView
              data={telemetryQuery.metricViewData}
              hideQueryElements={true}
              chartCssClass="rounded-md border border-gray-200 mt-2 shadow-none"
              hideStartAndEndDate={true}
              onChange={(_data: MetricViewData) => {
                // do nothing!
              }}
            />
          </Card>
        )}

      {telemetryQuery &&
        telemetryQuery.telemetryType === TelemetryType.Exception &&
        telemetryQuery.telemetryQuery && (
          <ExceptionInstanceTable
            title="Exceptions"
            description="Exceptions for this alert."
            query={telemetryQuery.telemetryQuery as Query<ExceptionInstance>}
          />
        )}

      <AlertFeedElement alertId={modelId} />
    </Fragment>
  );
};

export default AlertView;
