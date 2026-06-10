import PageComponentProps from "../PageComponentProps";
import EntitiesTable from "../../Components/Entities/EntitiesTable";
import Page from "Common/UI/Components/Page/Page";
import React, { FunctionComponent, ReactElement } from "react";

const EntitiesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Page title="Entities" breadcrumbLinks={[]}>
      <EntitiesTable />
    </Page>
  );
};

export default EntitiesPage;
