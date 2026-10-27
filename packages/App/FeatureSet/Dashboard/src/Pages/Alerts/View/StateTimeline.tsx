import PageComponentProps from "../../PageComponentProps";
import { ALERT_FINAL_STATE } from "../../../Components/StateTimeline/StateTimelineFinalState";
import Color from "Common/Types/Color";
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
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import ModelStatusTimeline from "Common/UI/Components/StatusTimeline/ModelStatusTimeline";
import StatusTimelineViewSwitch, {
  StatusTimelineView,
  useStatusTimelineView,
} from "Common/UI/Components/StatusTimeline/StatusTimelineView";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import Pill from "Common/UI/Components/Pill/Pill";
import SimpleLogViewer from "Common/UI/Components/SimpleLogViewer/SimpleLogViewer";
import {
  getStateTimelineDurationColumn,
  getStateTimelineEndsAtColumn,
} from "Common/UI/Components/StateTimeline/StateTimelineColumns";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import ProjectUtil from "Common/UI/Utils/Project";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
import useStateTimelineRowDelete, {
  StateTimelineRowDeleteProps,
} from "../../../Components/StateTimeline/StateTimelineRowDelete";
import { StateTimelineRecord } from "Common/Utils/StateTimeline/StateTimelineRowDelete";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";

/*
 * What adding a state asks: the state, and when it began - now, unless it
 * began earlier. The timeline and the table ask the same.
 */
export const ALERT_STATE_TIMELINE_FORM_FIELDS: Array<
  ModelField<AlertStateTimeline>
