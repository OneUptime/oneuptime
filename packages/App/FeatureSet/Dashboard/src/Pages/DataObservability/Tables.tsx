import PageComponentProps from "../PageComponentProps";
import DataAssetTable from "../../Components/DataObservability/DataAssetTable";
import React, { FunctionComponent, ReactElement } from "react";

// Every table and view still in its database.
const DataObservabilityTablesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <DataAssetTable isDropped={false} />;
};

export default DataObservabilityTablesPage;
