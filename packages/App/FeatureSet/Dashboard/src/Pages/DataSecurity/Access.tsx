import PageComponentProps from "../PageComponentProps";
import AccessTable from "../../Components/DataSecurity/AccessTable";
import IdentitiesTable from "../../Components/DataSecurity/IdentitiesTable";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHO AND WHAT CAN REACH SENSITIVE DATA?
 *
 * First, every identity that can reach the project's stores - each role,
 * user, group, service account, account outside, anyone on the internet,
 * and each service seen using a store in traces - the riskiest first, each
 * opening its own page: what it reaches, the blast radius of a leaked
 * credential (IdentitiesTable). Then every grant from outside your
 * accounts, anyone on the internet first: the access to close first.
 * The grants inside your accounts are each identity's page, and each
 * store's Who Can Reach It.
 */
const DataSecurityAccessPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <>
      <IdentitiesTable />
      <AccessTable
        id="data-security-access-external"
        isExternal={true}
        title="From Outside Your Accounts"
        description="Anyone on the internet, and accounts, users and services outside your connected accounts, that can reach a store."
        noItemsMessage="Nothing outside your accounts can reach your stores."
      />
    </>
  );
};

export default DataSecurityAccessPage;
