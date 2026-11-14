import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  RECORDED_PAGES,
  getRecordedPagePatterns,
  isRecordedPath,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/DashboardRecording/RecordedPages";
import Route from "../../../Types/API/Route";

/*
 * The pages a recording of the Dashboard may see (#6834): the first run -
 * Welcome, Home, creating a monitor, the guided setups, How to Reach Me
 * and Project Settings' first page - and nothing else. Never an incident,
 * a monitor's own page, an explorer, or the settings that show keys,
 * members or billing.
 */

const PROJECT: string = "6a1c5e0f2b3d4c5e6f708192";
const RECORD: string = "7b2d6f1a3c4e5d6f7a8b9c0d";

const pathOf: (page: PageMap, modelId?: string) => string = (
  page: PageMap,
  modelId?: string,
): string => {
  const route: Route = RouteMap[page] as Route;

  return route
    .toString()
    .replace(":projectId", PROJECT)
    .replace(":id", modelId || RECORD);
};

describe("the recorded pages", () => {
  test("are named by their PageMap keys, and each has a route", () => {
    for (const page of RECORDED_PAGES) {
      expect(RouteMap[page]).toBeDefined();
    }

    expect(getRecordedPagePatterns().size).toBe(RECORDED_PAGES.length);
  });

  test("are the first run's pages", () => {
    expect([...RECORDED_PAGES].sort()).toEqual(
      [
        PageMap.WELCOME,
        PageMap.HOME,
        PageMap.MONITOR_CREATE,
        PageMap.MONITOR_GUIDED_SETUP,
        PageMap.ON_CALL_DUTY_GUIDED_SETUP,
        PageMap.STATUS_PAGES_GUIDED_SETUP,
        PageMap.SERVICES_GUIDED_SETUP,
        PageMap.USER_SETTINGS_NOTIFICATION_METHODS,
        PageMap.USER_SETTINGS_ON_CALL_RULES,
        PageMap.SETTINGS,
      ].sort(),
    );
  });

  test("are never written as addresses, so a moved page stays on the list", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Utils/DashboardRecording/RecordedPages.ts",
      ),
      "utf8",
    );

    expect(source).not.toMatch(/["'`]\/dashboard/);
  });

  test.each(
    RECORDED_PAGES.map((page: PageMap): [PageMap] => {
      return [page];
    }),
  )("records %s at its address", (page: PageMap) => {
    expect(isRecordedPath(pathOf(page))).toBe(true);
  });

  test("records an address with or without its trailing slash", () => {
    expect(isRecordedPath(`/dashboard/${PROJECT}/home`)).toBe(true);
    expect(isRecordedPath(`/dashboard/${PROJECT}/home/`)).toBe(true);
    expect(isRecordedPath(`/dashboard/${PROJECT}/settings`)).toBe(true);
  });
});

describe("pages never recorded", () => {
  test.each([
    PageMap.MONITOR_VIEW,
    PageMap.MONITORS,
    PageMap.INCIDENTS,
    PageMap.INCIDENT_VIEW,
    PageMap.ALERTS,
    PageMap.LOGS,
    PageMap.STATUS_PAGES,
    PageMap.SETTINGS_APIKEYS,
    PageMap.SETTINGS_BILLING,
    PageMap.SETTINGS_DANGERZONE,
    PageMap.USER_PROFILE_OVERVIEW,
  ])("%s", (page: PageMap) => {
    const route: Route | undefined = RouteMap[page];

    if (!route) {
      return;
    }

    expect(isRecordedPath(pathOf(page))).toBe(false);
  });

  test("a monitor's own page is not 'create', though both sit under /monitors", () => {
    expect(isRecordedPath(`/dashboard/${PROJECT}/monitors/${RECORD}`)).toBe(
      false,
    );
    expect(isRecordedPath(`/dashboard/${PROJECT}/monitors/create`)).toBe(true);
  });

  test("an address that is no page at all", () => {
    expect(isRecordedPath("/")).toBe(false);
    expect(isRecordedPath("/dashboard/not-a-page/at-all/here")).toBe(false);
    expect(isRecordedPath("")).toBe(false);
  });

  test("the page list is the one RouteUtil knows", () => {
    // A sanity check that the routes read here are the Dashboard's own.
    expect(RouteUtil.getRouteString(PageMap.HOME)).toContain("home");
  });
});
