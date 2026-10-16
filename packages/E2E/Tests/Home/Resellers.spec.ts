import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import { APIResponse, Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * The Resellers page (Home/Views/resellers.ejs) and the address its form
 * posts to (Home/API/ResellerInquiryAPI.ts), as deployed behind the ingress.
 *
 * Unit tests pin the page, the form and the route's answers; this suite is
 * the deployment contract: the page is served and linked from the footer,
 * and POST /resellers/contact reaches the Home service and answers JSON.
 *
 * It never sends an inquiry that would be emailed: a valid one goes to the
 * configured inbox - sales@oneuptime.com by default - from whichever stack
 * the suite runs against. The one request that reaches the route's checks
 * is a form with nothing in it.
 */

const resellersUrl: string = URL.fromString(BASE_URL.toString())
  .addRoute("/resellers")
  .toString();
const contactUrl: string = URL.fromString(BASE_URL.toString())
  .addRoute("/resellers/contact")
  .toString();

test.describe("Home: Resellers", () => {
  test.skip(
    !IS_BILLING_ENABLED,
    "The marketing website is deployed only in billing-enabled environments.",
  );

  test.beforeEach(async ({ page }: { page: Page }) => {
    page.setDefaultNavigationTimeout(120000);
    // Keep the shared consent banner from covering the footer.
    await page.addInitScript((): void => {
      localStorage.setItem("cookiesAccepted", "false");
    });
  });

  test("the page lists the resellers and offers the form", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(resellersUrl);

    await expect(page).toHaveTitle(/^Resellers \| .+ \| OneUptime$/);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Buy OneUptime from a partner near you",
      }),
    ).toBeVisible();

    // SLEXN, in South Korea, links to its own website in a new tab.
    const slexn: Locator = page.getByTestId("reseller-card").filter({
      hasText: "SLEXN",
    });
    await expect(slexn).toBeVisible();
    await expect(slexn).toContainText("Seoul, South Korea");
    await expect(slexn.getByRole("link")).toHaveAttribute(
      "href",
      "https://www.slexn.com",
    );
    await expect(slexn.getByRole("link")).toHaveAttribute("target", "_blank");

    // The form asks for these, each by its label.
    for (const label of [
      "Your name",
      "Work email",
      "Company",
      "Countries or regions you sell in",
    ]) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }

    await expect(
      page.getByRole("button", { name: "Send message" }),
    ).toBeVisible();
  });

  test("the footer links to the page", async ({ page }: { page: Page }) => {
    await page.goto(BASE_URL.toString());

    const resellers: Locator = page
      .getByRole("contentinfo")
      .getByRole("link", { name: "Resellers", exact: true });
    await expect(resellers).toHaveAttribute("href", "/resellers");
    await resellers.click();
    await expect(page).toHaveURL(resellersUrl);
  });

  test("the form's address refuses another site's page and a body that is not JSON", async ({
    page,
  }: {
    page: Page;
  }) => {
    const foreign: APIResponse = await page.request.post(contactUrl, {
      headers: { Origin: "https://evil.example" },
      data: { name: "Jane" },
    });

    expect(foreign.status()).toBe(403);
    expect(foreign.headers()["content-type"] || "").toContain(
      "application/json",
    );
    expect(await foreign.json()).toMatchObject({ sent: false });

    const notJson: APIResponse = await page.request.post(contactUrl, {
      form: { name: "Jane" },
    });

    expect(notJson.status()).toBe(415);
    expect(await notJson.json()).toMatchObject({ sent: false });
  });

  test("the form's address names the field to fix in an empty form", async ({
    page,
  }: {
    page: Page;
  }) => {
    const answer: APIResponse = await page.request.post(contactUrl, {
      data: {},
    });

    expect(answer.status()).toBe(400);
    expect(answer.headers()["cache-control"]).toBe("no-store");
    expect(await answer.json()).toEqual({
      sent: false,
      message: "Please enter your name.",
      field: "name",
    });
  });
});
