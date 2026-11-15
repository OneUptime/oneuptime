import SetupHealthView from "../../Components/SetupHealth/SetupHealthView";
import { SETUP_HEALTH_WORDS_PAGE } from "../../Components/SetupHealth/SetupHealthWords";
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
 * by name. What the page is for is said once, under its title (#8135): the
 * page opens with the verdict, not with a card that repeats the title.
 */
const SetupHealthPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <Page
      title="Setup Health"
      description={SETUP_HEALTH_WORDS_PAGE.description}
      breadcrumbLinks={getHomeBreadcrumbs(path)}
    >
      <SetupHealthView />
    </Page>
  );
};

export default SetupHealthPage;
