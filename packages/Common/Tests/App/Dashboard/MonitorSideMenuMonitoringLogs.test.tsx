import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup } from "@testing-library/react";
import React from "react";

/*
 * MONITORING LOGS ON EVERY MONITOR BUT A MANUAL ONE (issue #6639).
 *
 * Each check of a monitor is written to its Monitoring Logs - a probe's,
 * an incoming request's or email's, a server's report, and the telemetry
 * worker's check of a Metrics, Logs, Kubernetes or any other telemetry
 * monitor alike (MonitorResourceUtil.monitorResource ends every evaluation
 * with MonitorLogUtil.saveMonitorLog). The monitor's menu left the page out
 * for every telemetry monitor, so their checks could not be read. Every
 * monitor type's menu is drawn here: each but Manual's has the entry, in
 * Activity, pointing at the monitor's own logs.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

import MonitorSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  activeLinkTitles,
  goTo,
  linksIn,
  MenuLink,
  PROJECT_ID,
  renderMenu,
  titlesInMenu,
} from "./SideMenuHarness";

const MONITOR_ID: string = "8d8d8d8d-0000-4000-8000-0000000006f9";
const LOGS_PATH: string = `/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID}/logs`;

const ALL_MONITOR_TYPES: Array<MonitorType> = Object.values(MonitorType);

const WITH_LOGS: Array<MonitorType> = ALL_MONITOR_TYPES.filter(
  (monitorType: MonitorType): boolean => {
    return monitorType !== MonitorType.Manual;
  },
);

function logsRoute(): string {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.MONITOR_VIEW_LOGS] as Route,
    { modelId: new ObjectID(MONITOR_ID) },
  ).toString();
}

async function renderMonitorMenu(monitorType: MonitorType): Promise<void> {
  await renderMenu(
    <MonitorSideMenu
      modelId={new ObjectID(MONITOR_ID)}
      monitorType={monitorType}
    />,
  );
}

beforeEach(() => {
  // On the page itself, so Activity is open whichever sections fold.
  goTo(LOGS_PATH);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Monitoring Logs in a monitor's menu", () => {
  test("is offered for the monitors the issue named: metrics, and every telemetry type", () => {
    expect(WITH_LOGS).toContain(MonitorType.Metrics);

    for (const monitorType of MonitorTypeHelper.getTelemetryMonitorTypes()) {
      expect(WITH_LOGS).toContain(monitorType);
    }

    expect(WITH_LOGS).toHaveLength(ALL_MONITOR_TYPES.length - 1);
  });

  test.each(WITH_LOGS)(
    "%s monitors have Monitoring Logs in Activity, pointing at their own logs",
    async (monitorType: MonitorType) => {
      await renderMonitorMenu(monitorType);

      const entries: Array<MenuLink> = linksIn("Activity").filter(
        (link: MenuLink): boolean => {
          return link.title === "Monitoring Logs";
        },
      );

      expect(entries).toEqual([
        { title: "Monitoring Logs", href: logsRoute() },
      ]);
      expect(entries[0]!.href).toBe(LOGS_PATH);
    },
  );

  test("a Manual monitor, which checks nothing, has none", async () => {
    await renderMonitorMenu(MonitorType.Manual);

    expect(titlesInMenu()).not.toContain("Monitoring Logs");
  });

  test("a Metrics monitor's Activity lists it after its incidents, alerts and notifications", async () => {
    await renderMonitorMenu(MonitorType.Metrics);

    expect(
      linksIn("Activity").map((link: MenuLink): string => {
        return link.title;
      }),
    ).toEqual(["Incidents", "Alerts", "Notification Logs", "Monitoring Logs"]);
  });

  test("on a Kubernetes monitor's logs, the entry is the page you are on", async () => {
    await renderMonitorMenu(MonitorType.Kubernetes);

    expect(activeLinkTitles()).toEqual(["Monitoring Logs"]);
  });
});
