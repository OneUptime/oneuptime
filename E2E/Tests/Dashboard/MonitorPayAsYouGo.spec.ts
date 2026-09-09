import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import { selectMonitorTypeCard } from "./Helpers/Monitors";
import {
  APIResponse,
  Browser,
  Locator,
  Page,
  Route,
  expect,
  test,
} from "@playwright/test";
import URL from "Common/Types/API/URL";

interface SharedContext {
  page: Page;
  projectId: string;
  createUrl: string;
}

interface PricingLayout {
  left: number;
  right: number;
  width: number;
  viewportWidth: number;
  scrollWidth: number;
  clientWidth: number;
  overflowingContent: Array<string>;
}

/*
 * Exercises the pricing card in the real monitor creation page. A single Free
 * project is reused without a payment method; the suite never enables paid
 * usage or creates an active monitor.
 *
 * cd E2E && HOST=dev.oneuptime.com HTTP_PROTOCOL=https BILLING_ENABLED=true \
 *   npx playwright test Tests/Dashboard/MonitorPayAsYouGo.spec.ts \
 *   --project=chromium --retries=0
 */
test.describe("Monitor pay-as-you-go pricing", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!IS_BILLING_ENABLED, "Monitor pricing requires billing enabled.");

  const ctx: SharedContext = {
    page: undefined as unknown as Page,
    projectId: "",
    createUrl: "",
  };

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300000);
    ctx.page = await browser.newPage();
    ctx.projectId = await registerAndCreateProject({
      page: ctx.page,
      projectNamePrefix: "E2E Monitor Pricing",
      preferredPlanName: "Free",
      enablePaidUsage: false,
    });
    ctx.createUrl = URL.fromString(BASE_URL.toString())
      .addRoute(`/dashboard/${ctx.projectId}/monitors/create`)
      .toString();
  });

  test.beforeEach(async () => {
    await ctx.page.setViewportSize({ width: 1440, height: 1000 });
    await gotoProjectPage({
      page: ctx.page,
      projectId: ctx.projectId,
      url: ctx.createUrl,
      ready: ctx.page.getByRole("region", { name: "Monitor pricing" }),
    });
  });

  test.afterAll(async () => {
    try {
      if (ctx.projectId) {
        const response: APIResponse = await ctx.page.request.delete(
          URL.fromString(BASE_URL.toString())
            .addRoute(`/api/project/${ctx.projectId}`)
            .toString(),
          { headers: { tenantid: ctx.projectId } },
        );
        expect(response.ok(), "The temporary pricing project is deleted").toBe(
          true,
        );
      }
    } finally {
      await ctx.page?.close();
    }
  });

  for (const viewport of [
    { name: "desktop", width: 1440 },
    { name: "mobile", width: 375 },
  ]) {
    test(`shows complete, unclipped pricing on ${viewport.name}`, async () => {
      await ctx.page.setViewportSize({ width: viewport.width, height: 1000 });

      const pricing: Locator = ctx.page.getByRole("region", {
        name: "Monitor pricing",
      });
      await expect(pricing).toHaveAttribute(
        "data-testid",
        "monitor-pay-as-you-go-card",
      );
      await expect(
        pricing.getByRole("heading", { name: "Monitor pricing", level: 2 }),
      ).toBeVisible();
      await expect(
        pricing.getByText(/Your project is on the Free plan/),
      ).toBeVisible();
      await expect(
        pricing.getByRole("heading", { name: "Active monitoring", level: 3 }),
      ).toBeVisible();
      await expect(
        pricing.getByText("Pay as you go", { exact: true }),
      ).toBeVisible();
      await expect(pricing.getByText("$1", { exact: true })).toBeVisible();
      await expect(
        pricing.getByText("per monitor per month", { exact: true }),
      ).toBeVisible();
      await expect(
        pricing.getByText(
          "Every monitor type except Manual is an active monitor.",
        ),
      ).toBeVisible();
      await expect(
        pricing.getByRole("heading", { name: "Manual monitors", level: 3 }),
      ).toBeVisible();
      await expect(
        pricing.getByText("Always free", { exact: true }),
      ).toBeVisible();
      await expect(
        pricing.getByText("Unlimited monitors. No monitoring charges."),
      ).toBeVisible();
      await expect(
        pricing.getByText(
          /Add a payment method before creating an active monitor/,
        ),
      ).toBeVisible();
      await expect(
        pricing.getByText(
          "No commitment. Delete a monitor to stop its charges.",
        ),
      ).toBeVisible();
      await expect(
        pricing.getByText(
          "Telemetry-based monitors also incur charges for the telemetry they read.",
        ),
      ).toBeVisible();
      await expect(
        pricing.getByRole("link", { name: "View pricing" }),
      ).toBeVisible();

      /*
       * Rendered measurements catch text or links escaping the card at narrow
       * widths, including a card that is wider than the viewport itself.
       */
      const layout: PricingLayout = await pricing.evaluate(
        (element: HTMLElement): PricingLayout => {
          const bounds: DOMRect = element.getBoundingClientRect();
          const overflowingContent: Array<string> = [];

          for (const content of element.querySelectorAll<HTMLElement>(
            "h2, h3, p, li, a",
          )) {
            const contentBounds: DOMRect = content.getBoundingClientRect();
            if (
              contentBounds.left < bounds.left - 1 ||
              contentBounds.right > bounds.right + 1 ||
              content.scrollWidth > content.clientWidth + 1
            ) {
              overflowingContent.push(
                content.textContent?.trim() || content.tagName,
              );
            }
          }

          return {
            left: bounds.left,
            right: bounds.right,
            width: bounds.width,
            viewportWidth: window.innerWidth,
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            overflowingContent,
          };
        },
      );

      expect(layout.width).toBeGreaterThan(0);
      expect(layout.left).toBeGreaterThanOrEqual(0);
      expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth + 1);
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
      expect(layout.overflowingContent).toEqual([]);

      await test.info().attach(`monitor-pricing-${viewport.name}`, {
        body: await pricing.screenshot(),
        contentType: "image/png",
      });
    });
  }

  test("opens pricing in a new tab using the keyboard without losing the form", async () => {
    const pricingLink: Locator = ctx.page
      .getByRole("region", { name: "Monitor pricing" })
      .getByRole("link", { name: "View pricing" });
    const pricingUrl: string = "https://oneuptime.com/pricing";
    const handlePricing: (route: Route) => Promise<void> = async (
      route: Route,
    ): Promise<void> => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Pricing destination</title>",
      });
    };

    // Context routing also intercepts the popup's first navigation.
    await ctx.page.context().route(pricingUrl, handlePricing);
    try {
      await expect(pricingLink).toHaveAttribute("href", pricingUrl);
      await expect(pricingLink).toHaveAttribute("target", "_blank");
      await pricingLink.focus();
      await expect(pricingLink).toBeFocused();
      const popupPromise: Promise<Page> = ctx.page.waitForEvent("popup");
      await ctx.page.keyboard.press("Enter");
      const popup: Page = await popupPromise;
      try {
        await expect(popup).toHaveURL(pricingUrl);
        await expect(popup).toHaveTitle("Pricing destination");
        await expect(ctx.page).toHaveURL(ctx.createUrl);
        await expect(ctx.page.locator("#create-monitor-form")).toBeVisible();
      } finally {
        await popup.close();
      }
    } finally {
      await ctx.page.context().unroute(pricingUrl, handlePricing);
    }
  });

  test("keeps Manual monitor setup usable without paid-usage consent", async () => {
    const form: Locator = ctx.page.locator("#create-monitor-form");
    await expect(form).toBeVisible();
    await form
      .getByPlaceholder("Monitor Name", { exact: true })
      .fill("Manual pricing check");
    await selectMonitorTypeCard({ page: ctx.page, cardValue: "Manual" });
    await expect(
      ctx.page.getByTestId("monitor-pay-as-you-go-consent"),
    ).toBeHidden();
    await ctx.page.getByTestId("Create Monitor").click();
    await expect(
      ctx.page.getByRole("combobox", { name: /^Labels\b/ }),
    ).toBeVisible();
    await expect(ctx.page.getByTestId("Create Monitor")).toBeEnabled();
  });
});
