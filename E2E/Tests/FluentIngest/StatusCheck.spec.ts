import { BASE_URL } from "../../Config";
import { Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

test.describe("check live and health check of the fluent ingest", () => {
  test("check if fluent ingest status is ok", async ({ page }: { page: Page }) => {
    await page.goto(
      `${URL.fromString(BASE_URL.toString())
        .addRoute("/fluent-ingest/status")
        .toString()}`,
    );
    const content: string = await page.content();
    expect(content).toContain('{"status":"ok"}');
  });

  test("check if fluent ingest is ready", async ({ page }: { page: Page }) => {
    await page.goto(
      `${URL.fromString(BASE_URL.toString())
        .addRoute("/fluent-ingest/status/ready")
        .toString()}`,
    );
    const content: string = await page.content();
    expect(content).toContain('{"status":"ok"}');
  });

  test("check if fluent ingest is live", async ({ page }: { page: Page }) => {
    await page.goto(
      `${URL.fromString(BASE_URL.toString())
        .addRoute("/fluent-ingest/status/live")
        .toString()}`,
    );
    const content: string = await page.content();
    expect(content).toContain('{"status":"ok"}');
  });
});
