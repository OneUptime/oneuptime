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
 * Adding a host in one command, and the collectors OneUptime manages on
 * hosts, in a real browser: the real Hosts layouts and pages against the
 * offline fixture (Fixture/Fixture.js). Only the data boundary and the
 * signed-in user are synthetic; a config's YAML is checked by the real
 * HostCollectorConfigPolicy when it is saved, as the server checks it.
 *
 *   - Add Host: the one command for each system, with the project's key;
 *     the last step waits for the host and says when it connected.
 *   - Collector Configs: the list, OneUptime's defaults, a new config.
 *   - A config's page: config.yaml, a save the server refuses and one it
 *     takes, the versions with Put back, the hosts that run it, deleting.
 *   - A host's Collector page: running, failed (Try again), a collector
 *     error, Change config, and a host set up by hand.
 *   - On a phone, in the dark, as a Project Member.
 *
 * Every test puts up a network fence that aborts anything leaving the
 * fixture server, and fails on an uncaught page error, on a request the
 * fixture does not model and on any request the fence had to abort.
 */

const PORT: string = process.env["HOST_COLLECTORS_FIXTURE_PORT"] || "4371";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const ONEUPTIME_URL: string = "https://oneuptime.acme-infrastructure.example";
const KEY: string = "a1b2c3d4-0000-4000-8000-00000000f00d";

const HOSTS: string = `/dashboard/${PROJECT_ID}/host`;
const CONFIGS: string = `${HOSTS}/collector-configs`;
const DOCUMENTATION: string = `${HOSTS}/documentation`;

function uuid(prefix: string, number: number): string {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

const WEB_SERVERS_ID: string = uuid("50000000", 1);
const WINDOWS_SERVERS_ID: string = uuid("50000000", 2);
const WEB_01_ID: string = uuid("30000000", 1);
const DB_01_ID: string = uuid("30000000", 2);
const WIN_01_ID: string = uuid("30000000", 3);
const LEGACY_01_ID: string = uuid("30000000", 4);

function collectorPage(hostId: string): string {
  return `${HOSTS}/${hostId}/documentation`;
}

function configPage(configId: string): string {
  return `${CONFIGS}/${configId}`;
}

// HOST_CONNECTION_POLL_INTERVAL_MS: how often the last step looks.
const WATCH_MS: number = 5_000;

const LINUX_COMMAND: string = `curl -fsSL ${ONEUPTIME_URL}/docs/static/scripts/host-collector/install.sh | sudo sh -s -- --url ${ONEUPTIME_URL} --key ${KEY}`;
const WINDOWS_COMMAND: string = `& ([scriptblock]::Create((Invoke-RestMethod -Uri '${ONEUPTIME_URL}/docs/static/scripts/host-collector/install.ps1'))) -Url '${ONEUPTIME_URL}' -Key '${KEY}'`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/host-collectors-ui",
);

interface FixtureState {
  creates: Array<{ modelName: string; data: Record<string, unknown> }>;
  updates: Array<{
    modelName: string;
    id: string;
    data: Record<string, unknown>;
  }>;
  deletes: Array<{ modelName: string; id: string }>;
  listRequests: Array<{ modelName: string; query: unknown }>;
  unhandled: Array<Record<string, unknown>>;
}

interface StoredHost {
  collectorConfigId?: string | null;
  isCollectorConfigPinned?: boolean;
  collectorFailedConfigHash?: string | null;
}

interface StoredVersion {
  versionNumber: number;
  changeNote: string;
  configHash: string;
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

  // The last step's checks run on a clock the test moves on.
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
        (window as unknown as { __hostCollectorsFixture?: unknown })
          .__hostCollectorsFixture,
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
  /*
   * A card, or a setup guide, which draws a card of its own (Hosts >
   * Documentation is only guides). An empty Hosts list is its table's card,
   * with the showcase under it and no guide.
   */
  await expect(
    page.locator('[data-testid="card"], [data-testid="setup-guide"]').first(),
  ).toBeVisible();
}

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __hostCollectorsFixture: unknown })
          .__hostCollectorsFixture,
      ),
    ) as FixtureState;
  });
}

async function storedHost(page: Page, name: string): Promise<StoredHost> {
  return page.evaluate((hostName: string): StoredHost => {
    return (
      window as unknown as {
        __hostCollectorsFixture: { host: (name: string) => StoredHost };
      }
    ).__hostCollectorsFixture.host(hostName);
  }, name);
}

async function storedVersions(
  page: Page,
  configName: string,
): Promise<Array<StoredVersion>> {
  return page.evaluate((name: string): Array<StoredVersion> => {
    return (
      window as unknown as {
        __hostCollectorsFixture: {
          versions: (name: string) => Array<StoredVersion>;
        };
      }
    ).__hostCollectorsFixture.versions(name);
  }, configName);
}

// The one command ran on a host: its collector registers with OneUptime.
async function register(
  page: Page,
  name: string,
  osType: string = "linux",
): Promise<void> {
  await page.evaluate(
    (args: { name: string; osType: string }): void => {
      (
        window as unknown as {
          __hostCollectorsFixture: {
            register: (name: string, osType: string) => void;
          };
        }
      ).__hostCollectorsFixture.register(args.name, args.osType);
    },
    { name, osType },
  );
}

