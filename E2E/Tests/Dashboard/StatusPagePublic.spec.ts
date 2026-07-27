import {
  APIRequestContext,
  Browser,
  BrowserContext,
  Page,
  expect,
  test,
} from "@playwright/test";
import Faker from "Common/Utils/Faker";
import { IS_BILLING_ENABLED } from "../../Config";
import { registerAndCreateProject } from "./Helpers/ProductOnboarding";
import {
  buildUrl,
  createItem,
  getProjectDefaults,
  JSONish,
  listItems,
  pollUntil,
  ProjectDefaults,
  toId,
} from "./Helpers/MonitorAlerting";
import {
  findResourceByDisplayName,
  publicPost,
  publicPostStatus,
  statusNameForResource,
  waitForStatusPageToRender,
} from "./Helpers/StatusPagePublic";

/*
 * Status page end to end: dashboard -> status page -> anonymous visitor.
 *
 * The existing status page coverage (Tests/StatusPage/Basic.spec.ts) only
 * loads a pre-provisioned URL from an env var and skips entirely when that
 * var is unset, so nothing verifies that a status page created today actually
 * serves anything. This spec builds one from scratch in a fresh project and
 * then reads it back the way a visitor would: from a request context with no
 * session cookies at all.
 *
 * Anti-flake notes:
 * - every wait is a deadline-bounded poll, never a fixed sleep
 * - names are run-unique so a re-run never collides with leftover rows
 * - the monitor is a manual monitor whose status the spec sets itself, so no
 *   probe has to agree before the assertions can run
 * - chromium only: this exercises server behaviour, not rendering engines
 */

/*
 * Status page announcements are gated behind the Growth plan when billing is
 * enabled (TableBillingAccessControl on StatusPageAnnouncement), so the
 * billing-enabled run has to land on that plan rather than the free one.
 */
const PREFERRED_PLAN_NAME: string = "Growth";

test.describe.configure({ mode: "serial", retries: 1 });

