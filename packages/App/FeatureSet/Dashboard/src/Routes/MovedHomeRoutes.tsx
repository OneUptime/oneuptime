import MovedPageRedirect from "../Components/Routing/MovedPageRedirect";
import PageMap from "../Utils/PageMap";
import { MOVED_HOME_LIST_PATHS } from "./MovedPagePaths";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

/*
 * Home is one page, the overview, with no side menu. It used to hold its own
 * copies of six of the products' lists, so a click on Home's Active Alerts
 * opened a Home page instead of Alerts > Active Alerts, with Home's menu in
 * place of the one in Alerts. Bookmarks, browser history and links pasted
 * into wikis and chats still point at those copies, so each address forwards
 * to the product's own list - keeping the query string and the hash
 * (MovedPageRedirect) - and an address under Home that never was a page
 * lands on Home itself, never on a blank page.
 */

// Mounted at …/home/*. Home (…/home/) outranks it, so it never sees Home.
const MovedHomeRoutes: FunctionComponent = (): ReactElement => {
  return (
    <Routes>
      <PageRoute
        path={MOVED_HOME_LIST_PATHS.activeIncidents}
        element={<MovedPageRedirect pageMap={PageMap.UNRESOLVED_INCIDENTS} />}
      />
      <PageRoute
        path={MOVED_HOME_LIST_PATHS.activeIncidentEpisodes}
        element={
          <MovedPageRedirect pageMap={PageMap.UNRESOLVED_INCIDENT_EPISODES} />
        }
      />
      <PageRoute
        path={MOVED_HOME_LIST_PATHS.activeAlerts}
        element={<MovedPageRedirect pageMap={PageMap.UNRESOLVED_ALERTS} />}
      />
      <PageRoute
        path={MOVED_HOME_LIST_PATHS.activeAlertEpisodes}
        element={
          <MovedPageRedirect pageMap={PageMap.UNRESOLVED_ALERT_EPISODES} />
        }
      />
      <PageRoute
        path={MOVED_HOME_LIST_PATHS.notOperationalMonitors}
        element={<MovedPageRedirect pageMap={PageMap.MONITORS_INOPERATIONAL} />}
      />
      <PageRoute
        path={MOVED_HOME_LIST_PATHS.ongoingScheduledMaintenance}
        element={
          <MovedPageRedirect
            pageMap={PageMap.ONGOING_SCHEDULED_MAINTENANCE_EVENTS}
          />
        }
      />
      <PageRoute
        path="*"
        element={<MovedPageRedirect pageMap={PageMap.HOME} />}
      />
    </Routes>
  );
};

export default MovedHomeRoutes;
