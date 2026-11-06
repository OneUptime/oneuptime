import { Download, Locator, Page } from "@playwright/test";
import fsPromises from "fs/promises";
import {
  CLOUD_ID,
  CLOUD_PATH,
  FixtureRecord,
  VIEWPORTS,
  expect,
  fixtureRecord,
  openCloudPage,
  screenshot,
  test,
} from "./Helpers";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * Who's using what, and what could be reclaimed: the Spend page and the Recommendations page, in a
 * real browser. On a recording, what a real cloud's exporter answered goes through the real scan
 * and the same sums the worker runs. Its hours are made up, because a recording is one moment.
 */

const BILLING_WORDS: RegExp =
  /\b(invoice|invoiced|invoices|amount due|payment due|bill to|statement of account)\b/i;

interface WriteRequest {
  kind: string;
  modelName: string;
  data?: Record<string, unknown>;
}

async function writesOf(page: Page): Promise<Array<WriteRequest>> {
  return await page.evaluate((): Array<WriteRequest> => {
    return (
      window as unknown as {
        __openStackPagesFixture: { writeRequests: Array<WriteRequest> };
      }
    ).__openStackPagesFixture.writeRequests;
  });
}

test.describe("usage with no prices", () => {
  test("says what was used, says no prices are set, and never a price of nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "spend", "recording=hibiscus-ovn/healthy");

    const strip: Locator = page.getByTestId("openstack-spend-strip");

    await expect(strip).toContainText("vCPU-Hours This Month");
    await expect(strip).toContainText("Memory GB-Hours This Month");
    await expect(strip).toContainText("Could Be Reclaimed");
    await expect(
      page.locator(
        '[data-testid="openstack-spend-source"] [data-source="usage-only"]',
      ),
    ).toBeVisible();
    await expect(page.getByTestId("openstack-spend-source")).toContainText(
      "A price of zero means no price, not that something is free.",
    );
    // No money anywhere: a tile, a table or a sum.
    await expect(strip).not.toContainText("$");
    await expect(strip).not.toContainText("€");

    // The estate's real projects, by what the real exporter said they hold.
    await expect(
      page.getByTestId("openstack-spend-project").first(),
    ).toBeVisible();

    await screenshot(page, "spend-usage-only");
  });

  test("a list of zeros is usage only, and doesn't read as a free cloud", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "spend",
      "recording=hibiscus-ovn/healthy&spend=zero",
    );

    await expect(
      page.locator(
        '[data-testid="openstack-spend-source"] [data-source="usage-only"]',
      ),
    ).toBeVisible();
    await expect(page.getByTestId("openstack-spend-strip")).not.toContainText(
      "0.00",
    );
  });

  test("a cloud no worker has read yet says so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "spend",
      "recording=hibiscus-ovn/healthy&spend=none",
    );

    await expect(page.getByTestId("openstack-spend-not-yet")).toContainText(
      "every quarter of an hour",
    );
  });
});

test.describe("with prices", () => {
  test("says estimate, compares with last month, and names its growers", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "spend",
      "recording=hibiscus-ovn/healthy&spend=priced",
    );

    const strip: Locator = page.getByTestId("openstack-spend-strip");

    await expect(strip).toContainText("This Month So Far");
    await expect(strip).toContainText("On Course For");
    await expect(strip).toContainText("Last Month");
    await expect(strip).toContainText("€");
    await expect(strip).toContainText("Up 10% on the same days last month");
    await expect(
      page.locator(
        '[data-testid="openstack-spend-source"] [data-source="price-list"]',
      ),
    ).toBeVisible();
    await expect(page.getByTestId("openstack-spend-source")).toContainText(
      "doesn't invoice anyone",
    );
    await expect(
      page.getByTestId("openstack-spend-grower").first(),
    ).toBeVisible();

    await screenshot(page, "spend-priced");
  });

  test("a price for part of it says what's left out, and a total isn't called all of it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "spend",
      "recording=hibiscus-ovn/healthy&spend=partial",
    );

    await expect(
      page.getByTestId("openstack-spend-partly-priced"),
    ).toContainText("no price set");
  });

  test("hours nobody was reading are said, not guessed at", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "spend",
      "recording=hibiscus-ovn/healthy&spend=gap",
    );

    await expect(page.getByTestId("openstack-spend-coverage")).toContainText(
      "42 hours",
    );
  });

  test("exports every project's lines, each with its own unit and estimate", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "spend",
      "recording=hibiscus-ovn/healthy&spend=priced",
    );

    const download: Promise<Download> = page.waitForEvent("download");
    await page.getByTestId("openstack-spend-export").click();
    const file: string | null = await (await download).path();
    const csv: string = await fsPromises.readFile(file as string, "utf8");

    expect(csv).toContain("Estimated cost (EUR)");
    expect(csv).toContain("vCPU-hours");
    expect(csv).toContain("IP-hours");
    expect(csv).not.toMatch(BILLING_WORDS);
  });

  test("a project's own page shows what it used", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "spend",
      "recording=hibiscus-ovn/healthy&spend=priced",
    );
    await page
      .getByTestId("openstack-spend-project")
      .first()
      .getByRole("link")
      .click();

    await expect(page.getByTestId("openstack-project-usage")).toContainText(
      "not a bill",
    );
    await expect(
      page.getByTestId("openstack-project-usage-line").first(),
    ).toBeVisible();
    await expect(page.getByTestId("openstack-project-usage-month")).toHaveCount(
      1,
    );
  });
});

