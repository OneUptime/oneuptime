import PageComponentProps from "../../PageComponentProps";
import { STATE_SETTINGS_COPY } from "../../../Components/StateSettings/StateSettingsCopy";
import { getStateSettingsDeleteLockedReason } from "../../../Components/StateSettings/StateSettingsRows";
import {
  getStateSettingsColumns,
  getStateSettingsFormFields,
} from "../../../Components/StateSettings/StateSettingsTable";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  STATE_LISTS,
  StateListDefinition,
  StateListType,
} from "Common/Utils/StateOrder";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ModelListCache from "Common/UI/Utils/ModelListCache";
import Navigation from "Common/UI/Utils/Navigation";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import useArchivableValues, {
  ArchivableValues,
} from "../../../Components/ArchivableValue/UseArchivableValues";
import { ArchivableValueType } from "Common/Utils/ArchivableValues";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const DEFINITION: StateListDefinition =
  STATE_LISTS[StateListType.MonitorStatus];

/*
 * The project's monitor statuses, from the healthiest to the worst: dragged
 * into order (where monitors are shown together, the one lowest in the list
 * wins), and created and edited from the usual form. The operational and
 * offline statuses are built in - renamed, never deleted.
 */
const MonitorStatusesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // Archive and Unarchive, and the folded Archived section. See the hook.
  const archive: ArchivableValues<MonitorStatus> =
    useArchivableValues<MonitorStatus>({
      modelType: MonitorStatus,
      type: ArchivableValueType.MonitorStatus,
    });

  return (
    <Fragment>
      <ModelTable<MonitorStatus>
        modelType={MonitorStatus}
        query={archive.query}
        actionButtons={archive.actionButtons}
        getDeleteConfirmation={archive.getDeleteConfirmation}
        bulkActions={archive.bulkActions}
        refreshToggle={archive.refreshToggle}
        id="monitor-status-table"
        userPreferencesKey="monitor-status-table"
        name="Settings > Monitor Status"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        showViewIdButton={true}
        enableDragAndDrop={true}
        dragDropIndexField="priority"
        sortBy="priority"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: STATE_SETTINGS_COPY[StateListType.MonitorStatus].title,
          description:
            STATE_SETTINGS_COPY[StateListType.MonitorStatus].description,
        }}
        getDeleteDisabledReason={(item: MonitorStatus): string | undefined => {
          return getStateSettingsDeleteLockedReason({
            definition: DEFINITION,
            copy: STATE_SETTINGS_COPY[StateListType.MonitorStatus],
            item: item,
          });
        }}
        onFetchSuccess={() => {
          // Every monitor status picker reads the new list, not a cached one.
          ModelListCache.invalidate(MonitorStatus);
        }}
        selectMoreFields={{
          color: true,
          isOperationalState: true,
          isOfflineState: true,
        }}
        filters={[]}
        columns={getStateSettingsColumns<MonitorStatus>({
          definition: DEFINITION,
          copy: STATE_SETTINGS_COPY[StateListType.MonitorStatus],
          rows: [],
        })}
        viewPageRoute={Navigation.getCurrentRoute()}
        formFields={getStateSettingsFormFields<MonitorStatus>(
          STATE_SETTINGS_COPY[StateListType.MonitorStatus],
        )}
        showRefreshButton={true}
      />
      {archive.element}
    </Fragment>
  );
};

export default MonitorStatusesPage;
