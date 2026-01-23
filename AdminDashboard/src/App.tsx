import MasterPage from "./Components/MasterPage/MasterPage";
import Init from "./Pages/Init/Init";
import Logout from "./Pages/Logout/Logout";
import Projects from "./Pages/Projects/Index";
import SettingsAPIKey from "./Pages/Settings/APIKey/Index";
import SettingsAuthentication from "./Pages/Settings/Authentication/Index";
import SettingsDataRetention from "./Pages/Settings/DataRetention/Index";
import SettingsCallSMS from "./Pages/Settings/CallSMS/Index";
import SettingsWhatsApp from "./Pages/Settings/WhatsApp/Index";
// Settings Pages.
import SettingsEmail from "./Pages/Settings/Email/Index";
import SettingsProbes from "./Pages/Settings/Probes/Index";
import SettingsAIAgents from "./Pages/Settings/AIAgents/Index";
import SettingsLlmProviders from "./Pages/Settings/LlmProviders/Index";
import Users from "./Pages/Users/Index";
import PageMap from "./Utils/PageMap";
import RouteMap from "./Utils/RouteMap";
import URL from "Common/Types/API/URL";
import { ACCOUNTS_URL, DASHBOARD_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import User from "Common/UI/Utils/User";
import React from "react";
import {
  Route as PageRoute,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import UserView from "./Pages/Users/View/Index";
import UserDelete from "./Pages/Users/View/Delete";
import UserSettings from "./Pages/Users/View/Settings";
import ProjectView from "./Pages/Projects/View/Index";
import ProjectDelete from "./Pages/Projects/View/Delete";

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
      <Routes>
        <PageRoute
          path={RouteMap[PageMap.INIT]?.toString() || ""}
          element={<Init />}
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
          path={RouteMap[PageMap.SETTINGS_API_KEY]?.toString() || ""}
          element={<SettingsAPIKey />}
        />

        <PageRoute
          path={RouteMap[PageMap.SETTINGS_DATA_RETENTION]?.toString() || ""}
          element={<SettingsDataRetention />}
        />
      </Routes>
    </MasterPage>
  );
};

export default App;
