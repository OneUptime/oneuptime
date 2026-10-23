import { BrowserContext, expect, Locator, Page, test } from "@playwright/test";
import path from "path";

/*
 * A device's SNMP Walk page (issue #5184), end to end in a browser, against
 * the fixture's in-page API (SnmpWalk/Fixture.js): what a walk read - names,
 * types and values in aligned columns - filtering it, walking a subtree
 * picked from the starting points or typed, a walk still running when the
 * page opens, continuing a walk that stopped at its limit, Collect on the
 * device or its template, Alert on it, Copy OID, why a walk failed, who may
 * do which, and the page at a phone's width, in the dark theme, in Japanese
 * and in German. Screenshots in output/playwright/snmp-walk-ui are for the
 * people who review the page.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const DEVICE_ID: string = "40000000-0000-4000-8000-000000000001";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/snmp-walk-ui",
);

const SYS_DESCR: string = "1.3.6.1.2.1.1.1.0";
const SYS_UP_TIME: string = "1.3.6.1.2.1.1.3.0";
const SYS_NAME: string = "1.3.6.1.2.1.1.5.0";
const IF_PHYS_ADDRESS: string = "1.3.6.1.2.1.2.2.1.6.1";
const HR_PROCESSOR_LOAD: string = "1.3.6.1.2.1.25.3.3.1.2.196608";
const IF_HC_IN_OCTETS: string = "1.3.6.1.2.1.31.1.1.1.6.1";
const CISCO_CPU: string = "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1";

interface WalkAskedFor {
  networkDeviceId: string | null;
  diagnosticType: string;
  snmpWalkRootOid: string;
  snmpWalkAfterOid: string | null;
}

interface Written {
  model: string;
  id: string;
  data: { snmpOids?: Array<{ oid: string }>; oids?: Array<{ oid: string }> };
}

interface FixtureState {
  sent: Array<Array<string>>;
  creates: Array<WalkAskedFor>;
  updates: Array<Written>;
  polls: number;
}

async function open(page: Page, query: string = ""): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.getByTestId("snmp-walk")).toBeVisible();
  // Inter, as production draws the page: widths and wraps are measured.
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function fixtureState(page: Page): Promise<FixtureState> {
  return await page.evaluate(() => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __snmpWalkFixture: { state: unknown } })
          .__snmpWalkFixture.state,
      ),
    );
  });
}

function rowOf(page: Page, oid: string): Locator {
  return page.locator(`[data-testid="snmp-walk-row"][data-oid="${oid}"]`);
}

function rows(page: Page): Locator {
  return page.getByTestId("snmp-walk-row");
}

async function overflow(page: Page): Promise<number> {
  return await page.evaluate(() => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
}

async function backgroundBrightness(locator: Locator): Promise<number> {
  const background: string = await locator.evaluate((element: Element) => {
    return getComputedStyle(element).backgroundColor;
  });
  const channels: Array<number> = (background.match(/\d+(\.\d+)?/g) || []).map(
    Number,
  );

  return channels[0]! + channels[1]! + channels[2]!;
}

async function textBrightness(locator: Locator): Promise<number> {
  const color: string = await locator.evaluate((element: Element) => {
    return getComputedStyle(element).color;
  });
  const channels: Array<number> = (color.match(/\d+(\.\d+)?/g) || []).map(
    Number,
  );

  return channels[0]! + channels[1]! + channels[2]!;
}

/*
 * A screenshot of the page at rest: two frames for the classes the page's
 * newest elements need (the fixture's Tailwind adds them as the DOM
 * changes), then the transitions a click started, played out.
 */
async function shoot(page: Page, name: string): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve: (value: unknown) => void) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
    await Promise.all(
      document
        .getAnimations()
        .filter((animation: Animation) => {
          return animation.effect?.getTiming().iterations !== Infinity;
        })
        .map((animation: Animation) => {
          return animation.finished.catch(() => {
            return undefined;
          });
        }),
    );
  });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: true,
  });
}