function card(page: Page, title: string): Locator {
  return page.getByTestId("card").filter({
    has: page
      .getByTestId("card-details-heading")
      .getByText(title, { exact: true }),
  });
}

function dialog(page: Page): Locator {
  return page.getByRole("dialog");
}

function headerButton(scope: Locator, name: string): Locator {
  return scope
    .getByTestId("card-header-actions")
    .getByRole("button", { name, exact: true });
}

// A row by its text: a RegExp matches case-sensitively ("Version 1", not "Put version 1 back").
function row(scope: Locator, text: string | RegExp): Locator {
  return scope.getByRole("row").filter({ hasText: text });
}

function versionRow(scope: Locator, versionNumber: number): Locator {
  return row(scope, new RegExp(`Version ${versionNumber}(?!\\d)`));
}

function footerClose(page: Page): Locator {
  return dialog(page).getByTestId("modal-footer-close-button");
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: true,
  });
}

// A dialog on its own, scrolled to `focus` when given.
async function dialogScreenshot(
  page: Page,
  name: string,
  focus?: Locator,
): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  if (focus) {
    await focus.scrollIntoViewIfNeeded();
  }
  await dialog(page).screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
  });
}

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
 * Add Host
 * ---------------------------------------------------------------------------
 */

test("Add Host gives the one command for the host's system, with the project's key", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, HOSTS);

  const hosts: Locator = card(page, "Hosts");
  await expect(headerButton(hosts, "Add Host")).toBeVisible();
  // Typing a host in by hand connects nothing: there is no Create.
  await expect(headerButton(hosts, "Create Host")).toHaveCount(0);

  await headerButton(hosts, "Add Host").click();
  const addHost: Locator = dialog(page);
  await expect(addHost.getByText("Add Host", { exact: true })).toBeVisible();
  await expect(addHost.getByText("What does the host run?")).toBeVisible();

  // Linux first, with the project's only key picked for the command.
  await expect(page.getByTestId("setup-guide-option-linux")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(addHost.getByText("Run this command on the host")).toBeVisible();
  await expect(addHost.getByText(LINUX_COMMAND, { exact: true })).toBeVisible();
  await expect(addHost.getByText("Wait for the host")).toBeVisible();
  await dialogScreenshot(page, "add-host-linux");

  /*
   * The key step is only the picker: the command carries the URL and the
   * key, so the URL/token box would only push it down.
   */
  await expect(page.getByTestId("setup-guide-step-1")).toContainText(
    "Hosts key",
  );
  await expect(addHost.getByText("OneUptime URL")).toHaveCount(0);
  await expect(addHost.getByText("Ingestion Token")).toHaveCount(0);

  /*
   * The command wraps in its box instead of scrolling sideways: it is read
   * whole - its address and its key - before it is run.
   */
  const commandBlock: Locator = page
    .getByTestId("setup-guide-step-2")
    .locator("pre")
    .first();
  expect(
    await commandBlock.evaluate((element: Element): string => {
      return getComputedStyle(element).whiteSpace;
    }),
  ).toBe("pre-wrap");
  expect(
    await commandBlock.evaluate((element: Element): boolean => {
      return element.scrollWidth <= element.clientWidth + 1;
    }),
  ).toBe(true);

  await page.getByTestId("setup-guide-option-windows").click();
  await expect(
    addHost.getByText("In PowerShell, run as administrator.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    addHost.getByText(WINDOWS_COMMAND, { exact: false }),
  ).toBeVisible();

  /*
   * A cluster's nodes are not a fourth system to pick: one line under the
   * three says the Kubernetes agent monitors them, and where to set it up.
   */
  await expect(page.getByTestId("setup-guide-option-kubernetes")).toHaveCount(
    0,
  );
  await expect(addHost.getByRole("radio")).toHaveCount(3);
  const kubernetes: Locator = page.getByTestId("add-host-kubernetes-note");
  await expect(kubernetes).toContainText(
    "Kubernetes nodes are monitored by the Kubernetes agent instead.",
  );
  await expect(
    kubernetes.getByRole("link", { name: "Set up the Kubernetes agent" }),
  ).toHaveAttribute(
    "href",
    new RegExp(`/dashboard/${PROJECT_ID}/kubernetes/documentation$`),
  );
});

test("the last step waits for the host and says when it connected; the list shows it starting", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, HOSTS);
  await headerButton(card(page, "Hosts"), "Add Host").click();

  const addHost: Locator = dialog(page);
  await expect(page.getByTestId("host-connection-waiting")).toBeVisible();
  await expect(page.getByTestId("host-connection-waiting")).toContainText(
    "Waiting for the host to connect. This step updates by itself.",
  );

  // A host that was already running is not the one being added.
  await page.clock.runFor(WATCH_MS + 1);
  await expect(page.getByTestId("host-connection-waiting")).toBeVisible();

  await register(page, "web-09");
  await page.clock.runFor(WATCH_MS + 1);

  const connected: Locator = page.getByTestId("host-connection-connected");
  await expect(connected).toBeVisible();
  await expect(connected).toContainText(
    "web-09 is connected. Its metrics and logs arrive within a minute.",
  );
  await expect(
    connected.getByRole("link", { name: "View host" }),
  ).toHaveAttribute("href", new RegExp(`${HOSTS}/${uuid("30000000", 105)}$`));
  await dialogScreenshot(page, "add-host-connected", connected);

  await addHost.getByRole("button", { name: "Done" }).click();
  await expect(dialog(page)).toHaveCount(0);

  /*
   * Registered, its first metrics on the way: starting, not disconnected -
   * its status and its collector both, until the first data and the
   * collector's first report a minute later.
   */
  const newHost: Locator = row(card(page, "Hosts"), "web-09");
  await expect(newHost).toBeVisible();
  await expect(newHost.getByText("Starting", { exact: true })).toHaveCount(2);
  await expect(newHost.getByTestId("host-collector-state-waiting")).toHaveText(
    "Starting",
  );
});

