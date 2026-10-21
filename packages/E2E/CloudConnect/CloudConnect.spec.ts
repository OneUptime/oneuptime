import { expect, Locator, Page, test } from "@playwright/test";
import path from "path";

/*
 * Cloud > Connect, end to end in a browser, on the real page
 * (CloudConnect/Fixture.js). A customer found connecting AWS, Azure and
 * Google Cloud to OneUptime hard - it took an OpenTelemetry Collector
 * configuration - and asked for a button. What is pinned here is what a
 * person sees and what is sent: a tile per cloud, the one command in the
 * cloud's own browser terminal, one paste of what it printed - for every
 * cloud and every way in, a Google Cloud key printed after gcloud's own
 * lines included - a test, run by itself as its step opens, that says what
 * it found and what reading it costs, an AWS role or an access key, and the
 * list's status and actions, Read now watched to its end - at desktop and
 * phone width, beside the side menu at 768 and 1024, in the dark theme and
 * in Japanese.
 *
 * The screenshots under output/playwright/cloud-connect-ui are for the
 * people who review the page.
 */

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/cloud-connect-ui",
);

// Kanji, hiragana or katakana: words the Japanese locale translated.
const JAPANESE_SCRIPT: RegExp =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

const TENANT: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
const APP: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
const PASSWORD: string = "Q~8Q8.ab-CD{e}fGh~ij_kL}m";

// What `az ad sp create-for-rbac` prints, its warning first.
const AZURE_OUTPUT: string = [
  "WARNING: Creating 'Monitoring Reader' role assignment under scope '/subscriptions/7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b'",
  "The output includes credentials that you must protect.",
  "{",
  `  "appId": "${APP}",`,
  '  "displayName": "OneUptimeReadOnly",',
  `  "password": "${PASSWORD}",`,
  `  "tenant": "${TENANT}"`,
  "}",
].join("\n");

// The paste's label as a field the form calls optional would draw it.
const PASTE_LABEL_MARKED_OPTIONAL: RegExp =
  /What the command printed\s*\(Optional\)/;

// The role the AWS command prints the ARN of.
const ROLE_ARN: string =
  "arn:aws:iam::123456789012:role/OneUptimeReadOnly-6c2b8f0e";

// A Google Cloud key, as `gcloud iam service-accounts keys create` writes it.
const GCP_KEY: Record<string, string> = {
  type: "service_account",
  project_id: "acme-prod",
  private_key_id: "3f2a9c",
  private_key:
    "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----\n",
  client_email: "oneuptime-read-only@acme-prod.iam.gserviceaccount.com",
  client_id: "1234567890",
};

// Everything Google Cloud Shell prints for the setup command: gcloud's lines, then the key.
const GCP_OUTPUT: string = [
  "Your active configuration is: [cloudshell-12345]",
  'Operation "operations/acat.p2-1234567890-abcd" finished successfully.',
  "Created service account [oneuptime-read-only].",
  "Updated IAM policy for project [acme-prod].",
  "created key [3f2a9c] of type [json] as [oneuptime-key.json] for [oneuptime-read-only@acme-prod.iam.gserviceaccount.com]",
  JSON.stringify(GCP_KEY, null, 2),
].join("\n");

interface FixtureState {
  creates: Array<{
    name: string;
    provider: string;
    config: Record<string, unknown>;
    secrets: string;
    isEnabled: boolean;
  }>;
  updates: Array<{ id: string; data: Record<string, unknown> }>;
  tests: Array<{ body: Record<string, unknown> }>;
  readNows: Array<string>;
  itemAsks: number;
  roleSetupAsks: number;
}

// The fixture's project, and the page's own address in the real Cloud layout.
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const CONNECT_PATH: string = `/dashboard/${PROJECT_ID}/cloud/connect`;

async function open(page: Page, query: string = ""): Promise<void> {
  await page.goto(`${CONNECT_PATH}?${query}`);
  await expect(page.getByTestId("cloud-connect-page")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function fixture(page: Page): Promise<FixtureState> {
  return await page.evaluate(() => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __cloudConnectFixture: { state: unknown } })
          .__cloudConnectFixture.state,
      ),
    );
  });
}

function dialog(page: Page): Locator {
  return page.getByTestId("modal");
}

function next(page: Page): Locator {
  return dialog(page).getByTestId("modal-footer-next-button");
}

