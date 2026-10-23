import { expect, Locator, Page, test } from "@playwright/test";
import path from "path";

/*
 * Where each asset detail came from, and when (OneUptime issue #5185), end
 * to end in a browser, against the fixture's in-page API
 * (AssetDetails/Fixture.js): Inventory's Asset Details card and a network
 * device's own Inventory card, for a switch OneUptime only pings (its details
 * from a discovery scan, its MAC from a router's ARP table), a switch walked
 * over SNMP, values someone saved that discovery reads differently, another
 * machine at a device's address, a firewall polled at a DNS name, a host, and
 * a device the reader cannot read - at a laptop's and a phone's width, in the
 * dark theme, in Japanese and in German. Screenshots in
 * output/playwright/asset-details-ui are for the people who review the page.
 */

const DEVICE_ID: string = "40000000-0000-4000-8000-000000000001";

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
  test("a switch OneUptime only pings: each detail says which scan or router read it, and when", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openItem(page);

    await expect(value(page, "hostname")).toContainText("edge-sw-07");
    await expect(source(page, "hostname")).toHaveText(
      "Discovery scan Store subnets (SNMP) · 2 hours ago",
    );
    await expect(value(page, "manufacturer")).toContainText("Cisco");
    await expect(source(page, "manufacturer")).toHaveText(
      "Discovery scan Store subnets (SNMP) · 2 hours ago",
    );
    await expect(value(page, "operatingSystem")).toContainText("Cisco IOS");
    await expect(value(page, "osVersion")).toContainText("15.2(7)E8");
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
    await expect(value(page, "location")).toContainText(
      "Store 12 · Store 12, back office rack",
    );
    await expect(source(page, "ipAddress")).toHaveText(
      "The address its probe polls",
    );

    // The exact time is on hover.
    await expect(source(page, "hostname")).toHaveAttribute("title", /\d/);

    // The scan that found it, said once; what nothing found, still Unknown.
    await expect(
      page.getByTestId("inventory-asset-details-found-by"),
    ).toHaveText(
      "Last found at its address by discovery scan Store subnets, 2 hours ago.",
    );
    await expect(
      page.getByTestId("inventory-asset-details-unknown"),
    ).toContainText(
      "neither this device's SNMP poll nor a discovery scan has found",
    );
    await expect(
      page.getByTestId("inventory-asset-details-native-source"),
    ).toHaveCount(0);

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

    await expect(
      page.getByTestId("inventory-asset-details-native-source"),
    ).toHaveText("Read over SNMP by its probe, 3 minutes ago.");
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
    await expect(source(page, "hostname")).toHaveText(
      "Discovery scan Store subnets (SNMP) · 4 days ago",
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

    await expect(
      page.getByTestId("inventory-asset-details-native-source"),
    ).toHaveText("Reported by its collector, 2 minutes ago.");
    await expect(source(page, "hostname")).toHaveCount(0);
    await expect(value(page, "location")).toContainText("westeurope");
    await expect(source(page, "location")).toHaveText("Its cloud zone");
    await expect(source(page, "deviceType")).toHaveText(
      "Worked out from what it reports",
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
  test("a switch OneUptime only pings: what the scan read, said as the scan's, and the Discovery row", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?page=device");

    await expect(page.getByTestId("device-inventory-vendor")).toContainText(
      "Cisco",
    );
    await expect(page.getByTestId("device-inventory-vendor-source")).toHaveText(
      "Discovery scan Store subnets (SNMP) · 2 hours ago",
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
    await expect(page.getByTestId("device-inventory-found-by")).toHaveText(
      "Last found at its address by discovery scan Store subnets, 2 hours ago.",
    );

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
    await expect(page.getByTestId("device-inventory-found-by")).toBeVisible();
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
    await expect(source(page, "hostname")).toBeVisible();
    await shoot(page, "item-pinged-1280-dark");

    await page.setViewportSize({ width: 390, height: 844 });
    await openItem(page, "?scenario=other&theme=dark");
    await expect(
      page.getByTestId("inventory-asset-details-other-machine"),
    ).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, "item-other-machine-390-dark");

    await open(page, "?page=device&theme=dark");
    await expect(page.getByTestId("device-inventory-found-by")).toBeVisible();
    await shoot(page, "device-pinged-390-dark");
  });

  test("the card reads in Japanese and in German, names and all", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openItem(page, "?lang=ja");

    await expect(source(page, "hostname")).toHaveText(
      "検出スキャン Store subnets (SNMP) · 2 時間前",
    );
    await expect(source(page, "macAddress")).toHaveText(
      "core-rtr-01 の ARP テーブル · 3 時間前",
    );
    await expect(
      page.getByTestId("inventory-asset-details-found-by"),
    ).toHaveText(
      "検出スキャン Store subnets がこのアドレスで最後に見つけました (2 時間前)。",
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
    await expect(page.getByTestId("device-inventory-vendor-source")).toHaveText(
      "Erkennungsscan Store subnets (SNMP) · vor 2 Stunden",
    );
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, "device-pinged-390-de");
  });
});
