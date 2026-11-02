import { expect, Locator, Page, test } from "@playwright/test";
import path from "path";

/*
 * Where each asset detail came from, and when (OneUptime issue #5185), end
 * to end in a browser, against the fixture's in-page API
 * (AssetDetails/Fixture.js): Inventory's Asset Details card, a network
 * device's own Inventory card and its Overview (and an Inventory item's own
 * page, with its Security card), for a switch OneUptime only
 * pings (its details from a discovery scan, its MAC from a router's ARP
 * table), a switch walked over SNMP, one walked days ago and scanned since,
 * values someone saved that discovery reads differently, values typed by
 * hand, another machine at a device's address, a firewall polled at a DNS
 * name, a host, and a device the reader cannot read - at a laptop's and a
 * phone's width, in the dark theme, in Japanese and in German. The reading
 * most details came from is said once, below them; every other source under
 * its value (UI review). Screenshots in output/playwright/asset-details-ui
 * are for the people who review the page.
 */

const DEVICE_ID: string = "40000000-0000-4000-8000-000000000001";

// The scan the ping-only switch's details came from, said once.
const SCAN_LINE: string =
  "Read over SNMP by discovery scan Store subnets, 2 hours ago.";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/asset-details-ui",
);

interface FixtureRead {
  model: string;
  id?: string | null;
  select: Array<string>;
}

async function open(page: Page, query: string = ""): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.getByTestId("fixture-page")).toBeVisible();
  // Inter, as production draws the page: widths and wraps are measured.
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

// The Asset Details card, once the device it mirrors has been read.
async function openItem(page: Page, query: string = ""): Promise<Locator> {
  await open(page, query);
  const card: Locator = page.getByTestId("inventory-asset-details");
  await expect(card).toBeVisible();
  return card;
}

async function reads(page: Page): Promise<Array<FixtureRead>> {
  return await page.evaluate(() => {
    return JSON.parse(
      JSON.stringify(
        (
          window as unknown as {
            __assetDetailsFixture: { state: { reads: unknown } };
          }
        ).__assetDetailsFixture.state.reads,
      ),
    );
  });
}

function value(page: Page, field: string): Locator {
  return page.getByTestId(`inventory-asset-${field}-value`);
}

function source(page: Page, field: string): Locator {
  return page.getByTestId(`inventory-asset-${field}-value-source`);
}

function different(page: Page, field: string): Locator {
  return page.getByTestId(`inventory-asset-${field}-value-different`);
}

// The line said once, below the details: the reading most of them came from.
function saidOnce(page: Page): Locator {
  return page.getByTestId("inventory-asset-details-source");
}

// The device's Overview page, at its own address.
async function openOverview(page: Page, query: string = ""): Promise<void> {
  await page.goto(`/network-devices/${DEVICE_ID}?page=overview${query}`);
  await expect(page.getByTestId("fixture-page")).toBeVisible();
  await expect(page.getByText("Device Details")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function overflow(page: Page): Promise<number> {
  return await page.evaluate(() => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
}

function channels(color: string): Array<number> {
  return (color.match(/\d+(\.\d+)?/g) || []).map(Number);
}

async function backgroundBrightness(locator: Locator): Promise<number> {
  const background: string = await locator.evaluate((element: Element) => {
    return getComputedStyle(element).backgroundColor;
  });
  const rgb: Array<number> = channels(background);

  return rgb[0]! + rgb[1]! + rgb[2]!;
}

async function textColor(locator: Locator): Promise<Array<number>> {
  return channels(
    await locator.evaluate((element: Element) => {
      return getComputedStyle(element).color;
    }),
  );
}

async function textBrightness(locator: Locator): Promise<number> {
  const rgb: Array<number> = await textColor(locator);

  return rgb[0]! + rgb[1]! + rgb[2]!;
}

// Whether every element matching `locator` stays inside `container`.
async function staysInside(
  locator: Locator,
  container: Locator,
): Promise<boolean> {
  const box: { x: number; width: number } = (await container.boundingBox())!;
  const count: number = await locator.count();

  for (let index: number = 0; index < count; index++) {
    const inner: { x: number; width: number } | null = await locator
      .nth(index)
      .boundingBox();

    if (inner && inner.x + inner.width > box.x + box.width + 1) {
      return false;
    }
  }

  return true;
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve: (value: unknown) => void) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
  });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: true,
  });
}

