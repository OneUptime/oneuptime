import AlertsTable from "../../Components/Alert/AlertsTable";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import useCreatePageFirstRun, {
  CreatePageFirstRun,
} from "../../Components/ProductOnboarding/UseCreatePageFirstRun";
import { ProductKey } from "../../Components/ProductOnboarding/ProductOnboarding";
import PageMap from "../../Utils/PageMap";
import Alert from "Common/Models/DatabaseModels/Alert";

const AlertsPage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  // Until the first one, the page explains the product under the empty table.
  const firstRun: CreatePageFirstRun = useCreatePageFirstRun<Alert>({
    modelType: Alert,
    product: ProductKey.Alerts,
    startTitle: "Create Alert",
    createPage: PageMap.ALERT_CREATE,
  });
  return (
    <Fragment>
      <AlertsTable
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        saveFilterProps={{
          tableId: "all-alerts-table",
        }}
        emptyState={firstRun.emptyState}
      />
      {firstRun.showcase}
    </Fragment>
  );
};

export default AlertsPage;
