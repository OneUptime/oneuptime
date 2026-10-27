import { expect, Locator, Page, test } from "@playwright/test";
import path from "path";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";

interface FixtureControl {
  fail: boolean;
  stall: boolean;
  advance: () => void;
  startAgain: () => void;
  scheduleAgain: () => void;
  complete: () => void;
  requests: Array<{ model: string }>;
}

const route: string =
  "/dashboard/10000000-0000-4000-8000-000000000001/network-devices/discovery";
const screenshots: string = path.resolve(
  __dirname,
  "../../../output/playwright/discovery",
);

async function openPage(page: Page): Promise<void> {
  await page.goto(route);
  await expect(
    page.getByText("Discovery Scans", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("progressbar").first()).toBeVisible();
}

test("shows live large-range progress, zero-response progress and retained partial results", async ({
  page,
}: {
  page: Page;
}) => {
  const errors: Array<string> = [];
  page.on("pageerror", (error: Error): void => {
    errors.push(error.message);
  });
  await openPage(page);
  const active: Locator = page
    .getByRole("row")
    .filter({ hasText: "Switch Discovery — WBHQ" });
  await expect(active.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "40",
  );
  await expect(active).toContainText("6,144 of 15,360 addresses swept");
  await expect(active).toContainText("Running for");
  const actionBox: Awaited<ReturnType<Locator["boundingBox"]>> = await active
    .getByRole("button", { name: /Review/ })
    .boundingBox();
  expect(actionBox).not.toBeNull();
  expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(1440);
  const rowBox: Awaited<ReturnType<Locator["boundingBox"]>> =
    await active.boundingBox();
  expect(rowBox!.height).toBeLessThan(260);
  const silent: Locator = page
    .getByRole("row")
    .filter({ hasText: "Branch offices" });
  await expect(silent.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "37",
  );
  await expect(silent).toContainText("96 of 254 addresses swept");
  await page.screenshot({
    path: path.join(screenshots, "discovery-progress-desktop.png"),
    fullPage: true,
  });

  const failed: Locator = page
    .getByRole("row")
    .filter({ hasText: "Remote office — Partial results" });
  await failed.getByRole("button", { name: /Review/ }).click();
  await expect(page.getByText("WBHQ-Core-01", { exact: true })).toBeVisible();
  await page.screenshot({
    path: path.join(screenshots, "discovery-partial-results.png"),
    fullPage: false,
  });
  expect(errors).toEqual([]);
});

test("polling updates existing rows without hiding them, then stops when all scans finish", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);
  await page.clock.install();
  await page.evaluate((): void => {
    (
      window as unknown as { __discoveryFixture: FixtureControl }
    ).__discoveryFixture.advance();
  });
  await page.clock.runFor(10001);
  const active: Locator = page
    .getByRole("row")
    .filter({ hasText: "Switch Discovery — WBHQ" });
  await expect(active.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "80",
  );
  await expect(active).toContainText("12,288 of 15,360 addresses swept");
  await page.evaluate((): void => {
    (
      window as unknown as { __discoveryFixture: FixtureControl }
    ).__discoveryFixture.complete();
  });
  await page.clock.runFor(10001);
  await expect(
    page.getByText("Scan results up to date", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  const count: number = await page.evaluate((): number => {
    return (window as unknown as { __discoveryFixture: FixtureControl })
      .__discoveryFixture.requests.length;
  });
  await page.clock.runFor(30000);
  expect(
    await page.evaluate((): number => {
      return (window as unknown as { __discoveryFixture: FixtureControl })
        .__discoveryFixture.requests.length;
    }),
  ).toBe(count);
});

test("refresh errors preserve last known progress and recover through retry", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);
  await page.clock.install();
  await page.evaluate((): void => {
    (
      window as unknown as { __discoveryFixture: FixtureControl }
    ).__discoveryFixture.fail = true;
  });
  await page.clock.runFor(10001);
  await expect(
    page.getByText("Live updates interrupted", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("progressbar").first()).toHaveAttribute(
    "aria-valuenow",
    "40",
  );
  await page.screenshot({
    path: path.join(screenshots, "discovery-refresh-recovery.png"),
    fullPage: true,
  });
  await page.evaluate((): void => {
    (
      window as unknown as { __discoveryFixture: FixtureControl }
    ).__discoveryFixture.fail = false;
  });
  await page.getByRole("button", { name: /Retry/ }).click();
  await expect(
    page.getByText("Live updates interrupted", { exact: true }),
  ).toHaveCount(0);
});

