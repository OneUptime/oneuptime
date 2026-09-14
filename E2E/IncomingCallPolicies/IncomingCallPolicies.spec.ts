import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Renders the real Incoming Call Policies page against the offline fixture.
 *
 * The page's Phone Numbers column does not read from the rows it is given: it
 * fires a second request for the policies' attached numbers and folds each
 * policy's legacy scalar number back in. That makes the cell the place where
 * a policy with a working number can be mislabelled "Setup Needed", so most
 * of these tests pin that cell through the request's three outcomes (answered,
 * still in flight, failed) and through the table's own search and filters.
 */

const PORT: string = "4214";

const ROUTE: string =
  "/dashboard/10000000-0000-4000-8000-000000000001/on-call-duty/incoming-call-policies";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../output/playwright/incoming-call-policies",
);

const POLICY_IDS: Record<string, string> = {
  production: "30000000-0000-4000-8000-000000000001",
  billing: "30000000-0000-4000-8000-000000000002",
  night: "30000000-0000-4000-8000-000000000003",
  sandbox: "30000000-0000-4000-8000-000000000004",
};

interface RecordedListRequest {
  tableName: string;
  query: Record<string, unknown>;
  skip: number;
  limit: number;
}

interface RecordedCreate {
  name: string;
  description: string | null;
}

const pageErrors: Map<Page, Array<string>> = new Map();

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: false,
    animations: "disabled",
  });
}

function row(page: Page, name: string): Locator {
  return page.locator("tbody tr").filter({ hasText: name });
}

async function listRequests(
  page: Page,
  tableName: string,
): Promise<Array<RecordedListRequest>> {
  const requests: Array<RecordedListRequest> = await page.evaluate(
    (): Array<RecordedListRequest> => {
      return (
        window as unknown as {
          __fixture: { listRequests: Array<RecordedListRequest> };
        }
      ).__fixture.listRequests;
    },
  );
  return requests.filter((request: RecordedListRequest): boolean => {
    return request.tableName === tableName;
  });
}

/*
 * The ids the page asked for attached numbers for, in the order it asked. The
 * fixture records the query as JSON, where an ObjectID inside Includes is
 * `{ _type: "ObjectID", value }`.
 */
async function lastPhoneNumberRequestPolicyIds(
  page: Page,
): Promise<Array<string>> {
  const requests: Array<RecordedListRequest> = await listRequests(
    page,
    "IncomingCallPolicyPhoneNumber",
  );
  const last: RecordedListRequest | undefined = requests[requests.length - 1];
  const includes: { value?: Array<{ value: string } | string> } = (last?.query[
    "incomingCallPolicyId"
  ] || {}) as { value?: Array<{ value: string } | string> };
  return (includes.value || []).map(
    (id: { value: string } | string): string => {
      return typeof id === "string" ? id : id.value;
    },
  );
}

async function openPage(page: Page, search: string = ""): Promise<void> {
  await page.goto(`${ROUTE}${search}`);
  await expect(
    page.getByText("Incoming Call Policies", { exact: true }).last(),
  ).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(4);
}

async function expectRows(page: Page, names: Array<string>): Promise<void> {
  await expect(page.locator("tbody tr")).toHaveCount(names.length);
  for (const name of names) {
    await expect(row(page, name)).toHaveCount(1);
  }
}

test.beforeEach(async ({ page }: { page: Page }) => {
  pageErrors.set(page, []);
  page.on("pageerror", (error: Error): void => {
    pageErrors.get(page)!.push(error.message);
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

test.afterEach(({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
});

test("the phone numbers cell reports every shape a policy's numbers can take", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);

  const production: Locator = row(page, "Production Support Hotline");
  const billing: Locator = row(page, "Billing Escalations");
  const night: Locator = row(page, "EU Night Desk");
  const sandbox: Locator = row(page, "Sandbox Line");

  // Three attached numbers: the earliest purchase first, the rest counted.
  await expect(production).toContainText("+14155550101");
  await expect(production).toContainText("+2 more");
  await expect(production).not.toContainText("+14155550102");

  /*
   * Only the legacy scalar number, nothing attached. It is still a working
   * number, so it must not be reported as needing setup.
   */
  await expect(billing).toContainText("+14155550199");
  await expect(billing).not.toContainText("more");
  await expect(billing).not.toContainText("Setup Needed");

  // A legacy number that was already copied across is shown once, not twice.
  await expect(night).toContainText("+442071234567");
  await expect(night).not.toContainText("more");

  await expect(sandbox).toContainText("Setup Needed");

  // The Status pills and labels come from the rows themselves.
  await expect(production).toContainText("Enabled");
  await expect(billing).toContainText("Disabled");
  await expect(production).toContainText("Production");
  await expect(billing).toContainText("Finance");

  /*
   * One attachment request, scoped to exactly the policies on screen — not a
   * project-wide scan.
   */
  expect((await lastPhoneNumberRequestPolicyIds(page)).sort()).toEqual(
    Object.values(POLICY_IDS).sort(),
  );

  await screenshot(page, "incoming-call-policies-table-synthetic");
});

test("a legacy number stays visible while attached numbers are still loading", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page, "?phoneNumbers=hold");

  await expect
    .poll(async () => {
      return (await listRequests(page, "IncomingCallPolicyPhoneNumber")).length;
    })
    .toBeGreaterThan(0);

  const production: Locator = row(page, "Production Support Hotline");
  const billing: Locator = row(page, "Billing Escalations");
  const sandbox: Locator = row(page, "Sandbox Line");

  // A row with a legacy number has something true to show already.
  await expect(billing).toContainText("+14155550199");
  await expect(row(page, "EU Night Desk")).toContainText("+442071234567");

  // A row without one says it is loading, not that it needs setup.
  await expect(production).toContainText("Loading…");
  await expect(sandbox).toContainText("Loading…");
  await expect(page.getByText("Setup Needed")).toHaveCount(0);

  await page.evaluate((): void => {
    (
      window as unknown as { __fixture: { releasePhoneNumbers: () => void } }
    ).__fixture.releasePhoneNumbers();
  });

  await expect(production).toContainText("+2 more");
  await expect(sandbox).toContainText("Setup Needed");
  await expect(page.getByText("Loading…")).toHaveCount(0);
});

test("a failed phone number request degrades to Unavailable, keeping legacy numbers", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page, "?phoneNumbers=fail");

  const production: Locator = row(page, "Production Support Hotline");
  const sandbox: Locator = row(page, "Sandbox Line");

  await expect(production).toContainText("Unavailable");
  await expect(sandbox).toContainText("Unavailable");

  // The friendly error is on the cell, so hovering it explains the outage.
  await expect(
    production.getByText("Unavailable", { exact: true }),
  ).toHaveAttribute("title", "Phone number service is unreachable");

  /*
   * "Unavailable" is not "Setup Needed": a failed lookup must never tell
   * someone to buy a number they already have.
   */
  await expect(page.getByText("Setup Needed")).toHaveCount(0);
  await expect(row(page, "Billing Escalations")).toContainText("+14155550199");
  await expect(row(page, "EU Night Desk")).toContainText("+442071234567");

  await screenshot(page, "incoming-call-policies-unavailable-synthetic");
});