test.describe("Inventory's Asset Details card, at a laptop's width", () => {
  test("a switch OneUptime only pings: the scan that read it said once, every other source under its value", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openItem(page);

    await expect(value(page, "hostname")).toContainText("edge-sw-07");
    await expect(value(page, "manufacturer")).toContainText("Cisco");
    await expect(value(page, "operatingSystem")).toContainText("Cisco IOS");
    await expect(value(page, "osVersion")).toContainText("15.2(7)E8");
    await expect(value(page, "location")).toContainText(
      "Store 12 · Store 12, back office rack",
    );

    // The six details the scan read: said once, below them, not six times.
    await expect(saidOnce(page)).toHaveText(SCAN_LINE);
    for (const field of [
      "hostname",
      "manufacturer",
      "operatingSystem",
      "osVersion",
      "location",
      "systemDescription",
    ]) {
      await expect(source(page, field)).toHaveCount(0);
    }

    // Every other source, under its value.
    await expect(value(page, "macAddress")).toContainText("00-1B-54-C2-7A-07");
    await expect(source(page, "macAddress")).toHaveText(
      "ARP table of core-rtr-01 · 3 hours ago",
    );
    await expect(value(page, "dnsName")).toContainText(
      "edge-sw-07.store-12.acme.example",
    );
    await expect(source(page, "dnsName")).toHaveText(
      "Discovery scan Store subnets (reverse DNS) · 2 hours ago",
    );
    await expect(source(page, "ipAddress")).toHaveText(
      "The address its probe polls",
    );
    await expect(source(page, "deviceType")).toHaveText(
      "Worked out from its name and what it reports",
    );

    // The exact time is on hover.
    await expect(source(page, "macAddress")).toHaveAttribute("title", /\d/);
    await expect(saidOnce(page)).toHaveAttribute("title", /\d/);

    /*
     * The scan that read it found it: not said twice. What nothing found:
     * still Unknown, after where the rest came from.
     */
    await expect(
      page.getByTestId("inventory-asset-details-found-by"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("inventory-asset-details-unknown"),
    ).toContainText(
      "neither this device's SNMP poll nor a discovery scan has found",
    );
    const sourceBox: { y: number } | null = await saidOnce(page).boundingBox();
    const unknownBox: { y: number } | null = await page
      .getByTestId("inventory-asset-details-unknown")
      .boundingBox();
    expect(sourceBox!.y).toBeLessThan(unknownBox!.y);

    // The card read the device itself, with every column its facts need.
    const deviceRead: FixtureRead | undefined = (await reads(page)).find(
      (read: FixtureRead) => {
        return read.model === "NetworkDevice";
      },
    );
    expect(deviceRead?.id).toBe(DEVICE_ID);
    expect(deviceRead?.select).toEqual(
      expect.arrayContaining([
        "discoveredDetails",
        "lastSnmpSeenAt",
        "isMacAddressLearned",
        "site",
        "networkDeviceRole",
      ]),
    );

    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, "item-pinged-1280-light");
  });

  test("a walked switch: its own poll is said once, below the details", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openItem(page, "?scenario=walked");

    await expect(saidOnce(page)).toHaveText(
      "Read over SNMP by its probe, 3 minutes ago.",
    );
    await expect(value(page, "serialNumber")).toContainText("FOC1840X0AB");

    // Nothing under the details the poll read...
    for (const field of [
      "hostname",
      "manufacturer",
      "model",
      "serialNumber",
      "firmwareVersion",
      "operatingSystem",
      "osVersion",
    ]) {
      await expect(source(page, field)).toHaveCount(0);
    }
    // ...and what came from anywhere else still says so.
    await expect(source(page, "macAddress")).toHaveText(
      "ARP table of core-rtr-01 · 22 minutes ago",
    );
    await expect(value(page, "deviceType")).toContainText("Core Switch");
    await expect(source(page, "deviceType")).toHaveText("Its assigned role");

    await shoot(page, "item-walked-1280-light");
  });

  test("a switch walked days ago and scanned since: the newer scan said once, the walk's values each say so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openItem(page, "?scenario=stale");

    await expect(saidOnce(page)).toHaveText(SCAN_LINE);
    for (const field of ["model", "serialNumber", "firmwareVersion"]) {
      await expect(source(page, field)).toHaveText(
        "Its SNMP poll · 3 days ago",
      );
    }
    await expect(source(page, "hostname")).toHaveCount(0);

    await shoot(page, "item-stale-1280-light");
  });

  test("found at its address again since the scan read it: both said, below the details", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openItem(page, "?scenario=refound");

    await expect(saidOnce(page)).toHaveText(SCAN_LINE);
    await expect(
      page.getByTestId("inventory-asset-details-found-by"),
    ).toHaveText(
      "Last found at its address by discovery scan Store subnets, 10 minutes ago.",
    );
  });

  test("values someone saved are kept; what discovery reads differently is shown under them, in amber", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openItem(page, "?scenario=disagree");

    await expect(value(page, "macAddress")).toContainText("00-1B-54-C2-7A-43");
    await expect(source(page, "macAddress")).toHaveText("Saved on this device");
    await expect(different(page, "macAddress")).toHaveText(
      "ARP table of core-rtr-01 says 00-1B-54-C2-7A-44 · 15 minutes ago",
    );
    await expect(value(page, "dnsName")).toContainText(
      "printer-3.old.acme.example",
    );
    await expect(different(page, "dnsName")).toHaveText(
      "Discovery scan Store subnets (reverse DNS) says printer-3.acme.example · 1 hour ago",
    );

    // Amber: red well above blue.
    const amber: Array<number> = await textColor(different(page, "macAddress"));
    expect(amber[0]!).toBeGreaterThan(amber[2]! + 60);

    await shoot(page, "item-disagree-1280-light");
  });

  test("a scan that found another machine at the address says so, and uses nothing it read there", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openItem(page, "?scenario=other");

    await expect(
      page.getByTestId("inventory-asset-details-other-machine"),
    ).toHaveText(
      "Discovery scan Store subnets found another machine at this address 1 hour ago (LAPTOP-12), so nothing it read there is used.",
    );
    // What the scan read when the device itself answered there still stands.
    await expect(value(page, "hostname")).toContainText("kiosk-04");
    await expect(saidOnce(page)).toHaveText(
      "Read over SNMP by discovery scan Store subnets, 4 days ago.",
    );

    await shoot(page, "item-other-machine-1280-light");
  });

  test("a firewall polled at a DNS name has the address its probe resolved", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openItem(page, "?scenario=dns");

    await expect(value(page, "ipAddress")).toContainText("10.0.0.1");
    await expect(source(page, "ipAddress")).toHaveText(
      "DNS lookup by its probe (Frankfurt DC2 probe) · 2 minutes ago",
    );
    await expect(value(page, "dnsName")).toContainText(
      "core-fw-01.acme.example",
    );
    await expect(source(page, "dnsName")).toHaveText(
      "The address its probe polls",
    );

    await shoot(page, "item-dns-1280-light");
  });

  test("a host: its collector said once; a location from its cloud zone says so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openItem(page, "?scenario=host");

    await expect(saidOnce(page)).toHaveText(
      "Reported by its collector, 2 minutes ago.",
    );
    await expect(source(page, "hostname")).toHaveCount(0);
    await expect(value(page, "location")).toContainText("westeurope");
    await expect(source(page, "location")).toHaveText("Its cloud zone");
    await expect(source(page, "deviceType")).toHaveText(
      "Worked out from its name and what it reports",
    );
    // A host is not a network device: nothing is read for it.
    expect(
      (await reads(page)).filter((read: FixtureRead) => {
        return read.model === "NetworkDevice";
      }),
    ).toEqual([]);

    await shoot(page, "item-host-1280-light");
  });

  test("a device the reader cannot read: the item's own facts, as before", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openItem(page, "?scenario=noread");

    await expect(value(page, "hostname")).toContainText("edge-sw-07");
    await expect(value(page, "manufacturer")).toContainText("Cisco");
    await expect(source(page, "hostname")).toHaveCount(0);
    await expect(
      page.getByTestId("inventory-asset-details-found-by"),
    ).toHaveCount(0);

    await shoot(page, "item-noread-1280-light");
  });
});

