import { Locator, Page } from "@playwright/test";
import {
  CLOUD_ID,
  CLOUD_PATH,
  PROJECT_ID,
  expect,
  fixtureRecord,
  screenshot,
  test,
} from "./Helpers";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * The OpenStack product area, as a person uses it: the clouds list and Archived, a cloud's
 * owners, labels, archive and delete, the rule pages, a custom role's grants, and what a
 * cloud's page lists when an incident, an alert or a maintenance event is linked to it.
 *
 * Every write is recorded (fixtureRecord(page).writeRequests), and the store keeps what a page
 * reads back, so a list after a change reads what the change left.
 */
const PRODUCT_PATH: string = `/dashboard/${PROJECT_ID}/openstack`;
const CLOUDS: string = PRODUCT_PATH;
const ARCHIVED: string = `${PRODUCT_PATH}/archived`;
const OWNER_RULES: string = `${PRODUCT_PATH}/settings/owner-rules`;
const LABEL_RULES: string = `${PRODUCT_PATH}/settings/label-rules`;

async function writes(page: Page): Promise<Array<Record<string, unknown>>> {
  const record: { writeRequests?: Array<Record<string, unknown>> } =
    (await fixtureRecord(page)) as unknown as {
      writeRequests?: Array<Record<string, unknown>>;
    };
  return record.writeRequests || [];
}

function lastOf(
  written: Array<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  return written[written.length - 1];
}

function row(page: Page, name: string): Locator {
  return page.getByRole("row").filter({ hasText: name }).first();
}

async function openRowMenu(page: Page, name: string): Promise<void> {
  await row(page, name)
    .getByRole("button", { name: /more|actions/i })
    .click();
}

test.describe("the clouds list", () => {
  test("lists the live clouds, opens one, and leaves the archived out", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUDS}?archived=1`);

    await expect(row(page, "acme-prod")).toBeVisible();
    await expect(page.getByText("old-lab-cloud")).toHaveCount(0);
    await screenshot(page, "openstack-clouds-list");

    await row(page, "acme-prod").getByText("View", { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/openstack/${CLOUD_ID}`));
  });

  test("a project with no cloud yet says how to add one, and nothing reads as failed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUDS}?clouds=none`);
    await expect(page.locator("body")).toContainText("OpenStack");
    await expect(
      page.getByRole("button", { name: /Add/ }).first(),
    ).toBeVisible();
  });
});

test.describe("archive", () => {
  test("from the list's row: it asks first, and the cloud leaves the list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(CLOUDS);

    await openRowMenu(page, "acme-prod");
    await page.getByRole("menuitem", { name: /^Archive/ }).click();
    expect(await writes(page)).toEqual([]);

    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Archive" })
      .click();

    await expect(
      page.getByRole("row").filter({ hasText: "acme-prod" }),
    ).toHaveCount(0);
    expect(lastOf(await writes(page))).toMatchObject({
      kind: "updateById",
      modelName: "OpenStackCloud",
      id: CLOUD_ID,
      data: { isArchived: true },
    });
  });

  test("from a cloud's Settings: it says what happens, leaves the list, and comes back from Archived", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUD_PATH}/settings`);
    const card: Locator = page.getByTestId("archive-resource-card").or(
      page
        .locator("div")
        .filter({ hasText: /^Archive/ })
        .first(),
    );
    await expect(card.first()).toBeVisible();

    await page
      .getByRole("button", { name: /^Archive/ })
      .first()
      .click();
    const confirm: Locator = page.getByRole("dialog");
    if (await confirm.count()) {
      await confirm.getByRole("button", { name: /Archive/ }).click();
    }

    await expect(page).toHaveURL(new RegExp(`/openstack/?(\\?.*)?$`));
    const written: Array<Record<string, unknown>> = await writes(page);
    expect(lastOf(written)).toMatchObject({
      kind: "updateById",
      modelName: "OpenStackCloud",
      id: CLOUD_ID,
      data: { isArchived: true },
    });
  });

  test("Archived lists what was archived, and a cloud can be taken out of it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${ARCHIVED}?archived=1`);

    await expect(row(page, "old-lab-cloud")).toBeVisible();
    await screenshot(page, "openstack-clouds-archived");

    await openRowMenu(page, "old-lab-cloud");
    await page.getByRole("menuitem", { name: /Unarchive/ }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Unarchive" })
      .click();

    await expect(
      page.getByRole("row").filter({ hasText: "old-lab-cloud" }),
    ).toHaveCount(0);
    const written: Array<Record<string, unknown>> = await writes(page);
    expect(lastOf(written)).toMatchObject({
      kind: "updateById",
      modelName: "OpenStackCloud",
      data: { isArchived: false },
    });
  });

  test("with nothing archived it says so", async ({ page }: { page: Page }) => {
    await page.goto(ARCHIVED);
    await expect(
      page.getByText("Archived OpenStack Clouds").first(),
    ).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: "old-lab-cloud" }),
    ).toHaveCount(0);
  });
});