test("the list says where each host's collector stands and which config it runs", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, HOSTS);
  const hosts: Locator = card(page, "Hosts");

  const web: Locator = row(hosts, "web-01");
  await expect(web.getByTestId("host-collector-state-running")).toBeVisible();
  await expect(web.getByText("Web servers", { exact: true })).toBeVisible();

  const db: Locator = row(hosts, "db-01");
  await expect(db.getByTestId("host-collector-state-failed")).toContainText(
    "Config failed",
  );

  const windows: Locator = row(hosts, "win-01");
  await expect(
    windows.getByTestId("host-collector-state-unhealthy"),
  ).toContainText("Collector error");
  // "OneUptime default": the OS column beside it names the system.
  await expect(windows.getByTestId("host-collector-config-label")).toHaveText(
    "OneUptime default",
  );

  // Installed by hand: nothing OneUptime manages, a quiet dash.
  const legacy: Locator = row(hosts, "legacy-01");
  await expect(
    legacy
      .getByTestId("table-empty-value")
      .filter({ hasText: "Installed by hand" }),
  ).toHaveCount(1);
  await expect(
    legacy.getByTestId("host-collector-state-not-managed"),
  ).toHaveCount(0);
  await screenshot(page, "hosts-list");
});

test("a new project: the showcase's Add Host opens the one command, and the host shows up on its own", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, HOSTS, "hosts=none&keys=none");

  // What Hosts gives, under the empty list, with Add Host: no guide yet.
  const showcase: Locator = page.getByTestId("resource-showcase");
  await expect(showcase.getByRole("heading", { level: 2 })).toHaveText(
    "Know what every server is doing, down to the process",
  );
  await expect(page.getByTestId("setup-guide")).toHaveCount(0);

  await showcase.getByTestId("resource-showcase-add-button").click();
  const addHost: Locator = page.getByTestId("add-host-modal");
  // No key yet: the command says where the key goes.
  await expect(
    addHost.getByText(
      `curl -fsSL ${ONEUPTIME_URL}/docs/static/scripts/host-collector/install.sh | sudo sh -s -- --url ${ONEUPTIME_URL} --key '<YOUR_API_KEY>'`,
      { exact: true },
    ),
  ).toBeVisible();

  await register(page, "web-09");
  await page.clock.runFor(WATCH_MS + 1);

  // The dialog says so, and the showcase gives way to the host's row.
  await expect(addHost.getByTestId("host-connection-connected")).toContainText(
    "web-09 is connected.",
  );
  await expect(showcase).toHaveCount(0);
  await dialog(page).getByRole("button", { name: "Done" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(row(card(page, "Hosts"), "web-09")).toBeVisible();
});

test("Hosts > Documentation: the one command first, the manual guide one card down", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, DOCUMENTATION);

  await expect(page.getByText("Add a host", { exact: true })).toBeVisible();
  await expect(page.getByText(LINUX_COMMAND, { exact: true })).toBeVisible();
  // The one command's Advanced topics do not point to the card right below.
  const advanced: Locator = page.getByTestId("setup-guide-advanced").first();
  await expect(advanced).toContainText("5 topics");
  await advanced.getByTestId("setup-guide-advanced-toggle").click();
  await expect(advanced.getByTestId("setup-guide-topic")).toHaveCount(5);
  await expect(
    advanced
      .getByTestId("setup-guide-topic")
      .filter({ hasText: "Install the collector yourself" }),
  ).toHaveCount(0);

  // The manual guide waits, folded, under the one command.
  const manual: Locator = page.getByTestId("host-manual-guide");
  await expect(manual).toContainText("Install the collector yourself");
  await expect(
    manual.getByText("How do you want to install the collector?"),
  ).toBeHidden();
  await manual
    .getByRole("button", { name: "Install the collector yourself" })
    .click();
  await expect(
    manual.getByText("How do you want to install the collector?"),
  ).toBeVisible();
});

/*
 * ---------------------------------------------------------------------------
 * Collector Configs
 * ---------------------------------------------------------------------------
 */

