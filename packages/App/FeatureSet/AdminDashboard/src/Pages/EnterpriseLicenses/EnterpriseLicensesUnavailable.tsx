import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import EmptyState, { EmptyStateSize } from "Common/UI/Components/EmptyState/EmptyState";
import Page from "Common/UI/Components/Page/Page";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

/*
 * What the Enterprise Licenses screens show where the license server does not
 * run. Licenses are issued and tracked only on OneUptime Cloud (billing
 * enabled), and the screens themselves ship in the Enterprise Edition
 * (ee/AdminDashboard/EnterpriseLicenses).
 */
export interface ComponentProps {
  // True on OneUptime Cloud: the only reason left is a Community Edition build.
  isBillingEnabled: boolean;
}

const EnterpriseLicensesUnavailable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();

  return (
    <Page
      title={t("pages.enterpriseLicenses.title")}
      isTitleTranslated={true}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.enterpriseLicenses"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.ENTERPRISE_LICENSES] as Route,
          ),
        },
      ]}
    >
      {/*
       * In the reader's language, as the page's title is: handed over in
       * English, the notice stayed English under a translated title in
       * every language (#7962).
       */}
      {props.isBillingEnabled ? (
        <EmptyState
          size={EmptyStateSize.Page}
          id="enterprise-licenses-not-available"
          icon={IconProp.Lock}
          title={t("pages.enterpriseLicenses.enterpriseEditionRequiredTitle")}
          description={t(
            "pages.enterpriseLicenses.enterpriseEditionRequiredDescription",
          )}
        />
      ) : (
        <EmptyState
          size={EmptyStateSize.Page}
          id="enterprise-licenses-not-available"
          icon={IconProp.Lock}
          title={t("pages.enterpriseLicenses.cloudOnlyTitle")}
          description={t("pages.enterpriseLicenses.cloudOnlyDescription")}
        />
      )}
    </Page>
  );
};

export default EnterpriseLicensesUnavailable;
