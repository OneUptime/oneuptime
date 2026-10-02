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
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const DEFINITION: StateListDefinition =
  STATE_LISTS[StateListType.IncidentState];

/*
 * The project's incident states, in the order an incident moves through
 * them: dragged into order, created and edited from the usual form, and each
 * one saying what an incident in it counts as. The created, acknowledged and
 * resolved states are built in - renamed, never deleted - and keep their
 * order (the server refuses a move that would break it, and says why).
 */
const IncidentStatesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The rows on the page, which "Counts as" is worked out from.
  const [rows, setRows] = useState<Array<IncidentState>>([]);

  return (
    <Fragment>
      <ModelTable<IncidentState>
        modelType={IncidentState}
        id="incident-state-table"
        userPreferencesKey="incident-state-table"
        name="Settings > Incident State"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        showViewIdButton={true}
        enableDragAndDrop={true}
        dragDropIndexField="order"
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: STATE_SETTINGS_COPY[StateListType.IncidentState].title,
          description:
            STATE_SETTINGS_COPY[StateListType.IncidentState].description,
        }}
        getDeleteDisabledReason={(item: IncidentState): string | undefined => {
          return getStateSettingsDeleteLockedReason({
            definition: DEFINITION,
            copy: STATE_SETTINGS_COPY[StateListType.IncidentState],
            item: item,
          });
        }}
        onFetchSuccess={(data: Array<IncidentState>) => {
          setRows(data);
          // Every incident state picker reads the new list, not a cached one.
          ModelListCache.invalidate(IncidentState);
        }}
        selectMoreFields={{
          color: true,
          isCreatedState: true,
          isAcknowledgedState: true,
          isResolvedState: true,
        }}
        filters={[]}
        columns={getStateSettingsColumns<IncidentState>({
          definition: DEFINITION,
          copy: STATE_SETTINGS_COPY[StateListType.IncidentState],
          rows: rows,
        })}
        viewPageRoute={Navigation.getCurrentRoute()}
        formFields={getStateSettingsFormFields<IncidentState>(
          STATE_SETTINGS_COPY[StateListType.IncidentState],
        )}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default IncidentStatesPage;