test("a stalled live request times out without losing progress and allows retry", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);
  await page.clock.install();
  await page.route("**/discovery-stalled-poll", (): void => {
    // Leave the request pending to exercise the browser's actual HTTP timeout.
  });
  await page.evaluate((): void => {
    (
      window as unknown as { __discoveryFixture: FixtureControl }
    ).__discoveryFixture.stall = true;
  });
  await page.clock.runFor(10001);
  await expect(
    page.getByText("Refreshing progress…", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Live updates interrupted", { exact: true }),
  ).toBeVisible({ timeout: 25000 });
  await expect(page.getByRole("progressbar").first()).toHaveAttribute(
    "aria-valuenow",
    "40",
  );
  await page.evaluate((): void => {
    const fixture: FixtureControl = (
      window as unknown as { __discoveryFixture: FixtureControl }
    ).__discoveryFixture;
    fixture.stall = false;
    fixture.advance();
  });
  await page.getByRole("button", { name: /Retry/ }).click();
  await expect(
    page.getByText("Live updates interrupted", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("progressbar").first()).toHaveAttribute(
    "aria-valuenow",
    "80",
  );
});

test("progress remains readable on a narrow screen", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPage(page);
  await expect(page.getByRole("progressbar").first()).toHaveAttribute(
    "aria-valuenow",
    "40",
  );
  await page.screenshot({
    path: path.join(screenshots, "discovery-progress-mobile.png"),
    fullPage: false,
  });
});

test("a finished recurring scan resumes live progress when its next run becomes due", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);
  await page.clock.install();
  await page.evaluate((): void => {
    const fixture: FixtureControl = (
      window as unknown as { __discoveryFixture: FixtureControl }
    ).__discoveryFixture;
    fixture.complete();
    fixture.scheduleAgain();
  });
  await page.clock.runFor(10001);
  await expect(
    page.getByText("Scan results up to date", { exact: true }),
  ).toBeVisible();
  const requestsBeforeDue: number = await page.evaluate((): number => {
    return (window as unknown as { __discoveryFixture: FixtureControl })
      .__discoveryFixture.requests.length;
  });
  await page.clock.runFor(10000);
  expect(
    await page.evaluate((): number => {
      return (window as unknown as { __discoveryFixture: FixtureControl })
        .__discoveryFixture.requests.length;
    }),
  ).toBe(requestsBeforeDue);
  await page.evaluate((): void => {
    (
      window as unknown as { __discoveryFixture: FixtureControl }
    ).__discoveryFixture.startAgain();
  });
  await page.clock.runFor(10001);
  const active: Locator = page
    .getByRole("row")
    .filter({ hasText: "Switch Discovery — WBHQ" });
  await expect(active).toContainText("Waiting for the first progress update");
  await expect(active.getByRole("progressbar")).not.toHaveAttribute(
    "aria-valuenow",
  );
  await expect(
    page.getByText("1 scan in progress or queued", { exact: true }),
  ).toBeVisible();
});

test("a newly claimed recurring scan waits for current progress instead of displaying old completion", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);
  await page.clock.install();
  await page.evaluate((): void => {
    (
      window as unknown as { __discoveryFixture: FixtureControl }
    ).__discoveryFixture.startAgain();
  });
  await page.clock.runFor(10001);
  const active: Locator = page
    .getByRole("row")
    .filter({ hasText: "Switch Discovery — WBHQ" });
  await expect(active).toContainText("Waiting for the first progress update");
  await expect(active.getByRole("progressbar")).not.toHaveAttribute(
    "aria-valuenow",
  );
  await expect(active.getByRole("button", { name: /Review/ })).toHaveCount(0);
  await page.evaluate((): void => {
    (
      window as unknown as { __discoveryFixture: FixtureControl }
    ).__discoveryFixture.advance();
  });
  await page.clock.runFor(10001);
  await expect(active.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "80",
  );
  await expect(active.getByRole("button", { name: /Review/ })).toBeVisible();
});

