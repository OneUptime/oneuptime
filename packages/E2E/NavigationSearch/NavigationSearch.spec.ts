import { expect, Locator, Page, test } from "@playwright/test";

const projectPath: string = "/dashboard/00000000-0000-4000-8000-000000000001";

test.beforeEach(async ({ page }: { page: Page }) => {
  await page.goto(`${projectPath}/home`);
  await expect(page.getByRole("dialog", { name: "Products menu" })).toHaveCount(
    1,
  );
  await expect(
    page.getByRole("combobox", { name: "Search products" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Search products" }),
  ).toBeFocused();
});

for (const example of [
  {
    query: "RUM",
    label: "uppercase acronym",
    title: "Real User Monitoring",
    route: "rum",
  },
  {
    query: "  rUm  ",
    label: "padded mixed-case acronym",
    title: "Real User Monitoring",
    route: "rum",
  },
  {
    query: "k8s",
    label: "abbreviation",
    title: "Kubernetes",
    route: "kubernetes",
  },
  {
    query: "  K8S  ",
    label: "padded uppercase abbreviation",
    title: "Kubernetes",
    route: "kubernetes",
  },
]) {
  test(`finds ${example.title} with ${example.label}`, async ({
    page,
  }: {
    page: Page;
  }) => {
    const search: Locator = page.getByRole("combobox", {
      name: "Search products",
    });
    await search.fill(example.query);
    await expect(page.getByRole("option")).toHaveCount(1);
    await expect(page.getByRole("option")).toContainText(example.title);
    await expect(
      page.getByRole("link", { name: new RegExp(example.title) }),
    ).toHaveAttribute("href", `${projectPath}/${example.route}`);
    await expect(search).toBeFocused();
  });
}

test("opens an acronym result with Enter and records it as a recent product", async ({
  page,
}: {
  page: Page;
}) => {
  const search: Locator = page.getByRole("combobox", {
    name: "Search products",
  });
  await search.fill("RUM");
  await expect(page.getByRole("option", { selected: true })).toContainText(
    "Real User Monitoring",
  );
  await search.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(`${projectPath}/rum`);
  await expect(page.getByTestId("current-route")).toHaveText(
    `${projectPath}/rum`,
  );

  await page.goto(`${projectPath}/home`);
  await expect(
    page.getByRole("heading", { name: "Recent", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("option").first()).toContainText(
    "Real User Monitoring",
  );
  await page.getByRole("combobox").fill("RUM");
  await expect(
    page.getByRole("heading", { name: "Recent", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("option")).toHaveCount(1);
});

test("opens a Kubernetes abbreviation result by clicking its actual link", async ({
  page,
}: {
  page: Page;
}) => {
  await page.getByRole("combobox").fill("k8s");
  await page.getByRole("link", { name: /Kubernetes/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(`${projectPath}/kubernetes`);
  await expect(page.getByTestId("current-route")).toHaveText(
    `${projectPath}/kubernetes`,
  );
});

test("keeps title and description searches and restores every product when cleared", async ({
  page,
}: {
  page: Page;
}) => {
  const search: Locator = page.getByRole("combobox");
  const productCount: number = await page.getByRole("option").count();
  expect(productCount).toBeGreaterThan(20);
  await search.fill("Kubernetes");
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option")).toContainText("Kubernetes");
  await search.fill("error budgets");
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option")).toContainText("SLOs");
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(page.getByRole("option")).toHaveCount(productCount);
});

test("does not navigate for an unmatched query and recovers when a matching alias is typed", async ({
  page,
}: {
  page: Page;
}) => {
  const search: Locator = page.getByRole("combobox");
  await search.fill("no-such-product-938471");
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(
    page.getByText("No results found.", { exact: true }),
  ).toBeVisible();
  await search.press("Enter");
  await expect(page).toHaveURL(`${projectPath}/home`);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await search.fill("k8s");
  await expect(page.getByRole("option", { selected: true })).toContainText(
    "Kubernetes",
  );
  await search.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Open products" }).click();
  await expect(page.getByRole("combobox")).toHaveValue("");
});
