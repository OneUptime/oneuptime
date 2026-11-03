import PageComponentProps from "../../PageComponentProps";
import DataAssetTable from "../../../Components/DataObservability/DataAssetTable";
import { StoreViewOutletContext, useStoreView } from "./StoreViewContext";
import React, { FunctionComponent, ReactElement } from "react";

// The tables and views of one database, as the catalog shows them.
const StoreTablesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { dataStoreId }: StoreViewOutletContext = useStoreView();

  return <DataAssetTable isDropped={false} dataStoreId={dataStoreId} />;
};

export default StoreTablesPage;
