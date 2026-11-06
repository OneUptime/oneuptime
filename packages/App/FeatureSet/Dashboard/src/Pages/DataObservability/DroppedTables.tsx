import PageComponentProps from "../PageComponentProps";
import DataAssetTable from "../../Components/DataObservability/DataAssetTable";
import React, { FunctionComponent, ReactElement } from "react";

// The tables gone from their databases, kept with their history.
const DataObservabilityDroppedTablesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <DataAssetTable isDropped={true} />;
};

export default DataObservabilityDroppedTablesPage;
