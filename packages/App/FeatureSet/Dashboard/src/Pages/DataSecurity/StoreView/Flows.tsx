import PageComponentProps from "../../PageComponentProps";
import StoreFlowsTable from "../../../Components/DataSecurity/StoreFlowsTable";
import { useDataStoreViewContext } from "./DataStoreViewContext";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Where this store's data goes, and where it comes from: the services seen
 * using it in traces, the outside hosts and AI providers they send its data
 * to, and the stores that hold copies of it.
 */
const DataStoreFlows: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { dataStoreId } = useDataStoreViewContext();

  return (
    <Fragment>
      <StoreFlowsTable dataStoreId={dataStoreId} direction="outgoing" />
      <StoreFlowsTable dataStoreId={dataStoreId} direction="incoming" />
    </Fragment>
  );
};

export default DataStoreFlows;