test.describe("with CloudKitty", () => {
  test("says it's CloudKitty's where it rated, and the page says which it read", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "spend",
      "recording=hibiscus-ovn/healthy&spend=cloudkitty",
    );

    await expect(
      page.locator(
        '[data-testid="openstack-spend-source"] [data-source="cloudkitty"]',
      ),
    ).toBeVisible();
    await expect(page.getByTestId("openstack-spend-strip")).toContainText(
      "321.50",
    );
    // CloudKitty names no currency, so no sign nobody chose.
    await expect(page.getByTestId("openstack-spend-strip")).not.toContainText(
      "$",
    );
    await expect(
      page.getByTestId("openstack-spend-project-this-month").first(),
    ).toContainText("CloudKitty");
  });
});

test.describe("setting prices", () => {
  test("saves what's typed, and an empty price is no price", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "spend", "recording=hibiscus-ovn/healthy");

    await page.getByTestId("openstack-spend-prices").click();
    await page.getByLabel("Per vCPU, per hour").fill("0.02");
    await page.getByRole("button", { name: "Save prices" }).click();

    await expect(page.getByRole("dialog")).toBeHidden();

    const write: WriteRequest | undefined = (await writesOf(page)).find(
      (entry: WriteRequest): boolean => {
        return entry.modelName === "OpenStackCloud";
      },
    );

    expect(write?.data).toMatchObject({
      priceList: {
        currency: "USD",
        vcpuHour: 0.02,
        memoryGbHour: 0,
        floatingIpHour: 0,
      },
    });
  });

  test("something that isn't a number is said before it's saved", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "spend", "recording=hibiscus-ovn/healthy");

    await page.getByTestId("openstack-spend-prices").click();
    await page.getByLabel("Per vCPU, per hour").fill("cheap");
    await page.getByRole("button", { name: "Save prices" }).click();

    await expect(page.getByText("Write a price as a number")).toBeVisible();

    expect(await writesOf(page)).toEqual([]);
  });
});

test.describe("budgets", () => {
  test("a new budget offers this cloud's projects, and belongs to this cloud", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "spend",
      "recording=hibiscus-ovn/healthy&spend=priced",
    );

    const budgets: Locator = page.getByTestId("openstack-budgets");

    await expect(budgets).toContainText("No budgets yet");
    await budgets
      .getByRole("button", { name: "Create OpenStack Budget" })
      .first()
      .click();
    const dialog: Locator = page.getByRole("dialog");

    await dialog.getByLabel("Name", { exact: true }).fill("Payments team");
    await dialog.getByLabel("Monthly Amount", { exact: true }).fill("500");
    await screenshot(page, "spend-budget-form");
    await dialog.getByRole("button", { name: "Next", exact: true }).click();

    // 80% and 100% are already there, as on any budget.
    await expect(dialog.getByLabel("Alert At", { exact: true })).toHaveValue(
      "80,100",
    );
    await dialog.getByTestId("modal-footer-submit-button").click();
    await expect(dialog).toBeHidden();

    const write: WriteRequest | undefined = (await writesOf(page)).find(
      (entry: WriteRequest): boolean => {
        return entry.modelName === "OpenStackBudget";
      },
    );

    expect(write?.kind).toBe("create");
    expect(write?.data).toMatchObject({
      name: "Payments team",
      alertThresholds: "80,100",
    });
    expect(
      String((write?.data as Record<string, unknown>)["openStackCloudId"]),
    ).toBe(CLOUD_ID);

    // A budget nobody's checked yet says so, and doesn't call itself within budget.
    await expect(page.getByTestId("openstack-budget-status")).toContainText(
      "Not checked yet",
    );
  });
});

