import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs";
import path from "path";

/*
 * File and Multiple files custom fields, and a public form's file
 * questions, in a browser, against the offline fixture
 * (CustomFieldFiles/Fixture): an incident's Custom Fields page and its Edit
 * dialog, and the public form page.
 *
 * Pinned here, in Chromium, what jsdom cannot show: each of a record's files
 * on its card, by name and size, a download of the record's own; choosing a
 * file and its upload's progress; Replace on a File field, which opens the
 * file chooser; Remove; what Save sends and what the card shows after; a
 * full field; a file of a kind a field does not take and one too large,
 * refused by name with nothing uploaded; an upload and a save the server
 * refuses; long names that wrap; at 1280 and 390 pixels, in dark mode, in
 * German and in Persian, right to left. And the public form: files kept in
 * the browser until Submit, sent with the answers as the server reads them,
 * the upload's progress, Replace, the response's limits checked before
 * anything is sent, the form's hourly allowance of files, a phone, German
 * and Persian.
 */

const PORT: string = process.env["CUSTOM_FIELD_FILES_FIXTURE_PORT"] || "4652";
const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000c1";
const INCIDENT_ID: string = "20000000-0000-4000-8000-0000000000c1";
const CARD_PATH: string = `/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID}/custom-fields`;
const FORM_KEY: string = "70000000-0000-4000-8000-0000000000c1";
const FORM_PATH: string = `/accounts/form/${FORM_KEY}`;
// The made-up host the Dashboard's API lives on, in the fixture.
const API_ORIGIN: string = "https://oneuptime.acme-commerce.example";

const FILE_FIELD: string = "Signed change request";
const FILES_FIELD: string = "Evidence";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/custom-field-files-ui",
);

// The words the pickers say, as the product writes them (CustomFieldFormFields).
const FILES_HINT: string =
  "Up to 10 files of 10 MB each: PDF, Office and OpenDocument files, pictures, text, CSV, JSON, ZIP or PCAP.";
const FILE_HINT: string =
  "PDF, Office and OpenDocument files, pictures, text, CSV, JSON, ZIP or PCAP, up to 10 MB.";
const FULL_NOTE: string =
  "This field holds up to 10 files. Remove one to add another.";

function readJson(relative: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, relative), "utf8"),
  ) as Record<string, unknown>;
}

function dashboardLocale(language: string): Record<string, string> {
  return readJson(
    `../../App/FeatureSet/Dashboard/src/Locales/${language}.json`,
  ) as Record<string, string>;
}

function accountsLocale(language: string): Record<string, unknown> {
  return readJson(`../../App/FeatureSet/Accounts/src/Locales/${language}.json`);
}

// A key of the Accounts locale, flat (an English sentence) or nested ("form.x").
function accountsText(language: string, key: string): string {
  const locale: Record<string, unknown> = accountsLocale(language);

  if (typeof locale[key] === "string") {
    return locale[key] as string;
  }

  let value: unknown = locale;

  for (const part of key.split(".")) {
    value =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)[part]
        : undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`The ${language} Accounts locale has no ${key}`);
  }

  return value;
}

const GERMAN: Record<string, string> = dashboardLocale("de");
const PERSIAN: Record<string, string> = dashboardLocale("fa");

// ---- test files -----------------------------------------------------------------

interface TestFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

// A PNG of a single pixel: the signature, its header, its data and its end.
const PNG_BYTES: Buffer = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

function png(name: string): TestFile {
  return { name, mimeType: "image/png", buffer: PNG_BYTES };
}

function pdf(name: string, size: number = 2048): TestFile {
  const head: Buffer = Buffer.from("%PDF-1.7\n", "latin1");
  const buffer: Buffer = Buffer.alloc(Math.max(size, head.length), 0x20);
  head.copy(buffer, 0);
  return { name, mimeType: "application/pdf", buffer };
}

