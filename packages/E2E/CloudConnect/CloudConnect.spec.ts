import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "Common/Types/ReadingDirection";
import { getInlineSeparator } from "Common/Types/Translator";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

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
 * Overview and Resources; and Cloud > All Resources by cloud account.
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

    await expectNoSidewaysScroll(page, { tolerance: 1 });
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
    await expectNoSidewaysScroll(page, { tolerance: 1 });
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
    await expectNoSidewaysScroll(page, { tolerance: 1 });
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
        // Data Security's levels, under More fields: off until chosen.
        dataSecurity: "off",
        dataSecurityResponse: "off",
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
    await expectNoSidewaysScroll(page, { tolerance: 1 });
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
    await expectNoSidewaysScroll(page, { tolerance: 1 });
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
        // AWS's costs per resource, under More fields: off until turned on.
        resourceCosts: "off",
        // Data Security's levels, under More fields: off until chosen.
        dataSecurity: "off",
        dataSecurityResponse: "off",
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
    await expectNoSidewaysScroll(page, { tolerance: 1 });
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
    await expectNoSidewaysScroll(page, { tolerance: 1 });
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
    await expectNoSidewaysScroll(page, { tolerance: 1 });
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
    await expectNoSidewaysScroll(page, { tolerance: 1 });
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
    /*
     * The way to them is All Resources with its Cloud Account chip set to
     * the account the connection reads (#6149's follow-up): the count opens
     * what it counted.
     */
    const resources: URL = new URL(
      (await page
        .getByRole("link", { name: "46 resources" })
        .getAttribute("href")) || "",
      "http://127.0.0.1",
    );
    expect(resources.pathname).toBe(`/dashboard/${PROJECT_ID}/cloud/resources`);
    expect(
      JSON.parse(
        resources.searchParams.get("cloud-monitored-resources-table-facets") ||
          "{}",
      ),
    ).toEqual({
      facetSelections: { cloudAccountId: ["123456789012"] },
      facetOperators: { cloudAccountId: "is" },
    });
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

    await expectNoSidewaysScroll(page, { tolerance: 1 });
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
      await expectNoSidewaysScroll(page, { tolerance: 1 });
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
    await expectNoSidewaysScroll(page, { tolerance: 1 });
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

    await expectNoSidewaysScroll(page, { tolerance: 1 });
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
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "connect-ja");

    await page.getByTestId("cloud-connection-tile-gcp").click();
    await expect(dialog(page).getByTestId("cloud-setup-command")).toContainText(
      JAPANESE_SCRIPT,
    );
    await expect(
      dialog(page).getByTestId("cloud-setup-command-code"),
    ).toContainText("gcloud iam service-accounts keys create");
    await expectNoSidewaysScroll(page, { tolerance: 1 });
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
    await expectNoSidewaysScroll(page, { tolerance: 1 });
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
      await expectNoSidewaysScroll(page, { tolerance: 1 });
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

    await expectNoSidewaysScroll(page, { tolerance: 1 });
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

    /*
     * The tiles: how many resources (the way to them), Regions, and what it
     * cost this month (the way to its Costs) - not read yet, said so rather
     * than as costing nothing.
     */
    await expect(
      page.getByRole("link", { name: "View Resources" }),
    ).toHaveAttribute("href", `${ACCOUNTS_PATH}/${AWS_ACCOUNT}/resources`);
    await expect(tile(page, "Spend this month")).toContainText(
      "Costs not read yet",
    );
    await expect(
      page.getByRole("link", { name: "View Spend this month" }),
    ).toHaveAttribute("href", `${ACCOUNTS_PATH}/${AWS_ACCOUNT}/costs`);
    await expect(page.getByText("Resource Types", { exact: true })).toHaveCount(
      0,
    );

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

    await expectNoSidewaysScroll(page, { tolerance: 1 });
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

    await expectNoSidewaysScroll(page, { tolerance: 1 });
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
    await expectNoSidewaysScroll(page, { tolerance: 1 });
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

/*
 * The clock an account's Changes are read by, so its times read the same on
 * every run: the fixture stamps each change so many minutes before its own
 * clock, and how wide the times read - "Nov 6, 09:05" or "Nov 26, 23:46" -
 * decided whether the list kept its rows beside the side menu (it did not,
 * and a check of row cells alone found none, on main on 2026-11-06). A day
 * of two digits and an hour of two: the widest a time reads.
 */
const CHANGES_CLOCK: Date = new Date("2026-11-26T23:58:00Z");

// Its changes' times as the list draws them (en-GB, UTC), newest first.
const CHANGES_CLOCK_TIMES: Array<string> = [
  "Nov 26, 23:46",
  "Nov 26, 23:33",
  "Nov 26, 23:18",
  "Nov 26, 23:03",
  "Nov 26, 22:43",
  "Nov 26, 22:23",
];

interface DrawnChangeTime {
  text: string;
  // Its text runs past its box: the time is cut short.
  isCut: boolean;
}

interface DrawnChangeTimes {
  layout: "rows" | "cards";
  times: Array<DrawnChangeTime>;
}

/*
 * An account's Changes list's times as it draws them once it has settled
 * at the window's width - as rows (each row's second cell) or as cards (the
 * value under a card's Time). The list fits its columns to its box a frame
 * or more after the window changes (useTableBoxWidth), hides its rows while
 * it measures them (Table's data-settling) and beside the side menu turns
 * into cards a frame later (TableFit): so it is read in one frame and again
 * two frames later, until both agree with each other and with the read
 * before - a list that has stopped changing - and none of it is hidden.
 */
async function settledChangeTimes(page: Page): Promise<DrawnChangeTimes> {
  let previous: string = "";
  let settled: DrawnChangeTimes | null = null;

  await expect
    .poll(
      async (): Promise<boolean> => {
        const drawn: string = await page.evaluate(async (): Promise<string> => {
          const read: () => string = (): string => {
            const rowTimes: Array<Element> = Array.from(
              document.querySelectorAll("tbody tr td:nth-child(2) > div"),
            );
            const cardTimes: Array<Element> = Array.from(
              document.querySelectorAll("dl > div"),
            )
              .filter((field: Element): boolean => {
                const name: Element | null = field.querySelector(":scope > dt");
                return (name?.textContent || "").trim() === "Time";
              })
              .map((field: Element): Element => {
                return field.querySelector(":scope > dd") as Element;
              });
            const times: Array<Element> =
              rowTimes.length > 0 ? rowTimes : cardTimes;

            return JSON.stringify({
              layout: rowTimes.length > 0 ? "rows" : "cards",
              isSettling:
                document.querySelector('[data-settling="true"]') !== null,
              times: times.map(
                (time: Element): { text: string; isCut: boolean } => {
                  return {
                    text: (time.textContent || "").trim(),
                    isCut: time.scrollWidth > time.clientWidth + 1,
                  };
                },
              ),
            });
          };

          const first: string = read();
          await new Promise<void>((resolve: () => void): void => {
            window.requestAnimationFrame((): void => {
              window.requestAnimationFrame((): void => {
                resolve();
              });
            });
          });
          const second: string = read();

          return first === second ? second : "";
        });

        const isAtRest: boolean =
          drawn !== "" &&
          drawn === previous &&
          !(JSON.parse(drawn) as { isSettling: boolean }).isSettling;
        previous = drawn;

        if (isAtRest) {
          const at: DrawnChangeTimes & { isSettling?: boolean } = JSON.parse(
            drawn,
          ) as DrawnChangeTimes & { isSettling?: boolean };
          settled = { layout: at.layout, times: at.times };
        }

        return isAtRest && settled !== null && settled.times.length > 0;
      },
      { message: "the changes list settled at the window's width" },
    )
    .toBe(true);

  return settled as unknown as DrawnChangeTimes;
}

// The map's count of Regions: its number, then its word.
const TWO_REGIONS: RegExp = /^\s*2\s*Regions\s*$/;

function isDesktop(): boolean {
  return test.info().project.name === "desktop";
}

/*
 * A box's place on the page, once laid out and settled. Tailwind's runtime
 * writes a utility's rule after the element that uses it mounts, so a
 * transition-all tile grows its padding in over 150ms: measured mid-way,
 * two tiles of one row were 1.5px apart on CI. Every finite animation and
 * transition ends before a box is read.
 */
async function boxOf(locator: Locator): Promise<Box> {
  await locator.page().waitForFunction((): boolean => {
    return document.getAnimations().every((animation: Animation): boolean => {
      const timing: ComputedEffectTiming | undefined =
        animation.effect?.getComputedTiming();

      return (
        animation.playState !== "running" || timing?.iterations === Infinity
      );
    });
  });
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

    /*
     * Beside the side menu at 1024, the pills are clear of the row's
     * actions: the card is 682px there - narrower than 48rem - so each
     * account is a card (TableFit), its pill on a line above its View; as
     * rows, the pill would sit before it.
     */
    await page.setViewportSize({ width: 1024, height: 900 });
    await openAccounts(page, `${ACCOUNTS_PATH}?state=connected`);
    const pill: Box = await boxOf(
      page.getByTestId("cloud-account-status").first().getByTestId("pill"),
    );
    const view: Box = await boxOf(
      page.getByRole("button", { name: "View" }).first(),
    );
    expect(
      pill.x + pill.width <= view.x || pill.y + pill.height <= view.y,
    ).toBe(true);
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
    for (const title of [
      "Resources",
      "Regions",
      "Spend this month",
      "Changes",
    ]) {
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

    await expectNoSidewaysScroll(page, { tolerance: 1 });
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
    await page.clock.setFixedTime(CHANGES_CLOCK);
    await openAccounts(
      page,
      `${ACCOUNTS_PATH}/${AWS_ACCOUNT}/changes?state=connected`,
    );

    // Titled as the recorder titles it: CloudTrail's service and event name.
    await expect(
      page.getByText(
        "ec2:AuthorizeSecurityGroupIngress on sg-0f1e2d3c4b5a69788",
      ),
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
      page.getByText("ran ec2:AuthorizeSecurityGroupIngress"),
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

    /*
     * The time is never cut short, at 1280 or beside the side menu at 1024,
     * read once the list has settled at the new width (settledChangeTimes):
     * a read right after the resize found the old frame, or no cells at all,
     * one run in 97 under load (2026-11-02), and a read that passed on the
     * frame before the table fitted itself checked nothing of the new
     * width. Beside the side menu the box is narrower than 48rem, so the
     * list keeps its rows there only while they fit, and is otherwise drawn
     * as cards (TableFit): the time is read wherever it is drawn, a row's
     * second cell or the value under a card's Time. The times read the same
     * on every run (CHANGES_CLOCK).
     */
    for (const width of [1280, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      const drawn: DrawnChangeTimes = await settledChangeTimes(page);

      expect(
        { width, times: drawn.times },
        `the change times at ${width} pixels, drawn as ${drawn.layout}`,
      ).toEqual({
        width,
        times: CHANGES_CLOCK_TIMES.map((text: string): DrawnChangeTime => {
          return { text, isCut: false };
        }),
      });
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
      page.getByText(
        "Failed: elasticloadbalancing:DeleteLoadBalancer on web-alb",
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        "elasticloadbalancing:ModifyLoadBalancerAttributes on web-alb",
      ),
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

    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "resource-overview");
  });

  /*
   * The way back from Security Events: a cloud resource is named by its own
   * ID and by the names it answers on, and its card opens Security Events
   * on the first of those names (?security=).
   */
  test("its Security card: the case naming the name it answers on, its week of events and findings, each opening Security Events on it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(
      page,
      `${RESOURCE_PATH}/${WEB_ALB}?state=connected&security=news`,
    );
    const card: Locator = page.getByTestId("resource-security-card");
    await expect(card).toBeVisible({ timeout: 30000 });
    await expect(card).toHaveAttribute("data-state", "news");
    await expect(card).toContainText(
      "What Security Events found about it in the last 7 days.",
    );

    // Asked as a cloud resource, by its own id.
    const reads: Array<{ kind: string; id: string }> = await page.evaluate(
      () => {
        return JSON.parse(
          JSON.stringify(
            (
              window as unknown as {
                __cloudConnectFixture: {
                  state: { securityReads: unknown };
                };
              }
            ).__cloudConnectFixture.state.securityReads,
          ),
        );
      },
    );
    expect(reads).toContainEqual({ kind: "CloudResource", id: WEB_ALB });

    // Its week, opening the explorer on its ID and the name it answers on.
    const events: Locator = card.getByTestId("resource-security-open");
    await expect(events).toHaveText("212");
    const search: string = decodeURIComponent(
      new URL(
        (await events.getAttribute("href"))!,
        "http://127.0.0.1",
      ).searchParams.get("search") || "",
    );
    expect(search.startsWith("observable:(")).toBe(true);
    expect(search).toContain("web-alb-1234567890.us-east-1.elb.amazonaws.com");
    expect(search).toContain("loadbalancer/app/web-alb/50dc6c495c0c9188");

    const cases: Locator = card.getByTestId("resource-security-cases");
    await expect(cases.getByTestId("resource-security-case")).toHaveCount(1);
    await expect(cases).toContainText(
      "Credential stuffing through web-alb-1234567890.us-east-1.elb.amazonaws.com",
    );

    // Its page in Security Events: the name it answers on, as a host.
    const entity: URL = new URL(
      (await card
        .getByRole("link", { name: "Open in Security Events" })
        .getAttribute("href"))!,
      "http://127.0.0.1",
    );
    expect(entity.pathname).toBe(
      `/dashboard/${PROJECT_ID}/security-events/entity-risk/entity`,
    );
    expect(entity.searchParams.get("value")).toBe(
      "web-alb-1234567890.us-east-1.elb.amazonaws.com",
    );
    expect(entity.searchParams.get("type")).toBe("Host");

    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({
      path: path.join(
        SCREENSHOTS,
        `resource-security-card-${test.info().project.name}.png`,
      ),
    });
  });

  test("a quiet week says so in one line, and a project that uses no Security Events is told nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(
      page,
      `${RESOURCE_PATH}/${WEB_ALB}?state=connected&security=quiet`,
    );
    const card: Locator = page.getByTestId("resource-security-card");
    await expect(card).toBeVisible({ timeout: 30000 });
    await expect(card).toHaveAttribute("data-state", "quiet");
    await expect(card).toContainText(
      "No security event named it in the last 7 days.",
    );

    await openAccounts(page, `${RESOURCE_PATH}/${WEB_ALB}?state=connected`);
    await expect(cardTitled(page, "Details")).toBeVisible();
    await expect(card).toHaveCount(0);
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
const FEED_PATH: string = `${ACCOUNTS_PATH}/${AWS_ACCOUNT}/feed`;

// The account feed's entries, top to bottom, as their words read.
async function feedEntries(page: Page): Promise<Array<string>> {
  const found: Array<string> = [];

  for (const words of [
    "OneUptime found",
    "The Cloud AI agent connected",
    "changed what OneUptime AI may do on",
    "now connects with a key of its own",
    "OneUptime refused a Cloud AI agent",
    "The Cloud AI agent was reset",
  ]) {
    const box: Box = await boxOf(page.getByText(words).first());
    found.push(`${Math.round(box.y)}:${words}`);
  }

  return found
    .sort((left: string, right: string): number => {
      return Number(left.split(":")[0]) - Number(right.split(":")[0]);
    })
    .map((entry: string): string => {
      return entry.slice(entry.indexOf(":") + 1);
    });
}

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

// The Cloud AI agent's image, as Run the agent somewhere else names it.
const AGENT_IMAGE: string = "docker.io/oneuptime/resource-ai-agent:release";

/*
 * Run the agent somewhere else on Google Cloud: the image's line over the
 * variables, the line over the list, and the list's two identities.
 */
const GCP_ELSEWHERE: string =
  "Deploy the image {{image}} your own way in Google Cloud, with these variables:";
const ELSEWHERE_IDENTITIES: string =
  "Give it two identities, as the setup command does:";
const GCP_ELSEWHERE_OWN: string =
  "A service account of its own that only reads, with Service Account Token Creator on the write account.";
const GCP_ELSEWHERE_WRITE: string =
  "The write account {{writeAccount}}, which holds the permissions of the changes AI may make.";

/*
 * The names Run the agent somewhere else draws as code, and the lines each
 * takes: one, at desktop and phone width - a name is never broken at a
 * hyphen ("oneuptime-ai-agent-" / "write").
 */
async function elsewhereNameLines(
  page: Page,
): Promise<Array<{ name: string; lines: number }>> {
  return await page.evaluate(() => {
    return Array.from(
      document.querySelectorAll(
        '[data-testid="cloud-ai-agent-setup-elsewhere-name"]',
      ),
    ).map((element: Element): { name: string; lines: number } => {
      const name: HTMLElement = element as HTMLElement;
      const lineHeight: number = parseFloat(
        window.getComputedStyle(name).lineHeight,
      );

      return {
        name: name.textContent || "",
        lines: Math.round(name.offsetHeight / lineHeight),
      };
    });
  });
}

/*
 * A name drawn in a sentence of the language: set apart from the words
 * around it where the sentence reads right to left.
 */
function nameIn(locale: Record<string, string>, value: string): string {
  return locale === PERSIAN
    ? `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`
    : value;
}

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

// The keys the fixture made for the account's agent, one per opening.
async function agentKeys(page: Page): Promise<Array<string>> {
  return await page.evaluate(() => {
    return JSON.parse(
      JSON.stringify(
        (
          window as unknown as {
            __cloudConnectFixture: { state: { agentKeys: unknown } };
          }
        ).__cloudConnectFixture.state.agentKeys,
      ),
    );
  });
}

const AGENT_KEY_NOTE: string =
  "The command holds a key made for this agent alone. Run it within a day, or open this dialog again for a new one.";

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