test.describe("what could be reclaimed", () => {
  function rule(page: Page, id: string): Locator {
    return page.locator(
      `[data-testid="openstack-waste-rule"][data-rule="${id}"]`,
    );
  }

  test("finds what's been left on a real cloud, and nothing that's in use", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "recommendations",
      "recording=hibiscus-ovn/healthy&waste=old&spend=priced",
    );

    const volumes: Locator = rule(page, "unattached-volume");
    await expect(volumes).toHaveAttribute("data-count", "1");
    await expect(volumes.getByTestId("openstack-waste-frees")).toContainText(
      "1 GB of storage",
    );
    await expect(volumes.getByTestId("openstack-waste-command")).toHaveText(
      "openstack volume list --all-projects --status available --long",
    );
    await volumes.getByTestId("openstack-waste-toggle").click();
    await expect(
      volumes.locator(
        '[data-testid="openstack-waste-item"][data-item="ou-vol-free"]',
      ),
    ).toBeVisible();
    await expect(volumes).not.toContainText("ou-vol-used");
    await expect(volumes).not.toContainText("ou-vol-bad");

    const instances: Locator = rule(page, "shut-off-instance");
    await expect(instances).toHaveAttribute("data-count", "1");
    await instances.getByTestId("openstack-waste-toggle").click();
    await expect(
      instances.locator(
        '[data-testid="openstack-waste-item"][data-item="ou-stopped"]',
      ),
    ).toBeVisible();
    await expect(instances).not.toContainText("ou-running");
    await expect(instances).not.toContainText("ou-failed");

    await expect(rule(page, "spare-floating-ip")).toHaveAttribute(
      "data-count",
      "1",
    );
    await expect(rule(page, "movable-host")).toHaveAttribute("data-count", "0");

    await screenshot(page, "spend-recommendations");
  });

  test("the agent can't say what's in use, so it names no image, and says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "recommendations",
      "recording=hibiscus-ovn/healthy&waste=old",
    );

    await expect(
      rule(page, "unused-image").getByTestId("openstack-waste-cannot-tell"),
    ).toContainText("an image in use would look unused");
    await expect(
      rule(page, "old-snapshot").getByTestId("openstack-waste-cannot-tell"),
    ).toContainText("not which or how old");
  });

  test("on the day it's connected nothing's old yet", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "recommendations",
      "recording=hibiscus-ovn/healthy",
    );

    await expect(rule(page, "unattached-volume")).toHaveAttribute(
      "data-count",
      "0",
    );
    await expect(
      rule(page, "unattached-volume").getByTestId("openstack-waste-nothing"),
    ).toBeVisible();
  });

  test("a cloud not read yet shows the monitors as it always did", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "recommendations",
      "recording=hibiscus-ovn/healthy&spend=none",
    );

    await expect(page.getByTestId("openstack-waste")).toHaveCount(0);
  });
});

test.describe("what the page reads, and how it looks", () => {
  test("one row of the cloud and one page of projects, however large it is", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "spend",
      "recording=hibiscus-ovn/healthy&spend=priced",
    );
    await expect(
      page.getByTestId("openstack-spend-project").first(),
    ).toBeVisible();

    const record: FixtureRecord = await fixtureRecord(page);
    const usageReads: FixtureRecord["listRequests"] =
      record.listRequests.filter(
        (entry: FixtureRecord["listRequests"][number]): boolean => {
          return entry.modelName === "OpenStackProjectUsage";
        },
      );

    // Every project's row is one page of a list. The budget form's choice of project is the other.
    for (const entry of usageReads) {
      expect(entry.limit).toBeLessThanOrEqual(1000);
    }

    // And nothing goes through every instance's row: that's the worker's, once a quarter of an hour.
    expect(
      record.listRequests.filter(
        (entry: FixtureRecord["listRequests"][number]): boolean => {
          return (
            entry.modelName === "OpenStackResource" &&
            entry.query?.["kind"] === "Instance"
          );
        },
      ),
    ).toEqual([]);
  });

  test("no word on it reads as an invoice", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const query of ["spend=priced", "spend=cloudkitty", ""]) {
      await openCloudPage(
        page,
        "spend",
        `recording=hibiscus-ovn/healthy&${query}`,
      );
      await expect(page.getByTestId("openstack-spend-strip")).toBeVisible();
      const text: string = await page.locator("body").innerText();
      expect(text.replace("doesn't invoice anyone", "")).not.toMatch(
        BILLING_WORDS,
      );
    }
  });

  for (const viewport of VIEWPORTS) {
    test(`reads at ${viewport.width} wide, with no sideways scroll`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await openCloudPage(
        page,
        "spend",
        "recording=hibiscus-ovn/healthy&spend=priced",
      );
      await expect(page.getByTestId("openstack-spend-strip")).toBeVisible();

      await expectNoSidewaysScroll(page, { tolerance: 1 });
      await screenshot(page, `spend-${viewport.width}`);
    });
  }

  test("its place in the side menu leads here", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "", "recording=hibiscus-ovn/healthy");
    await page.getByRole("link", { name: "Spend", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${CLOUD_PATH}/spend`));
  });
});
