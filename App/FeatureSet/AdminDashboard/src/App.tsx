import MasterPage from "./Components/MasterPage/MasterPage";
import PageMap from "./Utils/PageMap";
import RouteMap from "./Utils/RouteMap";
import URL from "Common/Types/API/URL";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import { ACCOUNTS_URL, DASHBOARD_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import User from "Common/UI/Utils/User";
import React, { Suspense, lazy } from "react";
import {
  Route as PageRoute,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";

function lazyPage<T extends React.ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(loader);
}

const Init = lazyPage(() => import("./Pages/Init/Init"));
const Health = lazyPage(() => import("./Pages/Health/Index"));
const HealthPostgres = lazyPage(() => import("./Pages/Health/Postgres"));
const HealthClickhouse = lazyPage(() => import("./Pages/Health/Clickhouse"));
const HealthQueryConsole = lazyPage(() => import("./Pages/Health/QueryConsole"));
const HealthLogs = lazyPage(() => import("./Pages/Health/Logs"));
const HealthProbes = lazyPage(() => import("./Pages/Health/Probes"));
const HealthMigrations = lazyPage(() => import("./Pages/Health/Migrations"));
const HealthSupportBundle = lazyPage(() => import("./Pages/Health/Support"));
const Logout = lazyPage(() => import("./Pages/Logout/Logout"));
const Projects = lazyPage(() => import("./Pages/Projects/Index"));
const SettingsAPIKey = lazyPage(() => import("./Pages/Settings/APIKey/Index"));
const SettingsAuthentication = lazyPage(() =>
  import("./Pages/Settings/Authentication/Index"),
);
const SettingsGlobalSSO = lazyPage(() =>
  import("./Pages/Settings/GlobalSSO/Index"),
);
const SettingsGlobalSSOView = lazyPage(() =>
  import("./Pages/Settings/GlobalSSO/View"),
);
const SettingsGlobalOIDC = lazyPage(() =>
  import("./Pages/Settings/GlobalOIDC/Index"),
);
const SettingsGlobalOIDCView = lazyPage(() =>
  import("./Pages/Settings/GlobalOIDC/View"),
);
const SettingsDataRetention = lazyPage(() =>
  import("./Pages/Settings/DataRetention/Index"),
);
const SettingsCallSMS = lazyPage(() =>
  import("./Pages/Settings/CallSMS/Index"),
);
const SettingsWhatsApp = lazyPage(() =>
  import("./Pages/Settings/WhatsApp/Index"),
);
const SettingsTelegram = lazyPage(() =>
  import("./Pages/Settings/Telegram/Index"),
);
const SettingsEmail = lazyPage(() => import("./Pages/Settings/Email/Index"));
const SettingsProbes = lazyPage(() => import("./Pages/Settings/Probes/Index"));
const SettingsAIAgents = lazyPage(() =>
  import("./Pages/Settings/AIAgents/Index"),
);
const SettingsLlmProviders = lazyPage(() =>
  import("./Pages/Settings/LlmProviders/Index"),
);
const SendEmail = lazyPage(() => import("./Pages/SendEmail/Index"));
const MoreEmail = lazyPage(() => import("./Pages/More/Email"));
const Users = lazyPage(() => import("./Pages/Users/Index"));
const UserView = lazyPage(() => import("./Pages/Users/View/Index"));
const UserDelete = lazyPage(() => import("./Pages/Users/View/Delete"));
const UserSettings = lazyPage(() => import("./Pages/Users/View/Settings"));
const ProjectView = lazyPage(() => import("./Pages/Projects/View/Index"));
const ProjectDelete = lazyPage(() => import("./Pages/Projects/View/Delete"));
const ProjectUsers = lazyPage(() => import("./Pages/Projects/View/Users"));
const ProjectUserView = lazyPage(() =>
  import("./Pages/Projects/View/UserView"),
);
const ProjectTeams = lazyPage(() => import("./Pages/Projects/View/Teams"));
const ProjectTeamView = lazyPage(() =>
  import("./Pages/Projects/View/TeamView"),
);

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
      Navigation.navigate(URL.fromString(ACCOUNTS_URL.toString()));
    }
  }

  if (!User.isMasterAdmin()) {
    Navigation.navigate(URL.fromString(DASHBOARD_URL.toString()));
  }

  return (
    <MasterPage>
      <Suspense fallback={<PageLoader isVisible={true} />}>
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
            path={RouteMap[PageMap.HEALTH_POSTGRES]?.toString() || ""}
            element={<HealthPostgres />}
          />

          <PageRoute
            path={RouteMap[PageMap.HEALTH_CLICKHOUSE]?.toString() || ""}
            element={<HealthClickhouse />}
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
            path={RouteMap[PageMap.USER_VIEW]?.toString() || ""}
            element={<UserView />}
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
            path={RouteMap[PageMap.SETTINGS_AI_AGENTS]?.toString() || ""}
            element={<SettingsAIAgents />}
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
            path={RouteMap[PageMap.SETTINGS_GLOBAL_SSO]?.toString() || ""}
            element={<SettingsGlobalSSO />}
          />

          <PageRoute
            path={RouteMap[PageMap.SETTINGS_GLOBAL_SSO_VIEW]?.toString() || ""}
            element={<SettingsGlobalSSOView />}
          />

          <PageRoute
            path={RouteMap[PageMap.SETTINGS_GLOBAL_OIDC]?.toString() || ""}
            element={<SettingsGlobalOIDC />}
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

          <PageRoute
            path={RouteMap[PageMap.SEND_EMAIL]?.toString() || ""}
            element={<SendEmail />}
          />

          <PageRoute
            path={RouteMap[PageMap.MORE_EMAIL]?.toString() || ""}
            element={<MoreEmail />}
          />
        </Routes>
      </Suspense>
    </MasterPage>
  );
};

export default App;
