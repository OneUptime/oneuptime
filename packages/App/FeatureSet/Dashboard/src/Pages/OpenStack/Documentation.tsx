import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import OpenStackDocumentationCard from "../../Components/OpenStack/DocumentationCard";

const OpenStackDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <OpenStackDocumentationCard
        title="Connect an OpenStack Cloud"
        description="Install the OneUptime OpenStack agent on a machine outside the cloud, with a credential that reads what you choose. The cloud appears automatically once data arrives."
      />
    </Fragment>
  );
};

export default OpenStackDocumentation;