test("Collector Configs lists who each config is for, and OneUptime's defaults", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, CONFIGS);

  const configs: Locator = card(page, "Collector Configs");
  // Who each config is for; the hosts that run it are on its own page.
  await expect(
    configs.getByRole("columnheader", { name: "Applies to" }),
  ).toBeVisible();
  const web: Locator = row(configs, "Web servers");
  await expect(web).toContainText("Linux hosts with env:production");
  await expect(web).toContainText("Version 2");
  const windows: Locator = row(configs, "Windows servers");
  await expect(windows).toContainText("Windows hosts");
  await expect(windows).toContainText("Version 1");

  const defaults: Locator = card(page, "OneUptime defaults");
  await expect(defaults).toContainText("OneUptime default for Linux");
  await expect(defaults).toContainText("OneUptime default for Windows");
  await expect(defaults).toContainText("OneUptime default for macOS");
  await screenshot(page, "collector-configs");

  await page.getByTestId("host-collector-default-linux").click();
  const view: Locator = dialog(page);
  await expect(view.getByText("OneUptime default for Linux")).toBeVisible();
  await expect(page.getByTestId("host-collector-default-yaml")).toContainText(
    "otlp_http/oneuptime",
  );
  await expect(page.getByTestId("host-collector-default-yaml")).toContainText(
    "x-oneuptime-token: ${env:ONEUPTIME_INGESTION_KEY}",
  );
  await footerClose(page).click();
  await expect(dialog(page)).toHaveCount(0);
});

test("a new Collector Config asks for a name, a system and labels, then opens on its own page", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, CONFIGS);

  await headerButton(
    card(page, "Collector Configs"),
    "Create Collector Config",
  ).click();
  const form: Locator = dialog(page);
  await expect(
    form.getByText(
      "Its config.yaml starts as OneUptime's default for this system. Edit it on the config's page.",
    ),
  ).toBeVisible();
  // The placeholder says what a name is: no description under it.
  await expect(form.getByText("have in common", { exact: false })).toHaveCount(
    0,
  );
  await form.getByRole("textbox", { name: /^Name/ }).fill("Database servers");
  await expect(form.getByRole("radio", { name: /^Linux/ })).toBeChecked();
  await form.getByRole("button", { name: "Create" }).click();

  await expect(page).toHaveURL(
    new RegExp(`${CONFIGS}/${uuid("50000000", 12)}$`),
  );
  const details: Locator = card(page, "Collector Config");
  await expect(details).toContainText("Database servers");
  await expect(details).toContainText("Linux hosts");
  await expect(page.getByTestId("host-collector-config-version")).toHaveText(
    "1",
  );
  // It starts as OneUptime's default for Linux.
  await expect(page.getByTestId("host-collector-config-yaml")).toContainText(
    "journald",
  );

  const created: FixtureState["creates"] = (await fixture(page)).creates;
  expect(created).toHaveLength(1);
  expect(created[0]!.data["name"]).toBe("Database servers");
  expect(created[0]!.data["osType"]).toBe("linux");
});

/*
 * ---------------------------------------------------------------------------
 * A Collector Config's page
 * ---------------------------------------------------------------------------
 */

test("a config's page: who it is for, its config.yaml, every version and the hosts that run it", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, configPage(WEB_SERVERS_ID));

  const details: Locator = card(page, "Collector Config");
  await expect(details).toContainText("Web servers");
  await expect(details).toContainText("Applies to");
  await expect(page.getByTestId("host-collector-config-target")).toHaveText(
    "Linux hosts with env:production",
  );
  // Its labels are in that sentence: not repeated beside it.
  await expect(details.getByText("Host Labels", { exact: true })).toHaveCount(
    0,
  );

  // Editing it: changing the system leaves its config.yaml as it is.
  await headerButton(details, "Edit Collector Config").click();
  await expect(
    dialog(page).getByText("Changing it does not change config.yaml."),
  ).toBeVisible();
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(dialog(page)).toHaveCount(0);

  await expect(page.getByTestId("host-collector-config-version")).toHaveText(
    "2",
  );
  await expect(page.getByTestId("host-collector-config-yaml")).toContainText(
    "collection_interval: 60s",
  );

  const versions: Locator = card(page, "Versions");
  const second: Locator = versionRow(versions, 2);
  await expect(second).toContainText("Current");
  await expect(second).toContainText("Changed");
  const first: Locator = versionRow(versions, 1);
  await expect(first).toContainText("Created");
  await expect(first).not.toContainText("Current");

  const hosts: Locator = card(page, "Hosts");
  await expect(
    row(hosts, "web-01").getByTestId("host-collector-state-running"),
  ).toBeVisible();
  await expect(
    row(hosts, "db-01").getByTestId("host-collector-state-failed"),
  ).toBeVisible();
  await expect(row(hosts, "win-01")).toHaveCount(0);
  await screenshot(page, "collector-config");
});

test("a save the server refuses says why and keeps the dialog; a good one is the next version", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, configPage(WEB_SERVERS_ID));

  await headerButton(card(page, "config.yaml"), "Edit config").click();
  const edit: Locator = dialog(page);
  await expect(edit.getByText("Edit config.yaml")).toBeVisible();
  const editor: Locator = edit.getByRole("textbox", { name: /^config\.yaml/ });
  await expect(editor).toHaveValue(/collection_interval: 60s/);

  // A config may not read files: the server says so, and nothing is saved.
  const current: string = await editor.inputValue();
  await editor.fill(
    current.replace(
      "collection_interval: 60s",
      "collection_interval: ${file:/etc/oneuptime-interval}",
    ),
  );
  await edit.getByRole("button", { name: /^Save/ }).click();
  await expect(
    edit.getByText("This config cannot be sent to hosts.", { exact: false }),
  ).toBeVisible();
  await dialogScreenshot(page, "collector-config-refused");
  expect(await storedVersions(page, "Web servers")).toHaveLength(2);

  await editor.fill(
    current.replace("collection_interval: 60s", "collection_interval: 15s"),
  );
  await edit.getByRole("button", { name: /^Save/ }).click();
  await expect(dialog(page)).toHaveCount(0);

  await expect(page.getByTestId("host-collector-config-version")).toHaveText(
    "3",
  );
  await expect(page.getByTestId("host-collector-config-yaml")).toContainText(
    "collection_interval: 15s",
  );
  const versions: Locator = card(page, "Versions");
  await expect(versionRow(versions, 3)).toContainText("Current");
  await expect(versionRow(versions, 3)).toContainText("Changed");

  const kept: Array<StoredVersion> = await storedVersions(page, "Web servers");
  expect(
    kept.map((version: StoredVersion): number => {
      return version.versionNumber;
    }),
  ).toEqual([1, 2, 3]);
});

