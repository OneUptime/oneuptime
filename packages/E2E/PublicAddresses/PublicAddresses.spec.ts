import {
  BrowserContext,
  expect,
  Locator,
  Page,
  Route,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Where visitors find a status page or a public dashboard, in real Chromium,
 * against the offline fixture (PublicAddresses/Fixture): a status page's
 * real Overview, whose Status Page Link card lists every address the page
 * answers at, and a dashboard's real Sharing page, which lists them under
 * its public choice.
 *
 * The maintainer's ask: "Please make the UI for this card a lot better. If
 * custom domains are attached to the status page show them here as well,
 * with preview link. Please make the UI easier to understand." The
 * screenshot: "Status Page Link", one underlined monospace address on
 * OneUptime's own domain and a small Copy link - nothing about custom
 * domains.
 *
 * jsdom draws nothing, so what only a browser can show is checked here: the
 * addresses in their order, each live one a link that opens in a new tab and
 * copies, each custom domain not live yet saying so and why, with DNS Setup
 * opening its dialog; a long address cut short inside its row with the whole
 * of it on hover; at a phone's width every row inside its card, the action
 * under the address and nothing scrolling sideways; and the words and the
 * frame legible in the dark theme. The rules behind each state are held by
 * the jsdom suites (Common/Tests/App/Dashboard/PublicAddresses.test.tsx and
 * App/Tests/Dashboard/PublicAddressRules.test.ts).
 */

const PROJECT: string = "10000000-0000-4000-8000-000000000001";
const STATUS_PAGE_ID: string = "30000000-0000-4000-8000-000000000001";
const DASHBOARD_ID: string = "40000000-0000-4000-8000-000000000001";
const FORM_ID: string = "50000000-0000-4000-8000-000000000001";
const FORM_SHARE_KEY: string = "0f8fad5b-d9cb-469f-a165-70867728950e";
const STATUS_PAGE: string = `/dashboard/${PROJECT}/status-pages/${STATUS_PAGE_ID}`;
const SHARING: string = `/dashboard/${PROJECT}/dashboards/${DASHBOARD_ID}/authentication-settings`;
const FORM_SHARE: string = `/dashboard/${PROJECT}/forms/${FORM_ID}/share`;

// The address the fixture's HOST gives the status page on OneUptime's domain.
const ONEUPTIME_ADDRESS: string = `oneuptime.acme-commerce.example/status-page/${STATUS_PAGE_ID}`;
const PUBLIC_LINK: string = `https://oneuptime.acme-commerce.example/public-dashboard/${DASHBOARD_ID}`;
// A form's link, as its Share Link card hands it out.
const FORM_LINK: string = `https://oneuptime.acme-commerce.example/accounts/form/${FORM_SHARE_KEY}`;

const SEVERAL: string =
  "domains=live:status.acme.com;dns:status-eu.acme.com;issuing:status-apac.acme.com;expired:status-legacy.acme.com";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/public-addresses-ui",
);

