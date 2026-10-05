import { getUserSettingsBreadcrumbs } from "../../Utils/Breadcrumbs/UserSettingsBreadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import DashboardSideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const UserSettingsLayout: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <Page
      title={translator.translateTemplate(
        "User Settings for Project {{project}}",
        { project: props.currentProject?.name || "" },
      )}
      breadcrumbLinks={getUserSettingsBreadcrumbs(path)}
      sideMenu={<DashboardSideMenu />}
    >
      <Outlet />
    </Page>
  );
};

export default UserSettingsLayout;