/*
 * OneUptime issue #3842: "Show details" and "Hide details" displayed the same
 * information. The scan cell always offered the toggle, and both of its
 * states showed the whole status message whenever that message fit in the
 * two-line preview — which the probe's summary of a healthy sweep does.
 *
 * The toggle now exists only when the preview really cuts the message short,
 * and these checks measure that in a real layout, where line wrapping is
 * decided by the column's actual width and font.
 */
const REPORTED_MESSAGE: string =
  "Swept 2560 hosts: 917 answered ICMP ping, 460 answered SNMP.";

interface MessageState {
  text: string;
  isCutShort: boolean;
  hasToggle: boolean;
}

async function messageStates(page: Page): Promise<Array<MessageState>> {
  return page.evaluate((): Array<MessageState> => {
    const toggles: Array<HTMLElement> = Array.from(
      document.querySelectorAll<HTMLElement>("button[aria-controls]"),
    );

    return Array.from(document.querySelectorAll<HTMLElement>("p[id]")).map(
      (message: HTMLElement): MessageState => {
        const toggle: HTMLElement | undefined = toggles.find(
          (button: HTMLElement): boolean => {
            return button.getAttribute("aria-controls") === message.id;
          },
        );
        const isExpanded: boolean =
          toggle?.getAttribute("aria-expanded") === "true";
        const lineHeight: number = parseFloat(
          window.getComputedStyle(message).lineHeight,
        );

        return {
          text: message.textContent || "",
          // Collapsed, the clamp hides text; expanded, the text is taller than two lines.
          isCutShort: isExpanded
            ? message.scrollHeight > lineHeight * 2.5
            : message.scrollHeight > message.clientHeight + 1,
          hasToggle: Boolean(toggle),
        };
      },
    );
  });
}

async function expectTogglesOnlyWhereCutShort(page: Page): Promise<void> {
  const states: Array<MessageState> = await messageStates(page);

  expect(states.length).toBeGreaterThan(0);
  for (const state of states) {
    expect(
      { text: state.text, hasToggle: state.hasToggle },
      `toggle should match whether "${state.text}" is cut short`,
    ).toEqual({ text: state.text, hasToggle: state.isCutShort });
  }
}

test("a status message that fits its preview has no Show details toggle (issue #3842)", async ({
  page,
}: {
  page: Page;
}) => {
  const errors: Array<string> = [];
  page.on("pageerror", (error: Error): void => {
    errors.push(error.message);
  });
  await openPage(page);

  const reported: Locator = page
    .getByRole("row")
    .filter({ hasText: "Router Discovery — WBHQ" });
  const message: Locator = reported.locator("p[id]");

  await expect(reported).toContainText(REPORTED_MESSAGE);
  await expect(reported.getByText("Show details")).toHaveCount(0);
  await expect(reported.getByText("Hide details")).toHaveCount(0);
  await expect(reported.getByRole("button", { name: /details/ })).toHaveCount(
    0,
  );
  await expect(reported.getByText(REPORTED_MESSAGE)).toHaveCount(1);
  await expect(message).toHaveText(REPORTED_MESSAGE);
  await expect(message).toBeVisible();
  expect(
    await message.evaluate((element: HTMLElement): boolean => {
      return element.scrollHeight <= element.clientHeight + 1;
    }),
  ).toBe(true);

  // And across the whole page: a toggle exactly where a preview hides text.
  const states: Array<MessageState> = await messageStates(page);
  expect(
    states.some((state: MessageState): boolean => {
      return state.isCutShort;
    }),
  ).toBe(true);
  expect(
    states.some((state: MessageState): boolean => {
      return !state.isCutShort;
    }),
  ).toBe(true);
  await expectTogglesOnlyWhereCutShort(page);

  await reported.screenshot({
    path: path.join(screenshots, "discovery-status-message-fits.png"),
  });
  expect(errors).toEqual([]);
});