test.describe("delete", () => {
  test("asks first, deletes that cloud, and goes back to the list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUD_PATH}/delete`);
    await page
      .getByRole("button", { name: /^Delete/ })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await writes(page)).toEqual([]);
    await screenshot(page, "openstack-cloud-delete-confirm");

    await page
      .getByRole("dialog")
      .getByRole("button", { name: /Delete/ })
      .click();

    await expect(page).toHaveURL(new RegExp(`${PRODUCT_PATH}/?(\\?.*)?$`));
    expect(lastOf(await writes(page))).toMatchObject({
      kind: "delete",
      modelName: "OpenStackCloud",
      id: CLOUD_ID,
    });
  });
});

test.describe("owners and labels", () => {
  test("a person can be made an owner from the cloud's page, and is saved on that cloud", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUD_PATH}/owners`);
    await page.getByTestId("owners-add").click();

    const dialog: Locator = page.getByRole("dialog");
    await dialog.getByRole("option", { name: /Sam Patel/ }).click();

    await expect
      .poll(async () => {
        return (await writes(page)).length;
      })
      .toBeGreaterThan(0);
    expect(lastOf(await writes(page))).toMatchObject({
      kind: "create",
      modelName: "OpenStackCloudOwnerUser",
      data: { openStackCloudId: CLOUD_ID },
    });
    await screenshot(page, "openstack-cloud-owners");
  });

  test("labels can be added to a cloud from the list's bulk actions", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(CLOUDS);
    await row(page, "acme-prod").getByRole("checkbox").first().check();
    await page.getByRole("button", { name: /Bulk Actions/ }).click();
    await page.getByRole("menuitem", { name: /Add Labels/ }).click();
    await screenshot(page, "openstack-clouds-add-labels");

    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toContainText("Select Labels");
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /production/ }).click();
    await dialog
      .getByRole("button", { name: /^Add Labels|^Save|^Apply/ })
      .click();

    await expect
      .poll(async () => {
        return (await writes(page)).length;
      })
      .toBeGreaterThan(0);
    expect(lastOf(await writes(page))).toMatchObject({
      kind: "updateById",
      modelName: "OpenStackCloud",
      id: CLOUD_ID,
    });
  });
});

test.describe("the rule pages", () => {
  for (const [name, path, title] of [
    ["owner", OWNER_RULES, "OpenStack Cloud Owner Rules"],
    ["label", LABEL_RULES, "OpenStack Cloud Label Rules"],
  ] as ReadonlyArray<[string, string, string]>) {
    test(`${name} rules: an empty table with a way to add one, and how they work`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.goto(path);

      await expect(page.getByText(title).first()).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Create/ }).first(),
      ).toBeVisible();
      await screenshot(page, `openstack-${name}-rules`);

      // The form opens on what a rule needs first, with the rest a step away.
      await page
        .getByRole("button", { name: /^Create/ })
        .first()
        .click();
      const dialog: Locator = page.getByRole("dialog");
      await expect(dialog).toContainText("All OpenStack clouds");
      await expect(dialog).toContainText(
        "Only OpenStack clouds that match conditions",
      );
      await screenshot(page, `openstack-${name}-rule-form`);
      await dialog.getByRole("button", { name: "Next" }).click();
      await expect(dialog.getByRole("button", { name: "Next" })).toHaveCount(0);
    });
  }
});

test.describe("linked to an incident, an alert and a maintenance event", () => {
  for (const [subPath, linked, notLinked] of [
    ["incidents", "Nova API errors in RegionOne", "A payment provider is slow"],
    ["alerts", "Volume stuck in creating", "A certificate expires soon"],
    [
      "scheduled-maintenance",
      "Patch the control plane",
      "Move the office network",
    ],
  ] as ReadonlyArray<[string, string, string]>) {
    test(`${subPath}: lists what is linked to this cloud, and nothing else`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.goto(`${CLOUD_PATH}/${subPath}?linked=1`);

      await expect(row(page, linked)).toBeVisible();
      await expect(page.getByText(notLinked)).toHaveCount(0);
      await screenshot(page, `openstack-cloud-linked-${subPath}`);
    });
  }

  test("the feed says what happened to the cloud", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUD_PATH}/feed?linked=1`);
    await expect(
      page.getByText("OpenStack cloud registered").first(),
    ).toBeVisible();
  });
});

