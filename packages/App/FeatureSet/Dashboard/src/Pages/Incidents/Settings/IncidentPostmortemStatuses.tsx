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
import IncidentPostmortemStatus from "Common/Models/DatabaseModels/IncidentPostmortemStatus";
import useArchivableValues, {
  ArchivableValues,
} from "../../../Components/ArchivableValue/UseArchivableValues";
import { ArchivableValueType } from "Common/Utils/ArchivableValues";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const DEFINITION: StateListDefinition =
  STATE_LISTS[StateListType.IncidentPostmortemStatus];

/*
 * The project's postmortem statuses, in the order a postmortem comes along:
 * dragged into order, created and edited from the usual form, and each one
 * saying what a postmortem in it counts as - not started, in progress or
 * done (Common/Utils/Incident/PostmortemStatus). The not started, draft and
 * completed statuses are built in - renamed, never deleted - and keep their
 * order (the server refuses a move that would break it, and says why).
 *
 * Most projects never come here: the four statuses a project starts with
 * answer "which postmortems are still owed?". A team adds its own - "In
 * Review" - when its process has a step of its own.
 */
const IncidentPostmortemStatusesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // Archive and Unarchive, and the folded Archived section. See the hook.
  const archive: ArchivableValues<IncidentPostmortemStatus> =
    useArchivableValues<IncidentPostmortemStatus>({
      modelType: IncidentPostmortemStatus,
      type: ArchivableValueType.IncidentPostmortemStatus,
    });

  // The rows on the page, which "Counts as" is worked out from.
  const [rows, setRows] = useState<Array<IncidentPostmortemStatus>>([]);

  return (
    <Fragment>
      <ModelTable<IncidentPostmortemStatus>
        modelType={IncidentPostmortemStatus}
        query={archive.query}
        actionButtons={archive.actionButtons}
        getDeleteConfirmation={archive.getDeleteConfirmation}
        bulkActions={archive.bulkActions}
        refreshToggle={archive.refreshToggle}
        id="incident-postmortem-status-table"
        userPreferencesKey="incident-postmortem-status-table"
        name="Settings > Postmortem Statuses"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        showViewIdButton={true}
        enableDragAndDrop={true}
        dragDropIndexField="order"
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title:
            STATE_SETTINGS_COPY[StateListType.IncidentPostmortemStatus].title,
          description:
            STATE_SETTINGS_COPY[StateListType.IncidentPostmortemStatus]
              .description,
        }}
        getDeleteDisabledReason={(
          item: IncidentPostmortemStatus,
        ): string | undefined => {
          return getStateSettingsDeleteLockedReason({
            definition: DEFINITION,
            copy: STATE_SETTINGS_COPY[StateListType.IncidentPostmortemStatus],
            item: item,
          });
        }}
        onFetchSuccess={(data: Array<IncidentPostmortemStatus>) => {
          setRows(data);
          // Every postmortem status picker reads the new list, not a cached one.
          ModelListCache.invalidate(IncidentPostmortemStatus);
        }}
        selectMoreFields={{
          color: true,
          isNotStartedStatus: true,
          isDraftStatus: true,
          isCompletedStatus: true,
        }}
        filters={[]}
        columns={getStateSettingsColumns<IncidentPostmortemStatus>({
          definition: DEFINITION,
          copy: STATE_SETTINGS_COPY[StateListType.IncidentPostmortemStatus],
          rows: rows,
        })}
        viewPageRoute={Navigation.getCurrentRoute()}
        formFields={getStateSettingsFormFields<IncidentPostmortemStatus>(
          STATE_SETTINGS_COPY[StateListType.IncidentPostmortemStatus],
        )}
        showRefreshButton={true}
      />
      {archive.element}
    </Fragment>
  );
};

export default IncidentPostmortemStatusesPage;
