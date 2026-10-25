import {
  APIRequestContext,
  APIResponse,
  expect,
  Locator,
  Page,
  test,
} from "@playwright/test";
import fs from "fs";
import path from "path";

/*
 * Admin Dashboard > Settings > Backups, in a browser, against the offline
 * fixture (Backups/Fixture): the first run, setting backups up with a test
 * of the destination before anything is saved, a backup running, a backup
 * that failed, a restore running, the restore's confirmation, deleting a
 * backup, turning the schedule off, a lapsed license - at a laptop's width
 * and a phone's, light and dark - and the Community Edition, whose
 * Settings have no Backups page.
 *
 * The page ships in the Enterprise Edition; the fixture reaches it through
 * the Admin Dashboard's plugin, as the Admin Dashboard does. Where ee/ is
 * not checked out the Enterprise specs are skipped, and the Community spec
 * runs either way.
 */

const PAGE: string = "/admin/settings/backups";
const COMMUNITY_PAGE: string = `/community${PAGE}`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/backups-ui",
);

const PHONE: { width: number; height: number } = { width: 390, height: 844 };

const RECOMMENDED: Array<string> = [
  "Amazon S3",
  "Cloudflare R2",
  "Backblaze B2",
  "Wasabi",
  "MinIO",
  "Google Cloud Storage",
  "Azure Blob Storage",
  "Other S3-compatible storage",
];

const STORAGE_REFUSED: string =
  "The S3-compatible storage did not let this key write the backup (HTTP 403, AccessDenied).";

interface RecordedPost {
  route: string;
  body: Record<string, unknown> | null;
}

interface RecordedWrite {
  what: string;
  table: string;
  id?: string;
  data: Record<string, unknown>;
}

interface FixtureRecord {
  posts: Array<RecordedPost>;
  writes: Array<RecordedWrite>;
  unmodeled: Array<unknown>;
}

let edition: string = "";

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const response: APIResponse = await request.get("/edition.json");
  edition = ((await response.json()) as { edition: string }).edition;
});

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });
});

test.afterEach(
  async ({ page }: { page: Page }, testInfo: { status?: string }) => {
    // A spec skipped where ee/ is not checked out opened no page.
    if (testInfo.status === "skipped") {
      return;
    }

    // The page threw nothing, and asked the server for nothing the fixture does not answer.
    expect(pageErrors.get(page)).toEqual([]);
    expect((await fixtureRecord(page)).unmodeled).toEqual([]);
  },
);

// What the page sent and read, as the fixture recorded it (nothing before it loads).
async function fixtureRecord(page: Page): Promise<FixtureRecord> {
  return await page.evaluate((): FixtureRecord => {
    return (
      (window as unknown as { __fixture?: FixtureRecord }).__fixture || {
        posts: [],
        writes: [],
        unmodeled: [],
      }
    );
  });
}

async function postsTo(
  page: Page,
  route: string,
): Promise<Array<RecordedPost>> {
  return (await fixtureRecord(page)).posts.filter((post: RecordedPost) => {
    return post.route === route;
  });
}

// The whole page, or - while a dialog is open - the window it is drawn in.
async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: (await page.getByTestId("modal").count()) === 0,
    animations: "disabled",
  });
}

/*
 * Nothing runs past the right edge. Read again until the page is at rest: a
 * table drawn for a laptop turns into cards a moment after the window
 * narrows.
 */
async function expectNoHorizontalScroll(page: Page): Promise<void> {
  await expect
    .poll(async (): Promise<number> => {
      return await page.evaluate((): number => {
        return document.documentElement.scrollWidth - window.innerWidth;
      });
    })
    .toBeLessThanOrEqual(0);
}

/*
 * In View steps, the line joining a step to the next runs under the step's
 * mark - on its left in English, on its right in a right-to-left language.
 */
async function expectStepLineUnderMark(page: Page, key: string): Promise<void> {
  const item: Locator = page
    .getByTestId("modal")
    .getByTestId(`backup-run-step-${key}`);
  const line: { x: number; width: number } | null = await item
    .locator(":scope > [aria-hidden=true]")
    .boundingBox();
  const mark: { x: number; width: number } | null = await item
    .locator(":scope > div.relative.flex-none")
    .boundingBox();

  expect(line && mark).toBeTruthy();

  const middle: number = line!.x + line!.width / 2;

  expect(middle).toBeGreaterThan(mark!.x);
  expect(middle).toBeLessThan(mark!.x + mark!.width);
}