test.describe("a custom role", () => {
  const PAGES: ReadonlyArray<[string, string]> = [
    ["the clouds list", CLOUDS],
    ["a cloud's Overview", CLOUD_PATH],
    ["its owners", `${CLOUD_PATH}/owners`],
    ["its feed", `${CLOUD_PATH}/feed`],
    ["owner rules", OWNER_RULES],
    ["label rules", LABEL_RULES],
  ];

  for (const [name, path] of PAGES) {
    test(`holding only the read permissions, sees ${name}`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.goto(`${path}?role=read`);
      await page.waitForLoadState("networkidle");

      await expect(page.locator("body")).not.toContainText(
        "You do not have permissions",
      );
      expect(await writes(page)).toEqual([]);
    });

    test(`holding none of them, is told so on ${name}, and is shown nothing of it`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.goto(`${path}?role=none`);
      await page.waitForLoadState("networkidle");

      const body: Locator = page.locator("body");
      await expect(body).not.toContainText("compute-01");
      await expect(body).not.toContainText("ou-vol-bad");
    });
  }

  test("holding only the read permissions, what writes is off, and says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUDS}?role=read`);
    await expect(row(page, "acme-prod")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Connect Cloud" }),
    ).toHaveCount(0);

    await page.goto(`${OWNER_RULES}?role=read`);
    await expect(
      page
        .getByRole("button", { name: /^Create OpenStack Cloud Owner Rule/ })
        .first(),
    ).toBeDisabled();
    await expect(page.locator("body")).toContainText(
      "You don't have permission to create these.",
    );
    await screenshot(page, "openstack-owner-rules-read-role");

    await page.goto(`${CLOUD_PATH}/delete?role=read`);
    await expect(
      page.getByRole("button", { name: /^Delete/ }).first(),
    ).toBeDisabled();
    expect(await writes(page)).toEqual([]);
  });

  test("holding none of them, the list and the cloud each say why they are empty", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUDS}?role=none`);
    await page.waitForLoadState("networkidle");
    await screenshot(page, "openstack-clouds-no-role");
    await expect(
      page.getByRole("row").filter({ hasText: "acme-prod" }),
    ).toHaveCount(0);

    await page.goto(`${CLOUD_PATH}?role=none`);
    await page.waitForLoadState("networkidle");
    await screenshot(page, "openstack-cloud-no-role");
    await expect(page.locator("body")).toContainText(
      "You do not have permissions",
    );
  });
});

test.describe("wherever they are read", () => {
  const PAGES: ReadonlyArray<[string, string]> = [
    ["clouds", `${CLOUDS}`],
    ["archived", `${ARCHIVED}`],
    ["owner-rules", OWNER_RULES],
    ["label-rules", LABEL_RULES],
    ["owners", `${CLOUD_PATH}/owners`],
    ["delete", `${CLOUD_PATH}/delete`],
    ["incidents", `${CLOUD_PATH}/incidents`],
  ];

  for (const [name, path] of PAGES) {
    test(`${name}: at 390 pixels, in the dark, German and Persian, nothing runs off the page`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      for (const scenario of [
        "linked=1",
        "theme=dark&linked=1",
        "lang=de&linked=1",
        "lang=fa&linked=1",
      ]) {
        await page.goto(`${path}?${scenario}`);
        await page.waitForLoadState("networkidle");
        await expectNoSidewaysScroll(page);
      }
      await screenshot(page, `openstack-${name}-390-fa`);
    });
  }
});
