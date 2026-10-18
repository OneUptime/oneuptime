import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DashboardFallbackRoutePrefixesToSkip,
  StatusPageDomainFallbackRoutePrefixesToSkip,
  shouldSkipDashboardFallbackRoute,
  shouldSkipStatusPageDomainFallbackRoute,
} from "../../FeatureSet/Frontend/RouteReservations";
import MaintenanceCalendarLinks from "Common/Types/ScheduledMaintenance/MaintenanceCalendarLinks";

/*
 * Where a status page's maintenance calendar is served: the Frontend app,
 * beside the page's RSS feed, on the page's own domain (/maintenance.ics)
 * and on its address under OneUptime (/status-page/<id>/maintenance.ics) -
 * the two paths the page's Subscribe to calendar and Add to calendar build
 * (MaintenanceCalendarLinks). Behind the rate limiter, and reserved against
 * both SPA fallbacks, or a custom domain would answer a calendar app with
 * the status page's HTML.
 *
 * Frontend/Index.ts cannot be imported (it builds the app at module scope),
 * so its registration is read from the source.
 */

const WHITESPACE_RUN: RegExp = /\s+/g;

const FRONTEND_INDEX: string = fs
  .readFileSync(
    path.join(__dirname, "..", "..", "FeatureSet", "Frontend", "Index.ts"),
    "utf8",
  )
  .replace(WHITESPACE_RUN, " ");

const STATUS_PAGE_ID: string = "7a000000-0000-4000-8000-000000000001";

const REGISTRATION: string =
  'app.get( ["/maintenance.ics", "/status-page/:statusPageId/maintenance.ics"], StatusPageMaintenanceCalendarFeed.getRateLimitMiddleware(), StatusPageMaintenanceCalendarFeed.getHandler(), );';

describe("the status page's maintenance calendar routes", () => {
  test("are registered on both of a page's addresses, rate limited first", () => {
    expect(FRONTEND_INDEX).toContain(REGISTRATION);
  });

  test("beside the RSS feed, and before the SPA fallbacks are registered", () => {
    const rss: number = FRONTEND_INDEX.indexOf(
      'app.get("/status-page/:statusPageId/rss", handleRSS);',
    );
    const calendar: number = FRONTEND_INDEX.indexOf(REGISTRATION);
    const fallbacks: number = FRONTEND_INDEX.indexOf(
      "registerCustomDomainFallback(); registerDashboardFallbackForPrimaryHost();",
    );

    expect(rss).toBeGreaterThan(-1);
    expect(calendar).toBeGreaterThan(rss);
    expect(fallbacks).toBeGreaterThan(calendar);
  });

  test("are the paths the page's own buttons build", () => {
    expect(
      MaintenanceCalendarLinks.getStatusPageCalendarPath({
        isPreview: false,
      }),
    ).toBe("/maintenance.ics");
    expect(
      MaintenanceCalendarLinks.getStatusPageCalendarPath({
        isPreview: true,
        statusPageId: STATUS_PAGE_ID,
      }),
    ).toBe(`/status-page/${STATUS_PAGE_ID}/maintenance.ics`);
  });

  test("are reserved against the custom domain's status page HTML", () => {
    expect(StatusPageDomainFallbackRoutePrefixesToSkip).toContain(
      "/maintenance.ics",
    );
    expect(shouldSkipStatusPageDomainFallbackRoute("/maintenance.ics")).toBe(
      true,
    );
  });

  test("are reserved against the primary host's Dashboard HTML", () => {
    expect(DashboardFallbackRoutePrefixesToSkip).toContain("/maintenance.ics");
    expect(shouldSkipDashboardFallbackRoute("/maintenance.ics")).toBe(true);
  });

  test("reserve nothing else: a page's own path that merely starts alike is still the page", () => {
    expect(shouldSkipStatusPageDomainFallbackRoute("/maintenance")).toBe(false);
    expect(
      shouldSkipStatusPageDomainFallbackRoute("/maintenance.ics-and-more"),
    ).toBe(false);
  });
});
