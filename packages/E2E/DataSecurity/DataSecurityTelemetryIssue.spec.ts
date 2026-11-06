import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * A TELEMETRY ISSUE SAYS WHAT IT FOUND, WHERE, AND THE RECORDS IT WAS IN
 * (issue #5594), walked in a browser against the offline fixture
 * (Fixture/Fixture.js): "Sensitive data is reaching your telemetry" on the
 * checkout service's logs, with an email address and an IP address no
 * scrub rule masks and a phone number one already does.
 *
 * Its page names the data types in the evidence, lists each finding under
 * Where It Was Found with where it sits and its masked samples, opens the
 * newest log lines that carry it - each leading to the logs explorer and
 * the trace - and scrubs it from there. A Security Viewer sees what was
 * found and where, never a sample or a record.
 *
 * Every test pins the clock, fences the network to the fixture server and
 * fails on an uncaught page error or a request the fixture does not model,
 * as DataSecurity.spec.ts does. Screenshots land in
 * output/playwright/data-security-ui/.
 */

const PORT: string = process.env["DATA_SECURITY_FIXTURE_PORT"] || "4255";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");
const BASE: string = `/dashboard/${PROJECT_ID}/data-security`;

const EMAIL_IN_LOGS_ISSUE: string = "30000000-0000-4000-8000-000000000003";
const LOGS_STORE: string = "20000000-0000-4000-8000-000000000004";
const CHECKOUT_SERVICE: string = "1b000000-0000-4000-8000-000000000001";
const EMAIL_FINDING: string = "40000000-0000-4000-8000-000000000003";
const IP_FINDING: string = "40000000-0000-4000-8000-000000000008";
const CHECKOUT_TRACE: string = "4bf92f3577b34da6a3ce929d0e0e4736";

const ISSUE_PATH: string = `${BASE}/issues/${EMAIL_IN_LOGS_ISSUE}`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/data-security-ui",
);

interface FixtureState {
  apiRequests: Array<{ method: string; url: string }>;
  unhandled: Array<unknown>;
}

const pageErrors: WeakMap<Page, Array<string>> = new WeakMap();
const abortedRequests: WeakMap<Page, Array<string>> = new WeakMap();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const aborted: Array<string> = [];
  pageErrors.set(page, errors);
  abortedRequests.set(page, aborted);

  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });

  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }
    aborted.push(route.request().url());
    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    abortedRequests.get(page) || [],
    "requests that left the fixture server",
  ).toEqual([]);

  const state: FixtureState | null = await fixture(page).catch(() => {
    return null;
  });
  if (state) {
    expect(state.unhandled, "requests the fixture does not model").toEqual([]);
  }
});

async function open(
  page: Page,
  options: {
    width?: number;
    lang?: "en" | "de" | "fa";
    theme?: "light" | "dark";
    role?: "owner" | "viewer";
  } = {},
): Promise<void> {
  await page.setViewportSize({ width: options.width || 1280, height: 1000 });
  await page.clock.setFixedTime(NOW);
  const params: URLSearchParams = new URLSearchParams();
  if (options.lang && options.lang !== "en") {
    params.set("lang", options.lang);
  }
  if (options.theme === "dark") {
    params.set("theme", "dark");
  }
  if (options.role && options.role !== "owner") {
    params.set("role", options.role);
  }
  const query: string = params.toString();
  await page.goto(query ? `${ISSUE_PATH}?${query}` : ISSUE_PATH);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.load("600 14px Inter");
    await document.fonts.ready;
  });
}

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __dataSecurityFixture: FixtureState })
          .__dataSecurityFixture,
      ),
    ) as FixtureState;
  });
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

function card(page: Page): Locator {
  return page.getByTestId("data-security-issue-findings");
}

function findings(page: Page): Locator {
  return card(page).getByTestId("data-security-issue-finding");
}

function records(scope: Locator): Locator {
  return scope.getByTestId("data-security-finding-occurrence");
}