/*
 * The dialog, at rest: its command written, with the key made for the
 * account's agent as it opened.
 */
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

    await expectNoSidewaysScroll(page, { tolerance: 1 });
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
    // The image's line over them.
    await expect(
      setupDialog(page).getByTestId("cloud-ai-agent-setup-elsewhere"),
    ).toHaveText(
      `Deploy the image ${AGENT_IMAGE} your own way, with these variables:`,
    );
    // And its two identities on AWS: a role of its own that may only assume the write role.
    await expect(
      setupDialog(page)
        .getByTestId("cloud-ai-agent-setup-elsewhere-identities")
        .locator("li"),
    ).toHaveText([
      "A role of its own that may only assume the write role.",
      "The write role OneUptimeAiAgentWrite, which trusts the agent's role and holds the permissions of the changes AI may make.",
    ]);
    // Each name whole on its line, a phone's included.
    await expect
      .poll(async () => {
        return await elsewhereNameLines(page);
      })
      .toEqual([
        { name: AGENT_IMAGE, lines: 1 },
        { name: "OneUptimeAiAgentWrite", lines: 1 },
      ]);

    // A phone: the dialog fits its width, long lines scroll in their box.
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "account-ai-setup");
    await setupDialog(page)
      .getByTestId("cloud-ai-agent-setup-elsewhere-identities")
      .scrollIntoViewIfNeeded();
    await shoot(page, "account-ai-setup-elsewhere");
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
    // A live status, as Add Host's last step: read out when it changes.
    await expect(connection).toHaveAttribute("role", "status");
    await expect(connection).toHaveAttribute("data-state", "waiting");
    // While it waits: where to look when it does not connect, in the same shell.
    const logs: Locator = setupDialog(page).getByTestId(
      "cloud-ai-agent-setup-logs-command",
    );
    await expect(logs).toContainText("Its logs, when it does not connect:");
    await expect(logs).toContainText(
      "aws logs tail /oneuptime/oneuptime-ai-agent --since 30m",
    );
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
    await expect(connection).toHaveAttribute("data-state", "connected");
    // Nothing left to troubleshoot.
    await expect(logs).toHaveCount(0);
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
    await expectNoSidewaysScroll(page, { tolerance: 1 });
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
    // Nothing is installed by hand: its agent is set up by a command.
    await expect(page.getByTestId("ai-agent-status")).toHaveText("Not set up");
    /*
     * The project's own switches change nothing while the account's fixes
     * are off: the hint above is the one next step, so no line about them.
     */
    await expect(
      page.getByTestId("ai-access-automatic-remediation"),
    ).toHaveCount(0);

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
    await expectNoSidewaysScroll(page, { tolerance: 1 });
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
    // Titled in words, its rows called commands - never "runner jobs".
    await expect(
      page.getByRole("heading", { name: "Cloud operations", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/of 2 commands/)).toBeVisible();
    await expect(page.getByText(/runner jobs/i)).toHaveCount(0);

    const logs: AiPost | undefined = (await aiPosts(page)).find(
      (post: AiPost): boolean => {
        return post.route === "/resource-ai-access/logs";
      },
    );
    expect(logs?.body).toEqual({
      resourceType: "AwsAccount",
      resourceId: AWS_ACCOUNT,
    });

    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "account-ai-logs");
  });

  for (const [language, locale, name, theme] of [
    ["de", GERMAN, "German, dark", "&theme=dark"],
    ["fa", PERSIAN, "Persian", ""],
  ] as Array<[string, Record<string, string>, string, string]>) {
    test(`AI Logs in ${name}: every sentence, status and subject in the language's words (#5367's follow-up)`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openAccounts(
        page,
        `${AI_LOGS_PATH}?state=connected&ai=connected&lang=${language}${theme}`,
      );

      const heading: Locator = page.getByTestId("ai-logs-page-heading");
      await expect(heading).toContainText(wordIn(locale, "AI Logs"));
      // The subtitle is the language's sentence, the account named in it.
      for (const part of wordIn(
        locale,
        "Everything OneUptime AI did on this {{noun}}, newest first: every investigation, fix and command.",
      ).split("{{noun}}")) {
        if (part.trim()) {
          await expect(heading).toContainText(part.trim());
        }
      }
      await expect(
        page.getByText(
          wordIn(locale, "Incident #{{number}}: {{title}}", {
            number: "18",
            title: "Checkout is slow for every customer",
          }),
        ),
      ).toBeVisible();
      await expect(page.getByTestId("ai-logs-fix")).toContainText(
        wordIn(locale, "Applied after approval"),
      );
      await expect(page.getByTestId("ai-logs-fix-approved-by")).toContainText(
        `${wordIn(locale, "Approved by")} Maya Chen`,
      );
      await expect(page.getByTestId("ai-logs-fix")).toContainText(
        wordIn(locale, "Command plan"),
      );
      // How a command ended, in the language's sentence.
      await expect(
        page
          .getByText(
            wordIn(locale, "{{status}} (exit {{exitCode}})", {
              status: wordIn(locale, "Succeeded"),
              exitCode: "0",
            }),
          )
          .first(),
      ).toBeVisible();
      for (const english of [
        "newest first",
        "Applied after approval",
        "Command plan",
        "(exit 0)",
        "Incident #18",
      ]) {
        await expect(page.locator("body")).not.toContainText(english);
      }

      await expectNoSidewaysScroll(page, { tolerance: 1 });
      await shoot(page, `account-ai-logs-${language}`);
    });
  }

  test("the project's automatic fixes: said under the question and under the page's fixes, with a link to each switch that is off", async ({
    page,
  }: {
    page: Page;
  }) => {
    // A new project fixes nothing new on its own: both switches are off.
    await openAccounts(page, `${ACCOUNTS_PATH}/${AWS_ACCOUNT}?state=connected`);
    await openSetup(page);

    const inDialog: Locator = setupDialog(page).getByTestId(
      "cloud-ai-agent-setup-automatic-remediation",
    );
    await expect(inDialog).toContainText(
      "This project doesn't fix new incidents or alerts automatically.",
    );
    await expect(
      inDialog.getByRole("link", { name: "Turn on for incidents" }),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/incidents/ai/settings`);
    await expect(
      inDialog.getByRole("link", { name: "Turn on for alerts" }),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/alerts/ai/settings`);
    // Under the question it is about, before the steps.
    const question: Box = await boxOf(
      setupDialog(page).getByRole("radiogroup", { name: "How far may AI go?" }),
    );
    const note: Box = await boxOf(inDialog);
    const firstStep: Box = await boxOf(
      setupDialog(page).getByTestId("setup-guide-step-1"),
    );
    expect(note.y).toBeGreaterThan(question.y + question.height - 1);
    expect(firstStep.y).toBeGreaterThan(note.y + note.height - 1);
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "account-ai-setup-automatic-fixes-off");

    // The AI agent page says it under the fixes, as a cluster's does.
    await page.goto(`${AI_AGENT_PATH}?state=connected&ai=connected`);
    const onPage: Locator = page.getByTestId("ai-access-automatic-remediation");
    await expect(onPage).toContainText(
      "This project doesn't fix new incidents or alerts automatically.",
    );
    await expect(onPage.getByRole("link")).toHaveCount(2);
    // Inside the Fixes row it is about.
    await expect(
      page
        .getByTestId("ai-access-fixes")
        .getByTestId("ai-access-automatic-remediation"),
    ).toHaveCount(1);
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "account-ai-agent-automatic-fixes-off");

    // With both on, the dialog has nothing to say, and the page nowhere to send you.
    await page.goto(
      `${ACCOUNTS_PATH}/${AWS_ACCOUNT}?state=connected&fixing=on`,
    );
    await openSetup(page);
    await expect(
      setupDialog(page).getByTestId(
        "cloud-ai-agent-setup-automatic-remediation",
      ),
    ).toHaveCount(0);

    await page.goto(`${AI_AGENT_PATH}?state=connected&ai=connected&fixing=on`);
    await expect(
      page.getByTestId("ai-access-automatic-remediation"),
    ).toContainText(
      "This project fixes new incidents and alerts automatically.",
    );
    await expect(
      page.getByTestId("ai-access-automatic-remediation").getByRole("link"),
    ).toHaveCount(0);
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
    await expectNoSidewaysScroll(page, { tolerance: 1 });
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
      "setup-guide-option-ask-first",
    );
    const dot: Box = await boxOf(
      askFirst.locator('[aria-hidden="true"]').first(),
    );
    const words: Box = await boxOf(
      askFirst.getByText(wordIn(PERSIAN, "Ask me first"), { exact: true }),
    );
    expect(dot.x).toBeGreaterThan(words.x + words.width - 1);
    // The steps run down the right: a step's number is right of its title.
    const firstStep: Locator =
      setupDialog(page).getByTestId("setup-guide-step-1");
    const number: Box = await boxOf(
      firstStep.locator('[aria-hidden="true"]').first(),
    );
    const title: Box = await boxOf(firstStep.getByRole("heading"));
    expect(number.x).toBeGreaterThan(title.x + title.width - 1);
    // The command's key, said in Persian.
    await expect(firstStep).toContainText(wordIn(PERSIAN, AGENT_KEY_NOTE));
    expect(wordIn(PERSIAN, AGENT_KEY_NOTE)).not.toBe(AGENT_KEY_NOTE);
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "account-ai-setup-fa");
  });

  test("the account's feed: how it came to OneUptime, its agent, and who changed what AI may do, newest first", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(page, `${FEED_PATH}?state=connected`);

    await expect(page.getByText("Cloud Account Feed").first()).toBeVisible();
    await expect(page.getByText("The Cloud AI agent was reset")).toBeVisible();
    await expect(
      page.getByText("changed what OneUptime AI may do on").first(),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Reading the account's log lines during investigations turned",
      ),
    ).toBeVisible();
    await expect(page.getByText("AWS 123456789012")).toBeVisible();

    // Newest first: the reset half an hour ago, the account found nine days ago.
    expect(await feedEntries(page)).toEqual([
      "The Cloud AI agent was reset",
      "OneUptime refused a Cloud AI agent",
      "now connects with a key of its own",
      "changed what OneUptime AI may do on",
      "The Cloud AI agent connected",
      "OneUptime found",
    ]);

    // A Cloud AI agent's reset says how it comes back: its setup command, run again.
    await expect(
      page.getByText(
        "Its key no longer works, and it stays disconnected until its setup command runs again",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("It reconnects on its own within a few minutes"),
    ).toHaveCount(0);

    /*
     * The agent's own key: under Show details, the ingestion key it no
     * longer uses, by its name, and what to do with it.
     */
    const ownKeyEntry: Locator = page
      .getByRole("listitem")
      .filter({ hasText: "now connects with a key of its own" });
    await ownKeyEntry.getByRole("button", { name: "Show details" }).click();
    await expect(
      ownKeyEntry.getByText("Ingestion key it connected with before"),
    ).toBeVisible();
    await expect(ownKeyEntry).toContainText("Cloud AI agent key");
    await expect(ownKeyEntry).toContainText(
      "If nothing else uses it, delete it under Project Settings",
    );

    /*
     * A refused agent: what it was refused for, and under Show details where
     * it says it runs, what it came with and its version - never a key.
     */
    const refusedEntry: Locator = page
      .getByRole("listitem")
      .filter({ hasText: "OneUptime refused a Cloud AI agent" });
    await expect(refusedEntry).toContainText(
      "the project's telemetry ingestion key no longer connects it",
    );
    await refusedEntry.getByRole("button", { name: "Show details" }).click();
    await expect(refusedEntry.getByText("Where it says it runs")).toBeVisible();
    await expect(refusedEntry).toContainText("AWS account 123456789012");
    await expect(refusedEntry).toContainText(
      "the project's telemetry ingestion key",
    );
    await expect(refusedEntry).toContainText("14.0.90");
    expect(await page.locator("body").innerText()).not.toContain("ouca_");

    // Read for this account, and nothing else's.
    const reads: Array<ListRequest> = (await listRequests(page)).filter(
      (request: ListRequest): boolean => {
        return request.model === "CloudAccountFeed";
      },
    );
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(
        (read as unknown as { cloudAccountId: string }).cloudAccountId,
      ).toBe(AWS_ACCOUNT);
    }

    // Activity holds what changed in the cloud, then what happened in OneUptime.
    if (isDesktop()) {
      await expect(
        sideMenu(page).getByRole("link", { name: "Feed", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await expect(
        sideMenu(page).getByRole("link", { name: "Feed", exact: true }),
      ).toHaveAttribute("href", FEED_PATH);
      await expect(
        sideMenu(page).getByRole("link", { name: "Changes", exact: true }),
      ).toHaveAttribute("href", `${ACCOUNTS_PATH}/${AWS_ACCOUNT}/changes`);
    }

    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "account-feed");
  });

  test("the account's feed, dark and in German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(page, `${FEED_PATH}?state=connected&theme=dark&lang=de`);

    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(
      page.getByText(wordIn(GERMAN, "Cloud Account Feed")).first(),
    ).toBeVisible();
    expect(wordIn(GERMAN, "Cloud Account Feed")).not.toBe("Cloud Account Feed");
    await expect(
      page.getByText("The Cloud AI agent was reset").first(),
    ).toBeVisible();
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "account-feed-dark-de");
  });

  test("the account's feed in Persian, right to left", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(page, `${FEED_PATH}?state=connected&lang=fa`);

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByText(wordIn(PERSIAN, "Cloud Account Feed")).first(),
    ).toBeVisible();
    expect(wordIn(PERSIAN, "Cloud Account Feed")).not.toBe(
      "Cloud Account Feed",
    );
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "account-feed-fa");
  });

  test("Let AI fix problems reads as a guide: the question, then two numbered steps - the command with its key, the wait", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(page, `${ACCOUNTS_PATH}/${AWS_ACCOUNT}?state=connected`);
    await openSetup(page);

    // The question first, as Add Host's "What does the host run?".
    const question: Locator = setupDialog(page).getByRole("radiogroup", {
      name: "How far may AI go?",
    });
    await expect(question.getByRole("radio")).toHaveCount(2);

    const steps: Locator = setupDialog(page)
      .getByTestId("setup-guide-steps")
      .locator(":scope > li");
    await expect(steps).toHaveCount(2);
    await expect(steps.nth(0).getByRole("heading")).toHaveText(
      "Step 1: Run this in AWS CloudShell",
    );
    await expect(steps.nth(1).getByRole("heading")).toHaveText(
      "Step 2: Wait for it to connect",
    );

    // 1: the command, with the key made for this agent, who may run it, and what it costs.
    await expect(steps.nth(0)).toContainText(
      "Run it as someone who may create roles in this account.",
    );
    const command: Locator = steps
      .nth(0)
      .getByTestId("cloud-ai-agent-setup-command");
    await expect(command).toContainText("aws cloudformation deploy");
    const [key] = await agentKeys(page);
    expect(key).toMatch(
      /^ouca_30000000-0000-4000-8000-000000000001_[0-9]{64}$/,
    );
    await expect(command).toContainText(key!);
    await expect(
      steps.nth(0).getByTestId("cloud-ai-agent-setup-key-note"),
    ).toHaveText(AGENT_KEY_NOTE);
    await expect(
      steps.nth(0).getByTestId("cloud-ai-agent-setup-cost"),
    ).toContainText("a month at list prices");
    // No ingestion key to choose: the agent connects with its own.
    await expect(setupDialog(page)).not.toContainText("ingestion key");
    // 2: the wait, live, and its logs.
    await expect(
      steps.nth(1).getByTestId("cloud-ai-agent-setup-connection"),
    ).toHaveAttribute("data-state", "waiting");
    await expect(
      steps.nth(1).getByTestId("cloud-ai-agent-setup-logs-command"),
    ).toBeVisible();

    // The rest under More fields, after the steps.
    const more: Box = await boxOf(
      setupDialog(page).getByRole("button", { name: "More fields" }),
    );
    const lastStep: Box = await boxOf(steps.nth(1));
    expect(more.y).toBeGreaterThan(lastStep.y + lastStep.height - 1);

    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "account-ai-setup-steps");
  });

  test("the key is made for this account as the dialog opens, once each time: a dialog opened again holds a new one", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(!isDesktop(), "What is asked: a desktop's.");

    await openAccounts(page, `${ACCOUNTS_PATH}/${AWS_ACCOUNT}?state=connected`);
    await openSetup(page);

    const keyAsks: () => Promise<Array<AiPost>> = async (): Promise<
      Array<AiPost>
    > => {
      return (await aiPosts(page)).filter((post: AiPost): boolean => {
        return post.route === "/resource-ai-access/agent-key";
      });
    };

    expect(await keyAsks()).toEqual([
      {
        route: "/resource-ai-access/agent-key",
        body: { resourceType: "AwsAccount", resourceId: AWS_ACCOUNT },
      },
    ]);

    const command: Locator = setupDialog(page).getByTestId(
      "cloud-ai-agent-setup-command",
    );
    const [first] = await agentKeys(page);
    await expect(command).toContainText(first!);

    // The other answer writes another command, with the same key.
    await setupDialog(page)
      .getByRole("radiogroup", { name: "How far may AI go?" })
      .getByRole("radio", { name: /Fix safe problems on its own/ })
      .click();
    await expect(command).toContainText("automatic");
    await expect(command).toContainText(first!);
    expect(await keyAsks()).toHaveLength(1);

    // Closed and opened again: a new key, and the command holds it.
    await dialog(page).getByTestId("modal-footer-close-button").click();
    await expect(dialog(page)).toHaveCount(0);
    await openSetup(page);

    const keys: Array<string> = await agentKeys(page);
    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(first);
    await expect(
      setupDialog(page).getByTestId("cloud-ai-agent-setup-command"),
    ).toContainText(keys[1]!);
    expect(await keyAsks()).toHaveLength(2);
  });

  test("someone who may not set the agent up is told why where the command would be, with no Try again: asking again never changes that", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(
      page,
      `${ACCOUNTS_PATH}/${AWS_ACCOUNT}?state=connected&agentkey=refused`,
    );
    await setUpButton(page).click();
    await expect(setupDialog(page)).toBeVisible();

    const problem: Locator = setupDialog(page).getByTestId(
      "cloud-ai-agent-setup-problem",
    );
    await expect(problem).toHaveText(
      "You need permission to edit this AWS account to set up its Cloud AI agent.",
    );
    await expect(
      setupDialog(page).getByTestId("cloud-ai-agent-setup-command"),
    ).toHaveCount(0);
    await expect(
      setupDialog(page).getByTestId("cloud-ai-agent-setup-key-try-again"),
    ).toHaveCount(0);
    await expect(
      setupDialog(page).getByTestId("cloud-ai-agent-setup-key-note"),
    ).toHaveCount(0);
    expect(await agentKeys(page)).toEqual([]);
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "account-ai-setup-key-refused");
  });

  test("a key OneUptime could not make just then is said where the command would be, and Try again asks again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(
      page,
      `${ACCOUNTS_PATH}/${AWS_ACCOUNT}?state=connected&agentkey=fail`,
    );
    await setUpButton(page).click();
    await expect(setupDialog(page)).toBeVisible();

    const problem: Locator = setupDialog(page).getByTestId(
      "cloud-ai-agent-setup-problem",
    );
    await expect(problem).not.toBeEmpty();
    await expect(
      setupDialog(page).getByTestId("cloud-ai-agent-setup-command"),
    ).toHaveCount(0);
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "account-ai-setup-key-failed");

    // Asked again, the key is made, and the command holds it.
    await setupDialog(page)
      .getByTestId("cloud-ai-agent-setup-key-try-again")
      .click();
    await expect(
      setupDialog(page).getByTestId("cloud-ai-agent-setup-command"),
    ).toBeVisible();
    const [key] = await agentKeys(page);
    await expect(
      setupDialog(page).getByTestId("cloud-ai-agent-setup-command"),
    ).toContainText(key!);
    await expect(problem).toHaveCount(0);
    await expect(
      setupDialog(page).getByTestId("cloud-ai-agent-setup-key-try-again"),
    ).toHaveCount(0);
  });

  test("Change on a connected agent opens on what it runs with: its changes, its tag and the resources a person protected", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(!isDesktop(), "What it starts from: a desktop's.");

    await openAccounts(
      page,
      `${AI_AGENT_PATH}?state=connected&ai=connected&agentsettings=custom`,
    );
    await page.getByTestId("ai-access-change-button").click();
    await expect(setupDialog(page)).toBeVisible();
    await expect(
      setupDialog(page).getByTestId("cloud-ai-agent-setup-command"),
    ).toBeVisible();
    await setupDialog(page)
      .getByRole("button", { name: "More fields" })
      .click();

    // The three changes the agent reports, and none of the others.
    for (const operation of [
      "restart-service",
      "start-instance",
      "scale-out",
    ]) {
      await expect(
        setupDialog(page).getByTestId(
          `cloud-ai-agent-setup-operation-${operation}`,
        ),
      ).toBeChecked();
    }
    for (const operation of [
      "scale-in",
      "reboot-instance",
      "roll-back-service",
      "set-concurrency",
      "fail-over-database",
      "stop-instance",
      "redrive-queue",
    ]) {
      await expect(
        setupDialog(page).getByTestId(
          `cloud-ai-agent-setup-operation-${operation}`,
        ),
      ).not.toBeChecked();
    }
    // The tag it requires, and what a person protected - not its own stack, roles or task.
    await expect(
      setupDialog(page).getByTestId("cloud-ai-agent-setup-tagged"),
    ).toBeChecked();
    await expect(
      setupDialog(page).getByTestId("cloud-ai-agent-setup-protected"),
    ).toHaveValue("*prod-db*\narn:aws:rds:us-east-1:123456789012:db:orders");

    // So the command it writes keeps them all.
    await expect(setupDialog(page)).toContainText(
      "ONEUPTIME_AI_CLOUD_OPERATIONS=restart-service,start-instance,scale-out",
    );
    await expect(setupDialog(page)).toContainText(
      "ONEUPTIME_AI_CLOUD_REQUIRED_TAG=oneuptime-ai=allow",
    );
    await expect(setupDialog(page)).toContainText(
      "ONEUPTIME_AI_PROTECTED_TARGETS=*prod-db*,arn:aws:rds:us-east-1:123456789012:db:orders",
    );
    await shoot(page, "account-ai-change-keeps-choices");
  });

  test("an AI agent page whose status read fails offers to read it again", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(!isDesktop(), "One read: a desktop's.");

    await openAccounts(page, `${AI_AGENT_PATH}?state=connected&ai=fail`);

    const retry: Locator = page.getByTestId("refresh-button");
    await expect(retry).toBeVisible();
    const statusReads: () => Promise<number> = async (): Promise<number> => {
      return (await aiPosts(page)).filter((post: AiPost): boolean => {
        return post.route === "/resource-ai-access/status";
      }).length;
    };
    const before: number = await statusReads();
    await retry.click();
    await expect.poll(statusReads).toBeGreaterThan(before);
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

/*
 * ---------------------------------------------------------------------------
 * A cloud account and a cloud resource in German and in Persian, at a
 * desktop's width and a phone's (the follow-ups of #5300, part 1): what a
 * change did is said in the reader's language from what the cloud
 * recorded - the fixture's rows were written before titles were, as old
 * rows are - the hero names its identifier in the reader's language and
 * cuts a long one at its own end, a resource's Details say how it is run in
 * words, and what it runs in and is protected by has a name, not a cloud
 * type.
 * ---------------------------------------------------------------------------
 */

// FSI, LRI, RLI and PDI: the marks a Persian sentence sets its values apart with.
const ISOLATE_MARKS: RegExp = /[⁦-⁩]/g;

async function readText(locator: Locator): Promise<string> {
  return ((await locator.textContent()) || "")
    .replace(ISOLATE_MARKS, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function changeTitles(page: Page): Promise<Array<string>> {
  const titles: Locator = page.getByTestId("cloud-change-title");
  await expect(titles.first()).toBeVisible();
  const texts: Array<string> = [];
  for (const title of await titles.all()) {
    texts.push(await readText(title));
  }
  return texts;
}

const READERS: Array<{ code: string; locale: Record<string, string> }> = [
  { code: "de", locale: GERMAN },
  { code: "fa", locale: PERSIAN },
];

/*
 * #5702's review: the hero's identifier line is monospace, both its label
 * and its value - set apart in elements of their own, each took the page's
 * universal Inter rule until each said font-mono. #6149's follow-up: a label
 * that reads right to left (Persian) takes the page's font instead, as no
 * monospace font draws its letters; the identifier stays monospace.
 */
async function expectIdentifierInMonospace(
  page: Page,
  readerCode: string,
): Promise<void> {
  const fonts: Array<string> = await page
    .getByTestId("resource-overview-identifier")
    .evaluate((line: Element): Array<string> => {
      return Array.from(line.children).map((piece: Element): string => {
        return getComputedStyle(piece).fontFamily;
      });
    });

  expect(fonts).toHaveLength(2);
  const [labelFont, identifierFont] = fonts as [string, string];

  expect(identifierFont).toMatch(/mono/i);

  if (readerCode === "fa") {
    expect(labelFont).not.toMatch(/mono/i);
    expect(labelFont).toMatch(/Inter/);
  } else {
    expect(labelFont).toMatch(/mono/i);
  }
}

/*
 * Each value of a change's title - its operation, its resource - moves to
 * the next line whole, never breaking at its hyphen ("nightly-" / "export",
 * "sg-" / "0f1e2d3c..." on a phone). An operation the cloud writes as one
 * long word breaks only between its pieces - after its service's colon
 * ("elasticloadbalancing:" / "ModifyLoadBalancerAttributes"), a slash or a
 * dot - and each piece is one line: read from each piece's own letters, in
 * one frame. The value itself is no box, so the sentence's words go on
 * beside its last piece: held in one box that broke inside it, an operation
 * took the column's whole width and "on web-alb" went to a line of its own.
 */
async function expectTitleValuesWhole(page: Page): Promise<void> {
  const drawn: {
    values: Array<string>;
    pieces: Array<{ text: string; lines: number }>;
  } = await page.evaluate(
    (): {
      values: Array<string>;
      pieces: Array<{ text: string; lines: number }>;
    } => {
      const pieces: Array<{ text: string; lines: number }> = [];

      for (const piece of Array.from(
        document.querySelectorAll('[data-testid="cloud-change-title-piece"]'),
      )) {
        const text: string = piece.textContent || "";
        const range: Range = document.createRange();
        range.selectNodeContents(piece);
        // Where each line its letters are on starts, top to bottom.
        const tops: Array<number> = Array.from(range.getClientRects())
          .filter((rect: DOMRect): boolean => {
            return rect.width > 0;
          })
          .map((rect: DOMRect): number => {
            return rect.top;
          })
          .sort((first: number, second: number): number => {
            return first - second;
          });
        const lines: number = tops.filter(
          (top: number, index: number): boolean => {
            return index === 0 || top - tops[index - 1]! > 4;
          },
        ).length;

        pieces.push({ text, lines });
      }

      return {
        values: Array.from(
          document.querySelectorAll('[data-testid="cloud-change-title-value"]'),
        ).map((value: Element): string => {
          return getComputedStyle(value).display;
        }),
        pieces,
      };
    },
  );

  expect(drawn.pieces.length).toBeGreaterThan(0);
  for (const piece of drawn.pieces) {
    expect(piece).toEqual({ text: piece.text, lines: 1 });
  }
  expect(drawn.values.length).toBeGreaterThan(0);
  expect(new Set(drawn.values)).toEqual(new Set(["inline"]));
}

/*
 * Every line of every change's title starts where its line does - at the
 * left, or at the right on a page read right to left - read from the
 * letters on it. On a Persian page an operation held in one box that broke
 * inside it started its first line at the left, away from the sentence it
 * is part of ("elasticloadbalancing:" on the far side of the column, "روی
 * web-alb" under it at the right).
 */
async function expectTitleLinesFromTheirStart(page: Page): Promise<void> {
  const offsets: Array<{ title: string; offsets: Array<number> }> = await page
    .getByTestId("cloud-change-title")
    .evaluateAll(
      (
        titles: Array<Element>,
      ): Array<{ title: string; offsets: Array<number> }> => {
        return titles.map((title: Element) => {
          const isRightToLeft: boolean =
            getComputedStyle(title).direction === "rtl";
          const box: DOMRect = title.getBoundingClientRect();
          const range: Range = document.createRange();
          range.selectNodeContents(title);
          // Each line's letters, by where the line is.
          const lines: Map<number, Array<DOMRect>> = new Map();

          for (const rect of Array.from(range.getClientRects())) {
            if (rect.width <= 0) {
              continue;
            }
            const line: number | undefined = Array.from(lines.keys()).find(
              (top: number): boolean => {
                return Math.abs(top - rect.top) <= 4;
              },
            );
            lines.set(line === undefined ? rect.top : line, [
              ...(line === undefined ? [] : lines.get(line) || []),
              rect,
            ]);
          }

          // How far each line's first letter is from where the line starts.
          return {
            title: (title.textContent || "").trim(),
            offsets: Array.from(lines.values()).map(
              (rects: Array<DOMRect>): number => {
                return Math.round(
                  isRightToLeft
                    ? box.right -
                        Math.max(
                          ...rects.map((rect: DOMRect): number => {
                            return rect.right;
                          }),
                        )
                    : Math.min(
                        ...rects.map((rect: DOMRect): number => {
                          return rect.left;
                        }),
                      ) - box.left,
                );
              },
            ),
          };
        });
      },
    );

  expect(offsets.length).toBeGreaterThan(0);
  for (const title of offsets) {
    expect(title.offsets.length).toBeGreaterThan(0);
    // Within a pixel of the line's start: a letter's box is rounded.
    expect({
      title: title.title,
      offsets: title.offsets.map((offset: number): number => {
        return Math.abs(offset) <= 1 ? 0 : offset;
      }),
    }).toEqual({
      title: title.title,
      offsets: title.offsets.map((): number => {
        return 0;
      }),
    });
  }
}

test.describe("a cloud account and a cloud resource, in German and in Persian", () => {
  for (const reader of READERS) {
    test(`${reader.code}: the account's Overview and Changes`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openAccounts(
        page,
        `${ACCOUNTS_PATH}/${AWS_ACCOUNT}?state=connected&lang=${reader.code}`,
      );

      // The hero names the account in the reader's language.
      const identifier: Locator = page.getByTestId(
        "resource-overview-identifier",
      );
      await expect(identifier).toBeVisible();
      expect(await readText(identifier)).toBe(
        `${wordIn(reader.locale, "account")}: 123456789012`,
      );
      await expectIdentifierInMonospace(page, reader.code);
      // Its status says what it means, under the pointer.
      await expect(
        page.getByTestId("resource-overview-status"),
      ).toHaveAttribute(
        "title",
        wordIn(
          reader.locale,
          "A cloud connection read this account within the last hour.",
        ),
      );
      await expectNoSidewaysScroll(page, { tolerance: 1 });
      await shoot(page, `account-overview-${reader.code}`);

      await openAccounts(
        page,
        `${ACCOUNTS_PATH}/${AWS_ACCOUNT}/changes?state=connected&lang=${reader.code}`,
      );

      // What each did, in the reader's words - never the stored English.
      const titles: Array<string> = await changeTitles(page);
      expect(titles).toContain(
        wordIn(reader.locale, "Failed: {{operation}} on {{resource}}", {
          operation: "elasticloadbalancing:DeleteLoadBalancer",
          resource: "web-alb",
        }),
      );
      expect(titles).toContain(
        wordIn(reader.locale, "{{operation}} on {{resource}}", {
          operation: "ec2:AuthorizeSecurityGroupIngress",
          resource: "sg-0f1e2d3c4b5a69788",
        }),
      );
      expect(titles).not.toContain(
        "Failed: elasticloadbalancing:DeleteLoadBalancer on web-alb",
      );
      /*
       * What AWS Health published: its frame, its state and its kind of
       * event in the reader's words, the service as AWS names it - from the
       * title and the type the row keeps, as every health event was kept.
       */
      expect(titles).toContain(
        wordIn(reader.locale, "AWS Health: {{event}} (open)", {
          event: wordIn(reader.locale, "{{service}} operational issue", {
            service: "EC2",
          }),
        }),
      );
      expect(titles).not.toContain("AWS Health: EC2 operational issue (open)");
      await expectTitleValuesWhole(page);
      await expectTitleLinesFromTheirStart(page);
      /*
       * Each line the way its words read: every title here is worded in
       * the reader's language, so in Persian every one reads right to left
       * - the health event's too, though its first words are "AWS
       * Health:", which read by its first letter put its event and its
       * state in the wrong order (the UI review of #6149). The provider's
       * own English words under it read left to right.
       */
      const directions: Array<string> = await page
        .getByTestId("cloud-change-title")
        .evaluateAll((elements: Array<Element>): Array<string> => {
          return elements.map((element: Element): string => {
            return getComputedStyle(element).direction;
          });
        });
      expect(directions.length).toBeGreaterThan(1);
      expect(new Set(directions)).toEqual(
        new Set([reader.code === "fa" ? "rtl" : "ltr"]),
      );
      const healthLine: Locator = page
        .getByTestId("cloud-change-title")
        .filter({ hasText: "AWS Health" });
      await expect(healthLine).toHaveCount(1);
      await expect(healthLine).toHaveCSS(
        "direction",
        reader.code === "fa" ? "rtl" : "ltr",
      );
      await expect(page.getByTestId("cloud-change-detail")).toHaveCSS(
        "direction",
        "ltr",
      );
      /*
       * #6149's follow-up: AWS's own words are drawn as written - never
       * translated or rewritten - and marked as the English they are.
       */
      await expect(
        page.getByTestId("cloud-change-detail-written"),
      ).toHaveAttribute("lang", "en");
      await expect(page.getByTestId("cloud-change-detail-worded")).toHaveCount(
        0,
      );
      await expectNoSidewaysScroll(page, { tolerance: 1 });
      await shoot(page, `account-changes-${reader.code}`);
    });

    test(`${reader.code}: a resource's Overview and Changes`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openAccounts(
        page,
        `${RESOURCE_PATH}/${WEB_ALB}?state=connected&lang=${reader.code}`,
      );

      // The hero says what its identifier is, in the reader's language.
      const identifier: Locator = page.getByTestId(
        "resource-overview-identifier",
      );
      await expect(identifier).toBeVisible();
      expect(await readText(identifier)).toBe(
        `${wordIn(reader.locale, "type")}: Elastic Load Balancer (ALB, NLB, GWLB)`,
      );
      /*
       * A type longer than a phone's line is cut at its own end, in its
       * own direction: it still says "Elastic", never "…d Balancer".
       */
      const reading: { direction: string; startVisible: boolean } = await page
        .getByTestId("resource-overview-identifier-value")
        .evaluate(
          (element: Element): { direction: string; startVisible: boolean } => {
            /*
             * What is seen of it: its own box and its line's, either of
             * which may be the one that cuts it.
             */
            const own: DOMRect = element.getBoundingClientRect();
            const line: DOMRect =
              element.parentElement!.getBoundingClientRect();
            const left: number = Math.max(own.left, line.left);
            const right: number = Math.min(own.right, line.right);
            const range: Range = document.createRange();
            range.setStart(element.firstChild!, 0);
            range.setEnd(element.firstChild!, "Elastic".length);
            const word: DOMRect = range.getBoundingClientRect();
            return {
              direction: getComputedStyle(element).direction,
              startVisible:
                word.left >= left - 0.5 && word.right <= right + 0.5,
            };
          },
        );
      expect(reading).toEqual({ direction: "ltr", startVisible: true });
      await expectIdentifierInMonospace(page, reader.code);

      // How it is run, in words.
      await expect(
        cardTitled(page, wordIn(reader.locale, "Details")),
      ).toContainText(wordIn(reader.locale, "Infrastructure (IaaS)"));
      // What it runs in and is protected by: named, never a cloud type.
      const connected: Locator = cardTitled(
        page,
        wordIn(reader.locale, "Connected Resources"),
      );
      await expect(connected).toContainText(wordIn(reader.locale, "Subnet"));
      await expect(connected).toContainText(
        wordIn(reader.locale, "Security Group"),
      );
      await expect(connected).not.toContainText("AWS::EC2::");
      /*
       * A name and its kind in reading order, with the gap between them:
       * on a Persian page "web-1" and "EC2 Instance" read as one Latin run,
       * left to right, with no gap (#5702's review).
       */
      const webOne: Locator = connected
        .getByTestId("cloud-connected-resource")
        .filter({ hasText: "web-1" });
      const [name, kind]: Array<FrameBox> = await boxesInOneFrame([
        webOne.getByTestId("cloud-connected-resource-name"),
        webOne.getByTestId("cloud-connection-type"),
      ]);
      const gap: number =
        reader.code === "fa"
          ? name!.x - (kind!.x + kind!.width)
          : kind!.x - (name!.x + name!.width);
      expect(gap).toBeGreaterThanOrEqual(4);
      expect(gap).toBeLessThanOrEqual(12);
      await expectNoSidewaysScroll(page, { tolerance: 1 });
      await shoot(page, `resource-overview-${reader.code}`);

      await openAccounts(
        page,
        `${RESOURCE_PATH}/${WEB_ALB}/changes?state=connected&lang=${reader.code}`,
      );

      expect(await changeTitles(page)).toEqual([
        wordIn(reader.locale, "Failed: {{operation}} on {{resource}}", {
          operation: "elasticloadbalancing:DeleteLoadBalancer",
          resource: "web-alb",
        }),
        wordIn(reader.locale, "{{operation}} on {{resource}}", {
          operation: "elasticloadbalancing:ModifyLoadBalancerAttributes",
          resource: "web-alb",
        }),
      ]);
      await expectNoSidewaysScroll(page, { tolerance: 1 });
    });

    /*
     * #6149's follow-up: what Azure published about its health
     * (?changes=health). The sentences OneUptime writes about an event -
     * who published it, its tracking id, what caused a resource's change -
     * read in the reader's words, from the English the row keeps; Azure's
     * own words are drawn as written, marked as the English they are, set
     * apart in the reader's line.
     */
    test(`${reader.code}: what Azure published about its health`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openAccounts(
        page,
        `${ACCOUNTS_PATH}/${AZURE_ACCOUNT}/changes?state=connected&changes=health&lang=${reader.code}`,
      );

      expect(await changeTitles(page)).toEqual([
        wordIn(reader.locale, "Azure Service Health: {{event}} (Active)", {
          event: "Network connectivity issues in West Europe",
        }),
        wordIn(reader.locale, "Azure Resource Health: {{status}} → {{event}}", {
          status: wordIn(reader.locale, "Available"),
          event: wordIn(reader.locale, "Unavailable"),
        }),
      ]);

      const details: Locator = page.getByTestId("cloud-change-detail");
      await expect(details).toHaveCount(2);
      const readerDirection: string = reader.code === "fa" ? "rtl" : "ltr";

      // The incident's line is all OneUptime's: in the reader's words.
      const published: Locator = details.nth(0);
      expect(await readText(published)).toBe(
        `${wordIn(reader.locale, "Azure published an incident.")} ${wordIn(
          reader.locale,
          "Tracking ID: {{trackingId}}.",
          { trackingId: "7NQ8-TX0" },
        )}`,
      );
      await expect(
        published.getByTestId("cloud-change-detail-written"),
      ).toHaveCount(0);
      await expect(published).toHaveCSS("direction", readerDirection);
      /*
       * #6149's UI review: Azure's tracking id is kept whole on its line,
       * never broken at its hyphen ("7NQ8-" over "TX0." in German).
       */
      const identifier: Locator = published.getByTestId(
        "cloud-change-detail-identifier",
      );
      await expect(identifier).toHaveText("7NQ8-TX0");
      await expect(identifier).toHaveCSS("white-space", "nowrap");
      expect(
        await identifier.evaluate((element: Element): number => {
          return element.getClientRects().length;
        }),
      ).toBe(1);

      // The resource's: Azure's title as written, then what caused it.
      const caused: Locator = details.nth(1);
      const written: Locator = caused.getByTestId(
        "cloud-change-detail-written",
      );
      await expect(written).toHaveText(
        "The virtual machine is being restarted for a planned platform update.",
      );
      await expect(written).toHaveAttribute("lang", "en");
      await expect(written).toHaveCSS("direction", "ltr");
      const worded: Locator = caused.getByTestId("cloud-change-detail-worded");
      await expect(worded).toHaveText(
        wordIn(reader.locale, "Azure caused it."),
      );
      await expect(caused).toHaveCSS("direction", readerDirection);

      // Never the stored English sentences.
      await expect(
        page.getByText("Incident published by Azure", { exact: false }),
      ).toHaveCount(0);
      await expect(
        page.getByText("Azure caused it.", { exact: true }),
      ).toHaveCount(0);

      /*
       * Read from the reader's end: Azure's words start the line - at its
       * right on a Persian page - and the reader's follow them, further
       * along the same line or on the next; both are seen, within the two
       * lines the list gives what was said about a change.
       */
      const [lineBox, writtenBox, wordedBox]: Array<FrameBox> =
        await boxesInOneFrame([caused, written, worded]);
      if (reader.code === "fa") {
        expect(
          Math.abs(
            lineBox!.x + lineBox!.width - (writtenBox!.x + writtenBox!.width),
          ),
        ).toBeLessThan(1.5);
      } else {
        expect(Math.abs(lineBox!.x - writtenBox!.x)).toBeLessThan(1.5);
      }
      if (Math.abs(writtenBox!.y - wordedBox!.y) < 2) {
        if (reader.code === "fa") {
          expect(writtenBox!.x).toBeGreaterThanOrEqual(
            wordedBox!.x + wordedBox!.width,
          );
        } else {
          expect(wordedBox!.x).toBeGreaterThanOrEqual(
            writtenBox!.x + writtenBox!.width,
          );
        }
      } else {
        expect(wordedBox!.y).toBeGreaterThan(writtenBox!.y);
      }
      expect(wordedBox!.y + wordedBox!.height).toBeLessThanOrEqual(
        lineBox!.y + lineBox!.height + 0.5,
      );
      await expectNoSidewaysScroll(page, { tolerance: 1 });
      await shoot(page, `azure-health-${reader.code}`);
    });
  }
});

