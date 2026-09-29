import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ProxmoxDocumentationCard from "../../Components/Proxmox/DocumentationCard";

const ProxmoxDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ProxmoxDocumentationCard
        title="Agent Installation Guide"
        description="Install the OneUptime Proxmox Agent to connect your Proxmox cluster. Once installed, the cluster will appear automatically."
      />
    </Fragment>
  );
};

export default ProxmoxDocumentation;
