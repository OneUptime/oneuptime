import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import HealthSideMenu from "./SideMenu";
import Route from "Common/Types/API/Route";
import Page from "Common/UI/Components/Page/Page";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

export interface ComponentProps {
  // Title shown on the page and as the final breadcrumb.
  title: string;
  // Route the final breadcrumb links to (this page).
  currentRoute: Route;
  children: ReactElement | Array<ReactElement>;
}

/*
 * Shared layout for every OneUptime Health page: consistent breadcrumbs and
 * the health side menu. Sub pages render their content as children and never
 * have to repeat this wiring.
 *
 * The layout itself is the same on every edition. A page whose content is an
 * Enterprise feature renders it through EnterprisePluginPage (the enterprise
 * plugin, or the EnterpriseHealthUpgrade card on the Community Edition), so
 * the edition decision is made once, from the edition the server actually
 * runs, and never from the raw IS_ENTERPRISE_EDITION setting.
 */
const HealthPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();

  return (
    <Page
      title={props.title}
      sideMenu={<HealthSideMenu />}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "OneUptime Health",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HEALTH] as Route),
        },
        {
          title: props.title,
          to: RouteUtil.populateRouteParams(props.currentRoute),
        },
      ]}
    >
      {props.children}
    </Page>
  );
};

export default HealthPage;