/*
 * ---------------------------------------------------------------------------
 * The changes OneUptime AI made, on an account's Changes (#5367's
 * follow-up). The cloud records them under the Cloud AI agent's role, as
 * an assumed-role session; the list says OneUptime AI made them and links
 * each to its fix: the incident it fixed, by its number, who approved it,
 * and its entry in the account's AI Logs, which opens on that fix, marked.
 * A person's change stays as it was. At 1280 and 390 pixels, dark, in
 * German and right to left in Persian (?changes=ai).
 * ---------------------------------------------------------------------------
 */

const AI_CHANGES_PATH: string = `${ACCOUNTS_PATH}/${AWS_ACCOUNT}/changes?state=connected&changes=ai`;
const AI_FIX: string = "80000000-0000-4000-8000-000000000001";
const FIXED_INCIDENT: string = "70000000-0000-4000-8000-000000000001";
const AI_SESSION: string = "oneuptime-ai-scale-out-9f2c61d0";

// The line under each change OneUptime AI made, newest first.
function aiLines(page: Page): Locator {
  return page.getByTestId("cloud-change-ai");
}

interface SuggestionListRequest {
  model: string;
  ids?: Array<string>;
  select?: Array<string>;
}

async function waitForAiLines(page: Page): Promise<[Locator, Locator]> {
  await expect(aiLines(page)).toHaveCount(2);
  // The rollback, half an hour ago, above the fix, 39 minutes ago.
  const rollback: Locator = aiLines(page).nth(0);
  const fix: Locator = aiLines(page).nth(1);
  // The fix says who approved it once it was read.
  await expect(approvalOf(page, 1)).toBeVisible();
  return [rollback, fix];
}

