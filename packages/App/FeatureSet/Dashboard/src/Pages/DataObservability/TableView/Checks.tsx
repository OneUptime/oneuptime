import PageComponentProps from "../../PageComponentProps";
import DataCheckTable from "../../../Components/DataObservability/DataCheckTable";
import DbtTestTable from "../../../Components/DataObservability/DbtTestTable";
import SuggestedDataChecks from "../../../Components/DataObservability/SuggestedDataChecks";
import CheckFromSentence from "../../../Components/DataObservability/CheckFromSentence";
import { useTableViewContext } from "./TableViewContext";
import {
  DataAssetColumn,
  readDataAssetColumns,
} from "Common/Types/DataObservability/DataAssetColumn";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * The checks on what this table holds, with its own columns to choose from,
 * under the checks its columns call for (SuggestedDataChecks) and a check
 * written from a rule in a sentence (CheckFromSentence) - then, for a table
 * a dbt project builds or reads, the tests dbt runs on it.
 */
const TableChecksPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { dataAssetId, dataAsset } = useTableViewContext();
  const [addedCount, setAddedCount] = useState<number>(0);
  const columns: Array<DataAssetColumn> = readDataAssetColumns(
    dataAsset?.columns,
  );

  return (
    <div className="space-y-5">
      {dataAsset ? (
        <SuggestedDataChecks
          dataAssetId={dataAssetId}
          dataStoreId={dataAsset.dataStoreId || null}
          tableName={dataAsset.name || ""}
          columns={columns}
          onChecksAdded={() => {
            setAddedCount((count: number): number => {
              return count + 1;
            });
          }}
        />
      ) : (
        <></>
      )}
      <CheckFromSentence
        dataAssetId={dataAssetId}
        onCheckAdded={() => {
          setAddedCount((count: number): number => {
            return count + 1;
          });
        }}
      />
      <DataCheckTable
        dataAssetId={dataAssetId}
        columns={columns}
        refreshToggle={String(addedCount)}
      />
      {dataAsset?.dbtNode ? <DbtTestTable dataAssetId={dataAssetId} /> : <></>}
    </div>
  );
};

export default TableChecksPage;
