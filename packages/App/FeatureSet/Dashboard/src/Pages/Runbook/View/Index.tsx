import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import IncidentElement from "../../../Components/Incident/Incident";
import AlertElement from "../../../Components/Alert/Alert";
import UserElement from "../../../Components/User/User";
import AppLink from "../../../Components/AppLink/AppLink";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Navigation from "Common/UI/Utils/Navigation";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { RUNBOOK_URL } from "Common/UI/Config";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import getLabelsFormField from "../../../Utils/Form/LabelsFormField";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import User from "Common/Models/DatabaseModels/User";
import Incident from "Common/Models/DatabaseModels/Incident";
import Alert from "Common/Models/DatabaseModels/Alert";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ProjectUtil from "Common/UI/Utils/Project";
import { JSONObject } from "Common/Types/JSON";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import Card from "Common/UI/Components/Card/Card";
import {
  Blue500,
  Gray500,
  Green500,
  Red500,
  Yellow500,
} from "Common/Types/BrandColors";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  translateTemplate,
  translateText,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  getRunbookRunGate,
  getRunbookRunLockedReason,
} from "../../../Components/Runbook/RunbookRunGate";
import {
  RUNBOOK_EXECUTION_TRIGGER_SELECT,
  UnattendedTriggerText,
  getUnattendedTriggerText,
} from "../../../Components/Runbook/Triggers/RunbookExecutionTrigger";
import {
  RUNBOOK_ADD_STEPS_BUTTON_TEST_ID,
  RUNBOOK_LAST_RUN_LINK_TEST_ID,
  RUNBOOK_LAST_RUN_TILE_TEST_ID,
  RUNBOOK_NO_STEPS_TEST_ID,
  RUNBOOK_TOTAL_RUNS_LINK_TEST_ID,
  RUNBOOK_TOTAL_RUNS_TILE_TEST_ID,
  RunbookOverviewCopy,
  RunbookOverviewFacts,
  getRunNowLockedReason,
  getRunbookOverviewFacts,
  isRunNowOffered,
} from "../../../Components/Runbook/RunbookOverviewState";
import RunbookTurnedOffBanner from "../../../Components/Runbook/RunbookTurnedOffBanner";
import RunbookTriggersSummaryElement, {
  RUNBOOK_TRIGGERS_SUMMARY_SELECT,
  RunbookTriggersSummaryCopy,
} from "../../../Components/Runbook/Triggers/RunbookTriggersSummary";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Link from "Common/UI/Components/Link/Link";

/*
 * The Activity card's tiles. Last Run and Total Runs are the Overview's way
 * to the runs, which the side menu keeps in its folded Logs section, so each
 * is a real link: its label, stretched over the whole tile (the pattern of
 * the Runbook Steps headers). The keyboard reaches it, a middle click opens
 * a new tab, and its focus ring draws round the tile. They used to be tiles
 * with a click handler, which the keyboard never reached, and which took a
 * click on the last run's incident or alert link to the run instead.
 */
const ACTIVITY_TILE_CLASS_NAME: string =
  "relative rounded-xl border border-gray-200 bg-white p-4";
const LINKED_ACTIVITY_TILE_CLASS_NAME: string = `${ACTIVITY_TILE_CLASS_NAME} hover:border-indigo-300 hover:shadow-sm transition`;
const ACTIVITY_TILE_LABEL_CLASS_NAME: string =
  "text-xs font-medium text-gray-500 uppercase tracking-wide mb-2";
const ACTIVITY_TILE_LINK_CLASS_NAME: string =
  "after:absolute after:inset-0 after:rounded-xl focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-indigo-500";
/*
 * What started the last run sits above the stretched link: its own link
 * (an incident, an alert, a maintenance event) opens what it names, and a
 * click on its words falls through to the run.
 */
const ABOVE_TILE_LINK_CLASS_NAME: string =
  "relative z-10 pointer-events-none [&_a]:pointer-events-auto";

