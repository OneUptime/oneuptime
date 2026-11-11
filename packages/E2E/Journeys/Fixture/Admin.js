/*
 * The Admin Dashboard for the journey budgets: its own App
 * (AdminDashboard/src/App.tsx) - its header, its products menu, Settings
 * and every route - from this branch, over a self-hosted server installed a
 * minute ago, kept in memory (Fixture/Store.js). Ada Lovelace made the first
 * account, so she is the server's master admin. Nothing is set up: the
 * server's email is OneUptime's default, which a self-hosted server cannot
 * send through (#6825).
 *
 * Recorded on window.__journeyFixture, as the Dashboard's fixture records.
 */
import "Common/UI/Styles/Theme.css";
import "../../../App/FeatureSet/AdminDashboard/src/Utils/i18n";
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "../../../App/FeatureSet/AdminDashboard/src/App";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import User from "Common/Models/DatabaseModels/User";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import API from "Common/UI/Utils/API/API";
import BaseAPI from "Common/Utils/API";
import Realtime from "Common/UI/Utils/Realtime";
import PermissionUtil from "Common/UI/Utils/Permission";
import UserUtil from "Common/UI/Utils/User";
import {
  createStore,
  installAnalyticsModelApi,
  installApi,
  installModelApi,
  ok,
  silenceRealtime,
} from "./Store";
import { ADA_ID } from "./NewProject";

const log = {
  writes: [],
  reads: [],
  api: [],
  unhandled: [],
};
window.__journeyFixture = log;

const store = createStore({
  projectId: undefined,
  log,
  journalKey: "__journeyAdminJournal",
});

const ada = store.insert(User, {
  _id: ADA_ID,
  name: new Name("Ada Lovelace"),
  email: new Email("ada@acme-commerce.example"),
  isEmailVerified: true,
  isMasterAdmin: true,
});

// The server's one settings row, as a fresh install leaves it.
store.insert(GlobalConfig, {
  _id: ObjectID.getZeroObjectID().toString(),
  emailServerType: undefined,
});

store.restore();

UserUtil.setUserId(new ObjectID(ada._id));
UserUtil.setEmail(ada.email);
UserUtil.setName(ada.name);
UserUtil.setIsMasterAdmin(true);
UserUtil.isMasterAdmin = () => true;
UserUtil.getUserId = () => new ObjectID(ada._id);
PermissionUtil.getAllPermissions = () => [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];
PermissionUtil.getGlobalPermissions = () => ({
  _type: "UserGlobalAccessPermission",
  globalPermissions: [
    Permission.Public,
    Permission.User,
    Permission.CurrentUser,
  ],
  projectIds: [],
});

installModelApi(ModelAPI, store, {});
installAnalyticsModelApi(AnalyticsModelAPI, store);
installApi([API, BaseAPI], store, [
  [
    // The test the admin sends: through the mail server just saved.
    "POST",
    "/admin/email/send-test",
    () => {
      return ok({});
    },
  ],
  [
    "GET",
    "/global-config/vars",
    () => {
      return ok({
        disableUserProjectCreation: false,
        disablePushNotifications: false,
      });
    },
  ],
]);
silenceRealtime(Realtime);

/*
 * As the Admin Dashboard's src/Index.tsx renders it, with each navigation
 * at once (Tests/Ops/E2EFixtureRouters).
 */
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <App />
  </BrowserRouter>,
);