interface FixtureRecord {
  listRequests: Array<{ tableName: string; query: Array<string> }>;
  apiGets: Array<string>;
  unmodelled: Array<string>;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
  page.on("console", (message: { type: () => string; text: () => string }) => {
    // React's own warnings (invalid nesting, keys, refs) are errors here.
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  // Nothing may leave the fixture server.
  await page.route("**/*", async (route: Route) => {
    const url: URL = new URL(route.request().url());

    if (url.hostname !== "127.0.0.1") {
      await route.abort();
      return;
    }

    await route.continue();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
  // Every read the cards made is one the fixture answers as the API does.
  expect((await fixture(page)).unmodelled).toEqual([]);
});

async function fixture(page: Page): Promise<FixtureRecord> {
  return await page.evaluate((): FixtureRecord => {
    return (window as unknown as { __fixture: FixtureRecord }).__fixture;
  });
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function open(
  page: Page,
  address: string,
  width: number = 1280,
): Promise<void> {
  await page.setViewportSize({ width: width, height: 900 });
  await page.goto(address);
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  await expect(page.getByTestId("public-addresses")).toBeVisible();
  await expect(page.getByTestId("public-addresses-loading")).toHaveCount(0);
}

function rows(page: Page): Locator {
  return page.getByTestId("public-address");
}

function row(page: Page, address: string): Locator {
  return page.locator(
    `[data-testid="public-address"][data-address="${address}"]`,
  );
}

async function listed(page: Page): Promise<Array<string>> {
  return await rows(page).evaluateAll(
    (elements: Array<Element>): Array<string> => {
      return elements.map((element: Element): string => {
        return `${element.getAttribute("data-live") === "true" ? "live" : "not live"} ${element.getAttribute("data-address")}`;
      });
    },
  );
}

async function box(locator: Locator): Promise<Box> {
  const measured: Box | null = await locator.boundingBox();
  expect(measured).not.toBeNull();
  return measured as Box;
}

async function expectNothingRunsOff(page: Page, where: string): Promise<void> {
  expect(
    await page.evaluate((): boolean => {
      return document.documentElement.scrollWidth <= window.innerWidth;
    }),
    `${where}: the page does not scroll sideways`,
  ).toBe(true);
}

// Every row inside the list's frame, and the list inside its card.
async function expectRowsInside(
  page: Page,
  where: string,
  cardLocator?: Locator | undefined,
): Promise<void> {
  const list: Box = await box(page.getByTestId("public-addresses"));
  const card: Box = await box(cardLocator || page.getByTestId("card").first());

  expect(list.x, where).toBeGreaterThanOrEqual(card.x);
  expect(list.x + list.width, where).toBeLessThanOrEqual(
    card.x + card.width + 0.5,
  );

  for (const element of await rows(page).all()) {
    const measured: Box = await box(element);

    expect(measured.x + measured.width, where).toBeLessThanOrEqual(
      list.x + list.width + 0.5,
    );

    /*
     * Everything drawn in the row, its action included, stays inside it.
     * What a cut-short address hides past its end is clipped by it, and the
     * screen readers' words are not drawn: neither is held to the row.
     */
    const outside: Array<string> = await element.evaluate(
      (rowElement: Element): Array<string> => {
        const frame: DOMRect = rowElement.getBoundingClientRect();

        const isClipped: (child: Element) => boolean = (
          child: Element,
        ): boolean => {
          let current: Element | null = child.parentElement;
          while (current && current !== rowElement) {
            if (getComputedStyle(current).overflowX === "hidden") {
              return true;
            }
            current = current.parentElement;
          }
          return false;
        };

        return Array.from(rowElement.querySelectorAll("*"))
          .filter((child: Element): boolean => {
            const rect: DOMRect = child.getBoundingClientRect();
            return (
              rect.width > 0 &&
              !child.classList.contains("sr-only") &&
              !isClipped(child) &&
              (rect.left < frame.left - 0.5 || rect.right > frame.right + 0.5)
            );
          })
          .map((child: Element): string => {
            return `${child.tagName.toLowerCase()}.${String(child.className).slice(0, 60)}`;
          });
      },
    );

    expect(outside, `${where}: a row's content stays in the row`).toEqual([]);
  }
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseRgb(color: string): Rgb {
  const parts: Array<number> = (color.match(/[\d.]+/g) || []).map(Number);
  return { r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0 };
}

function luminance(color: Rgb): number {
  const channel: (value: number) => number = (value: number): number => {
    const scaled: number = value / 255;
    return scaled <= 0.03928
      ? scaled / 12.92
      : Math.pow((scaled + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel(color.r) +
    0.7152 * channel(color.g) +
    0.0722 * channel(color.b)
  );
}

function contrast(first: string, second: string): number {
  const a: number = luminance(parseRgb(first));
  const b: number = luminance(parseRgb(second));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// The colour an element is painted on: the first non-transparent background up.
async function backgroundOf(locator: Locator): Promise<string> {
  return await locator.evaluate((element: Element): string => {
    let current: Element | null = element;
    while (current) {
      const background: string = getComputedStyle(current).backgroundColor;
      if (background && background !== "rgba(0, 0, 0, 0)") {
        return background;
      }
      current = current.parentElement;
    }
    return "rgb(255, 255, 255)";
  });
}

async function colorOf(locator: Locator): Promise<string> {
  return await locator.evaluate((element: Element): string => {
    return getComputedStyle(element).color;
  });
}

async function grantClipboard(context: BrowserContext): Promise<void> {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
}

async function clipboardText(page: Page): Promise<string> {
  return await page.evaluate(async (): Promise<string> => {
    return await navigator.clipboard.readText();
  });
}

test.describe("a status page's Overview: the Status Page Link card", () => {
  test("with no custom domain: its OneUptime address, to open and copy, and one quiet line to add a domain", async ({
    page,
    context,
  }: {
    page: Page;
    context: BrowserContext;
  }) => {
    await grantClipboard(context);
    await open(page, STATUS_PAGE, 1280);

    const card: Locator = page
      .getByTestId("card")
      .filter({ hasText: "Status Page Link" });

    await expect(card).toContainText("Where visitors find your status page.");
    expect(await listed(page)).toEqual([`live ${ONEUPTIME_ADDRESS}`]);

    const only: Locator = row(page, ONEUPTIME_ADDRESS);

    await expect(only).toContainText("OneUptime address");

    const link: Locator = only.getByRole("link");

    await expect(link).toHaveAttribute("href", `https://${ONEUPTIME_ADDRESS}`);
    await expect(link).toHaveAttribute("target", "_blank");

    const copy: Locator = only.getByRole("button", {
      name: `Copy link to ${ONEUPTIME_ADDRESS}`,
    });

    await expect(copy).toBeVisible();
    await copy.click();
    await expect(copy).toContainText("Copied!");
    expect(await clipboardText(page)).toBe(`https://${ONEUPTIME_ADDRESS}`);

    const add: Locator = page.getByTestId("public-addresses-add-custom-domain");

    await expect(add).toHaveText(
      "Use your own domain, such as status.example.com. Add a custom domain",
    );
    await expect(
      add.getByRole("link", { name: "Add a custom domain" }),
    ).toHaveAttribute("href", `${STATUS_PAGE}/domains`);

    // No monospace wall of text: the address is drawn in the page's font.
    const fontFamily: string = await link.evaluate((element: Element) => {
      return getComputedStyle(element.querySelector("[title]")!).fontFamily;
    });
    expect(fontFamily).toContain("Inter");

    // No custom domain, so no certificate is asked about.
    expect((await fixture(page)).apiGets).toEqual([]);

    await screenshot(page, "status-page-no-domain-1280");
  });

  test("custom domains first: the live one a link to its root, those not live yet saying so and why, then the OneUptime address", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${STATUS_PAGE}?${SEVERAL}`, 1280);

    expect(await listed(page)).toEqual([
      "live status.acme.com",
      "not live status-apac.acme.com",
      "not live status-eu.acme.com",
      "not live status-legacy.acme.com",
      `live ${ONEUPTIME_ADDRESS}`,
    ]);

    const live: Locator = row(page, "status.acme.com");

    await expect(live).toContainText("Custom domain");
    await expect(live.getByRole("link")).toHaveAttribute(
      "href",
      "https://status.acme.com",
    );
    await expect(live.getByRole("link")).toHaveAttribute("target", "_blank");

    const reasons: Record<string, string> = {
      "status-apac.acme.com":
        "Issuing a free certificate, usually within 15 minutes.",
      "status-eu.acme.com": "Waiting for DNS: add the CNAME record.",
      "status-legacy.acme.com":
        "Certificate expired. We keep trying to renew it.",
    };

    for (const [address, reason] of Object.entries(reasons)) {
      const pending: Locator = row(page, address);

      await expect(pending.getByRole("link")).toHaveCount(0);
      await expect(pending.getByTestId("public-address-not-live")).toHaveText(
        "Not live yet",
      );
      await expect(pending.getByTestId("public-address-reason")).toHaveText(
        reason,
      );
    }

    /*
     * DNS Setup where there is something to do - not while a certificate
     * is being issued, which only needs waiting for.
     */
    await expect(
      row(page, "status-eu.acme.com").getByTestId("public-address-dns-setup"),
    ).toBeVisible();
    await expect(
      row(page, "status-legacy.acme.com").getByTestId(
        "public-address-dns-setup",
      ),
    ).toBeVisible();
    await expect(
      row(page, "status-apac.acme.com").getByTestId("public-address-dns-setup"),
    ).toHaveCount(0);

    // The Copy link and DNS Setup buttons are one size, lined up.
    const copy: Box = await box(
      live.getByRole("button", { name: "Copy link to status.acme.com" }),
    );
    const dnsSetup: Box = await box(
      row(page, "status-eu.acme.com").getByTestId("public-address-dns-setup"),
    );
    expect(Math.abs(copy.height - dnsSetup.height)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(copy.x + copy.width - (dnsSetup.x + dnsSetup.width)),
    ).toBeLessThanOrEqual(1);

    // The certificates were asked for once, for all of the domains.
    expect(
      (await fixture(page)).apiGets.filter((url: string): boolean => {
        return url.includes("/certificates/");
      }),
    ).toHaveLength(1);

    await screenshot(page, "status-page-several-1280");
  });

  test("DNS Setup opens the Custom Domains page's own dialog, and Check now reads the list again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${STATUS_PAGE}?domains=dns:status-eu.acme.com`, 1280);

    const listReads: number = (await fixture(page)).listRequests.filter(
      (request: { tableName: string }): boolean => {
        return request.tableName === "StatusPageDomain";
      },
    ).length;

    await row(page, "status-eu.acme.com")
      .getByTestId("public-address-dns-setup")
      .click();

    const dialog: Locator = page.getByTestId("modal");

    await expect(dialog).toContainText("DNS Setup");
    await expect(dialog.getByTestId("dns-setup-record-name")).toHaveText(
      "status-eu.acme.com",
    );
    await expect(dialog.getByTestId("dns-setup-record-value")).toHaveText(
      "statuspage.oneuptime.com",
    );

    await screenshot(page, "status-page-dns-setup-1280");

    await dialog.getByRole("button", { name: "Check now" }).click();
    await expect(dialog.getByTestId("dns-setup-verified")).toBeVisible();

    await expect
      .poll(async (): Promise<number> => {
        return (await fixture(page)).listRequests.filter(
          (request: { tableName: string }): boolean => {
            return request.tableName === "StatusPageDomain";
          },
        ).length;
      })
      .toBe(listReads + 1);

    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("modal")).toHaveCount(0);
  });

  test("a long address is cut short inside its row, with the whole of it on hover", async ({
    page,
  }: {
    page: Page;
  }) => {
    const longDomain: string =
      "status-for-checkout-payments-and-the-partner-api-in-europe-west-one.acme-commerce.example";

    await open(page, `${STATUS_PAGE}?domains=live:${longDomain}`, 1280);

    // The address itself (Copy link carries a title too).
    const text: Locator = row(page, longDomain).locator("span[title]");

    await expect(text).toHaveAttribute("title", `https://${longDomain}`);

    for (const width of [1280, 768, 390]) {
      await page.setViewportSize({ width: width, height: 900 });

      // At a phone's and a narrow laptop's width it is cut short with "...".
      if (width < 1280) {
        expect(
          await text.evaluate((element: Element): boolean => {
            return element.scrollWidth > element.clientWidth;
          }),
          `the address is cut short at ${width}`,
        ).toBe(true);
        await expect(text).toHaveCSS("text-overflow", "ellipsis");
      }

      await expectRowsInside(page, `a long address at ${width}`);
      await expectNothingRunsOff(page, `a long address at ${width}`);
    }
  });

  test("at a phone's width every row fits its card, its action under the address", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${STATUS_PAGE}?${SEVERAL}`, 390);

    await expectRowsInside(page, "several domains at 390");
    await expectNothingRunsOff(page, "several domains at 390");

    // Copy link sits under the address, lined up with its text.
    const live: Locator = row(page, "status.acme.com");
    const address: Box = await box(live.locator("span[title]"));
    const copy: Box = await box(
      live.getByRole("button", { name: "Copy link to status.acme.com" }),
    );

    expect(copy.y).toBeGreaterThanOrEqual(address.y + address.height);
    expect(Math.abs(copy.x - address.x)).toBeLessThanOrEqual(1);

    /*
     * On a phone the tile gives its width to the address: the address
     * starts at the row's own padding, and so does each row's text.
     */
    const phoneRow: Box = await box(live);

    for (const tile of await page.getByTestId("public-address-tile").all()) {
      await expect(tile).toBeHidden();
    }
    expect(address.x - phoneRow.x).toBeLessThanOrEqual(17);

    // From sm up it is beside the address, at the row's right.
    await page.setViewportSize({ width: 1280, height: 900 });
    const wideAddress: Box = await box(live.getByRole("link"));
    const wideCopy: Box = await box(
      live.getByRole("button", { name: "Copy link to status.acme.com" }),
    );
    const wideRow: Box = await box(live);

    expect(wideCopy.x).toBeGreaterThan(wideAddress.x + wideAddress.width);
    expect(
      wideRow.x + wideRow.width - (wideCopy.x + wideCopy.width),
    ).toBeLessThanOrEqual(20);

    // ...with the tile beside each address saying what kind it is.
    await expect(live.getByTestId("public-address-tile")).toBeVisible();

    await page.setViewportSize({ width: 390, height: 900 });
    await screenshot(page, "status-page-several-390");
  });

  test("a live address is a link only as wide as its words: a click beside it opens nothing, and the keyboard's focus ring stays on its line", async ({
    page,
    context,
  }: {
    page: Page;
    context: BrowserContext;
  }) => {
    await open(page, `${STATUS_PAGE}?${SEVERAL}`, 1280);

    const live: Locator = row(page, "status.acme.com");
    const link: Locator = live.getByRole("link");
    const linkBox: Box = await box(link);
    const words: Box = await box(live.locator("span[title]"));
    const rowBox: Box = await box(live);

    // The link ends with its words and their icon, far from the row's end.
    expect(linkBox.width).toBeLessThan(words.width + 40);
    expect(linkBox.x + linkBox.width).toBeLessThan(rowBox.x + rowBox.width / 2);

    // The empty space beside it is not the link: a click there opens nothing.
    const beside: { x: number; y: number } = {
      x: linkBox.x + linkBox.width + 60,
      y: linkBox.y + linkBox.height / 2,
    };

    expect(
      await page.evaluate((point: { x: number; y: number }): boolean => {
        const hit: Element | null = document.elementFromPoint(point.x, point.y);
        return Boolean(hit && hit.closest("a"));
      }, beside),
    ).toBe(false);

    const tabs: number = context.pages().length;

    await page.mouse.click(beside.x, beside.y);
    await page.waitForTimeout(300);
    expect(context.pages()).toHaveLength(tabs);

    // Tab to it: the ring is drawn inside its line, over nothing under it.
    let focused: boolean = false;

    for (let i: number = 0; i < 60 && !focused; i++) {
      await page.keyboard.press("Tab");
      focused = await link.evaluate((element: Element): boolean => {
        return document.activeElement === element;
      });
    }

    expect(focused).toBe(true);

    const ring: string = await link.evaluate((element: Element): string => {
      return getComputedStyle(element).boxShadow;
    });

    expect(ring).toContain("inset");
    expect(ring).toContain("rgb(99, 102, 241)");

    const focusedBox: Box = await box(link);
    const whatItIs: Box = await box(live.getByText("Custom domain"));

    expect(focusedBox.y + focusedBox.height).toBeLessThanOrEqual(
      whatItIs.y + 0.5,
    );

    await screenshot(page, "status-page-link-focus-1280");
  });

  test("the sign-in and password lines, under the addresses and before the offer to add a domain", async ({
    page,
  }: {
    page: Page;
  }) => {
    const lines: Array<[string, string]> = [
      ["signin", "Visitors sign in to see this status page."],
      ["password", "Visitors enter the password to see this status page."],
    ];

    for (const [access, sentence] of lines) {
      await open(page, `${STATUS_PAGE}?access=${access}`, 1280);

      const line: Locator = page.getByTestId("status-page-link-access");

      await expect(line).toHaveText(`${sentence} Change access`);
      await expect(
        line.getByRole("link", { name: "Change access" }),
      ).toHaveAttribute("href", `${STATUS_PAGE}/authentication-settings`);

      const list: Box = await box(page.getByTestId("public-addresses"));
      const note: Box = await box(line);
      const add: Box = await box(
        page.getByTestId("public-addresses-add-custom-domain"),
      );

      expect(note.y).toBeGreaterThanOrEqual(list.y + list.height);
      expect(add.y).toBeGreaterThanOrEqual(note.y + note.height);
    }

    await screenshot(page, "status-page-password-1280");

    // A public page has no such line.
    await open(page, `${STATUS_PAGE}?access=public`, 1280);
    await expect(page.getByTestId("status-page-link-access")).toHaveCount(0);
  });

  test("someone who may not read the custom domains is not asked about them: the OneUptime address alone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${STATUS_PAGE}?role=noread&${SEVERAL}`, 1280);

    expect(await listed(page)).toEqual([`live ${ONEUPTIME_ADDRESS}`]);
    expect(
      (await fixture(page)).listRequests.filter(
        (request: { tableName: string }): boolean => {
          return request.tableName === "StatusPageDomain";
        },
      ),
    ).toEqual([]);
    await expect(
      page.getByTestId("public-addresses-add-custom-domain"),
    ).toHaveCount(0);
  });

  test("a read that fails keeps the OneUptime address, says so, and Try again reads the domains again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${STATUS_PAGE}?fail=domains&${SEVERAL}`, 1280);

    expect(await listed(page)).toEqual([`live ${ONEUPTIME_ADDRESS}`]);

    const error: Locator = page.getByTestId("public-addresses-error");

    await expect(error).toContainText(
      "The custom domains could not be loaded.",
    );

    const reads: number = (await fixture(page)).listRequests.length;

    await error.getByRole("button", { name: "Try again" }).click();

    await expect
      .poll(async (): Promise<number> => {
        return (await fixture(page)).listRequests.length;
      })
      .toBe(reads + 1);
  });

  test("while the domains are read, the list keeps the shape of a row", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${STATUS_PAGE}?delay=1500&${SEVERAL}`);

    const loading: Locator = page.getByTestId("public-addresses-loading");

    await expect(loading).toBeVisible();
    await expect(loading).toHaveAttribute("role", "status");

    const loadingBox: Box = await box(loading);
    await expect(loading).toHaveCount(0, { timeout: 10000 });
    const firstRow: Box = await box(rows(page).first());

    // The placeholder is about as tall as the row that replaces it.
    expect(Math.abs(loadingBox.height - firstRow.height)).toBeLessThanOrEqual(
      8,
    );
  });

  test("the dark theme: the addresses, their words and the frame as the theme draws them, every word at AA", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(
      page,
      `${STATUS_PAGE}?theme=dark&access=signin&${SEVERAL}`,
      1280,
    );

    const live: Locator = row(page, "status.acme.com");
    const background: string = await backgroundOf(live);

    // The card is a dark surface, not white.
    expect(luminance(parseRgb(background))).toBeLessThan(0.05);

    const words: Array<[string, Locator]> = [
      ["the address", live.getByRole("link")],
      ["what it is", live.getByText("Custom domain")],
      [
        "a domain not live yet",
        row(page, "status-eu.acme.com").locator("span[title]"),
      ],
      [
        "why",
        row(page, "status-eu.acme.com").getByTestId("public-address-reason"),
      ],
      [
        "Not live yet",
        row(page, "status-eu.acme.com").getByTestId("public-address-not-live"),
      ],
      ["the sign-in line", page.getByTestId("status-page-link-access")],
    ];

    for (const [name, locator] of words) {
      expect(
        contrast(await colorOf(locator), await backgroundOf(locator)),
        name,
      ).toBeGreaterThanOrEqual(4.5);
    }

    // The frame and the rules between rows are the theme's subtle border.
    const frame: Locator = page.getByTestId("public-addresses");
    const border: string = await frame.evaluate((element: Element): string => {
      return getComputedStyle(element).borderTopColor;
    });
    expect(luminance(parseRgb(border))).toBeLessThan(0.15);

    await screenshot(page, "status-page-several-dark-1280");
  });

  test("in German, the card's words are the Dashboard's German words, the addresses as they are", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${STATUS_PAGE}?lang=de&access=signin&${SEVERAL}`, 1280);

    const card: Locator = page
      .getByTestId("card")
      .filter({ hasText: "Link zur Statusseite" });

    await expect(card).toContainText("Wo Besucher Ihre Statusseite finden.");
    await expect(row(page, "status.acme.com")).toContainText(
      "Benutzerdefinierte Domain",
    );
    await expect(
      row(page, "status-eu.acme.com").getByTestId("public-address-not-live"),
    ).toHaveText("Noch nicht live");
    await expect(
      row(page, "status.acme.com").getByRole("button", {
        name: "Link zu status.acme.com kopieren",
      }),
    ).toContainText("Link kopieren");
    await expect(
      row(page, "status-eu.acme.com").getByRole("button", {
        name: "DNS-Einrichtung für status-eu.acme.com",
      }),
    ).toContainText("DNS-Einrichtung");
    await expect(page.getByTestId("status-page-link-access")).toContainText(
      "Zugriff ändern",
    );

    await screenshot(page, "status-page-several-de-1280");
  });
});

