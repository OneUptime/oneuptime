import MasterPage from "./Components/MasterPage/MasterPage";
import Init from "./Pages/Init/Init";
import Health from "./Pages/Health/Index";
import HealthQueues from "./Pages/Health/Queues";
import HealthInstanceLogs from "./Pages/Health/InstanceLogs";
import HealthPostgres from "./Pages/Health/Postgres";
import HealthClickhouse from "./Pages/Health/Clickhouse";
import HealthRedis from "./Pages/Health/Redis";
import HealthQueryConsole from "./Pages/Health/QueryConsole";
import HealthLogs from "./Pages/Health/Logs";
import HealthTelemetry from "./Pages/Health/Telemetry";
import HealthProbes from "./Pages/Health/Probes";
import HealthMigrations from "./Pages/Health/Migrations";
import HealthSupportBundle from "./Pages/Health/Support";
import Logout from "./Pages/Logout/Logout";
import Projects from "./Pages/Projects/Index";
import SettingsAPIKey from "./Pages/Settings/APIKey/Index";
import SettingsAuthentication from "./Pages/Settings/Authentication/Index";
import SettingsSso from "./Pages/Settings/SSO/Index";
import SettingsGlobalSSOView from "./Pages/Settings/GlobalSSO/View";
import SettingsGlobalOIDCView from "./Pages/Settings/GlobalOIDC/View";
import SettingsDataRetention from "./Pages/Settings/DataRetention/Index";
import SettingsCallSMS from "./Pages/Settings/CallSMS/Index";
import SettingsWhatsApp from "./Pages/Settings/WhatsApp/Index";
import SettingsTelegram from "./Pages/Settings/Telegram/Index";
// Settings Pages.
import SettingsEmail from "./Pages/Settings/Email/Index";
import SettingsProbes from "./Pages/Settings/Probes/Index";
import SettingsGlobalRunners from "./Pages/Settings/GlobalRunners/Index";
import SettingsLlmProviders from "./Pages/Settings/LlmProviders/Index";
import SendEmail from "./Pages/SendEmail/Index";
import MoreEmail from "./Pages/More/Email";
import Users from "./Pages/Users/Index";
import EnterpriseLicenses from "./Pages/EnterpriseLicenses/Index";
import { getAdminDashboardPlugins } from "./Enterprise/Plugins";
import {
  EnterprisePluginComponent,
  EnterpriseSettingsPage,
  getEnterpriseSettingsPageRoute,
} from "./Enterprise/EnterprisePlugins";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import EnterpriseLicenseView from "./Pages/EnterpriseLicenses/View/Index";
import PageMap from "./Utils/PageMap";
import RouteMap from "./Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { MASTER_ADMIN_SIGN_IN_ROUTE } from "Common/Types/SSO/SignInMethods";
import URL from "Common/Types/API/URL";
import { ACCOUNTS_URL, DASHBOARD_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import User from "Common/UI/Utils/User";
import React, { Suspense } from "react";
import {
  Navigate,
  Route as PageRoute,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import UserView from "./Pages/Users/View/Index";
import UserDelete from "./Pages/Users/View/Delete";
import UserProjects from "./Pages/Users/View/Projects";
import UserAuthentication from "./Pages/Users/View/Authentication";
import UserSettings from "./Pages/Users/View/Settings";
import ProjectView from "./Pages/Projects/View/Index";
import ProjectSubscription from "./Pages/Projects/View/Subscription";
import ProjectSupport from "./Pages/Projects/View/Support";
import ProjectDelete from "./Pages/Projects/View/Delete";
import ProjectUsers from "./Pages/Projects/View/Users";
import ProjectUserView from "./Pages/Projects/View/UserView";
import ProjectTeams from "./Pages/Projects/View/Teams";
import ProjectTeamView from "./Pages/Projects/View/TeamView";

const App: () => JSX.Element = () => {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  if (!User.isLoggedIn()) {
    if (Navigation.getQueryStringByName("sso_token")) {
      Navigation.navigate(
        URL.fromString(ACCOUNTS_URL.toString()).addQueryParam("sso", "true"),
      );
    } else {
      /*
       * Whoever opens the Admin Dashboard signed out is meant to be a master
       * admin: the master admins' sign-in, which is the password form even
       * while the server requires single sign-on (the sign-in page then
       * offers only SSO). While SSO is not required it is the sign-in page
       * as everyone sees it.
       */
      Navigation.navigate(
        URL.fromString(ACCOUNTS_URL.toString()).addRoute(
          new Route(MASTER_ADMIN_SIGN_IN_ROUTE),
        ),
      );
    }
  }

  if (!User.isMasterAdmin()) {
    Navigation.navigate(URL.fromString(DASHBOARD_URL.toString()));
  }

  return (
    <MasterPage>
      <Routes>
        <PageRoute
          path={RouteMap[PageMap.INIT]?.toString() || ""}
          element={<Init />}
        />

        <PageRoute
          path={RouteMap[PageMap.HEALTH]?.toString() || ""}
          element={<Health />}
        />

        <PageRoute
          path={RouteMap[PageMap.HEALTH_QUEUES]?.toString() || ""}
          element={<HealthQueues />}
        />

        <PageRoute
          path={RouteMap[PageMap.HEALTH_INSTANCE_LOGS]?.toString() || ""}
          element={<HealthInstanceLogs />}
        />

        <PageRoute
          path={RouteMap[PageMap.HEALTH_POSTGRES]?.toString() || ""}
          element={<HealthPostgres />}
        />

        <PageRoute
          path={RouteMap[PageMap.HEALTH_CLICKHOUSE]?.toString() || ""}
          element={<HealthClickhouse />}
        />

        <PageRoute
          path={RouteMap[PageMap.HEALTH_REDIS]?.toString() || ""}
          element={<HealthRedis />}
        />

        <PageRoute
          path={RouteMap[PageMap.HEALTH_QUERY]?.toString() || ""}
          element={<HealthQueryConsole />}
        />

        <PageRoute
          path={RouteMap[PageMap.HEALTH_LOGS]?.toString() || ""}
          element={<HealthLogs />}
        />

        <PageRoute
          path={RouteMap[PageMap.HEALTH_TELEMETRY]?.toString() || ""}
          element={<HealthTelemetry />}
        />

        <PageRoute
          path={RouteMap[PageMap.HEALTH_PROBES]?.toString() || ""}
          element={<HealthProbes />}
        />

        <PageRoute
          path={RouteMap[PageMap.HEALTH_MIGRATIONS]?.toString() || ""}
          element={<HealthMigrations />}
        />

        <PageRoute
          path={RouteMap[PageMap.HEALTH_SUPPORT_BUNDLE]?.toString() || ""}
          element={<HealthSupportBundle />}
        />

        <PageRoute
          path={RouteMap[PageMap.PROJECTS]?.toString() || ""}
          element={<Projects />}
        />

        <PageRoute
          path={RouteMap[PageMap.USERS]?.toString() || ""}
          element={<Users />}
        />

        <PageRoute
          path={RouteMap[PageMap.ENTERPRISE_LICENSES]?.toString() || ""}
          element={<EnterpriseLicenses />}
        />

        <PageRoute
          path={RouteMap[PageMap.ENTERPRISE_LICENSE_VIEW]?.toString() || ""}
          element={<EnterpriseLicenseView />}
        />

        <PageRoute
          path={RouteMap[PageMap.USER_VIEW]?.toString() || ""}
          element={<UserView />}
        />

        <PageRoute
          path={RouteMap[PageMap.USER_PROJECTS]?.toString() || ""}
          element={<UserProjects />}
        />

        <PageRoute
          path={RouteMap[PageMap.USER_AUTHENTICATION]?.toString() || ""}
          element={<UserAuthentication />}
        />

        <PageRoute
          path={RouteMap[PageMap.USER_SETTINGS]?.toString() || ""}
          element={<UserSettings />}
        />

        <PageRoute
          path={RouteMap[PageMap.USER_DELETE]?.toString() || ""}
          element={<UserDelete />}
        />

        <PageRoute
          path={RouteMap[PageMap.PROJECT_VIEW]?.toString() || ""}
          element={<ProjectView />}
        />

        <PageRoute
          path={RouteMap[PageMap.PROJECT_SUBSCRIPTION]?.toString() || ""}
          element={<ProjectSubscription />}
        />

        <PageRoute
          path={RouteMap[PageMap.PROJECT_SUPPORT]?.toString() || ""}
          element={<ProjectSupport />}
        />

        <PageRoute
          path={RouteMap[PageMap.PROJECT_DELETE]?.toString() || ""}
          element={<ProjectDelete />}
        />

        <PageRoute
          path={RouteMap[PageMap.PROJECT_USERS]?.toString() || ""}
          element={<ProjectUsers />}
        />

        <PageRoute
          path={RouteMap[PageMap.PROJECT_USER_VIEW]?.toString() || ""}
          element={<ProjectUserView />}
        />

        <PageRoute
          path={RouteMap[PageMap.PROJECT_TEAMS]?.toString() || ""}
          element={<ProjectTeams />}
        />

        <PageRoute
          path={RouteMap[PageMap.PROJECT_TEAM_VIEW]?.toString() || ""}
          element={<ProjectTeamView />}
        />

        <PageRoute
          path={RouteMap[PageMap.LOGOUT]?.toString() || ""}
          element={<Logout />}
        />

        <PageRoute
          path={RouteMap[PageMap.SETTINGS]?.toString() || ""}
          element={<SettingsAuthentication />}
        />

        <PageRoute
          path={RouteMap[PageMap.SETTINGS_SMTP]?.toString() || ""}
          element={<SettingsEmail />}
        />

        <PageRoute
          path={RouteMap[PageMap.SETTINGS_CALL_AND_SMS]?.toString() || ""}
          element={<SettingsCallSMS />}
        />

        <PageRoute
          path={RouteMap[PageMap.SETTINGS_WHATSAPP]?.toString() || ""}
          element={<SettingsWhatsApp />}
        />

        <PageRoute
          path={RouteMap[PageMap.SETTINGS_TELEGRAM]?.toString() || ""}
          element={<SettingsTelegram />}
        />

        <PageRoute
          path={RouteMap[PageMap.SETTINGS_PROBES]?.toString() || ""}
          element={<SettingsProbes />}
        />

        <PageRoute
          path={RouteMap[PageMap.SETTINGS_GLOBAL_RUNNERS]?.toString() || ""}
          element={<SettingsGlobalRunners />}
        />

        <PageRoute
          path={RouteMap[PageMap.SETTINGS_LLM_PROVIDERS]?.toString() || ""}
          element={<SettingsLlmProviders />}
        />

        <PageRoute
          path={RouteMap[PageMap.SETTINGS_AUTHENTICATION]?.toString() || ""}
          element={<SettingsAuthentication />}
        />

        <PageRoute
          path={RouteMap[PageMap.SETTINGS_SSO]?.toString() || ""}
          element={<SettingsSso />}
        />

        {/*
         * The instance-wide SAML and OIDC providers were listed on pages of
         * their own; both lists are on Single Sign-On now. A bookmark of
         * either address opens it - replaced, so Back skips the old address.
         */}
        <PageRoute
          path={RouteMap[PageMap.SETTINGS_GLOBAL_SSO]?.toString() || ""}
          element={
            <Navigate
              replace={true}
              to={RouteMap[PageMap.SETTINGS_SSO]?.toString() || ""}
            />
          }
        />

        <PageRoute
          path={RouteMap[PageMap.SETTINGS_GLOBAL_SSO_VIEW]?.toString() || ""}
          element={<SettingsGlobalSSOView />}
        />

        <PageRoute
          path={RouteMap[PageMap.SETTINGS_GLOBAL_OIDC]?.toString() || ""}
          element={
            <Navigate
              replace={true}
              to={RouteMap[PageMap.SETTINGS_SSO]?.toString() || ""}
            />
          }
        />

        <PageRoute
          path={RouteMap[PageMap.SETTINGS_GLOBAL_OIDC_VIEW]?.toString() || ""}
          element={<SettingsGlobalOIDCView />}
        />

        <PageRoute
          path={RouteMap[PageMap.SETTINGS_API_KEY]?.toString() || ""}
          element={<SettingsAPIKey />}
        />

        <PageRoute
          path={RouteMap[PageMap.SETTINGS_DATA_RETENTION]?.toString() || ""}
          element={<SettingsDataRetention />}
        />

        {/*
         * Settings pages an Enterprise area adds (EnterpriseSettingsPage),
         * read here in render (never at module load); the Community stub
         * has none.
         */}
        {(getAdminDashboardPlugins().SettingsPages || []).map(
          (page: EnterpriseSettingsPage) => {
            const SettingsPage: EnterprisePluginComponent = page.component;

            return (
              <PageRoute
                key={page.path}
                path={getEnterpriseSettingsPageRoute(page.path).toString()}
                element={
                  <Suspense fallback={<PageLoader isVisible={true} />}>
                    <SettingsPage />
                  </Suspense>
                }
              />
            );
          },
        )}

        <PageRoute
          path={RouteMap[PageMap.SEND_EMAIL]?.toString() || ""}
          element={<SendEmail />}
        />

        <PageRoute
          path={RouteMap[PageMap.MORE_EMAIL]?.toString() || ""}
          element={<MoreEmail />}
        />
      </Routes>
    </MasterPage>
  );
};

export default App;
