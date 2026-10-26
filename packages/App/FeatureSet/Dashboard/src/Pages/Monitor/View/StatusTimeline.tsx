import DisabledWarning from "../../../Components/Monitor/DisabledWarning";
import {
  boldStartsAt,
  boldStateName,
} from "../../../Components/StateTimeline/StateTimelineRowDelete";
import PageComponentProps from "../../PageComponentProps";
import DeleteConsequenceParagraph from "Common/UI/Components/DeleteConfirmation/DeleteConsequenceParagraph";
import IrreversibleQuestion from "Common/UI/Components/DeleteConfirmation/IrreversibleQuestion";
import { Black } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import LessThanOrEqual from "Common/Types/BaseDatabase/LessThanOrEqual";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import ModelStatusTimeline from "Common/UI/Components/StatusTimeline/ModelStatusTimeline";
import StatusTimelineViewSwitch, {
  StatusTimelineView,
  useStatusTimelineView,
} from "Common/UI/Components/StatusTimeline/StatusTimelineView";
import TimeRange from "Common/Types/Time/TimeRange";
import { JSONObject } from "Common/Types/JSON";
import {
  DeleteConfirmation,
  ModalTableBulkDefaultActions,
} from "Common/UI/Components/ModelTable/BaseModelTable";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import MonitorStatusEventDelete, {
  StatusEventDeleteDecision,
  StatusEventDeleteRefusal,
} from "Common/Utils/Monitor/MonitorStatusEventDelete";
import { KEPT_STATUS_HISTORY_DAYS } from "Common/Types/StateTimeline/RowsKeptOnDelete";
import SimpleLogViewer from "Common/UI/Components/SimpleLogViewer/SimpleLogViewer";
import {
  getStateTimelineDurationColumn,
  getStateTimelineEndsAtColumn,
} from "Common/UI/Components/StateTimeline/StateTimelineColumns";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";

/*
 * What deleting one status event does to the rest of the timeline, as its
 * Delete dialog says it (MonitorStatusEventDelete.decide, the server's own
 * rule): the status before it becomes current again, or takes over its time,
 * or - an event that ended before anything a status page draws - nothing
 * anyone sees changes.
 */
type StatusEventDeleteEffect =
  | { kind: "previous-is-current-again"; previousStatus: string }
  | { kind: "previous-takes-over"; previousStatus: string }
  | { kind: "not-shown-anymore" };

/*
 * What adding a status event asks: the status, and when it began - now,
 * unless it began earlier. The timeline and the table ask the same.
 */
export const MONITOR_STATUS_EVENT_FORM_FIELDS: Array<
  ModelField<MonitorStatusTimeline>
> = [
  {
    field: {
      monitorStatus: true,
    },
    title: "Monitor Status",
    description: "The status the monitor changed to.",
    fieldType: FormFieldSchemaType.Dropdown,
    required: true,
    placeholder: "Monitor Status",
    dropdownModal: {
      type: MonitorStatus,
      labelField: "name",
      valueField: "_id",
      sort: {
        priority: SortOrder.Ascending,
      },
    },
  },
  {
    field: {
      startsAt: true,
    },
    title: "Starts At",
    /*
     * Its own words, not the column's: the column's are written for the
     * API, and speak of correcting a time that a new row does not have yet.
     */
    description: "When the monitor changed to this status.",
    fieldType: FormFieldSchemaType.DateTime,
    required: true,
    placeholder: "Starts At",
    getDefaultValue: () => {
      return OneUptimeDate.getCurrentDate();
    },
  },
];

const NO_ROOT_CAUSE_TEXT: string = translationKey(
  "No root cause. This monitor status could be created manually.",
);
const NO_LOGS_TEXT: string = translationKey("No logs for this status event.");
const STATUS_EVENT_DELETE_QUESTION: string = translationKey(
  "Are you sure you want to delete the {{status}} status event that started {{startsAt}}?",
);
const LOGS_DESCRIPTION: string = translationKey(
  "What OneUptime recorded when this monitor changed to this status, such as the check that caused it.",
);

/*
 * How serious a monitor status is, for the timeline: its priority (higher
 * is worse), so a cluster of short changes shows the worst of them.
 */
const getMonitorStatusRank: (state: JSONObject) => number | undefined = (
  state: JSONObject,
): number | undefined => {
  return typeof state["priority"] === "number" ? state["priority"] : undefined;
};