test.describe("the device's own Inventory card", () => {
  test("a switch OneUptime only pings: the scan that read it said once, in the Discovery row", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?page=device");

    await expect(page.getByTestId("device-inventory-vendor")).toContainText(
      "Cisco",
    );
    await expect(page.getByTestId("device-inventory-os")).toContainText(
      "Cisco IOS",
    );
    await expect(page.getByTestId("device-inventory-location")).toContainText(
      "Store 12, back office rack",
    );
    await expect(page.getByTestId("device-inventory-contact")).toContainText(
      "netops@acme.example",
    );
    for (const testId of [
      "device-inventory-vendor",
      "device-inventory-os",
      "device-inventory-location",
      "device-inventory-contact",
    ]) {
      await expect(page.getByTestId(`${testId}-source`)).toHaveCount(0);
    }
    await expect(page.getByTestId("device-inventory-source")).toHaveText(
      SCAN_LINE,
    );
    await expect(page.getByTestId("device-inventory-found-by")).toHaveCount(0);

    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, "device-pinged-1280-light");
  });

  test("a walked switch: its own poll's values carry no line of their own", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?page=device&scenario=walked");

    await expect(page.getByTestId("device-inventory-model")).toContainText(
      "WS-C3850-48P",
    );
    for (const testId of [
      "device-inventory-vendor",
      "device-inventory-model",
      "device-inventory-serial",
      "device-inventory-os",
      "device-inventory-location",
    ]) {
      await expect(page.getByTestId(`${testId}-source`)).toHaveCount(0);
    }
    await expect(page.getByTestId("device-inventory-found-by")).toHaveText(
      "Last found at its address by discovery scan Store subnets, 1 hour ago.",
    );

    await shoot(page, "device-walked-1280-light");
  });
});

test.describe("the device's Overview", () => {
  test("a switch OneUptime only pings: what discovery read, each detail saying which scan or router", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "&scenario=pinged");

    await expect(
      page.getByTestId("network-device-details-dnsName"),
    ).toContainText("edge-sw-07.store-12.acme.example");
    await expect(
      page.getByTestId("network-device-details-dnsName-source"),
    ).toHaveText("Discovery scan Store subnets (reverse DNS) · 2 hours ago");
    await expect(
      page.getByTestId("network-device-details-macAddress-source"),
    ).toHaveText("ARP table of core-rtr-01 · 3 hours ago");
    await expect(
      page.getByTestId("network-device-details-sysDescr-source"),
    ).toHaveText("Discovery scan Store subnets (SNMP) · 2 hours ago");
    // Named after its sysName: not said twice.
    await expect(page.getByText("System Name (sysName)")).toHaveCount(0);
    // The Inventory card below says the scan once.
    await expect(page.getByTestId("device-inventory-source")).toHaveText(
      SCAN_LINE,
    );

    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, "overview-pinged-1280-light");

    await page.setViewportSize({ width: 390, height: 844 });
    await openOverview(page, "&scenario=pinged&theme=dark");
    await expect(
      page.getByTestId("network-device-details-dnsName-source"),
    ).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, "overview-pinged-390-dark");
  });

  test("values typed on the device say nothing; one discovery reads differently says it was saved", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "&scenario=typed");

    await expect(
      page.getByTestId("network-device-details-macAddress"),
    ).toContainText("00:1b:54:c2:7a:99");
    await expect(
      page.getByTestId("network-device-details-dnsName"),
    ).toContainText("lab-fw.lab.acme.example");
    await expect(page.getByText("Saved on this device")).toHaveCount(0);
    // Nothing read about it yet: how the Inventory card fills in.
    await expect(
      page.getByTestId("device-inventory-nothing-read"),
    ).toContainText("Nothing has been read from this device yet.");
    await shoot(page, "overview-typed-1280-light");

    await openOverview(page, "&scenario=disagree");
    await expect(page.getByTestId("device-inventory-nothing-read")).toHaveCount(
      0,
    );
    await expect(
      page.getByTestId("network-device-details-macAddress-source"),
    ).toHaveText("Saved on this device");
    await expect(
      page.getByTestId("network-device-details-macAddress-different"),
    ).toHaveText(
      "ARP table of core-rtr-01 says 00:1b:54:c2:7a:44 · 15 minutes ago",
    );
    await shoot(page, "overview-disagree-1280-light");
  });

  /*
   * The way back from Security Events: the device's Security card, named
   * by its name (its address is a private one, which names no machine for
   * sure) - the open case naming it, its week of events and findings, and
   * its risk, each opening Security Events on it (?security=).
   */
  test("its Security card: the case naming it, its week of events and findings, and its risk, each opening Security Events", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dashboard: string = "/dashboard/10000000-0000-4000-8000-000000000001";
    await openOverview(page, "&scenario=pinged&security=news");
    const card: Locator = page.getByTestId("resource-security-card");
    await expect(card).toBeVisible({ timeout: 30000 });
    await expect(card).toHaveAttribute("data-state", "news");
    await expect(card).toContainText(
      "What Security Events found about it in the last 7 days.",
    );

    const events: Locator = card.getByTestId("resource-security-open");
    await expect(events).toHaveText("46");
    const search: URL = new URL(
      (await events.getAttribute("href"))!,
      "http://127.0.0.1",
    );
    expect(search.pathname).toBe(`${dashboard}/security-events`);
    expect(decodeURIComponent(search.searchParams.get("search") || "")).toBe(
      "observable:edge-sw-07",
    );
    await expect(card).toContainText("27");

    const cases: Locator = card.getByTestId("resource-security-cases");
    await expect(cases.getByTestId("resource-security-case")).toHaveCount(1);
    expect(
      await cases
        .getByRole("link", { name: /Port scan from edge-sw-07/ })
        .getAttribute("href"),
    ).toBe(
      `${dashboard}/security-events/cases/20000000-0000-4000-8000-000000000133`,
    );
    const entity: URL = new URL(
      (await card
        .getByRole("link", { name: "Open in Security Events" })
        .getAttribute("href"))!,
      "http://127.0.0.1",
    );
    expect(entity.pathname).toBe(
      `${dashboard}/security-events/entity-risk/entity`,
    );
    expect(entity.searchParams.get("value")).toBe("edge-sw-07");

    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({
      path: path.join(SCREENSHOTS, "overview-security-card-1280-light.png"),
      animations: "disabled",
    });

    // On a phone, dark: the card reads whole, and nothing scrolls sideways.
    await page.setViewportSize({ width: 390, height: 844 });
    await openOverview(page, "&scenario=pinged&security=news&theme=dark");
    await expect(card.getByTestId("resource-security-case")).toBeVisible({
      timeout: 30000,
    });
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    const cardBox: { x: number; width: number } | null =
      await card.boundingBox();
    const caseBox: { x: number; width: number } | null = await card
      .getByTestId("resource-security-case")
      .boundingBox();
    expect(caseBox!.x).toBeGreaterThanOrEqual(cardBox!.x);
    expect(caseBox!.x + caseBox!.width).toBeLessThanOrEqual(
      cardBox!.x + cardBox!.width + 1,
    );
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({
      path: path.join(SCREENSHOTS, "overview-security-card-390-dark.png"),
      animations: "disabled",
    });
  });

  test("a quiet week says so in one line, and a project that uses no Security Events is told nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "&scenario=pinged&security=quiet");
    const card: Locator = page.getByTestId("resource-security-card");
    await expect(card).toBeVisible({ timeout: 30000 });
    await expect(card).toHaveAttribute("data-state", "quiet");
    await expect(card).toContainText(
      "No security event named it in the last 7 days.",
    );

    await openOverview(page, "&scenario=pinged");
    await expect(page.getByText("Device Details")).toBeVisible();
    await expect(card).toHaveCount(0);
  });
});

