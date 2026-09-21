import EnterpriseFeatureUpgrade from "../../../Components/EnterpriseEdition/EnterpriseFeatureUpgrade";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Page from "Common/UI/Components/Page/Page";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

/*
 * What Settings > Global OIDC shows without the Enterprise Edition: the
 * settings layout around the enterprise upsell card. Both Global OIDC shells
 * (the provider list and one provider) render it.
 */
const GlobalOIDCUpsell: FunctionComponent = (): ReactElement => {
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
          title: "Global OIDC",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_GLOBAL_OIDC] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <EnterpriseFeatureUpgrade
        title="Global OIDC"
        description="Instance-wide OpenID Connect identity providers that can be connected to any project on this OneUptime server."
        featureName="Global OIDC"
        featureDescription="Configure an OpenID Connect identity provider once at the instance level and connect it to any project on this OneUptime server."
        benefits={[
          {
            icon: IconProp.Lock,
            title: "Instance-wide auth",
            subtitle:
              "Configure one identity provider and connect it to any project on the server.",
          },
          {
            icon: IconProp.ShieldCheck,
            title: "Enforce SSO",
            subtitle:
              "Require SSO across the whole instance — no shared passwords.",
          },
          {
            icon: IconProp.User,
            title: "Auto provisioning",
            subtitle:
              "Attach projects and place signed-in users into the right teams automatically.",
          },
          {
            icon: IconProp.ClipboardDocumentList,
            title: "Audit trail",
            subtitle:
              "Every SSO sign-in is recorded alongside the rest of your audit events.",
          },
        ]}
      />
    </Page>
  );
};

export default GlobalOIDCUpsell;
