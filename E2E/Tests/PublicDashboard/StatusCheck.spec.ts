import { BASE_URL } from "../../Config";
import { Page, Response, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

test.describe("check public dashboard", () => {
  test("check if public dashboard is available", async ({
    page,
  }: {
    page: Page;
  }) => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes
    const response: Response | null = await page.goto(
      `${URL.fromString(BASE_URL.toString())
        .addRoute("/public-dashboard")
        .toString()}`,
    );
    expect(response?.ok()).toBeTruthy();

    const content: string = await page.content();
    expect(content).toContain("/public-dashboard/dist/Index.js");
  });
});