test.describe("a walk's results, at a laptop's width", () => {
  test("every OID the device answered, with its name, type and value, in aligned columns", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    await expect(page.getByTestId("snmp-walk-summary")).toHaveText(
      "26 OIDs under 1.3.6.1.",
    );
    await expect(rows(page)).toHaveCount(26);

    // The table's header names its data; the action column needs no title.
    const header: Locator = page.getByTestId("snmp-walk-results-header");
    await expect(header).toBeVisible();
    await expect(header).toContainText("OID");
    await expect(header).toContainText("Type");
    await expect(header).toContainText("Value");
    await expect(header).not.toContainText("Monitoring");

    // Names from the MIBs OneUptime knows, types as snmpwalk prints them.
    await expect(
      rowOf(page, SYS_DESCR).getByTestId("snmp-walk-row-name"),
    ).toContainText("sysDescr");
    await expect(
      rowOf(page, SYS_DESCR).getByTestId("snmp-walk-row-type"),
    ).toHaveText("STRING");
    await expect(
      rowOf(page, SYS_UP_TIME).getByTestId("snmp-walk-row-type"),
    ).toHaveText("Timeticks");
    await expect(
      rowOf(page, SYS_UP_TIME).getByTestId("snmp-walk-row-duration"),
    ).toContainText("12 days, 02:20:45");
    await expect(
      rowOf(page, IF_PHYS_ADDRESS).getByTestId("snmp-walk-row-type"),
    ).toHaveText("Hex-STRING");
    await expect(
      rowOf(page, IF_PHYS_ADDRESS).getByTestId("snmp-walk-row-value"),
    ).toHaveText("00 1A 2B 3C 4D 5E");
    // A 64-bit counter is read to its last digit.
    await expect(
      rowOf(page, IF_HC_IN_OCTETS).getByTestId("snmp-walk-row-value"),
    ).toHaveText("18446744073709551615");

    // The type and value columns start at the same x on every row.
    const typeLefts: Array<number> = [];
    const valueLefts: Array<number> = [];

    for (const oid of [SYS_DESCR, SYS_UP_TIME, IF_PHYS_ADDRESS, CISCO_CPU]) {
      typeLefts.push(
        (await rowOf(page, oid)
          .getByTestId("snmp-walk-row-type")
          .boundingBox())!.x,
      );
      valueLefts.push(
        (await rowOf(page, oid)
          .getByTestId("snmp-walk-row-value")
          .boundingBox())!.x,
      );
    }

    for (const left of typeLefts) {
      expect(Math.abs(left - typeLefts[0]!)).toBeLessThanOrEqual(1);
    }
    for (const left of valueLefts) {
      expect(Math.abs(left - valueLefts[0]!)).toBeLessThanOrEqual(1);
    }

    // The header's titles sit over their columns: one grid, rows as subgrids.
    const titles: Locator = header.locator("span");
    expect(
      Math.abs((await titles.nth(1).boundingBox())!.x - typeLefts[0]!),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs((await titles.nth(2).boundingBox())!.x - valueLefts[0]!),
    ).toBeLessThanOrEqual(1);

    // Every row's one action ends at the same edge: Collect, or Alert on it.
    const actionRights: Array<number> = [];

    for (const action of [
      rowOf(page, SYS_DESCR).getByTestId("snmp-walk-row-collect"),
      rowOf(page, CISCO_CPU).getByTestId("snmp-walk-row-alert"),
    ]) {
      const box: { x: number; width: number } = (await action.boundingBox())!;
      actionRights.push(box.x + box.width);
    }
    expect(Math.abs(actionRights[0]! - actionRights[1]!)).toBeLessThanOrEqual(
      1,
    );

    // A collected OID says so beside its name, on the name's line.
    const cpuName: { y: number; height: number } = (await rowOf(page, CISCO_CPU)
      .getByTestId("snmp-walk-row-name")
      .boundingBox())!;
    const cpuCollected: { y: number; height: number } = (await rowOf(
      page,
      CISCO_CPU,
    )
      .getByTestId("snmp-walk-row-collected")
      .boundingBox())!;
    expect(
      Math.abs(
        cpuCollected.y +
          cpuCollected.height / 2 -
          (cpuName.y + cpuName.height / 2),
      ),
    ).toBeLessThanOrEqual(2);

    // A long value shows its start, and all of it on request.
    const description: Locator = rowOf(page, SYS_DESCR);
    await expect(
      description.getByTestId("snmp-walk-row-value"),
    ).not.toContainText("Copyright");
    await description.getByTestId("snmp-walk-row-value-toggle").click();
    await expect(description.getByTestId("snmp-walk-row-value")).toContainText(
      "Copyright (c) 1986-2023 by Cisco Systems, Inc.",
    );
    await expect(
      description.getByTestId("snmp-walk-row-value-toggle"),
    ).toHaveText("Show less");
    await description.getByTestId("snmp-walk-row-value-toggle").click();
    await expect(
      description.getByTestId("snmp-walk-row-value-toggle"),
    ).toHaveText("Show all");

    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, "walk-1280-light");
  });

  test("the filter finds an OID by its number, name or value", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);
    await expect(rows(page)).toHaveCount(26);

    const filter: Locator = page.getByTestId("snmp-walk-filter");

    await filter.fill("ifDescr");
    await expect(page.getByTestId("snmp-walk-filter-count")).toHaveText(
      "3 of 26 OIDs match.",
    );
    await expect(rows(page)).toHaveCount(3);

    await filter.fill("uplink to core");
    await expect(page.getByTestId("snmp-walk-filter-count")).toHaveText(
      "1 of 26 OIDs matches.",
    );
    await expect(rows(page)).toHaveCount(1);

    // Cisco's five OIDs, and sysObjectID, whose value is Cisco's arc.
    await filter.fill("1.3.6.1.4.1.9");
    await expect(rows(page)).toHaveCount(6);
    await expect(rowOf(page, "1.3.6.1.2.1.1.2.0")).toBeVisible();

    await filter.fill("no such value");
    await expect(page.getByTestId("snmp-walk-no-match")).toHaveText(
      'No OIDs match "no such value".',
    );
    await expect(rows(page)).toHaveCount(0);

    await filter.fill("");
    await expect(rows(page)).toHaveCount(26);
  });
});