/*
 * The way back from Security Events on an Inventory item's own page
 * (Pages/Inventory/View/Index.tsx): a Windows host its collector reports,
 * whose Security card names it by its name - its address is a private one,
 * which names no machine for sure - with the open case naming it, its week
 * of events and findings, and its risk (?page=inventory&scenario=host).
 */
const ITEM_ID: string = "60000000-0000-4000-8000-000000000001";
const HOST_ITEM_NAME: string = "wbqajdebsv001";

interface SecurityAsk {
  kind: string;
  id: string;
}

// The item's page, at its own address; its header card names it.
async function openInventoryItem(
  page: Page,
  query: string = "",
): Promise<void> {
  await page.goto(`/inventory/${ITEM_ID}?page=inventory&scenario=host${query}`);
  await expect(page.getByTestId("fixture-page")).toBeVisible();
  await expect(page.getByTestId("inventory-asset-details")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

/*
 * A case row's number beside its title's first line, in the page's reading
 * direction: the gap from the number's end to the title's start, and
 * whether the two share a line. The number comes first, at the line's
 * start, with its gap between them - on a right-to-left page too, where a
 * number and a title written in Latin letters once ran together as one
 * left-to-right run, the number on the far side.
 */
async function caseNumberBesideTitle(
  row: Locator,
  number: string,
): Promise<{ gap: number; isOneLine: boolean }> {
  return await row.evaluate((element: Element, numberText: string) => {
    const leaves: Array<Element> = Array.from(
      element.querySelectorAll("*"),
    ).filter((candidate: Element): boolean => {
      return candidate.children.length === 0;
    });
    const numberPart: Element = leaves.find((candidate: Element): boolean => {
      return (candidate.textContent || "").trim() === numberText;
    })!;
    // The title: the next leaf with words in it, after the number.
    const titlePart: Element = leaves
      .slice(leaves.indexOf(numberPart) + 1)
      .find((candidate: Element): boolean => {
        return (candidate.textContent || "").trim().length > 0;
      })!;
    const numberBox: DOMRect = numberPart.getBoundingClientRect();
    const titleLine: DOMRect = titlePart.getClientRects()[0]!;
    const isRightToLeft: boolean =
      getComputedStyle(element).direction === "rtl";
    return {
      gap: isRightToLeft
        ? numberBox.left - titleLine.right
        : titleLine.left - numberBox.right,
      isOneLine: Math.abs(numberBox.top - titleLine.top) < 4,
    };
  }, number);
}

// What the page's Security card asked Security Events about.
async function securityAsks(page: Page): Promise<Array<SecurityAsk>> {
  return await page.evaluate(() => {
    return JSON.parse(
      JSON.stringify(
        (
          window as unknown as {
            __assetDetailsFixture: { state: { securityAsks: unknown } };
          }
        ).__assetDetailsFixture.state.securityAsks,
      ),
    );
  });
}

test.describe("an Inventory item's page: its Security card", () => {
  test("it asks about the item by its kind and id, and draws the case naming it, its week and its risk, each opening Security Events", async ({
    page,
  }: {
    page: Page;
  }) => {
    const errors: Array<string> = [];
    page.on("pageerror", (error: Error) => {
      errors.push(String(error));
    });
    const dashboard: string = "/dashboard/10000000-0000-4000-8000-000000000001";
    await openInventoryItem(page, "&security=news");
    const card: Locator = page.getByTestId("resource-security-card");
    await expect(card).toBeVisible({ timeout: 30000 });
    await expect(card).toHaveAttribute("data-state", "news");
    await expect(card).toContainText(
      "What Security Events found about it in the last 7 days.",
    );
    expect(await securityAsks(page)).toEqual([
      { kind: "InventoryItem", id: ITEM_ID },
    ]);

    const events: Locator = card.getByTestId("resource-security-open");
    await expect(events).toHaveText("18");
    const search: URL = new URL(
      (await events.getAttribute("href"))!,
      "http://127.0.0.1",
    );
    expect(search.pathname).toBe(`${dashboard}/security-events`);
    expect(decodeURIComponent(search.searchParams.get("search") || "")).toBe(
      `observable:${HOST_ITEM_NAME}`,
    );
    await expect(card).toContainText("41");
    await expect(card).toContainText("High");

    const cases: Locator = card.getByTestId("resource-security-cases");
    await expect(cases.getByTestId("resource-security-case")).toHaveCount(1);
    expect(
      await cases
        .getByRole("link", { name: /Repeated failed RDP sign-ins/ })
        .getAttribute("href"),
    ).toBe(
      `${dashboard}/security-events/cases/20000000-0000-4000-8000-000000000141`,
    );
    const entity: URL = new URL(
      (await card
        .getByRole("link", { name: "Open in Security Events" })
        .getAttribute("href"))!,
      "http://127.0.0.1",
    );
    expect(entity.pathname).toBe(
      `${dashboard}/security-events/entity-risk/entity`,
    );
    expect(entity.searchParams.get("value")).toBe(HOST_ITEM_NAME);

    /*
     * The rest of the page is the real one around it: the item's header
     * card links to its host page, and nothing the fixture does not model
     * was read (an unmodelled read throws, and the page would say so).
     */
    expect(
      await page
        .getByRole("link", { name: "Open host dashboard" })
        .getAttribute("href"),
    ).toBe(`${dashboard}/host/70000000-0000-4000-8000-000000000001`);
    await expect(
      page.getByText("This inventory item could not be found."),
    ).toHaveCount(0);
    expect(errors).toEqual([]);

    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({
      path: path.join(SCREENSHOTS, "inventory-security-card-1280-light.png"),
      animations: "disabled",
    });
  });

  test("a quiet week says so in one line, and a project that uses no Security Events is told nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openInventoryItem(page, "&security=quiet");
    const card: Locator = page.getByTestId("resource-security-card");
    await expect(card).toBeVisible({ timeout: 30000 });
    await expect(card).toHaveAttribute("data-state", "quiet");
    await expect(card).toContainText(
      "No security event named it in the last 7 days.",
    );

    await openInventoryItem(page);
    await expect
      .poll(
        async (): Promise<number> => {
          return (await securityAsks(page)).length;
        },
        { timeout: 30000 },
      )
      .toBe(1);
    await expect(card).toHaveCount(0);
  });

  for (const [name, query, slug] of [
    ["390, dark", "&theme=dark", "390-dark"],
    ["390, Persian right to left", "&lang=fa", "390-fa"],
  ] as Array<[string, string, string]>) {
    test(`at ${name}: the card reads whole, its case inside it, and nothing scrolls sideways`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openInventoryItem(page, `&security=news${query}`);
      const card: Locator = page.getByTestId("resource-security-card");
      await expect(card.getByTestId("resource-security-case")).toBeVisible({
        timeout: 30000,
      });
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      expect(
        await staysInside(card.getByTestId("resource-security-case"), card),
      ).toBe(true);
      const cardBox: { x: number; width: number } = (await card.boundingBox())!;
      const caseBox: { x: number; width: number } = (await card
        .getByTestId("resource-security-case")
        .boundingBox())!;
      expect(caseBox.x).toBeGreaterThanOrEqual(cardBox.x - 1);

      // The case's number first, its gap between it and the title.
      const beside: { gap: number; isOneLine: boolean } =
        await caseNumberBesideTitle(
          card.getByTestId("resource-security-case"),
          "SEC-141",
        );
      expect(beside.isOneLine).toBe(true);
      expect(beside.gap).toBeGreaterThanOrEqual(4);
      expect(beside.gap).toBeLessThan(12);
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({
        path: path.join(SCREENSHOTS, `inventory-security-card-${slug}.png`),
        animations: "disabled",
      });
    });
  }
});

