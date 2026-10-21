import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ProxmoxDocumentationCard from "../../Components/Proxmox/DocumentationCard";

const ProxmoxDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ProxmoxDocumentationCard
        title="Connect a Proxmox Cluster"
        description="Install the OneUptime Proxmox agent, or let Proxmox VE 9+ push its metrics itself. Pick how to connect, then follow the steps — the cluster appears automatically once data arrives."
      />
    </Fragment>
  );
};

export default ProxmoxDocumentation;
