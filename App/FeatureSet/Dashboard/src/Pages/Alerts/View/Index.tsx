import ChangeAlertState from "../../../Components/Alert/ChangeState";
import LabelsElement from "Common/UI/Components/Label/Labels";
import OnCallDutyPoliciesView from "../../../Components/OnCallPolicy/OnCallPolicies";
import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Black } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
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
import AffectedResourcesDisplay from "../../../Components/AffectedResources/AffectedResourcesDisplay";
import AffectedResourcesPicker, {
  isAffectedResourcesPayload,
} from "../../../Components/AffectedResources/AffectedResourcesPicker";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import Service from "Common/Models/DatabaseModels/Service";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import AlertEpisodeElement from "../../../Components/AlertEpisode/AlertEpisode";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import MetricView from "../../../Components/Metrics/MetricView";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import HeaderAlert, {
  HeaderAlertType,
} from "Common/UI/Components/HeaderAlert/HeaderAlert";
import IconProp from "Common/Types/Icon/IconProp";
import ColorSwatch from "Common/Types/ColorSwatch";
import AlertFeedElement from "../../../Components/Alert/AlertFeed";
import InvestigationPanel from "../../../Components/Sentinel/InvestigationPanel";
import EventStatTile from "../../../Components/EventView/EventStatTile";
import EntityRunbooks from "../../../Components/Runbook/EntityRunbooks";
import AlertAffectedResources from "./AffectedResources";
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

  const [severity, setSeverity] = useState<
    { name: string; color: Color } | undefined
  >(undefined);
  const [isPrivate, setIsPrivate] = useState<boolean>(false);
  const [eventNumber, setEventNumber] = useState<string | undefined>(undefined);
  const [alertTitle, setAlertTitle] = useState<string | undefined>(undefined);

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
          isPrivate: true,
          title: true,
          alertNumber: true,
          alertNumberWithPrefix: true,
          alertSeverity: {
            name: true,
            color: true,
          },
        },
      });

      let telemetryQuery: TelemetryQuery | null = null;

      if (alert?.telemetryQuery) {
        telemetryQuery = JSONFunctions.deserialize(
          alert?.telemetryQuery as any,
        ) as any;
      }

      if (alert?.alertSeverity) {
        setSeverity({
          name: alert.alertSeverity.name || "Unknown",
          color: alert.alertSeverity.color || Black,
        });
      } else {
        setSeverity(undefined);
      }

      setIsPrivate(alert?.isPrivate || false);

      setAlertTitle(alert?.title || undefined);

      setEventNumber(
        alert?.alertNumberWithPrefix ||
          (alert?.alertNumber ? "#" + alert.alertNumber : undefined),
      );

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

  type GetTimelineDateFunction = (
    stateId: string | undefined,
  ) => Date | undefined;

  // Last timeline entry for a state (e.g. the final acknowledgement).
  const getLastTimelineDateForState: GetTimelineDateFunction = (
    stateId: string | undefined,
  ): Date | undefined => {
    if (!stateId) {
      return undefined;
    }

    const entries: Array<AlertStateTimeline> = alertStateTimeline.filter(
      (timeline: AlertStateTimeline) => {
        return timeline.alertStateId?.toString() === stateId;
      },
    );

    return entries[entries.length - 1]?.startsAt;
  };

  // First timeline entry for a state (e.g. the first resolution).
  const getFirstTimelineDateForState: GetTimelineDateFunction = (
    stateId: string | undefined,
  ): Date | undefined => {
    if (!stateId) {
      return undefined;
    }

    return alertStateTimeline.find((timeline: AlertStateTimeline) => {
      return timeline.alertStateId?.toString() === stateId;
    })?.startsAt;
  };

  type getTimeFunction = () => string;

  const getTimeToAcknowledge: getTimeFunction = (): string => {
    const alertStartTime: Date = alertStateTimeline[0]?.startsAt || new Date();

    const acknowledgeTime: Date | undefined = getLastTimelineDateForState(
      getAcknowledgeState()?._id?.toString(),
    );

    const resolveTime: Date | undefined = getFirstTimelineDateForState(
      getResolvedState()?._id?.toString(),
    );

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

    const resolveTime: Date | undefined = getFirstTimelineDateForState(
      getResolvedState()?._id?.toString(),
    );

    if (!resolveTime) {
      return (
        "Not yet " + (getResolvedState()?.name?.toLowerCase() || "resolved")
      );
    }

    return OneUptimeDate.convertMinutesToDaysHoursAndMinutes(
      OneUptimeDate.getDifferenceInMinutes(resolveTime, alertStartTime),
    );
  };

  return (
    <Fragment>
      <div className="mb-5">
        <ChangeAlertState
          alertId={modelId}
          eventNumber={eventNumber}
          title={alertTitle}
          severity={severity}
          isPrivate={isPrivate}
          onActionComplete={async () => {
            await fetchData();
          }}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <EventStatTile
              label={`${getAcknowledgeState()?.name || "Acknowledged"} in`}
              icon={IconProp.Check}
              value={getTimeToAcknowledge()}
            />
            <EventStatTile
              label={`${getResolvedState()?.name || "Resolved"} in`}
              icon={IconProp.CheckCircle}
              value={getTimeToResolve()}
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
                  chartCssClass="rounded-lg border border-gray-200 shadow-sm"
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
                query={
                  telemetryQuery.telemetryQuery as Query<ExceptionInstance>
                }
              />
            )}

          <AlertAffectedResources alertId={modelId} />

          <EntityRunbooks alertId={modelId} hideIfEmpty={true} />

          <InvestigationPanel subjectType="alert" subjectId={modelId} />

          <AlertFeedElement alertId={modelId} />
        </div>

        <div className="min-w-0 xl:col-span-1">
          {/* Alert View  */}
          <CardModelDetail<Alert>
            name="Alert Details"
            cardProps={{
              title: "Alert Details",
              description: "Here are more details for this alert.",
            }}
            isEditable={true}
            onSaveSuccess={() => {
              // refresh page-level state (severity/visibility pills) shown in the status panel above.
              fetchData().catch((err: Error) => {
                setError(BaseAPI.getFriendlyMessage(err));
              });
            }}
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
              {
                field: {
                  isPrivate: true,
                },
                title: "Private Alert",
                stepId: "alert-details",
                description:
                  "If enabled, only the alert's owner users and members of its owner teams (plus project admins and owners) can view this alert.",
                fieldType: FormFieldSchemaType.Toggle,
                required: false,
              },
            ]}
            modelDetailProps={{
              selectMoreFields: {
                alertNumberWithPrefix: true,
                isPrivate: true,
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
              showDetailsInNumberOfColumns: 1,
              modelType: Alert,
              id: "model-detail-alerts",
              fields: [
                {
                  field: {
                    alertNumber: true,
                    alertNumberWithPrefix: true,
                  },
                  title: "Alert Number",
                  fieldType: FieldType.Element,
                  getElement: (item: Alert): ReactElement => {
                    if (!item.alertNumber) {
                      return <>-</>;
                    }

                    return (
                      <span className="font-medium text-gray-900">
                        {item.alertNumberWithPrefix || `#${item.alertNumber}`}
                      </span>
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
                  /*
                   * Alert.monitor is a singular relation set at creation, so it
                   * gets its own row separate from the multi-resource picker.
                   */
                  field: {
                    monitor: {
                      name: true,
                      _id: true,
                    },
                  },
                  title: "Monitor",
                  fieldType: FieldType.Element,
                  getElement: (item: Alert): ReactElement => {
                    return <MonitorElement monitor={item["monitor"]!} />;
                  },
                },
                {
                  field: {
                    alertEpisode: {
                      title: true,
                      _id: true,
                    },
                  },
                  title: "Episode",
                  fieldType: FieldType.Element,
                  getElement: (item: Alert): ReactElement => {
                    if (item.alertEpisode) {
                      return (
                        <AlertEpisodeElement alertEpisode={item.alertEpisode} />
                      );
                    }
                    return (
                      <span className="text-gray-400">
                        Not part of an episode
                      </span>
                    );
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

          <CardModelDetail<Alert>
            name="Affected Resources"
            cardProps={{
              title: "Affected Resources",
              description:
                "Hosts, Kubernetes clusters, Docker hosts, and services affected by this alert.",
            }}
            isEditable={true}
            formFields={[
              {
                /*
                 * Alert.monitor is singular and set at creation; this picker
                 * edits only the ManyToMany affected resources.
                 */
                field: { hosts: true },
                title: "",
                description:
                  "Search and attach hosts, Kubernetes clusters, Docker hosts, or services affected by this alert.",
                fieldType: FormFieldSchemaType.CustomComponent,
                required: false,
                getCustomElement: (
                  values: FormValues<Alert>,
                  elementProps: CustomElementProps,
                ) => {
                  return (
                    <AffectedResourcesPicker
                      hosts={values.hosts as Array<Host>}
                      kubernetesClusters={
                        values.kubernetesClusters as Array<KubernetesCluster>
                      }
                      dockerHosts={values.dockerHosts as Array<DockerHost>}
                      podmanHosts={values.podmanHosts as Array<PodmanHost>}
                      services={values.services as Array<Service>}
                      resourceTypes={[
                        "Host",
                        "KubernetesCluster",
                        "DockerHost",
                        "PodmanHost",
                        "Service",
                      ]}
                      onChange={(payload: unknown) => {
                        elementProps.onChange?.(payload);
                      }}
                    />
                  );
                },
                onChange: (
                  value: unknown,
                  currentValues: FormValues<Alert>,
                  setNewFormValues: (values: FormValues<Alert>) => void,
                ) => {
                  if (isAffectedResourcesPayload(value)) {
                    const payload: typeof value = value;
                    queueMicrotask(() => {
                      setNewFormValues({
                        ...currentValues,
                        hosts: payload.hosts,
                        kubernetesClusters: payload.kubernetesClusters,
                        dockerHosts: payload.dockerHosts,
                        podmanHosts: payload.podmanHosts,
                        services: payload.services,
                      } as FormValues<Alert>);
                    });
                  }
                },
              },
              /*
               * Hidden registrations so ModelForm.getSelectFields includes
               * kubernetesClusters/dockerHosts/services.
               */
              {
                field: { kubernetesClusters: true },
                title: "",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                showIf: () => {
                  return false;
                },
              },
              {
                field: { dockerHosts: true },
                title: "",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                showIf: () => {
                  return false;
                },
              },
              {
                field: { podmanHosts: true },
                title: "",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                showIf: () => {
                  return false;
                },
              },
              {
                field: { services: true },
                title: "",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                showIf: () => {
                  return false;
                },
              },
            ]}
            modelDetailProps={{
              showDetailsInNumberOfColumns: 1,
              modelType: Alert,
              id: "model-detail-alert-affected-resources",
              fields: [
                {
                  field: {
                    hosts: {
                      name: true,
                      _id: true,
                    },
                    kubernetesClusters: {
                      name: true,
                      _id: true,
                    },
                    dockerHosts: {
                      name: true,
                      _id: true,
                    },
                    podmanHosts: {
                      name: true,
                      _id: true,
                    },
                    services: {
                      name: true,
                      _id: true,
                      serviceColor: true,
                    },
                  },
                  title: "",
                  fieldType: FieldType.Element,
                  getElement: (item: Alert): ReactElement => {
                    return (
                      <AffectedResourcesDisplay
                        hosts={item.hosts || []}
                        kubernetesClusters={item.kubernetesClusters || []}
                        dockerHosts={item.dockerHosts || []}
                        podmanHosts={item.podmanHosts || []}
                        services={item.services || []}
                        hideMonitors={true}
                      />
                    );
                  },
                },
              ],
              modelId: modelId,
            }}
          />
        </div>
      </div>
    </Fragment>
  );
};

export default AlertView;
