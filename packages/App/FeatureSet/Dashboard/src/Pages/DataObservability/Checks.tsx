import PageComponentProps from "../PageComponentProps";
import DataCheckTable from "../../Components/DataObservability/DataCheckTable";
import DbtTestTable from "../../Components/DataObservability/DbtTestTable";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Every check on the project's tables, failing first - each added on its
 * table's own page - then every test its dbt projects run on them.
 */
const DataObservabilityChecksPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <div className="space-y-5">
      <DataCheckTable />
      <DbtTestTable />
    </div>
  );
};

export default DataObservabilityChecksPage;
