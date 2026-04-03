import { BASE_URL } from "../../Config";
import { Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

test.describe("check admin dashboard", () => {
  test("check if admin dashboard is available", async ({
    page,
  }: {
    page: Page;
  }) => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes
    const response = await page.goto(
      `${URL.fromString(BASE_URL.toString()).addRoute("/admin/env.js").toString()}`,
    );
    expect(response?.ok()).toBeTruthy();

    const content: string = (await page.textContent("body")) || "";
    expect(content).toContain("window.process.env");
  });
});