function statusPill(status: RunbookExecutionStatus | undefined): ReactElement {
  switch (status) {
    case RunbookExecutionStatus.Completed:
      return <Pill text="Completed" color={Green500} isMinimal={true} />;
    case RunbookExecutionStatus.Failed:
      return <Pill text="Failed" color={Red500} isMinimal={true} />;
    case RunbookExecutionStatus.Running:
      return <Pill text="Running" color={Blue500} isMinimal={true} />;
    case RunbookExecutionStatus.WaitingForManualStep:
      return <Pill text="Waiting" color={Yellow500} isMinimal={true} />;
    case RunbookExecutionStatus.Cancelled:
      return <Pill text="Cancelled" color={Gray500} isMinimal={true} />;
    case RunbookExecutionStatus.Scheduled:
      return <Pill text="Scheduled" color={Gray500} isMinimal={true} />;
    default:
      return <Pill text="—" color={Gray500} isMinimal={true} />;
  }
}

function triggerSourceElement(
  execution: RunbookExecution,
  translator: Translator,
): ReactElement {
  // Its schedule, when it was due, or its webhook, and who called it.
  const unattended: UnattendedTriggerText | null = getUnattendedTriggerText(
    translator,
    execution,
  );

  if (unattended) {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-1.5 text-sm text-gray-700">
        <span className="text-gray-500">{unattended.label}</span>
        {unattended.details[0] ? <span>{unattended.details[0]}</span> : <></>}
      </span>
    );
  }

  if (execution.incident) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-gray-700">
        <span className="text-gray-500">{translateText("Incident:")}</span>
        <IncidentElement incident={execution.incident as Incident} />
      </span>
    );
  }
  if (execution.alert) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-gray-700">
        <span className="text-gray-500">{translateText("Alert:")}</span>
        <AlertElement alert={execution.alert as Alert} />
      </span>
    );
  }
  if (execution.scheduledMaintenance) {
    const sm: ScheduledMaintenance =
      execution.scheduledMaintenance as ScheduledMaintenance;
    if (sm._id) {
      return (
        <span className="inline-flex items-center gap-1 text-sm text-gray-700">
          <span className="text-gray-500">{translateText("Maintenance:")}</span>
          <AppLink
            className="hover:underline"
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW] as Route,
              { modelId: new ObjectID(sm._id as string) },
            )}
          >
            <span>{sm.title || translateText("View")}</span>
          </AppLink>
        </span>
      );
    }
    return (
      <span className="text-sm text-gray-700">
        {translateTemplate("Maintenance: {{title}}", {
          title: sm.title || "—",
        })}
      </span>
    );
  }
  if (execution.triggeredByUser) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-gray-700">
        <span className="text-gray-500">{translateText("Manual run by")}</span>
        <UserElement user={execution.triggeredByUser as User} />
      </span>
    );
  }
  return (
    <span className="text-sm text-gray-500">
      {translateText("Manual / unknown")}
    </span>
  );
}

interface OverviewStats {
  isLoaded: boolean;
  lastExecution: RunbookExecution | null;
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
}

