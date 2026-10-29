import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
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
 * in Japanese. What to read - one account, or every account of its
 * organization - changes the command and what the read asks for. And
 * Cloud > Accounts: the accounts the connections read, each one's
 * Overview and Resources.
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
    ).toContainText(
      "OneUptime can only read: resources, metrics and the activity log. Never data or secrets.",
    );
    // What to read: the subscription the command is run in, unless told otherwise.
    await expect(
      dialog(page).getByRole("radio", { name: "This subscription" }),
    ).toBeChecked();
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
        readScope: "account",
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
        readScope: "account",
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

  /*
   * What to read sits above the command, which follows it: this account by
   * default, or every account of the AWS Organization - a StackSet run in
   * the management account - and the read asks for the organization too.
   * An access key's user reads its own account only, so it is not asked.
   */
  test("What to read: this account first, the organization a click away, and the command and the test follow", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "cloud=aws");

    const scope: Locator = dialog(page).getByTestId("cloud-connection-scope");
    const one: Locator = dialog(page).getByRole("radio", {
      name: "This account",
    });
    const every: Locator = dialog(page).getByRole("radio", {
      name: "Every account in the organization",
    });
    const code: Locator = dialog(page).getByTestId("cloud-setup-command-code");

    await expect(
      dialog(page).getByRole("radiogroup", { name: "What to read" }),
    ).toBeVisible();
    await expect(one).toBeChecked();
    await expect(code).not.toContainText("create-stack-set");

    await every.check();
    await expect(code).toContainText(
      "aws cloudformation activate-organizations-access",
    );
    await expect(code).toContainText("--permission-model SERVICE_MANAGED");
    // The management account's own role, the one that may list the accounts.
    await expect(code).toContainText("organizations:ListAccounts");
    await expect(code).toContainText(
      'aws iam get-role --role-name "$ROLE" --query Role.Arn --output text',
    );
    await expectNoSidewaysScroll(page);
    await shoot(page, "aws-organization-command");

    // An access key reads its own account: nothing to choose, one account's command.
    await dialog(page)
      .getByRole("radio", { name: /Access key/ })
      .check();
    await expect(scope).toHaveCount(0);
    await expect(code).toContainText("aws iam create-access-key");
    await expect(code).not.toContainText("create-stack-set");

    // Back to the role: the organization is still what it reads.
    await dialog(page)
      .getByRole("radio", { name: /IAM role/ })
      .check();
    await expect(every).toBeChecked();

    await next(page).click();
    await pasteBox(page).fill(`${ROLE_ARN}\n`);
    await next(page).click();
    await expect(
      dialog(page).getByTestId("cloud-connection-test-pass"),
    ).toBeVisible();

    let state: FixtureState = await fixture(page);
    expect(state.tests[0]!.body["config"]).toMatchObject({
      authMethod: "aws-role",
      readScope: "organization",
      roleArn: ROLE_ARN,
    });

    await submit(page).click();
    await expect(dialog(page)).toHaveCount(0);

    state = await fixture(page);
    expect(state.creates[0]!.config).toMatchObject({
      authMethod: "aws-role",
      readScope: "organization",
    });
  });

  test("every subscription of an Azure tenant, every project of a Google Cloud organization: the command grants the role there", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "cloud=azure");

    const azureCode: Locator = dialog(page).getByTestId(
      "cloud-setup-command-code",
    );
    await expect(azureCode).toContainText(
      'SCOPE="/subscriptions/$(az account show --query id --output tsv)"',
    );
    await dialog(page)
      .getByRole("radio", { name: "Every subscription in the tenant" })
      .check();
    await expect(azureCode).toContainText(
      "/providers/Microsoft.Management/managementGroups/",
    );
    // The secret's expiry is printed with the rest, for OneUptime to warn about.
    await expect(azureCode).toContainText("endDateTime");
    await shoot(page, "azure-organization-command");

    await open(page, "cloud=gcp");

    const gcpCode: Locator = dialog(page).getByTestId(
      "cloud-setup-command-code",
    );
    await expect(
      dialog(page).getByRole("radio", { name: "This project" }),
    ).toBeChecked();
    await expect(gcpCode).not.toContainText(
      "gcloud organizations add-iam-policy-binding",
    );
    await dialog(page)
      .getByRole("radio", { name: "Every project in the organization" })
      .check();
    await expect(gcpCode).toContainText(
      "gcloud organizations add-iam-policy-binding",
    );
    await expect(gcpCode).toContainText("roles/servicehealth.viewer");
    await expectNoSidewaysScroll(page);
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
    await expect(
      page.getByRole("link", { name: "46 resources" }),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/cloud/resources`);
    await expect(
      page.getByTestId("cloud-connection-regions").first(),
    ).toHaveText("us-east-1, eu-west-1");
    // What its activity log and AWS Health added on the last read.
    await expect(
      page.getByTestId("cloud-connection-changes").first(),
    ).toHaveText("12 new changes");
    // A read that added none says nothing about it.
    await expect(page.getByTestId("cloud-connection-changes")).toHaveCount(1);
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

test.describe("just connected", () => {
  test("a connection waiting for its first read shows what the read found as soon as it ends, nothing pressed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=new");

    await expect(page.getByText("Waiting for the first read")).toBeVisible();
    await expect(page.getByText("None yet")).toBeVisible();
    // Quiet: no "Reading now", and Read now is free.
    await expect(page.getByTestId("cloud-connection-reading")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Read now" })).toBeEnabled();
    await shoot(page, "connect-new");

    await page.evaluate(() => {
      (
        window as unknown as {
          __cloudConnectFixture: { finishRead: (id: string) => void };
        }
      ).__cloudConnectFixture.finishRead(
        "20000000-0000-4000-8000-000000000004",
      );
    });

    await expect(page.getByText("Working", { exact: true })).toBeVisible();
    await expect(
      page.getByTestId("cloud-connection-resource-count"),
    ).toHaveText("37 resources");
    await expect(page.getByTestId("cloud-connection-regions")).toHaveText(
      "westeurope, northeurope",
    );
    await expect(page.getByTestId("cloud-connection-last-read")).toContainText(
      "Last read",
    );
    await shoot(page, "connect-new-read");
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
    await expect(
      answer.getByTestId("cloud-resource-groups-accounts"),
    ).toHaveText("Account: 123456789012");
    const footer: Locator = dialog(page).getByTestId("modal-footer");
    await expect(footer.getByTestId("cloud-connection-test-button")).toHaveText(
      "Test again",
    );
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

/*
 * Cloud > Accounts: the AWS accounts, Azure subscriptions and Google Cloud
 * projects the connections read, each a page of its own - what it holds by
 * type and Region, which connection reads it and how lately - and its
 * Resources, found by owner and label as on All Resources. An empty list
 * says in one line why it is empty, and the way in is under it.
 */
const ACCOUNTS_PATH: string = `/dashboard/${PROJECT_ID}/cloud/accounts`;
const AWS_ACCOUNT: string = "30000000-0000-4000-8000-000000000001";
const AZURE_ACCOUNT: string = "30000000-0000-4000-8000-000000000002";
const GCP_ACCOUNT: string = "30000000-0000-4000-8000-000000000003";

interface ListRequest {
  model: string;
  cloudProvider?: string;
  cloudAccountIds?: Array<string>;
  isArchived?: boolean;
}

async function openAccounts(page: Page, address: string): Promise<void> {
  await page.goto(address);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function listRequests(page: Page): Promise<Array<ListRequest>> {
  return await page.evaluate(() => {
    return JSON.parse(
      JSON.stringify(
        (
          window as unknown as {
            __cloudConnectFixture: { state: { listRequests: unknown } };
          }
        ).__cloudConnectFixture.state.listRequests,
      ),
    );
  });
}

// The side menu beside a page (a phone folds it behind a button).
function sideMenu(page: Page): Locator {
  return page.getByRole("navigation", { name: "Main navigation" }).first();
}

// One row of an account's Resources by type or by Region: its words and its count.
function countRow(card: Locator, label: string): Locator {
  return card.getByRole("listitem").filter({ hasText: label });
}

test.describe("cloud accounts", () => {
  test("the list: each account a connection reads, what it holds, and its page a click away", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(page, `${ACCOUNTS_PATH}?state=connected`);

    await expect(page.getByText("Cloud Accounts").first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Production", exact: true }),
    ).toBeVisible();
    // Under each name, its cloud and its id there; an id that is its name, once.
    const where: Locator = page.getByTestId("cloud-account-where");
    await expect(where.nth(0)).toHaveText("AWS · 123456789012");
    await expect(where.nth(1)).toHaveText(
      "Azure · 7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b",
    );
    await expect(where.nth(2)).toHaveText("Google Cloud");
    await expect(
      page.getByRole("link", { name: "acme-legacy", exact: true }),
    ).toBeVisible();
    // A connection adds accounts: there is nothing to create here.
    await expect(
      page
        .getByTestId("card-header-actions")
        .first()
        .getByRole("button", { name: /^Create / }),
    ).toHaveCount(0);
    await expect(page.getByTestId("cloud-connect-callout")).toHaveCount(0);
    // Beside the list, the side menu says where this is: Cloud > Accounts.
    if (test.info().project.name === "desktop") {
      await expect(
        sideMenu(page).getByRole("link", { name: "Accounts", exact: true }),
      ).toHaveAttribute("aria-current", "page");
    }
    await expectNoSidewaysScroll(page);
    await shoot(page, "accounts-list");

    await page.getByRole("link", { name: "Production", exact: true }).click();
    await expect(page).toHaveURL(`${ACCOUNTS_PATH}/${AWS_ACCOUNT}`);
    await expect(page.getByTestId("resource-overview-status")).toHaveText(
      "Reading",
    );
  });

  /*
   * An Azure subscription's id is 36 characters: under its name, with the
   * Regions column left for those who ask for it, Last Read and Labels stay
   * clear of the row's actions.
   */
  test("beside the side menu, the list fits a 1280 window in English and German", async ({
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
      await openAccounts(page, `${ACCOUNTS_PATH}?state=connected${language}`);
      await expect(page.getByTestId("cloud-account-where").first()).toHaveText(
        "AWS · 123456789012",
      );

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
      await expectNoSidewaysScroll(page);
    }

    await shoot(page, "accounts-list-de");
  });

  test("nothing connected: the list says why in one line, and the way in is under it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(page, `${ACCOUNTS_PATH}?state=empty`);

    const empty: Locator = page.locator('[data-empty-state-kind="empty"]');
    await expect(empty).toContainText("No cloud accounts yet");
    await expect(empty).toContainText(
      "An account appears here once a cloud connection reads it.",
    );
    const callout: Locator = page.getByTestId("cloud-connect-callout");
    await expect(callout).toContainText("Connect a cloud account");

    for (const provider of ["aws", "azure", "gcp"]) {
      await expect(
        callout.getByTestId(`cloud-connection-tile-${provider}`),
      ).toBeEnabled();
    }

    await expectNoSidewaysScroll(page);
    await shoot(page, "accounts-empty");
  });

  test("an account's Overview: which cloud and account, the connection that reads it, and what it holds by type and Region", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(page, `${ACCOUNTS_PATH}/${AWS_ACCOUNT}?state=connected`);

    await expect(
      page
        .getByTestId("resource-overview-title-block")
        .getByRole("heading", { name: "Production", level: 1 }),
    ).toBeVisible();
    await expect(page.getByTestId("resource-overview-status")).toHaveText(
      "Reading",
    );
    await expect(
      page.getByTestId("resource-overview-title-block"),
    ).toContainText("123456789012");

    // The tiles: how many resources (the way to them), Regions and types.
    await expect(
      page.getByRole("link", { name: "View Resources" }),
    ).toHaveAttribute("href", `${ACCOUNTS_PATH}/${AWS_ACCOUNT}/resources`);
    await expect(
      page.getByText("Resource Types", { exact: true }),
    ).toBeVisible();

    // The Details card: the account's cloud, its name there and its connection.
    const details: Locator = page.getByTestId("resource-overview-details");
    await expect(details).toContainText("AWS");
    await expect(details).toContainText("acme-production");
    await expect(
      details.getByRole("link", { name: "AWS 123456789012" }),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/cloud/connect`);

    // What it holds, most first, in its cloud's words.
    const byType: Locator = page
      .getByTestId("card")
      .filter({ hasText: "Resources by Type" });
    await expect(countRow(byType, "EC2 Instance")).toContainText("24");
    await expect(countRow(byType, "RDS DB Instance")).toContainText("9");
    await expect(byType.getByRole("listitem").first()).toContainText(
      "EC2 Instance",
    );
    const byRegion: Locator = page
      .getByTestId("card")
      .filter({ hasText: "Resources by Region" });
    await expect(countRow(byRegion, "us-east-1")).toContainText("31");
    await expect(countRow(byRegion, "eu-west-1")).toContainText("15");

    // Its pages, in its own side menu beside it.
    if (test.info().project.name === "desktop") {
      for (const name of ["Overview", "Resources", "Topology", "Changes"]) {
        await expect(
          sideMenu(page).getByRole("link", { name: name, exact: true }),
        ).toBeVisible();
      }
    }

    await expectNoSidewaysScroll(page);
    await shoot(page, "account-overview");
  });

  test("an account whose connection stopped reading warns, and one no connection reads says so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(
      page,
      `${ACCOUNTS_PATH}/${AZURE_ACCOUNT}?state=connected`,
    );
    await expect(page.getByTestId("resource-overview-status")).toHaveText(
      "Not read lately",
    );

    await openAccounts(page, `${ACCOUNTS_PATH}/${GCP_ACCOUNT}?state=connected`);
    await expect(page.getByTestId("resource-overview-status")).toHaveText(
      "Not connected",
    );
    // No connection: no link to one.
    await expect(
      page.getByTestId("resource-overview-details").getByRole("link"),
    ).toHaveCount(0);
  });

  test("an account's Resources: its own and no other, each a click from its page, found by owner and label", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(
      page,
      `${ACCOUNTS_PATH}/${AWS_ACCOUNT}/resources?state=connected`,
    );

    await expect(
      page.getByRole("link", { name: "web-alb", exact: true }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/cloud/40000000-0000-4000-8000-000000000001`,
    );
    await expect(
      page.getByText("Elastic Load Balancer (ALB, NLB, GWLB)").first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "orders-db", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Not reporting").first()).toBeVisible();

    // Read by the account's cloud and id, archived ones left out.
    const reads: Array<ListRequest> = (await listRequests(page)).filter(
      (request: ListRequest): boolean => {
        return request.model === "CloudResource";
      },
    );
    expect(reads.length).toBeGreaterThan(0);
    expect(reads[0]).toMatchObject({
      cloudProvider: "aws",
      isArchived: false,
    });
    expect(reads[0]!.cloudAccountIds).toContain("123456789012");

    /*
     * The Owner and Labels chips over the table, as on All Resources. A
     * phone folds a list's chips behind Filter (FacetFilterBar), and one
     * press on it draws them.
     */
    const bar: Locator = page.getByTestId("facet-filter-bar");
    if (test.info().project.name !== "desktop") {
      const filter: Locator = bar.getByTestId("facet-filter-bar-toggle");
      await expect(bar).toHaveAttribute("data-folded", "true");
      await expect(bar.getByRole("button", { name: /^Owner/ })).toBeHidden();
      await filter.click();
      await expect(filter).toHaveAttribute("aria-expanded", "true");
    }
    await expect(bar.getByRole("button", { name: /^Owner/ })).toBeVisible();
    await expect(bar.getByRole("button", { name: /^Labels/ })).toBeVisible();

    await expectNoSidewaysScroll(page);
    await shoot(page, "account-resources");
  });

  test("dark and German: the Overview reads in German on a dark page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(
      page,
      `${ACCOUNTS_PATH}/${AWS_ACCOUNT}?state=connected&theme=dark&lang=de`,
    );

    await expect(page.getByTestId("resource-overview-status")).toBeVisible();
    await expect(page.locator("html")).toHaveClass(/dark/);
    // Nothing on the Overview is wider than the window.
    await expectNoSidewaysScroll(page);
    await shoot(page, "account-overview-dark-de");
  });
});

/*
 * ---------------------------------------------------------------------------
 * An account's and a resource's own pages, as the UI review left them: the
 * list's status beside each name, the Overview's four tiles and its counts
 * side by side, Resources with each one's status and when it was last
 * seen, Changes that keep the time whole and say only what a row does not,
 * the account's map, its Settings in words, and a resource's inventory,
 * open incidents and alerts, and changes.
 * ---------------------------------------------------------------------------
 */

const RESOURCE_PATH: string = `/dashboard/${PROJECT_ID}/cloud`;
// The fixture's AWS resources (Fixture.js AWS_RESOURCES).
const WEB_ALB: string = "40000000-0000-4000-8000-000000000001";
const ORDERS_DB: string = "40000000-0000-4000-8000-000000000002";
const WEB_1: string = "40000000-0000-4000-8000-000000000004";
const WEB_2: string = "40000000-0000-4000-8000-000000000005";
const PROD_VPC: string = "40000000-0000-4000-8000-000000000006";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ChangeListRequest {
  model: string;
  attributes?: Record<string, string>;
}

// The map's count of Regions: its number, then its word.
const TWO_REGIONS: RegExp = /^\s*2\s*Regions\s*$/;

function isDesktop(): boolean {
  return test.info().project.name === "desktop";
}

// A box's place on the page, once laid out.
async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();
  expect(box, "the element is laid out").not.toBeNull();
  return box!;
}

// The card that holds a heading's words.
function cardTitled(page: Page, title: string): Locator {
  return page.getByTestId("card").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
}

// One overview tile, found by its title.
function tile(page: Page, title: string): Locator {
  return page
    .getByTestId("resource-overview-tiles")
    .locator(":scope > div")
    .filter({ has: page.getByText(title, { exact: true }) });
}

async function headerTexts(page: Page): Promise<Array<string>> {
  return (await page.locator("thead th").allInnerTexts()).map(
    (text: string): string => {
      return text.trim();
    },
  );
}

test.describe("an account's pages", () => {
  test("the list: how each account is read, right after its name", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(page, `${ACCOUNTS_PATH}?state=connected`);

    const statuses: Locator = page.getByTestId("cloud-account-status");
    await expect(statuses).toHaveCount(3);
    await expect(statuses.nth(0)).toContainText("Reading");
    await expect(statuses.nth(1)).toContainText("Not read lately");
    await expect(statuses.nth(2)).toContainText("Not connected");
    // When a connection last read each one, under its pill.
    for (let index: number = 0; index < 3; index++) {
      await expect(statuses.nth(index)).toContainText("Last read ");
    }

    if (!isDesktop()) {
      return;
    }

    // The status comes right after the name, before the counts.
    const headers: Array<string> = await headerTexts(page);
    expect(headers.indexOf("Status")).toBeGreaterThan(headers.indexOf("Name"));
    expect(headers.indexOf("Status")).toBeLessThan(
      headers.indexOf("Resources"),
    );

    // Beside the side menu at 1024, the pills are clear of the row's actions.
    await page.setViewportSize({ width: 1024, height: 900 });
    await openAccounts(page, `${ACCOUNTS_PATH}?state=connected`);
    const pill: Box = await boxOf(
      page.getByTestId("cloud-account-status").first().getByTestId("pill"),
    );
    const view: Box = await boxOf(
      page.getByRole("button", { name: "View" }).first(),
    );
    expect(pill.x + pill.width).toBeLessThanOrEqual(view.x);
  });

  test("an account's Overview: four tiles in a row, the last day's changes a click away, its counts side by side", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(page, `${ACCOUNTS_PATH}/${AWS_ACCOUNT}?state=connected`);

    // The Changes tile counts the last day's, and leads to them.
    const changes: Locator = tile(page, "Changes");
    await expect(changes).toContainText("6");
    await expect(changes).toContainText("Last 24 hours");
    await expect(
      page.getByRole("link", { name: "View Changes" }),
    ).toHaveAttribute("href", `${ACCOUNTS_PATH}/${AWS_ACCOUNT}/changes`);

    // The Details card says what its rows are, not that telemetry sent them.
    const details: Locator = cardTitled(page, "Details");
    await expect(details).toContainText(
      "Which account it is in its cloud, and the connection that reads it.",
    );
    await expect(details).not.toContainText("OpenTelemetry");

    // A name is words; an id is set in mono.
    const fontOf: (label: string) => Promise<string> = async (
      label: string,
    ): Promise<string> => {
      return page
        .getByTestId("resource-overview-detail-row")
        .filter({ hasText: label })
        .getByTestId("resource-overview-detail-value")
        .evaluate((element: Element): string => {
          return getComputedStyle(element).fontFamily;
        });
    };
    expect(await fontOf("Name in the Cloud")).not.toContain("monospace");
    expect(await fontOf("Account ID")).toContain("monospace");

    // Each count with a bar for its share; the Regions' too.
    const types: Locator = page.getByTestId("cloud-account-types");
    const regions: Locator = page.getByTestId("cloud-account-regions");
    await expect(countRow(types, "EC2 Instance")).toContainText("24");
    await expect(countRow(regions, "us-east-1")).toContainText("31");

    const tiles: Array<Box> = [];
    for (const title of ["Resources", "Regions", "Resource Types", "Changes"]) {
      tiles.push(await boxOf(tile(page, title)));
    }

    const typesBox: Box = await boxOf(cardTitled(page, "Resources by Type"));
    const regionsBox: Box = await boxOf(
      cardTitled(page, "Resources by Region"),
    );

    if (isDesktop()) {
      // One row of four at 1280.
      for (const box of tiles) {
        expect(Math.abs(box.y - tiles[0]!.y)).toBeLessThanOrEqual(1);
      }
      // By type and by Region side by side.
      expect(Math.abs(typesBox.y - regionsBox.y)).toBeLessThanOrEqual(1);
      expect(regionsBox.x).toBeGreaterThan(typesBox.x);
    } else {
      // Two rows of two on a phone, the counts one above the other.
      expect(Math.abs(tiles[0]!.y - tiles[1]!.y)).toBeLessThanOrEqual(1);
      expect(tiles[2]!.y).toBeGreaterThan(tiles[0]!.y);
      expect(Math.abs(tiles[2]!.y - tiles[3]!.y)).toBeLessThanOrEqual(1);
      expect(regionsBox.y).toBeGreaterThan(typesBox.y);
    }

    await expectNoSidewaysScroll(page);
    await shoot(page, "account-overview-tiles");
  });

  test("an account with no changes lately counts none", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(!isDesktop(), "One count: a desktop's.");

    await openAccounts(
      page,
      `${ACCOUNTS_PATH}/${AZURE_ACCOUNT}?state=connected`,
    );
    await expect(tile(page, "Changes")).toContainText("0");
  });

  test("an account's Resources: each one's status and when it was last seen, in one column that fits", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(
      page,
      `${ACCOUNTS_PATH}/${AWS_ACCOUNT}/resources?state=connected`,
    );

    const statuses: Locator = page.getByTestId("cloud-account-resource-status");
    await expect(statuses).toHaveCount(8);
    await expect(statuses.first()).toContainText("Reporting");
    await expect(statuses.first()).toContainText("Last seen ");
    await expect(
      statuses.filter({ hasText: "Not reporting" }).first(),
    ).toBeVisible();

    // What it is and where, under its name, on a phone too.
    await expect(
      page.getByTestId("cloud-account-resource-where").first(),
    ).toHaveText("Elastic Load Balancer (ALB, NLB, GWLB) · us-east-1");

    if (!isDesktop()) {
      return;
    }

    // No column of its own for when each was last seen, or for its Region.
    expect(await headerTexts(page)).not.toContain("Last Seen");
    expect(await headerTexts(page)).not.toContain("Region");

    // Beside the side menu at 1280, in English and German, nothing scrolls sideways.
    for (const language of ["", "&lang=de"]) {
      await openAccounts(
        page,
        `${ACCOUNTS_PATH}/${AWS_ACCOUNT}/resources?state=connected${language}`,
      );
      await expect(statuses.first()).toBeVisible();
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
  });

  test("an account's Changes: newest first, the time whole, a provider's words only where they add something", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(
      page,
      `${ACCOUNTS_PATH}/${AWS_ACCOUNT}/changes?state=connected`,
    );

    await expect(
      page.getByText("AuthorizeSecurityGroupIngress on sg-0f1e2d3c4b5a69788"),
    ).toBeVisible();

    // Read by the account's own row.
    const reads: Array<ChangeListRequest> = (
      (await listRequests(page)) as Array<ChangeListRequest>
    ).filter((request: ChangeListRequest): boolean => {
      return request.model === "ChangeEvent";
    });
    expect(reads.length).toBeGreaterThan(0);
    expect(reads[0]!.attributes).toEqual({
      "oneuptime.cloud_account.id": AWS_ACCOUNT,
    });

    // Only the health event keeps a line of its own words.
    const details: Locator = page.getByTestId("cloud-change-detail");
    await expect(details).toHaveCount(1);
    await expect(details).toContainText(
      "We are investigating increased API error rates",
    );
    await expect(
      page.getByText("ran AuthorizeSecurityGroupIngress"),
    ).toHaveCount(0);

    if (!isDesktop()) {
      return;
    }

    const rows: Locator = page.locator("tbody tr");
    await expect(rows).toHaveCount(6);
    expect(await headerTexts(page)).toContain("What changed");

    // Who did it, on one line; where; and the failed one says so.
    await expect(page.getByTestId("cloud-change-actor").first()).toHaveText(
      "maya.lopez",
    );
    await expect(
      rows
        .filter({ hasText: "DeleteLoadBalancer" })
        .getByText("Failed", { exact: true }),
    ).toBeVisible();
    await expect(
      rows.filter({ hasText: "ModifyDBInstance" }).getByText("eu-west-1"),
    ).toBeVisible();

    // The time is never cut short, at 1280 or beside the side menu at 1024.
    for (const width of [1280, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      const cut: Array<boolean> = await page
        .locator("tbody tr td:nth-child(2) > div")
        .evaluateAll((cells: Array<Element>): Array<boolean> => {
          return cells.map((cell: Element): boolean => {
            return cell.scrollWidth > cell.clientWidth + 1;
          });
        });
      expect(cut).toEqual([false, false, false, false, false, false]);
    }

    await shoot(page, "account-changes");
  });

  test("a resource's Changes: only those its account's log tied to it", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(!isDesktop(), "The list's rows: a desktop's.");

    await openAccounts(
      page,
      `${RESOURCE_PATH}/${WEB_ALB}/changes?state=connected`,
    );

    await expect(page.locator("tbody tr")).toHaveCount(2);
    await expect(
      page.getByText("Failed: DeleteLoadBalancer on web-alb"),
    ).toBeVisible();
    await expect(
      page.getByText("ModifyLoadBalancerAttributes on web-alb"),
    ).toBeVisible();
    // One place: no Region column.
    expect(await headerTexts(page)).not.toContain("Region");
  });

  test("an account's Topology: its Regions, what runs in them, and what needs attention", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(!isDesktop(), "The map: a desktop's.");

    await openAccounts(
      page,
      `${ACCOUNTS_PATH}/${AWS_ACCOUNT}/topology?state=connected`,
    );

    // Counted above the map: its Regions, and what needs attention.
    await expect(
      page.getByTestId("resource-topology-count-cloud.region"),
    ).toHaveText(TWO_REGIONS);
    const issues: Locator = page.getByTestId("resource-topology-issue-summary");
    await expect(issues).toContainText("1 open incident");
    await expect(issues).toContainText("1 open alert");
    for (const name of ["us-east-1", "eu-west-1", "web-alb", "orders-db"]) {
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    }

    // The account's own resources, and their open incidents and alerts.
    const reads: Array<ListRequest> = await listRequests(page);
    expect(
      reads.some((request: ListRequest): boolean => {
        return (
          request.model === "CloudResource" &&
          request.cloudProvider === "aws" &&
          (request.cloudAccountIds || []).includes("123456789012")
        );
      }),
    ).toBe(true);
    for (const model of ["Incident", "Alert"]) {
      expect(
        reads.some((request: ListRequest): boolean => {
          return request.model === model;
        }),
      ).toBe(true);
    }

    await shoot(page, "account-topology");
  });

  test("an account's Settings name its cloud in words", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(!isDesktop(), "One card: a desktop's.");

    await openAccounts(
      page,
      `${ACCOUNTS_PATH}/${AWS_ACCOUNT}/settings?state=connected`,
    );

    const card: Locator = cardTitled(page, "Account Details");
    await expect(card).toContainText("AWS");
    await expect(card.getByText("aws", { exact: true })).toHaveCount(0);
    await expect(card).toContainText("acme-production");
  });
});

test.describe("a cloud resource's pages", () => {
  test("its Overview: what its cloud says it is, its open issues, and what its inventory lists", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(page, `${RESOURCE_PATH}/${WEB_ALB}?state=connected`);

    const details: Locator = cardTitled(page, "Details");
    await expect(details).toContainText(
      "What its cloud says it is, where it is, and how OneUptime reads it.",
    );
    await expect(details).toContainText("AWS Cloud Control");

    // Its open incident, a click from its Incidents.
    await expect(page.getByText("Active Incidents")).toBeVisible();

    // What it sends traffic to, each a link to its page.
    const connected: Locator = cardTitled(page, "Connected Resources");
    await expect(connected).toContainText("Sends traffic to");
    await expect(
      connected.getByRole("link", { name: "web-1" }),
    ).toHaveAttribute("href", `${RESOURCE_PATH}/${WEB_1}`);
    await expect(
      connected.getByRole("link", { name: "web-2" }),
    ).toHaveAttribute("href", `${RESOURCE_PATH}/${WEB_2}`);
    await expect(connected).toContainText("Protected by");

    await expect(cardTitled(page, "Endpoints")).toContainText(
      "web-alb-1234567890.us-east-1.elb.amazonaws.com",
    );
    await expect(cardTitled(page, "Tags")).toContainText("storefront");
    await expect(cardTitled(page, "Configuration")).toContainText(
      "internet-facing",
    );
    // A load balancer reports metrics: its card is there.
    await expect(cardTitled(page, "Metrics")).toHaveCount(1);

    await expectNoSidewaysScroll(page);
    await shoot(page, "resource-overview");
  });

  test("a network's Overview lists what runs in it, and no Metrics card", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(!isDesktop(), "One page: a desktop's.");

    await openAccounts(page, `${RESOURCE_PATH}/${PROD_VPC}?state=connected`);

    const connected: Locator = cardTitled(page, "Connected Resources");
    await expect(connected).toContainText("Runs here");
    await expect(connected.getByRole("link", { name: "web-1" })).toBeVisible();
    await expect(cardTitled(page, "Tags")).toContainText("prod-vpc");
    await expect(cardTitled(page, "Metrics")).toHaveCount(0);
  });

  test("its Incidents and Alerts: the ones linked to it", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(!isDesktop(), "The lists: a desktop's.");

    await openAccounts(
      page,
      `${RESOURCE_PATH}/${WEB_ALB}/incidents?state=connected`,
    );
    await expect(page.getByText("Checkout pages answer slowly")).toBeVisible();

    await openAccounts(
      page,
      `${RESOURCE_PATH}/${ORDERS_DB}/alerts?state=connected`,
    );
    await expect(page.getByText("orders-db CPU above 90%")).toBeVisible();
  });
});

/*
 * ---------------------------------------------------------------------------
 * OneUptime AI on a cloud account. It reads every connected account already;
 * a Cloud AI agent in the account lets it fix problems too. Pinned here: the
 * AI agent card on the Overview and its one button, Let AI fix problems -
 * one question, one command for the cloud's own shell, the rest under More
 * fields, the agent connecting on its own while the dialog waits - and the
 * account's AI agent and AI Logs pages, at 1280 and 390 pixels, in the dark
 * theme, in German and right to left in Persian, and when the status read
 * fails.
 * ---------------------------------------------------------------------------
 */

const AI_AGENT_PATH: string = `${ACCOUNTS_PATH}/${AWS_ACCOUNT}/ai/agent`;
const AI_LOGS_PATH: string = `${ACCOUNTS_PATH}/${AWS_ACCOUNT}/ai/logs`;

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        `../../App/FeatureSet/Dashboard/src/Locales/${language}.json`,
      ),
      "utf8",
    ),
  );
}

const GERMAN: Record<string, string> = readLocale("de");
const PERSIAN: Record<string, string> = readLocale("fa");

// A word as a locale draws it (a template's {{values}} filled in).
function wordIn(
  locale: Record<string, string>,
  key: string,
  values: Record<string, string> = {},
): string {
  let word: string = locale[key] || key;
  for (const [name, value] of Object.entries(values)) {
    word = word.split(`{{${name}}}`).join(value);
  }
  return word;
}

interface AiPost {
  route: string;
  body: { resourceType?: string; resourceId?: string };
}

async function aiPosts(page: Page): Promise<Array<AiPost>> {
  return await page.evaluate(() => {
    return JSON.parse(
      JSON.stringify(
        (
          window as unknown as {
            __cloudConnectFixture: { state: { aiPosts: unknown } };
          }
        ).__cloudConnectFixture.state.aiPosts,
      ),
    );
  });
}

function aiCard(page: Page): Locator {
  return page.getByTestId("cloud-ai-agent-card");
}

function setUpButton(page: Page): Locator {
  return page.getByTestId("cloud-ai-agent-card-set-up");
}

function setupDialog(page: Page): Locator {
  return dialog(page).getByTestId("cloud-ai-agent-setup");
}

// The dialog, at rest: its command written (a Server key is picked first).
async function openSetup(page: Page): Promise<void> {
  await setUpButton(page).click();
  await expect(setupDialog(page)).toBeVisible();
  await expect(
    setupDialog(page).getByTestId("cloud-ai-agent-setup-command"),
  ).toBeVisible();
}

test.describe("OneUptime AI on a cloud account", () => {
  test("the AI agent card: AI reads the account already, and one button lets it fix problems", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(page, `${ACCOUNTS_PATH}/${AWS_ACCOUNT}?state=connected`);

    await expect(
      aiCard(page).getByTestId("cloud-ai-agent-card-sentence"),
    ).toHaveText("OneUptime AI can read this account but can't change it.");
    await expect(setUpButton(page)).toHaveText("Let AI fix problems");
    // No agent yet is not a problem to warn about: it is the way in.
    await expect(page.getByTestId("cloud-ai-agent-card-attention")).toHaveCount(
      0,
    );

    // The card asked about this account, as an AWS account.
    const asks: Array<AiPost> = await aiPosts(page);
    expect(asks[0]).toEqual({
      route: "/resource-ai-access/status",
      body: { resourceType: "AwsAccount", resourceId: AWS_ACCOUNT },
    });

    // The button starts where the sentence's line does: no footer margin.
    const sentenceRow: Box = await boxOf(
      aiCard(page).locator(":scope > div").first(),
    );
    const button: Box = await boxOf(setUpButton(page));
    expect(Math.abs(button.x - sentenceRow.x)).toBeLessThanOrEqual(1);

    // Its pages: AI agent and Logs, in the account's own side menu.
    if (isDesktop()) {
      await sideMenu(page).getByRole("button", { name: "AI" }).click();
      await expect(
        sideMenu(page).getByRole("link", { name: "AI agent", exact: true }),
      ).toHaveAttribute("href", AI_AGENT_PATH);
      await expect(
        sideMenu(page).getByRole("link", { name: "Logs", exact: true }),
      ).toHaveAttribute("href", AI_LOGS_PATH);
    }

    await expectNoSidewaysScroll(page);
    await shoot(page, "account-ai-agent-card");
  });

  test("Let AI fix problems: one question, the command for the cloud's own shell, the rest under More fields", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(page, `${ACCOUNTS_PATH}/${AWS_ACCOUNT}?state=connected`);
    await openSetup(page);

    await expect(
      dialog(page).getByRole("heading", { name: "Let AI fix problems" }),
    ).toBeVisible();
    await expect(dialog(page)).toContainText(
      "Run one command in AWS CloudShell to let OneUptime AI fix problems here",
    );

    // One question, two answers, Ask me first by default.
    const question: Locator = setupDialog(page).getByRole("radiogroup", {
      name: "How far may AI go?",
    });
    await expect(question.getByRole("radio")).toHaveCount(2);
    await expect(
      question.getByRole("radio", { name: /Ask me first/ }),
    ).toHaveAttribute("aria-checked", "true");

    // The command is this account's, and asks for approval.
    const command: Locator = setupDialog(page).getByTestId(
      "cloud-ai-agent-setup-command",
    );
    await expect(command).toContainText("aws cloudformation deploy");
    await expect(command).toContainText("123456789012");
    await expect(command).toContainText("ask-for-approval");
    await expect(
      setupDialog(page).getByTestId("cloud-ai-agent-setup-cost"),
    ).toContainText("a month at list prices, billed by your cloud");

    // The other answer writes another command.
    await question
      .getByRole("radio", { name: /Fix safe problems on its own/ })
      .click();
    await expect(command).toContainText("automatic");
    await expect(command).not.toContainText("ask-for-approval");

    // Everything else is folded under More fields, never Advanced.
    const protectedTargets: Locator = setupDialog(page).getByTestId(
      "cloud-ai-agent-setup-protected",
    );
    await expect(protectedTargets).toBeHidden();
    await expect(
      setupDialog(page).getByRole("button", { name: "Advanced" }),
    ).toHaveCount(0);
    await setupDialog(page)
      .getByRole("button", { name: "More fields" })
      .click();
    await expect(protectedTargets).toBeVisible();
    // Every change of the AWS catalog, each on, and the three switches.
    await expect(
      setupDialog(page).locator(
        '[data-testid^="cloud-ai-agent-setup-operation-"]',
      ),
    ).toHaveCount(10);
    await expect(
      setupDialog(page).getByTestId(
        "cloud-ai-agent-setup-operation-restart-service",
      ),
    ).toBeChecked();
    await expect(
      setupDialog(page).getByTestId("cloud-ai-agent-setup-tagged"),
    ).not.toBeChecked();
    await expect(
      setupDialog(page).getByTestId("cloud-ai-agent-setup-bypass"),
    ).not.toBeChecked();

    // Reading logs is saved at once, with no command to run.
    const logs: Locator = setupDialog(page).getByTestId(
      "cloud-ai-agent-setup-logs",
    );
    await expect(logs).not.toBeChecked();
    await logs.check();
    await expect(logs).toBeChecked();
    expect((await fixture(page)).updates).toEqual([
      { id: AWS_ACCOUNT, data: { isAiLogReadEnabled: true } },
    ]);

    // Running it somewhere else: the agent's variables, with its mode.
    await expect(setupDialog(page)).toContainText(
      "ONEUPTIME_AI_FIXES=automatic",
    );

    // A phone: the dialog fits its width, long lines scroll in their box.
    await expectNoSidewaysScroll(page);
    await shoot(page, "account-ai-setup");
  });

  test("the agent connects on its own: the dialog that waits for it says Connected", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(!isDesktop(), "What it says: a desktop's.");

    await openAccounts(page, `${ACCOUNTS_PATH}/${AWS_ACCOUNT}?state=connected`);
    await openSetup(page);

    const connection: Locator = setupDialog(page).getByTestId(
      "cloud-ai-agent-setup-connection",
    );
    await expect(connection).toContainText("Waiting for the agent to connect.");
    const footerButton: Locator = dialog(page).getByTestId(
      "modal-footer-close-button",
    );
    await expect(footerButton).toHaveText("Close");

    // The command finished in the customer's cloud: the agent registers.
    await page.evaluate(() => {
      (
        window as unknown as {
          __cloudConnectFixture: { connectAgent: () => void };
        }
      ).__cloudConnectFixture.connectAgent();
    });

    // The dialog asks every five seconds: nothing to paste or press.
    await expect(connection).toContainText("Connected.", { timeout: 12000 });
    await expect(footerButton).toHaveText("Done");
    await footerButton.click();
    await expect(dialog(page)).toHaveCount(0);

    // The card is the connected agent's now, with its page a click away.
    const summary: Locator = page.getByTestId("ai-agent-status-summary");
    await expect(summary).toContainText("Connected");
    await expect(summary).toContainText("Ask for approval");
    const open: Locator = page
      .getByTestId("ai-agent-status-summary-open")
      .getByRole("link");
    await expect(open).toHaveAttribute("href", AI_AGENT_PATH);
    await open.click();
    await expect(page).toHaveURL(AI_AGENT_PATH);
    await expect(page.getByTestId("ai-agent-sentence")).toHaveText(
      "The Cloud AI agent is running in this AWS account.",
    );
  });

  test("an agent that stopped reporting: the card says what needs attention", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(
      page,
      `${ACCOUNTS_PATH}/${AWS_ACCOUNT}?state=connected&ai=offline`,
    );

    const summary: Locator = page.getByTestId("ai-agent-status-summary");
    await expect(
      page.getByTestId("ai-agent-status-summary-attention-title"),
    ).toBeVisible();
    await expect(summary).toContainText("Offline");
    await expect(summary).toContainText("last seen 3 hours ago");
    await expectNoSidewaysScroll(page);
    await shoot(page, "account-ai-agent-offline");
  });

  test("the AI agent page with no agent: one sentence in the cloud's terms, and Let AI fix problems", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(!isDesktop(), "The page: a desktop's.");

    await openAccounts(page, `${AI_AGENT_PATH}?state=connected`);

    await expect(page.getByTestId("ai-agent-sentence")).toHaveText(
      "OneUptime AI can read this account but can't change it. One command in the cloud's own shell starts the agent, which connects on its own.",
    );
    // Nothing is installed next to a cloud account, and nothing is said twice.
    await expect(page.getByText("Install the Cloud AI agent")).toHaveCount(0);
    await expect(
      page.getByText(
        "OneUptime AI can read this account but can't change it.",
        {
          exact: false,
        },
      ),
    ).toHaveCount(1);
    // Investigation reads the account live, with no agent.
    await expect(page.getByTestId("ai-access-investigation")).toContainText(
      "AI may run live reads on this AWS account: describe, recent-events, target-health, quota-usage.",
    );
    // Fixes are off: Change shows the command that turns them on.
    await expect(page.getByTestId("ai-access-fixes-off-hint")).toHaveText(
      "Want AI to propose fixes? Click Change to get the command that turns them on in the agent.",
    );

    await page.getByTestId("ai-agent-cloud-set-up").click();
    await expect(setupDialog(page)).toBeVisible();
    await shoot(page, "account-ai-agent-page-setup");
  });

  test("the AI agent page with the agent running: set by its setup command, Test connection, and Change", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(page, `${AI_AGENT_PATH}?state=connected&ai=connected`);

    await expect(page.getByTestId("ai-agent-sentence")).toHaveText(
      "The Cloud AI agent is running in this AWS account.",
    );
    await expect(page.getByText("Can make changes")).toBeVisible();
    await expect(page.getByText("Can change any target")).toHaveCount(0);
    await expect(page.getByTestId("ai-access-set-by")).toContainText(
      "Set by the Cloud AI agent's setup command. Change shows it again with other choices; this page follows.",
    );
    await expectNoSidewaysScroll(page);
    await shoot(page, "account-ai-agent-page");

    if (!isDesktop()) {
      return;
    }

    // Test connection runs cloud whoami on the agent and says what it answered.
    await page.getByTestId("ai-agent-actions-button").click();
    await page.getByTestId("ai-agent-test-button").click();
    await expect(page.getByTestId("ai-agent-test-results")).toContainText(
      "cloud whoami",
    );
    const tests: Array<AiPost> = (await aiPosts(page)).filter(
      (post: AiPost): boolean => {
        return post.route === "/resource-ai-access/test";
      },
    );
    expect(tests).toEqual([
      {
        route: "/resource-ai-access/test",
        body: { resourceType: "AwsAccount", resourceId: AWS_ACCOUNT },
      },
    ]);

    // Change is the setup command again, with the choices to change.
    await page.getByTestId("ai-access-change-button").click();
    await expect(setupDialog(page)).toBeVisible();
  });

  test("AI Logs: what AI investigated, the fix and who approved it, and every command newest first", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(page, `${AI_LOGS_PATH}?state=connected&ai=connected`);

    await expect(
      page.getByText("Incident #18: Checkout is slow for every customer"),
    ).toBeVisible();
    await expect(page.getByTestId("ai-logs-fix-approved-by")).toContainText(
      "Approved by Maya Chen",
    );
    // Every command the agent ran, newest first (a phone lists them as cards).
    if (isDesktop()) {
      const commands: Array<string> = await page
        .locator("tbody tr")
        .allInnerTexts();
      expect(commands).toHaveLength(2);
      expect(commands[0]).toContain("cloud whoami");
      expect(commands[1]).toContain("cloud scale-out");
    }

    const logs: AiPost | undefined = (await aiPosts(page)).find(
      (post: AiPost): boolean => {
        return post.route === "/resource-ai-access/logs";
      },
    );
    expect(logs?.body).toEqual({
      resourceType: "AwsAccount",
      resourceId: AWS_ACCOUNT,
    });

    await expectNoSidewaysScroll(page);
    await shoot(page, "account-ai-logs");
  });

  test("dark and German: the card and the dialog read in German, and fit", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(
      page,
      `${ACCOUNTS_PATH}/${AWS_ACCOUNT}?state=connected&theme=dark&lang=de`,
    );

    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(setUpButton(page)).toHaveText(
      wordIn(GERMAN, "Let AI fix problems"),
    );
    await openSetup(page);
    await expect(dialog(page)).toContainText(
      wordIn(
        GERMAN,
        "Run one command in {{shell}} to let OneUptime AI fix problems here: it creates the agent's role and starts the agent, which connects on its own.",
        { shell: wordIn(GERMAN, "AWS CloudShell") },
      ),
    );
    await expect(
      setupDialog(page).getByRole("button", {
        name: wordIn(GERMAN, "More fields"),
      }),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);
    await shoot(page, "account-ai-setup-dark-de");
  });

  test("Persian: the card and the dialog are laid out right to left, and fit", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(
      page,
      `${ACCOUNTS_PATH}/${AWS_ACCOUNT}?state=connected&lang=fa`,
    );

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(setUpButton(page)).toHaveText(
      wordIn(PERSIAN, "Let AI fix problems"),
    );
    await openSetup(page);

    // Right to left: an answer's dot is on its right, before its words.
    const askFirst: Locator = setupDialog(page).getByTestId(
      "cloud-ai-agent-setup-ask-first",
    );
    const dot: Box = await boxOf(askFirst.locator(":scope > span").first());
    const words: Box = await boxOf(askFirst.locator(":scope > span").last());
    expect(dot.x).toBeGreaterThan(words.x + words.width - 1);
    await expect(askFirst).toContainText(wordIn(PERSIAN, "Ask me first"));
    await expectNoSidewaysScroll(page);
    await shoot(page, "account-ai-setup-fa");
  });

  test("a status read that fails: the card still offers the way in", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(!isDesktop(), "One read: a desktop's.");

    await openAccounts(
      page,
      `${ACCOUNTS_PATH}/${AWS_ACCOUNT}?state=connected&ai=fail`,
    );

    await expect(
      aiCard(page).getByTestId("cloud-ai-agent-card-sentence"),
    ).toHaveText("OneUptime AI can read this account but can't change it.");
    await expect(setUpButton(page)).toBeEnabled();
    await expect(page.getByTestId("ai-agent-status-summary")).toHaveCount(0);
  });
});
