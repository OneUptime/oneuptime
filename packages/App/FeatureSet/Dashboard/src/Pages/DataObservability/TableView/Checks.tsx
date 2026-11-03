import PageComponentProps from "../../PageComponentProps";
import DataCheckTable from "../../../Components/DataObservability/DataCheckTable";
import { useTableViewContext } from "./TableViewContext";
import { readDataAssetColumns } from "Common/Types/DataObservability/DataAssetColumn";
import React, { FunctionComponent, ReactElement } from "react";

// The checks on what this table holds, with its own columns to choose from.
const TableChecksPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { dataAssetId, dataAsset } = useTableViewContext();

  return (
    <DataCheckTable
      dataAssetId={dataAssetId}
      columns={readDataAssetColumns(dataAsset?.columns)}
    />
  );
};

export default TableChecksPage;
