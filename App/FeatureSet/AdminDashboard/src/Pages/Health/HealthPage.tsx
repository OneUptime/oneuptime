import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import EnterpriseHealthUpgrade from "./EnterpriseHealthUpgrade";
import HealthSideMenu from "./SideMenu";
import Route from "Common/Types/API/Route";
import Page from "Common/UI/Components/Page/Page";
import { IS_ENTERPRISE_EDITION } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

export interface ComponentProps {
  // Title shown on the page and as the final breadcrumb.
  title: string;
  // Route the final breadcrumb links to (this page).
  currentRoute: Route;
  // When true the page is gated behind the Enterprise Edition.
  enterpriseOnly?: boolean | undefined;
  enterpriseFeatureName?: string | undefined;
  enterpriseFeatureDescription?: string | undefined;
  children: ReactElement | Array<ReactElement>;
}

/*
 * Shared layout for every instance-health page: consistent breadcrumbs, the
 * health side menu, and (optionally) the Enterprise-Edition upgrade gate. Sub
 * pages render their content as children and never have to repeat this wiring.
 */
const HealthPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();

  const isGated: boolean =
    Boolean(props.enterpriseOnly) && !IS_ENTERPRISE_EDITION;

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
          title: "Instance Health",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HEALTH] as Route),
        },
        {
          title: props.title,
          to: RouteUtil.populateRouteParams(props.currentRoute),
        },
      ]}
    >
      {isGated ? (
        <EnterpriseHealthUpgrade
          featureName={props.enterpriseFeatureName || "Instance Health"}
          featureDescription={
            props.enterpriseFeatureDescription ||
            "Live status, datastore capacity and diagnostics for your OneUptime deployment."
          }
        />
      ) : (
        props.children
      )}
    </Page>
  );
};

export default HealthPage;
