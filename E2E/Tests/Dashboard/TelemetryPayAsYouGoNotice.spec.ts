import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
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
  ingestionKeysUrl: string;
}

interface NoticeLayout {
  left: number;
  right: number;
  width: number;
  viewportWidth: number;
  scrollWidth: number;
  clientWidth: number;
  modalLeft: number;
  modalRight: number;
  modalScrollWidth: number;
  modalClientWidth: number;
  clippedText: Array<string>;
}

/*
 * Exercises the notice inside the real ModelTable create modal, including
 * its shared form fields and the modal's scroll container. The Free project
 * has no payment method; these tests never submit an ingestion key or send
 * telemetry. Pricing stays visible without an acknowledgement control.
 *
 * cd E2E && HOST=dev.oneuptime.com HTTP_PROTOCOL=https BILLING_ENABLED=true \
 *   npx playwright test Tests/Dashboard/TelemetryPayAsYouGoNotice.spec.ts \
 *   --project=chromium --retries=0
 */
test.describe("Telemetry pay-as-you-go modal notice", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!IS_BILLING_ENABLED, "Telemetry pricing requires billing enabled.");

  const ctx: SharedContext = {
    page: undefined as unknown as Page,
    projectId: "",
    ingestionKeysUrl: "",
  };

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300000);
    ctx.page = await browser.newPage();
    ctx.projectId = await registerAndCreateProject({
      page: ctx.page,
      projectNamePrefix: "E2E Telemetry Pricing Notice",
      preferredPlanName: "Free",
      enablePaidUsage: false,
    });
    ctx.ingestionKeysUrl = URL.fromString(BASE_URL.toString())
      .addRoute(`/dashboard/${ctx.projectId}/settings/telemetry-ingestion-keys`)
      .toString();
  });

  test.beforeEach(async () => {
    await ctx.page.setViewportSize({ width: 1440, height: 1000 });
    const createButton: Locator = ctx.page.getByRole("button", {
      name: "Create Ingestion Key",
      exact: true,
    });
    await gotoProjectPage({
      page: ctx.page,
      projectId: ctx.projectId,
      url: ctx.ingestionKeysUrl,
      ready: createButton,
    });
    await createButton.click();
    await expect(ctx.page.getByTestId("modal")).toBeVisible();
    await expect(
      ctx.page
        .getByTestId("modal")
        .getByRole("region", { name: "Telemetry pricing", exact: true }),
    ).toBeVisible();
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
        expect(
          response.ok(),
          "The temporary telemetry pricing project is deleted",
        ).toBe(true);
      }
    } finally {
      await ctx.page?.close();
    }
  });

  for (const viewport of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "mobile", width: 375, height: 812 },
  ]) {
    test(`shows complete, unclipped pricing inside the ${viewport.name} modal`, async () => {
      await ctx.page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      const modal: Locator = ctx.page.getByTestId("modal");
      const notice: Locator = modal.getByRole("region", {
        name: "Telemetry pricing",
        exact: true,
      });

      await expect(notice).toHaveAttribute(
        "data-testid",
        "telemetry-pay-as-you-go-notice",
      );
      await expect(
        notice.getByRole("heading", { name: "Telemetry pricing", level: 3 }),
      ).toBeVisible();
      await expect(
        notice.getByText("Pay as you go", { exact: true }),
      ).toBeVisible();
      await expect(
        notice.getByText("Telemetry is not included in your Free plan."),
      ).toBeVisible();

      const telemetry: Locator = notice.getByRole("group", {
        name: "Telemetry",
        exact: true,
      });
      await expect(
        telemetry.getByRole("heading", { name: "Telemetry", level: 4 }),
      ).toBeVisible();
      await expect(
        telemetry.getByText(
          "Logs, traces, metrics, profiles and security events",
        ),
      ).toBeVisible();
      await expect(telemetry.getByText("$0.10", { exact: true })).toBeVisible();
      await expect(
        telemetry.getByText("per GB ingested", { exact: true }),
      ).toBeVisible();

      const replay: Locator = notice.getByRole("group", {
        name: "Session replay",
        exact: true,
      });
      await expect(
        replay.getByRole("heading", { name: "Session replay", level: 4 }),
      ).toBeVisible();
      await expect(replay.getByText("Session replay recordings")).toBeVisible();
      await expect(replay.getByText("$2", { exact: true })).toBeVisible();
      await expect(replay.getByText("per GB", { exact: true })).toBeVisible();
      await expect(
        notice.getByText("15 day retention for both."),
      ).toBeVisible();
      await expect(
        notice.getByText(
          "Add a payment method before creating a key or sending paid telemetry.",
        ),
      ).toBeVisible();
      await expect(
        notice.getByRole("link", { name: "View pricing", exact: true }),
      ).toBeVisible();
      await expect(modal.getByRole("checkbox")).toHaveCount(0);
      await expect(
        modal.getByText("I agree to these usage charges", { exact: true }),
      ).toHaveCount(0);

      await notice.scrollIntoViewIfNeeded();

      /*
       * Text ranges detect clipped words even when overflow-hidden makes the
       * notice itself look correctly sized. The modal body must also fit the
       * viewport without horizontal scrolling.
       */
      const layout: NoticeLayout = await notice.evaluate(
        (element: HTMLElement): NoticeLayout => {
          const bounds: DOMRect = element.getBoundingClientRect();
          const modalContent: HTMLElement = element.closest(
            '[data-testid="modal-content"]',
          )!;
          const modalBounds: DOMRect = modalContent.getBoundingClientRect();
          const clippedText: Array<string> = [];
          const walker: TreeWalker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
          );
          let node: Node | null = walker.nextNode();

          while (node) {
            if (node.textContent?.trim()) {
              const range: Range = document.createRange();
              range.selectNodeContents(node);
              for (const textBounds of range.getClientRects()) {
                if (
                  textBounds.left < bounds.left - 1 ||
                  textBounds.right > bounds.right + 1 ||
                  textBounds.top < bounds.top - 1 ||
                  textBounds.bottom > bounds.bottom + 1
                ) {
                  clippedText.push(node.textContent.trim());
                }
              }
            }
            node = walker.nextNode();
          }

          return {
            left: bounds.left,
            right: bounds.right,
            width: bounds.width,
            viewportWidth: window.innerWidth,
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            modalLeft: modalBounds.left,
            modalRight: modalBounds.right,
            modalScrollWidth: modalContent.scrollWidth,
            modalClientWidth: modalContent.clientWidth,
            clippedText,
          };
        },
      );

      expect(layout.width).toBeGreaterThan(0);
      expect(layout.left).toBeGreaterThanOrEqual(layout.modalLeft);
      expect(layout.right).toBeLessThanOrEqual(layout.modalRight + 1);
      expect(layout.modalLeft).toBeGreaterThanOrEqual(0);
      expect(layout.modalRight).toBeLessThanOrEqual(layout.viewportWidth + 1);
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
      expect(layout.modalScrollWidth).toBeLessThanOrEqual(
        layout.modalClientWidth + 1,
      );
      expect(layout.clippedText).toEqual([]);

      await test.info().attach(`telemetry-pricing-notice-${viewport.name}`, {
        body: await notice.screenshot(),
        contentType: "image/png",
      });
      await test.info().attach(`telemetry-pricing-modal-${viewport.name}`, {
        body: await modal.screenshot(),
        contentType: "image/png",
      });
    });
  }

  test("opens pricing by keyboard while preserving the modal and draft fields", async () => {
    const modal: Locator = ctx.page.getByTestId("modal");
    const name: Locator = modal.getByPlaceholder("Ingestion Key Name", {
      exact: true,
    });
    const description: Locator = modal.getByPlaceholder(
      "Ingestion Key Description",
      { exact: true },
    );
    const draftName: string = "Draft telemetry pricing key";
    const draftDescription: string = "Review pricing before creating this key.";
    await name.fill(draftName);
    await description.fill(draftDescription);

    const pricingLink: Locator = modal
      .getByRole("region", { name: "Telemetry pricing", exact: true })
      .getByRole("link", { name: "View pricing", exact: true });
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

    // Context routing covers the popup's initial navigation as well.
    await ctx.page.context().route(pricingUrl, handlePricing);
    try {
      await expect(pricingLink).toHaveAttribute("href", pricingUrl);
      await expect(pricingLink).toHaveAttribute("target", "_blank");
      await expect(pricingLink).toHaveAttribute("rel", "noopener noreferrer");
      await pricingLink.focus();
      await expect(pricingLink).toBeFocused();
      const popupPromise: Promise<Page> = ctx.page.waitForEvent("popup");
      await ctx.page.keyboard.press("Enter");
      const popup: Page = await popupPromise;
      try {
        await expect(popup).toHaveURL(pricingUrl);
        await expect(popup).toHaveTitle("Pricing destination");
        await expect(ctx.page).toHaveURL(ctx.ingestionKeysUrl);
        await expect(modal).toBeVisible();
        await expect(name).toHaveValue(draftName);
        await expect(description).toHaveValue(draftDescription);
        await expect(modal.getByRole("checkbox")).toHaveCount(0);
      } finally {
        await popup.close();
      }
    } finally {
      await ctx.page.context().unroute(pricingUrl, handlePricing);
    }
  });

  test("can dismiss and reopen the modal with pricing and no acknowledgement control", async () => {
    const modal: Locator = ctx.page.getByTestId("modal");
    await modal
      .getByPlaceholder("Ingestion Key Name", { exact: true })
      .fill("Unsubmitted telemetry pricing draft");
    await modal.getByTestId("modal-footer-close-button").click();
    await expect(modal).toBeHidden();
    await expect(ctx.page).toHaveURL(ctx.ingestionKeysUrl);

    await ctx.page
      .getByRole("button", { name: "Create Ingestion Key", exact: true })
      .click();
    await expect(modal).toBeVisible();
    await expect(
      modal.getByRole("region", { name: "Telemetry pricing", exact: true }),
    ).toBeVisible();
    await expect(modal.getByRole("checkbox")).toHaveCount(0);
    await expect(
      modal.getByPlaceholder("Ingestion Key Name", { exact: true }),
    ).toBeEditable();
  });
});
