import DisabledWarning from "../../../Components/Monitor/DisabledWarning";
import PageComponentProps from "../../PageComponentProps";
import { Black } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import MonitorStatusEventDelete, {
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

    if (deleteLock.refusal === StatusEventDeleteRefusal.OnlyEvent) {
      return translator.translateText(
        "This is the monitor's only status event, so it can't be deleted: the monitor would have no status, and status pages would show it gray.",
      );
    }

    return translator.translateTemplate(
      "This is the monitor's oldest status event and it covers part of the last {{days}} days, so it can't be deleted: status pages would show that time gray.",
      {
        days: KEPT_STATUS_HISTORY_DAYS.toString(),
      },
    );
  };

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
                  : "No root cause. This monitor status could be created manually.",
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
                  : "No logs for this status event.",
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
        onBeforeCreate={(
          item: MonitorStatusTimeline,
        ): Promise<MonitorStatusTimeline> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.monitorId = modelId;
          item.projectId = new ObjectID(props.currentProject._id);
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Status Timeline",
          description:
            "Each status this monitor has been in, when it began and how long it lasted.",
        }}
        noItemsMessage={"No status timeline created for this monitor so far."}
        formFields={[
          {
            field: {
              monitorStatus: true,
            },
            title: "Monitor Status",
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
            fieldType: FormFieldSchemaType.DateTime,
            required: true,
            placeholder: "Starts At",
            getDefaultValue: () => {
              return OneUptimeDate.getCurrentDate();
            },
          },
        ]}
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
          description="What OneUptime recorded when this monitor changed to this status, such as the check that caused it."
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