test("the Enabled filter narrows the table and the phone number lookup with it", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);

  await page.getByRole("button", { name: "Enabled", exact: true }).click();
  await page.getByRole("option", { name: "Disabled", exact: true }).click();

  await expectRows(page, ["Billing Escalations", "Sandbox Line"]);

  // The facet reached the query as a real boolean, not as the string "false".
  const policyRequests: Array<RecordedListRequest> = await listRequests(
    page,
    "IncomingCallPolicy",
  );
  expect(policyRequests[policyRequests.length - 1]!.query["isEnabled"]).toBe(
    false,
  );

  // The attachment lookup follows the rows that are actually shown.
  await expect
    .poll(async () => {
      return (await lastPhoneNumberRequestPolicyIds(page)).sort();
    })
    .toEqual([POLICY_IDS["billing"], POLICY_IDS["sandbox"]].sort());

  await expect(row(page, "Billing Escalations")).toContainText("+14155550199");
  await expect(row(page, "Sandbox Line")).toContainText("Setup Needed");

  await screenshot(page, "incoming-call-policies-disabled-filter-synthetic");
});

test("search matches a policy by name or by description", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);

  // The search box starts collapsed behind a button, the way "/" opens it.
  await page.getByRole("button", { name: "Open search" }).click();
  const search: Locator = page.getByRole("textbox", {
    name: "Search incoming call policies by name, description…",
  });

  await search.fill("night desk");
  await expectRows(page, ["EU Night Desk"]);
  await expect(row(page, "EU Night Desk")).toContainText("+442071234567");

  const policyRequests: Array<RecordedListRequest> = await listRequests(
    page,
    "IncomingCallPolicy",
  );
  expect(
    policyRequests[policyRequests.length - 1]!.query["_multiFieldSearch"],
  ).toMatchObject({ fields: ["name", "description"], value: "night desk" });

  // "payment" appears only in Billing Escalations' description.
  await search.fill("payment");
  await expectRows(page, ["Billing Escalations"]);

  await search.fill("");
  await expect(page.locator("tbody tr")).toHaveCount(4);
});

test("the create form validates the name, then adds the policy to the table", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page);

  await page
    .getByRole("button", { name: "Create Incoming Call Policy" })
    .first()
    .click();

  const dialog: Locator = page.getByRole("dialog");
  await expect(dialog).toContainText("Create New Incoming Call Policy");

  const name: Locator = dialog.getByPlaceholder(
    "e.g., Production Support Hotline",
  );
  const next: Locator = dialog.getByRole("button", {
    name: "Next",
    exact: true,
  });

  // Empty name: required.
  await next.click();
  await expect(dialog.getByText("Name is required.")).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "Labels (Optional)" }),
  ).toHaveCount(0);

  // One character: below the page's minLength of 2.
  await name.fill("A");
  await next.click();
  await expect(
    dialog.getByText("Name cannot be less than 2 characters."),
  ).toBeVisible();

  await screenshot(page, "incoming-call-policy-create-validation-synthetic");

  await name.fill("Status Page Callback Line");
  await dialog
    .getByPlaceholder("Description of this incoming call policy")
    .fill("Customers calling from the status page");
  await next.click();

  // Step two is Labels, and it is optional: the form can be submitted.
  await expect(dialog.getByText("Name is required.")).toHaveCount(0);
  await expect(
    dialog.getByRole("combobox", { name: "Labels (Optional)" }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Create Incoming Call Policy", exact: true })
    .click();

  await expect(page.getByRole("dialog")).toHaveCount(0);

  const created: Array<RecordedCreate> = await page.evaluate(
    (): Array<RecordedCreate> => {
      return (
        window as unknown as { __fixture: { created: Array<RecordedCreate> } }
      ).__fixture.created;
    },
  );
  expect(created).toEqual([
    {
      name: "Status Page Callback Line",
      description: "Customers calling from the status page",
    },
  ]);

  // The table refetched, and a brand new policy has no number yet.
  await expect(page.locator("tbody tr")).toHaveCount(5);
  await expect(row(page, "Status Page Callback Line")).toContainText(
    "Setup Needed",
  );
});
