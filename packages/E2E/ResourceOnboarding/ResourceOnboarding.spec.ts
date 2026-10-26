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
 * Adding a resource the way a host is added, in a real browser: the real
 * Kubernetes, IoT, Serverless, RUM, Databases and Queues layouts and list
 * pages against the offline fixture (Fixture/Fixture.js). Only the data
 * boundary and the signed-in user are synthetic.
 *
 * A list's Add button opens its setup guide in a dialog. An empty list shows
 * no guide: under its table is the showcase, what the product gives, with
 * the same Add button. The guide names the resource with a name the project
 * has not used, writes what is typed into the commands (made safe for them,
 * and says so), warns about a name the project already has, and its last
 * step says when the resource connected - and the showcase gives way to the
 * new row. A database, a queue or a RUM application is added with its form,
 * and its prefilled guide then opens on its own. On a desktop, on a phone,
 * in the dark theme and in German.
 *
 * Every test puts up a network fence that aborts anything leaving the
 * fixture server, and fails on an uncaught page error, on a request the
 * fixture does not model and on any request the fence had to abort.
 */

// The fixture server's port, as the config and server.js read it.
const PORT: string = process.env["RESOURCE_ONBOARDING_FIXTURE_PORT"] || "4479";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const KUBERNETES: string = `/dashboard/${PROJECT_ID}/kubernetes`;
const IOT: string = `/dashboard/${PROJECT_ID}/iot`;
const SERVERLESS: string = `/dashboard/${PROJECT_ID}/serverless`;
const RUM: string = `/dashboard/${PROJECT_ID}/rum`;
const DATABASES: string = `/dashboard/${PROJECT_ID}/databases`;
const QUEUES: string = `/dashboard/${PROJECT_ID}/queues`;

// RESOURCE_CONNECTION_POLL_INTERVAL_MS: how often the last step looks.
const WATCH_MS: number = 5_000;
// FIRST_RECORD_POLL_INTERVAL_MS: how often an empty list looks.
const FIRST_RECORD_MS: number = 10_000;
// RESOURCE_NAME_LOOKUP_DELAY_MS: how long typing rests before a lookup.
const LOOKUP_MS: number = 400;

// The project's Server key, which every command carries.
const SERVER_KEY: string = "acme-server-key-0123456789";
const BROWSER_KEY: string = "acme-browser-key-9876543210";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/resource-onboarding-ui",
);

// The Dashboard's German strings, keyed by their English text.
const GERMAN_LOCALE: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/Dashboard/src/Locales/de.json",
);

interface FixtureState {
  creates: Array<{ modelName: string; data: Record<string, unknown> }>;
  unhandled: Array<Record<string, unknown>>;
}

const pageErrors: Map<Page, Array<string>> = new Map();
const abortedRequests: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const aborted: Array<string> = [];
  pageErrors.set(page, errors);
  abortedRequests.set(page, aborted);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing may leave the fixture server.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }
    aborted.push(route.request().url());
    await route.abort();
  });

  // The page's timers run on a clock the test moves on.
  await page.clock.install();
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    abortedRequests.get(page) || [],
    "requests that left the fixture server",
  ).toEqual([]);

  const hasFixture: boolean = await page
    .evaluate((): boolean => {
      return Boolean(
        (window as unknown as { __resourceOnboardingFixture?: unknown })
          .__resourceOnboardingFixture,
      );
    })
    .catch((): boolean => {
      return false;
    });
  if (hasFixture) {
    expect(
      (await fixture(page)).unhandled,
      "requests the fixture does not model",
    ).toEqual([]);
  }
});

/*
 * ---------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------
 */

