import IncidentsTable from "../../Components/Incident/IncidentsTable";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import useCreatePageFirstRun, {
  CreatePageFirstRun,
} from "../../Components/ProductOnboarding/UseCreatePageFirstRun";
import { ProductKey } from "../../Components/ProductOnboarding/ProductOnboarding";
import PageMap from "../../Utils/PageMap";
import Incident from "Common/Models/DatabaseModels/Incident";

const IncidentsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // Until the first one, the page explains the product under the empty table.
  const firstRun: CreatePageFirstRun = useCreatePageFirstRun<Incident>({
    modelType: Incident,
    product: ProductKey.Incidents,
    startTitle: "Declare Incident",
    createPage: PageMap.INCIDENT_CREATE,
  });
  return (
    <Fragment>
      <IncidentsTable
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        saveFilterProps={{
          tableId: "all-incidents-table",
        }}
        emptyState={firstRun.emptyState}
      />
      {firstRun.showcase}
    </Fragment>
  );
};

export default IncidentsPage;
