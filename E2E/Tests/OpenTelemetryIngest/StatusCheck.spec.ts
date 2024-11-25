import { BASE_URL } from "../../Config";
import { Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

test.describe("check live and health check of the open-telemetry-ingest", () => {
  test("check if open-telemetry-ingest status is ok", async ({
    page,
  }: {
    page: Page;
  }) => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes
    await page.goto(
      `${URL.fromString(BASE_URL.toString())
        .addRoute("/open-telemetry-ingest/status")
        .toString()}`,
    );
    const content: string = await page.content();
    expect(content).toContain('{"status":"ok"}');
  });

  test("check if open-telemetry-ingest is ready", async ({
    page,
  }: {
    page: Page;
  }) => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes
    await page.goto(
      `${URL.fromString(BASE_URL.toString())
        .addRoute("/open-telemetry-ingest/status/ready")
        .toString()}`,
    );
    const content: string = await page.content();
    expect(content).toContain('{"status":"ok"}');
  });

  test("check if open-telemetry-ingest is live", async ({
    page,
  }: {
    page: Page;
  }) => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes
    await page.goto(
      `${URL.fromString(BASE_URL.toString())
        .addRoute("/open-telemetry-ingest/status/live")
        .toString()}`,
    );
    const content: string = await page.content();
    expect(content).toContain('{"status":"ok"}');
  });
});
