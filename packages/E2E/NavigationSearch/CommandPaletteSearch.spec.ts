import { expect, Locator, Page, Route, test } from "@playwright/test";

/*
 * The Dashboard's Search (Cmd/Ctrl+K) in a real browser: the production
 * palette, page index and products catalog, with English translations, on
 * a synthetic project (?palette=true in Fixture.js). Search finds every page
 * the menus link to, says where each lives, and opens it.
 */

const projectPath: string = "/dashboard/00000000-0000-4000-8000-000000000001";

test.beforeEach(async ({ page }: { page: Page }) => {
  // Search's record lookups (monitors, incidents...) find nothing here.
  await page.route(/\/api\//, async (route: Route) => {
    await route.fulfill({ json: { data: [], count: 0, skip: 0, limit: 5 } });
  });
  await page.goto(`${projectPath}/home?palette=true`);
  await expect(page.getByTestId("current-route")).toHaveText(
    `${projectPath}/home`,
  );
});

const openSearch: (page: Page) => Promise<Locator> = async (
  page: Page,
): Promise<Locator> => {
  await page.keyboard.press("ControlOrMeta+k");
  const input: Locator = page.getByRole("combobox", {
    name: "Search pages, actions…",
  });
  await expect(input).toBeFocused();
  return input;
};

const options: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByRole("option");
};

test("'api keys' opens API Keys, shown under Project Settings › Advanced", async ({
  page,
}: {
  page: Page;
}) => {
  const input: Locator = await openSearch(page);
  await input.fill("api keys");

  const first: Locator = options(page).first();
  await expect(first).toContainText("API Keys");
  await expect(first).toContainText("Project Settings");
  await expect(first).toContainText("Advanced");
  await expect(first).toHaveAttribute("aria-selected", "true");

  await input.press("Enter");

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("current-route")).toHaveText(
    `${projectPath}/settings/api-keys`,
  );
});

test("pages that share a name are told apart, and the product's name narrows the search", async ({
  page,
}: {
  page: Page;
}) => {
  const input: Locator = await openSearch(page);
  await input.fill("custom fields");

  const rows: Array<string> = await options(page).allInnerTexts();
  expect(rows.length).toBeGreaterThanOrEqual(7);
  // Every row reads differently: the breadcrumb names its product.
  expect(new Set(rows).size).toBe(rows.length);

  await input.fill("incident custom fields");
  await expect(options(page)).toHaveCount(1);
  await expect(options(page).first()).toContainText("Incidents");

  await input.press("Enter");
  await expect(page.getByTestId("current-route")).toHaveText(
    `${projectPath}/incidents/settings/custom-fields`,
  );
});

test("'on call schedule' and 'rota' find On-Call Schedules", async ({
  page,
}: {
  page: Page;
}) => {
  const input: Locator = await openSearch(page);

  for (const query of ["on call schedule", "rota"]) {
    await input.fill(query);
    await expect(options(page).first()).toContainText("On-Call Schedules");
  }

  await input.press("Enter");
  await expect(page.getByTestId("current-route")).toHaveText(
    `${projectPath}/on-call-duty/schedules`,
  );
});

test("Delete Project is offered only to people allowed to delete the project; the Danger Zone always is", async ({
  page,
}: {
  page: Page;
}) => {
  // This fixture's user holds no permissions.
  const input: Locator = await openSearch(page);
  await input.fill("delete project");

  await expect(options(page).first()).toContainText("Danger Zone");
  await expect(
    options(page).filter({ hasText: /^Delete Project/ }),
  ).toHaveCount(0);
});

test("browsing lists the actions and products, not every page; a page opened from search is a recent", async ({
  page,
}: {
  page: Page;
}) => {
  let input: Locator = await openSearch(page);

  await expect(page.getByRole("group", { name: "Actions" })).toBeVisible();
  // No row is the SSO page (Project Settings' description names SSO).
  await expect(options(page).filter({ hasText: /^SSO/ })).toHaveCount(0);
  await expect(
    options(page).filter({ hasText: /^Project Settings/ }),
  ).toHaveCount(1);

  await input.fill("sso");
  await expect(options(page).first()).toContainText("SSO");
  await input.press("Enter");
  await expect(page.getByTestId("current-route")).toHaveText(
    `${projectPath}/settings/sso`,
  );

  input = await openSearch(page);
  const recent: Locator = page.getByRole("group", { name: "Recent" });
  await expect(recent.getByRole("option").first()).toContainText("SSO");
  await expect(recent.getByRole("option").first()).toContainText(
    "Project Settings",
  );
  await expect(input).toHaveValue("");
});

test("the arrow keys walk the results and Enter opens the one selected", async ({
  page,
}: {
  page: Page;
}) => {
  const input: Locator = await openSearch(page);
  await input.fill("on-call");

  await expect(options(page).first()).toHaveAttribute("aria-selected", "true");
  await input.press("ArrowDown");
  await expect(options(page).nth(1)).toHaveAttribute("aria-selected", "true");

  const second: string = (await options(page).nth(1).innerText()).split(
    "\n",
  )[0]!;
  await input.press("Enter");

  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(second.length).toBeGreaterThan(0);
  await expect(page.getByTestId("current-route")).not.toHaveText(
    `${projectPath}/home`,
  );
});

test("a breadcrumb stays inside the panel, without a sideways scroll", async ({
  page,
}: {
  page: Page;
}) => {
  const input: Locator = await openSearch(page);
  await input.fill("scheduled maintenance settings");
  await expect(options(page).first()).toBeVisible();

  const listbox: Locator = page.getByRole("listbox");
  const box: { x: number; width: number } | null = await listbox.boundingBox();
  expect(box).not.toBeNull();

  const crumbs: Locator = page.locator('[data-testid$="-breadcrumb"]');
  const count: number = await crumbs.count();
  expect(count).toBeGreaterThan(0);

  for (let index: number = 0; index < count; index++) {
    const crumb: { x: number; width: number } | null = await crumbs
      .nth(index)
      .boundingBox();
    expect(crumb).not.toBeNull();
    expect(crumb!.x + crumb!.width).toBeLessThanOrEqual(
      box!.x + box!.width + 1,
    );
  }

  const overflows: boolean = await page.evaluate((): boolean => {
    return (
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth
    );
  });
  expect(overflows).toBe(false);
});