test.describe("at a phone's width, in the dark and in other languages", () => {
  test("every line wraps inside the card, and nothing scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    for (const scenario of ["pinged", "disagree", "other", "dns"]) {
      const card: Locator = await openItem(page, `?scenario=${scenario}`);
      await expect(value(page, "hostname")).toBeVisible();

      expect({ scenario, overflow: await overflow(page) }).toEqual({
        scenario,
        overflow: 0,
      });
      expect(
        await staysInside(
          page.locator(
            "[data-testid$='-value-source'], [data-testid$='-value-different']",
          ),
          card,
        ),
      ).toBe(true);
      await shoot(page, `item-${scenario}-390-light`);
    }

    await open(page, "?page=device");
    await expect(page.getByTestId("device-inventory-source")).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, "device-pinged-390-light");
  });

  test("every surface is dark in the dark theme, and the lines stay readable", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openItem(page, "?scenario=disagree&theme=dark");
    await expect(different(page, "macAddress")).toBeVisible();

    const surface: Locator = card.locator(
      "xpath=ancestor::div[contains(@class,'rounded')][1]",
    );
    const background: number = await backgroundBrightness(surface);
    expect(background).toBeLessThan(3 * 128);
    // The quiet source line and the amber one both read against it.
    expect(await textBrightness(source(page, "macAddress"))).toBeGreaterThan(
      background + 150,
    );
    expect(await textBrightness(different(page, "macAddress"))).toBeGreaterThan(
      background + 150,
    );
    await shoot(page, "item-disagree-1280-dark");

    await openItem(page, "?scenario=pinged&theme=dark");
    await expect(saidOnce(page)).toBeVisible();
    expect(await textBrightness(saidOnce(page))).toBeGreaterThan(
      background + 150,
    );
    await shoot(page, "item-pinged-1280-dark");

    await page.setViewportSize({ width: 390, height: 844 });
    await openItem(page, "?scenario=other&theme=dark");
    await expect(
      page.getByTestId("inventory-asset-details-other-machine"),
    ).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, "item-other-machine-390-dark");

    await open(page, "?page=device&theme=dark");
    await expect(page.getByTestId("device-inventory-source")).toBeVisible();
    await shoot(page, "device-pinged-390-dark");
  });

  test("the card reads in Japanese and in German, names and all", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openItem(page, "?lang=ja");

    await expect(saidOnce(page)).toHaveText(
      "検出スキャン Store subnets が SNMP で読み取りました (2 時間前)。",
    );
    await expect(source(page, "macAddress")).toHaveText(
      "core-rtr-01 の ARP テーブル · 3 時間前",
    );
    await expect(source(page, "dnsName")).toHaveText(
      "検出スキャン Store subnets (逆引き DNS) · 2 時間前",
    );
    await shoot(page, "item-pinged-1280-ja");

    await page.setViewportSize({ width: 390, height: 844 });
    await openItem(page, "?lang=de&scenario=disagree");

    await expect(source(page, "macAddress")).toHaveText(
      "Auf diesem Gerät gespeichert",
    );
    await expect(different(page, "macAddress")).toHaveText(
      "ARP-Tabelle von core-rtr-01 meldet 00-1B-54-C2-7A-44 · vor 15 Minuten",
    );
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, "item-disagree-390-de");

    await open(page, "?page=device&lang=de");
    await expect(page.getByTestId("device-inventory-source")).toHaveText(
      "Von Erkennungsscan Store subnets über SNMP gelesen, vor 2 Stunden.",
    );
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, "device-pinged-390-de");
  });
});