function csv(name: string, size: number = 512): TestFile {
  return {
    name,
    mimeType: "text/csv",
    buffer: Buffer.alloc(size, "time,status\n10:02,502\n"),
  };
}

// ---- the fixture's records ----------------------------------------------------

interface Upload {
  name: string;
  fileType: string;
  size: number;
}

interface DashboardFixture {
  uploads: Array<Upload>;
  updates: Array<{ customFields: Record<string, unknown> }>;
  unmodelled: Array<string>;
}

interface FormFixture {
  requests: Array<string>;
  // Each body as sent: the answers under data, as the server reads them.
  submissions: Array<{ data: { answers: Record<string, unknown> } }>;
  unexpected: Array<string>;
}

async function dashboardFixture(page: Page): Promise<DashboardFixture> {
  return page.evaluate((): DashboardFixture => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __fixture: DashboardFixture }).__fixture,
      ),
    ) as DashboardFixture;
  });
}

async function formFixture(page: Page): Promise<FormFixture> {
  return page.evaluate((): FormFixture => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __formFixture: FormFixture }).__formFixture,
      ),
    ) as FormFixture;
  });
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

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);

  const url: URL = new URL(page.url());

  // Every read and write the page made is one its fixture models.
  if (url.pathname.startsWith("/dashboard")) {
    expect((await dashboardFixture(page)).unmodelled).toEqual([]);
  }

  if (url.pathname.startsWith("/accounts")) {
    expect((await formFixture(page)).unexpected).toEqual([]);
  }
});

// ---- helpers ------------------------------------------------------------------

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: (await page.getByRole("dialog").count()) === 0,
    animations: "disabled",
  });
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
    // Every finite animation - a dialog growing in - has finished.
    await Promise.all(
      document.getAnimations().map((animation: Animation) => {
        return animation.finished.catch(() => {
          return undefined;
        });
      }),
    );
  });
}

async function openCard(page: Page, query: string = ""): Promise<void> {
  await page.goto(`${CARD_PATH}${query}`);
  await expect(page.getByText(FILE_FIELD, { exact: true })).toBeVisible();
  await settle(page);
}

async function openDialog(
  page: Page,
  editLabel: string = "Edit Fields",
): Promise<Locator> {
  await page.getByRole("button", { name: editLabel }).click();
  const dialog: Locator = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await settle(page);
  return dialog;
}

function cardFiles(page: Page, field: string): Locator {
  return page.getByTestId(`custom-field-files-${field}`);
}

function picker(page: Page, field: string): Locator {
  return page.getByTestId(`custom-field-picker-${field}`);
}

// The picker's file input: in the drop zone, whether or not it is in sight.
function pickerInput(page: Page, field: string): Locator {
  return picker(page, field).locator("input[type='file']");
}

// The files a picker lists, by name, in order.
async function listedNames(page: Page, field: string): Promise<Array<string>> {
  // Each listed file is a row with a Remove button: its name is the row's first line.
  const rows: Locator = picker(page, field)
    .locator("xpath=..")
    .locator("div.shadow-sm");
  const names: Array<string> = [];

  for (const row of await rows.all()) {
    names.push(((await row.locator("p").first().textContent()) || "").trim());
  }

  return names;
}

async function overflowsSideways(page: Page): Promise<boolean> {
  return page.evaluate((): boolean => {
    return document.documentElement.scrollWidth > window.innerWidth + 1;
  });
}

