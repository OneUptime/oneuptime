import { Page } from "@playwright/test";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";
import {
  CLOUD_PATH,
  FixtureRecord,
  expect,
  fixtureRecord,
  screenshot,
  test,
} from "./Helpers";

/*
 * A cloud's OneUptime AI agent, in a real browser through the real router: the card on the
 * Overview, and AI > Agent, Insights and Logs in the side menu. What the server answers is made
 * up (Fixture/AiAgent.js). Whether the server writes that is ResourceAiAccessService's own tests,
 * and what the agent can read of a cloud is agents/ResourceAIAgent's. Nothing here has met a live
 * OneUptime stack or an agent.
 */

const AGENT_PAGE: string = `${CLOUD_PATH}/ai/agent`;
const CONNECTED: string = "aiAgent=connected";

async function statusRequests(page: Page): Promise<number> {
  const record: FixtureRecord = await fixtureRecord(page);

  return record.apiRequests.filter((request: { url: string }): boolean => {
    return request.url.endsWith("/resource-ai-access/status");
  }).length;
}

test.describe("the Overview", () => {
  test("says no AI agent is connected, and leads to where to install one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(CLOUD_PATH);

    const card: ReturnType<Page["getByTestId"]> = page.getByTestId(
      "ai-agent-status-summary",
    );

    await expect(card).toContainText("OpenStack AI agent");
    await expect(card).toContainText(/not (installed|connected)/i);
    expect(await statusRequests(page)).toBeGreaterThan(0);
  });

  test("a connected agent reads as connected", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUD_PATH}?${CONNECTED}`);

    await expect(page.getByTestId("ai-agent-status-summary")).toContainText(
      "14.1.0",
    );
  });
});

test.describe("the side menu", () => {
  test("has an AI section that reaches each of its pages", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${AGENT_PAGE}?${CONNECTED}`);

    const menu: ReturnType<Page["getByRole"]> = page.getByRole("navigation");

    for (const title of ["Insights", "Logs", "AI agent"]) {
      await expect(
        menu.getByRole("link", { name: title, exact: true }).first(),
      ).toBeVisible();
    }
  });
});

test.describe("AI > Agent", () => {
  test("not installed: the service to start, under the cloud's name, and fixes off until someone allows them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(AGENT_PAGE);

    await expect(page.locator("body")).toContainText(
      "oneuptime-openstack-ai-agent",
    );
    await expect(page.locator("body")).toContainText("openstack-ai-agent");
    await expect(page.getByTestId("ai-access-fixes")).toContainText(
      "AI never proposes or runs a fix.",
    );
    await expect(page.getByTestId("ai-access-fixes-off-hint")).toBeVisible();
    await expect(page.locator("body")).toContainText(
      "true lets the agent apply fixes",
    );
    await expect(page.locator("body")).toContainText("How AI may apply a fix");
    // It says what the setting does here, which isn't what it does on a host.
    await expect(page.locator("body")).toContainText(
      "Empty: off until a person picks a mode on this page",
    );
    // A credential for changes of its own, by name.
    await expect(page.locator("body")).toContainText(
      "ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID",
    );
    await expect(page.locator("body")).not.toContainText(
      "It has no command that changes one.",
    );
    await screenshot(page, "ai-agent-not-installed");
  });

  test("connected: the Nova API it reads, and the change form offers each fix mode", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${AGENT_PAGE}?${CONNECTED}`);

    await expect(page.locator("body")).toContainText("Nova API");
    await expect(page.locator("body")).toContainText("2.90");

    await page.getByTestId("ai-access-change-button").click();

    const dialog: ReturnType<Page["getByRole"]> = page.getByRole("dialog");

    await expect(dialog).toBeVisible();

    const modes: ReturnType<Page["getByTestId"]> = page.getByTestId(
      "ai-remediation-mode-field",
    );

    await expect(modes).toBeVisible();

    for (const words of [
      "Off",
      "Ask for approval",
      "Automatic",
      "Bypass approval",
    ]) {
      await expect(modes).toContainText(words);
    }

    // What always asks, in the words of what a cloud can do.
    await expect(modes).toContainText(
      "evacuating the instances of a dead hypervisor",
    );
    // Investigations are on, as a cloud's row says.
    await expect(dialog.getByRole("switch")).toBeChecked();
    await screenshot(page, "ai-agent-connected");
  });

  test("with writes allowed and a credential that works, nothing stands in a fix's way", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${AGENT_PAGE}?aiAgent=writes`);

    await expect(page.getByTestId("ai-access-fixes")).toContainText(
      "A person approves each one before it runs.",
    );
    await expect(page.getByTestId("ai-access-fixes-off-hint")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(
      "credential for changes does not work",
    );
    await screenshot(page, "ai-agent-writes");
  });

  test("a credential for changes that does not log in is said now, not on the night of the fix", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${AGENT_PAGE}?aiAgent=broken-credential`);

    await expect(page.locator("body")).toContainText(
      "credential for changes does not work",
    );
    await expect(page.locator("body")).toContainText("it answered 401");
  });

  test("the runbooks for the common failures: all six, one line each until one is opened", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(AGENT_PAGE);

    const card: ReturnType<Page["getByTestId"]> = page.getByTestId(
      "openstack-runbook-templates",
    );

    await card.scrollIntoViewIfNeeded();
    await expect(card.locator("details")).toHaveCount(6);
    await expect(card.locator("details[open]")).toHaveCount(0);

    const computeDown: ReturnType<Page["getByTestId"]> = page.getByTestId(
      "openstack-runbook-openstack-compute-service-down",
    );

    await expect(computeDown.getByText("What to check")).toBeHidden();
    await computeDown.locator("summary").click();
    await expect(computeDown.getByText("What to check")).toBeVisible();
    await expect(computeDown).toContainText(
      "openstack compute service set --enable HOST nova-compute",
    );
    await expect(computeDown).toContainText("Always asks a person");
    await expect(
      page.getByTestId("openstack-runbook-add-openstack-compute-service-down"),
    ).toBeVisible();
    await screenshot(page, "ai-agent-runbooks");
  });

  test("an agent that cannot reach the cloud says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${AGENT_PAGE}?aiAgent=unreachable`);

    await expect(page.locator("body")).toContainText(
      "Keystone would not log in the credential in clouds.yaml",
    );
  });

  test("fits a phone, on every state", async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 375, height: 800 });

    for (const state of [
      "none",
      "connected",
      "writes",
      "broken-credential",
      "unreachable",
    ]) {
      await page.goto(`${AGENT_PAGE}?aiAgent=${state}`);
      await expect(page.getByTestId("ai-access-fixes")).toBeVisible();
      await expectNoSidewaysScroll(page);
    }
  });
});

test.describe("AI > Insights and AI > Logs", () => {
  test("nothing done yet reads as that, and nothing reads as failed", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const path of ["ai/insights", "ai/logs"]) {
      await page.goto(`${CLOUD_PATH}/${path}?${CONNECTED}`);
      await expect(page.locator("body")).not.toContainText(
        /cannot read|Something went wrong/,
      );
      await expectNoSidewaysScroll(page);
    }
  });
});
