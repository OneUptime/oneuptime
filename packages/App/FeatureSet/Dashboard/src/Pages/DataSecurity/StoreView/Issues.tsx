import PageComponentProps from "../../PageComponentProps";
import StoreIssuesTable from "../../../Components/DataSecurity/StoreIssuesTable";
import { useDataStoreViewContext } from "./DataStoreViewContext";
import DataSecurityIssueStatus from "Common/Types/DataSecurity/DataSecurityIssueStatus";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * What to fix on this store: its open issues, the riskiest first, and under
 * them the ones accepted, resolved or found not to be issues, the most
 * recent first. Each opens on its own page, where it is explained and
 * worked.
 */
const DataStoreIssues: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { dataStoreId } = useDataStoreViewContext();

  return (
    <Fragment>
      <StoreIssuesTable
        dataStoreId={dataStoreId}
        statuses={[DataSecurityIssueStatus.Open]}
        id="data-store-open-issues-table"
        title="Open Issues"
        description="What puts this store's data at risk now, the riskiest first."
        noItemsMessage="No open issues on this store."
        showStatus={false}
        sortBy="riskScore"
      />
      <StoreIssuesTable
        dataStoreId={dataStoreId}
        statuses={[
          DataSecurityIssueStatus.Accepted,
          DataSecurityIssueStatus.Resolved,
          DataSecurityIssueStatus.NotAnIssue,
        ]}
        id="data-store-closed-issues-table"
        title="Accepted and Resolved Issues"
        description="Issues whose risk was accepted, that were fixed, or that turned out not to be issues."
        noItemsMessage="No accepted or resolved issues yet."
        showStatus={true}
        sortBy="lastDetectedAt"
      />
    </Fragment>
  );
};

export default DataStoreIssues;