test("Show details reveals the rest of a long status message and Hide details returns to the preview (issue #3842)", async ({
  page,
}: {
  page: Page;
}) => {
  const errors: Array<string> = [];
  page.on("pageerror", (error: Error): void => {
    errors.push(error.message);
  });
  await openPage(page);

  const row: Locator = page
    .getByRole("row")
    .filter({ hasText: "Access Discovery — WBHQ" });
  const message: Locator = row.locator("p[id]");
  const show: Locator = row.getByRole("button", {
    name: "Show details for Access Discovery — WBHQ Unit/Access Switches (10.250.0.0/24)",
  });
  const hide: Locator = row.getByRole("button", {
    name: "Hide details for Access Discovery — WBHQ Unit/Access Switches (10.250.0.0/24)",
  });

  // Collapsed: two lines, with the end of the message cut off.
  await expect(show).toBeVisible();
  await expect(show).toHaveAttribute("aria-expanded", "false");
  await expect(show).toHaveAttribute(
    "aria-controls",
    (await message.getAttribute("id"))!,
  );
  const lineHeight: number = await message.evaluate(
    (element: HTMLElement): number => {
      return parseFloat(window.getComputedStyle(element).lineHeight);
    },
  );
  const collapsed: { height: number; fullHeight: number } =
    await message.evaluate(
      (element: HTMLElement): { height: number; fullHeight: number } => {
        return {
          height: element.getBoundingClientRect().height,
          fullHeight: element.scrollHeight,
        };
      },
    );
  expect(collapsed.height).toBeCloseTo(lineHeight * 2, 0);
  expect(collapsed.fullHeight).toBeGreaterThan(collapsed.height);
  await row.screenshot({
    path: path.join(screenshots, "discovery-status-message-collapsed.png"),
  });

  // Expanded: every line, and the toggle beneath them.
  await show.click();
  await expect(hide).toHaveAttribute("aria-expanded", "true");
  await expect(show).toHaveCount(0);
  const expandedBox: Awaited<ReturnType<Locator["boundingBox"]>> =
    await message.boundingBox();
  expect(expandedBox!.height).toBeCloseTo(collapsed.fullHeight, 0);
  expect(expandedBox!.height).toBeGreaterThan(collapsed.height);
  expect(
    await message.evaluate((element: HTMLElement): boolean => {
      return element.scrollHeight <= element.clientHeight + 1;
    }),
  ).toBe(true);
  const hideBox: Awaited<ReturnType<Locator["boundingBox"]>> =
    await hide.boundingBox();
  expect(hideBox!.y).toBeGreaterThanOrEqual(
    expandedBox!.y + expandedBox!.height - 1,
  );
  await expect(row.getByText(/Legacy v2c community\.$/)).toHaveCount(1);
  await row.screenshot({
    path: path.join(screenshots, "discovery-status-message-expanded.png"),
  });

  // Collapsed again: back to the same two lines.
  await hide.click();
  await expect(show).toHaveAttribute("aria-expanded", "false");
  expect((await message.boundingBox())!.height).toBeCloseTo(
    collapsed.height,
    0,
  );

  // The keyboard does the same.
  await show.focus();
  await page.keyboard.press("Enter");
  await expect(hide).toHaveAttribute("aria-expanded", "true");
  await expect(hide).toBeFocused();
  await page.keyboard.press(" ");
  await expect(show).toHaveAttribute("aria-expanded", "false");

  // Other rows are untouched by this one.
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: "Switch Discovery — WBHQ" })
      .getByRole("button", { name: /^Show details for / }),
  ).toHaveAttribute("aria-expanded", "false");
  expect(errors).toEqual([]);
});

test("the Show details toggle follows the width the message is given (issue #3842)", async ({
  page,
}: {
  page: Page;
}) => {
  const errors: Array<string> = [];
  page.on("pageerror", (error: Error): void => {
    errors.push(error.message);
  });
  await openPage(page);

  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width: width, height: 900 });
    await expect(page.getByText(REPORTED_MESSAGE)).toBeVisible();
    await expect(async (): Promise<void> => {
      await expectTogglesOnlyWhereCutShort(page);
    }).toPass();
  }

  await page.setViewportSize({ width: 1440, height: 1050 });
  const reported: Locator = page
    .getByRole("row")
    .filter({ hasText: "Router Discovery — WBHQ" });
  const toggle: Locator = reported.getByRole("button", {
    name: /details for Router Discovery/,
  });
  await expect(toggle).toHaveCount(0);

  // Squeeze the cell until the same sentence needs a third line.
  await reported.locator("p[id]").evaluate((element: HTMLElement): void => {
    element.parentElement!.style.width = "120px";
  });
  await expect(toggle).toHaveText(/^Show details/);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveText(/^Hide details/);

  // Give it its width back: nothing is hidden, so the toggle goes.
  await reported.locator("p[id]").evaluate((element: HTMLElement): void => {
    element.parentElement!.style.width = "";
  });
  await expect(toggle).toHaveCount(0);
  await expect(reported.locator("p[id]")).toHaveClass(/line-clamp-2/);
  expect(errors).toEqual([]);
});

