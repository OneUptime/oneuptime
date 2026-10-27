import AppLink from "../../../Components/AppLink/AppLink";
import IncidentView from "../../../Components/Incident/Incident";
import UserElement from "../../../Components/User/User";
import OnCallPolicyView from "../OnCallPolicy";
import { Blue, Green, Red, Yellow } from "Common/Types/BrandColors";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { isOnCallDirectPage } from "Common/Types/OnCallDutyPolicy/OnCallDirectPage";
import {
  ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN,
  isOnCallPageAgainRun,
} from "Common/Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { OnCallPolicyAiHoldOutcome } from "Common/Types/OnCallDutyPolicy/OnCallPolicyAiHold";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import Columns from "Common/UI/Components/ModelTable/Columns";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import DirectPageLabel from "Common/UI/Components/OnCallDirectPage/DirectPageLabel";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Query from "Common/Types/BaseDatabase/Query";
import ProjectUtil from "Common/UI/Utils/Project";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Incident from "Common/Models/DatabaseModels/Incident";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import React, { FunctionComponent, ReactElement, useState } from "react";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertView from "../../../Components/Alert/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertEpisodeView from "../../../Components/AlertEpisode/AlertEpisode";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeView from "../../../Components/IncidentEpisode/IncidentEpisode";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * The two columns that hold what people wrote wrap their text: "Policy
 * Name" - a policy's name or, for a direct page, the workflow that started
 * it - and "Triggered By", the title of the incident, alert or episode. A
 * table cell stays on one line unless its column says otherwise, so one long
 * name or title took the row's width for itself, and when the run was
 * triggered and how it stands began past the card's right edge.
 *
 * Each has a cap, so it wraps before it crowds the columns after it.
 */
export const ON_CALL_LOGS_NAME_COLUMN_MAX_WIDTH_CLASS_NAME: string = "max-w-xs";
export const ON_CALL_LOGS_TRIGGERED_BY_COLUMN_MAX_WIDTH_CLASS_NAME: string =
  "max-w-sm";

/*
 * And "Triggered By" has a floor. Beside the side menu on a laptop the
 * table is short of room, and a column that may wrap is then given the
 * least it can take: without a floor that is its longest word, and a title
 * folded to a word or two a line.
 */
export const ON_CALL_LOGS_TRIGGERED_BY_COLUMN_MIN_WIDTH_CLASS_NAME: string =
  "min-w-[12rem]";

/*
 * Under a waiting run's pill: what it waits for, and when paging starts. It
 * wraps at about a pill's width rather than widening the Status column, and
 * pushing it under the row's actions, on one long line.
 */
export const ON_CALL_LOGS_WAITING_MESSAGE_CLASS_NAME: string =
  "mt-1 max-w-[14rem] whitespace-normal text-xs text-gray-500";

/*
 * How a hold OneUptime AI kept while it worked ended (OnCallPolicyAiHold),
 * under the run's status. A run still held says so in its waiting message.
 */
export const ON_CALL_LOGS_AI_HOLD_OUTCOMES: Record<
  Exclude<OnCallPolicyAiHoldOutcome, OnCallPolicyAiHoldOutcome.Holding>,
  string
> = {
  [OnCallPolicyAiHoldOutcome.ResolvedByAI]: translationKey(
    "Resolved by OneUptime AI. Nobody was paged.",
  ),
  [OnCallPolicyAiHoldOutcome.RecoveredOnItsOwn]: translationKey(
    "Recovered on its own while OneUptime AI held the page.",
  ),
  [OnCallPolicyAiHoldOutcome.HandledByPerson]: translationKey(
    "Handled by a person while OneUptime AI held the page.",
  ),
  [OnCallPolicyAiHoldOutcome.HandedOff]: translationKey(
    "OneUptime AI handed it off.",
  ),
  [OnCallPolicyAiHoldOutcome.HoldTimeRanOut]: translationKey(
    "OneUptime AI's hold time ran out.",
  ),
  [OnCallPolicyAiHoldOutcome.PageNowPressed]: translationKey(
    "Page now was pressed while OneUptime AI held the page.",
  ),
};

/*
 * Under a page again's pill (OnCallAcknowledgementTimeout): that its policy
 * paged again because the record stayed acknowledged without being
 * resolved, and which time - "Paged again (1 of 5)". What sets the row apart
 * from the run before it, which paged about the same record.
 */
export const ON_CALL_LOGS_PAGED_AGAIN: string = translationKey(
  "Paged again ({{number}} of {{max}})",
);

