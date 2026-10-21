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
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const DEFINITION: StateListDefinition =
  STATE_LISTS[StateListType.ScheduledMaintenanceState];

/*
 * The project's scheduled maintenance states, in the order an event moves
 * through them: dragged into order, created and edited from the usual form,
 * and each one saying how an event in it shows on status pages. The
 * scheduled, ongoing, ended and completed states are built in - renamed,
 * never deleted - and keep their order (the server refuses a move that would
 * break it, and says why).
 */
const ScheduledMaintenanceStatesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The rows on the page, which "Counts as" is worked out from.
  const [rows, setRows] = useState<Array<ScheduledMaintenanceState>>([]);

  return (
    <Fragment>
      <ModelTable<ScheduledMaintenanceState>
        modelType={ScheduledMaintenanceState}
        id="scheduled-maintenance-state-table"
        userPreferencesKey="scheduled-maintenance-state-table"
        name="Settings > Scheduled Maintenance State"
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
            STATE_SETTINGS_COPY[StateListType.ScheduledMaintenanceState].title,
          description:
            STATE_SETTINGS_COPY[StateListType.ScheduledMaintenanceState]
              .description,
        }}
        getDeleteDisabledReason={(
          item: ScheduledMaintenanceState,
        ): string | undefined => {
          return getStateSettingsDeleteLockedReason({
            definition: DEFINITION,
            copy: STATE_SETTINGS_COPY[StateListType.ScheduledMaintenanceState],
            item: item,
          });
        }}
        onFetchSuccess={(data: Array<ScheduledMaintenanceState>) => {
          setRows(data);
          // Every maintenance state picker reads the new list, not a cached one.
          ModelListCache.invalidate(ScheduledMaintenanceState);
        }}
        selectMoreFields={{
          color: true,
          isScheduledState: true,
          isOngoingState: true,
          isEndedState: true,
          isResolvedState: true,
        }}
        filters={[]}
        columns={getStateSettingsColumns<ScheduledMaintenanceState>({
          definition: DEFINITION,
          copy: STATE_SETTINGS_COPY[StateListType.ScheduledMaintenanceState],
          rows: rows,
        })}
        viewPageRoute={Navigation.getCurrentRoute()}
        formFields={getStateSettingsFormFields<ScheduledMaintenanceState>(
          STATE_SETTINGS_COPY[StateListType.ScheduledMaintenanceState],
        )}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default ScheduledMaintenanceStatesPage;