function submit(page: Page): Locator {
  return dialog(page).getByTestId("modal-footer-submit-button");
}

/*
 * The whole page, or - with a dialog open - what the screen shows, since a
 * dialog stays put while the page under it scrolls.
 */
async function shoot(page: Page, name: string): Promise<void> {
  const project: string = test.info().project.name;
  const hasDialog: boolean = (await page.getByTestId("modal").count()) > 0;
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-${project}.png`),
    fullPage: !hasDialog,
  });
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow: number = await page.evaluate(() => {
    return document.documentElement.scrollWidth - window.innerWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

function pasteBox(page: Page): Locator {
  return dialog(page).getByPlaceholder("{ ... }");
}

async function pasteAzureOutput(page: Page): Promise<void> {
  await dialog(page).getByPlaceholder("{ ... }").fill(AZURE_OUTPUT);
  await expect(
    dialog(page).getByTestId("cloud-connection-paste-found"),
  ).toContainText(
    "Found: Directory (tenant) ID, Application (client) ID, Client secret",
  );
}

test.describe("the Connect page", () => {
  test("three clouds, three promises, and no list while nothing is connected", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    await expect(page.getByText("Connect a cloud account")).toBeVisible();

    // In the real Cloud layout: the trail and, on a desktop, the side menu say where this is.
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }),
    ).toContainText("Connect");
    if (test.info().project.name === "desktop") {
      await expect(
        page.getByRole("link", { name: "Connect", exact: true }),
      ).toHaveClass(/bg-indigo-50/);
    }

    for (const [provider, title] of [
      ["aws", "Amazon Web Services"],
      ["azure", "Microsoft Azure"],
      ["gcp", "Google Cloud"],
    ]) {
      const tile: Locator = page.getByTestId(
        `cloud-connection-tile-${provider}`,
      );
      await expect(tile).toBeVisible();
      await expect(tile).toContainText(title as string);
      await expect(tile).toBeEnabled();
    }

    const promises: Locator = page.getByTestId("cloud-connect-promises");
    await expect(promises).toContainText(
      "Read-only: OneUptime can read, never change, anything in your cloud.",
    );
    await expect(promises).toContainText(
      "Chart them, and alert on them with a metric monitor.",
    );
    // The list waits, hidden, until something is connected.
    await expect(page.getByText("Connected accounts")).toBeHidden();
    await expect(
      page.getByTestId("cloud-connect-collector-note").getByRole("link"),
    ).toHaveAttribute("href", /\/telemetry\/cloud-resources$/);

    await expectNoSidewaysScroll(page);
    await shoot(page, "connect-empty");
  });
});

test.describe("connecting Azure", () => {
  test("the command in Azure Cloud Shell, one paste, a test that says what it found and costs, then Connect", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    await page.getByTestId("cloud-connection-tile-azure").click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText("Connect Microsoft Azure");

    // Step 1: the command, in the cloud's own terminal, one click away.
    await expect(
      dialog(page).getByTestId("cloud-setup-command-code"),
    ).toContainText("az ad sp create-for-rbac");
    const shell: Locator = dialog(page).getByTestId("cloud-setup-open-shell");
    await expect(shell).toContainText("Open Azure Cloud Shell");
    await expect(shell).toHaveAttribute("href", "https://shell.azure.com");
    await expect(shell).toHaveAttribute("target", "_blank");
    await expect(
      dialog(page).getByTestId("cloud-setup-read-only"),
    ).toContainText("OneUptime can only read resources and metrics.");
    await expectNoSidewaysScroll(page);
    await shoot(page, "azure-command");

    // Step 2: one paste fills in every value.
    await next(page).click();
    await pasteAzureOutput(page);
    await shoot(page, "azure-paste");
    // Nothing is tested before the Test step opens.
    expect((await fixture(page)).tests).toHaveLength(0);

    // Step 3: the test runs by itself as the step opens - nothing to press.
    await next(page).click();
    const answer: Locator = dialog(page).getByTestId(
      "cloud-connection-test-pass",
    );
    await expect(answer).toContainText(
      "It works. Here is what OneUptime found to monitor.",
    );
    await expect(answer).toContainText("37 resources");
    await expect(answer).toContainText(
      "A quick look. The first read finds every resource.",
    );
    await expect(
      answer.getByTestId("cloud-resource-groups-regions"),
    ).toContainText("westeurope");
    await expect(answer.getByTestId("cloud-test-cost")).toBeVisible();
    await expect(
      dialog(page).getByTestId("cloud-connection-test-button"),
    ).toHaveText("Test again");
    await expectNoSidewaysScroll(page);
    await shoot(page, "azure-test-pass");

    let state: FixtureState = await fixture(page);
    expect(state.tests).toHaveLength(1);
    expect(state.tests[0]!.body).toEqual({
      provider: "azure",
      config: {
        authMethod: "azure-client-secret",
        tenantId: TENANT,
        clientId: APP,
        cloud: "public",
        readIntervalInMinutes: "5",
      },
      secrets: { clientSecret: PASSWORD },
    });

    await submit(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByTestId("cloud-connect-saved")).toContainText(
      "Connected. The first read starts within a minute",
    );

    state = await fixture(page);
    expect(state.creates).toHaveLength(1);
    expect(state.creates[0]!.provider).toBe("azure");
    expect(state.creates[0]!.isEnabled).toBe(true);
    expect(state.creates[0]!.config).toMatchObject({
      tenantId: TENANT,
      clientId: APP,
    });
    expect(JSON.parse(state.creates[0]!.secrets)).toEqual({
      clientSecret: PASSWORD,
    });
  });

  test("a secret that is not accepted says what to do, the cloud's own words apart", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "verdict=auth&cloud=azure");

    await expect(dialog(page)).toBeVisible();
    await next(page).click();
    await pasteAzureOutput(page);
    await next(page).click();

    const answer: Locator = dialog(page).getByTestId(
      "cloud-connection-test-fail",
    );
    await expect(answer).toContainText("The key or secret was not accepted.");
    await expect(answer).toContainText("Copy everything the command printed");
    await expect(
      dialog(page).getByTestId("cloud-connection-test-details"),
    ).toContainText("AADSTS7000215");
    await expectNoSidewaysScroll(page);
    await shoot(page, "azure-test-fail");
  });
});

test.describe("one paste, whatever the cloud", () => {
  test("Google Cloud: everything Cloud Shell printed - gcloud's lines, then the key - connects", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "cloud=gcp");

    await expect(dialog(page)).toContainText("Connect Google Cloud");
    await next(page).click();

    await pasteBox(page).fill(GCP_OUTPUT);
    await expect(
      dialog(page).getByTestId("cloud-connection-paste-found"),
    ).toContainText("Found: Service account key (JSON)");
    // The key stays folded: its name is said, never what it holds.
    const fold: Locator = dialog(page).getByRole("button", {
      name: "Enter the values yourself",
    });
    await expect(fold).toHaveAttribute("aria-expanded", "false");
    await expect(fold).toContainText("Service account key (JSON)");
    await expect(dialog(page)).not.toContainText("not valid JSON");
    await expectNoSidewaysScroll(page);
    await shoot(page, "gcp-paste");

    // gcloud's own lines do not stop the step, and it tests by itself.
    await next(page).click();

    const answer: Locator = dialog(page).getByTestId(
      "cloud-connection-test-pass",
    );
    await expect(answer).toContainText("12 resources");
    await expect(answer).toContainText("Compute Engine VM Instance");
    await expect(
      answer.getByTestId("cloud-resource-groups-accounts"),
    ).toHaveText("Project: acme-prod");
    await shoot(page, "gcp-test-pass");

    await submit(page).click();
    await expect(dialog(page)).toHaveCount(0);

    const state: FixtureState = await fixture(page);
    expect(state.tests[0]!.body["provider"]).toBe("gcp");
    expect(state.creates).toHaveLength(1);
    // What is stored is the key alone, as Google Cloud wrote it.
    expect(
      JSON.parse(
        JSON.parse(state.creates[0]!.secrets)["serviceAccountJson"] as string,
      ),
    ).toEqual(GCP_KEY);
  });

  test("AWS with a role: the ARN the command printed is pasted like any other output", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "cloud=aws");

    await next(page).click();
    await pasteBox(page).fill(`${ROLE_ARN}\n`);
    await expect(
      dialog(page).getByTestId("cloud-connection-paste-found"),
    ).toContainText("Found: Role ARN");

    await next(page).click();
    await expect(
      dialog(page)
        .getByTestId("cloud-connection-test-pass")
        .getByTestId("cloud-resource-groups-accounts"),
    ).toHaveText("Account: 123456789012");

    const state: FixtureState = await fixture(page);
    expect(state.tests[0]!.body).toEqual({
      provider: "aws",
      config: {
        authMethod: "aws-role",
        roleArn: ROLE_ARN,
        readIntervalInMinutes: "10",
      },
      secrets: {},
    });
  });

  test("Next with nothing pasted says one thing, on the paste, and stays", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "cloud=azure");

    await next(page).click();
    await next(page).click();

    // Still the paste: the step did not go on.
    await expect(pasteBox(page)).toBeVisible();
    await expect(dialog(page).getByTestId("error-message")).toHaveText([
      "Paste everything the command printed.",
    ]);
    await expect(
      dialog(page).getByRole("button", { name: "Enter the values yourself" }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(dialog(page)).not.toContainText("is required");
    // The paste is the step's question, not an option.
    await expect(
      dialog(page).getByText(PASTE_LABEL_MARKED_OPTIONAL),
    ).toHaveCount(0);
    await expectNoSidewaysScroll(page);
    await shoot(page, "azure-paste-missing");
  });
});

test.describe("connecting AWS", () => {
  test("a role first, its command written for this project; an access key the other way", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "cloud=aws");

    await expect(dialog(page)).toContainText("Connect Amazon Web Services");
    const role: Locator = dialog(page).getByRole("radio", { name: /IAM role/ });
    const key: Locator = dialog(page).getByRole("radio", {
      name: /Access key/,
    });
    await expect(role).toBeChecked();

    const code: Locator = dialog(page).getByTestId("cloud-setup-command-code");
    await expect(code).toContainText("aws iam create-role");
    await expect(code).toContainText(
      "oneuptime-6c2b8f0e4d1a9b3c7e5f2a8d0c6b4e1f",
    );
    await expect(code).toContainText("arn:aws:iam::999988887777:root");
    await expect(
      dialog(page).getByTestId("cloud-setup-open-shell"),
    ).toContainText("Open AWS CloudShell");
    await expectNoSidewaysScroll(page);
    await shoot(page, "aws-role-command");

    await key.check();
    await expect(code).toContainText("aws iam create-access-key");
    await expect(code).not.toContainText("create-role");

    const state: FixtureState = await fixture(page);
    expect(state.roleSetupAsks).toBe(1);
  });

  test("a OneUptime that cannot sign in to a role offers an access key, with nothing to choose", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "aws=key&cloud=aws");

    await expect(dialog(page)).toContainText("Connect Amazon Web Services");
    await expect(dialog(page).getByRole("radio")).toHaveCount(0);
    await expect(
      dialog(page).getByTestId("cloud-setup-command-code"),
    ).toContainText("aws iam create-access-key");
  });
});

test.describe("the connected accounts", () => {
  test("how each is doing, what it holds and when it was read", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=connected");

    await expect(page.getByText("Connected accounts")).toBeVisible();
    await expect(page.getByText("AWS 123456789012").first()).toBeVisible();
    await expect(page.getByText("Working").first()).toBeVisible();
    await expect(page.getByText("Not working").first()).toBeVisible();
    await expect(page.getByText("Off", { exact: true }).first()).toBeVisible();
    // How many, as the way to them, and where.
    const count: Locator = page
      .getByTestId("cloud-connection-resource-count")
      .first();
    await expect(count).toHaveText("46 resources");
    await expect(page.getByRole("link", { name: "46 resources" })).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/cloud/resources`,
    );
    await expect(
      page.getByTestId("cloud-connection-regions").first(),
    ).toHaveText("us-east-1, eu-west-1");
    // Under how it is doing: when it was last read, and how often it is.
    await expect(
      page.getByTestId("cloud-connection-last-read").first(),
    ).toHaveText("Last read Oct 21, 09:50");
    await expect(page.getByText("Not read yet")).toBeVisible();
    await expect(page.getByText("Every 10 minutes").first()).toBeVisible();
    // The Google Cloud connection is off: it is not said to be read hourly.
    await expect(page.getByText("Every hour")).toHaveCount(0);
    // A name that says its account is not followed by it again.
    await expect(
      page.getByText("Amazon Web Services", { exact: true }).last(),
    ).toBeVisible();
    await expect(page.getByTestId("cloud-connection-accounts")).toHaveCount(0);
    await expect(
      page.getByTestId("cloud-connection-tile-connected-aws"),
    ).toContainText("Connected");

    await expectNoSidewaysScroll(page);
    await shoot(page, "connect-connected");
  });

  test("beside the side menu, the list fits a 1280 window in English and German, and the tiles never squeeze", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(
      test.info().project.name !== "desktop",
      "Widths beside the side menu: a desktop's.",
    );

    for (const language of ["", "&lang=de"]) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await open(page, `state=connected${language}`);
      await expect(
        page.getByTestId("cloud-connection-resource-count").first(),
      ).toBeVisible();
      // In the reader's words, German's longer ones included.
      await expect(
        page.getByTestId("cloud-connection-last-read").first(),
      ).toContainText(language ? "Zuletzt gelesen" : "Last read");

      // Nothing runs under the sticky actions: the table does not scroll sideways.
      const table: { scroll: number; client: number } = await page.evaluate(
        () => {
          const scroller: HTMLElement = document.querySelector("table")!
            .parentElement as HTMLElement;
          return {
            scroll: scroller.scrollWidth,
            client: scroller.clientWidth,
          };
        },
      );
      expect(table.scroll).toBeLessThanOrEqual(table.client + 1);
    }

    /*
     * 768 and 1024 leave the card too narrow for three tiles side by side:
     * they stack, each as wide as the card, its words on a line or two.
     */
    for (const width of [768, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, "state=connected");

      const tiles: Array<{ x: number; width: number }> = await page
        .getByTestId("cloud-connection-tiles")
        .locator("li")
        .evaluateAll((items: Array<Element>) => {
          return items.map((item: Element) => {
            const box: DOMRect = item.getBoundingClientRect();
            return { x: Math.round(box.x), width: Math.round(box.width) };
          });
        });
      const list: { x: number; width: number } = await page
        .getByTestId("cloud-connection-tiles")
        .evaluate((element: Element) => {
          const box: DOMRect = element.getBoundingClientRect();
          return { x: Math.round(box.x), width: Math.round(box.width) };
        });

      expect(tiles).toHaveLength(3);
      for (const tile of tiles) {
        expect(tile.x).toBe(list.x);
        expect(tile.width).toBe(list.width);
      }
      await expectNoSidewaysScroll(page);
      await page.screenshot({
        path: path.join(SCREENSHOTS, `connect-connected-${width}.png`),
        fullPage: true,
      });
    }
  });

  test("a connection that is not working opens its error in a test's words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=connected");

    await page.getByRole("button", { name: "View error" }).first().click();
    await expect(
      page.getByTestId("cloud-connection-error-words"),
    ).toContainText(
      "Signed in, but this access cannot read what OneUptime needs.",
    );
    await expect(page.getByTestId("cloud-connection-error")).toContainText(
      "Microsoft.Insights/metrics/read",
    );
    await shoot(page, "connect-last-error");
  });

  test("Read now: the row says it is reading, and shows the read once it ends - nothing to refresh by hand", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=connected");

    await page.getByRole("button", { name: "Read now" }).first().click();

    const reading: Locator = page.getByTestId("cloud-connection-reading");
    await expect(reading).toHaveText("Reading now…");
    // Nothing to read in a notice, and no second read to start: Read now stays, locked.
    await expect(page.getByTestId("cloud-connections-notice")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Read now" }).first(),
    ).toBeDisabled();
    await shoot(page, "connect-reading");

    let state: FixtureState = await fixture(page);
    expect(state.readNows).toHaveLength(1);
    expect(state.readNows[0]).toMatch(
      /^(\/api)?\/cloud-connection\/20000000-0000-4000-8000-000000000001\/read-now$/,
    );

    // The read ends: the list asks after it, and shows it.
    await page.evaluate(() => {
      (
        window as unknown as {
          __cloudConnectFixture: { finishRead: (id: string) => void };
        }
      ).__cloudConnectFixture.finishRead(
        "20000000-0000-4000-8000-000000000001",
      );
    });

    await expect(reading).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Read now" }).first(),
    ).toBeEnabled();
    await expect(
      page.getByTestId("cloud-connection-last-read").first(),
    ).not.toHaveText("Last read Oct 21, 09:50");

    state = await fixture(page);
    expect(state.itemAsks).toBeGreaterThan(0);
  });
});