test.describe("a dashboard's Sharing page: under the public choice", () => {
  test("the dashboard's custom domains first, then its public link, each live one to open and copy", async ({
    page,
    context,
  }: {
    page: Page;
    context: BrowserContext;
  }) => {
    await grantClipboard(context);

    for (const width of [1280, 390]) {
      await open(
        page,
        `${SHARING}?share=link&domains=live:status.acme.com;dns:status-eu.acme.com`,
        width,
      );

      const section: Locator = page.getByTestId("dashboard-public-link");

      await expect(section).toBeVisible();
      expect(await listed(page)).toEqual([
        "live dashboard.acme.com",
        "not live dashboard-eu.acme.com",
        `live ${PUBLIC_LINK.replace("https://", "")}`,
      ]);

      // Under the choice in force, "Anyone with the link".
      const choice: Locator = page.getByTestId(
        "dashboard-access-AnyoneWithLink-row",
      );
      await expect(choice.getByTestId("public-addresses")).toBeVisible();

      await expectRowsInside(page, `the Sharing page at ${width}`);
      await expectNothingRunsOff(page, `the Sharing page at ${width}`);
      await screenshot(page, `dashboard-sharing-${width}`);
    }

    const publicRow: Locator = row(page, PUBLIC_LINK.replace("https://", ""));

    await expect(publicRow.getByRole("link")).toHaveAttribute(
      "href",
      PUBLIC_LINK,
    );

    const copy: Locator = row(page, "dashboard.acme.com").getByRole("button", {
      name: "Copy link to dashboard.acme.com",
    });

    await copy.click();
    expect(await clipboardText(page)).toBe("https://dashboard.acme.com");
  });

  test("a private dashboard lists nothing, and reads no custom domain", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${SHARING}?share=private&domains=live:status.acme.com`);

    await expect(
      page.getByTestId("dashboard-access-ProjectOnly-row"),
    ).toBeVisible();
    await expect(page.getByTestId("public-addresses")).toHaveCount(0);
    expect(
      (await fixture(page)).listRequests.filter(
        (request: { tableName: string }): boolean => {
          return request.tableName === "DashboardDomain";
        },
      ),
    ).toEqual([]);
  });
});

/*
 * A form's Share page: its Share Link card lists every address the form
 * answers at - its own domains first, then its link on OneUptime - with
 * Reset Link, which changes only the link.
 */
test.describe("a form's Share page: the Share Link card", () => {
  const formLinkAddress: string = FORM_LINK.replace("https://", "");

  function shareLinkCard(page: Page): Locator {
    return page.getByTestId("card").filter({
      has: page.getByTestId("form-share-link-card"),
    });
  }

  test("the form's own domains first, then its link, each live one to open and copy, with Reset Link", async ({
    page,
    context,
  }: {
    page: Page;
    context: BrowserContext;
  }) => {
    await grantClipboard(context);

    for (const width of [1280, 390]) {
      await open(
        page,
        `${FORM_SHARE}?domains=live:status.acme.com;dns:status-eu.acme.com`,
        width,
      );

      const card: Locator = shareLinkCard(page);

      await expect(card).toContainText("Share Link");
      expect(await listed(page)).toEqual([
        "live report.acme.com",
        "not live report-eu.acme.com",
        `live ${formLinkAddress}`,
      ]);
      await expect(
        card.getByRole("button", { name: "Reset Link", exact: true }),
      ).toBeVisible();

      await expectRowsInside(page, `the Share page at ${width}`, card);
      await expectNothingRunsOff(page, `the Share page at ${width}`);
      await screenshot(page, `form-share-${width}`);
    }

    const link: Locator = row(page, formLinkAddress).getByRole("link");

    await expect(link).toHaveAttribute("href", FORM_LINK);
    await expect(link).toHaveAttribute("target", "_blank");

    // A domain not live yet offers the Custom Domains page's own dialog.
    await expect(
      row(page, "report-eu.acme.com").getByTestId("public-address-not-live"),
    ).toHaveText("Not live yet");

    const copy: Locator = row(page, "report.acme.com").getByRole("button", {
      name: "Copy link to report.acme.com",
    });

    await copy.click();
    expect(await clipboardText(page)).toBe("https://report.acme.com");

    // The form's domains are read as the form's, and only for this form.
    const domainReads: Array<{ tableName: string; query: Array<string> }> = (
      await fixture(page)
    ).listRequests.filter((request: { tableName: string }): boolean => {
      return request.tableName === "FormDomain";
    });

    expect(domainReads.length).toBeGreaterThan(0);
    expect(domainReads[0]!.query).toContain("formId");
  });

  test("with no custom domain, one quiet line offers to add one, on the form's Custom Domains page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, FORM_SHARE, 1280);

    expect(await listed(page)).toEqual([`live ${formLinkAddress}`]);

    const add: Locator = page.getByTestId("public-addresses-add-custom-domain");

    await expect(add).toHaveText(
      "Use your own domain, such as report.example.com. Add a custom domain",
    );
    await expect(
      add.getByRole("link", { name: "Add a custom domain" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT}/forms/${FORM_ID}/custom-domains`,
    );

    await screenshot(page, "form-share-no-domain-1280");
  });

  test("the form's Custom Domains page: each domain, where it is on its way to HTTPS, at a laptop's width and a phone's", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width: width, height: 900 });
      await page.goto(
        `/dashboard/${PROJECT}/forms/${FORM_ID}/custom-domains?domains=live:status.acme.com;dns:status-eu.acme.com;failed:status-apac.acme.com`,
      );
      await page.evaluate(async (): Promise<void> => {
        await document.fonts.ready;
      });

      await expect(page.getByText("report.acme.com").first()).toBeVisible();

      for (const status of [
        "Certificate issued, renews automatically.",
        "Waiting for DNS: add the CNAME record.",
        "Could not issue a free certificate yet. We keep trying.",
      ]) {
        await expect(page.getByText(status).first()).toBeVisible();
      }

      // The card names the form's own CNAME record and what it does.
      await expect(page.getByTestId("card").first()).toContainText(
        "Serve this form on your own domain, at its root.",
      );

      await expectNothingRunsOff(page, `the Custom Domains page at ${width}`);
      await screenshot(page, `form-custom-domains-${width}`);
    }
  });

  test("turned off, the card says so under its addresses", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(
      page,
      `${FORM_SHARE}?enabled=0&domains=live:status.acme.com`,
      1280,
    );

    const card: Locator = shareLinkCard(page);
    const turnedOff: Locator = card.getByTestId("form-share-link-turned-off");

    await expect(turnedOff).toBeVisible();

    const list: Box = await box(card.getByTestId("public-addresses"));
    const alert: Box = await box(turnedOff);

    expect(alert.y).toBeGreaterThanOrEqual(list.y + list.height);

    await screenshot(page, "form-share-turned-off-1280");
  });

  test("in the dark theme, and in German and Persian at a phone's width, the card's words read and nothing runs off", async ({
    page,
  }: {
    page: Page;
  }) => {
    const domains: string =
      "domains=live:status.acme.com;failed:status-eu.acme.com";

    await open(page, `${FORM_SHARE}?theme=dark&${domains}`, 1280);

    const live: Locator = row(page, "report.acme.com");

    expect(luminance(parseRgb(await backgroundOf(live)))).toBeLessThan(0.05);

    for (const [name, locator] of [
      ["the address", live.getByRole("link")],
      [
        "why",
        row(page, "report-eu.acme.com").getByTestId("public-address-reason"),
      ],
    ] as Array<[string, Locator]>) {
      expect(
        contrast(await colorOf(locator), await backgroundOf(locator)),
        name,
      ).toBeGreaterThanOrEqual(4.5);
    }

    await screenshot(page, "form-share-dark-1280");

    for (const language of [
      { code: "de", title: "Link zum Teilen", reset: "Link zurücksetzen" },
      {
        code: "fa",
        title: "پیوند اشتراک‌گذاری",
        reset: "بازنشانی پیوند",
      },
    ]) {
      await open(page, `${FORM_SHARE}?lang=${language.code}&${domains}`, 390);

      const card: Locator = shareLinkCard(page);

      await expect(card).toContainText(language.title);
      await expect(
        card.getByRole("button", { name: language.reset, exact: true }),
      ).toBeVisible();

      await expectRowsInside(page, `the Share page in ${language.code}`, card);
      await expectNothingRunsOff(page, `the Share page in ${language.code}`);
      await screenshot(page, `form-share-${language.code}-390`);
    }
  });
});
