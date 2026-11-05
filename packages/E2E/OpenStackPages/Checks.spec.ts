import { Locator, Page } from "@playwright/test";
import {
  CLOUD_ID,
  expect,
  fixtureRecord,
  FixtureRecord,
  openCloudPage,
  screenshot,
  test,
  VIEWPORTS,
} from "./Helpers";

/*
 * A cloud's Checks page, in a real browser, over a check's row as a probe's reports leave it
 * (Fixture/Checks.js). What a test with a stand-in cannot show: that turning a check on is one
 * click where it should be, that the form that writes to a cloud says what it creates before it
 * opens, that nothing the page reads goes unanswered, and how a failed run reads on a phone.
 */

interface WriteRequest {
  kind: string;
  modelName: string;
  id?: string;
  data: Record<string, unknown>;
}

async function checkWrites(page: Page): Promise<Array<WriteRequest>> {
  const all: Array<WriteRequest> = await page.evaluate(
    (): Array<WriteRequest> => {
      return (
        window as unknown as {
          __openStackPagesFixture: { writeRequests: Array<WriteRequest> };
        }
      ).__openStackPagesFixture.writeRequests;
    },
  );

  return all.filter((write: WriteRequest): boolean => {
    return write.modelName === "OpenStackCloudCheck";
  });
}

test.describe("with no check on, which is how every cloud starts", () => {
  test("it says what each check does, and the one that writes says what it creates", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "checks", "");

    await expect(page.getByTestId("openstack-api-checks-off")).toContainText(
      "It only reads",
    );

    const statement: Locator = page.getByTestId(
      "openstack-lifecycle-statement",
    );

    await expect(statement).toContainText("creates one small server");
    await expect(statement).toContainText("refuses to run");
    await screenshot(page, "checks-off");

    const record: FixtureRecord = await fixtureRecord(page);

    expect(record.unhandled).toEqual([]);
  });

  test("on a cloud a probe collects, API checks are one click, with no form", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "checks", "collection=Probe");

    await page.getByRole("button", { name: "Turn On API Checks" }).click();

    await expect(
      page.getByTestId("openstack-api-checks-waiting"),
    ).toBeVisible();
    await expect(page.getByTestId("openstack-check-auth-url")).toHaveCount(0);

    const record: FixtureRecord = await fixtureRecord(page);

    expect(record.unhandled).toEqual([]);
  });

  test("on a cloud the agent collects, it asks where Keystone is", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "checks", "");

    await page.getByRole("button", { name: "Turn On API Checks" }).click();

    await expect(page.getByTestId("openstack-check-auth-url")).toBeVisible();
    await screenshot(page, "checks-api-form");
  });

  test("the lifecycle form says what it creates, and asks for a project of its own", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "checks", "collection=Probe");

    await page
      .getByRole("button", { name: "Turn On the Lifecycle Check" })
      .click();

    await expect(page.getByRole("dialog")).toContainText(
      "creates one small server",
    );
    await expect(page.getByTestId("openstack-lifecycle-project")).toBeVisible();
    await expect(
      page.getByTestId("openstack-lifecycle-option-floating-ip"),
    ).toBeVisible();
    await expect(
      page.getByTestId("openstack-lifecycle-option-volume"),
    ).toBeVisible();
    await screenshot(page, "checks-lifecycle-form");
  });

  test("the lifecycle form saves what it was told, for this cloud, and turns it on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "checks", "collection=Probe");

    await page
      .getByRole("button", { name: "Turn On the Lifecycle Check" })
      .click();
    await page
      .getByTestId("openstack-lifecycle-project")
      .fill("oneuptime-checks");
    await page
      .getByTestId("openstack-check-application-credential-id")
      .fill("the-checks-credential");
    await page
      .getByTestId("openstack-check-credential-secret")
      .fill("the-checks-secret");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Turn On the Lifecycle Check" })
      .click();

    await expect
      .poll(async () => {
        return (await checkWrites(page)).length;
      })
      .toBe(1);

    const write: WriteRequest = (await checkWrites(page))[0]!;

    expect(write.kind).toBe("create");
    expect(write.data).toMatchObject({
      isLifecycleCheckEnabled: true,
      lifecycleProjectName: "oneuptime-checks",
      applicationCredentialId: "the-checks-credential",
    });
    expect(String(write.data["openStackCloudId"])).toContain(CLOUD_ID);
    // Nothing of the other kind of credential travels with it.
    expect(write.data["keystoneUsername"]).toBeUndefined();

    await expect(page.getByTestId("openstack-lifecycle-waiting")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("a refusal from the server stays on the form, in its words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "checks", "collection=Probe");

    await page.evaluate(() => {
      (
        window as unknown as {
          __openStackPagesRefuseNextWrite: (message: string) => void;
        }
      ).__openStackPagesRefuseNextWrite(
        "Project admin is the cloud's own. The lifecycle check only runs in a project it has to itself: create one with its own quota.",
      );
    });

    await page
      .getByRole("button", { name: "Turn On the Lifecycle Check" })
      .click();
    await page.getByTestId("openstack-lifecycle-project").fill("admin");
    await page
      .getByTestId("openstack-check-application-credential-id")
      .fill("the-checks-credential");
    await page
      .getByTestId("openstack-check-credential-secret")
      .fill("the-checks-secret");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Turn On the Lifecycle Check" })
      .click();

    await expect(page.getByRole("dialog")).toContainText(
      "a project it has to itself",
    );
  });
});

