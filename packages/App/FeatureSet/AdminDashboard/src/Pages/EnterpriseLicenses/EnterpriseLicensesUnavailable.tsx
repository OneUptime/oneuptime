import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
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
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.enterpriseLicenses"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.ENTERPRISE_LICENSES] as Route,
          ),
        },
      ]}
    >
      {props.isBillingEnabled ? (
        <EmptyState
          id="enterprise-licenses-not-available"
          icon={IconProp.Lock}
          title="Requires the OneUptime Enterprise Edition"
          description="License management is part of the OneUptime Enterprise Edition, and this Admin Dashboard was built without it. Deploy the Enterprise Edition image to issue and track enterprise licenses."
        />
      ) : (
        <EmptyState
          id="enterprise-licenses-not-available"
          icon={IconProp.Lock}
          title="Only available on OneUptime Cloud"
          description="Enterprise licenses are issued and tracked on the hosted oneuptime.com, where billing is enabled. This self-hosted instance does not manage licenses."
        />
      )}
    </Page>
  );
};

export default EnterpriseLicensesUnavailable;
