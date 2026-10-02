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
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * The project's incident severities, most severe first: dragged into order
 * (where OneUptime compares severities, the higher one wins), and created
 * and edited from the usual form.
 */
const IncidentSeveritiesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<IncidentSeverity>
        modelType={IncidentSeverity}
        id="incident-severity-table"
        userPreferencesKey="incident-severity-table"
        name="Settings > Incident Severity"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        showViewIdButton={true}
        enableDragAndDrop={true}
        dragDropIndexField="order"
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: STATE_SETTINGS_COPY[StateListType.IncidentSeverity].title,
          description:
            STATE_SETTINGS_COPY[StateListType.IncidentSeverity].description,
        }}
        onFetchSuccess={() => {
          // Every incident severity picker reads the new list, not a cached one.
          ModelListCache.invalidate(IncidentSeverity);
        }}
        selectMoreFields={{
          color: true,
        }}
        filters={[]}
        columns={getStateSettingsColumns<IncidentSeverity>({
          definition: STATE_LISTS[StateListType.IncidentSeverity],
          copy: STATE_SETTINGS_COPY[StateListType.IncidentSeverity],
          rows: [],
        })}
        viewPageRoute={Navigation.getCurrentRoute()}
        formFields={getStateSettingsFormFields<IncidentSeverity>(
          STATE_SETTINGS_COPY[StateListType.IncidentSeverity],
        )}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default IncidentSeveritiesPage;