/*
 * Who approved the change OneUptime AI made, newest first: the By column's
 * to say beside the change on a desktop, and the line's, on a row of its
 * own, on a phone - whose card draws no By column.
 */
function approvalOf(page: Page, index: number): Locator {
  return isDesktop()
    ? page
        .getByTestId("cloud-change-ai-actor")
        .nth(index)
        .getByTestId("cloud-change-ai-actor-approval")
    : aiLines(page).nth(index).getByTestId("cloud-change-ai-approval");
}

/*
 * The number of the record a change fixed, as a sentence of the language
 * holds it: set apart from the words around it where they read right to
 * left, as every Persian sentence's values are.
 */
function numberIn(locale: Record<string, string>, value: string): string {
  return locale === PERSIAN
    ? `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`
    : value;
}

test.describe("OneUptime AI's changes, on an account's Changes", () => {
  test("its fix and the fix's rollback read OneUptime AI, linked to the incident and its AI Logs entry, the fix with its approver; a person's change is as it was", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(page, AI_CHANGES_PATH);

    const [rollback, fix] = await waitForAiLines(page);

    /*
     * A rollback is titled as the recorder titles any change - the same
     * operation on the same resource as its fix - and only its line says it
     * undid the fix: no word is added to its title. Both rows are as the
     * recorder writes them: CloudTrail's operation with its service, the
     * resource by the name the inventory holds, and the kind of change
     * classifyCloudChange gives an ECS UpdateService that set only the
     * desired count - scaling, though UpdateService is how ECS deploys too
     * (isAwsScaleOnlyUpdate).
     */
    if (isDesktop()) {
      const aiRows: Locator = page
        .getByRole("row")
        .filter({ has: page.getByTestId("cloud-change-ai") });

      await expect(aiRows).toHaveCount(2);

      for (const index of [0, 1]) {
        const row: Locator = aiRows.nth(index);

        await expect(row.getByTestId("cloud-change-title-value")).toHaveText([
          "ecs:UpdateService",
          "checkout",
        ]);
        await expect(row.getByTestId("cloud-change-title")).toHaveText(
          "ecs:UpdateService on checkout",
        );
        await expect(row.getByText("Scaling", { exact: true })).toBeVisible();
        await expect(row.getByText("Deploy", { exact: true })).toHaveCount(0);
        await expect(row).not.toContainText("rolled back");
      }
    }

    await expect(
      fix.getByRole("link", { name: "Fix for incident #18" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/incidents/${FIXED_INCIDENT}`,
    );
    await expect(approvalOf(page, 1)).toHaveText("Approved by Maya Chen");
    await expect(fix.getByRole("link", { name: "AI Logs" })).toHaveAttribute(
      "href",
      `${AI_LOGS_PATH}#fix-${AI_FIX}`,
    );
    await expect(
      rollback.getByRole("link", {
        name: "Rollback of the fix for incident #18",
      }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/incidents/${FIXED_INCIDENT}`,
    );
    await expect(
      rollback.getByRole("link", { name: "AI Logs" }),
    ).toHaveAttribute("href", `${AI_LOGS_PATH}#fix-${AI_FIX}`);
    // The rollback arm ran it on its own: nobody approved the rollback.
    await expect(approvalOf(page, 0)).toHaveCount(0);
    // Two links, apart by a gap: no dot is left at the end of a line.
    await expect(fix.getByTestId("cloud-change-ai-links")).not.toContainText(
      "·",
    );

    // The fix both changes name was read once, as the reader, with what the row says.
    const reads: Array<SuggestionListRequest> = (
      (await listRequests(page)) as unknown as Array<SuggestionListRequest>
    ).filter((request: SuggestionListRequest): boolean => {
      return request.model === "AutoRemediationSuggestion";
    });
    expect(
      reads.map((read: SuggestionListRequest) => {
        return read.ids;
      }),
    ).toEqual([[AI_FIX]]);
    expect(reads[0]!.select).toEqual(
      expect.arrayContaining(["approvedByUser", "incident", "status"]),
    );

    if (isDesktop()) {
      // The By column says OneUptime AI, and who approved the fix under it.
      const actors: Locator = page.getByTestId("cloud-change-ai-actor");
      await expect(actors).toHaveCount(2);
      await expect(actors.nth(0)).toHaveText("OneUptime AI");
      await expect(actors.nth(1)).toHaveText(
        "OneUptime AIApproved by Maya Chen",
      );
      // The role's session the cloud's audit log names: on the name's hover, never cut short.
      await expect(
        actors.nth(1).getByTestId("cloud-change-ai-actor-name"),
      ).toHaveAttribute("title", AI_SESSION);
      await expect(actors.nth(1)).not.toContainText("oneuptime-ai-scal");
      // So the line does not say it again, and its two links share one row.
      await expect(fix.getByTestId("cloud-change-ai-mark")).toHaveCount(0);
      await expect(fix).toHaveText("Fix for incident #18AI Logs");
      const [subject, logs] = await boxesInOneFrame([
        fix.getByRole("link", { name: "Fix for incident #18" }),
        fix.getByRole("link", { name: "AI Logs" }),
      ]);
      expect(Math.abs(subject!.y - logs!.y)).toBeLessThan(4);
      expect(logs!.x).toBeGreaterThan(subject!.x + subject!.width);
      // A person's change: their name, and no line of OneUptime AI's.
      await expect(page.getByTestId("cloud-change-actor").first()).toHaveText(
        "maya.lopez",
      );
      const person: Locator = page
        .locator("tbody tr")
        .filter({ hasText: "AuthorizeSecurityGroupIngress" });
      await expect(person.getByTestId("cloud-change-ai")).toHaveCount(0);
      await expect(page.locator("tbody tr")).toHaveCount(8);
    } else {
      // A phone's card draws no By column: the line says who first, on a row of its own.
      await expect(fix.getByTestId("cloud-change-ai-mark")).toBeVisible();
      await expect(fix.getByTestId("cloud-change-ai-mark")).toHaveText(
        "OneUptime AI·Approved by Maya Chen",
      );
      await expect(rollback.getByTestId("cloud-change-ai-mark")).toHaveText(
        "OneUptime AI",
      );
      const [mark, links] = await boxesInOneFrame([
        fix.getByTestId("cloud-change-ai-mark"),
        fix.getByTestId("cloud-change-ai-links"),
      ]);
      expect(links!.y).toBeGreaterThanOrEqual(mark!.y + mark!.height - 1);
    }

    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "account-changes-ai");
  });

  test("its AI Logs link opens the account's AI Logs on that fix, marked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(page, AI_CHANGES_PATH);

    const [, fix] = await waitForAiLines(page);
    await fix.getByRole("link", { name: "AI Logs" }).click();

    await expect(page).toHaveURL(new RegExp(`/ai/logs#fix-${AI_FIX}$`));
    const linked: Locator = page.locator(
      '[data-testid="ai-logs-fix"][data-linked="true"]',
    );
    await expect(linked).toHaveCount(1);
    await expect(linked).toHaveAttribute("aria-current", "true");
    await expect(linked).toContainText("Approved by Maya Chen");
    await expect(linked).toBeInViewport();
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "account-ai-logs-linked-fix");
  });

  test("dark: the line and its links read on the dark page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(page, `${AI_CHANGES_PATH}&theme=dark`);

    await expect(page.locator("html")).toHaveClass(/dark/);
    const [, fix] = await waitForAiLines(page);
    await expect(
      fix.getByRole("link", { name: "Fix for incident #18" }),
    ).toBeVisible();
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "account-changes-ai-dark");
  });

  for (const [language, locale, name] of [
    ["de", GERMAN, "German"],
    ["fa", PERSIAN, "Persian"],
  ] as Array<[string, Record<string, string>, string]>) {
    test(`${name}: every phrase of the line is the language's own`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openAccounts(page, `${AI_CHANGES_PATH}&lang=${language}`);

      const [rollback, fix] = await waitForAiLines(page);
      const subject: string = wordIn(locale, "Fix for incident {{number}}", {
        number: numberIn(locale, "#18"),
      });
      const logs: string = wordIn(locale, "AI Logs");

      expect(subject).not.toContain("Fix for incident");
      await expect(fix.getByRole("link", { name: subject })).toBeVisible();
      await expect(fix.getByRole("link", { name: logs })).toBeVisible();
      await expect(
        rollback.getByRole("link", {
          name: wordIn(locale, "Rollback of the fix for incident {{number}}", {
            number: numberIn(locale, "#18"),
          }),
        }),
      ).toBeVisible();
      const approval: Locator = approvalOf(page, 1);
      await expect(approval).toContainText("Maya Chen");
      for (const part of wordIn(locale, "Approved by {{name}}").split(
        "{{name}}",
      )) {
        if (part.trim()) {
          await expect(approval).toContainText(part.trim());
        }
      }
      for (const english of [
        "Fix for incident",
        "Rollback of",
        "Approved by",
      ]) {
        await expect(page.locator("body")).not.toContainText(english);
      }

      if (language === "fa") {
        await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
        // Right to left: the record it fixed first, on the right; AI Logs last, on the left.
        const [first, last] = await boxesInOneFrame([
          fix.getByRole("link", { name: subject }),
          fix.getByRole("link", { name: logs }),
        ]);
        if (Math.abs(first!.y - last!.y) < 4) {
          expect(first!.x).toBeGreaterThan(last!.x);
        }
      }

      await expectNoSidewaysScroll(page, { tolerance: 1 });

      /*
       * The table fits its card: in German at 1280, beside a 12-hour time
       * and "Konfigurationsänderung", the By column's 10rem floor held it
       * 16 pixels past its card, and the Region scrolled (#5704's review).
       */
      if (isDesktop()) {
        expect(
          await page
            .getByTestId("table-scroll")
            .evaluate((element: HTMLElement): number => {
              return element.scrollWidth - element.clientWidth;
            }),
        ).toBeLessThanOrEqual(1);
      }

      await shoot(page, `account-changes-ai-${language}`);
    });
  }
});

/*
 * #5704's review: a browser set to US English reads times on a 12-hour
 * clock, each time wider by its AM or PM. In German at 1280, beside
 * "Konfigurationsänderung", the By column's 10rem floor then held the table
 * 16 pixels past its card, and the Region scrolled. Its 7rem floor lets it
 * fit (CloudChangesTable's CLOUD_CHANGE_BY_CONTENT_CLASS_NAME).
 */
test.describe("an account's Changes in German, on a 12-hour clock", () => {
  test.use({ locale: "en-US" });

  test("the table fits its card at 1280: no column scrolls past it", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(!isDesktop(), "A phone draws each change as a card.");

    await openAccounts(page, `${AI_CHANGES_PATH}&lang=de`);
    await waitForAiLines(page);

    // The times are on a 12-hour clock.
    await expect(
      page.locator("tbody tr").first().locator("td").nth(1),
    ).toHaveText(/\b(AM|PM)$/);
    expect(
      await page
        .getByTestId("table-scroll")
        .evaluate((element: HTMLElement): number => {
          return element.scrollWidth - element.clientWidth;
        }),
    ).toBeLessThanOrEqual(1);
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "account-changes-ai-de-12-hour");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Google Cloud's agent: on a small VM by default, about $10 a month, in a
 * network that lets nothing in - or, under More fields, on Cloud Run with
 * CPU always allocated, about $45. The dialog prices the host chosen and
 * writes its command and its logs command (#5367's follow-up).
 * ---------------------------------------------------------------------------
 */
test.describe("where Google Cloud's agent runs", () => {
  const GCP_ACCOUNT_PATH: string = `${ACCOUNTS_PATH}/${GCP_ACCOUNT}?state=connected`;

  function hostChoice(page: Page): Locator {
    return setupDialog(page).getByTestId("cloud-ai-agent-setup-host");
  }

  test("a small VM by default, priced and written as one; Cloud Run under More fields, as one too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAccounts(page, GCP_ACCOUNT_PATH);
    await openSetup(page);

    const command: Locator = setupDialog(page).getByTestId(
      "cloud-ai-agent-setup-command",
    );
    const cost: Locator = setupDialog(page).getByTestId(
      "cloud-ai-agent-setup-cost",
    );
    const logs: Locator = setupDialog(page).getByTestId(
      "cloud-ai-agent-setup-logs-command",
    );

    await expect(command).toContainText(
      "gcloud compute instances create oneuptime-ai-agent",
    );
    await expect(command).toContainText("acme-legacy");
    await expect(command).not.toContainText("gcloud run deploy");
    await expect(cost).toHaveText(
      "It runs on one small always-on VM in your project: about $10 a month at list prices, billed by your cloud. Google Cloud's free tier can cover it.",
    );
    await expect(logs).toContainText("gcloud logging read");

    // Where it runs is asked under More fields, the VM chosen.
    await expect(hostChoice(page)).toBeHidden();
    await setupDialog(page)
      .getByRole("button", { name: "More fields" })
      .click();
    await expect(hostChoice(page)).toBeVisible();
    await expect(hostChoice(page).locator("legend")).toHaveText(
      "Where the agent runs",
    );
    await expect(
      setupDialog(page).getByTestId("cloud-ai-agent-setup-host-compute-engine"),
    ).toBeChecked();
    await expect(hostChoice(page)).toContainText(
      "One e2-micro Compute Engine VM in a network of its own that lets nothing in: about $10 a month.",
    );
    await expect(hostChoice(page)).toContainText(
      "A Cloud Run service with CPU always allocated: about $45 a month. For a project that allows no VM an external IP address.",
    );
    // Running it somewhere else: the image in Google Cloud, with its variables...
    await expect(
      setupDialog(page).getByTestId("cloud-ai-agent-setup-elsewhere"),
    ).toHaveText(wordIn({}, GCP_ELSEWHERE, { image: AGENT_IMAGE }));
    // ...and its two identities: Token Creator on the write account, as the command makes them.
    await expect(
      setupDialog(page)
        .getByTestId("cloud-ai-agent-setup-elsewhere-identities")
        .locator("li"),
    ).toHaveText([
      GCP_ELSEWHERE_OWN,
      wordIn({}, GCP_ELSEWHERE_WRITE, {
        writeAccount: "oneuptime-ai-agent-write",
      }),
    ]);
    await expect
      .poll(async () => {
        return await elsewhereNameLines(page);
      })
      .toEqual([
        { name: AGENT_IMAGE, lines: 1 },
        { name: "oneuptime-ai-agent-write", lines: 1 },
      ]);
    await shoot(page, "account-ai-setup-gcp-host");
    await setupDialog(page)
      .getByTestId("cloud-ai-agent-setup-elsewhere-identities")
      .scrollIntoViewIfNeeded();
    await shoot(page, "account-ai-setup-gcp-elsewhere");

    // Cloud Run: its command, its price and its logs.
    await setupDialog(page)
      .getByTestId("cloud-ai-agent-setup-host-cloud-run")
      .check();
    await expect(command).toContainText("gcloud run deploy oneuptime-ai-agent");
    await expect(command).not.toContainText("gcloud compute instances create");
    // A project, as Google Cloud and the VM's line name it.
    await expect(cost).toHaveText(
      "It runs one small always-on container in your project: about $45 a month at list prices, billed by your cloud.",
    );
    await expect(logs).toContainText("gcloud run services logs read");

    // Folded again, More fields says where it runs, now that it is not the default.
    await setupDialog(page)
      .getByRole("button", { name: /More fields/ })
      .click();
    await expect(hostChoice(page)).toBeHidden();
    await expect(
      setupDialog(page).getByTestId("cloud-ai-agent-setup-more-fields"),
    ).toContainText("Cloud Run");

    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "account-ai-setup-gcp");
  });

  for (const [language, locale, name] of [
    ["de", GERMAN, "German"],
    ["fa", PERSIAN, "Persian"],
  ] as Array<[string, Record<string, string>, string]>) {
    test(`${name}: where it runs, and what each costs, in the language's words`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openAccounts(page, `${GCP_ACCOUNT_PATH}&lang=${language}`);
      await openSetup(page);

      await expect(
        setupDialog(page).getByTestId("cloud-ai-agent-setup-cost"),
      ).toHaveText(
        wordIn(
          locale,
          "It runs on one small always-on VM in your project: about ${{usd}} a month at list prices, billed by your cloud. Google Cloud's free tier can cover it.",
          { usd: "10" },
        ),
      );
      await setupDialog(page)
        .getByRole("button", { name: wordIn(locale, "More fields") })
        .click();
      await expect(hostChoice(page).locator("legend")).toHaveText(
        wordIn(locale, "Where the agent runs"),
      );
      await expect(hostChoice(page)).toContainText(
        wordIn(locale, "A small VM"),
      );
      expect(wordIn(locale, "A small VM")).not.toBe("A small VM");
      // Running it somewhere else, in the language's words, with the names as they are.
      await expect(
        setupDialog(page).getByTestId("cloud-ai-agent-setup-elsewhere"),
      ).toHaveText(
        wordIn(locale, GCP_ELSEWHERE, {
          image: nameIn(locale, AGENT_IMAGE),
        }),
      );
      const identities: Locator = setupDialog(page).getByTestId(
        "cloud-ai-agent-setup-elsewhere-identities",
      );
      await expect(
        identities.locator("xpath=preceding-sibling::p[1]"),
      ).toHaveText(wordIn(locale, ELSEWHERE_IDENTITIES));
      await expect(identities.locator("li")).toHaveText([
        wordIn(locale, GCP_ELSEWHERE_OWN),
        wordIn(locale, GCP_ELSEWHERE_WRITE, {
          writeAccount: nameIn(locale, "oneuptime-ai-agent-write"),
        }),
      ]);
      // The names are code, as the changes' names above them are, and each whole on its line.
      await expect(
        setupDialog(page).getByTestId("cloud-ai-agent-setup-elsewhere-name"),
      ).toHaveText([AGENT_IMAGE, "oneuptime-ai-agent-write"]);
      await expect
        .poll(async () => {
          return await elsewhereNameLines(page);
        })
        .toEqual([
          { name: AGENT_IMAGE, lines: 1 },
          { name: "oneuptime-ai-agent-write", lines: 1 },
        ]);

      for (const english of [
        GCP_ELSEWHERE,
        ELSEWHERE_IDENTITIES,
        GCP_ELSEWHERE_OWN,
        GCP_ELSEWHERE_WRITE,
      ]) {
        expect(wordIn(locale, english)).not.toBe(english);
      }
      await expect(hostChoice(page)).toContainText(
        wordIn(
          locale,
          "A Cloud Run service with CPU always allocated: about ${{usd}} a month. For a project that allows no VM an external IP address.",
          { usd: "45" },
        ),
      );
      await expectNoSidewaysScroll(page, { tolerance: 1 });
      await shoot(page, `account-ai-setup-gcp-${language}`);
      await identities.scrollIntoViewIfNeeded();
      await shoot(page, `account-ai-setup-gcp-elsewhere-${language}`);
    });
  }
});

