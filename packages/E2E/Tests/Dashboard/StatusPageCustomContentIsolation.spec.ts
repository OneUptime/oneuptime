import {
  Cookie,
  Page,
  Request,
  Response,
  expect,
  test,
} from "@playwright/test";
import CookieName from "Common/Types/CookieName";
import Faker from "Common/Utils/Faker";
import { IS_BILLING_ENABLED } from "../../Config";
import { registerAndCreateProject } from "./Helpers/ProductOnboarding";
import { buildUrl, createItem, JSONish, toId } from "./Helpers/MonitorAlerting";
import { publicPost } from "./Helpers/StatusPagePublic";

/*
 * End-to-end regression for GHSA-hc47-v5gg-4qq3.
 *
 * Status Page owners intentionally have rich customisation on their own
 * custom domains. The fallback URL is different: /status-page/:id is served
 * by the same origin as /dashboard, /admin and /api, so author-controlled
 * script or markup there would inherit an authenticated visitor's authority.
 *
 * This test uses the real authenticated browser context and a harmless local
 * probe URL. If the stored JavaScript executes, or an HTML event handler is
 * inserted, the DOM marker/request below makes the regression observable
 * without sending any data outside the test instance.
 */

const PREFERRED_PLAN_NAME: string = "Growth";

test.describe.configure({ mode: "serial", retries: 1 });

test.describe("status page custom content origin isolation", () => {
  test.skip(({ browserName }: { browserName: string }) => {
    return browserName !== "chromium";
  }, "the security boundary is origin-based, so one browser engine is enough");

  test("does not run tenant content on the authenticated application origin", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(600000);

    const unique: string = Faker.generateName().toString().replace(/\s/g, "-");
    const probePath: string = `/api/status-page-custom-content-probe/${unique}`;
    const markerAttribute: string = "data-status-page-custom-content-probe";

    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "Status Page Origin Isolation E2E",
      preferredPlanName: IS_BILLING_ENABLED ? PREFERRED_PLAN_NAME : undefined,
    });

    const statusPage: JSONish = await createItem({
      page,
      projectId,
      path: "/api/status-page",
      item: {
        name: `Origin Isolation ${unique}`,
        description: "Stored-content origin-isolation regression page.",
        projectId,
        pageTitle: `Origin Isolation ${unique}`,
        isPublicStatusPage: true,
        customCSS: `html { --status-page-custom-content-probe: "${unique}"; }`,
        customJavaScript: `
          document.documentElement.setAttribute(
            "${markerAttribute}",
            "javascript"
          );
          fetch("${probePath}", {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: "{}"
          });
        `,
        headerHTML: `
          <div data-testid="custom-content-header-${unique}">
            <img
              src="/missing-custom-content-image-${unique}"
              onerror="document.documentElement.setAttribute('${markerAttribute}', 'header-html')"
            />
          </div>
        `,
        footerHTML: `
          <svg
            data-testid="custom-content-footer-${unique}"
            onload="document.documentElement.setAttribute('${markerAttribute}', 'footer-html')"
          ></svg>
        `,
      },
    });

    const statusPageId: string = toId(statusPage["_id"]);
    expect(statusPageId, "status page should have been created").not.toBe("");

    const dashboardTokenBefore: Cookie | undefined = (
      await page.context().cookies()
    ).find((cookie: Cookie) => {
      return cookie.name === CookieName.Token;
    });

    expect(
      dashboardTokenBefore?.value,
      "the exploit reproduction must use an authenticated dashboard session",
    ).toBeTruthy();

    /*
     * The wire response itself must be safe. Client-side checks are useful
     * defence in depth, but publishing the payload to a shared origin leaves
     * every future rendering regression one step away from account takeover.
     */
    const masterPage: JSONish = await publicPost({
      request: page.request,
      path: `/api/status-page/master-page/${statusPageId}`,
    });

    expect(masterPage["allowStatusPageCustomizations"]).toBe(false);

    const statusPagePayload: JSONish = masterPage["statusPage"] as JSONish;
    for (const field of [
      "customCSS",
      "customJavaScript",
      "headerHTML",
      "footerHTML",
    ]) {
      expect(
        Object.prototype.hasOwnProperty.call(statusPagePayload, field),
        `${field} must not cross the shared-origin API boundary`,
      ).toBe(false);
    }

    const probeRequests: Array<string> = [];
    const recordProbeRequest: (request: Request) => void = (
      request: Request,
    ): void => {
      if (request.url().includes(probePath)) {
        probeRequests.push(request.url());
      }
    };

    page.on("request", recordProbeRequest);

    try {
      const documentResponse: Response | null = await page.goto(
        buildUrl(`/status-page/${statusPageId}`),
        { waitUntil: "domcontentloaded" },
      );

      expect(documentResponse?.status()).toBe(200);

      const contentSecurityPolicy: string =
        (await documentResponse?.headerValue("content-security-policy")) || "";

      expect(contentSecurityPolicy).toContain("script-src-attr 'none'");
      expect(contentSecurityPolicy).not.toContain("'unsafe-eval'");

      await page
        .locator('[data-testid="status-page-overview"]')
        .waitFor({ state: "visible", timeout: 120000 });

      /*
       * Let effects, image error events and the page-load callback drain. Two
       * animation frames are deterministic and avoid a fixed timeout.
       */
      await page.evaluate(async (): Promise<void> => {
        await new Promise<void>((resolve: () => void) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve();
            });
          });
        });
      });

      expect(
        await page.evaluate((attribute: string): string | null => {
          return document.documentElement.getAttribute(attribute);
        }, markerAttribute),
      ).toBeNull();

      expect(
        await page
          .locator(`[data-testid="custom-content-header-${unique}"]`)
          .count(),
      ).toBe(0);
      expect(
        await page
          .locator(`[data-testid="custom-content-footer-${unique}"]`)
          .count(),
      ).toBe(0);

      expect(
        await page.evaluate((): string => {
          return getComputedStyle(document.documentElement)
            .getPropertyValue("--status-page-custom-content-probe")
            .trim();
        }),
      ).toBe("");

      expect(probeRequests).toEqual([]);

      const dashboardTokenAfter: Cookie | undefined = (
        await page.context().cookies()
      ).find((cookie: Cookie) => {
        return cookie.name === CookieName.Token;
      });

      expect(dashboardTokenAfter?.value).toBe(dashboardTokenBefore?.value);
    } finally {
      page.off("request", recordProbeRequest);
    }
  });
});