test.describe("walking", () => {
  test("a subtree picked from the starting points is asked for by device and OID, never with credentials", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?scenario=empty");

    await expect(page.getByTestId("snmp-walk-empty")).toHaveText(
      "Not walked yet. Walk the device to see every OID it answers, with its type and value.",
    );
    await expect(page.getByTestId("snmp-walk-form")).toContainText(
      'Runs on the probe "Frankfurt DC2 probe" with this device\'s SNMP credentials, up to 1,000 OIDs at a time.',
    );

    const system: Locator = page.getByTestId(
      "snmp-walk-start-point-1.3.6.1.2.1.1",
    );
    await system.click();
    await expect(page.getByTestId("snmp-walk-start-oid")).toHaveValue(
      "1.3.6.1.2.1.1",
    );
    await expect(system).toHaveAttribute("aria-pressed", "true");

    await page.getByTestId("snmp-walk-start").click();

    await expect(page.getByTestId("snmp-walk-running")).toContainText(
      "Walking 1.3.6.1.2.1.1…",
    );
    await expect(page.getByTestId("snmp-walk")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(page.getByTestId("snmp-walk-start")).toBeDisabled();

    await expect(page.getByTestId("snmp-walk-summary")).toHaveText(
      "7 OIDs under 1.3.6.1.2.1.1.",
      { timeout: 15000 },
    );
    await expect(page.getByTestId("snmp-walk-running")).toHaveCount(0);
    await expect(rows(page)).toHaveCount(7);

    const state: FixtureState = await fixtureState(page);

    expect(state.creates).toEqual([
      {
        networkDeviceId: DEVICE_ID,
        diagnosticType: "SNMP Walk",
        snmpWalkRootOid: "1.3.6.1.2.1.1",
        snmpWalkAfterOid: null,
      },
    ]);
    // What went on the wire: the device, the type and the subtree.
    expect(state.sent).toHaveLength(1);
    for (const column of state.sent[0]!) {
      expect(column).not.toMatch(/community|v3|auth|priv|password|credential/i);
    }
    expect(state.sent[0]).toEqual(
      expect.arrayContaining([
        "diagnosticType",
        "networkDeviceId",
        "snmpWalkRootOid",
      ]),
    );
  });

  test("a MIB name is refused, and a typed OID walks on Enter", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?scenario=empty");

    const start: Locator = page.getByTestId("snmp-walk-start-oid");

    await start.fill("sysDescr");
    await expect(page.getByTestId("snmp-walk-start-invalid")).toHaveText(
      "Use a numeric OID such as 1.3.6.1.2.1.1, not a MIB name.",
    );
    await expect(page.getByTestId("snmp-walk-start")).toBeDisabled();

    await start.fill("1.3.6.1.2.1.2");
    await expect(page.getByTestId("snmp-walk-start-invalid")).toHaveCount(0);
    await start.press("Enter");

    await expect(page.getByTestId("snmp-walk-summary")).toHaveText(
      "9 OIDs under 1.3.6.1.2.1.2.",
      { timeout: 15000 },
    );
    expect((await fixtureState(page)).creates[0]!.snmpWalkRootOid).toBe(
      "1.3.6.1.2.1.2",
    );
  });

  test("a walk still running when the page opens is followed to its end", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?scenario=running");

    await expect(page.getByTestId("snmp-walk-running")).toContainText(
      "Walking 1.3.6.1.4.1…",
    );
    await expect(page.getByTestId("snmp-walk-start-oid")).toHaveValue(
      "1.3.6.1.4.1",
    );

    await expect(page.getByTestId("snmp-walk-summary")).toHaveText(
      "5 OIDs under 1.3.6.1.4.1.",
      { timeout: 15000 },
    );
    // Followed, not asked for again.
    expect((await fixtureState(page)).creates).toEqual([]);
  });

  test("a walk that stopped at its limit continues where it stopped, as one list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?scenario=more");

    await expect(page.getByTestId("snmp-walk-summary")).toHaveText(
      "1,000 OIDs read under 1.3.6.1.2.1.2 so far. There is more to read.",
    );
    // A thousand rows come a hundred at a time.
    await expect(rows(page)).toHaveCount(100);
    await expect(page.getByTestId("snmp-walk-results")).toContainText(
      "Showing 100 of 1,000",
    );
    await page.getByTestId("snmp-walk-show-more").click();
    await expect(rows(page)).toHaveCount(200);

    /*
     * "Read more from the device" never sits beside "show more of what was
     * read": the way on waits where the list really ends - here, the end
     * of what a filter keeps.
     */
    await expect(page.getByTestId("snmp-walk-continue-bottom")).toHaveCount(0);
    await page.getByTestId("snmp-walk-filter").fill("1.3.6.1.2.1.2.2.1.10.99");
    await expect(rows(page)).toHaveCount(11);
    await expect(page.getByTestId("snmp-walk-show-more")).toHaveCount(0);
    await expect(page.getByTestId("snmp-walk-continue-bottom")).toBeVisible();
    await expect(page.getByTestId("snmp-walk-list-end")).toContainText(
      "Reads up to 1,000 more OIDs, after 1.3.6.1.2.1.2.2.1.10.1000.",
    );
    await page.getByTestId("snmp-walk-filter").fill("");
    await expect(rows(page)).toHaveCount(100);

    await page.getByTestId("snmp-walk-continue").click();

    await expect(page.getByTestId("snmp-walk-running")).toContainText(
      "Walking on under 1.3.6.1.2.1.2 from where the last walk stopped…",
    );
    // What was read stays on the page meanwhile.
    await expect(rows(page).first()).toBeVisible();

    await expect(page.getByTestId("snmp-walk-summary")).toHaveText(
      "1,200 OIDs under 1.3.6.1.2.1.2.",
      { timeout: 15000 },
    );
    await expect(page.getByTestId("snmp-walk-continue")).toHaveCount(0);

    expect((await fixtureState(page)).creates).toEqual([
      {
        networkDeviceId: DEVICE_ID,
        diagnosticType: "SNMP Walk",
        snmpWalkRootOid: "1.3.6.1.2.1.2",
        snmpWalkAfterOid: "1.3.6.1.2.1.2.2.1.10.1000",
      },
    ]);

    await page
      .getByTestId("snmp-walk-filter")
      .fill("1.3.6.1.2.1.2.2.1.10.1200");
    await expect(page.getByTestId("snmp-walk-filter-count")).toHaveText(
      "1 of 1,200 OIDs matches.",
    );
  });
});