/*
 * The Meraki dashboard as a source, and Refresh: a Meraki access point its
 * probe pings, which a Meraki connection describes. Its serial number, model
 * and firmware come from the dashboard, said once below the details; Refresh
 * asks its probe and the dashboard to read it again, the card says who does,
 * then that it was read again - or that the probe could not reach it.
 */
test.describe("the Meraki dashboard as a source, and Refresh", () => {
  const MERAKI_LINE: string =
    "Read from the Meraki dashboard (Acme Retail), 4 minutes ago.";
  const WAITING: string =
    "Its probe and the Meraki dashboard read it again within a minute.";

  interface FixtureRefreshState {
    refreshAsks: Array<{ path: string; at: string }>;
    itemReloads: number;
  }

  async function refreshState(page: Page): Promise<FixtureRefreshState> {
    return await page.evaluate(() => {
      const state: {
        refreshAsks: Array<{ path: string; at: string }>;
        itemReloads: number;
      } = (
        window as unknown as {
          __assetDetailsFixture: {
            state: {
              refreshAsks: Array<{ path: string; at: string }>;
              itemReloads: number;
            };
          };
        }
      ).__assetDetailsFixture.state;

      return {
        refreshAsks: JSON.parse(JSON.stringify(state.refreshAsks)),
        itemReloads: state.itemReloads,
      };
    });
  }

  test("a Meraki access point: what the dashboard read, said once below the details, and Refresh offered", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openItem(page, "?scenario=meraki");

    await expect(value(page, "hostname")).toContainText("Lobby AP");
    await expect(value(page, "serialNumber")).toContainText("Q2KD-ABCD-1234");
    await expect(value(page, "model")).toContainText("MR46");
    await expect(value(page, "firmwareVersion")).toContainText("wireless-29-7");
    await expect(value(page, "manufacturer")).toContainText("Cisco Meraki");
    await expect(value(page, "macAddress")).toContainText("E0-55-3D-12-34-56");
    await expect(value(page, "location")).toContainText(
      "1600 Amphitheatre Pkwy, Mountain View",
    );

    // The dashboard, said once - not under each of its details.
    await expect(saidOnce(page)).toHaveText(MERAKI_LINE);
    await expect(saidOnce(page)).toHaveAttribute("title", /\d/);
    for (const field of [
      "hostname",
      "serialNumber",
      "model",
      "firmwareVersion",
      "manufacturer",
      "macAddress",
      "location",
    ]) {
      await expect(source(page, field)).toHaveCount(0);
    }
    // Its address is still the one its probe polls.
    await expect(value(page, "ipAddress")).toContainText("10.20.30.41");
    await expect(source(page, "ipAddress")).toHaveText(
      "The address its probe polls",
    );

    // Refresh is offered; nothing is said until someone presses it.
    const button: Locator = page.getByTestId("inventory-asset-details-refresh");
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
    await expect(button).toContainText("Refresh");
    await expect(
      page.getByTestId("inventory-asset-details-refresh-status"),
    ).toHaveCount(0);

    // The card read every column Refresh is decided and followed by.
    const deviceRead: FixtureRead | undefined = (await reads(page)).find(
      (read: FixtureRead) => {
        return read.model === "NetworkDevice";
      },
    );
    expect(deviceRead?.select).toEqual(
      expect.arrayContaining([
        "probeId",
        "isPollingEnabled",
        "monitoringMethod",
        "hostname",
        "discoveredDetails",
        "refreshRequestedAt",
        "lastPolledAt",
        "isReachable",
      ]),
    );

    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, "item-meraki-1280-light");
  });

  test("Refresh on the Asset Details card: who reads it again, then read again just now, and the item read again once", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openItem(page, "?scenario=meraki");

    const button: Locator = page.getByTestId("inventory-asset-details-refresh");
    const status: Locator = page.getByTestId(
      "inventory-asset-details-refresh-status",
    );

    await button.click();

    // Asked: who reads it again, while the button waits.
    await expect(status).toHaveText(WAITING);
    await expect(status).toHaveAttribute("data-tone", "progress");
    await expect(status).toHaveAttribute("role", "status");
    await expect(button).toBeDisabled();
    // The same word, greyed and turning: no wider label to jump the header.
    await expect(button).toHaveText("Refresh");
    await shoot(page, "item-meraki-refreshing-1280-light");

    // Its probe and the dashboard have read it again.
    await expect(status).toHaveText("Read again just now.");
    await expect(status).toHaveAttribute("data-tone", "done");
    await expect(button).toBeEnabled();
    await expect(button).toContainText("Refresh");
    // The details say the new reading, not the one from four minutes ago.
    await expect(saidOnce(page)).toHaveText(
      "Read from the Meraki dashboard (Acme Retail), just now.",
    );

    const after: FixtureRefreshState = await refreshState(page);
    expect(
      after.refreshAsks.map((ask: { path: string }) => {
        return ask.path;
      }),
    ).toEqual([`/api/network-device/${DEVICE_ID}/refresh`]);
    // The page read its item again once, when the reading landed.
    expect(after.itemReloads).toBe(1);

    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, "item-meraki-refreshed-1280-light");
  });

  test("Refresh on the device's Inventory card: the Meraki row, and a probe that could not reach the device", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?page=device&scenario=meraki&refresh=unreachable");

    // What Meraki says, and who read it when, in a row of its own.
    await expect(page.getByTestId("device-inventory-model")).toContainText(
      "MR46",
    );
    await expect(page.getByTestId("device-inventory-serial")).toContainText(
      "Q2KD-ABCD-1234",
    );
    await expect(
      page.getByTestId("device-inventory-controller-source"),
    ).toHaveText(MERAKI_LINE);
    await expect(
      page.getByTestId("device-inventory-controller-network"),
    ).toHaveText("In the Branch 12 network.");
    await shoot(page, "device-meraki-1280-light");

    const button: Locator = page.getByTestId("device-inventory-refresh");
    const status: Locator = page.getByTestId("device-inventory-refresh-status");

    await expect(status).toHaveCount(0);
    await button.click();
    await expect(status).toHaveText(WAITING);

    // Its probe polled it, and could not reach it.
    await expect(status).toHaveText(
      "Its probe could not reach it just now. Its details are as it last read them.",
    );
    await expect(status).toHaveAttribute("data-tone", "warning");
    await expect(button).toBeEnabled();
    // The Meraki dashboard was read again all the same.
    await expect(
      page.getByTestId("device-inventory-controller-source"),
    ).toHaveText("Read from the Meraki dashboard (Acme Retail), just now.");

    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, "device-meraki-unreachable-1280-light");
  });

  test("no Refresh for a device nothing reads on its own, or for someone who may not edit network devices", async ({
    page,
  }: {
    page: Page;
  }) => {
    // Typed by hand, no probe, no Meraki connection: nothing to ask.
    await openItem(page, "?scenario=typed");
    await expect(value(page, "hostname")).toBeVisible();
    await expect(
      page.getByTestId("inventory-asset-details-refresh"),
    ).toHaveCount(0);

    // May read network devices, not edit them.
    await openItem(page, "?scenario=meraki&role=reader");
    await expect(saidOnce(page)).toHaveText(MERAKI_LINE);
    await expect(
      page.getByTestId("inventory-asset-details-refresh"),
    ).toHaveCount(0);

    await open(page, "?page=device&scenario=meraki&role=reader");
    await expect(
      page.getByTestId("device-inventory-controller-source"),
    ).toHaveText(MERAKI_LINE);
    await expect(page.getByTestId("device-inventory-refresh")).toHaveCount(0);

    expect((await refreshState(page)).refreshAsks).toEqual([]);
  });

  test("at a phone's width, in the dark and in German: the status wraps inside the card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    const card: Locator = await openItem(
      page,
      "?scenario=meraki&theme=dark&lang=de",
    );
    await expect(saidOnce(page)).toHaveText(
      "Aus dem Meraki-Dashboard (Acme Retail) gelesen, vor 4 Minuten.",
    );

    const button: Locator = page.getByTestId("inventory-asset-details-refresh");
    const status: Locator = page.getByTestId(
      "inventory-asset-details-refresh-status",
    );

    await expect(button).toContainText("Aktualisieren");
    await button.click();
    await expect(status).toHaveText(
      "Seine Sonde und das Meraki-Dashboard lesen es innerhalb einer Minute erneut.",
    );
    expect(await staysInside(status, card)).toBe(true);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, "item-meraki-refreshing-390-dark-de");

    await expect(status).toHaveText("Gerade eben erneut gelesen.");
    // Readable against the dark card.
    const surface: Locator = card.locator(
      "xpath=ancestor::div[contains(@class,'rounded')][1]",
    );
    expect(await textBrightness(status)).toBeGreaterThan(
      (await backgroundBrightness(surface)) + 150,
    );
    expect(await staysInside(status, card)).toBe(true);
    await shoot(page, "item-meraki-refreshed-390-dark-de");

    await open(page, "?page=device&scenario=meraki&theme=dark");
    await expect(
      page.getByTestId("device-inventory-controller-source"),
    ).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, "device-meraki-390-dark");
  });
});

