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
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
} from "Common/Types/Monitor/MonitorEvaluationSummary";
import SyntheticMonitorResponse from "Common/Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import MonitorLogSummaryUtil, {
  INCOMING_EMAIL_NO_SUBJECT_LABEL,
  INCOMING_EMAIL_SCHEDULED_CHECK_LABEL,
  IncomingEmailLogEntry,
  IncomingEmailLogEntryKind,
} from "Common/Utils/Monitor/MonitorLogSummaryUtil";
import { MonitorSummaryInfoProps } from "Common/Utils/Monitor/MonitorSummarySnapshotUtil";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

const MonitorLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  // The row whose "View Summary" is open.
  const [selectedLog, setSelectedLog] = useState<MonitorLog | null>(null);
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

  const isSyntheticMonitor: boolean =
    monitorType === MonitorType.SyntheticMonitor;

  const isIncomingEmailMonitor: boolean =
    monitorType === MonitorType.IncomingEmail;

  type GetIncomingEmailCellFunction = (log: MonitorLog) => ReactElement;

  const getIncomingEmailCell: GetIncomingEmailCellFunction = (
    log: MonitorLog,
  ): ReactElement => {
    const entry: IncomingEmailLogEntry | null =
      MonitorLogSummaryUtil.getIncomingEmailLogEntry(log.logBody);

    if (!entry) {
      return <span className="text-sm text-gray-400">—</span>;
    }

    if (entry.kind === IncomingEmailLogEntryKind.ScheduledCheck) {
      return (
        <span className="text-sm text-gray-500">
          {INCOMING_EMAIL_SCHEDULED_CHECK_LABEL}
        </span>
      );
    }

    return (
      <div className="min-w-0">
        {entry.subject ? (
          <div className="text-sm text-gray-900 break-words">
            {entry.subject}
          </div>
        ) : (
          <div className="text-sm italic text-gray-500">
            {INCOMING_EMAIL_NO_SUBJECT_LABEL}
          </div>
        )}
        {entry.from ? (
          <div className="text-xs text-gray-500 break-all">{entry.from}</div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  type GetMaxAttemptsFunction = (logBody: unknown) => number;

  /*
   * For probeable monitors (Website/API/Ping/etc), totalAttempts is recorded directly
   * on the log body. Synthetic runs produce one SyntheticMonitorResponse per
   * browser × screen-size, each with its own retry history, so we surface the
   * highest attempt count across them. Historical log rows written before retry
   * tracking was added return 0.
   */
  const getMaxAttempts: GetMaxAttemptsFunction = (logBody: unknown): number => {
    const probeTotal: number | undefined = (
      logBody as { totalAttempts?: number | undefined }
    )?.totalAttempts;

    if (typeof probeTotal === "number" && probeTotal > 0) {
      return probeTotal;
    }

    const responses: Array<SyntheticMonitorResponse> | undefined = (
      logBody as { syntheticMonitorResponse?: Array<SyntheticMonitorResponse> }
    )?.syntheticMonitorResponse;

    if (!responses || responses.length === 0) {
      return 0;
    }

    return responses.reduce(
      (max: number, response: SyntheticMonitorResponse) => {
        return Math.max(max, response.totalAttempts || 1);
      },
      0,
    );
  };

  type GetSummaryInfoPropsFunction = (
    log: MonitorLog,
  ) => MonitorSummaryInfoProps;

  const getSummaryInfoProps: GetSummaryInfoPropsFunction = (
    log: MonitorLog,
  ): MonitorSummaryInfoProps => {
    return MonitorLogSummaryUtil.toSummaryInfoProps({
      monitorType: monitorType!,
      logBody: log.logBody,
      monitoredAt: log.time,
      probeName: isProbableMonitor
        ? getProbeNameById(MonitorLogSummaryUtil.getProbeId(log.logBody))
        : undefined,
    });
  };

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
              {translator.translateText(
                "This is a manual monitor. It does not monitor anything and so, it cannot have any logs. You can have logs on other monitor types.",
              )}
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
          description:
            "The result of every check of this monitor, newest first. View a summary to see what was checked and how the criteria judged it.",
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
              setSelectedLog(item);

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
          /*
           * Which email a row evaluated, so one can be found without
           * opening every row - or that the row is the worker's scheduled
           * check for missing email, which would otherwise read as its copy
           * of the last email arriving again.
           */
          ...(isIncomingEmailMonitor
            ? [
                {
                  field: {
                    logBody: true,
                  },
                  title: "Email",
                  type: FieldType.Text,
                  // Backed by the whole logBody: there is nothing to sort on.
                  disableSort: true,
                  // A subject is the sender's prose; it wraps, not widens.
                  wrapContent: true,
                  getElement: (item: MonitorLog): ReactElement => {
                    return getIncomingEmailCell(item);
                  },
                  getExportValue: (item: MonitorLog): string => {
                    return MonitorLogSummaryUtil.formatIncomingEmailLogEntry(
                      MonitorLogSummaryUtil.getIncomingEmailLogEntry(
                        item.logBody,
                      ),
                    );
                  },
                },
              ]
            : []),
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
                    const probeName: string = getProbeNameById(
                      MonitorLogSummaryUtil.getProbeId(item.logBody),
                    );

                    return (
                      <span className="text-sm text-gray-700">{probeName}</span>
                    );
                  },
                },
              ]
            : []),
          /*
           * Attempts column applies to any monitor type whose probe retries on
           * failure or slow response. Probeable monitors store totalAttempts at
           * the top level; synthetic runs nest it per browser × screen-size.
           */
          ...(isProbableMonitor || isSyntheticMonitor
            ? [
                {
                  field: {
                    logBody: true,
                  },
                  title: "Attempts",
                  type: FieldType.Text,
                  getElement: (item: MonitorLog): ReactElement => {
                    const maxAttempts: number = getMaxAttempts(item.logBody);

                    if (maxAttempts === 0) {
                      return <span className="text-sm text-gray-400">—</span>;
                    }

                    if (maxAttempts === 1) {
                      return (
                        <span className="text-sm text-gray-700">
                          {translator.translatePlural(
                            {
                              one: "{{count}} attempt",
                              other: "{{count}} attempts",
                            },
                            1,
                          )}
                        </span>
                      );
                    }

                    return (
                      <span className="inline-flex items-center rounded-md bg-yellow-50 px-2 py-1 text-xs font-medium text-yellow-800 ring-1 ring-inset ring-yellow-200">
                        {translator.translatePlural(
                          {
                            one: "{{count}} attempt",
                            other: "{{count}} attempts",
                          },
                          maxAttempts,
                        )}
                      </span>
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
            /*
             * Names an operator's criteria. Wrapping keeps a long name - or
             * the Email column beside it - from pushing View Summary off the
             * card.
             */
            wrapContent: true,
            getElement: (item: MonitorLog): ReactElement => {
              const evaluationSummary: MonitorEvaluationSummary | undefined = (
                item.logBody as unknown as {
                  evaluationSummary?: MonitorEvaluationSummary | undefined;
                }
              )?.evaluationSummary;

              if (!evaluationSummary) {
                return (
                  <span className="text-sm text-gray-500">
                    {translator.translateText("Not recorded")}
                  </span>
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
                    {translator.translateTemplate(
                      "Criteria met: {{criteria}}",
                      {
                        criteria:
                          metCriteria.criteriaName ||
                          translatableTerm("Unnamed criteria"),
                      },
                    )}
                  </span>
                );
              }

              if (evaluationSummary.criteriaResults.length > 0) {
                return (
                  <span className="text-sm text-gray-700">
                    {translator.translateText("No criteria met")}
                  </span>
                );
              }

              return (
                <span className="text-sm text-gray-500">
                  {translator.translateText("Evaluations not available")}
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
      {selectedLog && monitorType && (
        <Modal
          title={"Monitoring Summary"}
          isLoading={false}
          modalWidth={ModalWidth.Large}
          onSubmit={() => {
            setSelectedLog(null);
          }}
          submitButtonText={"Close"}
          submitButtonStyleType={ButtonStyleType.NORMAL}
        >
          <SummaryInfo {...getSummaryInfoProps(selectedLog)} />
        </Modal>
      )}
    </Fragment>
  );
};

export default MonitorLogs;
