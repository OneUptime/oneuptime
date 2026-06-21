import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import CephDocumentationCard from "../../Components/Ceph/DocumentationCard";

const CephDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <CephDocumentationCard
        title="Agent Installation Guide"
        description="Install the OneUptime Ceph Agent to connect your Ceph cluster. Once installed, the cluster will appear automatically."
      />
    </Fragment>
  );
};

export default CephDocumentation;
