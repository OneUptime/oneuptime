import { BrowserContext, Locator, Page, expect, test } from "@playwright/test";

/*
 * Two projects open in two tabs never swap each other's role (#5306's
 * follow-up).
 *
 * Every tab of one browser shares the Dashboard's localStorage. The
 * signed-in person's permission snapshot of "the current project" was kept
 * there under one name for every project, so a person who is Project Owner
 * of one project and Viewer of another, with both open side by side, saw
 * each tab follow whichever tab's answer came back last: the Viewer's tab
 * offered Delete Project and Create Label, the Owner's locked them, until
 * the tab's own next answer came back.
 *
 * The fixture (Fixture/server.js) serves the Dashboard's real Labels and
 * Danger Zone pages, whose requests go through the Dashboard's own API
 * client to the fixture server, which answers with the permission headers
 * as OneUptime's API does and can hold a project's answers on request.
 * Nothing between the pages and the wire is replaced.
 */

const OWNED: FixtureProject = {
  id: "8f100000-0000-4000-8000-000000000001",
  name: "Acme Production",
};

const VIEWED: FixtureProject = {
  id: "8f200000-0000-4000-8000-000000000001",
  name: "Beta Staging",
};

const NEW: FixtureProject = {
  id: "8f300000-0000-4000-8000-000000000001",
  name: "Gamma Sandbox",
};

interface FixtureProject {
  id: string;
  name: string;
}

interface RecordedRequest {
  method: string;
  route: string;
  tenantId: string;
  projectHash: string;
  globalHash: string;
  projectHashMatched: boolean;
  sentProjectSnapshot: boolean;
}

interface Recorded {
  requests: Array<RecordedRequest>;
  unexpected: Array<string>;
  hashes: Record<string, string>;
}

const CREATE_LABEL_REASON: string =
  "You do not have permission to create this Label.";

const DELETE_PROJECT_REASON: string =
  "You do not have permission to delete this Project.";

// Each tab as the person sees it, for a reviewer to look at.
const SCREENSHOTS: string = "../../output/playwright/permissions-per-tab-ui";

type FixtureCallFunction = (page: Page, path: string) => Promise<Recorded>;

const fixtureCall: FixtureCallFunction = async (
  page: Page,
  path: string,
): Promise<Recorded> => {
  const response: Awaited<ReturnType<Page["request"]["post"]>> =
    await page.request.post(path);
  expect(response.ok()).toBe(true);
  return (await response.json()) as Recorded;
};

type RecordedFunction = (page: Page) => Promise<Recorded>;

const recorded: RecordedFunction = async (page: Page): Promise<Recorded> => {
  return (await (
    await page.request.get("/__fixture/requests")
  ).json()) as Recorded;
};

type HoldFunction = (page: Page, project: FixtureProject) => Promise<void>;

// The fixture holds every answer about the project until it is released.
const hold: HoldFunction = async (
  page: Page,
  project: FixtureProject,
): Promise<void> => {
  await fixtureCall(page, `/__fixture/hold?project=${project.id}`);
};

const release: HoldFunction = async (
  page: Page,
  project: FixtureProject,
): Promise<void> => {
  await fixtureCall(page, `/__fixture/release?project=${project.id}`);
};

type OpenFunction = (
  context: BrowserContext,
  project: FixtureProject,
  pageName: "labels" | "danger-zone",
) => Promise<Page>;

// A new tab of the same browser, on a page of the project.
const openTab: OpenFunction = async (
  context: BrowserContext,
  project: FixtureProject,
  pageName: "labels" | "danger-zone",
): Promise<Page> => {
  const page: Page = await context.newPage();
  await page.goto(`/dashboard/${project.id}/settings/${pageName}`);
  await expect(page.getByTestId("tab-project")).toHaveText(project.name);
  return page;
};

type ButtonFunction = (page: Page) => Locator;

const createLabel: ButtonFunction = (page: Page): Locator => {
  return page.getByRole("button", { name: "Create Label", exact: true });
};

const deleteProject: ButtonFunction = (page: Page): Locator => {
  return page.getByRole("button", { name: "Delete Project", exact: true });
};

type ExpectLockedFunction = (
  page: Page,
  button: Locator,
  reason: string,
) => Promise<void>;

/*
 * Locked, saying why: the button is disabled, and pointing at it shows the
 * reason (a locked button's reason is on the element that wraps it).
 */
const expectLocked: ExpectLockedFunction = async (
  page: Page,
  button: Locator,
  reason: string,
): Promise<void> => {
  await expect(button).toBeDisabled();

  const box: { x: number; y: number; width: number; height: number } | null =
    await button.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(page.getByText(reason).first()).toBeVisible();
  await page.mouse.move(0, 0);
};

// The label list has drawn its rows: the tab's own project's answer has come back.
const expectLabelsOf: (page: Page, label: string) => Promise<void> = async (
  page: Page,
  label: string,
): Promise<void> => {
  await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
};