// How light a colour is, 0 (black) to 1 (white).
async function luminance(locator: Locator, property: string): Promise<number> {
  return locator.evaluate((element: Element, name: string): number => {
    const value: string = getComputedStyle(element).getPropertyValue(name);
    const parts: Array<number> = (value.match(/[\d.]+/g) || []).map(Number);
    const [red, green, blue] = parts.map((part: number): number => {
      const channel: number = part / 255;
      return channel <= 0.03928
        ? channel / 12.92
        : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * (red || 0) + 0.7152 * (green || 0) + 0.0722 * (blue || 0);
  }, property);
}

function downloadPath(fileNumber: number): string {
  const fileId: string = `f0000000-0000-4000-8000-${String(fileNumber).padStart(12, "0")}`;
  return `/api/custom-field-file/${PROJECT_ID}/incident/${INCIDENT_ID}/${fileId}`;
}

// ---- a record's files, on its card --------------------------------------------

test.describe("a record's file custom fields: the card", () => {
  test("lists each file by its name and size, each a download of the record's own", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCard(page);

    const signed: Locator = cardFiles(page, FILE_FIELD).getByTestId(
      "custom-field-file",
    );
    const evidence: Locator = cardFiles(page, FILES_FIELD).getByTestId(
      "custom-field-file",
    );

    await expect(signed).toHaveCount(1);
    await expect(signed).toContainText("change-request-CHG-2041-signed.pdf");
    await expect(signed).toContainText("47 KB");

    await expect(evidence).toHaveCount(3);
    await expect(evidence.nth(0)).toContainText("checkout-latency.png");
    await expect(evidence.nth(0)).toContainText("240 KB");
    await expect(evidence.nth(1)).toContainText("gateway-errors.csv");
    await expect(evidence.nth(1)).toContainText("18 KB");
    await expect(evidence.nth(2)).toContainText("capture-eu-west-1.pcap");
    await expect(evidence.nth(2)).toContainText("2.4 MB");

    /*
     * A download from the route that serves a record's file to people who
     * may read the record, in a tab of its own: never the file's id alone.
     */
    for (const [row, number] of [
      [signed, 1],
      [evidence.nth(0), 2],
      [evidence.nth(1), 3],
      [evidence.nth(2), 4],
    ] as Array<[Locator, number]>) {
      const href: string = (await row.getAttribute("href")) || "";
      const url: URL = new URL(href);

      expect(url.origin).toBe(API_ORIGIN);
      expect(url.pathname).toBe(downloadPath(number));
      await expect(row).toHaveAttribute("target", "_blank");
      await expect(row).toHaveAttribute("rel", "noopener noreferrer");
    }

    await expect(page.getByText("CHG-2041", { exact: true })).toBeVisible();
    await screenshot(page, "card-1280");
  });

  test("a field with no file reads as one with no data", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCard(page, "?data=empty");

    await expect(cardFiles(page, FILE_FIELD)).toHaveText("No data entered");
    await expect(cardFiles(page, FILES_FIELD)).toHaveText("No data entered");
    await expect(page.getByTestId("custom-field-file")).toHaveCount(0);
  });

  test("long names wrap in their row at 1280 and 390, nothing runs off the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width: width, height: 900 });
      await openCard(page, "?data=long");

      const row: Locator = cardFiles(page, FILE_FIELD).getByTestId(
        "custom-field-file",
      );
      const card: Locator = cardFiles(page, FILE_FIELD);
      const rowBox: { x: number; width: number } | null =
        await row.boundingBox();
      const listBox: { x: number; width: number } | null =
        await card.boundingBox();

      expect(await overflowsSideways(page)).toBe(false);
      expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(
        listBox!.x + listBox!.width + 1,
      );
      // The size and the download icon stay in sight at the row's end.
      await expect(row).toContainText("47 KB");

      await screenshot(page, `card-long-${width}`);
    }
  });

  test("at 390 the card fits a phone", async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCard(page);

    expect(await overflowsSideways(page)).toBe(false);
    await expect(
      cardFiles(page, FILES_FIELD).getByTestId("custom-field-file"),
    ).toHaveCount(3);
    await screenshot(page, "card-390");
  });

  test("dark: each file a dark row with light words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCard(page, "?theme=dark");

    const row: Locator = cardFiles(page, FILES_FIELD)
      .getByTestId("custom-field-file")
      .first();

    expect(await luminance(row, "background-color")).toBeLessThan(0.1);
    expect(
      await luminance(row.getByText("checkout-latency.png"), "color"),
    ).toBeGreaterThan(0.5);
    await screenshot(page, "card-dark-1280");
  });
});