test.describe("public status page", () => {
  test.skip(({ browserName }: { browserName: string }) => {
    return browserName !== "chromium";
  }, "server behaviour, one engine is enough");

  test("should publish a status page that an anonymous visitor can read", async ({
    page,
    browser,
  }: {
    page: Page;
    browser: Browser;
  }) => {
    test.setTimeout(600000);

    const unique: string = Faker.generateName().toString().replace(/\s/g, "-");

    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "Status Page E2E",
      preferredPlanName: IS_BILLING_ENABLED ? PREFERRED_PLAN_NAME : undefined,
    });

    const defaults: ProjectDefaults = await getProjectDefaults({
      page,
      projectId,
    });

    /*
     * A manual monitor: its status is whatever the API last set, with no
     * probe in the loop. That keeps this spec about the status page rather
     * than about monitoring, which MonitorIncidentOnCall.spec.ts already
     * covers end to end.
     */
    const monitorName: string = `status-page-monitor-${unique}`;

    const monitor: JSONish = await createItem({
      page,
      projectId,
      path: "/api/monitor",
      item: {
        name: monitorName,
        description: "Manual monitor backing a status page resource.",
        projectId,
        monitorType: "Manual",
        currentMonitorStatusId: defaults.operationalMonitorStatusId,
      },
    });

    /*
     * MonitorService seeds the matching status timeline row asynchronously
     * after the create response returns, and the status page overview renders
     * from that timeline rather than from the monitor column — so every
     * assertion on the reported status below has to be a poll.
     */
    const monitorId: string = toId(monitor["_id"]);
    expect(monitorId, "monitor should have been created").not.toBe("");

    // Create the status page itself.
    const statusPageName: string = `Status Page ${unique}`;

    const statusPage: JSONish = await createItem({
      page,
      projectId,
      path: "/api/status-page",
      item: {
        name: statusPageName,
        description: "Created by StatusPagePublic.spec.ts",
        projectId,
        pageTitle: statusPageName,
        isPublicStatusPage: true,
      },
    });

    const statusPageId: string = toId(statusPage["_id"]);
    expect(statusPageId, "status page should have been created").not.toBe("");

    // Attach the monitor to the page as a visible resource.
    const resourceDisplayName: string = `Checkout API ${unique}`;

    await createItem({
      page,
      projectId,
      path: "/api/status-page-resource",
      item: {
        projectId,
        statusPageId,
        monitorId,
        displayName: resourceDisplayName,
        displayDescription: "Resource added by the status page e2e spec.",
        showStatusHistoryChart: true,
        showCurrentStatus: true,
        order: 1,
      },
    });

    // Publish an announcement that should show up on the public page.
    const announcementTitle: string = `Planned rollout ${unique}`;

    await createItem({
      page,
      projectId,
      path: "/api/status-page-announcement",
      item: {
        projectId,
        title: announcementTitle,
        description: "We are rolling out a change to the checkout service.",
        statusPages: [{ _id: statusPageId, projectId }],
        showAnnouncementAt: new Date(Date.now() - 60 * 1000).toISOString(),
        shouldStatusPageSubscribersBeNotified: false,
      },
    });

    /*
     * From here on, read the page as a stranger: a brand new context with no
     * cookies. If any of this only works with the creating user's session,
     * the status page is not public and these calls fail.
     */
    const anonymous: APIRequestContext = (await browser.newContext()).request;

    const masterPage: JSONish = await pollUntil<JSONish>({
      page,
      description: "the status page master-page payload to be readable",
      timeoutMs: 120000,
      check: async (): Promise<JSONish | null> => {
        const body: JSONish = await publicPost({
          request: anonymous,
          path: `/api/status-page/master-page/${statusPageId}`,
        });

        return body["statusPage"] || body["_id"] ? body : null;
      },
    });

    expect(JSON.stringify(masterPage)).toContain(statusPageName);

    // The overview payload is what the status page UI renders from.
    const overview: JSONish = await pollUntil<JSONish>({
      page,
      description: "the status page resource to appear in the overview",
      timeoutMs: 120000,
      check: async (): Promise<JSONish | null> => {
        const body: JSONish = await publicPost({
          request: anonymous,
          path: `/api/status-page/overview/${statusPageId}`,
        });

        return findResourceByDisplayName({
          overview: body,
          displayName: resourceDisplayName,
        })
          ? body
          : null;
      },
    });

    const resource: JSONish = findResourceByDisplayName({
      overview,
      displayName: resourceDisplayName,
    })!;

    expect(toId(resource["monitorId"])).toEqual(monitorId);

    /*
     * The monitor's timeline says operational, so the public page must too.
     * This is the assertion that ties a dashboard-side monitor status to what
     * a visitor actually sees.
     */
    const operationalStatusName: string = await pollUntil<string>({
      page,
      description:
        "the public status page to report the monitor as operational",
      timeoutMs: 120000,
      check: async (): Promise<string | null> => {
        const body: JSONish = await publicPost({
          request: anonymous,
          path: `/api/status-page/overview/${statusPageId}`,
        });

        const current: JSONish | null = findResourceByDisplayName({
          overview: body,
          displayName: resourceDisplayName,
        });

        if (!current) {
          return null;
        }

        const name: string = statusNameForResource({
          overview: body,
          resource: current,
        });

        return name.toLowerCase().includes("operational") ? name : null;
      },
    });

    expect(operationalStatusName.toLowerCase()).toContain("operational");

    // The announcement must be visible to the anonymous reader too.
    const announcements: JSONish = await pollUntil<JSONish>({
      page,
      description: "the announcement to appear on the public status page",
      timeoutMs: 120000,
      check: async (): Promise<JSONish | null> => {
        const body: JSONish = await publicPost({
          request: anonymous,
          path: `/api/status-page/announcements/${statusPageId}`,
          body: { limit: 10, skip: 0 },
        });

        return JSON.stringify(body).includes(announcementTitle) ? body : null;
      },
    });

    expect(JSON.stringify(announcements)).toContain(announcementTitle);

    /*
     * Flip the monitor to offline and assert the public page follows. This is
     * the whole reason a status page exists, and nothing else in the suite
     * asserts that the status actually propagates to the public payload.
     */
    await createItem({
      page,
      projectId,
      path: "/api/monitor-status-timeline",
      item: {
        projectId,
        monitorId,
        monitorStatusId: defaults.offlineMonitorStatusId,
        startsAt: new Date().toISOString(),
      },
    });

    const offlineStatusName: string = await pollUntil<string>({
      page,
      description: "the public status page to report the monitor as offline",
      timeoutMs: 180000,
      check: async (): Promise<string | null> => {
        const body: JSONish = await publicPost({
          request: anonymous,
          path: `/api/status-page/overview/${statusPageId}`,
        });

        const current: JSONish | null = findResourceByDisplayName({
          overview: body,
          displayName: resourceDisplayName,
        });

        if (!current) {
          return null;
        }

        const name: string = statusNameForResource({
          overview: body,
          resource: current,
        });

        return name.toLowerCase().includes("offline") ? name : null;
      },
    });

    expect(offlineStatusName.toLowerCase()).toContain("offline");

    // Finally, the browser-rendered page must mount for the anonymous visitor.
    const visitorContext: BrowserContext = await browser.newContext();
    const visitorPage: Page = await visitorContext.newPage();

    try {
      await waitForStatusPageToRender({ page: visitorPage, statusPageId });
      await expect(visitorPage.locator("body")).toContainText(
        resourceDisplayName,
        { timeout: 60000 },
      );
    } finally {
      await visitorContext.close();
    }
  });

  test("should not expose a private status page to an anonymous visitor", async ({
    page,
    browser,
  }: {
    page: Page;
    browser: Browser;
  }) => {
    test.setTimeout(600000);

    const unique: string = Faker.generateName().toString().replace(/\s/g, "-");

    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "Private Status Page E2E",
    });

    const statusPage: JSONish = await createItem({
      page,
      projectId,
      path: "/api/status-page",
      item: {
        name: `Private Status Page ${unique}`,
        description: "Private page created by StatusPagePublic.spec.ts",
        projectId,
        pageTitle: `Private Status Page ${unique}`,
        isPublicStatusPage: false,
      },
    });

    const statusPageId: string = toId(statusPage["_id"]);
    expect(statusPageId, "status page should have been created").not.toBe("");

    /*
     * The owning session can still read it — that guards against this test
     * passing because the page was never created or the id is wrong.
     */
    const ownerView: JSONish = await pollUntil<JSONish>({
      page,
      description: "the owning session to be able to read the private page",
      timeoutMs: 120000,
      check: async (): Promise<JSONish | null> => {
        const rows: Array<JSONish> = await listItems({
          page,
          projectId,
          path: "/api/status-page",
          query: { _id: statusPageId },
          select: { _id: true, name: true, isPublicStatusPage: true },
        });

        return rows[0] || null;
      },
    });

    expect(ownerView["isPublicStatusPage"]).toBe(false);

    const anonymous: APIRequestContext = (await browser.newContext()).request;

    const status: number = await publicPostStatus({
      request: anonymous,
      path: `/api/status-page/overview/${statusPageId}`,
    });

    /*
     * Must be a deliberate client-side rejection (401/403), not a 5xx: a
     * server error would also be "not a 200" while telling us nothing about
     * whether the page is actually protected.
     */
    expect(
      status,
      `an anonymous request for a private status page overview should be rejected, got ${status} from ${buildUrl(
        `/api/status-page/overview/${statusPageId}`,
      )}`,
    ).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });
});
