import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import CephDocumentationCard from "../../Components/Ceph/DocumentationCard";

const CephDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <CephDocumentationCard
        title="Connect a Ceph Cluster"
        description="Install the OneUptime Ceph agent next to your cluster. Pick how to install it, then follow the steps — the cluster appears automatically once the agent connects."
      />
    </Fragment>
  );
};

export default CephDocumentation;