// ---- a record's files, in its Edit dialog -----------------------------------------

test.describe("a record's file custom fields: Edit", () => {
  test("lists the files each field holds, with Replace for one and the hint for several", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCard(page);
    await openDialog(page);

    // A File field holding its file: the file, Replace and Remove; no empty drop zone.
    expect(await listedNames(page, FILE_FIELD)).toEqual([
      "change-request-CHG-2041-signed.pdf",
    ]);
    await expect(picker(page, FILE_FIELD)).toHaveClass("sr-only");
    await expect(
      picker(page, FILE_FIELD).locator("xpath=..").getByText("Replace"),
    ).toBeVisible();
    // Its type by its short name, never its MIME type.
    await expect(
      picker(page, FILE_FIELD).locator("xpath=..").getByText("PDF", {
        exact: true,
      }),
    ).toBeVisible();

    // A Multiple files field: its files, and room for more, said in a sentence.
    expect(await listedNames(page, FILES_FIELD)).toEqual([
      "checkout-latency.png",
      "gateway-errors.csv",
      "capture-eu-west-1.pcap",
    ]);
    await expect(picker(page, FILES_FIELD)).toContainText(FILES_HINT);
    await expect(picker(page, FILES_FIELD)).toContainText("Add more files");

    await screenshot(page, "dialog-1280");
  });

  test("a file added uploads with its progress, and Save keeps it beside the others", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCard(page, "?upload=slow");
    const dialog: Locator = await openDialog(page);

    await pickerInput(page, FILES_FIELD).setInputFiles(png("latency-p99.png"));

    // While it uploads, how far it has got.
    const progress: Locator = dialog.getByText("Uploading files");
    await expect(progress).toBeVisible();
    await expect(dialog.getByText(/^\d{1,3}%$/).first()).toBeVisible();
    await screenshot(page, "dialog-uploading-1280");

    await expect(progress).toHaveCount(0, { timeout: 15000 });
    expect(await listedNames(page, FILES_FIELD)).toEqual([
      "checkout-latency.png",
      "gateway-errors.csv",
      "capture-eu-west-1.pcap",
      "latency-p99.png",
    ]);

    const uploads: Array<Upload> = (await dashboardFixture(page)).uploads;
    expect(uploads).toEqual([
      {
        name: "latency-p99.png",
        fileType: "image/png",
        size: PNG_BYTES.length,
      },
    ]);

    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);

    const updates: DashboardFixture["updates"] = (await dashboardFixture(page))
      .updates;
    expect(updates).toHaveLength(1);

    const sent: Record<string, unknown> = updates[0]!.customFields;
    const evidence: Array<{ fileId: string; name: string }> = sent[
      FILES_FIELD
    ] as Array<{ fileId: string; name: string }>;

    // Each file as the file it names: its id, with its name and type.
    expect(
      evidence.map((file: { fileId: string; name: string }) => {
        return file.name;
      }),
    ).toEqual([
      "checkout-latency.png",
      "gateway-errors.csv",
      "capture-eu-west-1.pcap",
      "latency-p99.png",
    ]);
    expect(evidence[3]!.fileId).toMatch(/^f0000000-0000-4000-8000-0{9}100$/);
    expect((sent[FILE_FIELD] as { fileId: string }).fileId).toBe(
      "f0000000-0000-4000-8000-000000000001",
    );
    expect(sent["Change ticket"]).toBe("CHG-2041");

    // The card shows what the save left: the new file, a download like the rest.
    const rows: Locator = cardFiles(page, FILES_FIELD).getByTestId(
      "custom-field-file",
    );
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(3)).toContainText("latency-p99.png");
    expect(
      new URL((await rows.nth(3).getAttribute("href")) || "").pathname,
    ).toBe(downloadPath(100));
  });

  test("Replace opens the file chooser, and the File field holds the file chosen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCard(page);
    const dialog: Locator = await openDialog(page);

    const chooser: Promise<import("@playwright/test").FileChooser> =
      page.waitForEvent("filechooser");
    await picker(page, FILE_FIELD)
      .locator("xpath=..")
      .getByRole("button", { name: "Replace" })
      .click();
    await (await chooser).setFiles(pdf("change-request-CHG-2041-v2.pdf"));

    await expect
      .poll(async () => {
        return listedNames(page, FILE_FIELD);
      })
      .toEqual(["change-request-CHG-2041-v2.pdf"]);

    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);

    const sent: Record<string, unknown> = (await dashboardFixture(page))
      .updates[0]!.customFields;

    expect((sent[FILE_FIELD] as { name: string }).name).toBe(
      "change-request-CHG-2041-v2.pdf",
    );
    await expect(cardFiles(page, FILE_FIELD)).toContainText(
      "change-request-CHG-2041-v2.pdf",
    );
    await expect(cardFiles(page, FILE_FIELD)).not.toContainText(
      "change-request-CHG-2041-signed.pdf",
    );
  });

  test("Remove takes a file out, and Save keeps the rest", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCard(page);
    const dialog: Locator = await openDialog(page);

    await picker(page, FILES_FIELD)
      .locator("xpath=..")
      .locator("div.shadow-sm", { hasText: "gateway-errors.csv" })
      .getByRole("button", { name: "Remove" })
      .click();

    expect(await listedNames(page, FILES_FIELD)).toEqual([
      "checkout-latency.png",
      "capture-eu-west-1.pcap",
    ]);

    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);

    const sent: Record<string, unknown> = (await dashboardFixture(page))
      .updates[0]!.customFields;

    expect(
      (sent[FILES_FIELD] as Array<{ name: string }>).map(
        (file: { name: string }) => {
          return file.name;
        },
      ),
    ).toEqual(["checkout-latency.png", "capture-eu-west-1.pcap"]);
    await expect(
      cardFiles(page, FILES_FIELD).getByTestId("custom-field-file"),
    ).toHaveCount(2);
  });

  test("a file of a kind the field does not take is refused by name, and nothing is uploaded", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCard(page);
    await openDialog(page);

    await pickerInput(page, FILES_FIELD).setInputFiles({
      name: "diagram.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    });

    await expect(picker(page, FILES_FIELD)).toContainText(
      '"diagram.svg" is not a type of file this field takes.',
    );
    expect((await dashboardFixture(page)).uploads).toEqual([]);
    expect(await listedNames(page, FILES_FIELD)).toHaveLength(3);
  });

  test("a file over 10 MB is refused by name, and nothing is uploaded", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCard(page);
    await openDialog(page);

    await pickerInput(page, FILES_FIELD).setInputFiles(
      pdf("full-capture.pdf", 10 * 1024 * 1024 + 1),
    );

    await expect(picker(page, FILES_FIELD)).toContainText(
      '"full-capture.pdf" exceeds the 10MB limit.',
    );
    expect((await dashboardFixture(page)).uploads).toEqual([]);
  });

  test("a full Multiple files field says how many it holds, and takes more once one is removed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCard(page, "?data=full");
    const dialog: Locator = await openDialog(page);

    await expect(picker(page, FILES_FIELD)).toContainText(FULL_NOTE);
    await expect(pickerInput(page, FILES_FIELD)).toHaveCount(0);
    await screenshot(page, "dialog-full-1280");

    await picker(page, FILES_FIELD)
      .locator("xpath=..")
      .locator("div.shadow-sm", { hasText: "screenshot-7.png" })
      .getByRole("button", { name: "Remove" })
      .click();

    await expect(picker(page, FILES_FIELD)).not.toContainText(FULL_NOTE);
    await expect(picker(page, FILES_FIELD)).toContainText("Add more files");
    await expect(pickerInput(page, FILES_FIELD)).toHaveCount(1);
    await expect(dialog).toBeVisible();
  });

  test("an upload the server refuses says why, and leaves the field as it was", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCard(page, "?upload=fail");
    const dialog: Locator = await openDialog(page);

    await pickerInput(page, FILES_FIELD).setInputFiles(csv("errors.csv"));

    await expect(dialog.getByText("Failed", { exact: true })).toBeVisible();
    await expect(picker(page, FILES_FIELD).locator("xpath=..")).toContainText(
      "This file type is not supported. Please upload a supported file type.",
    );
    expect(await listedNames(page, FILES_FIELD)).toHaveLength(3);
  });

  test("a save the server refuses says why on the card, which still shows the files stored", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCard(page, "?save=fail");
    const dialog: Locator = await openDialog(page);

    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);

    await expect(
      page.getByText(
        `One of the files for "${FILES_FIELD}" could not be found. Upload it again.`,
      ),
    ).toBeVisible();
    await expect(
      cardFiles(page, FILES_FIELD).getByTestId("custom-field-file"),
    ).toHaveCount(3);
  });

  test("at 390 the dialog and its long names fit a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCard(page, "?data=long");
    const dialog: Locator = await openDialog(page);

    expect(await overflowsSideways(page)).toBe(false);

    const dialogBox: { x: number; width: number } | null =
      await dialog.boundingBox();

    for (const button of await dialog
      .getByRole("button", { name: /^(Replace|Remove)$/ })
      .all()) {
      const box: { x: number; width: number } | null =
        await button.boundingBox();

      if (!box) {
        continue;
      }

      // Every button stays inside the dialog, beside its long name.
      expect(box.x).toBeGreaterThanOrEqual(dialogBox!.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(
        dialogBox!.x + dialogBox!.width + 1,
      );
    }

    await screenshot(page, "dialog-long-390");
  });

  test("dark: the pickers and their files on the dark surface", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCard(page, "?theme=dark");
    await openDialog(page);

    const row: Locator = picker(page, FILES_FIELD)
      .locator("xpath=..")
      .locator("div.shadow-sm")
      .first();

    expect(await luminance(row, "background-color")).toBeLessThan(0.1);
    expect(
      await luminance(picker(page, FILES_FIELD), "background-color"),
    ).toBeLessThan(0.1);
    await screenshot(page, "dialog-dark-1280");
  });

  test("German: the card and the pickers in the Dashboard's German words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCard(page, "?lang=de");
    await openDialog(page, GERMAN["Edit Fields"] as string);

    await expect(picker(page, FILES_FIELD)).toContainText(
      GERMAN[FILES_HINT] as string,
    );
    await expect(
      picker(page, FILE_FIELD)
        .locator("xpath=..")
        .getByRole("button", { name: GERMAN["Replace"] as string }),
    ).toBeVisible();
    await expect(
      picker(page, FILES_FIELD)
        .locator("xpath=..")
        .getByRole("button", { name: GERMAN["Remove"] as string })
        .first(),
    ).toBeVisible();
    expect(GERMAN[FILES_HINT]).not.toBe(FILES_HINT);
    expect(await overflowsSideways(page)).toBe(false);
    await screenshot(page, "dialog-de-1280");
  });

  test("Persian: right to left, each file's name at the row's start on the right", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCard(page, "?lang=fa");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    const row: Locator = cardFiles(page, FILES_FIELD)
      .getByTestId("custom-field-file")
      .first();
    const name: { x: number } | null = await row
      .getByText("checkout-latency.png")
      .boundingBox();
    const size: { x: number } | null = await row
      .getByText("240 KB")
      .boundingBox();

    expect(name!.x).toBeGreaterThan(size!.x);
    await screenshot(page, "card-fa-1280");

    await openDialog(page, PERSIAN["Edit Fields"] as string);
    await expect(picker(page, FILES_FIELD)).toContainText(
      PERSIAN[FILES_HINT] as string,
    );
    expect(await overflowsSideways(page)).toBe(false);
    await screenshot(page, "dialog-fa-1280");
  });
});