const Overview: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(0);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [stats, setStats] = useState<OverviewStats>({
    isLoaded: false,
    lastExecution: null,
    totalRuns: 0,
    successRuns: 0,
    failedRuns: 0,
  });
  /*
   * Whether the runbook is turned on and has a step, read with its details:
   * null until it is (RunbookOverviewState).
   */
  const [facts, setFacts] = useState<RunbookOverviewFacts | null>(null);
  const [detailsRefresher, setDetailsRefresher] = useState<boolean>(false);

  const loadStats: () => Promise<void> = async (): Promise<void> => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!projectId) {
      return;
    }

    try {
      const baseQuery: { runbookId: ObjectID; projectId: ObjectID } = {
        runbookId: modelId,
        projectId,
      };

      const [lastExec, total, success, failed]: [
        ListResult<RunbookExecution>,
        number,
        number,
        number,
      ] = await Promise.all([
        ModelAPI.getList<RunbookExecution>({
          modelType: RunbookExecution,
          query: baseQuery,
          limit: 1,
          skip: 0,
          select: {
            _id: true,
            status: true,
            startedAt: true,
            completedAt: true,
            createdAt: true,
            failureReason: true,
            incident: { _id: true, title: true },
            alert: { _id: true, title: true },
            scheduledMaintenance: { _id: true, title: true },
            triggeredByUser: {
              _id: true,
              name: true,
              email: true,
              profilePictureId: true,
            },
            ...RUNBOOK_EXECUTION_TRIGGER_SELECT,
          },
          sort: {
            createdAt: SortOrder.Descending,
          },
        }),
        ModelAPI.count<RunbookExecution>({
          modelType: RunbookExecution,
          query: baseQuery,
        }),
        ModelAPI.count<RunbookExecution>({
          modelType: RunbookExecution,
          query: {
            ...baseQuery,
            status: RunbookExecutionStatus.Completed,
          },
        }),
        ModelAPI.count<RunbookExecution>({
          modelType: RunbookExecution,
          query: {
            ...baseQuery,
            status: RunbookExecutionStatus.Failed,
          },
        }),
      ]);

      setStats({
        isLoaded: true,
        lastExecution: lastExec.data[0] ?? null,
        totalRuns: total,
        successRuns: success,
        failedRuns: failed,
      });
    } catch {
      setStats((prev: OverviewStats) => {
        return { ...prev, isLoaded: true };
      });
    }
  };

  useEffect(() => {
    void loadStats();
  }, []);

  const runNow: () => Promise<void> = async (): Promise<void> => {
    setIsRunning(true);
    setError("");
    try {
      const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post<JSONObject>({
          url: URL.fromString(RUNBOOK_URL.toString()).addRoute(
            "/run/" + modelId.toString(),
          ),
          data: {},
          headers: ModelAPI.getCommonHeaders({}),
        });

      if (result instanceof HTTPErrorResponse) {
        throw result;
      }

      const runbookExecutionId: string | undefined = (
        result.data as JSONObject
      )?.["runbookExecutionId"] as string | undefined;

      if (runbookExecutionId) {
        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.RUNBOOK_VIEW_EXECUTION] as Route,
            {
              modelId,
              subModelId: runbookExecutionId,
            },
          ),
        );
      } else {
        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.RUNBOOK_VIEW_EXECUTIONS] as Route,
            { modelId },
          ),
        );
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsRunning(false);
    }
  };

  /*
   * Run Now is locked, saying why, for whoever holds none of the run
   * permissions - a Runbook Viewer or a Viewer reads the runbook and runs
   * nothing (Components/Runbook/RunbookRunGate) - and while the runbook is
   * turned off. It is not offered at all while the runbook has no step:
   * the Activity card offers Add Steps instead (RunbookOverviewState).
   */
  const runLockedReason: string | undefined = getRunNowLockedReason({
    permissionReason: getRunbookRunLockedReason(getRunbookRunGate()),
    facts: facts,
  });

  const goToSteps: () => void = () => {
    Navigation.navigate(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.RUNBOOK_VIEW_STEPS] as Route,
        { modelId },
      ),
    );
  };

  /*
   * A runbook with no step, and no run to show: the Activity card is its
   * first step instead of three cards of zeros. A runbook whose steps were
   * all removed after it ran keeps its activity, and the first step too.
   */
  const showsFirstStep: boolean = Boolean(facts && !facts.hasSteps);
  const showsActivity: boolean =
    !showsFirstStep || (stats.isLoaded && stats.totalRuns > 0);

  const lastExec: RunbookExecution | null = stats.lastExecution;
  const lastStartedAt: Date | undefined =
    lastExec?.startedAt || lastExec?.createdAt;

  /*
   * Where the Last Run and Total Runs tiles lead: the Overview's own way to
   * the runs, which the side menu keeps under its folded Logs section.
   */
  const lastRunRoute: Route | null = lastExec?._id
    ? RouteUtil.populateRouteParams(
        RouteMap[PageMap.RUNBOOK_VIEW_EXECUTION] as Route,
        { modelId, subModelId: lastExec._id.toString() },
      )
    : null;
  const executionsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.RUNBOOK_VIEW_EXECUTIONS] as Route,
    { modelId },
  );

  return (
    <Fragment>
      {facts?.isTurnedOff ? (
        <RunbookTurnedOffBanner
          runbookId={modelId}
          onTurnedOn={() => {
            setFacts((current: RunbookOverviewFacts | null) => {
              return current ? { ...current, isTurnedOff: false } : current;
            });
            setDetailsRefresher((current: boolean): boolean => {
              return !current;
            });
          }}
        />
      ) : (
        <></>
      )}

      <CardModelDetail<Runbook>
        name="Runbook > Overview"
        refresher={detailsRefresher}
        cardProps={{
          title: "Runbook",
          buttons: isRunNowOffered(facts)
            ? [
                {
                  title: isRunning ? "Starting..." : "Run Now",
                  buttonStyle: ButtonStyleType.PRIMARY,
                  icon: IconProp.Play,
                  onClick: () => {
                    void runNow();
                  },
                  disabled: isRunning || Boolean(runLockedReason),
                  tooltip: runLockedReason,
                },
              ]
            : [],
        }}
        isEditable={true}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Database failover runbook",
            validation: { minLength: 2 },
          },
          {
            field: { description: true },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "What this runbook is for and when it should be triggered.",
          },
          getLabelsFormField<Runbook>(),
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: Runbook,
          id: "model-detail-runbook-overview",
          /*
           * What the Overview offers first: whether it is on, and has a
           * step - and what starts it on its own (its Triggers page is in
           * the menu's folded Settings section).
           */
          selectMoreFields: {
            steps: true,
            isEnabled: true,
            ...RUNBOOK_TRIGGERS_SUMMARY_SELECT,
          },
          onItemLoaded: (item: Runbook): void => {
            setFacts(getRunbookOverviewFacts(item));
          },
          fields: [
            {
              field: { _id: true },
              title: "Runbook ID",
              fieldType: FieldType.ObjectID,
            },
            { field: { name: true }, title: "Name" },
            { field: { description: true }, title: "Description" },
            {
              field: { isEnabled: true },
              title: "Enabled",
              fieldType: FieldType.Element,
              getElement: (item: Runbook): ReactElement => {
                if (item.isEnabled) {
                  return (
                    <Pill text="Enabled" color={Green500} isMinimal={true} />
                  );
                }
                return <Pill text="Disabled" color={Red500} isMinimal={true} />;
              },
            },
            {
              /*
               * Whether a schedule or the webhook starts it, or neither -
               * and where that is changed.
               */
              field: { isScheduleEnabled: true },
              title: RunbookTriggersSummaryCopy.title,
              fieldType: FieldType.Element,
              getElement: (item: Runbook): ReactElement => {
                return (
                  <RunbookTriggersSummaryElement
                    runbookId={modelId}
                    runbook={item}
                  />
                );
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
              getElement: (item: Runbook): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
          ],
          modelId,
        }}
      />

      {showsFirstStep && !showsActivity ? (
        <Card title="Activity">
          <div data-testid={RUNBOOK_NO_STEPS_TEST_ID}>
            <EmptyState
              id="runbook-no-steps"
              title={RunbookOverviewCopy.noStepsTitle}
              description={RunbookOverviewCopy.noStepsDescription}
              icon={IconProp.List}
              paddingClassName="py-8"
              footer={
                /*
                 * Button keeps a dialog footer's left margin (md:ml-3), which
                 * would push it off the centre here, so its wrapper clears it.
                 */
                <div className="[&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0">
                  <Button
                    title={RunbookOverviewCopy.addStepsButton}
                    icon={IconProp.Add}
                    buttonStyle={ButtonStyleType.PRIMARY}
                    dataTestId={RUNBOOK_ADD_STEPS_BUTTON_TEST_ID}
                    onClick={goToSteps}
                  />
                </div>
              }
            />
          </div>
        </Card>
      ) : (
        <Card
          title="Activity"
          description="Recent execution history for this runbook."
        >
          {showsFirstStep ? (
            <div
              className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 px-4 py-3"
              data-testid={RUNBOOK_NO_STEPS_TEST_ID}
            >
              <p className="text-sm text-gray-700">
                {translator.translateText(
                  RunbookOverviewCopy.noStepsDescription,
                )}
              </p>
              <div className="ml-auto shrink-0">
                <Button
                  title={RunbookOverviewCopy.addStepsButton}
                  icon={IconProp.Add}
                  buttonStyle={ButtonStyleType.NORMAL}
                  dataTestId={RUNBOOK_ADD_STEPS_BUTTON_TEST_ID}
                  onClick={goToSteps}
                />
              </div>
            </div>
          ) : (
            <></>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div
              className={
                lastRunRoute
                  ? LINKED_ACTIVITY_TILE_CLASS_NAME
                  : ACTIVITY_TILE_CLASS_NAME
              }
              data-testid={RUNBOOK_LAST_RUN_TILE_TEST_ID}
            >
              <div className={ACTIVITY_TILE_LABEL_CLASS_NAME}>
                {lastRunRoute ? (
                  <Link
                    to={lastRunRoute}
                    className={ACTIVITY_TILE_LINK_CLASS_NAME}
                    dataTestId={RUNBOOK_LAST_RUN_LINK_TEST_ID}
                  >
                    {translator.translateText("Last Run")}
                  </Link>
                ) : (
                  translator.translateText("Last Run")
                )}
              </div>
              {!stats.isLoaded ? (
                <div className="text-sm text-gray-400">
                  {translator.translateText("Loading…")}
                </div>
              ) : lastExec ? (
                <div className="flex flex-col gap-1">
                  <div>
                    {statusPill(lastExec.status as RunbookExecutionStatus)}
                  </div>
                  <div className="text-sm text-gray-700">
                    {lastStartedAt ? OneUptimeDate.fromNow(lastStartedAt) : "—"}
                  </div>
                  <div className="text-xs text-gray-500">
                    {lastStartedAt
                      ? OneUptimeDate.getDateAsLocalFormattedString(
                          lastStartedAt,
                        )
                      : null}
                  </div>
                  <div className={`mt-1 ${ABOVE_TILE_LINK_CLASS_NAME}`}>
                    {triggerSourceElement(lastExec, translator)}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-500">
                  {/*
                   * Pointing at Run Now only while it can be pressed: a
                   * runbook that is off, or has no step, says what is
                   * missing elsewhere on the page.
                   */}
                  {isRunNowOffered(facts) && !runLockedReason ? (
                    <TranslatedSentence
                      template="Never run yet. Click {{runNow}} to start one."
                      slots={{
                        runNow: (
                          <span className="font-medium text-gray-700">
                            {translator.translateText("Run Now")}
                          </span>
                        ),
                      }}
                    />
                  ) : (
                    translator.translateText("Never run yet.")
                  )}
                </div>
              )}
            </div>

            <div
              className={LINKED_ACTIVITY_TILE_CLASS_NAME}
              data-testid={RUNBOOK_TOTAL_RUNS_TILE_TEST_ID}
            >
              <div className={ACTIVITY_TILE_LABEL_CLASS_NAME}>
                <Link
                  to={executionsRoute}
                  className={ACTIVITY_TILE_LINK_CLASS_NAME}
                  dataTestId={RUNBOOK_TOTAL_RUNS_LINK_TEST_ID}
                >
                  {translator.translateText("Total Runs")}
                </Link>
              </div>
              <div className="text-3xl font-semibold text-gray-900">
                {stats.isLoaded ? stats.totalRuns : "—"}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {translator.translateText("All executions on record")}
              </div>
            </div>

            <div className={ACTIVITY_TILE_CLASS_NAME}>
              <div className={ACTIVITY_TILE_LABEL_CLASS_NAME}>
                {translator.translateText("Outcomes")}
              </div>
              {/*
               * Wraps rather than running past the tile when the two
               * counts are long words ("3 abgeschlossen 1 fehlgeschlagen").
               */}
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                <div className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-green-500"></span>
                  <span className="font-semibold text-gray-900">
                    {stats.isLoaded ? stats.successRuns : "—"}
                  </span>
                  <span className="text-gray-500">
                    {translator.translateText("completed")}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-red-500"></span>
                  <span className="font-semibold text-gray-900">
                    {stats.isLoaded ? stats.failedRuns : "—"}
                  </span>
                  <span className="text-gray-500">
                    {translator.translateText("failed")}
                  </span>
                </div>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                {translator.translateText("Across all recorded executions")}
              </div>
            </div>
          </div>
        </Card>
      )}

      {error && (
        <ConfirmModal
          title="Could not start runbook"
          description={error}
          submitButtonText="Close"
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={() => {
            setError("");
          }}
        />
      )}
    </Fragment>
  );
};

export default Overview;
