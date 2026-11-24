/*
 * The Dashboard for the journey budgets: its own App (src/App.tsx) - the
 * header, the products menu, every route and side menu - from this branch,
 * over a project made a minute ago (Fixture/NewProject.js) kept in memory
 * (Fixture/Store.js). Only the data boundary and the signed-in person are
 * replaced; every page, form, dialog and menu a journey passes through is
 * the production one.
 *
 * Steered by the query string (kept for the tab, so a reload or a link
 * that drops it changes nothing):
 *   - seed=<a,b>   what earlier journeys left behind, so each journey can
 *                  start where a newcomer would: `monitor` (the website
 *                  monitor of the first journey), and `busy`, a project in
 *                  use (Fixture/NewProject.js lists them all)
 *   - as=member    signed in as Grace Hopper, a member invited a minute
 *                  ago, not as the project's owner
 *   - as=admin     signed in as Ada, also the master admin of a self-hosted
 *                  server that has no Twilio: no SMS and no calls
 *   - as=viewer    signed in as Grace, a Project Viewer: reads everything,
 *                  may create nothing
 *   - billing=on   OneUptime Cloud (server.js sets BILLING_ENABLED)
 *   - theme=dark   the dark theme (server.js draws the light one otherwise)
 *   - email=off    a server that cannot send email yet (its admin has not
 *                  set it up): /global-config/vars says so
 *   - test=unanswered  a test page nobody acknowledges: it keeps paging
 *
 * Recorded on window.__journeyFixture: every write (`writes`: creates,
 * updates and deletes, with the misc data sent beside a create), every API
 * request a route answered (`api`), and every one none did (`unhandled`).
 */
import "Common/UI/Styles/Theme.css";
/*
 * A monitor's steps and criteria read back from JSON as the Dashboard's own
 * entry (src/Index.tsx) has them read: their types join JSON reading as
 * this module loads. Without it a monitor's steps stay the plain object
 * they were sent as, and the website setup finds no monitor checking an
 * address, so a run the browser lost makes a second one.
 */
import "Common/Types/Monitor/MonitorJsonTypes";
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "../../../App/FeatureSet/Dashboard/src/App";
import { i18nReady } from "../../../App/FeatureSet/Dashboard/src/Utils/i18n";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import API from "Common/UI/Utils/API/API";
import BaseAPI from "Common/Utils/API";
import Realtime from "Common/UI/Utils/Realtime";
import ThemeUtil from "Common/UI/Utils/Theme";
import {
  createStore,
  installAnalyticsModelApi,
  installApi,
  installModelApi,
  silenceRealtime,
} from "./Store";
import {
  seedNewProject,
  signIn,
  dashboardRoutes,
  dashboardHooks,
} from "./NewProject";

// The query parameters, kept for the tab by server.js's boot script.
const params = window.__journeyParams || {};

const log = {
  writes: [],
  reads: [],
  api: [],
  unhandled: [],
};
window.__journeyFixture = log;

const project = seedNewProject({
  createStore,
  log,
  seeds: String(params.seed || "")
    .split(",")
    .filter(Boolean),
  billing: params.billing === "on",
  canSendEmail: params.email !== "off",
  isTestPageAnswered: params.test !== "unanswered",
  /*
   * ?world=<name>: the server state this tab shares with every other tab
   * and browser that names it (server.js), as devices share one server.
   */
  world: /^[A-Za-z0-9_-]{1,64}$/.test(String(params.world || ""))
    ? String(params.world)
    : null,
});

signIn(
  project,
  ["member", "admin", "viewer"].includes(params.as) ? params.as : "owner",
);

installModelApi(ModelAPI, project.store, dashboardHooks(project), {
  // ?refuse=<Table>: that table's first create fails, once per tab.
  refuse: String(params.refuse || "")
    .split(",")
    .filter(Boolean),
});
installAnalyticsModelApi(AnalyticsModelAPI, project.store);
installApi([API, BaseAPI], project.store, dashboardRoutes(project));
silenceRealtime(Realtime);

/*
 * The theme server.js kept for the tab (light, or ?theme=dark), drawn as
 * the Dashboard's src/Index.tsx draws it before the first render.
 */
ThemeUtil.initialize();

await i18nReady.catch(() => {});

/*
 * As the Dashboard's src/Index.tsx renders it: each navigation renders at
 * once, not in a React transition (Tests/Ops/E2EFixtureRouters).
 */
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <App />
  </BrowserRouter>,
);
