import PageComponentProps from "../../PageComponentProps";
import StoreFeed from "../../../Components/DataSecurity/StoreFeed";
import { useDataStoreViewContext } from "./DataStoreViewContext";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Everything that happened to the store, with who did it: when it was found
 * or added, the changes people made to its settings, its owners and the
 * rules that set them, when discovery stopped seeing it or found it again,
 * and each response action that closed its exposure.
 */
const DataStoreTimelinePage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { dataStoreId } = useDataStoreViewContext();

  return <StoreFeed dataStoreId={dataStoreId} />;
};

export default DataStoreTimelinePage;