async function open(
  page: Page,
  address: string,
  query: string = "",
): Promise<void> {
  await page.goto(`${address}${query ? `?${query}` : ""}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect(page.getByTestId("card").first()).toBeVisible();
}

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __resourceOnboardingFixture: unknown })
          .__resourceOnboardingFixture,
      ),
    ) as FixtureState;
  });
}

type FixtureCall = "arrive" | "report" | "engineMetrics" | "queueData";

// An agent, a database's agent or a queue's apps report.
async function call(
  page: Page,
  method: FixtureCall,
  ...args: Array<string>
): Promise<void> {
  await page.evaluate(
    (data: { method: string; args: Array<string> }): void => {
      const target: Record<string, (...values: Array<string>) => void> = (
        window as unknown as {
          __resourceOnboardingFixture: Record<
            string,
            (...values: Array<string>) => void
          >;
        }
      ).__resourceOnboardingFixture;
      target[data.method]!(...data.args);
    },
    { method, args },
  );
}

function tableCard(page: Page): Locator {
  return page.getByTestId("card").first();
}

function headerButton(page: Page, name: string): Locator {
  return tableCard(page)
    .getByTestId("card-header-actions")
    .getByRole("button", { name, exact: true });
}

function nameInput(scope: Page | Locator): Locator {
  return scope.getByTestId("resource-name-input");
}

// The empty table: "No X yet" and what the list is for.
function emptyTable(page: Page): Locator {
  return page.locator('[data-empty-state-kind="empty"]');
}

// What an empty list shows under its table: the product, and its Add button.
function showcase(page: Page): Locator {
  return page.getByTestId("resource-showcase");
}

function showcaseButton(page: Page): Locator {
  return showcase(page).getByTestId("resource-showcase-add-button");
}

// Whether `lower` is drawn below `upper` on the page.
async function isBelow(upper: Locator, lower: Locator): Promise<boolean> {
  const top: { y: number; height: number } | null = await upper.boundingBox();
  const bottom: { y: number } | null = await lower.boundingBox();
  return Boolean(top && bottom && bottom.y >= top.y + top.height - 1);
}

/*
 * A new project's list: the empty table, and under it the showcase with
 * this title. No guide on the page until Add opens one.
 */
async function expectShowcase(page: Page, title: string): Promise<void> {
  await expect(emptyTable(page)).toBeVisible();
  await expect(showcase(page).getByRole("heading", { level: 2 })).toHaveText(
    title,
  );
  expect(await isBelow(emptyTable(page), showcase(page))).toBe(true);
  await expect(page.getByTestId("setup-guide")).toHaveCount(0);
}

/*
 * The showcase's button, named as the list's header names it, opens the
 * list's Add dialog with the guide in it.
 */
async function openAddDialog(page: Page, addTitle: string): Promise<Locator> {
  await expect(showcaseButton(page)).toHaveText(addTitle);
  await showcaseButton(page).click();
  const dialog: Locator = page.getByTestId("add-resource-modal");
  await expect(dialog.getByTestId("setup-guide")).toBeVisible();
  await expect(
    page
      .getByTestId("modal")
      .filter({ has: dialog })
      .getByTestId("modal-title"),
  ).toHaveText(addTitle);
  return dialog;
}

// What the guide's commands say, as a reader copies them.
async function commands(scope: Locator): Promise<string> {
  return (await scope.locator("pre").allInnerTexts()).join("\n");
}

async function typeName(
  page: Page,
  scope: Locator,
  name: string,
): Promise<void> {
  await nameInput(scope).fill(name);
  await page.clock.runFor(LOOKUP_MS + 1);
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: false,
  });
}

// Whether the page scrolls sideways: it must not, at any width.
async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate((): boolean => {
    return (
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1
    );
  });
}

/*
 * ---------------------------------------------------------------------------
 * Kubernetes
 * ---------------------------------------------------------------------------
 */

test("a new project's Kubernetes list: the showcase's Add Kubernetes Cluster opens the guide, which names the cluster, writes the name into helm, and sees it connect", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, KUBERNETES);

  await expectShowcase(page, "See every cluster, node and pod in one place");

  // No form: the list's one way in is Add, in the header and on the showcase.
  await expect(headerButton(page, "Add Kubernetes Cluster")).toBeVisible();
  await expect(headerButton(page, "Create Kubernetes Cluster")).toHaveCount(0);

  await screenshot(page, "kubernetes-first-run-showcase");

  const guide: Locator = await openAddDialog(page, "Add Kubernetes Cluster");

  // A name to start with, already in the command, with the project's key.
  await expect(nameInput(guide)).toHaveValue("my-cluster");
  await expect
    .poll(async (): Promise<string> => {
      return commands(guide);
    })
    .toContain('--set clusterName="my-cluster"');
  expect(await commands(guide)).toContain(
    `--set oneuptime.apiKey="${SERVER_KEY}"`,
  );

  // What is typed is made safe for the command, and the field says so.
  await typeName(page, guide, "Prod East 1");
  await expect(guide.getByTestId("resource-name-reported-as")).toHaveText(
    "The agent reports it as Prod-East-1.",
  );
  expect(await commands(guide)).toContain('--set clusterName="Prod-East-1"');
  await expect(guide.getByTestId("resource-connection-waiting")).toHaveText(
    "Waiting for Prod-East-1 to connect. This step updates by itself.",
  );

  await nameInput(guide).scrollIntoViewIfNeeded();
  await screenshot(page, "kubernetes-first-run-add-dialog-named");

  // The agent connects: the cluster registers under that name.
  await call(page, "arrive", "kubernetes", "Prod-East-1");
  await page.clock.runFor(FIRST_RECORD_MS + 1);

  /*
   * The dialog says so, the showcase gives way, and the table shows the
   * cluster - no reload.
   */
  const connected: Locator = guide.getByTestId("resource-connection-connected");
  await expect(connected).toContainText(
    "Prod-East-1 is connected. Its data arrives within a minute or two.",
  );
  await expect(
    connected.getByRole("link", { name: "View cluster" }),
  ).toHaveAttribute(
    "href",
    `${KUBERNETES}/30000000-0000-4000-8000-000000000001`,
  );
  await expect(
    tableCard(page).getByText("Prod-East-1", { exact: true }).first(),
  ).toBeVisible();
  await expect(showcase(page)).toHaveCount(0);

  // Done leaves the list, with no guide on it.
  await page
    .getByTestId("modal")
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await expect(guide).toHaveCount(0);
  await expect(page.getByTestId("setup-guide")).toHaveCount(0);

  await screenshot(page, "kubernetes-first-cluster-connected");

  /*
   * Add Kubernetes Cluster a moment later is about the next cluster: the
   * one that just registered is not taken for it.
   */
  await headerButton(page, "Add Kubernetes Cluster").click();
  const dialog: Locator = page.getByTestId("add-resource-modal");
  await expect(nameInput(dialog)).toHaveValue("my-cluster");
  await page.clock.runFor(WATCH_MS * 2 + 1);
  await expect(dialog.getByTestId("resource-connection-waiting")).toHaveText(
    "Waiting for my-cluster to connect. This step updates by itself.",
  );
  await expect(dialog.getByTestId("resource-connection-connected")).toHaveCount(
    0,
  );
});

test("Add Kubernetes Cluster on a project with clusters: a name it has not used, a warning for one it has, and the cluster it had reporting again", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, KUBERNETES, "clusters=1");

  await headerButton(page, "Add Kubernetes Cluster").click();
  const dialog: Locator = page.getByTestId("add-resource-modal");
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Add Kubernetes Cluster" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Install the OneUptime agent with Helm. The cluster shows up here as soon as the agent connects.",
    ),
  ).toBeVisible();

  // "my-cluster" is taken, so the guide starts with the next name.
  await expect(nameInput(dialog)).toHaveValue("my-cluster-2");
  expect(await commands(dialog)).toContain('--set clusterName="my-cluster-2"');

  await screenshot(page, "kubernetes-add-dialog");

  // A cluster added by hand before the guide, that never connected.
  await typeName(page, dialog, "legacy-east");
  const taken: Locator = dialog.getByTestId("resource-name-taken");
  await expect(taken).toContainText(
    "Legacy East is already in this project, so the agent's data goes to it.",
  );
  await expect(
    taken.getByRole("link", { name: "View cluster" }),
  ).toHaveAttribute(
    "href",
    `${KUBERNETES}/30000000-0000-4000-8000-000000000091`,
  );

  await screenshot(page, "kubernetes-add-dialog-name-taken");

  // Its agent is installed under that name, and it reports.
  await call(page, "report", "kubernetes", "legacy-east");
  await page.clock.runFor(WATCH_MS + 1);

  const connected: Locator = dialog.getByTestId(
    "resource-connection-connected",
  );
  await expect(connected).toContainText(
    "Legacy East is connected. Its data arrives within a minute or two.",
  );
  await expect(
    connected.getByRole("link", { name: "View cluster" }),
  ).toHaveAttribute(
    "href",
    `${KUBERNETES}/30000000-0000-4000-8000-000000000091`,
  );

  await connected.scrollIntoViewIfNeeded();
  await screenshot(page, "kubernetes-add-dialog-connected");

  await page
    .getByTestId("modal")
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
});

test("the Add dialog on a phone, in the dark theme: one column, nothing to scroll sideways", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, KUBERNETES, "clusters=1&theme=dark");

  await headerButton(page, "Add Kubernetes Cluster").click();
  const dialog: Locator = page.getByTestId("add-resource-modal");
  await expect(nameInput(dialog)).toHaveValue("my-cluster-2");
  await nameInput(dialog).evaluate((input: Element): void => {
    input.scrollIntoView({ block: "center" });
  });

  expect(await scrollsSideways(page)).toBe(false);
  await screenshot(page, "kubernetes-add-dialog-phone-dark");
});

test("the Add dialog in German", async ({ page }: { page: Page }) => {
  const german: Record<string, string> = JSON.parse(
    await fs.readFile(GERMAN_LOCALE, "utf8"),
  ) as Record<string, string>;
  const inGerman: (english: string) => string = (english: string): string => {
    const text: string | undefined = german[english];
    // A string left in English would let every check below pass vacuously.
    expect(text, english).toBeTruthy();
    expect(text, english).not.toBe(english);
    return text!;
  };

  await open(page, KUBERNETES, "clusters=1&lang=de");

  await tableCard(page)
    .getByTestId("card-header-actions")
    .getByRole("button")
    .filter({ hasText: inGerman("Add Kubernetes Cluster") })
    .click();
  const dialog: Locator = page.getByTestId("add-resource-modal");
  await expect(nameInput(dialog)).toHaveValue("my-cluster-2");

  // The dialog's title, the name field and the last step are German.
  const modal: Locator = page.getByTestId("modal").filter({ has: dialog });
  await expect(modal.getByTestId("modal-title")).toHaveText(
    inGerman("Add Kubernetes Cluster"),
  );
  await expect(modal.getByTestId("modal-description")).toHaveText(
    inGerman(
      "Install the OneUptime agent with Helm. The cluster shows up here as soon as the agent connects.",
    ),
  );
  const field: Locator = dialog.getByTestId("resource-name-field");
  await expect(field.locator("label")).toHaveText(inGerman("Cluster name"));
  await expect(field).toContainText(
    inGerman("How it shows up in OneUptime. The commands below use this name."),
  );
  await expect(dialog.getByTestId("resource-connection-waiting")).toHaveText(
    inGerman(
      "Waiting for {{name}} to connect. This step updates by itself.",
    ).replace("{{name}}", "my-cluster-2"),
  );

  await nameInput(dialog).scrollIntoViewIfNeeded();
  await screenshot(page, "kubernetes-add-dialog-german");
});

/*
 * ---------------------------------------------------------------------------
 * IoT and serverless
 * ---------------------------------------------------------------------------
 */

test("a new project's IoT list: the showcase's Add IoT Fleet opens the guide, and the fleet's name goes into the SDK's resource attributes and the MQTT topics", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, IOT);

  await expectShowcase(
    page,
    "Know which devices are online, and which need help",
  );
  const guide: Locator = await openAddDialog(page, "Add IoT Fleet");
  await expect(nameInput(guide)).toHaveValue("building-a-sensors");
  await typeName(page, guide, "warehouse-7");

  await expect
    .poll(async (): Promise<string> => {
      return commands(guide);
    })
    .toContain(
      "export OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=warehouse-7,device.id=sensor-001,service.name=iot/warehouse-7",
    );

  await guide.getByRole("radio", { name: /MQTT/ }).click();
  await expect
    .poll(async (): Promise<string> => {
      return commands(guide);
    })
    .toContain('topic: "oneuptime/warehouse-7/sensor-001/status"');
  // The fleet keeps its name across the switch.
  await expect(nameInput(guide)).toHaveValue("warehouse-7");

  await screenshot(page, "iot-add-dialog-mqtt");
});

test("a serverless function names itself: the showcase's Add Serverless Function opens a guide with no name to type, and the first data connects it", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, SERVERLESS);

  await expectShowcase(page, "See how every function performs, call by call");
  const guide: Locator = await openAddDialog(page, "Add Serverless Function");
  await expect(nameInput(guide)).toHaveCount(0);
  await expect(guide.getByTestId("resource-connection-waiting")).toHaveText(
    "Waiting for the first data. This step updates by itself.",
  );

  await call(page, "arrive", "serverless", "checkout-handler");
  await page.clock.runFor(FIRST_RECORD_MS + 1);

  // The dialog says so, the showcase gives way, and the table shows it.
  await expect(
    guide.getByTestId("resource-connection-connected"),
  ).toContainText("checkout-handler is connected.");
  await expect(
    tableCard(page).getByText("checkout-handler", { exact: true }).first(),
  ).toBeVisible();
  await expect(showcase(page)).toHaveCount(0);
});

/*
 * ---------------------------------------------------------------------------
 * Added with a form: the guide opens on its own
 * ---------------------------------------------------------------------------
 */

test("Create RUM Application opens the application's guide, with its name as the snippet's service.name", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, RUM);

  await headerButton(page, "Create RUM Application").click();
  const form: Locator = page.getByTestId("modal");
  await form
    .getByPlaceholder("storefront-web", { exact: true })
    .fill("checkout-web");
  await form.getByRole("button", { name: "Create RUM Application" }).click();

  const guide: Locator = page.getByTestId("resource-added-modal");
  await expect(guide).toBeVisible();
  await expect(page.getByTestId("resource-added-note")).toHaveText(
    "checkout-web is added. Follow the steps below to start receiving its data.",
  );
  await expect
    .poll(async (): Promise<string> => {
      return commands(guide);
    })
    .toContain('[ATTR_SERVICE_NAME]: "checkout-web"');
  // The snippet is in a page the public can read: a Browser key.
  expect(await commands(guide)).toContain(BROWSER_KEY);
  expect(await commands(guide)).not.toContain(SERVER_KEY);

  const created: FixtureState = await fixture(page);
  expect(
    created.creates.map((entry: { modelName: string }): string => {
      return entry.modelName;
    }),
  ).toEqual(["RumApplication"]);

  await screenshot(page, "rum-added-guide");

  await page
    .getByTestId("modal")
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await expect(page.getByTestId("modal")).toHaveCount(0);
  await expect(
    tableCard(page).getByText("checkout-web", { exact: true }).first(),
  ).toBeVisible();
});

test("Create Database opens the database's agent guide, prefilled for it, and its first engine metrics connect it", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, DATABASES);

  await headerButton(page, "Create Database").click();
  const form: Locator = page.getByTestId("modal");
  await form.getByRole("combobox").first().click();
  await page.keyboard.type("PostgreSQL");
  await page.keyboard.press("Enter");
  await form
    .getByPlaceholder("db.prod.internal", { exact: true })
    .fill("payments-db.prod.internal");
  await form.getByTestId("modal-footer-next-button").click();
  await form.getByTestId("modal-footer-submit-button").click();

  const guide: Locator = page.getByTestId("resource-added-modal");
  await expect(guide).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Connect PostgreSQL engine metrics" }),
  ).toBeVisible();
  const name: string = "PostgreSQL payments-db.prod.internal:5432";
  await expect(page.getByTestId("resource-added-note")).toContainText(
    `${name} is added.`,
  );
  // Its id, so the agent's data joins this row whatever address it reports.
  await expect(guide).toContainText("35000000-0000-4000-8000-000000000001");

  await screenshot(page, "database-added-guide");

  await call(page, "engineMetrics", name);
  await page.clock.runFor(WATCH_MS + 1);

  const connected: Locator = guide.getByTestId("resource-connection-connected");
  await expect(connected).toContainText(`${name} is connected.`);
  await expect(
    connected.getByRole("link", { name: "View database" }),
  ).toHaveAttribute(
    "href",
    `${DATABASES}/35000000-0000-4000-8000-000000000001`,
  );
});

test("Create Queue opens the queue's guide for its messaging system", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, QUEUES);

  await headerButton(page, "Create Queue").click();
  const form: Locator = page.getByTestId("modal");
  const system: Locator = form.getByRole("combobox", {
    name: /^Messaging System/,
  });
  await system.click();
  await system.fill("rabbitmq");
  await page
    .getByRole("option", { name: /RabbitMQ/ })
    .first()
    .click();
  await form
    .getByPlaceholder("orders.created", { exact: true })
    .fill("orders.created");
  await form.getByTestId("modal-footer-next-button").click();
  await form.getByTestId("modal-footer-submit-button").click();

  const guide: Locator = page.getByTestId("resource-added-modal");
  await expect(guide).toBeVisible();
  await expect(page.getByTestId("resource-added-note")).toContainText(
    "orders.created is added.",
  );
  await expect(guide.getByTestId("resource-connection-waiting")).toContainText(
    "Waiting for orders.created to connect.",
  );

  await call(page, "queueData", "orders.created");
  await page.clock.runFor(WATCH_MS + 1);
  await expect(guide.getByRole("link", { name: "View queue" })).toBeVisible();

  await screenshot(page, "queue-added-guide");
});