// ---- a public form's file questions -------------------------------------------------

async function openForm(
  page: Page,
  query: string = "",
  language: string = "en",
): Promise<void> {
  await page.addInitScript((value: string) => {
    window.localStorage.setItem("oneuptimeLang", value);
  }, language);
  await page.goto(`${FORM_PATH}${query}`);
  await expect(page.getByTestId("form-field-evidence")).toBeVisible();
  await settle(page);
}

function formPicker(page: Page, question: string): Locator {
  return page.getByTestId(`form-field-${question}`);
}

function formInput(page: Page, question: string): Locator {
  return formPicker(page, question).locator("input[type='file']");
}

async function fillSummary(page: Page): Promise<void> {
  await page
    .getByRole("textbox")
    .first()
    .fill("Checkout fails with 502 in EU West");
}

function decode(data: string): Buffer {
  return Buffer.from(data, "base64");
}

test.describe("a public form's file questions", () => {
  test("files are kept in the browser and sent with the answers, as the server reads them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openForm(page, "?submit=slow");
    await fillSummary(page);

    await formInput(page, "screenshot").setInputFiles(png("outage.png"));
    await formInput(page, "evidence").setInputFiles([
      csv("gateway-errors.csv"),
      pdf("runbook-steps.pdf"),
    ]);

    // Chosen, not uploaded: nothing is sent before Submit.
    await expect(page.getByText("Chosen files").first()).toBeVisible();
    await expect(page.getByText("Uploaded files")).toHaveCount(0);
    expect((await formFixture(page)).requests).toEqual([
      `GET /api/form/public/${FORM_KEY}`,
    ]);
    await screenshot(page, "form-chosen-1280");

    await page.getByRole("button", { name: "Submit" }).click();

    // While the answers and their files are sent, how far it has got.
    const progress: Locator = page.getByTestId("form-upload-progress");
    await expect(progress).toBeVisible();
    await expect(progress).toContainText(/\d{1,3}%/);
    await screenshot(page, "form-sending-1280");

    await expect(
      page.getByText(accountsText("en", "form.successTitle")),
    ).toBeVisible({ timeout: 15000 });

    const submissions: FormFixture["submissions"] = (await formFixture(page))
      .submissions;
    expect(submissions).toHaveLength(1);

    const answers: Record<string, unknown> = submissions[0]!.data.answers;
    const screenshotAnswer: { name: string; fileType: string; data: string } =
      answers["screenshot"] as { name: string; fileType: string; data: string };
    const evidence: Array<{ name: string; fileType: string; data: string }> =
      answers["evidence"] as Array<{
        name: string;
        fileType: string;
        data: string;
      }>;

    // One file for a File question, a list for a Multiple Files one.
    expect(screenshotAnswer.name).toBe("outage.png");
    expect(screenshotAnswer.fileType).toBe("image/png");
    expect(decode(screenshotAnswer.data).equals(PNG_BYTES)).toBe(true);
    expect(
      evidence.map((file: { name: string; fileType: string }) => {
        return [file.name, file.fileType];
      }),
    ).toEqual([
      ["gateway-errors.csv", "text/csv"],
      ["runbook-steps.pdf", "application/pdf"],
    ]);
    expect(
      decode(evidence[1]!.data).equals(pdf("runbook-steps.pdf").buffer),
    ).toBe(true);
  });

  test("Replace swaps the chosen file before anything is sent", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openForm(page);
    await fillSummary(page);
    await formInput(page, "screenshot").setInputFiles(png("first.png"));

    const chooser: Promise<import("@playwright/test").FileChooser> =
      page.waitForEvent("filechooser");
    await formPicker(page, "screenshot")
      .locator("xpath=..")
      .getByRole("button", { name: "Replace" })
      .click();
    await (await chooser).setFiles(png("second.png"));

    await expect(
      formPicker(page, "screenshot")
        .locator("xpath=..")
        .getByText("second.png"),
    ).toBeVisible();
    await expect(
      formPicker(page, "screenshot").locator("xpath=..").getByText("first.png"),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Submit" }).click();
    await expect(
      page.getByText(accountsText("en", "form.successTitle")),
    ).toBeVisible();

    const answers: Record<string, unknown> = (await formFixture(page))
      .submissions[0]!.data.answers;
    expect((answers["screenshot"] as { name: string }).name).toBe("second.png");
  });

  test("more than 10 files in one response are refused before anything is sent", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openForm(page);
    await fillSummary(page);

    await formInput(page, "screenshot").setInputFiles(png("outage.png"));
    await formInput(page, "evidence").setInputFiles(
      Array.from({ length: 10 }, (_: unknown, index: number): TestFile => {
        return csv(`log-${index + 1}.csv`);
      }),
    );

    await page.getByRole("button", { name: "Submit" }).click();

    await expect(
      page.getByText("A response can carry at most 10 files."),
    ).toBeVisible();
    expect((await formFixture(page)).submissions).toEqual([]);
  });

  test("files over 20 MB together are refused before anything is sent", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openForm(page);
    await fillSummary(page);

    await formInput(page, "evidence").setInputFiles([
      pdf("capture-1.pdf", 7 * 1024 * 1024),
      pdf("capture-2.pdf", 7 * 1024 * 1024),
      pdf("capture-3.pdf", 7 * 1024 * 1024),
    ]);

    await page.getByRole("button", { name: "Submit" }).click();

    await expect(
      page.getByText("The files of a response can be at most 20 MB together."),
    ).toBeVisible();
    expect((await formFixture(page)).submissions).toEqual([]);
  });

  test("a form that has taken in too many files this hour says so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openForm(page, "?submit=busy");
    await fillSummary(page);
    await formInput(page, "screenshot").setInputFiles(png("outage.png"));

    await page.getByRole("button", { name: "Submit" }).click();

    await expect(
      page.getByText(
        "This form is receiving too many files right now. Please try again later.",
      ),
    ).toBeVisible();
    // The answers stay, to send again later.
    await expect(
      formPicker(page, "screenshot")
        .locator("xpath=..")
        .getByText("outage.png"),
    ).toBeVisible();
  });

  test("at 390 the form and its chosen files fit a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openForm(page);
    await fillSummary(page);
    await formInput(page, "evidence").setInputFiles([
      csv(
        "gateway-errors-from-the-eu-west-1-load-balancer-during-the-incident.csv",
      ),
      png("outage.png"),
    ]);

    expect(await overflowsSideways(page)).toBe(false);
    await screenshot(page, "form-390");
  });

  test("German: the pickers in the form page's own words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openForm(page, "", "de");

    await expect(formPicker(page, "evidence")).toContainText(
      accountsText("de", FILES_HINT),
    );
    await expect(formPicker(page, "screenshot")).toContainText(
      accountsText("de", FILE_HINT),
    );
    await formInput(page, "evidence").setInputFiles(csv("fehler.csv"));
    await expect(
      page.getByText(accountsText("de", "Chosen files")).first(),
    ).toBeVisible();
    expect(accountsText("de", FILES_HINT)).not.toBe(FILES_HINT);
    await screenshot(page, "form-de-1280");
  });

  test("Persian: the form page right to left, its pickers in Persian", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openForm(page, "", "fa");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(formPicker(page, "evidence")).toContainText(
      accountsText("fa", FILES_HINT),
    );
    await formInput(page, "evidence").setInputFiles(csv("errors.csv"));
    await expect(
      page.getByText(accountsText("fa", "Chosen files")).first(),
    ).toBeVisible();
    expect(await overflowsSideways(page)).toBe(false);
    await screenshot(page, "form-fa-1280");
  });
});