test.describe("a connection's own actions", () => {
  test("Test from a row opens on its answer, in its cloud's words, with Test again beside Close", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=connected");

    await page.getByTestId("row-actions-more-button").first().click();
    await page.getByRole("menuitem", { name: "Test" }).click();

    await expect(dialog(page)).toContainText("Test AWS 123456789012");
    const answer: Locator = dialog(page).getByTestId(
      "cloud-connection-test-pass",
    );
    await expect(answer).toContainText("46 resources");
    await expect(answer).toContainText("EC2 Instance");
    await expect(answer.getByTestId("cloud-resource-groups-accounts")).toHaveText(
      "Account: 123456789012",
    );
    const footer: Locator = dialog(page).getByTestId("modal-footer");
    await expect(
      footer.getByTestId("cloud-connection-test-button"),
    ).toHaveText("Test again");
    await expect(footer.getByRole("button", { name: "Close" })).toBeVisible();
    await expectNoSidewaysScroll(page);
    await shoot(page, "connect-row-test");

    await footer.getByTestId("cloud-connection-test-button").click();
    await expect(answer).toContainText("46 resources");

    const state: FixtureState = await fixture(page);
    expect(state.tests).toHaveLength(2);
    expect(state.tests[0]!.body).toEqual({
      connectionId: "20000000-0000-4000-8000-000000000001",
    });
  });

  test("a connection deleted from the list is counted at once: its cloud's tile no longer says Connected", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=connected");

    await expect(
      page.getByTestId("cloud-connection-tile-connected-azure"),
    ).toBeVisible();

    // Contoso production, the one Azure connection, is the second row.
    await page.getByTestId("row-actions-more-button").nth(1).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await dialog(page).getByTestId("modal-footer-submit-button").click();

    await expect(
      page.getByTestId("cloud-connection-tile-connected-azure"),
    ).toHaveCount(0);
    await expect(page.getByTestId("cloud-connection-tile-azure")).toContainText(
      "Connect",
    );
    await expect(
      page.getByTestId("cloud-connection-tile-connected-aws"),
    ).toBeVisible();
    await expect(page.getByText("Contoso production")).toHaveCount(0);
  });
});