test("Put back sends an older version again, as the next version", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, configPage(WEB_SERVERS_ID));
  const versions: Locator = card(page, "Versions");

  // Read it first: the version's own dialog puts it back.
  await versionRow(versions, 1).getByRole("button", { name: "View" }).click();
  const view: Locator = dialog(page);
  // What changed, who saved it and when: "Created · Sam Patel · Oct 18 2026, ...".
  const said: Array<string> = (
    (await view
      .getByText("Created · ", { exact: false })
      .first()
      .textContent()) || ""
  ).split(" · ");
  expect(said).toHaveLength(3);
  expect(said[0]).toBe("Created");
  expect(said[1]!.length).toBeGreaterThan(0);
  expect(said[2]).toContain("2026");
  await expect(
    page.getByTestId("host-collector-config-version-yaml"),
  ).toContainText("collection_interval: 30s");
  await view.getByRole("button", { name: "Put back" }).click();

  const confirm: Locator = dialog(page);
  await expect(confirm.getByText("Put version 1 back?")).toBeVisible();
  await expect(
    confirm.getByText(
      "Its hosts get the config of version 1 again, saved as a new version. Every version stays in the list.",
    ),
  ).toBeVisible();
  await confirm.getByRole("button", { name: "Put back" }).click();
  await expect(dialog(page)).toHaveCount(0);

  await expect(page.getByTestId("host-collector-config-version")).toHaveText(
    "3",
  );
  await expect(page.getByTestId("host-collector-config-yaml")).toContainText(
    "collection_interval: 30s",
  );
  await expect(versionRow(versions, 3)).toContainText("Put version 1 back");
  await expect(versionRow(versions, 3)).toContainText("Current");
  // Version 1's YAML is the config's again: nothing to put back there now.
  await versionRow(versions, 1).getByRole("button", { name: "View" }).click();
  await expect(
    dialog(page).getByRole("button", { name: "Put back" }),
  ).toHaveCount(0);
  await footerClose(page).click();

  const kept: Array<StoredVersion> = await storedVersions(page, "Web servers");
  expect(kept[2]!.changeNote).toBe("Put version 1 back");
  expect(kept[2]!.configHash).toBe(kept[0]!.configHash);
});

test("deleting a config sends its hosts back to the list", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, configPage(WINDOWS_SERVERS_ID));

  await page
    .getByRole("button", { name: /^Delete/ })
    .last()
    .click();
  const confirm: Locator = dialog(page);
  await expect(
    confirm.getByText(
      "Its hosts go back to the first config that applies to them, or to OneUptime's default. Their collectors keep running.",
    ),
  ).toBeVisible();
  await confirm.getByRole("button", { name: /^Delete/ }).click();

  await expect(page).toHaveURL(new RegExp(`${CONFIGS}$`));
  await expect(
    row(card(page, "Collector Configs"), "Windows servers"),
  ).toHaveCount(0);
  expect((await fixture(page)).deletes).toEqual([
    { modelName: "HostCollectorConfig", id: WINDOWS_SERVERS_ID },
  ]);
});

/*
 * ---------------------------------------------------------------------------
 * A host's Collector page
 * ---------------------------------------------------------------------------
 */

