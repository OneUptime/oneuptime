import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import StorageArrayDocumentationCard from "../../Components/StorageArray/DocumentationCard";

const StorageArraysDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <StorageArrayDocumentationCard
        title="Connect a Storage Array"
        description="Install the OneUptime Storage Array Agent on a machine that can reach your array's management address. Pick the platform, then follow the steps — the array appears automatically once the agent connects."
      />
    </Fragment>
  );
};

export default StorageArraysDocumentation;
