import { expect, Locator, Page, test } from "@playwright/test";
import path from "path";

/*
 * Cloud > Connect, end to end in a browser, on the real page
 * (CloudConnect/Fixture.js). A customer found connecting AWS, Azure and
 * Google Cloud to OneUptime hard - it took an OpenTelemetry Collector
 * configuration - and asked for a button. What is pinned here is what a
 * person sees and what is sent: a tile per cloud, the one command in the
 * cloud's own browser terminal, one paste of what it printed, a test that
 * says what it found and what reading it costs, an AWS role or an access
 * key, and the list's status and actions - at desktop and phone width, in
 * the dark theme and in Japanese.
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
  roleSetupAsks: number;
}

async function open(page: Page, query: string = ""): Promise<void> {
  await page.goto(`/?${query}`);
  await expect(page.getByTestId("fixture-page")).toBeVisible();
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

    // Step 3: the test.
    await next(page).click();
    await dialog(page).getByTestId("cloud-connection-test-button").click();
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
    await dialog(page).getByTestId("cloud-connection-test-button").click();

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
    await expect(
      page.getByText("46 resources in 2 regions").first(),
    ).toBeVisible();
    await expect(page.getByText("Every 10 minutes").first()).toBeVisible();
    await expect(page.getByText("Every hour").first()).toBeVisible();
    await expect(
      page.getByTestId("cloud-connection-tile-connected-aws"),
    ).toContainText("Connected");

    await expectNoSidewaysScroll(page);
    await shoot(page, "connect-connected");
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

  test("Read now queues a read and says how to see it end", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=connected");

    await page.getByRole("button", { name: "Read now" }).first().click();
    await expect(page.getByTestId("cloud-connections-notice")).toContainText(
      "Refresh the list in a minute",
    );

    const state: FixtureState = await fixture(page);
    expect(state.readNows).toHaveLength(1);
    expect(state.readNows[0]).toMatch(
      /^(\/api)?\/cloud-connection\/20000000-0000-4000-8000-000000000001\/read-now$/,
    );
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
