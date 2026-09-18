import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import EnterprisePluginPage from "../../Enterprise/EnterprisePluginPage";
import { getAdminDashboardPlugins } from "../../Enterprise/Plugins";
import EnterpriseHealthUpgrade from "./EnterpriseHealthUpgrade";
import HealthPage from "./HealthPage";
import Route from "Common/Types/API/Route";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { BILLING_ENABLED, IS_ENTERPRISE_EDITION } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement } from "react";

export const QUERY_CONSOLE_NOT_ON_CLOUD_NOTICE: string =
  "The query console is not available on OneUptime Cloud. It runs statements directly against the datastores behind the instance, so it is offered on the self-hosted OneUptime Enterprise Edition only.";

/*
 * The OneUptime Health query console: ad-hoc Postgres, ClickHouse and Valkey
 * queries against the datastores behind this instance. An Enterprise Edition
 * feature, and never offered on OneUptime Cloud (billing on), where the server
 * refuses it too - so the page says so instead of rendering a console whose
 * every query would fail.
 */
const HealthQueryConsole: FunctionComponent = (): ReactElement => {
  return (
    <HealthPage
      title="Query Console"
      currentRoute={RouteMap[PageMap.HEALTH_QUERY] as Route}
    >
      <EnterprisePluginPage
        plugin={getAdminDashboardPlugins().HealthQueryConsole}
        isEligible={IS_ENTERPRISE_EDITION && !BILLING_ENABLED}
        renderUpsell={(): ReactElement => {
          if (BILLING_ENABLED) {
            return (
              <Alert
                type={AlertType.INFO}
                strongTitle="Query console"
                title={QUERY_CONSOLE_NOT_ON_CLOUD_NOTICE}
              />
            );
          }

          return (
            <EnterpriseHealthUpgrade
              featureName="Query console"
              featureDescription="Run ad-hoc Postgres, ClickHouse and Valkey queries against the datastores backing this instance, with read-only safety and result export."
            />
          );
        }}
      />
    </HealthPage>
  );
};

export default HealthQueryConsole;