/*
 * ---------------------------------------------------------------------------
 * Azure's agent runs as two identities: its Container App's own, which
 * only reads, and the write identity oneuptime-ai-agent-write, which its
 * changes run as. The command makes both, and running the agent somewhere
 * else says what it needs, as the command makes it (#6156).
 * ---------------------------------------------------------------------------
 */
test.describe("Azure's agent: an identity that reads, and one for changes", () => {
  test("the command makes the write identity, and running it somewhere else needs both", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(!isDesktop(), "What it says: a desktop's.");

    await openAccounts(
      page,
      `${ACCOUNTS_PATH}/${AZURE_ACCOUNT}?state=connected`,
    );
    await openSetup(page);

    // The write identity, attached to the agent's Container App with its own.
    const command: Locator = setupDialog(page).getByTestId(
      "cloud-ai-agent-setup-command",
    );
    await expect(command).toContainText(
      'az identity create --subscription "$SUBSCRIPTION" --name oneuptime-ai-agent-write',
    );
    await expect(command).toContainText(
      "--system-assigned --user-assigned /subscriptions/7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b/resourceGroups/oneuptime-ai-agent/providers/Microsoft.ManagedIdentity/userAssignedIdentities/oneuptime-ai-agent-write",
    );

    await setupDialog(page)
      .getByRole("button", { name: "More fields" })
      .click();
    // The variables name it, by resource ID, as the agent asks for its token.
    await expect(setupDialog(page)).toContainText(
      "ONEUPTIME_AI_AZURE_WRITE_IDENTITY=/subscriptions/7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b/resourceGroups/oneuptime-ai-agent/providers/Microsoft.ManagedIdentity/userAssignedIdentities/oneuptime-ai-agent-write",
    );
    // Running it somewhere else: the image in Azure, over those variables...
    await expect(
      setupDialog(page).getByTestId("cloud-ai-agent-setup-elsewhere"),
    ).toHaveText(
      `Deploy the image ${AGENT_IMAGE} your own way in Azure, with these variables:`,
    );
    // ...and its two identities: one of its own that only reads, and the write identity attached.
    const identities: Locator = setupDialog(page).getByTestId(
      "cloud-ai-agent-setup-elsewhere-identities",
    );
    await expect(
      identities.locator("xpath=preceding-sibling::p[1]"),
    ).toHaveText(ELSEWHERE_IDENTITIES);
    await expect(identities.locator("li")).toHaveText([
      "A managed identity of its own that only reads.",
      "The write identity oneuptime-ai-agent-write, attached where the agent runs, which holds the permissions of the changes AI may make.",
    ]);
    await expect(
      setupDialog(page).getByTestId("cloud-ai-agent-setup-elsewhere-name"),
    ).toHaveText([AGENT_IMAGE, "oneuptime-ai-agent-write"]);

    await identities.scrollIntoViewIfNeeded();
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "account-ai-setup-azure-elsewhere");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Streaming an AWS account's CloudWatch metrics and logs through Amazon
 * Data Firehose, from its row: the dialog's one question and three steps
 * (a stream key shown once, one command for AWS CloudShell, the first
 * delivery waited for), named log groups, a refused delivery and why, and
 * Stop streaming with the command that deletes the stacks. A function's
 * page in Cloud gains the Logs its log group streams. ?https=1 makes the
 * fixture a OneUptime on an HTTPS address: Firehose delivers to no other.
 * ---------------------------------------------------------------------------
 */

const AWS_CONNECTION: string = "20000000-0000-4000-8000-000000000001";
const NIGHTLY_EXPORT: string = "40000000-0000-4000-8000-000000000003";
const STREAM_METRICS_URL: string =
  "https://oneuptime.example.com/telemetry/aws-firehose/v1/metrics";

interface StreamState {
  streamKeys: Array<string>;
  streamStops: Array<string>;
}

async function streamState(page: Page): Promise<StreamState> {
  return (await fixture(page)) as unknown as StreamState;
}

function streamDialog(page: Page): Locator {
  return dialog(page).getByTestId("cloud-stream");
}

// The AWS connection is the first row; its actions are in its ⋯ menu.
async function openRowMenu(page: Page, index: number = 0): Promise<void> {
  await page.getByTestId("row-actions-more-button").nth(index).click();
}

async function openStreaming(
  page: Page,
  query: string,
  locale: Record<string, string> = {},
): Promise<void> {
  await open(page, query);
  await openRowMenu(page);
  await page
    .getByRole("menuitem", {
      name: wordIn(locale, "Stream metrics and logs"),
    })
    .click();
  await expect(streamDialog(page)).toBeVisible();
}

function streamCommand(page: Page): Locator {
  return streamDialog(page).getByTestId("cloud-stream-command");
}

function streamLine(page: Page): Locator {
  return page.getByTestId("cloud-connection-stream");
}

// One part of the open streaming dialog, by its test id's last word.
function streamPart(page: Page, name: string): Locator {
  return streamDialog(page).getByTestId(`cloud-stream-${name}`);
}

// The rows after AWS's: the Azure subscription, then the Google Cloud project.
const AZURE_ROW: number = 1;
const GCP_ROW: number = 2;

test.describe("streaming an AWS account's metrics and logs", () => {
  test("from the AWS row: one question, three steps, and the command waits for its key", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openStreaming(page, "state=connected&https=1");

    await expect(
      dialog(page).getByRole("heading", { name: "Stream metrics and logs" }),
    ).toBeVisible();

    // One question, three answers, metrics by default.
    const question: Locator = streamDialog(page).getByRole("radiogroup", {
      name: "What should it stream?",
    });
    await expect(question.getByRole("radio")).toHaveCount(3);
    await expect(
      question.getByRole("radio", { name: /^Metrics Every key metric/ }),
    ).toHaveAttribute("aria-checked", "true");

    // Three numbered steps: the key, the command, the first delivery.
    for (const [index, title] of [
      [1, "Make a stream key"],
      [2, "Run this in AWS CloudShell"],
      [3, "Wait for the first delivery"],
    ] as Array<[number, string]>) {
      await expect(
        streamDialog(page).getByTestId(`setup-guide-step-${index}`),
      ).toContainText(title);
    }

    // The command: the template, then a stack in each Region the read found.
    await expect(streamCommand(page)).toContainText(
      "cat > oneuptime-stream.json <<'TEMPLATE'",
    );
    await expect(streamCommand(page)).toContainText(STREAM_METRICS_URL);
    await expect(streamCommand(page)).toContainText(
      "for REGION in us-east-1 eu-west-1; do",
    );
    await expect(streamCommand(page)).toContainText(
      "STREAM_KEY='<YOUR_STREAM_KEY>'",
    );
    await expect(
      streamDialog(page).getByTestId("cloud-stream-needs-key"),
    ).toBeVisible();
    await expect(
      streamDialog(page).getByTestId("cloud-stream-open-shell"),
    ).toHaveAttribute("href", "https://console.aws.amazon.com/cloudshell/home");
    await expect(
      streamDialog(page).getByTestId("cloud-stream-live"),
    ).toHaveAttribute("data-state", "no-key");
    // Nothing was asked of the server yet.
    expect((await streamState(page)).streamKeys).toEqual([]);

    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "stream-dialog");
  });

  test("Make a stream key: the command holds it, shown this once, and the row says the stream waits", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openStreaming(page, "state=connected&https=1");

    await streamDialog(page).getByTestId("cloud-stream-make-key").click();

    await expect(
      streamDialog(page).getByTestId("cloud-stream-key-made"),
    ).toContainText(
      "Key made. The command below holds it, and it is shown only here",
    );
    await expect(streamCommand(page)).toContainText(
      `STREAM_KEY='oucs_${AWS_CONNECTION}_`,
    );
    await expect(streamCommand(page)).not.toContainText("<YOUR_STREAM_KEY>");
    await expect(
      streamDialog(page).getByTestId("cloud-stream-needs-key"),
    ).toHaveCount(0);
    await expect(
      streamDialog(page).getByTestId("cloud-stream-live"),
    ).toHaveAttribute("data-state", "waiting");
    expect((await streamState(page)).streamKeys).toEqual([AWS_CONNECTION]);

    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "stream-key-made");

    // Closed: the row says the stream waits for its first delivery.
    await dialog(page).getByTestId("modal-footer-close-button").click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(streamLine(page)).toHaveText("Stream waiting");
    await expect(streamLine(page)).toHaveAttribute("data-state", "waiting");
  });

  test("the first delivery: the dialog says what arrived from where, and Done", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(!isDesktop(), "What it says: a desktop's.");

    await openStreaming(page, "state=connected&https=1&stream=waiting");

    const live: Locator = streamDialog(page).getByTestId("cloud-stream-live");
    await expect(live).toHaveAttribute("data-state", "waiting");
    await expect(live).toContainText("Waiting for the first delivery.");
    // A key made before cannot be shown again: a new one, to run it again.
    await expect(
      streamDialog(page).getByTestId("cloud-stream-make-key"),
    ).toHaveText("Make a new key");

    // The command finished in AWS: Firehose delivers.
    await page.evaluate(() => {
      (
        window as unknown as { __cloudConnectFixture: { deliver: () => void } }
      ).__cloudConnectFixture.deliver();
    });

    // The dialog asks every five seconds: nothing to press.
    await expect(live).toHaveAttribute("data-state", "receiving", {
      timeout: 12000,
    });
    await expect(live).toContainText("Receiving. The last delivery came");
    const sources: Locator = streamDialog(page).getByTestId(
      "cloud-stream-sources",
    );
    await expect(sources).toContainText(
      "Metrics of 12 namespaces from us-east-1",
    );
    await expect(sources).toContainText("Logs of 3 log groups from eu-west-1");
    await expect(
      dialog(page).getByTestId("modal-footer-close-button"),
    ).toHaveText("Done");
    await live.scrollIntoViewIfNeeded();
    await shoot(page, "stream-receiving");

    await dialog(page).getByTestId("modal-footer-close-button").click();
    await expect(streamLine(page)).toHaveText("Streaming");
  });

  test("Metrics and logs: the log groups named go in the template, in the Region beside them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openStreaming(page, "state=connected&https=1");

    await streamDialog(page)
      .getByRole("radio", { name: /^Metrics and logs/ })
      .click();

    const problem: Locator = streamDialog(page).getByTestId(
      "cloud-stream-problem",
    );
    await expect(problem).toHaveText("Name at least one log group.");
    await expect(streamCommand(page)).toHaveCount(0);
    await expect(
      streamDialog(page).getByTestId("cloud-stream-log-groups-region"),
    ).toHaveValue("us-east-1");

    await streamDialog(page)
      .getByTestId("cloud-stream-log-groups")
      .fill("/aws/lambda/checkout\n/aws/rds/instance/orders-db/error");

    await expect(problem).toHaveCount(0);
    await expect(streamCommand(page)).toContainText("/aws/lambda/checkout");
    await expect(streamCommand(page)).toContainText(
      "/aws/rds/instance/orders-db/error",
    );
    await expect(streamCommand(page)).toContainText(
      "AWS::Logs::SubscriptionFilter",
    );

    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "stream-logs");
  });

  test("More fields: every metric costs more and says so, and a Region AWS does not have stops the command", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(!isDesktop(), "What it does: a desktop's.");

    await openStreaming(page, "state=connected&https=1");

    const fold: Locator = streamDialog(page).getByTestId(
      "cloud-stream-more-fields",
    );
    await expect(fold).toContainText("Regions: 2");
    await fold.getByRole("button", { name: "More fields" }).click();

    await expect(streamDialog(page)).toContainText(
      "AWS bills each metric update a stream sends, so this can cost many times more.",
    );
    await expect(streamCommand(page)).toContainText("IncludeFilters");
    await streamDialog(page).getByTestId("cloud-stream-every-metric").check();
    await expect(streamCommand(page)).not.toContainText("IncludeFilters");

    await streamDialog(page)
      .getByTestId("cloud-stream-regions")
      .fill("us-east-1, moon-1");
    await expect(
      streamDialog(page).getByTestId("cloud-stream-problem"),
    ).toHaveText(
      "List Regions by their codes, such as us-east-1 or eu-central-1.",
    );

    // For another way: the endpoints to give each Firehose stream.
    await expect(
      streamDialog(page).getByTestId("cloud-stream-metrics-url"),
    ).toContainText(STREAM_METRICS_URL);
    await shoot(page, "stream-more-fields");
  });

  test("a refused delivery: the row says so, and the dialog says why and what to do", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=connected&https=1&stream=refused");

    await expect(streamLine(page)).toHaveText("Stream refused");
    await expect(streamLine(page)).toHaveAttribute(
      "title",
      /A delivery came with a key that is not this connection's\./,
    );

    await openRowMenu(page);
    await page
      .getByRole("menuitem", { name: "Stream metrics and logs" })
      .click();
    const live: Locator = streamDialog(page).getByTestId("cloud-stream-live");
    await expect(live).toHaveAttribute("data-state", "refused");
    await expect(live).toContainText(
      "A delivery came with a key that is not this connection's.",
    );
    await expect(live).toContainText(
      "Make a new key and run the command again",
    );
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await live.scrollIntoViewIfNeeded();
    await shoot(page, "stream-refused");
  });

  test("Stop streaming asks first, says what stays, and hands over the command that deletes the stacks", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=connected&https=1&stream=receiving");

    await expect(streamLine(page)).toHaveText("Streaming");
    await expect(streamLine(page)).toHaveAttribute(
      "title",
      /^Receiving\. The last delivery came /,
    );
    await shoot(page, "stream-list");

    await openRowMenu(page);
    await page.getByRole("menuitem", { name: "Stop streaming" }).click();

    await expect(dialog(page)).toContainText(
      "Every stream key of AWS 123456789012 stops working at once",
    );
    const command: Locator = dialog(page).getByTestId(
      "cloud-connection-stop-streaming",
    );
    await expect(command).toContainText(
      "The streams stay in AWS, and AWS bills them, until their stacks are deleted.",
    );
    await expect(command).toContainText(
      "for REGION in us-east-1 eu-west-1; do",
    );
    await expect(command).toContainText(
      'aws cloudformation delete-stack --region "$REGION" --stack-name OneUptimeStream-20000000',
    );
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "stream-stop");

    await submit(page).click();
    await expect(dialog(page)).toHaveCount(0);
    expect((await streamState(page)).streamStops).toEqual([AWS_CONNECTION]);
    // No key works: the row says nothing of a stream any more.
    await expect(streamLine(page)).toHaveCount(0);
  });

  test("each cloud streams from its own row, and a OneUptime that is not on HTTPS says why Firehose and Pub/Sub cannot deliver", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=connected");

    // Contoso production, the Azure subscription, streams its metrics and logs.
    await openRowMenu(page, AZURE_ROW);
    await expect(page.getByRole("menuitem", { name: "Test" })).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Stream metrics and logs" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Stream logs" }),
    ).toHaveCount(0);
    // Nothing streams yet: nothing to stop.
    await expect(
      page.getByRole("menuitem", { name: "Stop streaming" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    // The Google Cloud project streams its logs: Cloud Monitoring pushes no metrics.
    await openRowMenu(page, GCP_ROW);
    await expect(
      page.getByRole("menuitem", { name: "Stream metrics and logs" }),
    ).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Stream logs" }).click();
    await expect(streamDialog(page)).toHaveAttribute("data-provider", "gcp");
    await expect(streamPart(page, "problem")).toContainText(
      "Pub/Sub pushes to https:// addresses only, and this OneUptime is not served over HTTPS.",
    );
    await expect(streamCommand(page)).toHaveCount(0);
    await dialog(page).getByTestId("modal-footer-close-button").click();
    await expect(dialog(page)).toHaveCount(0);

    await openRowMenu(page, 0);
    await page
      .getByRole("menuitem", { name: "Stream metrics and logs" })
      .click();
    await expect(
      streamDialog(page).getByTestId("cloud-stream-problem"),
    ).toContainText(
      "Firehose delivers to https:// addresses only, and this OneUptime is not served over HTTPS.",
    );
    await expect(streamCommand(page)).toHaveCount(0);
  });

  test("a function's page in Cloud has its streamed Logs after Metrics; a load balancer's has none", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(!isDesktop(), "The side menu beside the page: a desktop's.");

    await openAccounts(
      page,
      `${RESOURCE_PATH}/${NIGHTLY_EXPORT}?state=connected`,
    );
    await expect(
      sideMenu(page).getByRole("link", { name: "Logs", exact: true }),
    ).toHaveAttribute("href", `${RESOURCE_PATH}/${NIGHTLY_EXPORT}/logs`);

    await shoot(page, "stream-function-menu");

    await openAccounts(page, `${RESOURCE_PATH}/${WEB_ALB}?state=connected`);
    await expect(
      sideMenu(page).getByRole("link", { name: "Metrics", exact: true }),
    ).toBeVisible();
    await expect(
      sideMenu(page).getByRole("link", { name: "Logs", exact: true }),
    ).toHaveCount(0);
  });

  test("dark and German: the dialog reads in German, and fits", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openStreaming(
      page,
      "state=connected&https=1&stream=receiving&theme=dark&lang=de",
      GERMAN,
    );

    await expect(
      streamDialog(page).getByRole("radiogroup", {
        name: wordIn(GERMAN, "What should it stream?"),
      }),
    ).toBeVisible();
    expect(wordIn(GERMAN, "What should it stream?")).not.toBe(
      "What should it stream?",
    );
    await expect(
      streamDialog(page).getByTestId("setup-guide-step-1"),
    ).toContainText(wordIn(GERMAN, "Make a stream key"));
    await expect(
      streamDialog(page).getByTestId("cloud-stream-live"),
    ).toHaveAttribute("data-state", "receiving");
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "stream-dialog-dark-de");
  });

  test("Persian: the dialog is laid out right to left, the command left to right", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openStreaming(page, "state=connected&https=1&lang=fa", PERSIAN);

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      streamDialog(page).getByTestId("setup-guide-step-1"),
    ).toContainText(wordIn(PERSIAN, "Make a stream key"));
    // Code reads left to right on every page.
    await expect(streamCommand(page).locator("pre").first()).toHaveCSS(
      "direction",
      "ltr",
    );
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "stream-dialog-fa");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Streaming an Azure subscription's metrics and resource logs - Azure
 * Monitor's diagnostic settings send them to event hubs OneUptime reads
 * every minute - and a Google Cloud project's logs, pushed through Pub/Sub,
 * from their rows: each dialog's one question and three steps, the
 * subscriptions or the projects under More fields, reading turned on or a
 * key made, the first events waited for, why a read failed or a push was
 * refused, and Stop streaming with the command that deletes what each
 * command made. Their resources' pages gain the Logs their streams give.
 * ---------------------------------------------------------------------------
 */

