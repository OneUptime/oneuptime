import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import VMwareDocumentationCard from "../../Components/VMware/DocumentationCard";

const VMwareDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <VMwareDocumentationCard
        title="Connect a vCenter"
        description="Install the OneUptime VMware agent to connect a vCenter Server (or a standalone ESXi host). Pick how to install it, then follow the steps — the vCenter appears automatically after its first collection."
      />
    </Fragment>
  );
};

export default VMwareDocumentation;
