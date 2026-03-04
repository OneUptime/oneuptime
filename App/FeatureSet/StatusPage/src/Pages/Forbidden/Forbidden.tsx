import Page from "../../Components/Page/Page";
import PageComponentProps from "../PageComponentProps";
import IconProp from "Common/Types/Icon/IconProp";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import React, { FunctionComponent, ReactElement } from "react";

const PageNotFound: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Page>
      <EmptyState
        id="empty-state-page-not-found"
        title={"Forbidden"}
        description={"You do not have permission to access this page."}
        icon={IconProp.NoSignal}
      />
    </Page>
  );
};

export default PageNotFound;
