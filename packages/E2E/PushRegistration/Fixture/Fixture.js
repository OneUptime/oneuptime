/*
 * Offline fixture for Register Device: the real Push component from this
 * branch, signed in as a synthetic user of a synthetic project.
 *
 * Only the table's list read is replaced, by the devices the fixture server
 * holds - so a device the page managed to register is listed after a reload,
 * and one it did not is not. Registering and sending a test go through the
 * Dashboard's own API client to the fixture server, as JSON over the wire.
 *
 * On every start it tells OneUptime's service worker, if the browser has
 * one, the server's push key, as the Dashboard's Index.tsx does.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import Push from "../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Push";
import { sendPushConfigurationToRegisteredServiceWorker } from "../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/BrowserPushRegistration";
import { VAPID_PUBLIC_KEY } from "Common/UI/Config";
import UserPush from "Common/Models/DatabaseModels/UserPush";
import Permission from "Common/Types/Permission";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "80000000-0000-4000-8000-000000000001";

// Signed in: who this is, and the permission everybody holds over their own devices.
window.localStorage.setItem("user_id", USER_ID);
window.localStorage.setItem(
  "global_permissions",
  JSON.stringify({
    _type: "UserGlobalAccessPermission",
    globalPermissions: [Permission.CurrentUser],
    projectIds: [PROJECT_ID],
  }),
);

window.__fixture = { listReads: 0 };

ModelAPI.getCommonHeaders = () => {
  return { tenantid: PROJECT_ID };
};

ModelAPI.getList = async (options) => {
  window.__fixture.listReads++;

  if (new options.modelType().tableName !== "UserPush") {
    return { data: [], count: 0, skip: 0, limit: 10 };
  }

  const state = await (await fetch("/__fixture/state")).json();

  const devices = state.devices.map((stored) => {
    const device = new UserPush();
    device._id = stored.id;
    device.deviceName = stored.deviceName;
    device.isCriticalAlertEnabled = false;
    device.isVerified = stored.isVerified !== false;
    device.createdAt = new Date(stored.createdAt);
    return device;
  });

  return { data: devices, count: devices.length, skip: 0, limit: 10 };
};

if ("serviceWorker" in navigator) {
  void sendPushConfigurationToRegisteredServiceWorker({
    container: navigator.serviceWorker,
    vapidPublicKey: VAPID_PUBLIC_KEY,
  });
}

await i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
});

function Fixture() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return (
    <main className="mx-auto max-w-[1200px] px-8 py-8">
      <div className="mb-6 text-sm text-gray-500">
        User Settings <span className="mx-2">/</span> Notification Methods{" "}
        <span className="mx-2">/</span> Push Notifications
      </div>
      <Push />
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Fixture />
  </BrowserRouter>,
);