// The page, once its data is drawn: the status card, or the first run's hero.
async function openPage(page: Page, search: string = ""): Promise<void> {
  await page.goto(`${PAGE}${search}`);
  await expect(page.getByTestId("backups-view")).toBeVisible();
  await expect(
    page.getByTestId("backups-status").or(page.getByTestId("backups-hero")),
  ).toBeVisible();
}

function dialog(page: Page): Locator {
  return page.getByTestId("modal");
}

// The Backups list, and then the Restores list, as the page draws them.
function list(page: Page, index: number): Locator {
  return page.getByTestId("table-content").nth(index);
}

/*
 * A backup's row - or, on a phone, its card - in the Backups list: the
 * innermost element that holds both its time and its buttons (every backup
 * has one). Newest first.
 */
function backupRows(page: Page): Locator {
  return list(page, 0)
    .getByTestId("backup-run-when")
    .locator("xpath=ancestor::*[self::tr or self::div][.//button][1]");
}

async function isDark(page: Page): Promise<boolean> {
  return await page.evaluate((): boolean => {
    return document.documentElement.classList.contains("dark");
  });
}

// The status card is drawn on a dark surface in dark mode, a light one otherwise.
async function expectStatusCardTheme(page: Page): Promise<void> {
  const background: string = await page
    .getByTestId("backups-status")
    .evaluate((element: Element): string => {
      let current: Element | null = element;

      while (current) {
        const color: string = getComputedStyle(current).backgroundColor;

        if (color && color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
          return color;
        }

        current = current.parentElement;
      }

      return "";
    });
  const channels: Array<number> = (background.match(/\d+/g) || [])
    .slice(0, 3)
    .map(Number);
  const brightness: number =
    channels.reduce((sum: number, value: number) => {
      return sum + value;
    }, 0) / Math.max(1, channels.length);

  if (await isDark(page)) {
    expect(brightness).toBeLessThan(90);
  } else {
    expect(brightness).toBeGreaterThan(200);
  }
}