test.describe("with the checks on", () => {
  test("a good run has each step's duration, and a trace", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "checks", "checks=on");

    await expect(page.getByTestId("openstack-lifecycle-region")).toContainText(
      "Every step passed",
    );
    await expect(
      page.getByTestId("openstack-lifecycle-step-server_active"),
    ).toContainText("48.2 s");
    await expect(page.getByTestId("openstack-api-checks-token")).toContainText(
      "Keystone issued a token",
    );
    await expect(
      page
        .getByTestId("openstack-api-checks-certificates")
        .locator("li")
        .first(),
    ).toContainText("5 days left");
    await screenshot(page, "checks-on");

    const record: FixtureRecord = await fixtureRecord(page);

    expect(record.unhandled).toEqual([]);
  });

  test("a failed run names the step and Nova's fault, and fits a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "checks", "checks=failed");

    await expect(
      page.getByTestId("openstack-lifecycle-failed-step"),
    ).toContainText("Wait for ACTIVE");
    await expect(page.getByTestId("openstack-lifecycle-fault")).toContainText(
      "Nova said (500): No valid host was found.",
    );

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });

      const overflow: number = await page.evaluate(() => {
        return (
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
        );
      });

      expect(overflow, `${viewport.width} wide`).toBeLessThanOrEqual(1);
      await screenshot(page, `checks-failed-${viewport.width}`);
    }
  });

  test("a refused run says why, and nothing about the cloud", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "checks", "checks=refused");

    await expect(page.getByTestId("openstack-lifecycle-attempt")).toContainText(
      "Nothing was written.",
    );
    await expect(
      page.getByTestId("openstack-lifecycle-failed-step"),
    ).toHaveCount(0);
  });

  test("turned off, it says a probe is still clearing up", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "checks", "checks=sweeping");

    await expect(
      page.getByTestId("openstack-lifecycle-sweeping"),
    ).toContainText("clearing up");
  });

  test("Run Now asks for a run, and Turn Off asks first", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "checks", "checks=on");

    await page.getByRole("button", { name: "Run Now" }).click();

    await expect
      .poll(async () => {
        return await page.evaluate(() => {
          return JSON.stringify(
            (
              window as unknown as {
                __openStackPagesFixture: { writeRequests: Array<unknown> };
              }
            ).__openStackPagesFixture.writeRequests,
          );
        });
      })
      .toContain("lifecycleRunRequestedAt");

    // The second card's: the first is the API checks'.
    await page.getByRole("button", { name: "Turn Off" }).nth(1).click();

    await expect(page.getByRole("dialog")).toContainText("Turn Off");
    await expect(page.getByRole("dialog")).toContainText(
      "clears up anything named for this check",
    );
  });
});