type GoFunction = (page: Page, testId: string) => Promise<void>;

// Moves inside the app, as the Settings side menu does: no reload.
const goInApp: GoFunction = async (
  page: Page,
  testId: string,
): Promise<void> => {
  await page.getByTestId(testId).click();
};

test.beforeEach(async ({ page }: { page: Page }) => {
  await fixtureCall(page, "/__fixture/reset");
});

test.afterEach(async ({ page }: { page: Page }) => {
  // Every request a page made is one the fixture models.
  const afterTest: Recorded = await recorded(page);

  // Nothing held outlives a test.
  await fixtureCall(page, "/__fixture/reset");

  expect(afterTest.unexpected).toEqual([]);
});

test.describe("two projects open in two tabs", () => {
  test("each tab offers what the person's role in its own project allows, after the other tab's answers came back", async ({
    context,
    page,
  }: {
    context: BrowserContext;
    page: Page;
  }) => {
    // The person's tab on the project they own.
    const ownedTab: Page = await openTab(context, OWNED, "labels");
    await expectLabelsOf(ownedTab, "payments");
    await expect(createLabel(ownedTab)).toBeEnabled();

    // A second tab, on the project they only view.
    const viewedTab: Page = await openTab(context, VIEWED, "labels");
    await expectLabelsOf(viewedTab, "staging-only");
    await expectLocked(viewedTab, createLabel(viewedTab), CREATE_LABEL_REASON);

    // The Owner's tab reads its labels again: its answers come back last.
    await ownedTab.bringToFront();
    await goInApp(ownedTab, "go-danger-zone");
    await expect(deleteProject(ownedTab)).toBeEnabled();
    await goInApp(ownedTab, "go-labels");
    await expectLabelsOf(ownedTab, "payments");
    await expect(createLabel(ownedTab)).toBeEnabled();

    /*
     * Back in the Viewer's tab, its Danger Zone - a page that asks the
     * server nothing on its way in - still locks Delete Project.
     */
    await viewedTab.bringToFront();
    await goInApp(viewedTab, "go-danger-zone");
    await expect(viewedTab.getByTestId("tab-project")).toHaveText(VIEWED.name);
    await expectLocked(
      viewedTab,
      deleteProject(viewedTab),
      DELETE_PROJECT_REASON,
    );

    // And its labels, drawn while its own answer is still on its way, lock Create Label.
    await hold(page, VIEWED);
    await goInApp(viewedTab, "go-labels");
    await expect(createLabel(viewedTab)).toBeDisabled();
    await expect(createLabel(viewedTab)).toBeVisible();
    await release(page, VIEWED);
    await expectLabelsOf(viewedTab, "staging-only");
    await expectLocked(viewedTab, createLabel(viewedTab), CREATE_LABEL_REASON);

    // The Owner's tab, drawn while its own answer is held, still offers Create Label.
    await ownedTab.bringToFront();
    await hold(page, OWNED);
    await goInApp(ownedTab, "go-danger-zone");
    await expect(deleteProject(ownedTab)).toBeEnabled();
    await goInApp(ownedTab, "go-labels");
    await expect(createLabel(ownedTab)).toBeEnabled();
    await release(page, OWNED);
    await expectLabelsOf(ownedTab, "payments");
    await expect(createLabel(ownedTab)).toBeEnabled();

    await ownedTab.screenshot({
      path: `${SCREENSHOTS}/owned-project-tab.png`,
      fullPage: true,
    });
    await viewedTab.screenshot({
      path: `${SCREENSHOTS}/viewed-project-tab.png`,
      fullPage: true,
    });
  });

  test("each tab's requests tell the server the snapshot of their own project, so it is sent once", async ({
    context,
    page,
  }: {
    context: BrowserContext;
    page: Page;
  }) => {
    const ownedTab: Page = await openTab(context, OWNED, "labels");
    await expectLabelsOf(ownedTab, "payments");
    const viewedTab: Page = await openTab(context, VIEWED, "labels");
    await expectLabelsOf(viewedTab, "staging-only");

    // Each tab reads again, one after the other, twice.
    for (let round: number = 0; round < 2; round++) {
      for (const [tab, label] of [
        [ownedTab, "payments"],
        [viewedTab, "staging-only"],
      ] as Array<[Page, string]>) {
        await tab.bringToFront();
        await goInApp(tab, "go-danger-zone");
        await expect(deleteProject(tab)).toBeVisible();
        await goInApp(tab, "go-labels");
        await expectLabelsOf(tab, label);
      }
    }

    const sent: Recorded = await recorded(page);
    const labelReads: Array<RecordedRequest> = sent.requests.filter(
      (request: RecordedRequest): boolean => {
        return request.route === "label/get-list";
      },
    );

    // Every read names the project of the tab that made it.
    expect(
      labelReads.map((request: RecordedRequest): string => {
        return request.tenantId;
      }),
    ).toEqual([OWNED.id, VIEWED.id, OWNED.id, VIEWED.id, OWNED.id, VIEWED.id]);

    // After each project's first answer, its tab sends that project's own hash.
    for (const request of labelReads.slice(2)) {
      expect([request.tenantId, request.projectHash]).toEqual([
        request.tenantId,
        sent.hashes[request.tenantId],
      ]);
      expect(request.projectHashMatched).toBe(true);
    }

    // So the server sent each project's snapshot only with its first answers.
    const snapshotsSentAfterTheFirst: Array<RecordedRequest> = sent.requests
      .filter((request: RecordedRequest): boolean => {
        return request.projectHash !== "";
      })
      .filter((request: RecordedRequest): boolean => {
        return request.sentProjectSnapshot;
      });

    expect(snapshotsSentAfterTheFirst).toEqual([]);
  });
});

