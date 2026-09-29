import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import VMwareDocumentationCard from "../../Components/VMware/DocumentationCard";

const VMwareDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <VMwareDocumentationCard
        title="Agent Installation Guide"
        description="Install the OneUptime VMware Agent to connect a vCenter Server (or a standalone ESXi host). Once installed, the vCenter will appear automatically."
      />
    </Fragment>
  );
};

export default VMwareDocumentation;
