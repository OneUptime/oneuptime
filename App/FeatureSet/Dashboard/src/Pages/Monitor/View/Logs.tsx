import DisabledWarning from "../../../Components/Monitor/DisabledWarning";
import ProbeUtil from "../../../Utils/Probe";
import PageComponentProps from "../../PageComponentProps";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import Probe from "Common/Models/DatabaseModels/Probe";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import FieldType from "Common/UI/Components/Types/FieldType";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorLog from "Common/Models/AnalyticsModels/MonitorLog";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import useAsyncEffect from "use-async-effect";
import AnalyticsModelTable from "Common/UI/Components/ModelTable/AnalyticsModelTable";
import SummaryInfo from "../../../Components/Monitor/SummaryView/SummaryInfo";
import { JSONObject } from "Common/Types/JSON";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import ServerMonitorResponse from "Common/Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
} from "Common/Types/Monitor/MonitorEvaluationSummary";

const MonitorLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [showViewLogsModal, setShowViewLogsModal] = useState<boolean>(false);
  const [logs, setLogs] = useState<JSONObject>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [probes, setProbes] = useState<Array<Probe>>([]);

  const [error, setError] = useState<string>("");

  const fetchItem: PromiseVoidFunction = async (): Promise<void> => {
    // get item.
    setIsLoading(true);

    setError("");
    try {
      const item: Monitor | null = await ModelAPI.getItem({
        modelType: Monitor,
        id: modelId,
        select: {
          monitorType: true,
        },
      });

      if (!item) {
        setError(ExceptionMessages.MonitorNotFound);

        return;
      }

      setMonitorType(item.monitorType);

      // Fetch probes if this is a probeable monitor
      if (
        item.monitorType &&
        MonitorTypeHelper.isProbableMonitor(item.monitorType)
      ) {
        const fetchedProbes: Array<Probe> = await ProbeUtil.getAllProbes();
        setProbes(fetchedProbes);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  const [monitorType, setMonitorType] = useState<MonitorType | undefined>(
    undefined,
  );

  useAsyncEffect(async () => {
    // fetch the model
    await fetchItem();
  }, []);

  type GetProbeNameByIdFunction = (probeId: string | undefined) => string;

  const getProbeNameById: GetProbeNameByIdFunction = (
    probeId: string | undefined,
  ): string => {
    if (!probeId) {
      return "Unknown";
    }
    const probe: Probe | undefined = probes.find((p: Probe) => {
      return p._id?.toString() === probeId.toString();
    });
    return probe?.name?.toString() || "Unknown";
  };

  const isProbableMonitor: boolean = monitorType
    ? MonitorTypeHelper.isProbableMonitor(monitorType)
    : false;

  const getPageContent: GetReactElementFunction = (): ReactElement => {
    if (!monitorType || isLoading) {
      return <ComponentLoader />;
    }

    if (error) {
      return <ErrorMessage message={error} />;
    }

    if (monitorType === MonitorType.Manual) {
      return (
        <EmptyState
          id="monitoring-probes-empty-state"
          icon={IconProp.Logs}
          title={"No Logs Manual Monitors"}
          description={
            <>
              This is a manual monitor. It does not monitor anything and so, it
              cannot have any logs. You can have logs on other monitor types.{" "}
            </>
          }
        />
      );
    }

    return (
      <AnalyticsModelTable<MonitorLog>
        modelType={MonitorLog}
        userPreferencesKey="monitor-logs-table"
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          monitorId: modelId.toString(),
        }}
        id="probes-table"
        name="Monitor > Monitor Probes"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        selectMoreFields={{
          logBody: true,
        }}
        sortBy="time"
        sortOrder={SortOrder.Descending}
        cardProps={{
          title: "Monitor Logs",
          description: "Here are the latest logs for this resource.",
        }}
        noItemsMessage={
          "No logs found for this resource. Please check back later."
        }
        actionButtons={[
          {
            title: "View Summary",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.List,
            onClick: async (
              item: MonitorLog,
              onCompleteAction: VoidFunction,
            ) => {
              setLogs(item.logBody ? item.logBody : {});
              setShowViewLogsModal(true);

              onCompleteAction();
            },
          },
        ]}
        showRefreshButton={true}
        filters={[
          {
            field: {
              time: true,
            },
            type: FieldType.DateTime,
            title: "Monitored At",
          },
        ]}
        columns={[
          {
            field: {
              time: true,
            },

            title: "Monitored At",
            type: FieldType.DateTime,
          },
          // Conditionally add Probe column for probeable monitors
          ...(isProbableMonitor
            ? [
                {
                  field: {
                    logBody: true,
                  },
                  title: "Probe",
                  type: FieldType.Text,
                  getElement: (item: MonitorLog): ReactElement => {
                    const probeId: string | undefined = (
                      item.logBody as unknown as {
                        probeId?: string | undefined;
                      }
                    )?.probeId;

                    const probeName: string = getProbeNameById(probeId);

                    return (
                      <span className="text-sm text-gray-700">{probeName}</span>
                    );
                  },
                },
              ]
            : []),
          {
            field: {
              logBody: true,
            },
            title: "Evaluation Outcome",
            type: FieldType.Text,
            getElement: (item: MonitorLog): ReactElement => {
              const evaluationSummary: MonitorEvaluationSummary | undefined = (
                item.logBody as unknown as {
                  evaluationSummary?: MonitorEvaluationSummary | undefined;
                }
              )?.evaluationSummary;

              if (!evaluationSummary) {
                return (
                  <span className="text-sm text-gray-500">Not recorded</span>
                );
              }

              const metCriteria: MonitorEvaluationCriteriaResult | undefined =
                evaluationSummary.criteriaResults.find(
                  (criteria: MonitorEvaluationCriteriaResult) => {
                    return criteria.met;
                  },
                );

              if (metCriteria) {
                return (
                  <span className="text-sm text-gray-700">
                    Criteria met:{" "}
                    {metCriteria.criteriaName || "Unnamed criteria"}
                  </span>
                );
              }

              if (evaluationSummary.criteriaResults.length > 0) {
                return (
                  <span className="text-sm text-gray-700">No criteria met</span>
                );
              }

              return (
                <span className="text-sm text-gray-500">
                  Evaluations not available
                </span>
              );
            },
          },
        ]}
      />
    );
  };

  return (
    <Fragment>
      <DisabledWarning monitorId={modelId} />
      {getPageContent()}
      {showViewLogsModal && monitorType && (
        <Modal
          title={"Monitoring Summary"}
          description={"Here is the summary of this monitor."}
          isLoading={false}
          modalWidth={ModalWidth.Large}
          onSubmit={() => {
            setShowViewLogsModal(false);
          }}
          submitButtonText={"Close"}
          submitButtonStyleType={ButtonStyleType.NORMAL}
        >
          <SummaryInfo
            monitorType={monitorType!}
            probeMonitorResponses={[logs as unknown as ProbeMonitorResponse]}
            incomingMonitorRequest={logs as unknown as IncomingMonitorRequest}
            serverMonitorResponse={logs as unknown as ServerMonitorResponse}
            probeName={
              isProbableMonitor
                ? getProbeNameById(
                    (logs as unknown as { probeId?: string | undefined })
                      ?.probeId,
                  )
                : undefined
            }
            evaluationSummary={
              (
                logs as unknown as {
                  evaluationSummary?: MonitorEvaluationSummary | undefined;
                }
              ).evaluationSummary
            }
          />
        </Modal>
      )}
    </Fragment>
  );
};

export default MonitorLogs;