test.describe("turning an OID into monitoring", () => {
  test("Collect adds the OID to the device's health OIDs, and Alert on it opens a monitor on it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    const load: Locator = rowOf(page, HR_PROCESSOR_LOAD);

    // An OID the device does not collect yet: Collect, and no alert yet.
    await expect(load.getByTestId("snmp-walk-row-alert")).toHaveCount(0);
    await load.getByTestId("snmp-walk-row-collect").click();

    await expect(load.getByTestId("snmp-walk-row-collected")).toHaveText(
      "Collected",
    );
    // Said in the row Collect was pressed in, not somewhere up the page.
    const notice: Locator = load.getByTestId("snmp-walk-collect-notice");
    await expect(notice).toHaveText(
      "Collected from the next poll on, and charted on the device's Metrics page.",
    );
    const noticeBox: { y: number; height: number } =
      (await notice.boundingBox())!;
    const loadBox: { y: number; height: number } = (await load.boundingBox())!;
    expect(noticeBox.y).toBeGreaterThanOrEqual(loadBox.y);
    expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(
      loadBox.y + loadBox.height + 1,
    );
    await expect(page.getByTestId("snmp-walk-collect-notice")).toHaveCount(1);

    const written: Array<Written> = (await fixtureState(page)).updates;

    expect(written).toHaveLength(1);
    expect(written[0]!.model).toBe("NetworkDevice");
    expect(written[0]!.id).toBe(DEVICE_ID);
    // Added to the device's own list, keeping what was there.
    expect(
      written[0]!.data.snmpOids!.map((entry: { oid: string }) => {
        return entry.oid;
      }),
    ).toEqual([CISCO_CPU, HR_PROCESSOR_LOAD]);

    // Alert on it: a new monitor on this device and OID, from its value.
    const alert: Locator = load.getByTestId("snmp-walk-row-alert");
    await expect(alert).toHaveText("Alert on it");

    const href: string = (await alert.getAttribute("href"))!;
    const target: URL = new URL(href, "http://127.0.0.1");

    expect(target.pathname).toBe(`/dashboard/${PROJECT_ID}/monitors/create`);
    expect(target.searchParams.get("networkDeviceId")).toBe(DEVICE_ID);
    expect(target.searchParams.get("snmpOid")).toBe(HR_PROCESSOR_LOAD);
    expect(target.searchParams.get("snmpOidType")).toBe("Integer");
    expect(target.searchParams.get("snmpOidValue")).toBe("12");

    // An OID the device already collected was Collected from the start.
    const cpu: Locator = rowOf(page, CISCO_CPU);
    await expect(cpu.getByTestId("snmp-walk-row-collected")).toBeVisible();
    await expect(cpu.getByTestId("snmp-walk-row-collect")).toHaveCount(0);
    const cpuTarget: URL = new URL(
      (await cpu.getByTestId("snmp-walk-row-alert").getAttribute("href"))!,
      "http://127.0.0.1",
    );
    expect(cpuTarget.searchParams.get("snmpOidType")).toBe("Gauge32");
    expect(cpuTarget.searchParams.get("snmpOidValue")).toBe("7");

    await shoot(page, "collected-1280-light");
  });

  test("the row's menu copies the OID, and collects it on every device using the template", async ({
    page,
    context,
  }: {
    page: Page;
    context: BrowserContext;
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page, "?scenario=template");

    // In the template already: collected on this device through it.
    await expect(
      rowOf(page, SYS_UP_TIME).getByTestId("snmp-walk-row-collected"),
    ).toBeVisible();

    const name: Locator = rowOf(page, SYS_NAME);

    await name.getByTestId("snmp-walk-row-more").click();
    await expect(
      page.getByRole("menuitem", { name: "Copy OID" }),
    ).toBeVisible();
    await page.getByRole("menuitem", { name: "Copy OID" }).click();

    expect(
      await page.evaluate(async () => {
        return await navigator.clipboard.readText();
      }),
    ).toBe(SYS_NAME);

    await name.getByTestId("snmp-walk-row-more").click();
    const onTemplate: Locator = page.getByRole("menuitem", {
      name: "Collect on every device using Cisco Catalyst 9300",
    });
    await expect(onTemplate).toBeVisible();
    await shoot(page, "row-menu-1280-light");
    await onTemplate.click();

    await expect(name.getByTestId("snmp-walk-row-collected")).toBeVisible();
    await expect(name.getByTestId("snmp-walk-collect-notice")).toHaveText(
      "Every device using Cisco Catalyst 9300 collects it from its next poll on.",
    );

    const written: Array<Written> = (await fixtureState(page)).updates;

    expect(written).toHaveLength(1);
    expect(written[0]!.model).toBe("Template");
    expect(
      written[0]!.data.oids!.map((entry: { oid: string }) => {
        return entry.oid;
      }),
    ).toEqual([SYS_UP_TIME, SYS_NAME]);
  });
});

