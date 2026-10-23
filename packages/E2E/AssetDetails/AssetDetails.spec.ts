import { expect, Locator, Page, test } from "@playwright/test";
import path from "path";

/*
 * Where each asset detail came from, and when (OneUptime issue #5185), end
 * to end in a browser, against the fixture's in-page API
 * (AssetDetails/Fixture.js): Inventory's Asset Details card, a network
 * device's own Inventory card and its Overview, for a switch OneUptime only
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