test("live updates keep an open status message open and drop a toggle that is no longer needed (issue #3842)", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);
  await page.clock.install();

  const silent: Locator = page
    .getByRole("row")
    .filter({ hasText: "Branch offices" });
  const active: Locator = page
    .getByRole("row")
    .filter({ hasText: "Switch Discovery — WBHQ" });

  await silent.getByRole("button", { name: /^Show details for / }).click();
  await active.getByRole("button", { name: /^Show details for / }).click();
  await expect(
    silent.getByRole("button", { name: /^Hide details for / }),
  ).toBeVisible();
  await expect(
    active.getByRole("button", { name: /^Hide details for / }),
  ).toBeVisible();

  // The next poll brings the active scan a message short enough for the preview.
  await page.evaluate((): void => {
    (
      window as unknown as { __discoveryFixture: FixtureControl }
    ).__discoveryFixture.advance();
  });
  await page.clock.runFor(10001);
  await expect(active.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "80",
  );
  await expect(active.locator("p[id]")).toHaveText(
    "Scan in progress: 12,288 of 15,360 addresses swept so far. Checking SNMP credentials (200 of 256).",
  );
  await expect(
    active.getByRole("button", { name: /details for Switch Discovery/ }),
  ).toHaveCount(0);

  // The row the poll left alone is still open.
  await expect(
    silent.getByRole("button", { name: /^Hide details for / }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(silent.locator("p[id]")).not.toHaveClass(/line-clamp-2/);

  await expectTogglesOnlyWhereCutShort(page);
});

/*
 * Starting a scan, in a real browser.
 *
 * "Discover Devices" on the Network Overview (and on an empty device list)
 * links here with ?open=discover-devices, and the page opens Start New Scan
 * as soon as its table is drawn - then takes the action off the address so
 * a refresh does not open it again. A scan picks its method from two cards,
 * ICMP (ping) or SNMP, and a new one starts on ICMP: there are no
 * credentials to ask for, so Start Scan is on the first page. Picking SNMP
 * adds the credentials as a second step.
 */
type ScanMethodCard = "icmp" | "snmp";

function methodCard(modal: Locator, method: ScanMethodCard): Locator {
  return modal.getByTestId(`card-select-option-${method}`);
}

interface ScanWrite {
  formType: string;
  cidr: string | null;
  isSnmpEnabled: boolean | null;
  snmpConfigCount: number | null;
}

async function scanWrites(page: Page): Promise<Array<ScanWrite>> {
  return page.evaluate((): Array<ScanWrite> => {
    return (
      window as unknown as {
        __discoveryFixture: { scanWrites: Array<ScanWrite> };
      }
    ).__discoveryFixture.scanWrites;
  });
}

test("Discover Devices from elsewhere opens Start New Scan at once, and leaves the address clean", async ({
  page,
}: {
  page: Page;
}) => {
  const errors: Array<string> = [];
  page.on("pageerror", (error: Error): void => {
    errors.push(error.message);
  });

  await page.goto(`${route}?open=discover-devices`);

  const modal: Locator = page.getByTestId("modal");
  await expect(modal).toBeVisible();
  await expect(
    modal.getByText("Start New Scan", { exact: true }),
  ).toBeVisible();

  await expect
    .poll((): string => {
      return new URL(page.url()).search;
    })
    .toBe("");
  expect(new URL(page.url()).pathname).toBe(route);

  // The project's only custom probe is already picked.
  await expect(modal.getByText("London datacenter")).toBeVisible();

  await page.screenshot({
    path: path.join(screenshots, "discovery-start-scan.png"),
    fullPage: false,
  });
  expect(errors).toEqual([]);
});

