import PageComponentProps from "../PageComponentProps";
import AccessTable from "../../Components/DataSecurity/AccessTable";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHO AND WHAT CAN REACH SENSITIVE DATA?
 *
 * Every grant the cloud readers found on the project's stores, and the
 * services seen using them in traces, in two lists: what reaches the
 * stores from outside your accounts - anyone on the internet first - and
 * what reaches them from inside. Each row says who or what it is, what it
 * may do, what grants it, and the store with how sensitive its data is.
 */
const DataSecurityAccessPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <>
      <AccessTable
        id="data-security-access-external"
        isExternal={true}
        title="From Outside Your Accounts"
        description="Anyone on the internet, and accounts, users and services outside your connected accounts, that can reach a store."
        noItemsMessage="Nothing outside your accounts can reach your stores."
      />
      <AccessTable
        id="data-security-access-internal"
        isExternal={false}
        title="Inside Your Accounts"
        description="Roles, users, groups and services in your own accounts that can reach a store, and what each may do."
        noItemsMessage="No access was read yet. It is read with each store's configuration."
      />
    </>
  );
};

export default DataSecurityAccessPage;