// The findings whose records were asked for, in order.
async function occurrenceRequests(page: Page): Promise<Array<string>> {
  return (await fixture(page)).apiRequests
    .map((request: { url: string }): string => {
      return new URL(request.url).pathname;
    })
    .filter((pathname: string): boolean => {
      return pathname.endsWith("/occurrences");
    })
    .map((pathname: string): string => {
      return pathname.split("/").slice(-2)[0] || "";
    });
}

test.describe("a telemetry issue's page", () => {
  test("names the data types, lists where each sits, and opens the newest records that carry it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    await expect(page.getByTestId("data-security-issue-evidence")).toHaveText(
      "2 kinds of sensitive data are not scrubbed: Email address, IP address.",
    );
    await expect(card(page)).toBeVisible();
    await expect(page.getByText("Where It Was Found")).toBeVisible();

    // The unscrubbed first, the most matched first; the scrubbed last.
    await expect(findings(page)).toHaveCount(3);
    await expect(
      findings(page).getByTestId("data-security-issue-finding-type"),
    ).toHaveText(["IP address", "Email address", "Phone number"]);
    await expect(
      findings(page).getByTestId("data-security-issue-finding-location"),
    ).toHaveText([
      "attributes.http.client_ip",
      "attributes.user.email",
      "attributes.user.phone",
    ]);

    const ip: Locator = findings(page).nth(0);
    const email: Locator = findings(page).nth(1);
    const phone: Locator = findings(page).nth(2);

    await expect(ip.getByText("50 of 50 sampled values matched")).toBeVisible();
    await expect(
      ip.getByTestId("data-security-issue-finding-sample"),
    ).toHaveText(["81.***.***.***", "2a01:***:***:***"]);
    await expect(phone.getByText("Scrubbed")).toBeVisible();
    await expect(
      phone.getByTestId("data-security-issue-finding-scrub"),
    ).toHaveCount(0);

    // The service, at the store's signal.
    const owner: Locator = page.getByTestId(
      "data-security-issue-findings-owner",
    );
    await expect(owner).toHaveText("In the logs of checkout");
    expect(await owner.locator("a").getAttribute("href")).toMatch(
      new RegExp(`/${CHECKOUT_SERVICE}/logs$`),
    );

    // The first finding's records open with the page: one log line.
    await expect(records(ip)).toHaveCount(1);
    await expect(
      records(ip).getByTestId("data-security-finding-occurrence-value"),
    ).toHaveText("81.***.***.***");
    expect(await occurrenceRequests(page)).toEqual([IP_FINDING]);

    // Another finding's, when asked: three log lines, two in a trace.
    await email
      .getByTestId("data-security-issue-finding-records-toggle")
      .click();
    await expect(records(email)).toHaveCount(3);
    expect(await occurrenceRequests(page)).toEqual([IP_FINDING, EMAIL_FINDING]);
    await expect(
      records(email).getByTestId("data-security-finding-occurrence-value"),
    ).toHaveText([
      "k***@a*************.example",
      "j***@a********.com",
      "m***@b******.io",
    ]);

    const inATrace: Locator = records(email).nth(0);
    const trace: string =
      (await inATrace
        .getByRole("link", { name: "Open trace" })
        .getAttribute("href")) || "";
    const logs: string = decodeURIComponent(
      (await inATrace
        .getByRole("link", { name: "Open in Logs" })
        .getAttribute("href")) || "",
    );

    expect(trace).toContain(`/traces/view/${CHECKOUT_TRACE}`);
    expect(trace).toContain("spanId=00f067aa0ba902b7");
    expect(logs).toContain(`/dashboard/${PROJECT_ID}/logs?`);
    expect(logs).toContain(`["traceId",["${CHECKOUT_TRACE}"]]`);
    expect(logs).toContain(`["spanId",["00f067aa0ba902b7"]]`);

    // A line written outside any request: its service's lines around it.
    const alone: Locator = records(email).nth(2);
    await expect(alone.getByRole("link", { name: "Open trace" })).toHaveCount(
      0,
    );
    expect(
      decodeURIComponent(
        (await alone
          .getByRole("link", { name: "Open in Logs" })
          .getAttribute("href")) || "",
      ),
    ).toContain(`["primaryEntityId",["${CHECKOUT_SERVICE}"]]`);

    // Never a raw value in an address.
    for (const href of await card(page)
      .locator("a")
      .evaluateAll((links: Array<Element>): Array<string> => {
        return links.map((link: Element): string => {
          return link.getAttribute("href") || "";
        });
      })) {
      expect(decodeURIComponent(href)).not.toMatch(/@|\*\*\*/);
    }

    await screenshot(page, "telemetry-issue-1280");
  });

  test("Scrub It asks first, makes the rule, says which, and the finding reads Scrubbed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    const ip: Locator = findings(page).nth(0);
    await ip.getByTestId("data-security-issue-finding-scrub").click();

    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog.getByText("Scrub This Data at Ingest")).toBeVisible();
    await dialog.getByRole("button", { name: "Scrub It" }).click();

    await expect(
      page.getByTestId("data-security-issue-findings-scrub-notice"),
    ).toContainText(
      "The scrub rule Data Security: IP address in attributes.http.client_ip now masks this data in new logs.",
    );
    expect(
      (await fixture(page)).apiRequests.some(
        (request: { method: string; url: string }): boolean => {
          return (
            request.method === "POST" &&
            new URL(request.url).pathname.endsWith(
              `/data-store-finding/${IP_FINDING}/scrub`,
            )
          );
        },
      ),
    ).toBe(true);

    // Read again: the email address is left to scrub, first; the IP address is scrubbed.
    await expect(
      findings(page).getByTestId("data-security-issue-finding-type"),
    ).toHaveText(["Email address", "IP address", "Phone number"]);
    await expect(findings(page).nth(1).getByText("Scrubbed")).toBeVisible();

    await screenshot(page, "telemetry-issue-scrubbed-1280");
  });

  test("a Security Viewer reads what was found and where, never a sample or a record", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { role: "viewer" });

    await expect(findings(page)).toHaveCount(3);
    await expect(
      card(page).getByTestId("data-security-issue-finding-sample"),
    ).toHaveCount(0);
    await expect(
      card(page).getByTestId("data-security-issue-finding-records-toggle"),
    ).toHaveCount(0);
    await expect(
      card(page).getByText(
        "Your role does not show masked samples, or the records they were seen in.",
      ),
    ).toBeVisible();
    // Scrub It is there, locked, saying what it takes.
    await expect(
      findings(page).nth(0).getByTestId("data-security-issue-finding-scrub"),
    ).toBeDisabled();
    expect(await occurrenceRequests(page)).toEqual([]);
  });

  test("fits a phone, dark, without scrolling sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { width: 390, theme: "dark" });

    await expect(records(findings(page).nth(0))).toHaveCount(1);
    await card(page).scrollIntoViewIfNeeded();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "telemetry-issue-phone-dark");
  });

  test("reads in German, and in Persian right to left", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { lang: "de" });

    await expect(page.getByText("Wo es gefunden wurde")).toBeVisible();
    await expect(
      page.getByTestId("data-security-issue-findings-owner"),
    ).toHaveText("Telemetrie von checkout: Protokolle");
    await expect(
      findings(page)
        .nth(0)
        .getByText("50 von 50 Stichprobenwerten stimmten überein"),
    ).toBeVisible();
    await expect(records(findings(page).nth(0))).toHaveCount(1);
    await screenshot(page, "telemetry-issue-german-1280");

    await open(page, { lang: "fa", width: 390 });

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByText("کجا پیدا شد")).toBeVisible();
    await expect(records(findings(page).nth(0))).toHaveCount(1);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "telemetry-issue-persian-phone");
  });

  test("leads to everything found in the store", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    expect(
      await card(page)
        .getByText("See everything found in this store")
        .locator("xpath=ancestor::a[1]")
        .getAttribute("href"),
    ).toBe(`${BASE}/stores/${LOGS_STORE}/inside`);
  });
});