// A status event's start, as the table's Starts At column shows it.
const formatStartsAt: (event: MonitorStatusTimeline) => string = (
  event: MonitorStatusTimeline,
): string => {
  return event.startsAt
    ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        event.startsAt,
        false,
      )
    : "";
};

const StatusTimeline: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [showViewLogsModal, setShowViewLogsModal] = useState<boolean>(false);
  const [logs, setLogs] = useState<string>("");

  const [showRootCause, setShowRootCause] = useState<boolean>(false);
  const [rootCause, setRootCause] = useState<string>("");

  const translator: Translator = useTranslator();

  /*
   * The one event a delete would be refused for - the monitor's only event,
   * or its oldest while it covers part of the last 90 days - so its Delete is
   * locked, saying why, instead of failing once clicked
   * (MonitorStatusEventDelete). Read from the monitor's two oldest events,
   * whatever the table shows, each time the table loads: a delete or a new
   * event can move it.
   */
  const [deleteLock, setDeleteLock] = useState<{
    eventId: string;
    refusal: StatusEventDeleteRefusal;
  } | null>(null);

  const loadDeleteLock: () => Promise<void> = async (): Promise<void> => {
    try {
      const oldest: ListResult<MonitorStatusTimeline> =
        await ModelAPI.getList<MonitorStatusTimeline>({
          modelType: MonitorStatusTimeline,
          query: {
            monitorId: modelId,
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          limit: 2,
          skip: 0,
          select: {
            _id: true,
            startsAt: true,
            endsAt: true,
          },
          sort: {
            startsAt: SortOrder.Ascending,
          },
        });

      setDeleteLock(
        MonitorStatusEventDelete.getLockedOldestEvent({
          oldestEvents: oldest.data.map((event: MonitorStatusTimeline) => {
            return {
              id: (event._id || event.id?.toString() || "").toLowerCase(),
              startsAt: event.startsAt,
              endsAt: event.endsAt,
            };
          }),
          eventCount: oldest.count,
          now: OneUptimeDate.getCurrentDate(),
        }),
      );
    } catch {
      // Nothing is locked; the server still refuses that delete, saying why.
      setDeleteLock(null);
    }
  };

  /*
   * Why a delete is refused, in the words the server refuses it with
   * (ONLY_STATUS_EVENT_MESSAGE and OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_TEMPLATE,
   * held to these by MonitorStatusTimelineDeleteLock), so the tooltip, a bulk
   * Delete's list of what it skipped and the API all read the same.
   */
  const getRefusalReason: (refusal: StatusEventDeleteRefusal) => string = (
    refusal: StatusEventDeleteRefusal,
  ): string => {
    if (refusal === StatusEventDeleteRefusal.OnlyEvent) {
      return (
        translator.translateText(
          "The monitor's only status event can't be deleted: the monitor would have no status, and status pages would show it gray. To change its status, add a new status event.",
        ) || ""
      );
    }

    return translator.translateTemplate(
      "The monitor's oldest status event can't be deleted while it covers part of the last {{days}} days: status pages would show that time gray. To replace it, add a status event that starts before it, then delete this one.",
      {
        days: KEPT_STATUS_HISTORY_DAYS.toString(),
      },
    );
  };

  const getDeleteDisabledReason: (
    item: MonitorStatusTimeline,
  ) => string | undefined = (
    item: MonitorStatusTimeline,
  ): string | undefined => {
    const itemId: string = (
      item._id ||
      item.id?.toString() ||
      ""
    ).toLowerCase();

    if (!deleteLock || !itemId || itemId !== deleteLock.eventId) {
      return undefined;
    }

    return getRefusalReason(deleteLock.refusal);
  };

  /*
   * A status's name as the table's status bubble shows it: a built-in
   * status (Operational, Offline) in the reader's language, a project's own
   * as it was typed.
   */
  const getStatusName: (status: MonitorStatus | undefined) => string = (
    status: MonitorStatus | undefined,
  ): string => {
    const name: string = status?.name?.toString() || "";

    return name ? translator.translateText(name) || name : "";
  };

  /*
   * A status event has no name of its own, and its id says nothing: where
   * the table names one row - its checkbox and ⋯ for a screen reader, the
   * rows a bulk Delete lists before and after it runs - it is its status and
   * when it began, as the row shows them.
   */
  const getStatusEventName: (event: MonitorStatusTimeline) => string = (
    event: MonitorStatusTimeline,
  ): string => {
    const status: string = getStatusName(event.monitorStatus);
    const startsAt: string = formatStartsAt(event);

    return status && startsAt ? `${status} (${startsAt})` : status || startsAt;
  };

  /*
   * What a delete of this event does to the rest of the timeline, read from
   * its two neighbours as the server reads them (MonitorStatusTimelineService
   * onBeforeDelete). Null when the neighbours can't be read: the dialog then
   * only asks, and the server still decides.
   */
  const getDeleteEffect: (
    event: MonitorStatusTimeline,
  ) => Promise<StatusEventDeleteEffect | null> = async (
    event: MonitorStatusTimeline,
  ): Promise<StatusEventDeleteEffect | null> => {
    const eventId: string = event._id || event.id?.toString() || "";

    if (!event.startsAt || !eventId) {
      return null;
    }

    const startsAt: Date = OneUptimeDate.fromString(event.startsAt);

    let before: MonitorStatusTimeline | null = null;
    let after: MonitorStatusTimeline | null = null;

    try {
      const [eventsBefore, eventsAfter]: [
        ListResult<MonitorStatusTimeline>,
        ListResult<MonitorStatusTimeline>,
      ] = await Promise.all([
        ModelAPI.getList<MonitorStatusTimeline>({
          modelType: MonitorStatusTimeline,
          query: {
            monitorId: modelId,
            projectId: ProjectUtil.getCurrentProjectId()!,
            startsAt: new LessThanOrEqual<Date>(startsAt),
            _id: new NotEqual<string>(eventId),
          },
          limit: 1,
          skip: 0,
          select: {
            _id: true,
            startsAt: true,
            endsAt: true,
            monitorStatus: {
              name: true,
            },
          },
          sort: {
            startsAt: SortOrder.Descending,
          },
        }),
        ModelAPI.getList<MonitorStatusTimeline>({
          modelType: MonitorStatusTimeline,
          query: {
            monitorId: modelId,
            projectId: ProjectUtil.getCurrentProjectId()!,
            startsAt: new GreaterThan<Date>(startsAt),
          },
          limit: 1,
          skip: 0,
          select: {
            _id: true,
            startsAt: true,
          },
          sort: {
            startsAt: SortOrder.Ascending,
          },
        }),
      ]);

      before = eventsBefore.data[0] || null;
      after = eventsAfter.data[0] || null;
    } catch {
      return null;
    }

    const decision: StatusEventDeleteDecision = MonitorStatusEventDelete.decide(
      {
        event: {
          startsAt: startsAt,
          endsAt: event.endsAt
            ? OneUptimeDate.fromString(event.endsAt)
            : event.endsAt,
        },
        before:
          before && (before._id || before.id)
            ? {
                id: new ObjectID((before._id || before.id)!.toString()),
                startsAt: before.startsAt
                  ? OneUptimeDate.fromString(before.startsAt)
                  : undefined,
                endsAt: before.endsAt
                  ? OneUptimeDate.fromString(before.endsAt)
                  : before.endsAt,
              }
            : null,
        after: after
          ? {
              startsAt: after.startsAt
                ? OneUptimeDate.fromString(after.startsAt)
                : undefined,
            }
          : null,
        // decide reads the count only to tell the only event apart.
        eventCount: 1 + (before ? 1 : 0) + (after ? 1 : 0),
        now: OneUptimeDate.getCurrentDate(),
      },
    );

    if (decision.kind === "refuse") {
      /*
       * The timeline changed since the table loaded it - this is now the
       * only event, or the oldest in the kept history. Say so instead of
       * asking: the server would refuse it.
       */
      throw new BadDataException(getRefusalReason(decision.refusal));
    }

    if (decision.kind === "history-starts-later") {
      return { kind: "not-shown-anymore" };
    }

    const previousStatus: string = getStatusName(before?.monitorStatus);

    if (!previousStatus) {
      return null;
    }

    return decision.endsAt === null
      ? { kind: "previous-is-current-again", previousStatus: previousStatus }
      : { kind: "previous-takes-over", previousStatus: previousStatus };
  };

  const getDeleteConfirmation: (
    event: MonitorStatusTimeline,
  ) => Promise<DeleteConfirmation> = async (
    event: MonitorStatusTimeline,
  ): Promise<DeleteConfirmation> => {
    const effect: StatusEventDeleteEffect | null = await getDeleteEffect(event);

    // What deleting it does to the rest of the timeline, when anything.
    const effectSentence: ReactElement | string | null =
      effect?.kind === "previous-is-current-again" ? (
        <TranslatedSentence
          template="{{status}}, the status before it, becomes the monitor's current status again."
          slots={{ status: boldStateName(effect.previousStatus) }}
        />
      ) : effect?.kind === "previous-takes-over" ? (
        <TranslatedSentence
          template="{{status}}, the status before it, takes over its time."
          slots={{ status: boldStateName(effect.previousStatus) }}
        />
      ) : effect?.kind === "not-shown-anymore" ? (
        translator.translateTemplate(
          "It ended more than {{days}} days ago, so status pages no longer show it.",
          { days: KEPT_STATUS_HISTORY_DAYS.toString() },
        )
      ) : null;

    /*
     * The question and that it cannot be undone, then what deleting it does
     * in a paragraph of its own - as the incident, alert, maintenance and
     * episode timelines' dialogs say it (StateTimelineRowDelete).
     */
    return {
      description: (
        <span data-testid="status-event-delete-confirmation">
          <IrreversibleQuestion
            template={STATUS_EVENT_DELETE_QUESTION}
            slots={{
              status: boldStateName(getStatusName(event.monitorStatus)),
              startsAt: boldStartsAt(formatStartsAt(event)),
            }}
          />
          {effectSentence ? (
            <DeleteConsequenceParagraph dataTestId="status-event-delete-effect">
              {effectSentence}
            </DeleteConsequenceParagraph>
          ) : (
            <></>
          )}
        </span>
      ),
    };
  };

  const onBeforeCreate: (
    item: MonitorStatusTimeline,
  ) => Promise<MonitorStatusTimeline> = (
    item: MonitorStatusTimeline,
  ): Promise<MonitorStatusTimeline> => {
    if (!props.currentProject || !props.currentProject._id) {
      throw new BadDataException("Project ID cannot be null");
    }
    item.monitorId = modelId;
    item.projectId = new ObjectID(props.currentProject._id);
    return Promise.resolve(item);
  };

  /*
   * The status history is a timeline (ModelStatusTimeline): a band drawn to
   * scale over a period - the last month first - and every status under it.
   * The table it used to be is one click away, for what only a table does:
   * selecting events to delete them together, filters, saved views and a
   * CSV export.
   */
  const [view, setView] = useStatusTimelineView();

  const viewSwitch: ReactElement = (
    <StatusTimelineViewSwitch
      key="status-timeline-view-switch"
      value={view}
      onChange={setView}
    />
  );

  if (view === StatusTimelineView.Timeline) {
    return (
      <Fragment>
        <DisabledWarning monitorId={modelId} />
        <ModelStatusTimeline<MonitorStatusTimeline>
          modelType={MonitorStatusTimeline}
          id="monitor-status-timeline"
          name="Monitor > Status Timeline"
          title="Status Timeline"
          description="Each status this monitor has been in, when it began and how long it lasted."
          headerElement={viewSwitch}
          query={{
            monitorId: modelId,
            projectId: ProjectUtil.getCurrentProjectId()!,
          }}
          stateColumn="monitorStatus"
          stateSelect={{ priority: true }}
          getStateRank={getMonitorStatusRank}
          defaultRange={TimeRange.PAST_ONE_MONTH}
          showShare={true}
          ariaLabel="Status timeline of this monitor"
          emptyMessage="No status recorded for this monitor yet."
          isCreateable={true}
          formFields={MONITOR_STATUS_EVENT_FORM_FIELDS}
          onBeforeCreate={onBeforeCreate}
          isDeleteable={true}
          getDeleteDisabledReason={getDeleteDisabledReason}
          getDeleteConfirmation={getDeleteConfirmation}
          getItemName={getStatusEventName}
          onFetchSuccess={() => {
            void loadDeleteLock();
          }}
          causeColumn="rootCause"
          noCauseText={NO_ROOT_CAUSE_TEXT}
          logColumn="statusChangeLog"
          logsDescription={LOGS_DESCRIPTION}
          noLogsText={NO_LOGS_TEXT}
          showViewIdButton={true}
        />
      </Fragment>
    );
  }

  return (
    <Fragment>
      <DisabledWarning monitorId={modelId} />
      <ModelTable<MonitorStatusTimeline>
        modelType={MonitorStatusTimeline}
        id="table-monitor-status-timeline"
        name="Monitor > Status Timeline"
        userPreferencesKey="monitor-status-timeline-table"
        saveFilterProps={{
          tableId: "monitor-status-timeline-table",
        }}
        isDeleteable={true}
        getDeleteDisabledReason={getDeleteDisabledReason}
        getDeleteConfirmation={getDeleteConfirmation}
        getItemName={getStatusEventName}
        bulkActions={{
          buttons: [ModalTableBulkDefaultActions.Delete],
          /*
           * A bulk Delete asks about several events at once, so it can't say
           * what each one does, as a row's Delete does. It says the rule:
           * deleting the newest event changes what the monitor shows now.
           */
          deleteConfirmationWarning: translationKey(
            "The status before each deleted event takes over its time, so deleting the newest one changes the monitor's current status.",
          ),
        }}
        onFetchSuccess={() => {
          void loadDeleteLock();
        }}
        showViewIdButton={true}
        isCreateable={true}
        isViewable={false}
        selectMoreFields={{
          statusChangeLog: true,
          rootCause: true,
        }}
        actionButtons={[
          {
            title: "View Cause",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.TransparentCube,
            onClick: async (
              item: MonitorStatusTimeline,
              onCompleteAction: VoidFunction,
            ) => {
              setRootCause(
                item["rootCause"]
                  ? item["rootCause"].toString()
                  : translator.translateText(NO_ROOT_CAUSE_TEXT) ||
                      NO_ROOT_CAUSE_TEXT,
              );
              setShowRootCause(true);

              onCompleteAction();
            },
          },
          {
            title: "View Logs",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.List,
            onClick: async (
              item: MonitorStatusTimeline,
              onCompleteAction: VoidFunction,
            ) => {
              setLogs(
                item["statusChangeLog"]
                  ? JSON.stringify(item["statusChangeLog"], null, 2)
                  : translator.translateText(NO_LOGS_TEXT) || NO_LOGS_TEXT,
              );
              setShowViewLogsModal(true);

              onCompleteAction();
            },
          },
        ]}
        query={{
          monitorId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        sortBy="startsAt"
        sortOrder={SortOrder.Descending}
        onBeforeCreate={onBeforeCreate}
        cardProps={{
          title: "Status Timeline",
          description:
            "Each status this monitor has been in, when it began and how long it lasted.",
          rightElement: viewSwitch,
        }}
        noItemsMessage={"No status timeline created for this monitor so far."}
        formFields={MONITOR_STATUS_EVENT_FORM_FIELDS}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              monitorStatus: {
                name: true,
              },
            },
            title: "Monitor Status",
            type: FieldType.Entity,
            filterEntityType: MonitorStatus,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              startsAt: true,
            },
            title: "Starts At",
            type: FieldType.Date,
          },
          {
            field: {
              endsAt: true,
            },
            title: "Ends At",
            type: FieldType.Date,
          },
        ]}
        columns={[
          {
            field: {
              monitorStatus: {
                name: true,
                color: true,
              },
            },
            title: "Monitor Status",
            type: FieldType.Text,
            getElement: (item: MonitorStatusTimeline): ReactElement => {
              if (!item["monitorStatus"]) {
                throw new BadDataException("Monitor Status not found");
              }

              return (
                <Statusbubble
                  color={item.monitorStatus.color || Black}
                  shouldAnimate={false}
                  text={item.monitorStatus.name || "Unknown"}
                />
              );
            },
          },
          {
            field: {
              startsAt: true,
            },
            title: "Starts At",
            type: FieldType.DateTime,
          },
          getStateTimelineEndsAtColumn<MonitorStatusTimeline>(),
          getStateTimelineDurationColumn<MonitorStatusTimeline>(),
        ]}
      />
      {showViewLogsModal ? (
        <Modal
          title={"Why did the status change?"}
          description={LOGS_DESCRIPTION}
          isLoading={false}
          modalWidth={ModalWidth.Large}
          onSubmit={() => {
            setShowViewLogsModal(false);
          }}
          submitButtonText={"Close"}
          submitButtonStyleType={ButtonStyleType.NORMAL}
        >
          <SimpleLogViewer title="Status Change Log" height="500px">
            {logs}
          </SimpleLogViewer>
        </Modal>
      ) : (
        <></>
      )}

      {showRootCause ? (
        <ConfirmModal
          title={"Root Cause"}
          description={
            <div>
              <MarkdownViewer text={rootCause} />
            </div>
          }
          isLoading={false}
          onSubmit={() => {
            setShowRootCause(false);
          }}
          submitButtonText={"Close"}
          submitButtonType={ButtonStyleType.NORMAL}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default StatusTimeline;
