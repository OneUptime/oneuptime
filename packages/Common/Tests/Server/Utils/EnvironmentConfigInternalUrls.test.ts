import { describe, expect, it } from "@jest/globals";
import {
  StatusPageApiInternalUrl,
  DashboardApiInternalUrl,
  AppApiHostname,
} from "../../../Server/EnvironmentConfig";
import Protocol from "../../../Types/API/Protocol";
import URL from "../../../Types/API/URL";

describe("EnvironmentConfig Internal URLs", () => {
  it("StatusPageApiInternalUrl should use HTTP protocol and AppApiHostname", () => {
    expect(StatusPageApiInternalUrl.protocol).toBe(Protocol.HTTP);
    expect(StatusPageApiInternalUrl.hostname.toString()).toBe(
      AppApiHostname.toString(),
    );
    expect(StatusPageApiInternalUrl.route.toString()).toBe("/api/status-page");
  });

  it("DashboardApiInternalUrl should use HTTP protocol and AppApiHostname", () => {
    expect(DashboardApiInternalUrl.protocol).toBe(Protocol.HTTP);
    expect(DashboardApiInternalUrl.hostname.toString()).toBe(
      AppApiHostname.toString(),
    );
    expect(DashboardApiInternalUrl.route.toString()).toBe("/api/dashboard");
  });

  it("StatusPageApiInternalUrl should construct correct URL when adding route", () => {
    const seoUrl: URL = URL.fromString(
      StatusPageApiInternalUrl.toString(),
    ).addRoute("/seo/test-page");

    expect(seoUrl.toString()).toBe(
      `http://${AppApiHostname.toString()}/api/status-page/seo/test-page`,
    );
  });

  it("DashboardApiInternalUrl should construct correct URL when adding route", () => {
    const seoUrl: URL = URL.fromString(
      DashboardApiInternalUrl.toString(),
    ).addRoute("/seo/test-dashboard");

    expect(seoUrl.toString()).toBe(
      `http://${AppApiHostname.toString()}/api/dashboard/seo/test-dashboard`,
    );
  });
});