test.describe("who may connect", () => {
  test("a member sees the clouds greyed, says why, and asks nothing about roles", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "role=member");

    for (const provider of ["aws", "azure", "gcp"]) {
      await expect(
        page.getByTestId(`cloud-connection-tile-${provider}`),
      ).toBeDisabled();
    }
    await expect(page.getByTestId("cloud-connect-locked")).toBeVisible();

    const state: FixtureState = await fixture(page);
    expect(state.roleSetupAsks).toBe(0);
  });
});

test.describe("in the dark and in another language", () => {
  test("the dark theme draws the tiles dark", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "theme=dark&state=connected");

    const background: string = await page
      .getByTestId("cloud-connection-tile-aws")
      .evaluate((element: Element): string => {
        return window.getComputedStyle(element).backgroundColor;
      });
    expect(background).not.toBe("rgb(255, 255, 255)");

    await expectNoSidewaysScroll(page);
    await shoot(page, "connect-dark");

    await page.getByTestId("cloud-connection-tile-azure").click();
    await expect(dialog(page)).toBeVisible();
    await shoot(page, "azure-command-dark");
  });

  test("Japanese: the page and the form read in Japanese", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=ja");

    await expect(page.getByTestId("cloud-connect-promises")).toContainText(
      JAPANESE_SCRIPT,
    );
    await expect(page.getByTestId("cloud-connection-tile-aws")).toContainText(
      JAPANESE_SCRIPT,
    );
    await expectNoSidewaysScroll(page);
    await shoot(page, "connect-ja");

    await page.getByTestId("cloud-connection-tile-gcp").click();
    await expect(dialog(page).getByTestId("cloud-setup-command")).toContainText(
      JAPANESE_SCRIPT,
    );
    await expect(
      dialog(page).getByTestId("cloud-setup-command-code"),
    ).toContainText("gcloud iam service-accounts keys create");
    await expectNoSidewaysScroll(page);
    await shoot(page, "gcp-command-ja");
  });
});