test.describe("when a walk does not go to plan", () => {
  test("credentials the device refused are named, with the way to Settings", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?scenario=auth");

    const failure: Locator = page.getByTestId("snmp-walk-failure");

    await expect(failure).toContainText("The device refused the credentials");
    await expect(failure).toContainText(
      "The authentication password or protocol does not match the device's.",
    );
    await expect(
      page.getByTestId("snmp-walk-failure-settings"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/network-devices/${DEVICE_ID}/settings`,
    );
    // A refusal is not "nothing under it".
    await expect(page.getByTestId("snmp-walk-summary")).toHaveCount(0);
    // When the walk ran, then why it read nothing - never left under the box.
    const meta: Locator = page.getByTestId("snmp-walk-meta");
    await expect(meta).toContainText("SNMP v3");
    expect((await meta.boundingBox())!.y).toBeLessThan(
      (await failure.boundingBox())!.y,
    );
  });

  test("a device that never answered points at the community string, SNMP and UDP 161", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?scenario=timeout");

    const failure: Locator = page.getByTestId("snmp-walk-failure");

    await expect(failure).toContainText("The device did not answer");
    await expect(failure).toContainText(
      "A wrong community string looks exactly like this",
    );
    await expect(failure).toHaveAttribute("role", "alert");
  });

  test("a device that went quiet part of the way keeps what it read, and can be walked on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?scenario=partial");

    const failure: Locator = page.getByTestId("snmp-walk-failure");

    await expect(failure).toContainText("The device stopped answering");
    await expect(failure).toContainText(
      "A busy device sometimes goes quiet part of the way. Continue walking to read the rest.",
    );
    const summary: Locator = page.getByTestId("snmp-walk-summary");
    await expect(summary).toHaveText(
      "12 OIDs read under 1.3.6.1 before the walk stopped.",
    );
    // What it read, then why it stopped.
    expect((await summary.boundingBox())!.y).toBeLessThan(
      (await failure.boundingBox())!.y,
    );
    await expect(rows(page)).toHaveCount(12);
    await expect(page.getByTestId("snmp-walk-continue")).toBeVisible();
  });

  test("a subtree the device does not have says so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?scenario=nothing");

    await expect(page.getByTestId("snmp-walk-summary")).toHaveText(
      "Nothing under 1.3.6.1.2.1.25. The device may not implement it, or the SNMP view of its credentials may not include it.",
    );
    await expect(page.getByTestId("snmp-walk-results")).toHaveCount(0);
  });

  test("a walk the server refuses, and a probe too old to walk, say why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?scenario=refused");
    await page.getByTestId("snmp-walk-start").click();

    const refused: Locator = page.getByTestId("snmp-walk-error");
    await expect(refused).toContainText("The walk could not run");
    await expect(refused).toContainText(
      "This device has no SNMP credentials to walk it with.",
    );
    await expect(page.getByTestId("snmp-walk-start")).toBeEnabled();

    await open(page, "?scenario=upgrade");
    await page.getByTestId("snmp-walk-start").click();

    await expect(page.getByTestId("snmp-walk-error")).toContainText(
      "This device's probe runs a version that cannot walk SNMP. Update the probe to the latest version, then walk again.",
      { timeout: 15000 },
    );
  });

  test("a walk refused while another runs keeps the last walk on the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?scenario=busy");
    await expect(rows(page)).toHaveCount(26);

    await page.getByTestId("snmp-walk-start").click();

    const refused: Locator = page.getByTestId("snmp-walk-error");
    await expect(refused).toContainText(
      "This device is already being walked. Wait for that walk to finish, then walk it again.",
    );
    // What the device answered last time is still there to read and use.
    await expect(rows(page)).toHaveCount(26);
    await expect(page.getByTestId("snmp-walk-summary")).toHaveText(
      "26 OIDs under 1.3.6.1.",
    );
    expect((await refused.boundingBox())!.y).toBeLessThan(
      (await page.getByTestId("snmp-walk-summary").boundingBox())!.y,
    );
  });

  test("a device with no probe has nothing to walk it from", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?scenario=noprobe");

    await expect(page.getByTestId("snmp-walk-no-probe")).toContainText(
      "This device has no probe assigned, so there is nothing to walk it from.",
    );
    await expect(page.getByTestId("snmp-walk-form")).toHaveCount(0);
  });
});

test.describe("who may do what", () => {
  test("a reader sees the last walk, and nothing to change anything with", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?role=viewer");

    await expect(page.getByTestId("snmp-walk-read-only")).toHaveText(
      "You can read this device's last walk. Walking it needs the Create Network Device Diagnostic permission.",
    );
    await expect(page.getByTestId("snmp-walk-form")).toHaveCount(0);
    await expect(rows(page)).toHaveCount(26);
    await expect(page.getByTestId("snmp-walk-row-collect")).toHaveCount(0);
    await expect(page.getByTestId("snmp-walk-row-alert")).toHaveCount(0);

    // The menu still copies.
    await rowOf(page, SYS_NAME).getByTestId("snmp-walk-row-more").click();
    await expect(page.getByRole("menuitem")).toHaveCount(1);
    await expect(
      page.getByRole("menuitem", { name: "Copy OID" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // With nothing to do on a row, there is no empty action column.
    const valueRight: number = await rowOf(page, SYS_NAME)
      .getByTestId("snmp-walk-row-value")
      .evaluate((element: Element): number => {
        return element.parentElement!.parentElement!.getBoundingClientRect()
          .right;
      });
    const moreLeft: number = (await rowOf(page, SYS_NAME)
      .getByTestId("snmp-walk-row-more")
      .boundingBox())!.x;
    expect(moreLeft - valueRight).toBeLessThanOrEqual(40);

    // A device nobody walked offers no "last walk" to read.
    await open(page, "?role=viewer&scenario=empty");
    await expect(page.getByTestId("snmp-walk-read-only")).toHaveText(
      "This device has not been walked yet. Walking it needs the Create Network Device Diagnostic permission.",
    );
    await expect(page.getByTestId("snmp-walk-result")).toHaveCount(0);
  });

  test("someone who may walk but not edit the device walks, and collects nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?role=walker");

    await expect(page.getByTestId("snmp-walk-form")).toBeVisible();
    await expect(rows(page)).toHaveCount(26);
    await expect(page.getByTestId("snmp-walk-row-collect")).toHaveCount(0);
    // Collected through the device, but no monitor may be created.
    await expect(
      rowOf(page, CISCO_CPU).getByTestId("snmp-walk-row-collected"),
    ).toBeVisible();
    await expect(page.getByTestId("snmp-walk-row-alert")).toHaveCount(0);
  });
});

test.describe("at a phone's width, in the dark and in other languages", () => {
  test("each row stacks, the type sits beside the value, and nothing scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await expect(rows(page)).toHaveCount(26);

    expect(await overflow(page)).toBeLessThanOrEqual(0);

    // The table's header is the laptop's; a phone reads each row alone.
    await expect(page.getByTestId("snmp-walk-results-header")).toBeHidden();

    const description: Locator = rowOf(page, SYS_DESCR);
    await expect(description.getByTestId("snmp-walk-row-type")).toBeHidden();
    await expect(
      description.getByTestId("snmp-walk-row-type-phone"),
    ).toBeVisible();

    // The value sits under the name, and the menu keeps its corner.
    const rowBox: { x: number; y: number; width: number } =
      (await description.boundingBox())!;
    const nameBox: { y: number; height: number } = (await description
      .getByTestId("snmp-walk-row-name")
      .boundingBox())!;
    const valueBox: { y: number; x: number; width: number } = (await description
      .getByTestId("snmp-walk-row-value")
      .boundingBox())!;
    const moreBox: { x: number; width: number } = (await description
      .getByTestId("snmp-walk-row-more")
      .boundingBox())!;

    expect(valueBox.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height - 1);
    expect(valueBox.x + valueBox.width).toBeLessThanOrEqual(
      rowBox.x + rowBox.width + 1,
    );
    expect(moreBox.x + moreBox.width).toBeLessThanOrEqual(
      rowBox.x + rowBox.width + 1,
    );

    /*
     * The row's action sits under its value, at the row's left edge: beside
     * the name it squeezed names, OIDs and hints into a third of a phone.
     */
    const collectBox: { x: number; y: number } = (await description
      .getByTestId("snmp-walk-row-collect")
      .boundingBox())!;
    expect(collectBox.y).toBeGreaterThanOrEqual(valueBox.y + 1);
    expect(Math.abs(collectBox.x - rowBox.x)).toBeLessThanOrEqual(1);
    // The name has the row's width, but for the menu in its corner.
    expect(nameBox.y).toBeLessThan(collectBox.y);
    const nameWidth: number = (await description
      .getByTestId("snmp-walk-row-name")
      .evaluate((element: Element) => {
        return element.parentElement!.parentElement!.getBoundingClientRect()
          .width;
      })) as number;
    expect(nameWidth).toBeGreaterThan(rowBox.width - moreBox.width - 24);

    // The row's menu opens inside the screen.
    await rowOf(page, SYS_NAME).getByTestId("snmp-walk-row-more").click();
    const item: { x: number; width: number } = (await page
      .getByRole("menuitem", { name: "Copy OID" })
      .boundingBox())!;
    expect(item.x).toBeGreaterThanOrEqual(0);
    expect(item.x + item.width).toBeLessThanOrEqual(390);
    await page.keyboard.press("Escape");

    await shoot(page, "walk-390-light");
  });

  test("beside the device page's side menu, the rows stack until the results are wide enough for the table", async ({
    page,
  }: {
    page: Page;
  }) => {
    /*
     * The device page's side menu appears at 768 pixels and takes about
     * 330 of them, so a 768 to 1100 pixel window leaves the card 478 to
     * 758 pixels. The table used to switch on at the window's md and
     * crushed the name and value columns to a few letters a line.
     */
    await open(page, "?frame=478");
    await expect(rows(page)).toHaveCount(26);

    const results: Locator = page.getByTestId("snmp-walk-results");
    expect((await results.boundingBox())!.width).toBeLessThan(704);
    await expect(page.getByTestId("snmp-walk-results-header")).toBeHidden();

    const description: Locator = rowOf(page, SYS_DESCR);
    await expect(description.getByTestId("snmp-walk-row-type")).toBeHidden();
    await expect(
      description.getByTestId("snmp-walk-row-type-phone"),
    ).toBeVisible();
    expect(
      (await description.getByTestId("snmp-walk-row-value").boundingBox())!
        .width,
    ).toBeGreaterThan(250);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, "walk-768-side-menu");

    // A 1100-pixel window: 710 pixels of results, and the table.
    await open(page, "?frame=758");
    expect((await results.boundingBox())!.width).toBeGreaterThanOrEqual(704);
    await expect(page.getByTestId("snmp-walk-results-header")).toBeVisible();
    await expect(
      rowOf(page, SYS_DESCR).getByTestId("snmp-walk-row-type"),
    ).toBeVisible();

    // No column is crushed: the OID's and the value's each keep a share.
    const nameCellWidth: number = await rowOf(page, SYS_DESCR)
      .getByTestId("snmp-walk-row-name")
      .evaluate((element: Element): number => {
        return element.parentElement!.parentElement!.getBoundingClientRect()
          .width;
      });
    expect(nameCellWidth).toBeGreaterThan(150);
    expect(
      (await rowOf(page, SYS_DESCR)
        .getByTestId("snmp-walk-row-value")
        .boundingBox())!.width,
    ).toBeGreaterThan(150);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test("the form stacks at a phone's width, with its starting points wrapping", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "?scenario=empty");
    await expect(page.getByTestId("snmp-walk-form")).toBeVisible();

    expect(await overflow(page)).toBeLessThanOrEqual(0);

    const input: { y: number; height: number } = (await page
      .getByTestId("snmp-walk-start-oid")
      .boundingBox())!;
    const walk: { y: number } = (await page
      .getByTestId("snmp-walk-start")
      .boundingBox())!;
    expect(walk.y).toBeGreaterThanOrEqual(input.y + input.height - 1);

    await shoot(page, "form-390-light");
  });

  test("every surface is dark in the dark theme, at a laptop's and a phone's width", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?theme=dark");
    await expect(rows(page)).toHaveCount(26);

    const card: Locator = page
      .getByTestId("snmp-walk")
      .locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
    expect(await backgroundBrightness(card)).toBeLessThan(3 * 128);
    expect(
      await textBrightness(page.getByTestId("snmp-walk-summary")),
    ).toBeGreaterThan(3 * 128);
    expect(
      await textBrightness(
        rowOf(page, SYS_NAME).getByTestId("snmp-walk-row-value"),
      ),
    ).toBeGreaterThan(3 * 128);
    expect(
      await backgroundBrightness(
        rowOf(page, SYS_NAME).getByTestId("snmp-walk-row-type"),
      ),
    ).toBeLessThan(3 * 128);
    await shoot(page, "walk-1280-dark");

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, "walk-390-dark");

    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, "?scenario=auth&theme=dark");
    expect(
      await backgroundBrightness(page.getByTestId("snmp-walk-failure")),
    ).toBeLessThan(3 * 128);
    await shoot(page, "failure-1280-dark");
  });

  test("the page reads in Japanese and in German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?lang=ja");

    await expect(
      page.getByText("SNMP ウォーク", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("snmp-walk-summary")).toHaveText(
      "1.3.6.1 の下に 26 個の OID があります。",
    );
    await expect(page.getByTestId("snmp-walk-start")).toContainText("ウォーク");
    await expect(
      rowOf(page, HR_PROCESSOR_LOAD).getByTestId("snmp-walk-row-collect"),
    ).toContainText("収集");
    await expect(page.getByTestId("snmp-walk-filter")).toHaveAttribute(
      "placeholder",
      "OID、名前、値で絞り込む",
    );

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, "walk-390-ja");

    await open(page, "?lang=de&scenario=more");
    await expect(page.getByTestId("snmp-walk-summary")).toHaveText(
      "Bisher 1.000 OIDs unter 1.3.6.1.2.1.2 gelesen. Es gibt noch mehr zu lesen.",
    );
    await expect(page.getByTestId("snmp-walk-continue")).toContainText(
      "Walk fortsetzen",
    );
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, "more-390-de");
  });
});