/*
 * Refresh, every way it can go (the UI review): who reads a device again -
 * its probe alone, the Meraki dashboard alone - a refresh nobody answers in
 * three minutes, one the server refuses, and the card in Persian, read
 * right to left. While the readers work, the button is the one thing that
 * turns: the line under it waits with a still clock.
 */
test.describe("Refresh, every way it can go", () => {
  const ITEM_STATUS: string = "inventory-asset-details-refresh-status";
  const ITEM_BUTTON: string = "inventory-asset-details-refresh";

  // Whether anything in the element is animated (a spinner turning).
  async function isTurning(locator: Locator): Promise<boolean> {
    return await locator.evaluate((element: Element) => {
      return Array.from(element.querySelectorAll("*")).some(
        (inner: Element) => {
          return getComputedStyle(inner).animationName !== "none";
        },
      );
    });
  }

  test("a switch only its probe polls: its probe reads it again, then it was read again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openItem(page, "?scenario=walked");

    const button: Locator = page.getByTestId(ITEM_BUTTON);
    const status: Locator = page.getByTestId(ITEM_STATUS);

    await button.click();
    await expect(status).toHaveText(
      "Its probe reads it again within a minute.",
    );
    await expect(status).toHaveAttribute("data-tone", "progress");
    // One spinner, the button's: the line waits with a still clock.
    expect(await isTurning(button)).toBe(true);
    expect(await isTurning(status)).toBe(false);

    await expect(status).toHaveText("Read again just now.");
    await expect(button).toBeEnabled();
    // Its walk, said once below the details, is the one that just landed.
    await expect(saidOnce(page)).toHaveText(
      "Read over SNMP by its probe, just now.",
    );
  });

  test("a Meraki access point no probe polls: the Meraki dashboard is read again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openItem(page, "?scenario=meraki&probe=none");

    const status: Locator = page.getByTestId(ITEM_STATUS);

    await page.getByTestId(ITEM_BUTTON).click();
    await expect(status).toHaveText(
      "The Meraki dashboard is read again within a minute.",
    );
    await expect(status).toHaveText("Read again just now.");
    await expect(saidOnce(page)).toHaveText(
      "Read from the Meraki dashboard (Acme Retail), just now.",
    );
  });

  test("nobody reads it in three minutes: the card names the probe to check, and Refresh is ready again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.clock.install();
    await openItem(page, "?scenario=meraki&refresh=late");

    const button: Locator = page.getByTestId(ITEM_BUTTON);
    const status: Locator = page.getByTestId(ITEM_STATUS);

    await button.click();
    await expect(status).toHaveAttribute("data-tone", "progress");
    await expect(button).toBeDisabled();

    await page.clock.fastForward("03:10");

    await expect(status).toHaveText(
      "Its probe (Branch 12 probe) has not read it yet. Check that the probe is online.",
    );
    await expect(status).toHaveAttribute("data-tone", "warning");
    await expect(button).toBeEnabled();
    await expect(button).toContainText("Refresh");
    await shoot(page, "item-meraki-late-1280-light");
  });

  test("refused: the server's reason, in red, and Refresh ready again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openItem(page, "?scenario=meraki&probe=none&refresh=refused");

    const button: Locator = page.getByTestId(ITEM_BUTTON);
    const status: Locator = page.getByTestId(ITEM_STATUS);

    await button.click();
    await expect(status).toHaveText(
      "The Meraki connection that reads this device is turned off. Turn it on at the foot of the network's Traffic page, then refresh the device.",
    );
    await expect(status).toHaveAttribute("role", "alert");
    await expect(status).toHaveAttribute("data-tone", "error");
    await expect(button).toBeEnabled();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, "item-meraki-refused-1280-light");
  });

  test("a Meraki device: its unknown details name the dashboard, and its Inventory card says the dashboard is a source", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openItem(page, "?scenario=meraki&firmware=none");
    await expect(
      page.getByTestId("inventory-asset-details-unknown"),
    ).toContainText(
      "2 details are unknown: neither this device's SNMP poll, the Meraki dashboard nor a discovery scan has found them.",
    );

    // A switch Meraki does not describe: the poll and the scans only.
    await openItem(page, "?scenario=pinged");
    await expect(
      page.getByTestId("inventory-asset-details-unknown"),
    ).toContainText(
      "neither this device's SNMP poll nor a discovery scan has found them.",
    );
    await expect(
      page.getByTestId("inventory-asset-details-unknown"),
    ).not.toContainText("Meraki");

    await open(page, "?page=device&scenario=meraki");
    await expect(
      page.getByText(
        "Hardware, software and location details from this device's SNMP poll, from discovery and from the Meraki dashboard.",
      ),
    ).toBeVisible();
  });

  test("in Persian, right to left: the line's icon at its start on the right, and the time where the sentence puts it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openItem(page, "?scenario=meraki&lang=fa");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    // The time is set apart, so its digit stays with its words.
    const line: string = (await saidOnce(page).textContent()) || "";
    const isolateStart: number = line.indexOf("\u{2068}");
    expect(isolateStart).toBeGreaterThan(line.indexOf("Acme Retail"));
    expect(line.indexOf("\u{2069}")).toBeGreaterThan(isolateStart);

    await page.getByTestId(ITEM_BUTTON).click();
    const status: Locator = page.getByTestId(ITEM_STATUS);
    await expect(status).toHaveText(
      "پراب آن و داشبورد Meraki ظرف یک دقیقه دوباره آن را می‌خوانند.",
    );

    // Read right to left: the icon opens the line, at its right.
    const boxes: { icon: number; text: number } = await status.evaluate(
      (element: Element) => {
        const icon: DOMRect = element
          .querySelector("svg")!
          .getBoundingClientRect();
        const text: DOMRect = element
          .querySelector("span")!
          .getBoundingClientRect();
        return { icon: icon.left, text: text.right };
      },
    );
    expect(boxes.icon).toBeGreaterThanOrEqual(boxes.text);
    expect(await staysInside(status, card)).toBe(true);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, "item-meraki-refreshing-1280-fa");
  });
});

