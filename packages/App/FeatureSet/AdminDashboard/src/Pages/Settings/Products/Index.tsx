import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import ServerProductsSettings from "./ServerProductsSettings";
import Route from "Common/Types/API/Route";
import Page from "Common/UI/Components/Page/Page";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

/*
 * Settings > Products (issue #6815): the products every project on this
 * server offers - a preset in one click, or a switch per product
 * (ServerProductsSettings).
 */
const SettingsProducts: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();

  return (
    <Page
      title={t("pages.settings.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.settings"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: t("breadcrumbs.products"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_PRODUCTS] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <ServerProductsSettings />
    </Page>
  );
};

export default SettingsProducts;