test("a managed host: its collector's state, its config and the commands on the host", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, collectorPage(WEB_01_ID));

  const collector: Locator = card(page, "Collector");
  await expect(page.getByTestId("host-collector-state")).toContainText(
    "The collector runs the config OneUptime sent it.",
  );
  await expect(
    collector.getByRole("link", { name: "Web servers" }),
  ).toHaveAttribute("href", new RegExp(`${configPage(WEB_SERVERS_ID)}$`));
  await expect(page.getByTestId("host-collector-config-choice")).toHaveText(
    "The first Collector Config that applies",
  );
  await expect(page.getByTestId("host-collector-config-version")).toHaveText(
    "2",
  );
  await expect(collector).toContainText("0.161.0");
  // Nothing failed: nothing to try again.
  await expect(headerButton(collector, "Try again")).toHaveCount(0);

  // When it last reported, in words, with the date and time on hover.
  const lastReport: Locator = page.getByTestId("host-collector-last-report");
  await expect(lastReport).toHaveText(/^\d+ minutes? ago$/);
  expect(await lastReport.getAttribute("title")).toMatch(/\d/);

  // Where what it collects is changed: a link, from the sentence that says so.
  await expect(
    collector
      .getByTestId("card-description")
      .getByRole("link", { name: "Collector Configs" }),
  ).toHaveAttribute("href", new RegExp(`${CONFIGS}$`));

  const onHost: Locator = card(page, "On the host");
  const uninstall: string = `curl -fsSL ${ONEUPTIME_URL}/docs/static/scripts/host-collector/install.sh | sudo sh -s -- --uninstall`;
  for (const [item, command] of [
    ["status", "sudo systemctl status oneuptime-collector"],
    ["logs", "sudo journalctl -u oneuptime-collector -n 50"],
    ["restart", "sudo systemctl restart oneuptime-collector"],
    ["uninstall", uninstall],
  ] as Array<[string, string]>) {
    const line: Locator = page
      .getByTestId(`host-collector-on-host-${item}`)
      .getByTestId("copyable-command");
    // On screen as written, character for character.
    expect(await line.locator("code").textContent()).toBe(command);
    await expect(line.getByRole("button")).toBeVisible();
  }

  /*
   * A long command breaks only at a space: every word short enough for a
   * line is drawn whole, never "sh -" / "s" or "oneuptime-" / "collector".
   */
  const brokenWords: Array<string> = await page
    .getByTestId("host-collector-on-host-uninstall")
    .locator("code")
    .evaluate((code: Element): Array<string> => {
      const kept: Array<string> = Array.from(code.querySelectorAll("span")).map(
        (span: Element): string => {
          return getComputedStyle(span).whiteSpace === "nowrap"
            ? span.textContent || ""
            : "";
        },
      );
      return (code.textContent || "")
        .split(" ")
        .filter((word: string): boolean => {
          return word.length > 0 && word.length <= 32 && !kept.includes(word);
        });
    });
  expect(brokenWords).toEqual([]);
  await screenshot(page, "host-collector-running");

  /*
   * Update it, or change its labels: the install command for this host,
   * of its own system - no system to pick - waiting for its new collector.
   */
  await onHost
    .getByRole("button", { name: "Show the install command" })
    .click();
  const install: Locator = dialog(page);
  await expect(
    install.getByText("Run the install command again", { exact: true }),
  ).toBeVisible();
  await expect(
    install.getByText(
      "Run it on web-01 to update its collector or change its labels. The host keeps its place and its history in OneUptime.",
    ),
  ).toBeVisible();
  await expect(install.getByRole("radio")).toHaveCount(0);
  await expect(page.getByTestId("add-host-kubernetes-note")).toHaveCount(0);
  await expect(install.getByText(LINUX_COMMAND, { exact: true })).toBeVisible();
  await expect(page.getByTestId("host-connection-waiting")).toContainText(
    "Waiting for the new collector to connect. This step updates by itself.",
  );
  await dialogScreenshot(page, "host-collector-install-command");

  // The command ran on web-01: the dialog says so, and the page reads it again.
  await register(page, "web-01");
  await page.clock.runFor(WATCH_MS + 1);
  await expect(page.getByTestId("connected-host-name")).toHaveText("web-01");
  await install.getByRole("button", { name: "Done" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByTestId("host-collector-state-waiting")).toBeVisible();
});

test("Change config picks a config for this host, and Automatic gives it back to the list", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, collectorPage(WEB_01_ID));
  const collector: Locator = card(page, "Collector");

  await headerButton(collector, "Change config").click();
  const picker: Locator = dialog(page);
  await expect(
    picker.getByText("Change config", { exact: true }),
  ).toBeVisible();
  const choice: Locator = picker.getByRole("combobox", { name: /^Config/ });
  await expect(choice).toBeVisible();
  await choice.click();
  // Only configs for the host's system: no Windows config for a Linux host.
  await expect(
    page.getByRole("option", { name: "Automatic: Web servers for now" }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Web servers", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Windows servers" }),
  ).toHaveCount(0);
  await page.getByRole("option", { name: "Web servers", exact: true }).click();
  await picker.getByRole("button", { name: "Save" }).click();
  await expect(dialog(page)).toHaveCount(0);

  await expect(page.getByTestId("host-collector-config-choice")).toHaveText(
    "Picked for this host",
  );
  let host: StoredHost = await storedHost(page, "web-01");
  expect(host.collectorConfigId).toBe(WEB_SERVERS_ID);
  expect(host.isCollectorConfigPinned).toBe(true);

  await headerButton(collector, "Change config").click();
  await dialog(page)
    .getByRole("combobox", { name: /^Config/ })
    .click();
  await page
    .getByRole("option", { name: "Automatic: Web servers for now" })
    .click();
  await dialog(page).getByRole("button", { name: "Save" }).click();
  await expect(dialog(page)).toHaveCount(0);

  await expect(page.getByTestId("host-collector-config-choice")).toHaveText(
    "The first Collector Config that applies",
  );
  host = await storedHost(page, "web-01");
  expect(host.collectorConfigId).toBe(WEB_SERVERS_ID);
  expect(host.isCollectorConfigPinned).toBe(false);
});

