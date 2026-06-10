import PageComponentProps from "../PageComponentProps";
import TopologyGraph from "../../Components/Topology/TopologyGraph";
import Page from "Common/UI/Components/Page/Page";
import React, { FunctionComponent, ReactElement } from "react";

const TopologyPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Page title="Topology" breadcrumbLinks={[]}>
      <TopologyGraph />
    </Page>
  );
};

export default TopologyPage;
