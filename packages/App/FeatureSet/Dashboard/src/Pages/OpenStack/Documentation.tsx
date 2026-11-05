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
        description="Say how you deploy OpenStack, then follow the steps for it. The cloud appears by itself once its first data arrives."
      />
    </Fragment>
  );
};

export default OpenStackDocumentation;