test.describe("why a detail is unknown (issue #5384)", () => {
  test("the Meraki MX of issue #5384: what its poll can read, and why the rest is unknown", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openItem(page, "?scenario=mx");

    await expect(value(page, "hostname")).toContainText("UN0362WANRTR01");
    await expect(value(page, "manufacturer")).toContainText("Cisco Meraki");
    await expect(value(page, "model")).toContainText("MX85");
    await expect(value(page, "macAddress")).toContainText("AA-BB-CC-06-25-ED");
    await expect(value(page, "operatingSystem")).toContainText(
      "Meraki MX firmware",
    );

    // Its own poll, said once: not under its MAC or its operating system.
    await expect(saidOnce(page)).toContainText("Read over SNMP by its probe");
    await expect(source(page, "macAddress")).toHaveCount(0);
    await expect(source(page, "operatingSystem")).toHaveCount(0);

    // What only its dashboard has is unknown, and the card says so.
    const unknown: Locator = page.getByTestId(
      "inventory-asset-details-unknown",
    );
    await expect(unknown).toContainText(
      "3 details are unknown: a Cisco Meraki device reports them only to the Meraki dashboard, not over SNMP.",
    );

    const connect: Locator = unknown.getByRole("link", {
      name: "Connect the Meraki dashboard",
    });
    await expect(connect).toHaveAttribute(
      "href",
      "/docs/monitor/network-traffic#cisco-meraki-without-netflow",
    );

    expect(await overflow(page)).toBe(0);
  });

  test("a device that answered its poll says it reports no more, in the reader's language", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openItem(page, "?scenario=quiet");
    await expect(
      page.getByTestId("inventory-asset-details-unknown"),
    ).toContainText(
      "this device does not report them over SNMP, and no discovery scan has found them.",
    );

    await openItem(page, "?scenario=quiet&lang=de");
    await expect(
      page.getByTestId("inventory-asset-details-unknown"),
    ).toContainText("Dieses Gerät meldet sie nicht über SNMP");
  });
});