test("a config that failed: why, what the host reported, and Try again", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, collectorPage(DB_01_ID));
  const collector: Locator = card(page, "Collector");

  await expect(page.getByTestId("host-collector-state")).toContainText(
    "Web servers did not start on this host. The host runs the last config that worked there.",
  );
  const error: Locator = page.getByTestId("host-collector-error");
  await expect(error).toContainText(
    'cannot start pipelines: failed to start "filelog/nginx" receiver: open /var/log/nginx/access.log: permission denied',
  );
  await error.getByText("What the host reported").click();
  await expect(error).toContainText(
    "Collector failed to start with the new config",
  );
  // Red, as its pill: a config that did not start.
  await expect(error).toHaveAttribute("data-tone", "danger");
  // The version it runs is not the one that failed, and says so.
  await expect(page.getByTestId("host-collector-config-version")).toHaveText(
    "1, the last that worked here",
  );
  await screenshot(page, "host-collector-failed");

  await headerButton(collector, "Try again").click();
  const confirm: Locator = dialog(page);
  await expect(confirm.getByText("Try the config again?")).toBeVisible();
  await confirm.getByRole("button", { name: "Try again" }).click();
  await expect(dialog(page)).toHaveCount(0);

  const host: StoredHost = await storedHost(page, "db-01");
  expect(host.collectorFailedConfigHash).toBeNull();
  await expect(headerButton(collector, "Try again")).toHaveCount(0);
});

test("a collector error on a Windows host running OneUptime's default", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, collectorPage(WIN_01_ID));

  await expect(page.getByTestId("host-collector-state")).toContainText(
    "Running OneUptime default for Windows, but the collector reports an error.",
  );
  await expect(page.getByTestId("host-collector-error")).toContainText(
    "failed to export metrics",
  );
  // Amber, as its pill: the collector runs, and reports an error.
  await expect(page.getByTestId("host-collector-error")).toHaveAttribute(
    "data-tone",
    "warning",
  );
  await expect(page.getByTestId("host-collector-config-name")).toHaveText(
    "OneUptime default for Windows",
  );
  // A default has no versions.
  await expect(page.getByTestId("host-collector-config-version")).toHaveCount(
    0,
  );
  await expect(card(page, "On the host")).toContainText(
    "Get-Service oneuptime-collector",
  );
});

test("a host set up by hand: the one command hands it over, and the manual guide stays", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, collectorPage(LEGACY_01_ID));

  await expect(
    page.getByText("Let OneUptime manage this collector", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(`${LINUX_COMMAND} --replace-existing`, { exact: true }),
  ).toBeVisible();
  // Its system is known: only its command, no system to pick.
  await expect(
    page.getByTestId("setup-guide").first().getByRole("radio"),
  ).toHaveCount(0);
  // The manual guide stays one click away.
  const manual: Locator = page.getByTestId("host-manual-guide");
  await expect(manual).toContainText("Install the collector yourself");
  await expect(manual).toContainText("legacy-01");
  await expect(card(page, "Collector")).toHaveCount(0);
  await screenshot(page, "host-collector-by-hand");

  // Another host connecting is not this one.
  await register(page, "web-09");
  await page.clock.runFor(WATCH_MS + 1);
  await expect(page.getByTestId("host-connection-waiting")).toBeVisible();

  // The command ran on legacy-01: OneUptime manages its collector now.
  await register(page, "legacy-01");
  await page.clock.runFor(WATCH_MS + 1);
  await expect(card(page, "Collector")).toBeVisible();
  await expect(page.getByTestId("host-collector-state-waiting")).toBeVisible();
  await expect(page.getByTestId("host-collector-state")).toContainText(
    "Connected. The collector is starting.",
  );
  await expect(page.getByTestId("host-manual-guide")).toHaveCount(0);
});

/*
 * ---------------------------------------------------------------------------
 * Who may change what
 * ---------------------------------------------------------------------------
 */

test("a Project Member reads configs but cannot change them", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, configPage(WEB_SERVERS_ID), "role=member");

  const editConfig: Locator = headerButton(
    card(page, "config.yaml"),
    "Edit config",
  );
  await expect(editConfig).toBeVisible();
  await expect(editConfig).toBeDisabled();

  await versionRow(card(page, "Versions"), 1)
    .getByRole("button", { name: "View" })
    .click();
  await expect(
    dialog(page).getByRole("button", { name: "Put back" }),
  ).toHaveCount(0);
  await footerClose(page).click();
});

/*
 * ---------------------------------------------------------------------------
 * On a phone, in the dark
 * ---------------------------------------------------------------------------
 */