test.describe("one tab moving from project to project", () => {
  test("shows the new project's role at once, never the previous project's", async ({
    context,
    page,
  }: {
    context: BrowserContext;
    page: Page;
  }) => {
    // Earlier, the person opened the project they own.
    const earlier: Page = await openTab(context, OWNED, "labels");
    await expectLabelsOf(earlier, "payments");
    await earlier.close();

    // Now a tab on the project they view.
    const tab: Page = await openTab(context, VIEWED, "labels");
    await expectLabelsOf(tab, "staging-only");
    await expectLocked(tab, createLabel(tab), CREATE_LABEL_REASON);

    /*
     * The project picker takes the tab to the owned project's Danger Zone
     * (a page that asks the server nothing on its way in): Delete Project is
     * offered at once, as the person's role there allows.
     */
    await hold(page, OWNED);
    await tab.goto(`/dashboard/${OWNED.id}/settings/danger-zone`);
    await expect(tab.getByTestId("tab-project")).toHaveText(OWNED.name);
    await expect(deleteProject(tab)).toBeEnabled();
    await release(page, OWNED);
  });

  test("a project this browser has not opened yet offers nothing until its own answer says what the person may do", async ({
    context,
    page,
  }: {
    context: BrowserContext;
    page: Page;
  }) => {
    const tab: Page = await openTab(context, OWNED, "labels");
    await expectLabelsOf(tab, "payments");
    await expect(createLabel(tab)).toBeEnabled();

    // To a project the person only views, which this browser has never opened.
    await hold(page, NEW);
    await tab.goto(`/dashboard/${NEW.id}/settings/labels`);
    await expect(tab.getByTestId("tab-project")).toHaveText(NEW.name);

    // Not the Owner's Create Label of the project before: nothing to offer yet.
    await expect(createLabel(tab)).toBeDisabled();

    await release(page, NEW);
    await expectLabelsOf(tab, "experiments");
    await expectLocked(tab, createLabel(tab), CREATE_LABEL_REASON);
  });

  test("a snapshot the version before kept under the one shared name is never read", async ({
    context,
    page,
  }: {
    context: BrowserContext;
    page: Page;
  }) => {
    const tab: Page = await openTab(context, OWNED, "labels");
    await expectLabelsOf(tab, "payments");

    /*
     * What a tab still running the version before leaves: the owned
     * project's snapshot - the person is its Project Owner - under the one
     * name every project shared, as that version wrote it.
     */
    const oldSnapshot: string = JSON.stringify({
      _type: "UserTenantAccessPermission",
      projectId: { _type: "ObjectID", value: OWNED.id },
      permissions: ["CurrentUser", "ProjectUser", "ProjectOwner"].map(
        (permission: string) => {
          return {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          };
        },
      ),
    });

    await tab.evaluate((kept: string) => {
      window.localStorage.setItem("project_permissions", kept);
      window.localStorage.setItem("project-permissions-hash", "old-shared");
    }, oldSnapshot);

    // The person opens the project they view, in a tab of the new version.
    await hold(page, VIEWED);
    const viewedTab: Page = await openTab(context, VIEWED, "danger-zone");
    await expect(deleteProject(viewedTab)).toBeDisabled();
    await release(page, VIEWED);

    await goInApp(viewedTab, "go-labels");
    await expectLabelsOf(viewedTab, "staging-only");
    await expectLocked(viewedTab, createLabel(viewedTab), CREATE_LABEL_REASON);

    // Its requests never sent the shared hash, and the shared names are left as they were.
    const sent: Recorded = await recorded(page);
    expect(
      sent.requests.filter((request: RecordedRequest): boolean => {
        return request.projectHash === "old-shared";
      }),
    ).toEqual([]);
    expect(
      await viewedTab.evaluate(() => {
        return [
          window.localStorage.getItem("project_permissions"),
          window.localStorage.getItem("project-permissions-hash"),
        ];
      }),
    ).toEqual([oldSnapshot, "old-shared"]);
  });
});