test.describe("the Enterprise Edition's Backups page", () => {
  test.beforeEach(() => {
    test.skip(
      edition !== "enterprise",
      "The Backups page ships in the Enterprise Edition: ee/ is not checked out here.",
    );
  });

  for (const viewport of [
    { name: "laptop", size: { width: 1280, height: 900 } },
    { name: "phone", size: PHONE },
  ]) {
    for (const theme of ["light", "dark"]) {
      test(`the first run says what backups do and offers one way to set them up, on a ${viewport.name}, ${theme}`, async ({
        page,
      }: {
        page: Page;
      }) => {
        await page.setViewportSize(viewport.size);
        await openPage(page, `?scene=first-run&theme=${theme}`);

        const hero: Locator = page.getByTestId("backups-hero");
        await expect(hero).toContainText("Back up OneUptime");
        await expect(hero).toContainText("On a schedule");
        await expect(hero).toContainText("Kept as long as you say");
        await expect(hero).toContainText("Restored safely");
        await expect(page.getByTestId("backups-set-up")).toBeEnabled();
        await expect(page.getByTestId("backups-set-up")).toHaveText(
          "Set up backups",
        );
        // The recommended destinations, in the form's order.
        await expect(
          page.getByTestId("backups-recommended-destinations"),
        ).toContainText(RECOMMENDED.join(""));
        await expect(page.getByTestId("backups-docs")).toContainText(
          "How backups work",
        );
        // Nothing runs, nothing is listed, before backups are set up.
        await expect(page.getByTestId("backups-status")).toHaveCount(0);
        await expect(page.getByText("Restores", { exact: true })).toHaveCount(
          0,
        );

        await expectNoHorizontalScroll(page);
        expect(await isDark(page)).toBe(theme === "dark");
        // On a phone the folded side menu names this page, not "Navigation".
        if (viewport.name === "phone") {
          await expect(page.getByTestId("mobile-sidemenu-toggle")).toHaveText(
            /Backups/,
          );
          await expect(
            page.getByTestId("mobile-sidemenu-toggle"),
          ).not.toContainText("Navigation");
        }
        await screenshot(page, `first-run-${viewport.name}-${theme}`);
      });
    }
  }

  test("setting up: a recommended destination, its own fields, a test before saving, then the schedule", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "?scene=first-run");
    await page.getByTestId("backups-set-up").click();
    await expect(dialog(page)).toContainText("Set up backups");

    // Destination: every recommended destination is a card.
    for (const title of RECOMMENDED) {
      await expect(
        dialog(page).getByRole("radio", { name: title }),
      ).toHaveCount(1);
    }
    await dialog(page).getByTestId("card-select-option-minio").click();
    await dialog(page).getByRole("button", { name: "Next" }).click();

    // Connection: MinIO's fields, its setup guide, and the test.
    await expect(
      dialog(page).getByRole("link", { name: "Setup guide" }),
    ).toHaveAttribute("href", "/docs/installation/backups#minio");
    await expect(
      dialog(page).getByTestId("backup-destination-test-button"),
    ).toBeDisabled();

    await dialog(page)
      .getByLabel("Endpoint")
      .fill("https://minio.acme.internal:9000");
    await dialog(page).getByLabel("Bucket").fill("oneuptime-backups");
    await dialog(page).getByLabel("Access key ID").fill("oneuptime-backup");
    await dialog(page)
      .getByLabel("Secret access key")
      .fill("minio-secret-1234567890");

    await dialog(page).getByTestId("backup-destination-test-button").click();
    const result: Locator = dialog(page).getByTestId("backup-test-result");
    await expect(result).toContainText("Everything a backup needs works.");
    await expect(
      dialog(page).getByTestId("backup-test-check-storage"),
    ).toContainText("OneUptime can write here");
    await expect(
      dialog(page).getByTestId("backup-test-check-postgres"),
    ).toContainText("PostgreSQL can be backed up");
    await expect(
      dialog(page).getByTestId("backup-test-check-clickhouse"),
    ).toContainText("ClickHouse can write here");

    // The test sent the unsaved settings, the secret only among the secrets.
    const tests: Array<RecordedPost> = await postsTo(page, "/backup/test");
    expect(tests).toHaveLength(1);
    expect(tests[0]!.body).toEqual(
      expect.objectContaining({
        destinationType: "s3-compatible",
        destinationProvider: "minio",
        config: expect.objectContaining({
          endpoint: "https://minio.acme.internal:9000",
          bucket: "oneuptime-backups",
          accessKeyId: "oneuptime-backup",
        }),
        secrets: { secretAccessKey: "minio-secret-1234567890" },
      }),
    );
    expect(JSON.stringify(tests[0]!.body!["config"])).not.toContain(
      "minio-secret",
    );

    await dialog(page).getByRole("button", { name: "Next" }).click();

    // Schedule: every day at 02:00 UTC, kept 30 days, ClickHouse too.
    await expect(dialog(page)).toContainText("How often");
    await expect(dialog(page)).toContainText("Every day");
    await expect(dialog(page)).toContainText("02:00 UTC");
    await expect(
      dialog(page).getByLabel("Keep backups for (days)"),
    ).toHaveValue("30");
    await screenshot(page, "set-up-schedule-laptop-light");
    await dialog(page)
      .getByRole("button", { name: "Start backing up" })
      .click();
    await expect(dialog(page)).toHaveCount(0);

    const writes: Array<RecordedWrite> = (await fixtureRecord(page)).writes;
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual(
      expect.objectContaining({ what: "create", table: "BackupSetting" }),
    );
    expect(writes[0]!.data).toEqual(
      expect.objectContaining({
        destinationType: "s3-compatible",
        destinationProvider: "minio",
        frequency: "daily",
        timeOfDay: "02:00",
        retentionInDays: 30,
        includesClickhouse: true,
        isEnabled: true,
      }),
    );
    expect(writes[0]!.data["config"]).toEqual(
      expect.objectContaining({
        endpoint: "https://minio.acme.internal:9000",
        bucket: "oneuptime-backups",
        accessKeyId: "oneuptime-backup",
      }),
    );

    // Set up: the page now says how backups are doing.
    await expect(page.getByTestId("backups-status-title")).toHaveText(
      "Backups are on",
    );
    await expect(page.getByTestId("backups-status-none")).toContainText(
      "No backup yet",
    );
  });

  test("a destination that fails its test says what to change, and nothing is saved", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "?scene=first-run&test=fail");
    await page.getByTestId("backups-set-up").click();
    await dialog(page).getByTestId("card-select-option-minio").click();
    await dialog(page).getByRole("button", { name: "Next" }).click();
    await dialog(page)
      .getByLabel("Endpoint")
      .fill("https://minio.acme.internal:9000");
    await dialog(page).getByLabel("Bucket").fill("oneuptime-backups");
    await dialog(page).getByLabel("Access key ID").fill("oneuptime-backup");
    await dialog(page).getByLabel("Secret access key").fill("minio-secret");
    await dialog(page).getByTestId("backup-destination-test-button").click();

    await expect(dialog(page).getByTestId("backup-test-result")).toContainText(
      "Something a backup needs does not work yet.",
    );
    await expect(
      dialog(page).getByTestId("backup-test-check-clickhouse"),
    ).toContainText("its network must reach minio.acme.internal too");
    expect((await fixtureRecord(page)).writes).toEqual([]);
    await screenshot(page, "set-up-test-failed-laptop-light");
  });

  for (const theme of ["light", "dark"]) {
    test(`backups on: when the last ran, how big it was, when the next runs, and every backup - ${theme}`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openPage(page, `?theme=${theme}`);

      await expect(page.getByTestId("backups-status-title")).toHaveText(
        "Backups are on",
      );
      await expect(page.getByTestId("backups-status-last")).toContainText(
        "Last backup",
      );
      await expect(page.getByTestId("backups-status-next")).toContainText(
        "Next backup",
      );
      await expect(page.getByTestId("backups-back-up-now")).toBeEnabled();
      await expect(
        page.getByTestId("backups-settings-destination"),
      ).toContainText("MinIO");
      await expect(page.getByTestId("backups-settings-schedule")).toContainText(
        "Every day at 02:00 UTC",
      );
      await expect(
        page.getByTestId("backups-settings-retention"),
      ).toContainText("30 days");
      // Each database on its own line, with what it holds.
      await expect(
        page.getByTestId("backups-settings-contents-postgres"),
      ).toContainText("projects, monitors, incidents, users");
      await expect(
        page.getByTestId("backups-settings-contents-clickhouse"),
      ).toContainText("logs, traces, metrics");
      // The status card's ⋯ is the same button as the tables' card headers'.
      const statusMore: Locator = page.getByTestId("backups-status-more");
      const tableMore: Locator = list(page, 0)
        .locator("xpath=ancestor::*[.//*[@data-testid='card-header']][1]")
        .getByTestId("card-header")
        .getByRole("button", { name: "More options" });
      const statusBox: { width: number; height: number } | null =
        await statusMore.boundingBox();
      const tableBox: { width: number; height: number } | null =
        await tableMore.boundingBox();

      expect(statusBox && tableBox).toBeTruthy();
      expect(Math.round(statusBox!.width)).toBe(Math.round(tableBox!.width));
      expect(Math.round(statusBox!.height)).toBe(Math.round(tableBox!.height));

      // Five backups, newest first; the one at a previous destination cannot be restored here.
      await expect(backupRows(page)).toHaveCount(5);
      const rows: Locator = backupRows(page);
      await expect(
        rows.nth(0).getByRole("button", { name: "Restore", exact: true }),
      ).toBeVisible();
      await expect(rows.nth(4)).toContainText("At a previous destination");
      await expect(
        rows.nth(4).getByRole("button", { name: "Restore", exact: true }),
      ).toHaveCount(0);
      // The restore three days ago, in Restores.
      await expect(list(page, 1).getByTestId("backup-run-when")).toHaveCount(1);
      await expect(list(page, 1)).toContainText("Started by hand");

      await expectStatusCardTheme(page);
      await screenshot(page, `on-laptop-${theme}`);

      await page.setViewportSize(PHONE);
      await expect(page.getByTestId("backups-status-title")).toBeVisible();
      await expectNoHorizontalScroll(page);
      await screenshot(page, `on-phone-${theme}`);
    });
  }

  for (const viewport of [
    { name: "laptop", size: { width: 1280, height: 900 } },
    { name: "phone", size: PHONE },
  ]) {
    test(`a backup in progress shows its step, and each step as it runs, on a ${viewport.name}`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize(viewport.size);
      await openPage(page, "?scene=running");

      await expect(page.getByTestId("backups-status-running")).toContainText(
        "Backing up",
      );
      await expect(page.getByTestId("backups-status-step")).toContainText(
        "Step 3 of 5: Back up ClickHouse",
      );
      // A dump's size is only known once it is written: what is written so far.
      await expect(page.getByTestId("backups-status-step")).toContainText(
        "written",
      );
      await expect(page.getByTestId("backups-active-cancel")).toBeVisible();
      // How long it has been going, so a stuck backup shows.
      await expect(page.getByTestId("backups-status-elapsed")).toContainText(
        "Running for 2 minutes",
      );
      // While one runs, no other backup or restore can start.
      await expect(page.getByTestId("backups-back-up-now")).toHaveCount(0);
      await expect(
        backupRows(page).nth(1).getByRole("button", {
          name: "Restore",
          exact: true,
        }),
      ).toHaveCount(0);
      await expectNoHorizontalScroll(page);
      await screenshot(page, `running-${viewport.name}-light`);

      await page.getByTestId("backups-active-view-steps").click();
      await expect(dialog(page)).toBeVisible();
      for (const [key, words] of [
        ["check-destination", "Check the destination"],
        ["back-up-postgres", "Back up PostgreSQL"],
        ["back-up-clickhouse", "Back up ClickHouse"],
        ["verify-backup", "Check the backup"],
        ["delete-old-backups", "Delete old backups"],
      ] as Array<[string, string]>) {
        await expect(
          dialog(page).getByTestId(`backup-run-step-${key}`),
        ).toContainText(words);
      }
      await expect(
        dialog(page).getByTestId("backup-run-step-verify-backup"),
      ).toContainText("Waiting");
      // ClickHouse's step says what it wrote, as the card does: no total it cannot know.
      await expect(
        dialog(page).getByTestId("backup-run-step-back-up-clickhouse"),
      ).not.toContainText(" of ");
      // A column of steps, never wider than 768 pixels.
      const box: { width: number } | null = await dialog(page).boundingBox();
      expect(box!.width).toBeLessThanOrEqual(768);
      await expectNoHorizontalScroll(page);
      await screenshot(page, `running-steps-${viewport.name}-light`);
    });
  }

  for (const theme of ["light", "dark"]) {
    test(`a failed backup says so at the top, with what went wrong, and its steps show where it stopped - ${theme}`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openPage(page, `?scene=failed&theme=${theme}`);

      await expect(page.getByTestId("backups-status-title")).toHaveText(
        "The last backup failed",
      );
      await expect(page.getByTestId("backups-status-failed")).toContainText(
        STORAGE_REFUSED,
      );
      // And the newest backup there still is to go back to.
      await expect(page.getByTestId("backups-status-last")).toContainText(
        "Last good backup",
      );
      // A new backup can be tried at once.
      await expect(page.getByTestId("backups-back-up-now")).toBeEnabled();
      await expect(backupRows(page).nth(0)).toContainText("Failed");
      await expect(backupRows(page).nth(0)).toContainText("Back up PostgreSQL");
      await expectStatusCardTheme(page);
      await screenshot(page, `failed-laptop-${theme}`);

      await page.getByTestId("backups-failed-view-steps").click();
      await expect(
        dialog(page).getByTestId("backup-run-step-message-back-up-postgres"),
      ).toContainText(STORAGE_REFUSED);
      await expectStepLineUnderMark(page, "check-destination");
      await expect(
        dialog(page).getByTestId("backup-run-step-back-up-clickhouse"),
      ).toContainText("Skipped");
      await screenshot(page, `failed-steps-laptop-${theme}`);

      await page.keyboard.press("Escape");
      await page.setViewportSize(PHONE);
      await expectNoHorizontalScroll(page);
      await screenshot(page, `failed-phone-${theme}`);
    });
  }

  test("a restore in progress says what it restores, how far it is, and that OneUptime keeps running until the switch", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "?scene=restoring");

    await expect(page.getByTestId("backups-status-running")).toContainText(
      "Restoring the backup of",
    );
    await expect(page.getByTestId("backups-status-step")).toContainText(
      "Step 3 of 7: Restore PostgreSQL",
    );
    // A restore reads a dump of known size: how far it is, of how much.
    await expect(page.getByTestId("backups-status-step")).toContainText(" of ");
    await expect(page.getByTestId("backups-status-running")).toContainText(
      "OneUptime keeps working on the current data until the switch-over",
    );
    await screenshot(page, "restoring-laptop-light");

    await page.setViewportSize(PHONE);
    await expectNoHorizontalScroll(page);
    await screenshot(page, "restoring-phone-light");
  });

  for (const viewport of [
    { name: "laptop", size: { width: 1280, height: 900 } },
    { name: "phone", size: PHONE },
  ]) {
    for (const theme of ["light", "dark"]) {
      test(`restoring a backup says what it replaces, backs the current data up first, and waits for restore to be typed - ${viewport.name}, ${theme}`, async ({
        page,
      }: {
        page: Page;
      }) => {
        await page.setViewportSize(viewport.size);
        await openPage(page, `?theme=${theme}`);
        const newest: Locator = backupRows(page).nth(0);
        const when: string = (
          await newest
            .getByTestId("backup-run-when")
            .locator("div")
            .first()
            .innerText()
        ).trim();

        await newest
          .getByRole("button", { name: "Restore", exact: true })
          .click();
        await expect(dialog(page)).toContainText(
          `Restore the backup of ${when}?`,
        );
        await expect(dialog(page)).toContainText(
          "Everything changed since this backup is lost.",
        );

        const postgres: Locator = dialog(page).getByTestId(
          "restore-backup-postgres",
        );
        await expect(postgres).toContainText(
          "PostgreSQL: projects, monitors, incidents, users",
        );
        await expect(postgres).toContainText(
          "The backup holds 3 projects, 12 users, 140 monitors, and 2 status pages.",
        );
        await expect(postgres).toContainText(
          "Now: 4 projects, 13 users, 151 monitors, and 2 status pages.",
        );
        await expect(
          dialog(page).getByTestId("restore-backup-clickhouse"),
        ).toContainText("ClickHouse: logs, traces, metrics");
        await expect(
          dialog(page).getByTestId("restore-backup-first-checkbox"),
        ).toBeChecked();

        const restore: Locator = dialog(page).getByTestId(
          "modal-footer-submit-button",
        );
        await expect(restore).toHaveText("Restore");
        await expect(restore).toBeDisabled();

        const confirmation: Locator = dialog(page).getByRole("textbox");
        await confirmation.fill("restor");
        await expect(restore).toBeDisabled();
        await confirmation.fill("restore");
        await expect(restore).toBeEnabled();

        await expectNoHorizontalScroll(page);
        await screenshot(page, `restore-confirm-${viewport.name}-${theme}`);

        // Without a backup first, the dialog says the restore cannot be undone.
        await dialog(page)
          .getByTestId("restore-backup-first-checkbox")
          .uncheck();
        await expect(
          dialog(page).getByTestId("restore-backup-without-backup"),
        ).toContainText("this restore cannot be undone");
        await dialog(page).getByTestId("restore-backup-first-checkbox").check();

        await restore.click();
        await expect(dialog(page)).toHaveCount(0);

        const restores: Array<RecordedPost> = await postsTo(
          page,
          "/backup/restore",
        );
        expect(restores).toHaveLength(1);
        expect(restores[0]!.body).toEqual(
          expect.objectContaining({
            includesPostgres: true,
            includesClickhouse: true,
            takeBackupFirst: true,
            confirmation: "restore",
          }),
        );
        expect(String(restores[0]!.body!["backupRunId"])).toMatch(
          /^[0-9a-f-]{36}$/,
        );
      });
    }
  }

  test("a backup this installation cannot restore keeps Restore locked, and says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "?preview=problem");
    await backupRows(page)
      .nth(0)
      .getByRole("button", { name: "Restore", exact: true })
      .click();

    await expect(
      dialog(page).getByTestId("restore-backup-problems"),
    ).toContainText(
      "A newer version of OneUptime made this backup. Update OneUptime first, then restore it.",
    );
    // Nothing to choose, tick or type, and no Restore: the dialog only closes.
    await expect(dialog(page).getByRole("textbox")).toHaveCount(0);
    await expect(dialog(page).getByRole("checkbox")).toHaveCount(0);
    await expect(
      dialog(page).getByTestId("modal-footer-submit-button"),
    ).toHaveCount(0);
    await expect(
      dialog(page).getByTestId("modal-footer-close-button"),
    ).toHaveText("Close");
    await screenshot(page, "restore-problem-laptop-light");

    await dialog(page).getByTestId("modal-footer-close-button").click();
    await expect(dialog(page)).toHaveCount(0);
    expect(await postsTo(page, "/backup/restore")).toEqual([]);
  });

  test("deleting a backup says what goes, and warns before the newest one that succeeded", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page);
    const newest: Locator = backupRows(page).nth(0);

    await newest.getByTestId("row-actions-more-button").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(dialog(page)).toContainText("Delete the backup of");
    await expect(dialog(page)).toContainText(
      "Its files are deleted from the destination. It cannot be restored afterwards.",
    );
    await expect(page.getByTestId("backups-delete-newest")).toContainText(
      "This is the newest backup that succeeded",
    );
    await screenshot(page, "delete-newest-laptop-light");

    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(dialog(page)).toHaveCount(0);
    expect((await postsTo(page, "/backup/delete")).length).toBe(1);
  });

  test("turning scheduled backups off keeps Back up now, and Turn on brings the schedule back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page);
    await page.getByTestId("backups-status-more").click();
    await page
      .getByRole("menuitem", { name: "Turn off scheduled backups" })
      .click();

    await expect(page.getByTestId("backups-status-title")).toHaveText(
      "Scheduled backups are off",
    );
    await expect(page.getByTestId("backups-turn-on")).toBeVisible();
    await expect(page.getByTestId("backups-back-up-now")).toBeEnabled();
    // Turning the schedule back on is the card's one primary action now.
    const primary: Array<string> = await page
      .getByTestId("backups-status-actions")
      .locator("button")
      .evaluateAll((buttons: Array<Element>): Array<string> => {
        return buttons
          .filter((button: Element): boolean => {
            return (
              getComputedStyle(button).backgroundColor === "rgb(79, 70, 229)"
            );
          })
          .map((button: Element): string => {
            return button.getAttribute("data-testid") || "";
          });
      });
    expect(primary).toEqual(["backups-turn-on"]);
    await expect(page.getByTestId("backups-settings-schedule")).toContainText(
      "· Off",
    );

    const updates: Array<RecordedWrite> = (await fixtureRecord(page)).writes;
    expect(updates).toEqual([
      expect.objectContaining({
        what: "update",
        table: "BackupSetting",
        data: { isEnabled: false },
      }),
    ]);
    await screenshot(page, "off-laptop-light");

    await page.getByTestId("backups-turn-on").click();
    await expect(page.getByTestId("backups-status-title")).toHaveText(
      "Backups are on",
    );
  });

  test("Find backups lists what is at the destination, and says how many it found", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page);
    await page.getByTestId("backups-status-more").click();
    await page.getByRole("menuitem", { name: "Find backups" }).click();

    await expect(page.getByTestId("backups-notice")).toHaveText(
      "Found 5 backups at the destination. Added 1 to the list.",
    );
    expect((await postsTo(page, "/backup/find")).length).toBe(1);
  });

  for (const [license, notice, words] of [
    [
      "lapsed",
      "backups-license-lapsed",
      "Enterprise license required: no new backups are made.",
    ],
    [
      "not-included",
      "backups-license-not-included",
      "Your Enterprise license does not include backups: no new backups are made.",
    ],
  ] as Array<[string, string, string]>) {
    test(`a license that is ${license} pauses new backups, and restoring and deleting still work`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openPage(page, `?license=${license}`);

      await expect(page.getByTestId(notice)).toContainText(words);
      await expect(page.getByTestId("backups-status-title")).toHaveText(
        "New backups are paused",
      );
      await expect(page.getByTestId("backups-back-up-now")).toBeDisabled();
      // The settings wait for a license too.
      await expect(
        page.getByRole("button", { name: "Edit", exact: true }),
      ).toBeDisabled();
      // The installation's own data stays within reach.
      await expect(
        backupRows(page).nth(0).getByRole("button", {
          name: "Restore",
          exact: true,
        }),
      ).toBeEnabled();
      await backupRows(page)
        .nth(0)
        .getByTestId("row-actions-more-button")
        .click();
      await expect(
        page.getByRole("menuitem", { name: "Delete" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await screenshot(page, `${license}-laptop-light`);
    });
  }

  test("the page reads in the reader's language: German on a phone, and Persian right to left", async ({
    page,
  }: {
    page: Page;
  }) => {
    const german: Record<string, string> = adminLocale("de");
    const persian: Record<string, string> = adminLocale("fa");

    await page.setViewportSize(PHONE);
    await openPage(page, "?lang=de");
    await expect(page.getByTestId("backups-status-title")).toHaveText(
      german["Backups are on"] as string,
    );
    await expect(
      backupRows(page)
        .nth(0)
        .getByRole("button", {
          name: german["Restore"] as string,
          exact: true,
        }),
    ).toBeVisible();
    // The tables' own words too: the Admin Dashboard's German, not English.
    await expect(page.getByText("Rows per page", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByText(german["Rows per page"] as string).first(),
    ).toBeVisible();
    await expect(page.getByTestId("mobile-sidemenu-toggle")).toContainText(
      german["Backups"] as string,
    );
    await expectNoHorizontalScroll(page);
    await screenshot(page, "on-phone-german");

    await page.setViewportSize({ width: 1280, height: 900 });
    await openPage(page, "?lang=fa&scene=failed");
    expect(
      await page.evaluate((): string => {
        return document.documentElement.dir;
      }),
    ).toBe("rtl");
    await expect(page.getByTestId("backups-status-title")).toHaveText(
      persian["The last backup failed"] as string,
    );
    /*
     * The storage's address, and the server's own sentence about what went
     * wrong, read left to right: otherwise a trailing slash and a full stop
     * land at the wrong end of the line.
     */
    expect(
      await page
        .getByTestId("backups-settings-location")
        .evaluate((element: Element): string => {
          return getComputedStyle(element).direction;
        }),
    ).toBe("ltr");
    expect(
      await page
        .getByTestId("backups-status-failed")
        .locator("[dir=auto]")
        .evaluate((element: Element): string => {
          return getComputedStyle(element).direction;
        }),
    ).toBe("ltr");
    await expectNoHorizontalScroll(page);
    await screenshot(page, "failed-laptop-persian");

    // Its steps read right to left too, each line under its mark.
    await page.getByTestId("backups-failed-view-steps").click();
    await expect(
      dialog(page).getByTestId("backup-run-step-message-back-up-postgres"),
    ).toContainText(STORAGE_REFUSED);
    await expectStepLineUnderMark(page, "check-destination");
    await expectStepLineUnderMark(page, "back-up-postgres");
    await screenshot(page, "failed-steps-laptop-persian");
  });
});

// The Admin Dashboard's words in a language, keyed by the English text.
function adminLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        `../../App/FeatureSet/AdminDashboard/src/Locales/${language}.json`,
      ),
      "utf8",
    ),
  ) as Record<string, string>;
}

test("the Community Edition's Settings have no Backups page", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto(COMMUNITY_PAGE);
  const menu: Locator = page.getByTestId("community-settings");

  await expect(menu).toBeVisible();
  await expect(
    menu.getByRole("link", { name: "Authentication" }),
  ).toBeVisible();
  await expect(menu.getByRole("link", { name: "Backups" })).toHaveCount(0);
  await expect(page.getByTestId("backups-view")).toHaveCount(0);
});
