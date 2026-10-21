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
import AlertState from "Common/Models/DatabaseModels/AlertState";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const DEFINITION: StateListDefinition = STATE_LISTS[StateListType.AlertState];

/*
 * The project's alert states, in the order an alert moves through them:
 * dragged into order, created and edited from the usual form, and each one
 * saying what an alert in it counts as. The created, acknowledged and
 * resolved states are built in - renamed, never deleted - and keep their
 * order (the server refuses a move that would break it, and says why).
 */
const AlertStatesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The rows on the page, which "Counts as" is worked out from.
  const [rows, setRows] = useState<Array<AlertState>>([]);

  return (
    <Fragment>
      <ModelTable<AlertState>
        modelType={AlertState}
        id="alert-state-table"
        userPreferencesKey="alert-state-table"
        name="Settings > Alert State"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        showViewIdButton={true}
        enableDragAndDrop={true}
        dragDropIndexField="order"
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: STATE_SETTINGS_COPY[StateListType.AlertState].title,
          description:
            STATE_SETTINGS_COPY[StateListType.AlertState].description,
        }}
        getDeleteDisabledReason={(item: AlertState): string | undefined => {
          return getStateSettingsDeleteLockedReason({
            definition: DEFINITION,
            copy: STATE_SETTINGS_COPY[StateListType.AlertState],
            item: item,
          });
        }}
        onFetchSuccess={(data: Array<AlertState>) => {
          setRows(data);
          // Every alert state picker reads the new list, not a cached one.
          ModelListCache.invalidate(AlertState);
        }}
        selectMoreFields={{
          color: true,
          isCreatedState: true,
          isAcknowledgedState: true,
          isResolvedState: true,
        }}
        filters={[]}
        columns={getStateSettingsColumns<AlertState>({
          definition: DEFINITION,
          copy: STATE_SETTINGS_COPY[StateListType.AlertState],
          rows: rows,
        })}
        viewPageRoute={Navigation.getCurrentRoute()}
        formFields={getStateSettingsFormFields<AlertState>(
          STATE_SETTINGS_COPY[StateListType.AlertState],
        )}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default AlertStatesPage;