test("a new scan starts on ICMP, one page, and SNMP adds the credentials step", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);

  await page.getByRole("button", { name: "Start Scan" }).first().click();

  const modal: Locator = page.getByTestId("modal");
  await expect(
    modal.getByText("Start New Scan", { exact: true }),
  ).toBeVisible();

  // The method is two cards, one group named by its label: ICMP is picked.
  const method: Locator = modal.getByRole("radiogroup", {
    name: "Scan method",
  });
  await expect(method.getByRole("radio")).toHaveCount(2);
  await expect(methodCard(modal, "icmp")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(methodCard(modal, "icmp")).toContainText(
    "Finds the devices that answer ping. No credentials needed.",
  );
  await expect(methodCard(modal, "snmp")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(methodCard(modal, "snmp")).toContainText(
    "Also reads each device's name and vendor. Needs SNMP credentials.",
  );
  await expect(
    modal.getByText("You can change this at any time.", { exact: true }),
  ).toBeVisible();
  // The switch the cards replaced is gone, and its five lines of help.
  await expect(modal.getByRole("switch", { name: /SNMP/ })).toHaveCount(0);

  // ICMP asks for no credentials: one page, and Start Scan on it.
  const progress: Locator = modal.getByRole("navigation", {
    name: "Progress",
  });
  await expect(progress).toHaveCount(0);
  await expect(page.getByTestId("modal-footer-next-button")).toHaveCount(0);
  await expect(page.getByTestId("modal-footer-submit-button")).toHaveText(
    "Start Scan",
  );

  // The name, the naming rules and the schedule wait under More fields.
  const moreFields: Locator = modal.getByRole("button", {
    name: /More fields/,
  });
  await expect(moreFields).toHaveAttribute("aria-expanded", "false");
  await expect(
    modal.getByPlaceholder("Router Discovery - Region 1100"),
  ).toBeHidden();

  await page.screenshot({
    path: path.join(screenshots, "discovery-start-scan-icmp.png"),
    fullPage: false,
  });

  // SNMP brings the credentials, as a second step.
  await methodCard(modal, "snmp").click();
  await expect(methodCard(modal, "snmp")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(progress.getByRole("listitem")).toHaveText([
    "Scan Target",
    "SNMP Credentials",
  ]);
  await expect(page.getByTestId("modal-footer-next-button")).toBeVisible();
  await expect(page.getByTestId("modal-footer-submit-button")).toHaveCount(0);

  await page.screenshot({
    path: path.join(screenshots, "discovery-start-scan-snmp.png"),
    fullPage: false,
  });

  // And ICMP takes it away again.
  await methodCard(modal, "icmp").click();
  await expect(progress).toHaveCount(0);
  await expect(page.getByTestId("modal-footer-submit-button")).toHaveText(
    "Start Scan",
  );
});

test("the cards answer to the keyboard", async ({ page }: { page: Page }) => {
  await page.goto(`${route}?open=discover-devices`);

  const modal: Locator = page.getByTestId("modal");
  await expect(methodCard(modal, "icmp")).toHaveAttribute(
    "aria-checked",
    "true",
  );

  await methodCard(modal, "snmp").focus();
  await page.keyboard.press("Enter");
  await expect(methodCard(modal, "snmp")).toHaveAttribute(
    "aria-checked",
    "true",
  );

  await methodCard(modal, "icmp").focus();
  await page.keyboard.press("Space");
  await expect(methodCard(modal, "icmp")).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("an untouched Start New Scan sends an ICMP scan, with no credentials", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto(`${route}?open=discover-devices`);

  const modal: Locator = page.getByTestId("modal");
  await modal.getByPlaceholder("192.168.1.0/24").fill("10.20.0.0/24");
  await page.getByTestId("modal-footer-submit-button").click();

  await expect
    .poll(async () => {
      return (await scanWrites(page)).length;
    })
    .toBe(1);

  expect((await scanWrites(page))[0]).toMatchObject({
    cidr: "10.20.0.0/24",
    // Sent, not left out: the column itself defaults to SNMP.
    isSnmpEnabled: false,
    snmpConfigCount: null,
  });
});

test("an SNMP scan sends its method and the credentials it was given", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto(`${route}?open=discover-devices`);

  const modal: Locator = page.getByTestId("modal");
  await methodCard(modal, "snmp").click();
  await modal.getByPlaceholder("192.168.1.0/24").fill("10.20.0.0/24");
  await page.getByTestId("modal-footer-next-button").click();

  await page
    .getByTestId("snmp-config-card-0")
    .getByLabel("SNMP Community String")
    .fill("campus-ro");
  await page.getByTestId("modal-footer-submit-button").click();

  await expect
    .poll(async () => {
      return (await scanWrites(page)).length;
    })
    .toBe(1);

  expect((await scanWrites(page))[0]).toMatchObject({
    cidr: "10.20.0.0/24",
    isSnmpEnabled: true,
    snmpConfigCount: 1,
  });
});

test("the scan list names each scan's method", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);

  const sweep: Locator = page
    .getByRole("row")
    .filter({ hasText: "Branch offices — Ping sweep" });
  const snmp: Locator = page
    .getByRole("row")
    .filter({ hasText: "Datacenter routers" });

  await expect(sweep.getByTestId("discovery-scan-method-badge")).toHaveText(
    "ICMP",
  );
  // The tooltip names the method the way the form does.
  await expect(
    sweep.getByTestId("discovery-scan-method-badge"),
  ).toHaveAttribute("title", "Scan method: ICMP (ping)");
  await expect(snmp.getByTestId("discovery-scan-method-badge")).toHaveText(
    "SNMP",
  );
  await expect(snmp.getByTestId("discovery-scan-method-badge")).toHaveAttribute(
    "title",
    "Scan method: SNMP",
  );

  await page.screenshot({
    path: path.join(screenshots, "discovery-scan-method-badges.png"),
    fullPage: false,
  });
});

