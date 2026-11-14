import SetupHealthView from "../../Components/SetupHealth/SetupHealthView";
import { getHomeBreadcrumbs } from "../../Utils/Breadcrumbs/HomeBreadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Setup health (#6812): what is misconfigured in the project, each finding
 * with its fix. About the whole project, so it lives under Home - where
 * "Needs attention" says how many things need a look - and Search finds it
 * by name.
 */
const SetupHealthPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <Page title="Setup Health" breadcrumbLinks={getHomeBreadcrumbs(path)}>
      <SetupHealthView />
    </Page>
  );
};

export default SetupHealthPage;