const AZURE_CONNECTION: string = "20000000-0000-4000-8000-000000000002";
const GCP_CONNECTION: string = "20000000-0000-4000-8000-000000000003";
// Contoso production's subscription, and another to stream beside it.
const AZURE_SUBSCRIPTION: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";
const AZURE_OTHER_SUBSCRIPTION: string = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";
const PUBSUB_ENDPOINT: string =
  "https://oneuptime.example.com/telemetry/gcp-pubsub/v1/logs";
// What Pub/Sub signs the Google Cloud connection's pushes as.
const PUSH_SERVICE_ACCOUNT: string =
  "oneuptime-push-20000000@acme-prod.iam.gserviceaccount.com";
// The fixture's Azure and Google Cloud resources (Fixture.js OTHER_CLOUD_RESOURCES).
const AZURE_WEB_APP: string = "40000000-0000-4000-8000-000000000101";
const AZURE_VM: string = "40000000-0000-4000-8000-000000000102";
const GCE_INSTANCE: string = "40000000-0000-4000-8000-000000000103";
const GCE_GROUP: string = "40000000-0000-4000-8000-000000000104";

interface StreamStart {
  id: string;
  hostSubscriptionId: string;
}

// Every time reading an Azure connection's event hubs was turned on, and where.
async function streamStarts(page: Page): Promise<Array<StreamStart>> {
  return (
    (await fixture(page)) as unknown as { streamStarts: Array<StreamStart> }
  ).streamStarts;
}

async function openRowStreaming(
  page: Page,
  data: {
    query: string;
    row: number;
    action: string;
    locale?: Record<string, string> | undefined;
  },
): Promise<void> {
  await open(page, data.query);
  await openRowMenu(page, data.row);
  await page
    .getByRole("menuitem", { name: wordIn(data.locale || {}, data.action) })
    .click();
  await expect(streamDialog(page)).toBeVisible();
}

async function deliverFrom(page: Page, provider: string): Promise<void> {
  await page.evaluate((cloud: string) => {
    (
      window as unknown as {
        __cloudConnectFixture: { deliver: (provider: string) => void };
      }
    ).__cloudConnectFixture.deliver(cloud);
  }, provider);
}

test.describe("streaming an Azure subscription and a Google Cloud project", () => {
  test("the list: each cloud's row says how its stream is doing, in its own cloud's words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(
      page,
      "state=connected&https=1&stream=receiving&azurestream=failing&gcpstream=waiting",
    );

    // AWS's, Azure's and Google Cloud's rows, in that order.
    const lines: Locator = streamLine(page);
    await expect(lines).toHaveCount(3);
    await expect(lines.nth(0)).toHaveText("Streaming");
    await expect(lines.nth(1)).toHaveText("Stream failing");
    await expect(lines.nth(1)).toHaveAttribute(
      "title",
      /^The event hubs could not be read, /,
    );
    await expect(lines.nth(2)).toHaveText("Stream waiting");
    await expect(lines.nth(2)).toHaveAttribute(
      "title",
      /^Waiting for the first push\. Pub\/Sub pushes a log within a minute/,
    );
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "stream-clouds-list");
  });

  test("Azure: one question, three steps; a connection that has read no subscription asks for them under the question, and reading turns on where the command makes the event hubs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRowStreaming(page, {
      query: "state=connected",
      row: AZURE_ROW,
      action: "Stream metrics and logs",
    });

    await expect(
      dialog(page).getByRole("heading", { name: "Stream metrics and logs" }),
    ).toBeVisible();
    await expect(streamDialog(page)).toHaveAttribute("data-provider", "azure");

    // One question, three answers, metrics by default.
    const question: Locator = streamDialog(page).getByRole("radiogroup", {
      name: "What should it stream?",
    });
    await expect(question.getByRole("radio")).toHaveCount(3);
    await expect(
      question.getByRole("radio", { name: /^Metrics Every key metric/ }),
    ).toHaveAttribute("aria-checked", "true");

    // Three numbered steps: reading, the command, the first events.
    for (const [index, title] of [
      [1, "Turn on reading"],
      [2, "Run this in Azure Cloud Shell"],
      [3, "Wait for the first events"],
    ] as Array<[number, string]>) {
      await expect(
        streamDialog(page).getByTestId(`setup-guide-step-${index}`),
      ).toContainText(title);
    }

    // Its last read reached no subscription: no command, nothing to read yet.
    await expect(streamPart(page, "problem")).toHaveText(
      "List at least one subscription to stream from.",
    );
    await expect(streamCommand(page)).toHaveCount(0);
    await expect(streamPart(page, "start-reading")).toBeDisabled();

    // So the dialog asks for them under its question, not under More fields.
    const asked: Locator = streamPart(page, "subscriptions-asked");
    await expect(asked).toBeVisible();
    await expect(asked).toContainText(
      "Subscription IDs, separated by commas: this connection has read none yet.",
    );
    await expect(streamPart(page, "more-fields")).not.toContainText(
      "Subscriptions",
    );
    await asked
      .getByLabel("Subscriptions")
      .fill(`${AZURE_SUBSCRIPTION}, ${AZURE_OTHER_SUBSCRIPTION}`);

    // Turn on reading starts where its step's words start.
    const [words, button]: Array<FrameBox> = await boxesInOneFrame([
      streamPart(page, "start").locator("p").first(),
      streamPart(page, "start-reading"),
    ]);
    expect(Math.abs(button!.x - words!.x)).toBeLessThanOrEqual(1);

    await streamPart(page, "more-fields")
      .getByRole("button", { name: "More fields" })
      .click();

    // The connection's own app; the first subscription holds the event hubs.
    await expect(streamPart(page, "problem")).toHaveCount(0);
    await expect(streamCommand(page)).toContainText(
      "local APP='00001111-aaaa-2222-bbbb-3333cccc4444'",
    );
    await expect(streamCommand(page)).toContainText(
      `local HOST='${AZURE_SUBSCRIPTION}'`,
    );
    await expect(streamCommand(page)).toContainText(
      `for SUB in '${AZURE_SUBSCRIPTION}' '${AZURE_OTHER_SUBSCRIPTION}'; do`,
    );
    await expect(streamPart(page, "open-shell")).toHaveAttribute(
      "href",
      "https://shell.azure.com",
    );
    await expect(streamPart(page, "resource-group")).toContainText(
      "oneuptime-stream-20000000",
    );
    await expect(streamPart(page, "live")).toHaveAttribute(
      "data-state",
      "no-key",
    );
    // Nothing was asked of the server yet.
    expect(await streamStarts(page)).toEqual([]);

    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "stream-azure-dialog");

    await streamPart(page, "start-reading").click();

    await expect(streamPart(page, "reading")).toContainText(
      `OneUptime reads the event hubs in subscription ${AZURE_SUBSCRIPTION} every minute.`,
    );
    await expect(streamPart(page, "live")).toHaveAttribute(
      "data-state",
      "waiting",
    );
    expect(await streamStarts(page)).toEqual([
      { id: AZURE_CONNECTION, hostSubscriptionId: AZURE_SUBSCRIPTION },
    ]);
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await streamPart(page, "reading").scrollIntoViewIfNeeded();
    await shoot(page, "stream-azure-reading");

    // Closed: the row says the stream waits for its first events.
    await dialog(page).getByTestId("modal-footer-close-button").click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(streamLine(page)).toHaveText("Stream waiting");
    await expect(streamLine(page)).toHaveAttribute("data-state", "waiting");
  });

  test("Azure: opened while reading is on, it starts where the event hubs are read; the first events say what came from which region", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(!isDesktop(), "What it says: a desktop's.");

    await openRowStreaming(page, {
      query: "state=connected&azurestream=reading",
      row: AZURE_ROW,
      action: "Stream metrics and logs",
    });

    await expect(streamPart(page, "reading")).toContainText(AZURE_SUBSCRIPTION);
    await expect(streamPart(page, "start-reading")).toHaveCount(0);
    await expect(streamCommand(page)).toContainText(
      `local HOST='${AZURE_SUBSCRIPTION}'`,
    );

    const live: Locator = streamPart(page, "live");
    await expect(live).toHaveAttribute("data-state", "waiting");
    await expect(live).toContainText("Waiting for the first events.");

    // Azure Monitor sent them: the next read of the event hubs finds them.
    await deliverFrom(page, "azure");

    // The dialog asks every five seconds: nothing to press.
    await expect(live).toHaveAttribute("data-state", "receiving", {
      timeout: 12000,
    });
    await expect(live).toContainText("Receiving. The last events came");
    const sources: Locator = streamPart(page, "sources");
    await expect(sources).toContainText(
      "Metrics of 3 resource types from westeurope",
    );
    await expect(sources).toContainText(
      "Logs of 2 categories from northeurope",
    );
    await expect(
      dialog(page).getByTestId("modal-footer-close-button"),
    ).toHaveText("Done");
    await live.scrollIntoViewIfNeeded();
    await shoot(page, "stream-azure-receiving");

    await dialog(page).getByTestId("modal-footer-close-button").click();
    await expect(streamLine(page)).toHaveText("Streaming");
  });

  test("Azure: event hubs its app may not read: the row says the stream fails, and the dialog says why and what to do", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=connected&azurestream=failing");

    await expect(streamLine(page)).toHaveText("Stream failing");
    await expect(streamLine(page)).toHaveAttribute(
      "title",
      /The connection's app may not read the event hubs\./,
    );

    await openRowMenu(page, AZURE_ROW);
    await page
      .getByRole("menuitem", { name: "Stream metrics and logs" })
      .click();
    const live: Locator = streamPart(page, "live");
    await expect(live).toHaveAttribute("data-state", "refused");
    await expect(live).toContainText("The event hubs could not be read");
    await expect(live).toContainText(
      "it gives the app the Azure Event Hubs Data Receiver role on its resource group",
    );
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await live.scrollIntoViewIfNeeded();
    await shoot(page, "stream-azure-failing");
  });

  test("Azure: Stop streaming asks first, and hands over the command that deletes the diagnostic settings, then the event hubs' group", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=connected&azurestream=receiving");

    await expect(streamLine(page)).toHaveText("Streaming");

    await openRowMenu(page, AZURE_ROW);
    await page.getByRole("menuitem", { name: "Stop streaming" }).click();

    await expect(dialog(page)).toContainText(
      "OneUptime stops reading the event hubs of Contoso production at once",
    );
    const command: Locator = dialog(page).getByTestId(
      "cloud-connection-stop-streaming",
    );
    await expect(command).toContainText(
      "The event hubs and the diagnostic settings stay in Azure, and Azure bills them, until they are deleted.",
    );
    // Where its event hubs are read: the only subscription it knows.
    await expect(command).toContainText(
      `for SUB in '${AZURE_SUBSCRIPTION}'; do`,
    );
    await expect(command).toContainText(
      'az monitor diagnostic-settings delete --name OneUptime-20000000 --resource "$ID"',
    );
    await expect(command).toContainText(
      'az group delete --subscription "$SUB" --name oneuptime-stream-20000000 --yes --no-wait',
    );
    // Twenty lines, drawn 240px tall at most: the question and its buttons stay in view.
    const [codeBox]: Array<FrameBox> = await boxesInOneFrame([
      command.locator("pre").locator(".."),
    ]);
    expect(codeBox!.height).toBeLessThanOrEqual(241);
    await expect(submit(page)).toBeInViewport();
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "stream-azure-stop");

    await submit(page).click();
    await expect(dialog(page)).toHaveCount(0);
    expect((await streamState(page)).streamStops).toEqual([AZURE_CONNECTION]);
    // Read no more: the row says nothing of a stream.
    await expect(streamLine(page)).toHaveCount(0);
  });

  test("Google Cloud: Stream logs, which logs, three steps; the key goes in the command, and More fields names the account its pushes are signed as", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRowStreaming(page, {
      query: "state=connected&https=1",
      row: GCP_ROW,
      action: "Stream logs",
    });

    await expect(
      dialog(page).getByRole("heading", { name: "Stream logs" }),
    ).toBeVisible();
    await expect(streamDialog(page)).toHaveAttribute("data-provider", "gcp");
    // The connection is turned off: what Pub/Sub pushes is refused until it is on.
    await expect(streamPart(page, "turned-off")).toContainText(
      "This connection is turned off, so what Pub/Sub pushes is refused.",
    );

    // One question, three answers, warnings and errors by default.
    const question: Locator = streamDialog(page).getByRole("radiogroup", {
      name: "Which logs should it stream?",
    });
    await expect(question.getByRole("radio")).toHaveCount(3);
    await expect(
      question.getByRole("radio", { name: /^Warnings and errors/ }),
    ).toHaveAttribute("aria-checked", "true");

    for (const [index, title] of [
      [1, "Make a stream key"],
      [2, "Run this in Google Cloud Shell"],
      [3, "Wait for the first push"],
    ] as Array<[number, string]>) {
      await expect(
        streamDialog(page).getByTestId(`setup-guide-step-${index}`),
      ).toContainText(title);
    }

    // The topic in the project of the connection's service account; a sink in each project it reads.
    await expect(streamCommand(page)).toContainText(
      "local PROJECT='acme-prod'",
    );
    await expect(streamCommand(page)).toContainText(
      `local ENDPOINT='${PUBSUB_ENDPOINT}'`,
    );
    await expect(streamCommand(page)).toContainText(
      "local FILTER='severity>=WARNING'",
    );
    await expect(streamCommand(page)).toContainText(
      "local STREAM_KEY='<YOUR_STREAM_KEY>'",
    );
    await expect(streamCommand(page)).toContainText(
      "for SOURCE in 'acme-prod'; do",
    );
    await expect(streamPart(page, "needs-key")).toBeVisible();
    await expect(streamPart(page, "open-shell")).toHaveAttribute(
      "href",
      "https://shell.cloud.google.com/?show=terminal",
    );
    await expect(streamPart(page, "live")).toHaveAttribute(
      "data-state",
      "no-key",
    );
    expect((await streamState(page)).streamKeys).toEqual([]);

    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "stream-gcp-dialog");

    await streamPart(page, "make-key").click();

    await expect(streamPart(page, "key-made")).toContainText(
      "Key made. The command below holds it, and it is shown only here",
    );
    await expect(streamCommand(page)).toContainText(
      `local STREAM_KEY='oucs_${GCP_CONNECTION}_`,
    );
    await expect(streamCommand(page)).not.toContainText("<YOUR_STREAM_KEY>");
    await expect(streamPart(page, "needs-key")).toHaveCount(0);
    await expect(streamPart(page, "live")).toHaveAttribute(
      "data-state",
      "waiting",
    );
    expect((await streamState(page)).streamKeys).toEqual([GCP_CONNECTION]);

    // Another way: the endpoint, the account the pushes are signed as, the key as their audience.
    await streamPart(page, "more-fields")
      .getByRole("button", { name: "More fields" })
      .click();
    await expect(streamPart(page, "projects")).toHaveValue("acme-prod");
    await expect(streamPart(page, "push-endpoint")).toContainText(
      PUBSUB_ENDPOINT,
    );
    await expect(streamPart(page, "push-service-account")).toContainText(
      PUSH_SERVICE_ACCOUNT,
    );
    await expect(streamPart(page, "audience")).toContainText(
      `oucs_${GCP_CONNECTION}_`,
    );
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await streamPart(page, "elsewhere").scrollIntoViewIfNeeded();
    await shoot(page, "stream-gcp-key-made");

    // Closed: the row says the stream waits for its first push.
    await dialog(page).getByTestId("modal-footer-close-button").click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(streamLine(page)).toHaveText("Stream waiting");
  });

  test("Google Cloud: a filter of one's own goes in each sink, and none written stops the command; every log leaves out the Data Access audit logs", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(!isDesktop(), "What it does: a desktop's.");

    await openRowStreaming(page, {
      query: "state=connected&https=1",
      row: GCP_ROW,
      action: "Stream logs",
    });

    await streamDialog(page)
      .getByRole("radio", { name: /^A filter of your own/ })
      .click();
    await expect(streamPart(page, "problem")).toHaveText(
      "Write the filter, in the Cloud Logging query language.",
    );
    await expect(streamCommand(page)).toHaveCount(0);

    await streamPart(page, "filter").fill(
      'resource.type="cloud_run_revision" AND severity>=ERROR',
    );
    await expect(streamPart(page, "problem")).toHaveCount(0);
    await expect(streamCommand(page)).toContainText(
      `local FILTER='resource.type="cloud_run_revision" AND severity>=ERROR'`,
    );
    await shoot(page, "stream-gcp-filter");

    await streamDialog(page)
      .getByRole("radio", { name: /^Every log/ })
      .click();
    await expect(streamPart(page, "filter")).toHaveCount(0);
    await expect(streamCommand(page)).toContainText(
      `local FILTER='NOT log_id("cloudaudit.googleapis.com/data_access")'`,
    );
  });

  test("Google Cloud: a push not signed for the connection: the row says it was refused, and the dialog says why and what to do", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=connected&https=1&gcpstream=refused");

    await expect(streamLine(page)).toHaveText("Stream refused");
    await expect(streamLine(page)).toHaveAttribute(
      "title",
      /A push was not signed by Google for this connection's push service account\./,
    );

    await openRowMenu(page, GCP_ROW);
    await page.getByRole("menuitem", { name: "Stream logs" }).click();
    const live: Locator = streamPart(page, "live");
    await expect(live).toHaveAttribute("data-state", "refused");
    await expect(live).toContainText("The last push was refused");
    await expect(live).toContainText(
      "it sets the push subscription to sign as that service account",
    );
    // A key made before cannot be shown again: a new one, to run it again.
    await expect(streamPart(page, "make-key")).toHaveText("Make a new key");
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await live.scrollIntoViewIfNeeded();
    await shoot(page, "stream-gcp-refused");
  });

  test("Google Cloud: the first push says which logs came from where; Stop streaming hands over the command that deletes the sinks, the subscription, the topic and the push service account", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRowStreaming(page, {
      query: "state=connected&https=1&gcpstream=waiting",
      row: GCP_ROW,
      action: "Stream logs",
    });

    const live: Locator = streamPart(page, "live");
    await expect(live).toHaveAttribute("data-state", "waiting");
    await expect(live).toContainText("Waiting for the first push.");

    await deliverFrom(page, "gcp");

    await expect(live).toHaveAttribute("data-state", "receiving", {
      timeout: 12000,
    });
    await expect(live).toContainText("Receiving. The last push came");
    // A project's logs: the project is named beside the region.
    await expect(streamPart(page, "sources")).toContainText(
      "Entries of 3 logs from europe-west1 (acme-prod)",
    );
    await live.scrollIntoViewIfNeeded();
    await shoot(page, "stream-gcp-receiving");
    await dialog(page).getByTestId("modal-footer-close-button").click();
    await expect(streamLine(page)).toHaveText("Streaming");

    await openRowMenu(page, GCP_ROW);
    await page.getByRole("menuitem", { name: "Stop streaming" }).click();

    await expect(dialog(page)).toContainText(
      "Every stream key of Google Cloud acme-prod stops working at once, and what Pub/Sub pushes is refused from now on.",
    );
    const command: Locator = dialog(page).getByTestId(
      "cloud-connection-stop-streaming",
    );
    await expect(command).toContainText(
      "The log sinks, the topic and its push subscription stay in Google Cloud, and Pub/Sub keeps pushing, until they are deleted.",
    );
    await expect(command).toContainText("for SOURCE in 'acme-prod'; do");
    await expect(command).toContainText(
      'gcloud logging sinks delete oneuptime-stream-20000000 --project "$SOURCE" --quiet',
    );
    await expect(command).toContainText(
      "gcloud pubsub subscriptions delete oneuptime-stream-20000000-push --project 'acme-prod' --quiet",
    );
    await expect(command).toContainText(
      "gcloud pubsub topics delete oneuptime-stream-20000000 --project 'acme-prod' --quiet",
    );
    await expect(command).toContainText(
      `gcloud iam service-accounts delete '${PUSH_SERVICE_ACCOUNT}' --project 'acme-prod' --quiet`,
    );
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "stream-gcp-stop");

    await submit(page).click();
    await expect(dialog(page)).toHaveCount(0);
    expect((await streamState(page)).streamStops).toEqual([GCP_CONNECTION]);
    await expect(streamLine(page)).toHaveCount(0);
  });

  test("a web app's page and a Compute Engine instance's have their streamed Logs; a virtual machine's and an instance group's have none", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(!isDesktop(), "The side menu beside the page: a desktop's.");

    for (const [id, name, hasLogs] of [
      [AZURE_WEB_APP, "checkout-web", true],
      [GCE_INSTANCE, "orders-worker-1", true],
      [AZURE_VM, "build-agent-1", false],
      [GCE_GROUP, "orders-workers", false],
    ] as Array<[string, string, boolean]>) {
      await openAccounts(page, `${RESOURCE_PATH}/${id}?state=connected`);
      // Drawn once the resource is read, and its menu with it.
      await expect(cardTitled(page, "Details")).toBeVisible();
      await expect(page.getByText(name).first()).toBeVisible();
      await expect(
        sideMenu(page).getByRole("link", { name: "Metrics", exact: true }),
      ).toBeVisible();

      const logs: Locator = sideMenu(page).getByRole("link", {
        name: "Logs",
        exact: true,
      });

      if (hasLogs) {
        await expect(logs).toHaveAttribute(
          "href",
          `${RESOURCE_PATH}/${id}/logs`,
        );
      } else {
        await expect(logs).toHaveCount(0);
      }

      if (id === AZURE_WEB_APP) {
        await shoot(page, "stream-azure-web-app-menu");
      }
    }
  });

  test("dark and German: the Azure dialog reads in German, and fits", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRowStreaming(page, {
      query: "state=connected&azurestream=receiving&theme=dark&lang=de",
      row: AZURE_ROW,
      action: "Stream metrics and logs",
      locale: GERMAN,
    });

    expect(wordIn(GERMAN, "Turn on reading")).not.toBe("Turn on reading");
    await expect(
      streamDialog(page).getByTestId("setup-guide-step-1"),
    ).toContainText(wordIn(GERMAN, "Turn on reading"));
    await expect(
      streamDialog(page).getByTestId("setup-guide-step-3"),
    ).toContainText(wordIn(GERMAN, "Wait for the first events"));
    await expect(streamPart(page, "live")).toHaveAttribute(
      "data-state",
      "receiving",
    );
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "stream-azure-dialog-dark-de");
  });

  test("Persian: the Google Cloud dialog is laid out right to left, the command and the filter left to right", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRowStreaming(page, {
      query: "state=connected&https=1&lang=fa",
      row: GCP_ROW,
      action: "Stream logs",
      locale: PERSIAN,
    });

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    expect(wordIn(PERSIAN, "Wait for the first push")).not.toBe(
      "Wait for the first push",
    );
    await expect(
      streamDialog(page).getByTestId("setup-guide-step-3"),
    ).toContainText(wordIn(PERSIAN, "Wait for the first push"));
    // Code reads left to right on every page, and so does a Cloud Logging query.
    await expect(streamCommand(page).locator("pre").first()).toHaveCSS(
      "direction",
      "ltr",
    );
    await streamDialog(page)
      .getByRole("radio", {
        name: new RegExp(`^${wordIn(PERSIAN, "A filter of your own")}`),
      })
      .click();
    await expect(streamPart(page, "filter")).toHaveAttribute("dir", "ltr");
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "stream-gcp-dialog-fa");
  });
});