/*
 * A long name wraps beside its badge. The badge used to wrap instead, onto a
 * line of its own under the name, whenever the two did not fit side by side.
 */
test("a scan's method badge stays on its name's first line", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);

  interface BadgeLine {
    name: string;
    // The badge's top less the name's: 0 when they share a line.
    topOffset: number;
    // The badge's left less the name's right: never below 0.
    gapAfterName: number;
    nameLineCount: number;
  }

  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width: width, height: 1000 });

    /*
     * Every row at once, in one read: the list redraws its rows as the
     * live progress refreshes, so a row measured a step at a time can be
     * replaced mid-measure.
     */
    const lines: Array<BadgeLine> = await page.evaluate(
      (): Array<BadgeLine> => {
        return Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-testid="discovery-scan-method-badge"]',
          ),
        )
          .filter((badge: HTMLElement): boolean => {
            return badge.getBoundingClientRect().width > 0;
          })
          .map((badge: HTMLElement): BadgeLine => {
            const name: HTMLElement =
              badge.previousElementSibling as HTMLElement;
            const nameBox: DOMRect = name.getBoundingClientRect();
            const badgeBox: DOMRect = badge.getBoundingClientRect();
            const lineHeight: number = Number.parseFloat(
              window.getComputedStyle(name).lineHeight,
            );

            return {
              name: name.textContent || "",
              topOffset: Math.round(badgeBox.top - nameBox.top),
              gapAfterName: Math.round(badgeBox.left - nameBox.right),
              nameLineCount: Math.round(nameBox.height / lineHeight),
            };
          });
      },
    );

    // Every scan in the fixture has its badge on screen.
    expect(lines.length).toBeGreaterThanOrEqual(10);

    for (const line of lines) {
      // Level with the name's first line, and after it, never under it.
      expect(Math.abs(line.topOffset)).toBeLessThanOrEqual(2);
      expect(line.gapAfterName).toBeGreaterThanOrEqual(0);
    }

    // The long names do wrap: beside the badge, not under it.
    expect(
      lines.some((line: BadgeLine): boolean => {
        return line.nameLineCount > 1;
      }),
    ).toBe(true);
  }
});

/*
 * A scan's Edit dialog opens on the method the scan has, and says what
 * changing it does in a note set apart from the form above it.
 */