test("on a phone the pages fit", async ({ page }: { page: Page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await open(page, collectorPage(DB_01_ID));
  await expect(page.getByTestId("host-collector-error")).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
  await screenshot(page, "host-collector-failed-phone");

  await open(page, configPage(WEB_SERVERS_ID));
  await expect(page.getByTestId("host-collector-config-yaml")).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
  await screenshot(page, "collector-config-phone");

  // OneUptime's defaults: each View config under its name, not beside it.
  await open(page, CONFIGS);
  const linuxDefault: Locator = page.getByTestId(
    "host-collector-default-row-linux",
  );
  const nameBox: { y: number; height: number } = (await linuxDefault
    .getByText("OneUptime default for Linux", { exact: true })
    .boundingBox())!;
  const viewBox: { y: number } = (await page
    .getByTestId("host-collector-default-linux")
    .boundingBox())!;
  expect(viewBox.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height - 1);
  expect(await scrollsSideways(page)).toBe(false);

  await open(page, HOSTS);
  // A failed config is the one thing in a row that asks for action: shown on a phone too.
  await expect(
    card(page, "Hosts").getByTestId("host-collector-state-failed"),
  ).toBeVisible();
  await headerButton(card(page, "Hosts"), "Add Host").click();
  await expect(
    dialog(page).getByText("Run this command on the host"),
  ).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
  await dialogScreenshot(page, "add-host-phone");

  /*
   * The host connected: the sentence keeps the width of the box, and View
   * host goes under it, lined up with it, instead of squeezing it into a
   * column a word or two wide.
   */
  await register(page, "web-09.eu-central-1.compute.internal");
  await page.clock.runFor(WATCH_MS + 1);
  const connected: Locator = page.getByTestId("host-connection-connected");
  await expect(connected).toBeVisible();
  const sentence: Locator = connected.getByText(
    "is connected. Its metrics and logs arrive within a minute.",
    { exact: false },
  );
  const link: Locator = connected.getByRole("link", { name: "View host" });
  const sentenceBox: { x: number; y: number; width: number; height: number } =
    (await sentence.boundingBox())!;
  const linkBox: { x: number; y: number; width: number; height: number } =
    (await link.boundingBox())!;
  expect(sentenceBox.width).toBeGreaterThan(200);
  expect(linkBox.y).toBeGreaterThanOrEqual(
    sentenceBox.y + sentenceBox.height - 1,
  );
  expect(Math.abs(linkBox.x - sentenceBox.x)).toBeLessThanOrEqual(1);
  await dialogScreenshot(page, "add-host-connected-phone", connected);
});

test("in German, Add Host is German throughout", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, HOSTS, "lang=de");
  await headerButton(card(page, "Hosts"), "Host hinzufügen").click();
  const addHost: Locator = dialog(page);

  await expect(page.getByTestId("add-host-kubernetes-note")).toContainText(
    "Kubernetes-Knoten überwacht stattdessen der Kubernetes-Agent.",
  );
  // Each step, as a screen reader says it too.
  for (const [number, title] of [
    [1, "Aufnahmeschlüssel auswählen"],
    [2, "Diesen Befehl auf dem Host ausführen"],
    [3, "Auf den Host warten"],
  ] as Array<[number, string]>) {
    await expect(
      addHost.getByRole("heading", { name: `Schritt ${number}: ${title}` }),
    ).toBeVisible();
  }
  for (const text of [
    "Was läuft auf dem Host?",
    "Neuer Schlüssel",
    "Als Benutzer, der sudo verwenden darf. Es dauert etwa eine Minute.",
    "Warten, bis sich der Host verbindet. Dieser Schritt aktualisiert sich selbst.",
    "Erweitert",
    "Fehlerbehebung",
    "6 Themen",
  ]) {
    await expect(addHost.getByText(text, { exact: true })).toBeVisible();
  }
  await expect(
    addHost.getByRole("link", { name: "Kubernetes-Agent einrichten" }),
  ).toBeVisible();

  await page.getByTestId("setup-guide-option-windows").click();
  await expect(
    addHost.getByText(
      "In PowerShell, als Administrator ausgeführt. Es dauert etwa eine Minute.",
      { exact: true },
    ),
  ).toBeVisible();
  await dialogScreenshot(page, "add-host-de");
});

test("in German, the Collector page and a config's versions are translated", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, collectorPage(DB_01_ID), "lang=de");
  await expect(page.getByTestId("host-collector-config-version")).toHaveText(
    "1, die letzte, die hier funktioniert hat",
  );
  await expect(page.getByTestId("host-collector-last-report")).toHaveText(
    /^vor \d+ Minuten?$/,
  );
  await expect(
    card(page, "Collector")
      .getByTestId("card-description")
      .getByRole("link", { name: "Collector-Konfigurationen" }),
  ).toBeVisible();
  await expect(card(page, "Auf dem Host")).toContainText(
    "Installationsbefehl anzeigen",
  );
  await expect(page.getByTestId("host-collector-state")).toContainText(
    "Web servers ist auf diesem Host nicht gestartet. Der Host führt die letzte Konfiguration aus, die dort funktioniert hat.",
  );
  await expect(page.getByTestId("host-collector-config-choice")).toHaveText(
    "Die erste zutreffende Collector-Konfiguration",
  );
  // A config's name is what someone typed: "Web servers" stays as it is.
  await expect(
    card(page, "Collector").getByRole("link", { name: "Web servers" }),
  ).toBeVisible();
  await screenshot(page, "host-collector-failed-de");

  await headerButton(card(page, "Collector"), "Konfiguration ändern").click();
  await dialog(page)
    .getByRole("combobox", { name: /^Konfiguration/ })
    .click();
  await expect(
    page.getByRole("option", { name: "Automatisch: vorerst Web servers" }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Web servers", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await dialog(page).getByRole("button", { name: "Abbrechen" }).click();

  await open(page, configPage(WEB_SERVERS_ID), "lang=de");
  await expect(page.getByTestId("host-collector-config-target")).toHaveText(
    "Linux-Hosts mit env:production",
  );
  await expect(versionRow(card(page, "Versionen"), 1)).toContainText(
    "Erstellt",
  );
});

test("in the dark theme", async ({ page }: { page: Page }) => {
  await open(page, collectorPage(DB_01_ID), "theme=dark");
  await expect(page.getByTestId("host-collector-error")).toBeVisible();
  await screenshot(page, "host-collector-failed-dark");

  await open(page, configPage(WEB_SERVERS_ID), "theme=dark");
  await expect(page.getByTestId("host-collector-config-yaml")).toBeVisible();
  await screenshot(page, "collector-config-dark");
});
