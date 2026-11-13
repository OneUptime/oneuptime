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
import ServerSetupChecklistUtil from "Common/Types/ServerSetup/ServerSetupChecklist";
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

/*
 * Whether the server's email works, as the server would say it (#6825):
 * not set up until the SMTP server and its sender are saved, then untested
 * until a test email is accepted, then working.
 */
let isTestEmailAccepted = false;

function emailState() {
  const config = store.table(GlobalConfig)[0] || {};
  const isSetUp = Boolean(
    config.smtpHost && config.smtpPort && config.smtpFromEmail && config.smtpFromName,
  );

  if (!isSetUp) {
    return "not-set-up";
  }

  return isTestEmailAccepted ? "working" : "untested";
}

function emailStatus() {
  const state = emailState();

  return {
    channel: "email",
    state: state,
    hasWorked: state === "working",
    lastWorkedAt: state === "working" ? store.NOW.toISOString() : null,
    failingSince: null,
    lastFailure: null,
    setUpProblem:
      state === "not-set-up"
        ? "Nothing is set up under Settings > Emails yet."
        : null,
  };
}

const NOT_SET_UP = (channel) => {
  return {
    channel: channel,
    state: "not-set-up",
    hasWorked: false,
    lastWorkedAt: null,
    failingSince: null,
    lastFailure: null,
    setUpProblem: "No Twilio account or SMS gateway is set up.",
  };
};

/*
 * The server's setup checklist (#6824), worked out by the same rules the
 * server uses (Types/ServerSetup), from what this fresh server holds.
 */
function setupChecklist() {
  const config = store.table(GlobalConfig)[0] || {};

  return ServerSetupChecklistUtil.getAnswer({
    facts: {
      isHttpsSetUp: false,
      areSignupsClosed: config.disableSignup === true,
      email: emailStatus(),
      sms: NOT_SET_UP("sms"),
      call: NOT_SET_UP("call"),
      emailSentThrough: config.smtpHost || null,
      smsSentThrough: "Twilio",
      callSentThrough: "Twilio",
      globalProbes: { total: 1, reporting: 1 },
      updateChecks: {
        isDisabled: false,
        lastCheckedAt: store.NOW.toISOString(),
        lastFailure: null,
      },
      lastBackup: null,
      hasScheduledBackups: false,
      isBrowserPushSetUp: false,
      hasAiProvider: false,
      hasSingleSignOn: false,
      choices: { choices: {}, hiddenBy: {} },
    },
    readerUserId: ada._id,
  });
}

installApi([API, BaseAPI], store, [
  [
    // Send Email's announcement test, which used to be the only test send.
    "POST",
    "/admin/email/send-test",
    () => {
      return ok({});
    },
  ],
  [
    // "Send test email": through the mail server just saved, accepted.
    "POST",
    "/server-test/email",
    ({ body }) => {
      isTestEmailAccepted = true;
      return ok({
        channel: "email",
        result: "accepted",
        to: body.toEmail,
        sentThrough: (store.table(GlobalConfig)[0] || {}).smtpHost || null,
        message: null,
      });
    },
  ],
  [
    "GET",
    "/global-config/sending-status",
    () => {
      return ok({
        channels: [
          emailStatus(),
          NOT_SET_UP("sms"),
          NOT_SET_UP("call"),
          {
            ...NOT_SET_UP("push"),
            state: "untested",
            setUpProblem: null,
          },
        ],
        globalProbes: { total: 1, reporting: 1 },
      });
    },
  ],
  [
    "GET",
    "/global-config/setup-checklist",
    () => {
      return ok(JSON.parse(JSON.stringify(setupChecklist())));
    },
  ],
  [
    "GET",
    "/global-config/vars",
    () => {
      return ok({
        disableUserProjectCreation: false,
        disablePushNotifications: false,
        canSendEmail: emailState() !== "not-set-up",
      });
    },
  ],
]);
silenceRealtime(Realtime);

/*
 * As the Admin Dashboard's src/Index.tsx renders it: its router keeps React
 * Router's transitions (Tests/Ops/E2EFixtureRouters).
 */
createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