test("Edit opens on the scan's method, with its note apart from the form", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);

  const sweep: Locator = page
    .getByRole("row")
    .filter({ hasText: "Branch offices — Ping sweep" });
  await sweep.getByRole("button", { name: "Edit", exact: true }).click();

  const modal: Locator = page.getByTestId("modal");
  await expect(
    modal.getByText("Edit Discovery Scan", { exact: true }),
  ).toBeVisible();
  await expect(methodCard(modal, "icmp")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(modal.getByRole("navigation", { name: "Progress" })).toHaveCount(
    0,
  );

  const note: Locator = modal.getByTestId("discovery-scan-edit-rerun-note");
  await expect(note).toContainText(
    "Changing the target, probe, scan method or credentials runs the scan again",
  );

  // In one frame: the dialog grows in as it opens (Modal, from 95%).
  const [fold, noteBox] = (await boxesInOneFrame([
    modal.getByTestId("folded-section").first(),
    note,
  ])) as [FrameBox, FrameBox];

  // A field's gap, not a hairline: the note used to touch More fields.
  expect(noteBox.y - (fold.y + fold.height)).toBeGreaterThanOrEqual(16);

  await page.screenshot({
    path: path.join(screenshots, "discovery-edit-icmp-scan.png"),
    fullPage: false,
  });

  await page.getByTestId("modal-footer-close-button").click();
  await expect(modal).toHaveCount(0);

  // An SNMP scan opens on SNMP, with its credentials as the second step.
  const guest: Locator = page
    .getByRole("row")
    .filter({ hasText: "Guest network" });
  await guest.getByRole("button", { name: "Edit", exact: true }).click();

  await expect(methodCard(modal, "snmp")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(
    modal.getByRole("navigation", { name: "Progress" }).getByRole("listitem"),
  ).toHaveText(["Scan Target", "SNMP Credentials"]);
});

/*
 * The scan's second step: the credential sets it tries, in order. Its
 * heading used to read "SNMP Configs" twice (the field and the editor), and
 * its inputs had no labels a screen reader or getByLabel could find.
 */
test("the credentials step says what the list is, and every input has its label", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto(`${route}?open=discover-devices`);

  const modal: Locator = page.getByTestId("modal");
  await expect(
    modal.getByText("Start New Scan", { exact: true }),
  ).toBeVisible();

  // Credentials are SNMP's: the step is there once SNMP is picked.
  await methodCard(modal, "snmp").click();
  await modal.getByPlaceholder("192.168.1.0/24").fill("10.20.0.0/24");
  await page.getByTestId("modal-footer-next-button").click();

  await expect(
    modal.getByText("Credentials to try", { exact: true }),
  ).toHaveCount(1);
  await expect(modal.getByText("SNMP Configs")).toHaveCount(0);
  await expect(
    modal.getByText(
      "Tried in order on each host that answers ping. The first set that works is used.",
      { exact: false },
    ),
  ).toBeVisible();

  // The first set, named by its number and version until it is given a name.
  const first: Locator = page.getByTestId("snmp-config-card-0");
  await expect(first).toContainText("Credentials 1 (V2c)");

  // Every input answers to its label.
  await expect(first.getByLabel("Name")).toBeVisible();
  await expect(first.getByLabel("SNMP Community String")).toBeVisible();
  await expect(first.getByLabel("SNMP Port")).toBeVisible();
  await expect(first.getByLabel("SNMP Version")).toBeVisible();

  await first.getByLabel("SNMP Community String").fill("campus-ro");

  const addMore: Locator = page.getByTestId("add-snmp-config");
  await expect(addMore).toHaveText("Add more credentials");
  await addMore.click();

  const second: Locator = page.getByTestId("snmp-config-card-1");
  await expect(second).toContainText("Credentials 2 (V2c)");
  await expect(second.getByLabel("SNMP Community String")).toHaveValue("");

  // A named set is called by its name.
  await second.getByLabel("Name").fill("Core switches");
  await expect(second).toContainText("Core switches");

  await page.screenshot({
    path: path.join(screenshots, "discovery-credentials-to-try.png"),
    fullPage: false,
  });
});

test("Start New Scan fits a narrow screen", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${route}?open=discover-devices`);

  const modal: Locator = page.getByTestId("modal");
  await expect(
    modal.getByText("Start New Scan", { exact: true }),
  ).toBeVisible();

  const scrollWidth: number = await page.evaluate((): number => {
    return document.documentElement.scrollWidth;
  });
  expect(scrollWidth).toBeLessThanOrEqual(390);

  await page.screenshot({
    path: path.join(screenshots, "discovery-start-scan-mobile.png"),
    fullPage: false,
  });
});
