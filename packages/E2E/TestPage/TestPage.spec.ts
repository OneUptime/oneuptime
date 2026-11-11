import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * Sending a test page (#6811), in a browser, against the offline fixture
 * (TestPage/Fixture): "Test your pages" as User Settings shows it, and "Test
 * this policy" as a policy's escalation rules show it.
 *
 * What is pinned here: the dialog says what the test will send before it
 * does - each method, in the order a real page reaches it, and where to for
 * the person themselves; for a policy, who its first level pages and how,
 * and who it can't reach and why; what it costs, when it costs anything -
 * then sends what the dialog names, and shows each message as it goes out:
 * who acknowledged it, by what and how fast, a message that did not go out
 * with where to fix it, and the channels that can't be acknowledged from.
 * At 1280 and 390 pixels, with nothing to scroll sideways, in dark mode and
 * in German. The fixture records every request, so the tests check what was
 * sent as well as what was drawn.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000e1";
const POLICY_ID: string = "20000000-0000-4000-8000-0000000000e1";
const CRITICAL_ID: string = "60000000-0000-4000-8000-0000000000e1";
const HIGH_ID: string = "60000000-0000-4000-8000-0000000000e3";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/user-settings/notification-methods`;
const PORT: string = process.env["TEST_PAGE_FIXTURE_PORT"] || "4293";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/test-page-ui",
);

// The Dashboard's German words, as the fixture draws them with ?lang=de.
const GERMAN: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../App/FeatureSet/Dashboard/src/Locales/de.json",
    ),
    "utf8",
  ),
) as Record<string, string>;

interface RecordedRequest {
  url: string;
  data: Record<string, unknown>;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing may leave the fixture: a request to a real host is a test bug.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());

    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }

    await route.abort();
  });
});

test.afterEach(({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
});

function dialog(page: Page): Locator {
  return page.getByRole("dialog");
}

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: (await dialog(page).count()) === 0,
    animations: "disabled",
  });
}

async function openPage(page: Page, query: string = ""): Promise<void> {
  await page.goto(`${PAGE_PATH}${query}`);
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
}

async function requests(page: Page): Promise<Array<RecordedRequest>> {
  return page.evaluate((): Array<RecordedRequest> => {
    return (
      window as unknown as { __fixture: { requests: Array<RecordedRequest> } }
    ).__fixture.requests;
  });
}

async function openDialog(page: Page, buttonName: string): Promise<void> {
  await page.getByTestId("send-test-page").click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByText(buttonName).first()).toBeVisible();
  // The preview has been read.
  await expect(dialog(page).getByTestId("test-page-preview")).toBeVisible();
}

async function send(page: Page): Promise<void> {
  await dialog(page).getByRole("button", { name: "Send test page" }).click();
  await expect(dialog(page).getByTestId("test-page-result")).toBeVisible();
}

test("Test your pages: the dialog says what it will send, in the order a page reaches it, before it does", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);

  await expect(page.getByText("Test your pages")).toBeVisible();
  await openDialog(page, "Send me a test page");

  const methods: Locator = dialog(page).getByTestId("test-page-preview-method");

  await expect(methods).toHaveCount(4);
  await expect(methods.nth(0)).toContainText("SMS");
  await expect(methods.nth(0)).toContainText("+1 415 555 0100");
  await expect(methods.nth(1)).toContainText("dana@example.com");
  await expect(methods.nth(2)).toContainText("Push notification");
  await expect(methods.nth(3)).toContainText("Phone call");

  // Free on a project with its own provider, or with none: no cost line.
  await expect(dialog(page).getByTestId("test-page-cost")).toHaveCount(0);

  // It asked about the first severity, an incident's, for the person themselves.
  const preview: RecordedRequest | undefined = (await requests(page)).find(
    (request: RecordedRequest): boolean => {
      return request.url.endsWith("/on-call-test-page/preview");
    },
  );

  expect(preview?.data).toEqual({
    recordKind: "Incident",
    severityId: CRITICAL_ID,
  });

  await expectNoSidewaysScroll(page);
  await screenshot(page, "self-dialog-1280");
});

test("a test that sends paid texts and calls says what it costs, before it is sent", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page, "?cost=1");
  await openDialog(page, "Send me a test page");

  const cost: Locator = dialog(page).getByTestId("test-page-cost");

  await expect(cost).toContainText("1 SMS");
  await expect(cost).toContainText("1 phone call");
  await expect(cost).toContainText("$0.25");
});

test("sent, it shows each message as it goes out, and who acknowledged it, by what and how fast", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);
  await openDialog(page, "Send me a test page");
  await send(page);

  const sent: RecordedRequest | undefined = (await requests(page)).find(
    (request: RecordedRequest): boolean => {
      return request.url.endsWith("/on-call-test-page/page-person");
    },
  );

  // A test page to yourself names nobody else.
  expect(sent?.data).toEqual({ recordKind: "Incident", severityId: CRITICAL_ID });

  const result: Locator = dialog(page).getByTestId("test-page-result");

  await expect(result).toContainText("Dana Kim");
  await expect(result).toContainText("SMS");
  await expect(result).toContainText("14 seconds");
  await expect(dialog(page).getByTestId("test-page-delivery")).toHaveCount(3);

  // One way out once it is sent: Done. A Cancel would read as cancelling the test.
  await expect(dialog(page).getByRole("button", { name: "Done" })).toBeVisible();
  await expect(
    dialog(page).getByRole("button", { name: "Cancel" }),
  ).toHaveCount(0);

  await expectNoSidewaysScroll(page);
  await screenshot(page, "self-result-acknowledged-1280");
});

test("a message that did not go out says why, and where to fix it", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page, "?result=failed");
  await openDialog(page, "Send me a test page");
  await send(page);

  const failed: Locator = dialog(page)
    .getByTestId("test-page-delivery")
    .filter({ hasText: "dana@example.com" });

  await expect(failed).toContainText(
    "Email notification not sent because email dana@example.com is not verified.",
  );

  const fix: Locator = failed.getByRole("link", {
    name: "Open Notification Methods",
  });

  await expect(fix).toBeVisible();
  await expect(fix).toHaveAttribute(
    "href",
    `/dashboard/${PROJECT_ID}/user-settings/notification-methods`,
  );

  await screenshot(page, "self-result-failed-1280");
});

test("Test this policy: who its first level pages, how, and who it can't reach and why", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page, "?view=policy");
  await openDialog(page, "Test Payments primary");

  const people: Locator = dialog(page).getByTestId("test-page-preview-person");

  await expect(people).toHaveCount(2);
  await expect(people.nth(0)).toContainText("Dana Kim");
  await expect(people.nth(0)).toContainText("Schedule Payments primary");
  await expect(people.nth(0)).toContainText(
    "This Email method is not verified, so the test can't use it.",
  );
  await expect(people.nth(1)).toContainText("Sam Rivera");
  await expect(people.nth(1)).toContainText("No on-call rule covers this severity");
  await expect(
    dialog(page).getByTestId("test-page-preview-not-paged"),
  ).toContainText("Lee Park is away until");

  await expectNoSidewaysScroll(page);
  await screenshot(page, "policy-dialog-1280");
});

test("a policy's test walks every level only when asked to, and names the policy and severity it tests", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page, "?view=policy&result=paging");
  await openDialog(page, "Test Payments primary");

  // An alert's severity, from the list grouped by kind.
  await dialog(page).getByRole("combobox").click();
  await page.getByRole("option", { name: "Alert: High" }).click();
  await expect(dialog(page).getByTestId("test-page-preview")).toBeVisible();

  await dialog(page).getByText("Walk every escalation level").click();
  await send(page);

  const sent: RecordedRequest | undefined = (await requests(page)).find(
    (request: RecordedRequest): boolean => {
      return request.url.endsWith("/on-call-test-page/page-policy");
    },
  );

  expect(sent?.data).toEqual({
    recordKind: "Alert",
    severityId: HIGH_ID,
    policyId: POLICY_ID,
    walksEscalation: true,
  });
});

test("on a 390px phone, the dialog and its result fit, with nothing to scroll sideways", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPage(page);
  await openDialog(page, "Send me a test page");

  await expectNoSidewaysScroll(page);
  await screenshot(page, "self-dialog-390");

  await send(page);
  await expect(dialog(page).getByTestId("test-page-delivery")).toHaveCount(3);

  await expectNoSidewaysScroll(page);
  await screenshot(page, "self-result-390");
});

test("in dark mode", async ({ page }: { page: Page }) => {
  await openPage(page, "?theme=dark&view=policy&result=failed");
  await openDialog(page, "Test Payments primary");
  await send(page);

  await expect(page.locator("html")).toHaveClass(/dark/);
  await expectNoSidewaysScroll(page);
  await screenshot(page, "policy-result-dark-1280");
});

test("in German, the dialog and its result are worded in German", async ({
  page,
}: {
  page: Page;
}) => {
  const sendLabel: string = GERMAN["Send test page"]!;
  const cardTitle: string = GERMAN["Test your pages"]!;

  expect(sendLabel).toBeTruthy();
  expect(sendLabel).not.toBe("Send test page");

  await openPage(page, "?lang=de");

  await expect(page.getByText(cardTitle)).toBeVisible();
  await page.getByTestId("send-test-page").click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByTestId("test-page-preview")).toBeVisible();
  await expect(
    dialog(page).getByRole("button", { name: sendLabel }),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoSidewaysScroll(page);
  await screenshot(page, "self-dialog-de-390");
});