/*
 * ---------------------------------------------------------------------------
 * A cloud resource's Logs page with what an AWS connection's stream
 * delivered from the resource's log group, as the Firehose ingest writes it
 * (CloudConnect/StreamedLogs.js, which stamps the rows with the log group
 * rules themselves): orders-db's PostgreSQL log of the last hour - each
 * line's severity as its level says it, the chart and the facets of only
 * its rows, a row's attributes - and nightly-export, a function that
 * stopped three days ago, whose last runs a person finds by choosing a
 * longer range. Its empty list says what is true of the account: how to
 * start streaming, or, once it streams, that nothing came in the range.
 * Every read is the resource's own, and modelled; the page fits at 1280,
 * 1024 and 768 beside the side menu and on a phone, dark, in German and in
 * Persian.
 * ---------------------------------------------------------------------------
 */

const ORDERS_DB_ARN: string = "arn:aws:rds:eu-west-1:123456789012:db:orders-db";
const NIGHTLY_EXPORT_ARN: string =
  "arn:aws:lambda:us-east-1:123456789012:function:nightly-export";
const STORED_RESOURCE_ID: string = "resource.cloud.resource_id";
// What an empty list says before the account streams, and once it does.
const NO_STREAMED_LOGS: string =
  "Logs appear here once this resource's AWS account streams its log group: in Cloud > Connect, choose Stream metrics and logs in the account's row.";
const NO_LOGS_IN_RANGE: string =
  "Nothing arrived from this resource's log group in this time range. Choose a longer range, or check that its account streams this log group: in Cloud > Connect, open Stream metrics and logs in the account's row.";

interface LogRead {
  kind: string;
  attributes: Record<string, string>;
  facetKeys?: Array<string>;
}

interface LogsState {
  logReads: Array<LogRead>;
  unhandled: Array<Record<string, unknown>>;
  realtime: Array<{ model: string; eventType?: string }>;
}

async function logsState(page: Page): Promise<LogsState> {
  return (await fixture(page)) as unknown as LogsState;
}

async function openLogs(
  page: Page,
  resourceId: string,
  query: string,
): Promise<void> {
  await openAccounts(page, `${RESOURCE_PATH}/${resourceId}/logs?${query}`);
  await expect(page.getByTestId("logs-viewer-list")).toBeVisible();
}

// The list's rows, without a row's opened details.
function logRows(page: Page): Locator {
  return page.getByTestId("logs-table").locator("tbody tr[aria-selected]");
}

function facetValue(page: Page, value: string): Locator {
  return page.locator(`[data-testid="facet-value-row"][data-value="${value}"]`);
}

// One attribute of an opened row: its key, then its value.
function attributeRow(page: Page, key: string): Locator {
  return page
    .locator("li")
    .filter({ has: page.locator(`span[title="${key}"]`) });
}

async function chooseRange(page: Page, label: string): Promise<void> {
  await page.getByTestId("log-time-range-picker-button").click();
  await page
    .getByTestId("log-time-range-picker-dropdown")
    .getByRole("button", { name: label, exact: true })
    .click();
}

// Every read of the page names the resource's own id, and none is unmodelled.
async function expectOnlyItsOwnReads(page: Page, arn: string): Promise<void> {
  const state: LogsState = await logsState(page);

  expect(state.unhandled).toEqual([]);

  const scoped: Array<LogRead> = state.logReads.filter(
    (read: LogRead): boolean => {
      return read.kind !== "/telemetry/logs/get-attributes";
    },
  );

  expect(
    scoped.map((read: LogRead): string => {
      return read.kind;
    }),
  ).toEqual(
    expect.arrayContaining([
      "list",
      "/telemetry/logs/histogram",
      "/telemetry/logs/facets",
    ]),
  );
  for (const read of scoped) {
    expect({ kind: read.kind, attributes: read.attributes }).toEqual({
      kind: read.kind,
      attributes: { [STORED_RESOURCE_ID]: arn },
    });
  }
  // The live tail listens; the fixture never sends on it.
  expect(state.realtime.length).toBeGreaterThan(0);
}

// The list's header as it is drawn: each column's title, in its drawn case.
async function drawnHeaders(page: Page): Promise<Array<string>> {
  return await page
    .getByTestId("logs-table")
    .locator("thead th")
    .evaluateAll((cells: Array<Element>): Array<string> => {
      return cells
        .map((cell: Element): string => {
          return (
            (cell.querySelector("span") as HTMLElement | null)?.innerText || ""
          ).trim();
        })
        .filter(Boolean);
    });
}

/*
 * How the line under "No logs found" reads against the list behind it:
 * its WCAG contrast ratio, from the colours the browser draws.
 */
async function emptyHintContrast(page: Page): Promise<number> {
  return await page
    .getByTestId("logs-table-empty")
    .evaluate((empty: Element): number => {
      const lines: NodeListOf<HTMLElement> = empty.querySelectorAll("p");
      const hint: HTMLElement = lines[lines.length - 1]!;

      const channels: (color: string) => Array<number> = (
        color: string,
      ): Array<number> => {
        const canvas: HTMLCanvasElement = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const context: CanvasRenderingContext2D = canvas.getContext("2d")!;
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
      };
      const luminance: (color: string) => number = (color: string): number => {
        const [red, green, blue] = channels(color).map(
          (channel: number): number => {
            const value: number = channel / 255;
            return value <= 0.03928
              ? value / 12.92
              : Math.pow((value + 0.055) / 1.055, 2.4);
          },
        );
        return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
      };

      let behind: Element | null = hint;
      let background: string = "rgba(0, 0, 0, 0)";
      while (behind) {
        background = getComputedStyle(behind).backgroundColor;
        if (background !== "rgba(0, 0, 0, 0)" && background !== "transparent") {
          break;
        }
        behind = behind.parentElement;
      }

      const text: number = luminance(getComputedStyle(hint).color);
      const back: number = luminance(background);
      return (Math.max(text, back) + 0.05) / (Math.min(text, back) + 0.05);
    });
}

