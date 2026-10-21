import PageComponentProps from "../../PageComponentProps";
import { STATE_SETTINGS_COPY } from "../../../Components/StateSettings/StateSettingsCopy";
import {
  getStateSettingsColumns,
  getStateSettingsFormFields,
} from "../../../Components/StateSettings/StateSettingsTable";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { STATE_LISTS, StateListType } from "Common/Utils/StateOrder";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ModelListCache from "Common/UI/Utils/ModelListCache";
import Navigation from "Common/UI/Utils/Navigation";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * The project's alert severities, most severe first: dragged into order
 * (where OneUptime compares severities, the higher one wins), and created
 * and edited from the usual form.
 */
const AlertSeveritiesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<AlertSeverity>
        modelType={AlertSeverity}
        id="alert-severity-table"
        userPreferencesKey="alert-severity-table"
        name="Settings > Alert Severity"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        showViewIdButton={true}
        enableDragAndDrop={true}
        dragDropIndexField="order"
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: STATE_SETTINGS_COPY[StateListType.AlertSeverity].title,
          description:
            STATE_SETTINGS_COPY[StateListType.AlertSeverity].description,
        }}
        onFetchSuccess={() => {
          // Every alert severity picker reads the new list, not a cached one.
          ModelListCache.invalidate(AlertSeverity);
        }}
        selectMoreFields={{
          color: true,
        }}
        filters={[]}
        columns={getStateSettingsColumns<AlertSeverity>({
          definition: STATE_LISTS[StateListType.AlertSeverity],
          copy: STATE_SETTINGS_COPY[StateListType.AlertSeverity],
          rows: [],
        })}
        viewPageRoute={Navigation.getCurrentRoute()}
        formFields={getStateSettingsFormFields<AlertSeverity>(
          STATE_SETTINGS_COPY[StateListType.AlertSeverity],
        )}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default AlertSeveritiesPage;