/*
 * What a run that paged nobody says on hover. A policy went through its
 * escalation rules; a direct page has none, and names what it found empty.
 */
export const POLICY_PAGED_NOBODY_TOOLTIP: string = translationKey(
  "This execution ran to completion without notifying anyone. Usually every escalation rule targeted an on-call schedule that had nobody on call.",
);
export const DIRECT_PAGE_PAGED_NOBODY_TOOLTIP: string = translationKey(
  "This page reached nobody. Usually the on-call schedule had nobody on call, the team had no members, or the people it named were away.",
);

/*
 * What the empty list says. One policy's own logs are about that policy;
 * the project's, an incident's and an alert's list direct pages too, which
 * no policy ran.
 */
export const POLICY_HAS_NOT_RUN_MESSAGE: string = translationKey(
  "This policy has not executed so far.",
);
export const NOBODY_PAGED_YET_MESSAGE: string = translationKey(
  "Nobody has been paged so far.",
);

/*
 * A run's status, as a pill: green when it completed, amber while it pages
 * or when it paged nobody, blue while it waits, red when it failed.
 */
const getStatusPill: (item: OnCallDutyPolicyExecutionLog) => ReactElement = (
  item: OnCallDutyPolicyExecutionLog,
): ReactElement => {
  if (item["status"] === OnCallDutyPolicyStatus.Completed) {
    return <Pill color={Green} text={OnCallDutyPolicyStatus.Completed} />;
  } else if (
    item["status"] === OnCallDutyPolicyStatus.CompletedWithNoNotifications
  ) {
    /*
     * A completed execution that paged nobody is not a success. Rendering
     * it in the same green as a successful page is how a policy that
     * silently notified no one goes unnoticed for weeks.
     */
    return (
      <Pill
        color={Yellow}
        text={OnCallDutyPolicyStatus.CompletedWithNoNotifications}
        tooltip={
          isOnCallDirectPage(item)
            ? DIRECT_PAGE_PAGED_NOBODY_TOOLTIP
            : POLICY_PAGED_NOBODY_TOOLTIP
        }
      />
    );
  } else if (item["status"] === OnCallDutyPolicyStatus.Waiting) {
    /*
     * Paging nobody yet, on purpose: an on-call rule held it until
     * working hours (OnCallDutyPolicyRunWait). Its status message says
     * what it waits for and when paging starts - the words the
     * record's feed says too - so the row says it, not only a click
     * on View Status Message.
     */
    return (
      <div>
        <Pill color={Blue} text={OnCallDutyPolicyStatus.Waiting} />
        {item.statusMessage ? (
          <p
            className={ON_CALL_LOGS_WAITING_MESSAGE_CLASS_NAME}
            data-testid="execution-log-waiting-message"
          >
            {item.statusMessage}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  } else if (item["status"] === OnCallDutyPolicyStatus.Started) {
    return <Pill color={Yellow} text={OnCallDutyPolicyStatus.Started} />;
  } else if (item["status"] === OnCallDutyPolicyStatus.Scheduled) {
    return <Pill color={Yellow} text={OnCallDutyPolicyStatus.Scheduled} />;
  } else if (item["status"] === OnCallDutyPolicyStatus.Executing) {
    return <Pill color={Yellow} text={OnCallDutyPolicyStatus.Executing} />;
  }

  return <Pill color={Red} text={OnCallDutyPolicyStatus.Error} />;
};

export interface ComponentProps {
  onCallDutyPolicyId?: ObjectID | undefined; // if this is undefined. then it'll show logs for all policies.
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  alertEpisodeId?: ObjectID | undefined;
  incidentEpisodeId?: ObjectID | undefined;
}

const ExecutionLogsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [showViewStatusMessageModal, setShowViewStatusMessageModal] =
    useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");

  const query: Query<OnCallDutyPolicyExecutionLog> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
  };

  if (props.onCallDutyPolicyId) {
    query.onCallDutyPolicyId = props.onCallDutyPolicyId.toString();
  }

  if (props.incidentId) {
    query.triggeredByIncidentId = props.incidentId;
  }

  if (props.alertId) {
    query.triggeredByAlertId = props.alertId;
  }

  if (props.alertEpisodeId) {
    query.triggeredByAlertEpisodeId = props.alertEpisodeId;
  }

  if (props.incidentEpisodeId) {
    query.triggeredByIncidentEpisodeId = props.incidentEpisodeId;
  }

  let columns: Columns<OnCallDutyPolicyExecutionLog> = [];
  let filters: Array<Filter<OnCallDutyPolicyExecutionLog>> = [];

  if (!props.onCallDutyPolicyId) {
    // add a column for the policy name
    columns = columns.concat([
      {
        field: {
          onCallDutyPolicy: {
            name: true,
          },
        },
        title: "Policy Name",
        type: FieldType.Element,
        // A long name wraps inside the column rather than widening the table.
        wrapContent: true,
        wrapMaxWidthClassName: ON_CALL_LOGS_NAME_COLUMN_MAX_WIDTH_CLASS_NAME,
        getElement: (item: OnCallDutyPolicyExecutionLog): ReactElement => {
          if (item["onCallDutyPolicy"]) {
            return (
              <OnCallPolicyView
                onCallPolicy={item["onCallDutyPolicy"] as OnCallDutyPolicy}
              />
            );
          }

          /*
           * People paged with no on-call policy behind the page - a
           * workflow's Page step. The row says so, and what started it,
           * where another row names its policy.
           */
          if (isOnCallDirectPage(item)) {
            const workflowId: ObjectID | undefined = item.triggeredByWorkflowId;

            return (
              <DirectPageLabel
                workflowName={item.triggeredByWorkflowName}
                /*
                 * The workflow's name opens the workflow, as a policy's name
                 * opens the policy: it is where to change who is paged.
                 */
                renderWorkflowName={
                  workflowId
                    ? (workflowName: string): ReactElement => {
                        return (
                          <AppLink
                            className="hover:underline"
                            to={RouteUtil.populateRouteParams(
                              RouteMap[PageMap.WORKFLOW_BUILDER] as Route,
                              {
                                modelId: new ObjectID(workflowId.toString()),
                              },
                            )}
                          >
                            <span>{workflowName}</span>
                          </AppLink>
                        );
                      }
                    : undefined
                }
                startedBy={
                  item.triggeredByUser ? (
                    <UserElement user={item.triggeredByUser} />
                  ) : undefined
                }
              />
            );
          }

          return <p>{translator.translateText("No on-call policy.")}</p>;
        },
      },
    ]);

    filters = filters.concat([
      {
        title: "On Call Policy",
        type: FieldType.Entity,
        field: {
          onCallDutyPolicy: true,
        },
        filterEntityType: OnCallDutyPolicy,
        filterQuery: {
          projectId: ProjectUtil.getCurrentProjectId()!,
        },
        filterDropdownField: {
          label: "name",
          value: "_id",
        },
      },
    ]);
  }

  filters = filters.concat([
    {
      title: "Status",
      type: FieldType.Dropdown,
      field: {
        status: true,
      },
      filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
        OnCallDutyPolicyStatus,
      ),
    },
    {
      title: "Triggered at",
      type: FieldType.Date,
      field: {
        createdAt: true,
      },
    },
  ]);

  columns = columns.concat([
    {
      field: {
        triggeredByIncident: {
          title: true,
        },
        triggeredByAlertEpisode: {
          title: true,
        },
        triggeredByIncidentEpisode: {
          title: true,
        },
      },
      title: "Triggered By",
      type: FieldType.Element,
      // A long title wraps inside the column, which keeps a readable width.
      wrapContent: true,
      wrapMaxWidthClassName:
        ON_CALL_LOGS_TRIGGERED_BY_COLUMN_MAX_WIDTH_CLASS_NAME,
      contentClassName: ON_CALL_LOGS_TRIGGERED_BY_COLUMN_MIN_WIDTH_CLASS_NAME,
      getElement: (item: OnCallDutyPolicyExecutionLog): ReactElement => {
        if (item.triggeredByIncident) {
          return (
            <div>
              <p>{translator.translateText("Incident:")}</p>
              <IncidentView
                incident={item["triggeredByIncident"] as Incident}
              />
            </div>
          );
        }

        if (item.triggeredByAlert) {
          return (
            <div>
              <p>{translator.translateText("Alert:")}</p>
              <AlertView alert={item["triggeredByAlert"] as Alert} />
            </div>
          );
        }

        if (item.triggeredByAlertEpisode) {
          return (
            <div>
              <p>{translator.translateText("Alert Episode:")}</p>
              <AlertEpisodeView
                alertEpisode={item["triggeredByAlertEpisode"] as AlertEpisode}
              />
            </div>
          );
        }

        if (item.triggeredByIncidentEpisode) {
          return (
            <div>
              <p>{translator.translateText("Incident Episode:")}</p>
              <IncidentEpisodeView
                incidentEpisode={
                  item["triggeredByIncidentEpisode"] as IncidentEpisode
                }
              />
            </div>
          );
        }

        return <p>-</p>;
      },
    },
    {
      field: {
        createdAt: true,
      },
      title: "Triggered at",
      type: FieldType.DateTime,
    },
    {
      field: {
        status: true,
      },
      title: "Status",
      type: FieldType.Element,

      getElement: (item: OnCallDutyPolicyExecutionLog): ReactElement => {
        const status: ReactElement = getStatusPill(item);
        const aiHoldOutcome: string | undefined =
          item.aiHoldOutcome &&
          item.aiHoldOutcome !== OnCallPolicyAiHoldOutcome.Holding
            ? ON_CALL_LOGS_AI_HOLD_OUTCOMES[
                item.aiHoldOutcome as Exclude<
                  OnCallPolicyAiHoldOutcome,
                  OnCallPolicyAiHoldOutcome.Holding
                >
              ]
            : undefined;

        if (aiHoldOutcome) {
          return (
            <div>
              {status}
              <p
                className={ON_CALL_LOGS_WAITING_MESSAGE_CLASS_NAME}
                data-testid="execution-log-ai-hold-outcome"
              >
                {translator.translateText(aiHoldOutcome)}
              </p>
            </div>
          );
        }

        if (!isOnCallPageAgainRun(item)) {
          return status;
        }

        return (
          <div>
            {status}
            <p
              className={ON_CALL_LOGS_WAITING_MESSAGE_CLASS_NAME}
              data-testid="execution-log-paged-again"
            >
              {translator.translateTemplate(ON_CALL_LOGS_PAGED_AGAIN, {
                number: Number(item.pageAgainNumber),
                max: ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN,
              })}
            </p>
          </div>
        );
      },
    },
    {
      field: {
        acknowledgedByUser: {
          name: true,
          email: true,
        },
      },
      title: "Acknowledged By",
      type: FieldType.Element,
      getElement: (item: OnCallDutyPolicyExecutionLog): ReactElement => {
        if (item["acknowledgedByUser"]) {
          return <UserElement user={item["acknowledgedByUser"]} />;
        }

        return <p>-</p>;
      },
    },
  ]);

  return (
    <>
      <ModelTable<OnCallDutyPolicyExecutionLog>
        modelType={OnCallDutyPolicyExecutionLog}
        userPreferencesKey="on-call-policy-execution-logs-table"
        query={query}
        id="execution-logs-table"
        name="On-Call Policy > Logs"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        cardProps={{
          title: "On-Call Policy Logs",
          description:
            "Each time an on-call policy ran or people were paged directly: what triggered it and who acknowledged it. Open one to see every notification it sent and whether it was delivered.",
        }}
        selectMoreFields={{
          statusMessage: true,
          // How a hold OneUptime AI kept ended, under the status.
          aiHoldOutcome: true,
          // A page again says so under its status.
          pageAgainNumber: true,
          // Read with every row: a row with none is a direct page.
          onCallDutyPolicyId: true,
          // What started a direct page: a workflow, or a person.
          triggeredByWorkflowId: true,
          triggeredByWorkflowName: true,
          triggeredByUser: {
            name: true,
            email: true,
          },
          triggeredByAlert: {
            title: true,
          },
          triggeredByAlertEpisode: {
            title: true,
          },
          triggeredByIncidentEpisode: {
            title: true,
          },
        }}
        noItemsMessage={
          props.onCallDutyPolicyId
            ? POLICY_HAS_NOT_RUN_MESSAGE
            : NOBODY_PAGED_YET_MESSAGE
        }
        onViewPage={async (item: OnCallDutyPolicyExecutionLog) => {
          return RouteUtil.populateRouteParams(
            RouteMap[PageMap.ON_CALL_DUTY_EXECUTION_LOGS_TIMELINE]!,
            {
              modelId: item._id!.toString(),
            },
          );
        }}
        showRefreshButton={true}
        showViewIdButton={true}
        filters={filters}
        actionButtons={[
          {
            title: "View Status Message",
            icon: IconProp.Error,
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: async (
              item: OnCallDutyPolicyExecutionLog,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setStatusMessage(item["statusMessage"] as string);
                setShowViewStatusMessageModal(true);

                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]}
        viewButtonText={translationKey("View Timeline")}
        columns={columns}
      />

      {showViewStatusMessageModal ? (
        <ConfirmModal
          title={"Status Message"}
          description={statusMessage}
          submitButtonText={"Close"}
          onSubmit={async () => {
            setShowViewStatusMessageModal(false);
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default ExecutionLogsTable;