test.describe("a cloud resource's streamed Logs", () => {
  test("a database's Logs: its log group's rows, each line's severity as its level says, and nothing else's", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLogs(page, ORDERS_DB, "state=connected&stream=receiving");

    const rows: Locator = logRows(page);
    await expect(rows).toHaveCount(20);
    // Newest first: the checkpoint a couple of minutes ago.
    await expect(rows.first()).toContainText("checkpoint starting: time");
    await expect(rows.first()).toContainText(/information/i);

    // The level RDS for PostgreSQL writes after its prefix, read as the row's severity.
    for (const [line, severity] of [
      ["deadlock detected", /error/i],
      ['password authentication failed for user "report_ro"', /fatal/i],
      ["there is no transaction in progress", /warning/i],
      ["canceling statement due to statement timeout", /error/i],
    ] as Array<[string, RegExp]>) {
      await expect(rows.filter({ hasText: line })).toContainText(severity);
    }
    // A DETAIL line goes with the line before it: none of its own.
    await expect(rows.filter({ hasText: "Process 24102 waits" })).toContainText(
      /unspecified/i,
    );

    // The chip names the database, never its ARN.
    await expect(page.getByTestId("locked-filter-chip-value")).toHaveText(
      "orders-db",
    );

    /*
     * Every header of the list in one case: Time and Severity are sort
     * buttons, which once kept the case they are written in beside
     * SERVICE and MESSAGE.
     */
    expect(await drawnHeaders(page)).toEqual([
      "TIME",
      "SERVICE",
      "SEVERITY",
      "MESSAGE",
    ]);

    /*
     * Each line stays readable where the list draws it: never narrower than
     * 8rem (a phone once squeezed it to a letter a line, every row a screen
     * tall), and - beside the side menu at 1280 - inside the list, though
     * RDS opens every line with one long run of time, client, user and
     * process that once pushed it past the list's edge.
     */
    const lines: Array<Locator> = await rows.locator("p[title]").all();
    expect(lines).toHaveLength(20);
    await expect
      .poll(async (): Promise<string> => {
        const [list, ...boxes] = await boxesInOneFrame([
          page.getByTestId("logs-viewer-list"),
          ...lines,
        ]);
        const narrowest: number = Math.min(
          ...boxes.map((box: FrameBox): number => {
            return box.width;
          }),
        );
        const furthest: number = Math.max(
          ...boxes.map((box: FrameBox): number => {
            return box.x + box.width;
          }),
        );
        const tallest: number = Math.max(
          ...boxes.map((box: FrameBox): number => {
            return box.height;
          }),
        );

        if (narrowest < 127) {
          return `a line ${narrowest}px wide`;
        }
        if (isDesktop() && furthest > list!.x + list!.width + 1) {
          return `a line past the list's edge by ${furthest - list!.x - list!.width}px`;
        }
        if (tallest > 420) {
          return `a line ${tallest}px tall`;
        }
        return "readable";
      })
      .toBe("readable");

    if (isDesktop()) {
      // Its facets count only its rows.
      for (const [severity, count] of [
        ["Information", "12"],
        ["Error", "3"],
        ["Unspecified", "3"],
        ["Fatal", "1"],
        ["Warning", "1"],
      ]) {
        await expect(
          facetValue(page, severity!).getByTestId("facet-value-count"),
        ).toHaveText(count!);
      }
      // The connection's telemetry service, which the stream writes into.
      await expect(page.getByText("AWS 123456789012").first()).toBeVisible();
    }

    await expectOnlyItsOwnReads(page, ORDERS_DB_ARN);
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "resource-logs");
  });

  test("a row opens on what the stream stamped: the account, Region, log group and the database's id - and no App Platforms platform", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(!isDesktop(), "A row's attributes: a desktop's.");

    await openLogs(page, ORDERS_DB, "state=connected&stream=receiving");
    await logRows(page).filter({ hasText: "deadlock detected" }).click();

    for (const [key, value] of [
      [STORED_RESOURCE_ID, ORDERS_DB_ARN],
      ["resource.cloud.account.id", "123456789012"],
      ["resource.cloud.region", "eu-west-1"],
      ["resource.cloud.provider", "aws"],
      ["resource.aws.log.group.name", "/aws/rds/instance/orders-db/postgresql"],
      ["resource.service.name", "AWS 123456789012"],
      ["aws.log.stream.name", "orders-db.0"],
    ]) {
      await expect(attributeRow(page, key!)).toContainText(value!);
    }
    // A database is no App Platforms platform: its logs are its own.
    await expect(attributeRow(page, "resource.cloud.platform")).toHaveCount(0);

    expect((await logsState(page)).unhandled).toEqual([]);
    await shoot(page, "resource-logs-row");
  });

  test("a function that stopped: nothing in the past hour, said as it is, and its last runs over the past week", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLogs(page, NIGHTLY_EXPORT, "state=connected&stream=receiving");

    // Its account streams: the list says nothing came in this range, and what to check.
    const empty: Locator = page.getByTestId("logs-table-empty");
    await expect(empty).toContainText(NO_LOGS_IN_RANGE);
    await expect(empty).not.toContainText(NO_STREAMED_LOGS);
    // What to do reads as text should: at least 4.5:1 against the list.
    expect(await emptyHintContrast(page)).toBeGreaterThanOrEqual(4.5);
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "resource-logs-empty-range");

    await chooseRange(page, "Past 1 Week");

    const rows: Locator = logRows(page);
    await expect(rows).toHaveCount(11);
    await expect(
      rows.filter({ hasText: "Task timed out after 900.00 seconds" }),
    ).toContainText(/error/i);
    await expect(
      rows.filter({ hasText: "the bucket is throttling writes" }),
    ).toContainText(/warning/i);
    // Lambda's own START and REPORT lines say no level.
    await expect(
      rows.filter({ hasText: "START RequestId" }).first(),
    ).toContainText(/unspecified/i);

    await expectOnlyItsOwnReads(page, NIGHTLY_EXPORT_ARN);
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "resource-logs-function");
  });

  test("a function's rows are the function's in Serverless too: faas.name and its FaaS platform", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(!isDesktop(), "A row's attributes: a desktop's.");

    await openLogs(page, NIGHTLY_EXPORT, "state=connected&stream=receiving");
    await chooseRange(page, "Past 1 Week");
    await logRows(page)
      .filter({ hasText: "Task timed out after 900.00 seconds" })
      .click();

    await expect(attributeRow(page, STORED_RESOURCE_ID)).toContainText(
      NIGHTLY_EXPORT_ARN,
    );
    await expect(attributeRow(page, "resource.faas.name")).toContainText(
      "nightly-export",
    );
    await expect(attributeRow(page, "resource.cloud.platform")).toContainText(
      "aws_lambda",
    );
    await expect(attributeRow(page, "resource.cloud.region")).toContainText(
      "us-east-1",
    );
  });

  test("before its account streams, an empty list says how to start", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLogs(page, NIGHTLY_EXPORT, "state=connected");

    const empty: Locator = page.getByTestId("logs-table-empty");
    await expect(empty).toContainText(NO_STREAMED_LOGS);
    await expect(empty).not.toContainText(NO_LOGS_IN_RANGE);
    expect((await logsState(page)).unhandled).toEqual([]);
  });

  test("beside the side menu at 1024 and 768: nothing scrolls the page sideways, and each row keeps its time and severity", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(!isDesktop(), "Beside the side menu: a desktop's widths.");

    for (const width of [1024, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await openLogs(page, ORDERS_DB, "state=connected&stream=receiving");

      const first: Locator = logRows(page).first();
      await expect(first).toBeVisible();
      await expect(first).toContainText("Nov");
      await expect(sideMenu(page)).toBeVisible();
      await expectNoSidewaysScroll(page, { tolerance: 1 });
      await shoot(page, `resource-logs-${width}`);
    }
  });

  test("dark and German: its chip, its chart and its empty sentence in German, and it fits", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLogs(
      page,
      ORDERS_DB,
      "state=connected&stream=receiving&theme=dark&lang=de",
    );

    await expect(logRows(page)).toHaveCount(20);
    await expect(page.getByTestId("locked-filter-chip-value")).toHaveText(
      "orders-db",
    );
    // The chip's key and the chart's title, in German.
    expect(wordIn(GERMAN, "Resource")).not.toBe("Resource");
    await expect(
      page.getByText(`${wordIn(GERMAN, "Resource")}:`),
    ).toBeVisible();
    await expect(page.getByText(wordIn(GERMAN, "Log Volume"))).toBeVisible();
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "resource-logs-dark-de");

    // An empty range, in German too.
    await openLogs(
      page,
      NIGHTLY_EXPORT,
      "state=connected&stream=receiving&theme=dark&lang=de",
    );
    expect(wordIn(GERMAN, NO_LOGS_IN_RANGE)).not.toBe(NO_LOGS_IN_RANGE);
    await expect(page.getByTestId("logs-table-empty")).toContainText(
      wordIn(GERMAN, NO_LOGS_IN_RANGE),
    );
    // The header in German capitals, and the line readable in the dark.
    expect(await drawnHeaders(page)).toEqual(
      ["Time", "Service", "Severity", "Message"].map(
        (title: string): string => {
          return wordIn(GERMAN, title).toLocaleUpperCase("de");
        },
      ),
    );
    expect(await emptyHintContrast(page)).toBeGreaterThanOrEqual(4.5);
    await shoot(page, "resource-logs-empty-dark-de");
  });

  test("Persian: laid out right to left, each line read left to right as it was written", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLogs(page, ORDERS_DB, "state=connected&stream=receiving&lang=fa");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(logRows(page)).toHaveCount(20);
    // A line of a database's log keeps its own direction on a Persian page.
    const line: Locator = logRows(page)
      .filter({ hasText: "deadlock detected" })
      .locator("bdi")
      .first();
    await expect(line).toHaveAttribute("dir", "ltr");
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "resource-logs-fa");

    await openLogs(
      page,
      NIGHTLY_EXPORT,
      "state=connected&stream=receiving&lang=fa",
    );
    expect(wordIn(PERSIAN, NO_LOGS_IN_RANGE)).not.toBe(NO_LOGS_IN_RANGE);
    await expect(page.getByTestId("logs-table-empty")).toContainText(
      wordIn(PERSIAN, NO_LOGS_IN_RANGE),
    );
    /*
     * It sends the reader where the Persian Dashboard's own menu says:
     * its words for Cloud > Connect and for the row's Stream metrics and
     * logs, never the English menu inside a Persian sentence.
     */
    await expect(page.getByTestId("logs-table-empty")).toContainText(
      `${wordIn(PERSIAN, "Cloud")} > ${wordIn(PERSIAN, "Connect")}`,
    );
    await expect(page.getByTestId("logs-table-empty")).toContainText(
      wordIn(PERSIAN, "Stream metrics and logs"),
    );
    await expect(page.getByTestId("logs-table-empty")).not.toContainText(
      "Cloud >",
    );
    await shoot(page, "resource-logs-empty-fa");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Cloud > All Resources, by cloud account (#6149's follow-up). The list has
 * the Cloud Account chip App Platforms' lists have, in place of its typed
 * Account filter: each account its resources are in, by the name Cloud >
 * Accounts gives it with its id under it, under its cloud; the Google Cloud
 * project no connection names (acme-prod) by its id, and every account by
 * its id for a reader who may not read Cloud Accounts. A connection's
 * resource count on Cloud > Connect opens the list with the chip set to the
 * accounts it reads. Turned to "is not", set to an account that holds none
 * of the list (the filters' empty state), and in German (dark) and Persian,
 * at a desktop's width and a phone's.
 * ---------------------------------------------------------------------------
 */

const ALL_RESOURCES_PATH: string = `/dashboard/${PROJECT_ID}/cloud/resources`;
const ALL_RESOURCES_TABLE: string = "cloud-monitored-resources-table";
const AWS_ACCOUNT_ID: string = "123456789012";
const AZURE_SUBSCRIPTION_ID: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";

// The AWS account's resources, and the Azure subscription's and Google Cloud project's.
const AWS_RESOURCE_NAMES: Array<string> = [
  "web-alb",
  "orders-db",
  "nightly-export",
  "web-1",
  "web-2",
  "prod-vpc",
  "orders-queue",
  "orders-dlq",
];
const OTHER_RESOURCE_NAMES: Array<string> = [
  "checkout-web",
  "build-agent-1",
  "orders-worker-1",
  "orders-workers",
];

interface ResourceListRequest {
  model: string;
  cloudResourceKind?: string;
  isArchived?: boolean;
  accountFilter?: {
    includes?: Array<string>;
    includesNone?: Array<string>;
    is?: string;
  };
  select?: Array<string>;
  limit?: number;
}

/*
 * All Resources' address with its Cloud Account chip set, as a link sets
 * it: the list's facet state under the URL parameter its chip bar reads.
 */
function allResourcesPath(
  accountIds: Array<string>,
  operator: "is" | "is_not" = "is",
  query: string = "state=connected",
): string {
  return `${ALL_RESOURCES_PATH}?${query}&${ALL_RESOURCES_TABLE}-facets=${encodeURIComponent(
    JSON.stringify({
      facetSelections: { cloudAccountId: accountIds },
      facetOperators: { cloudAccountId: operator },
    }),
  )}`;
}

async function openAllResources(page: Page, address: string): Promise<void> {
  await page.goto(address);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

/*
 * The list's chips: a phone folds them behind Filter (FacetFilterBar), and
 * one press on it draws them.
 */
async function resourceChips(page: Page): Promise<Locator> {
  const bar: Locator = page.getByTestId("facet-filter-bar");

  if (!isDesktop()) {
    const filter: Locator = bar.getByTestId("facet-filter-bar-toggle");

    if ((await filter.getAttribute("aria-expanded")) !== "true") {
      await filter.click();
    }

    await expect(filter).toHaveAttribute("aria-expanded", "true");
  }

  return bar;
}

// A resource's name in the list, as the link to its page.
function resourceLink(page: Page, name: string): Locator {
  return page.getByRole("link", { name: name, exact: true });
}

async function expectResourcesListed(
  page: Page,
  listed: Array<string>,
  leftOut: Array<string>,
): Promise<void> {
  for (const name of listed) {
    await expect(resourceLink(page, name).first()).toBeVisible();
  }
  for (const name of leftOut) {
    await expect(resourceLink(page, name)).toHaveCount(0);
  }
}

// The list's own reads of its rows - not its chip's, which ask for two fields.
async function resourceListReads(
  page: Page,
): Promise<Array<ResourceListRequest>> {
  return ((await listRequests(page)) as Array<ResourceListRequest>).filter(
    (request: ResourceListRequest): boolean => {
      return (
        request.model === "CloudResource" &&
        request.cloudResourceKind === "resource" &&
        (request.select || []).length > 2
      );
    },
  );
}

// The chip's own reads: the accounts the list's resources are in.
async function resourceAccountReads(
  page: Page,
): Promise<Array<ResourceListRequest>> {
  return ((await listRequests(page)) as Array<ResourceListRequest>).filter(
    (request: ResourceListRequest): boolean => {
      return (
        request.model === "CloudResource" &&
        request.cloudResourceKind === "resource" &&
        (request.select || []).join(",") === "cloudAccountId,cloudProvider"
      );
    },
  );
}

/*
 * The chip's popover once it is at rest: a dialog grows in, and Tailwind's
 * runtime writes its rules a moment after it mounts. A finite animation
 * only: the spinner of a list still being read turns until it is in.
 */
async function openChipPopover(chip: Locator): Promise<Locator> {
  await chip.click();
  const popover: Locator = chip.page().getByRole("dialog");
  await expect(popover.getByRole("textbox")).toBeVisible();
  await expect
    .poll(async (): Promise<number> => {
      return await popover.evaluate((element: Element): number => {
        return element
          .getAnimations({ subtree: true })
          .filter((animation: Animation): boolean => {
            return animation.effect?.getTiming().iterations !== Infinity;
          }).length;
      });
    })
    .toBe(0);
  return popover;
}

test.describe("Cloud's All Resources, by cloud account", () => {
  test("the Cloud Account chip: each account its resources are in, by its name in Cloud > Accounts with its id under it; one no connection names, by its id", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAllResources(page, `${ALL_RESOURCES_PATH}?state=connected`);
    await expect(resourceLink(page, "web-alb").first()).toBeVisible();

    // Found from the list's own resources: archived ones left out.
    const accountReads: Array<ResourceListRequest> =
      await resourceAccountReads(page);
    expect(accountReads.length).toBeGreaterThan(0);
    expect(accountReads[0]).toMatchObject({
      isArchived: false,
      accountFilter: { includesNone: [""] },
    });

    const bar: Locator = await resourceChips(page);
    const popover: Locator = await openChipPopover(
      bar.getByRole("button", { name: /^Cloud Account$/ }),
    );

    // Each account once, under its cloud: the name first, its id under it.
    const offered: Locator = popover.getByRole("listbox").getByRole("option");
    await expect(offered).toHaveText([
      /^Production\s*123456789012$/,
      /^Contoso production\s*7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b$/,
      /^acme-prod$/,
    ]);
    await expect(popover.getByTestId("filter-chip-group-heading")).toHaveText([
      "AWS",
      "Azure",
      "Google Cloud",
    ]);
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "all-resources-account-chip-open");

    // Its id finds an account too.
    await popover.getByRole("textbox").fill("7c4a1f2e");
    await expect(offered).toHaveText([/^Contoso production/]);
    await popover.getByRole("textbox").fill("");

    // Picked: the chip says the account's name, and the list holds its resources.
    await offered.nth(0).click();
    await page.keyboard.press("Escape");
    await expect(
      bar.getByRole("button", { name: "Cloud Account · Production" }),
    ).toBeVisible();
    await expectResourcesListed(page, AWS_RESOURCE_NAMES, OTHER_RESOURCE_NAMES);
    const reads: Array<ResourceListRequest> = await resourceListReads(page);
    expect(reads[reads.length - 1]!.accountFilter).toEqual({
      includes: [AWS_ACCOUNT_ID],
    });
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "all-resources-account-chip");
  });

  test("set from a link: a connection's resource count on Cloud > Connect opens the list with the chip set to the accounts it reads", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=connected");
    await page.getByRole("link", { name: "46 resources" }).click();

    await expect(page).toHaveURL((url: URL): boolean => {
      return (
        url.pathname === ALL_RESOURCES_PATH &&
        url.searchParams.has(`${ALL_RESOURCES_TABLE}-facets`)
      );
    });
    const bar: Locator = await resourceChips(page);
    await expect(
      bar.getByRole("button", { name: "Cloud Account · Production" }),
    ).toBeVisible();
    await expectResourcesListed(page, AWS_RESOURCE_NAMES, OTHER_RESOURCE_NAMES);

    // Its first read is already of the account's resources: none without the chip.
    const reads: Array<ResourceListRequest> = await resourceListReads(page);
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.accountFilter).toEqual({ includes: [AWS_ACCOUNT_ID] });
    }
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "all-resources-from-connection-count");

    // Cleared: every account's resources again.
    await bar.getByRole("button", { name: /^Clear Cloud Account/ }).click();
    await expectResourcesListed(page, ["web-alb", "checkout-web"], []);
  });

  test("turned to 'is not', every other account's; set to an account that holds none of them, the filters' empty state and the way back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAllResources(page, allResourcesPath([AWS_ACCOUNT_ID], "is_not"));

    const bar: Locator = await resourceChips(page);
    await expect(
      bar.getByRole("button", { name: "Cloud Account · not Production" }),
    ).toBeVisible();
    await expectResourcesListed(page, OTHER_RESOURCE_NAMES, AWS_RESOURCE_NAMES);
    const reads: Array<ResourceListRequest> = await resourceListReads(page);
    expect(reads[reads.length - 1]!.accountFilter).toEqual({
      includesNone: [AWS_ACCOUNT_ID],
    });
    await shoot(page, "all-resources-account-chip-not");

    /*
     * The Azure subscription's id in another case is the same account: the
     * list asks for it written both ways.
     */
    await openAllResources(
      page,
      allResourcesPath([AZURE_SUBSCRIPTION_ID.toUpperCase()]),
    );
    await expectResourcesListed(
      page,
      ["checkout-web", "build-agent-1"],
      ["web-alb", "orders-worker-1"],
    );
    const azureReads: Array<ResourceListRequest> =
      await resourceListReads(page);
    expect(azureReads[azureReads.length - 1]!.accountFilter).toEqual({
      includes: [AZURE_SUBSCRIPTION_ID.toUpperCase(), AZURE_SUBSCRIPTION_ID],
    });

    // A Google Cloud project that holds none of the list's resources.
    await openAllResources(page, allResourcesPath(["acme-legacy"]));
    const clear: Locator = page.getByTestId("empty-table-clear-filters-button");
    await expect(clear).toBeVisible();
    await expect(
      bar.getByRole("button", { name: "Cloud Account · acme-legacy" }),
    ).toBeVisible();
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "all-resources-account-chip-empty");
    await clear.click();
    await expectResourcesListed(page, ["web-alb", "checkout-web"], []);
  });

  test("a reader who may not read Cloud Accounts: each account by its id, as before, and the chip filters all the same", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAllResources(
      page,
      allResourcesPath(
        [AWS_ACCOUNT_ID],
        "is",
        "state=connected&accounts=refused",
      ),
    );

    const bar: Locator = await resourceChips(page);
    await expect(
      bar.getByRole("button", { name: `Cloud Account · ${AWS_ACCOUNT_ID}` }),
    ).toBeVisible();
    await expectResourcesListed(page, AWS_RESOURCE_NAMES, OTHER_RESOURCE_NAMES);

    const popover: Locator = await openChipPopover(
      bar.getByRole("button", { name: /^Cloud Account · / }),
    );
    await expect(popover.getByRole("listbox").getByRole("option")).toHaveText([
      /^123456789012$/,
      /^7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b$/,
      /^acme-prod$/,
    ]);
    // The names were asked for, and refused.
    expect(
      (await listRequests(page)).some((request: ListRequest): boolean => {
        return request.model === "CloudAccount";
      }),
    ).toBe(true);
    await shoot(page, "all-resources-account-chip-ids");
  });

  /*
   * The UI review of #6227: the chip's accounts are read a few rows at a
   * time, one read after another, so on a big project they take a while.
   * Opened before they were in, the chip said "Nothing to show - No options
   * available", and a read that failed left it saying so for good. It says
   * Loading... while they are read, and that they could not be read - with
   * Try again, which reads them once more.
   */
  test("while its accounts are read the chip says so, and a read that failed says so, with Try again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAllResources(
      page,
      `${ALL_RESOURCES_PATH}?state=connected&accountreads=held`,
    );
    await expect(resourceLink(page, "web-alb").first()).toBeVisible();

    let bar: Locator = await resourceChips(page);
    let popover: Locator = await openChipPopover(
      bar.getByRole("button", { name: /^Cloud Account$/ }),
    );
    await expect(popover.getByText("Loading...")).toBeVisible();
    await expect(popover.getByText("Nothing to show")).toHaveCount(0);
    await shoot(page, "all-resources-account-chip-loading");

    // Read: the accounts, named.
    await page.evaluate(() => {
      (
        window as unknown as {
          __cloudConnectFixture: { releaseAccountReads: () => void };
        }
      ).__cloudConnectFixture.releaseAccountReads();
    });
    await expect(popover.getByRole("listbox").getByRole("option")).toHaveText([
      /^Production\s*123456789012$/,
      /^Contoso production\s*7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b$/,
      /^acme-prod$/,
    ]);
    await expect(popover.getByText("Loading...")).toHaveCount(0);

    // A read that failed: the list could not be loaded, and Try again reads it.
    await openAllResources(
      page,
      `${ALL_RESOURCES_PATH}?state=connected&accountreads=fail`,
    );
    await expect(resourceLink(page, "web-alb").first()).toBeVisible();
    bar = await resourceChips(page);
    popover = await openChipPopover(
      bar.getByRole("button", { name: /^Cloud Account$/ }),
    );
    await expect(popover.getByTestId("filter-chip-load-error")).toBeVisible();
    await expect(popover.getByText("Couldn't load this list.")).toBeVisible();
    await expect(popover.getByText("Nothing to show")).toHaveCount(0);
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "all-resources-account-chip-load-error");

    await popover.getByRole("button", { name: "Try again" }).click();
    await expect(popover.getByRole("listbox").getByRole("option")).toHaveCount(
      3,
    );
    await expect(popover.getByTestId("filter-chip-load-error")).toHaveCount(0);
    // The read that failed, then the one Try again asked for.
    const accountReads: Array<ResourceListRequest> =
      await resourceAccountReads(page);
    expect(accountReads[0]).toMatchObject({ failed: true });
    expect(accountReads.length).toBeGreaterThan(1);
    expect(accountReads[accountReads.length - 1]).not.toMatchObject({
      failed: true,
    });
  });

  for (const reader of [
    { code: "de", locale: GERMAN, theme: "dark" },
    { code: "fa", locale: PERSIAN, theme: "light" },
  ]) {
    test(`${reader.code}: the chip in the reader's words, its account's name set apart, its popover on the screen`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openAllResources(
        page,
        allResourcesPath(
          [AWS_ACCOUNT_ID],
          "is_not",
          `state=connected&lang=${reader.code}&theme=${reader.theme}`,
        ),
      );

      const label: string = wordIn(reader.locale, "Cloud Account");
      expect(label).not.toBe("Cloud Account");
      // Between the chip's name and its value, the language's own mark (a bullet in Persian).
      const separator: string = getInlineSeparator(reader.code);
      const bar: Locator = await resourceChips(page);
      const chip: Locator = bar.getByRole("button", {
        name: `${label}${separator}`,
      });
      await expect(chip).toBeVisible();
      // "not Production" in the reader's words, the name set apart within them.
      expect(await readText(chip)).toBe(
        `${label}${separator}${wordIn(reader.locale, "not {{value}}", { value: "Production" })}`,
      );
      await expectResourcesListed(
        page,
        OTHER_RESOURCE_NAMES,
        AWS_RESOURCE_NAMES,
      );

      if (reader.code === "fa") {
        await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      } else {
        await expect(page.locator("html")).toHaveClass(/dark/);
      }

      const popover: Locator = await openChipPopover(chip);
      // Its search box names the chip in the reader's words.
      expect(
        await popover.getByRole("textbox").getAttribute("placeholder"),
      ).toContain(label);
      if (reader.code === "de") {
        await expect(popover.getByRole("textbox")).toHaveAttribute(
          "placeholder",
          `${label} suchen...`,
        );
      }
      await expect(
        popover.getByRole("listbox").getByRole("option").first(),
      ).toContainText("Production");

      /*
       * The Azure subscription's id under its name reads its own way, left
       * to right, and is cut short at its own end: on a Persian page it was
       * cut at its start ("...f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b"), the part
       * that tells two subscriptions apart left out. Read from its first
       * letter, in sight inside its line.
       */
      const azureId: Locator = popover
        .getByRole("option", { name: /Contoso production/ })
        .getByTestId("filter-chip-option-sublabel");
      await expect(azureId).toHaveText(AZURE_SUBSCRIPTION_ID);
      expect(
        await azureId.evaluate(
          (line: Element): { direction: string; isStartInSight: boolean } => {
            const range: Range = document.createRange();
            range.setStart(line.firstChild as Node, 0);
            range.setEnd(line.firstChild as Node, 1);
            const first: DOMRect = range.getBoundingClientRect();
            const box: DOMRect = line.getBoundingClientRect();

            return {
              direction: getComputedStyle(line).direction,
              isStartInSight:
                first.left >= box.left - 0.5 && first.right <= box.right + 0.5,
            };
          },
        ),
      ).toEqual({ direction: "ltr", isStartInSight: true });

      // The popover keeps the page's 16px margin, and nothing scrolls sideways.
      const [box] = await boxesInOneFrame([popover]);
      const width: number = page.viewportSize()!.width;
      expect(box!.x).toBeGreaterThanOrEqual(16 - 0.5);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width - 16 + 0.5);
      await expectNoSidewaysScroll(page, { tolerance: 1 });
      await shoot(page, `all-resources-account-chip-${reader.code}`);
    });
  }
});