> = [
  {
    field: {
      alertState: true,
    },
    title: "Alert Status",
    description: "The status the alert changed to.",
    fieldType: FormFieldSchemaType.Dropdown,
    required: true,
    placeholder: "Alert Status",
    dropdownModal: {
      type: AlertState,
      labelField: "name",
      valueField: "_id",
      sort: {
        order: SortOrder.Ascending,
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
    description: "When the alert changed to this status.",
    fieldType: FormFieldSchemaType.DateTime,
    required: true,
    placeholder: "Starts At",
    getDefaultValue: () => {
      return OneUptimeDate.getCurrentDate();
    },
  },
];

const NO_ROOT_CAUSE_TEXT: string = translationKey("No root cause identified.");
const NO_LOGS_TEXT: string = translationKey("No logs for this state event.");
const LOGS_DESCRIPTION: string = translationKey(
  "What OneUptime recorded when this alert changed to this status, such as the monitor check that caused it.",
);

const AlertViewStateTimeline: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  /*
   * The alert's only state can't be deleted, and every other row's Delete
   * says what deleting it does (StateTimelineRowDelete).
   */
  const stateRowDelete: StateTimelineRowDeleteProps<AlertStateTimeline> =
    useStateTimelineRowDelete<AlertStateTimeline>({
      record: StateTimelineRecord.Alert,
      modelType: AlertStateTimeline,
      recordIdColumn: "alertId",
      recordId: modelId,
      stateColumn: "alertState",
    });
  const [showViewLogsModal, setShowViewLogsModal] = useState<boolean>(false);
  const [logs, setLogs] = useState<string>("");

  const [showRootCause, setShowRootCause] = useState<boolean>(false);
  const [rootCause, setRootCause] = useState<string>("");

  const onBeforeCreate: (
    item: AlertStateTimeline,
  ) => Promise<AlertStateTimeline> = (
    item: AlertStateTimeline,
  ): Promise<AlertStateTimeline> => {
    if (!props.currentProject || !props.currentProject._id) {
      throw new BadDataException("Project ID cannot be null");
    }
    item.alertId = modelId;
    item.projectId = new ObjectID(props.currentProject._id);
    return Promise.resolve(item);
  };

  /*
   * The alert's states as a timeline (ModelStatusTimeline), fitted to its
   * whole life, with the table it used to be one click away.
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
      <ModelStatusTimeline<AlertStateTimeline>
        modelType={AlertStateTimeline}
        id="alert-status-timeline"
        name="Alert > State Timeline"
        title="State Timeline"
        description="Each state this alert has been in, when it began and how long it lasted."
        headerElement={viewSwitch}
        query={{
          alertId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        stateColumn="alertState"
        stateSelect={ALERT_FINAL_STATE.stateSelect}
        getFinalStateRule={ALERT_FINAL_STATE.getFinalStateRule}
        ariaLabel="State timeline of this alert"
        emptyMessage="No state recorded for this alert yet."
        isCreateable={true}
        formFields={ALERT_STATE_TIMELINE_FORM_FIELDS}
        onBeforeCreate={onBeforeCreate}
        singularName={stateRowDelete.singularName}
        isDeleteable={true}
        getDeleteDisabledReason={stateRowDelete.getDeleteDisabledReason}
        getDeleteConfirmation={stateRowDelete.getDeleteConfirmation}
        getItemName={stateRowDelete.getItemName}
        deleteConfirmationWarning={stateRowDelete.deleteConfirmationWarning}
        onFetchSuccess={stateRowDelete.onFetchSuccess}
        causeColumn="rootCause"
        noCauseText={NO_ROOT_CAUSE_TEXT}
        logColumn="stateChangeLog"
        logsDescription={LOGS_DESCRIPTION}
        logViewerTitle="Alert State Log"
        noLogsText={NO_LOGS_TEXT}
        showViewIdButton={true}
      />
    );
  }

  return (
    <Fragment>
      <ModelTable<AlertStateTimeline>
        modelType={AlertStateTimeline}
        id="table-alert-status-timeline"
        name="Alert > State Timeline"
        userPreferencesKey="alert-status-timeline-table"
        saveFilterProps={{
          tableId: "alert-status-timeline-table",
        }}
        isEditable={false}
        isDeleteable={true}
        getDeleteDisabledReason={stateRowDelete.getDeleteDisabledReason}
        getDeleteConfirmation={stateRowDelete.getDeleteConfirmation}
        getItemName={stateRowDelete.getItemName}
        singularName={stateRowDelete.singularName}
        pluralName={stateRowDelete.pluralName}
        deleteConfirmationWarning={stateRowDelete.deleteConfirmationWarning}
        onFetchSuccess={stateRowDelete.onFetchSuccess}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        query={{
          alertId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        selectMoreFields={{
          stateChangeLog: true,
          rootCause: true,
        }}
        actionButtons={[
          {
            title: "View Cause",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.TransparentCube,
            onClick: async (
              item: AlertStateTimeline,
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
              item: AlertStateTimeline,
              onCompleteAction: VoidFunction,
            ) => {
              setLogs(
                item["stateChangeLog"]
                  ? JSON.stringify(item["stateChangeLog"], null, 2)
                  : translator.translateText(NO_LOGS_TEXT) || NO_LOGS_TEXT,
              );
              setShowViewLogsModal(true);

              onCompleteAction();
            },
          },
        ]}
        onBeforeCreate={onBeforeCreate}
        cardProps={{
          title: "State Timeline",
          description:
            "Each state this alert has been in, when it began and how long it lasted.",
          rightElement: viewSwitch,
        }}
        noItemsMessage={"No state recorded for this alert yet."}
        sortBy="startsAt"
        sortOrder={SortOrder.Descending}
        formFields={ALERT_STATE_TIMELINE_FORM_FIELDS}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              alertState: {
                name: true,
              },
            },
            title: "Alert State",
            type: FieldType.Entity,
            filterEntityType: AlertState,
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
              alertState: {
                name: true,
                color: true,
              },
            },
            title: "Alert Status",
            type: FieldType.Text,

            getElement: (item: AlertStateTimeline): ReactElement => {
              if (!item["alertState"]) {
                throw new BadDataException("Alert Status not found");
              }

              return (
                <Pill
                  color={item["alertState"]["color"] as Color}
                  text={item["alertState"]["name"] as string}
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
          getStateTimelineEndsAtColumn<AlertStateTimeline>(),
          getStateTimelineDurationColumn<AlertStateTimeline>(),
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
          <SimpleLogViewer title="Alert State Log" height="500px">
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

export default AlertViewStateTimeline;
