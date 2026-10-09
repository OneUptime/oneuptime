import { expect, Locator, Page, test } from "@playwright/test";
import path from "path";

/*
 * OneUptime issue #4518: discovered devices are named by their own hostname,
 * not by their IP or DNS name.
 *
 * The reporter's scan of Windows kitchen displays, on the real Discovery page
 * against the offline fixture. WB0024KDS03 answers SNMP; WB0024KDS04 and
 * WB0024KDS05 only answer NetBIOS, and their reverse zone spells them
 * wb-0024-kds04.wbhq.com and wb-0024-kds05.wbhq.com; 10.16.42.52 answers
 * nothing. Review Results names each display by its own hostname with the
 * DNS name beside the address, and Import Selected creates exactly those
 * names, recording where each came from.
 */

interface CreatedDevice {
  hostname: string;
  name: string;
  dnsName: string | null;
  discoveredName: string | null;
  discoveredNameSource: string | null;
}

const route: string =
  "/dashboard/10000000-0000-4000-8000-000000000001/network-devices/discovery";
const screenshots: string = path.resolve(
  __dirname,
  "../../../output/playwright/discovery",
);
const SCAN_NAME: string = "Kitchen displays — Store 24";

async function created(page: Page): Promise<Array<CreatedDevice>> {
  return page.evaluate((): Array<CreatedDevice> => {
    return (
      window as unknown as {
        __discoveryFixture: { creates: Array<CreatedDevice> };
      }
    ).__discoveryFixture.creates;
  });
}

async function openReview(page: Page): Promise<void> {
  await page.goto(route);
  /*
   * The scan's own container, whichever way the table draws it: a row on a
   * wide screen, a card on a phone. The innermost element holding both the
   * scan's name and a Review Results button is that row or card.
   */
  await page
    .locator("tr, div")
    .filter({ has: page.getByText(SCAN_NAME, { exact: true }) })
    .filter({ has: page.getByRole("button", { name: "Review Results" }) })
    .last()
    .getByRole("button", { name: "Review Results" })
    .click();
  await expect(page.getByText("WB0024KDS04", { exact: true })).toBeVisible();
}

// The line under a row's name: the address, then what else names it.
function addressLine(page: Page, address: string): Locator {
  return page
    .locator("div.truncate")
    .filter({ hasText: new RegExp(`^${address.replace(/\./g, "\\.")}`) })
    .first();
}

test("Review Results names each display by its hostname, with the DNS name beside the address", async ({
  page,
}: {
  page: Page;
}) => {
  const errors: Array<string> = [];
  page.on("pageerror", (error: Error): void => {
    errors.push(error.message);
  });

  await openReview(page);

  for (const [address, name] of [
    ["10.16.42.53", "WB0024KDS03"],
    ["10.16.42.54", "WB0024KDS04"],
    ["10.16.42.55", "WB0024KDS05"],
  ] as Array<[string, string]>) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(
      page.getByTestId(`discovered-device-checkbox-${address}`),
    ).toHaveAttribute("aria-label", `Import ${name} (${address})`);
  }

  await expect(addressLine(page, "10.16.42.53")).toHaveText(
    "10.16.42.53 · wb-0024-kds03.wbhq.com",
  );
  await expect(addressLine(page, "10.16.42.54")).toHaveText(
    "10.16.42.54 · NetBIOS name · wb-0024-kds04.wbhq.com",
  );
  await expect(addressLine(page, "10.16.42.55")).toHaveText(
    "10.16.42.55 · NetBIOS name · wb-0024-kds05.wbhq.com",
  );

  // The DNS name never stands in for the hostname on the name line.
  await expect(
    page.getByText("wb-0024-kds04", { exact: true }),
  ).toHaveCount(0);

  // The display nothing named still says so.
  await expect(
    page.getByTestId("discovered-device-checkbox-10.16.42.52"),
  ).toHaveAttribute("aria-label", "Import 10.16.42.52 (10.16.42.52)");
  await expect(page.getByText("No name found")).toBeVisible();

  // The NetBIOS hint says what the name is.
  const hints: Locator = page.locator("span[title]").filter({
    hasText: "NetBIOS name",
  });
  await expect(hints).toHaveCount(2);
  await expect(hints.first()).toHaveAttribute(
    "title",
    /Windows computer name this host reported/,
  );

  await page.screenshot({
    path: path.join(screenshots, "discovery-review-hostnames.png"),
  });
  expect(errors).toEqual([]);
});

test("Import Selected creates the hostnames the rows show, keeps the DNS names, and records where each name came from", async ({
  page,
}: {
  page: Page;
}) => {
  await openReview(page);
  await page.getByRole("button", { name: /Import Selected/ }).click();

  await expect
    .poll(async () => {
      return (await created(page)).length;
    })
    .toBe(4);

  const byAddress: Map<string, CreatedDevice> = new Map(
    (await created(page)).map((device: CreatedDevice) => {
      return [device.hostname, device];
    }),
  );

  expect(byAddress.get("10.16.42.52")).toMatchObject({
    hostname: "10.16.42.52",
    name: "10.16.42.52",
    dnsName: null,
    discoveredName: "10.16.42.52",
    discoveredNameSource: "address",
  });
  expect(byAddress.get("10.16.42.53")).toMatchObject({
    name: "WB0024KDS03",
    dnsName: "wb-0024-kds03.wbhq.com",
    discoveredName: "WB0024KDS03",
    discoveredNameSource: "system-name",
  });
  expect(byAddress.get("10.16.42.54")).toMatchObject({
    name: "WB0024KDS04",
    dnsName: "wb-0024-kds04.wbhq.com",
    discoveredName: "WB0024KDS04",
    discoveredNameSource: "netbios-name",
  });
  expect(byAddress.get("10.16.42.55")).toMatchObject({
    name: "WB0024KDS05",
    dnsName: "wb-0024-kds05.wbhq.com",
    discoveredName: "WB0024KDS05",
    discoveredNameSource: "netbios-name",
  });
});

test("the Start New Scan form names the Windows-name lookup and the naming order", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto(route);
  await page.getByRole("button", { name: "Start Scan" }).first().click();

  const modal: Locator = page.getByTestId("modal");
  await modal.getByRole("button", { name: /More fields/ }).click();

  const lookup: Locator = modal.getByRole("switch", {
    name: "Look up Windows names (NetBIOS)",
  });
  await expect(lookup).toBeVisible();
  await expect(lookup).toHaveAttribute("aria-checked", "true");
  await expect(
    modal.getByText(/A host is named by its own name first/),
  ).toBeVisible();

  await lookup.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(screenshots, "discovery-start-scan-device-names.png"),
  });
});

test("the reviewed hostnames fit a narrow screen", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openReview(page);

  const scrollWidth: number = await page.evaluate((): number => {
    return document.documentElement.scrollWidth;
  });
  expect(scrollWidth).toBeLessThanOrEqual(390);

  await page.screenshot({
    path: path.join(screenshots, "discovery-review-hostnames-mobile.png"),
  });
});
