import { expect, Locator, Page, test } from "@playwright/test";
import path from "path";

/*
 * Project Settings -> AI -> External MCP Servers, end to end in a browser,
 * on the real pages (ExternalMcpServers/Fixture/Fixture.js): the MCP servers
 * outside OneUptime - AWS, Azure, GitHub, a team's own - whose tools
 * OneUptime AI may use while it investigates and fixes.
 *
 * The maintainer asked for a way to add them in project settings, as simply
 * as possible. So a server is a name, its address and how OneUptime signs
 * in - a card each - and once it is added OneUptime connects at once and
 * says what it found. The list says how each server is doing; a server's
 * page has the switch that stops OneUptime AI using it, which asks first.
 * Who may not change a server sees it, but cannot add one or test it.
 *
 * What is pinned here is what a person sees and what the pages send - every
 * create, edit, switch and test is recorded by the fixture - at desktop and
 * phone width, in the dark theme and in German. The screenshots under
 * output/playwright/external-mcp-servers-ui are for the people who review
 * the pages.
 */

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/external-mcp-servers-ui",
);

const SERVER_IDS: Record<string, string> = {
  aws: "c0000000-0000-4000-8000-000000000e01",
  github: "c0000000-0000-4000-8000-000000000e02",
  azure: "c0000000-0000-4000-8000-000000000e03",
  internal: "c0000000-0000-4000-8000-000000000e04",
  platform: "c0000000-0000-4000-8000-000000000e05",
};

const AUTH_CARDS_IN_ORDER: Array<[string, string]> = [
  ["None", "No sign-in"],
  ["BearerToken", "Bearer token"],
  ["Headers", "Custom headers"],
  ["OAuthClientCredentials", "OAuth client credentials"],
];

const REFUSAL: string = "You do not have permission to test this MCP server.";

interface Recorded {
  creates: Array<Record<string, unknown>>;
  edits: Array<{ id: string; data: Record<string, unknown> }>;
  updates: Array<{ id: string; data: Record<string, unknown> }>;
  deletes: Array<string>;
  tests: Array<{
    path: string;
    body: Record<string, unknown>;
    headers: Record<string, string>;
  }>;
}

/*
 * A secret as the form sends it: a password field's value goes out wrapped
 * as a HashedString (BasicForm), which the API unwraps for a column that
 * stores it encrypted rather than hashed.
 */
function secretSent(value: unknown): unknown {
  if (value && typeof value === "object" && "value" in value) {
    return (value as { value: unknown }).value;
  }

  return value;
}

async function open(page: Page, query: string = ""): Promise<void> {
  await page.goto(`/?${query}`);
  await expect(page.getByTestId("fixture-page")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function recorded(page: Page): Promise<Recorded> {
  return await page.evaluate(() => {
    const fixture: { state: unknown } = (
      window as unknown as { __externalMcpServersFixture: { state: unknown } }
    ).__externalMcpServersFixture;

    return JSON.parse(JSON.stringify(fixture.state)) as Recorded;
  });
}

async function setVerdict(page: Page, verdict: string): Promise<void> {
  await page.evaluate((name: string) => {
    (
      window as unknown as {
        __externalMcpServersFixture: { setVerdict: (name: string) => void };
      }
    ).__externalMcpServersFixture.setVerdict(name);
  }, verdict);
}

async function release(page: Page, verdict: string): Promise<void> {
  await page.evaluate((name: string) => {
    (
      window as unknown as {
        __externalMcpServersFixture: { release: (name: string) => void };
      }
    ).__externalMcpServersFixture.release(name);
  }, verdict);
}

/*
 * A screenshot of the page at rest: two frames for the styles the page's
 * newest classes need (the fixture's Tailwind adds them as the DOM changes),
 * then the transitions a click started - a card fading to selected - played
 * out. The loader's bar runs as long as a test does, so only animations
 * that end are waited for.
 */
async function shoot(page: Page, name: string): Promise<void> {
  await page.evaluate(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
    await Promise.all(
      document
        .getAnimations()
        .filter((animation: Animation) => {
          return animation.effect?.getTiming().iterations !== Infinity;
        })
        .map((animation: Animation) => {
          return animation.finished.catch(() => {
            return undefined;
          });
        }),
    );
  });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: true,
  });
}

function dialog(page: Page): Locator {
  return page.getByTestId("modal");
}

function row(page: Page, url: string): Locator {
  return page.locator("tr").filter({ hasText: url });
}

function status(scope: Locator): Locator {
  return scope.getByTestId("external-mcp-server-status");
}

function card(page: Page, value: string): Locator {
  return dialog(page).getByTestId(`card-select-option-${value}`);
}

function next(page: Page): Locator {
  return dialog(page).getByTestId("modal-footer-next-button");
}

function submit(page: Page): Locator {
  return dialog(page).getByTestId("modal-footer-submit-button");
}

// An entry of the Project Settings side menu (layout=page).
function sideMenuLink(page: Page, title: string): Locator {
  return page
    .locator("aside[role='navigation']")
    .getByRole("link", { name: title, exact: true });
}

function tooltip(page: Page): Locator {
  return page.locator("[data-tippy-root]");
}

function testDialog(page: Page): Locator {
  return page.getByTestId("external-mcp-server-test");
}

function testResult(page: Page): Locator {
  return page.getByTestId("external-mcp-server-test-result");
}

// The tool badges a list draws, in order: "Reads only" or "May change things".
async function toolBadges(scope: Locator): Promise<Array<string>> {
  return (
    await scope.getByText(/^(Reads only|May change things)$/).allInnerTexts()
  ).map((text: string) => {
    return text.trim();
  });
}

// Opens Create External MCP Server on the list, at the Server step.
async function openCreate(page: Page, query: string = ""): Promise<void> {
  await open(page, query);
  await page
    .getByRole("button", { name: "Create External MCP Server" })
    .click();
  await expect(dialog(page)).toBeVisible();
  await expect(
    dialog(page).getByTestId("external-mcp-server-name"),
  ).toBeVisible();
}

// Fills the Server step, then walks on to Authentication.
async function fillServer(
  page: Page,
  name: string,
  url: string,
): Promise<void> {
  await dialog(page).getByTestId("external-mcp-server-name").fill(name);
  await dialog(page).getByTestId("external-mcp-server-url").fill(url);
  await next(page).click();
  await expect(card(page, "None")).toBeVisible();
}

// Opens a row's ⋯ menu and presses Test.
async function testFromRow(page: Page, url: string): Promise<void> {
  await row(page, url).getByTestId("row-actions-more-button").click();
  await page.getByRole("menuitem", { name: "Test" }).click();
  await expect(testDialog(page)).toBeVisible();
}

test.describe("Project Settings > AI > External MCP Servers", () => {
  test("lists each server with how it is doing, and says what the page is not", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    await expect(
      page.getByRole("heading", { name: "External MCP Servers" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "MCP servers outside OneUptime whose tools OneUptime AI may use while it investigates and fixes, such as AWS, Azure or GitHub.",
      ),
    ).toBeVisible();

    // The page is not OneUptime's own MCP server: that one has its own page.
    const ownServer: Locator = page.getByTestId(
      "external-mcp-servers-own-server-link",
    );
    await expect(ownServer).toHaveText("MCP Server");
    const href: string = (await ownServer.getAttribute("href")) || "";
    expect(
      new URL(href, "http://127.0.0.1").pathname.split("/").slice(-2),
    ).toEqual(["settings", "mcp-server"]);

    await expect(status(row(page, "mcp.aws.example.com"))).toHaveAttribute(
      "data-status",
      "Connected",
    );
    await expect(row(page, "mcp.aws.example.com")).toContainText("3 tools");
    await expect(status(row(page, "mcp.github.example.com"))).toHaveAttribute(
      "data-status",
      "CannotConnect",
    );
    await expect(status(row(page, "mcp.azure.example.com"))).toHaveAttribute(
      "data-status",
      "NotChecked",
    );
    await expect(row(page, "mcp.azure.example.com")).toContainText(
      "Not checked yet",
    );
    await expect(status(row(page, "mcp.internal.example.com"))).toHaveAttribute(
      "data-status",
      "Off",
    );
    await expect(row(page, "mcp.internal.example.com")).toContainText("1 tool");

    // Why a server can't connect is a hover away.
    await row(page, "mcp.github.example.com")
      .getByText("Can't connect", { exact: true })
      .hover();
    await expect(tooltip(page)).toContainText(
      "The server refused the sign-in (HTTP 401): Bad credentials.",
    );
    await shoot(page, "list");
  });

  test("no servers yet: the table says what one is for", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "servers=0");

    await expect(
      page.getByText("No MCP servers yet", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Add one to let OneUptime AI use its tools.", {
        exact: true,
      }),
    ).toBeVisible();
    await shoot(page, "list-empty");
  });

  test("with OneUptime AI off, the page says no server is used", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "ai=off");

    await expect(page.getByTestId("project-ai-off-notice")).toContainText(
      "OneUptime AI is off for this project, so it uses none of these servers.",
    );
    await shoot(page, "list-ai-off");
  });

  test("adding a server: a name and an address, a card per way of signing in, then the Test dialog says what it found", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page);

    // What the server is for is optional, folded under More fields.
    await expect(
      dialog(page).getByPlaceholder("Production AWS account, read-only role"),
    ).toBeHidden();
    await expect(
      dialog(page).getByRole("button", { name: /More fields/ }),
    ).toContainText("Description");
    await shoot(page, "create-server-step");

    await fillServer(page, "AWS production", "https://mcp.aws.example.com/mcp");

    expect(
      await dialog(page)
        .getByRole("radio")
        .evaluateAll((cards: Array<Element>) => {
          return cards.map((option: Element) => {
            return option.getAttribute("data-testid");
          });
        }),
    ).toEqual(
      AUTH_CARDS_IN_ORDER.map(([value]: [string, string]) => {
        return `card-select-option-${value}`;
      }),
    );
    for (const [value, title] of AUTH_CARDS_IN_ORDER) {
      await expect(card(page, value)).toContainText(title);
    }
    await expect(card(page, "BearerToken")).toContainText(
      "An API token or key from the server.",
    );

    /*
     * One card a row, read top to bottom like the rule dialogs' Approval
     * cards: the same left edge and width, each under the one before, and
     * each card's description on one line.
     */
    const boxes: Array<{ x: number; y: number; width: number }> = [];
    for (const [value] of AUTH_CARDS_IN_ORDER) {
      boxes.push((await card(page, value).boundingBox())!);
    }
    for (const box of boxes.slice(1)) {
      expect(Math.abs(box.x - boxes[0]!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.width - boxes[0]!.width)).toBeLessThanOrEqual(1);
    }
    for (let index: number = 1; index < boxes.length; index++) {
      expect(boxes[index]!.y).toBeGreaterThan(boxes[index - 1]!.y);
    }
    for (const value of ["None", "BearerToken", "Headers"]) {
      const description: Locator = card(page, value).getByText(
        /^(For a server|An API token|Headers the server)/,
      );
      const lines: number = await description.evaluate(
        (element: Element): number => {
          return Math.round(
            element.getBoundingClientRect().height /
              parseFloat(getComputedStyle(element).lineHeight),
          );
        },
      );
      expect(lines).toBe(1);
    }
    // Nothing more is asked until a way of signing in is picked.
    await expect(
      dialog(page).getByTestId("external-mcp-server-token"),
    ).toHaveCount(0);

    await card(page, "BearerToken").click();
    await expect(card(page, "BearerToken")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const token: Locator = dialog(page).getByTestId(
      "external-mcp-server-token",
    );
    await expect(token).toBeVisible();
    await expect(token).toHaveAttribute("type", "password");
    await token.fill("aws-mcp-token-1234");
    await shoot(page, "create-authentication-step");

    await submit(page).click();

    // Added, OneUptime connects at once: the Test dialog opens by itself.
    await expect(testDialog(page)).toHaveAttribute("data-outcome", "connected");
    // "Connected" once, as the headline; under it who answered, and how.
    await expect(testResult(page)).toContainText(
      "aws-mcp 1.4.0 answered over Streamable HTTP.",
    );
    await expect(testResult(page)).not.toContainText("Connected to");
    await expect(
      page.getByTestId("external-mcp-server-test-tool-count"),
    ).toHaveText("3 tools");
    expect(await toolBadges(testDialog(page))).toEqual([
      "Reads only",
      "Reads only",
      "May change things",
    ]);
    await expect(testDialog(page)).toContainText("Describe EC2 instances");
    await shoot(page, "create-test-connected");

    const sent: Recorded = await recorded(page);
    expect(sent.creates).toHaveLength(1);
    expect(sent.creates[0]).toMatchObject({
      name: "AWS production",
      url: "https://mcp.aws.example.com/mcp",
      authType: "BearerToken",
    });
    expect(secretSent(sent.creates[0]!["bearerToken"])).toBe(
      "aws-mcp-token-1234",
    );
    // The test is of the server just added, with the project's header.
    expect(sent.tests).toHaveLength(1);
    expect(sent.tests[0]!.path.split("/").slice(-2)).toEqual([
      "external-mcp-server",
      "test",
    ]);
    expect(sent.tests[0]!.headers["tenantid"]).toBe(
      "10000000-0000-4000-8000-0000000000a1",
    );
    const createdId: string = String(
      sent.tests[0]!.body["externalMcpServerId"],
    );
    expect(createdId).toMatch(/^c0000000-0000-4000-8000-0000000000\d{2}$/);

    // Closed, the list shows what the test found.
    await page.getByTestId("modal-footer-close-button").click();
    await expect(testDialog(page)).toHaveCount(0);
    const added: Locator = page
      .locator("tr")
      .filter({ hasText: "AWS production" });
    await expect(status(added)).toHaveAttribute("data-status", "Connected");
    await expect(added).toContainText("3 tools");
  });

  test("an address with a password in it is refused before anything is sent", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page);

    await dialog(page).getByTestId("external-mcp-server-name").fill("Leaky");
    await dialog(page)
      .getByTestId("external-mcp-server-url")
      .fill("https://admin:hunter2@mcp.example.com/mcp");
    await next(page).click();

    await expect(dialog(page)).toContainText(
      "The URL cannot hold a user name or password. Put the sign-in under Authentication instead.",
    );
    await expect(card(page, "None")).toHaveCount(0);
    expect((await recorded(page)).creates).toEqual([]);
  });

  test("custom headers: a name and a value each, sent with the server", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page);
    await fillServer(page, "GitHub", "https://mcp.github.example.com/mcp");

    await card(page, "Headers").click();
    const headers: Locator = dialog(page).getByTestId(
      "external-mcp-server-headers",
    );
    await expect(headers).toBeVisible();
    await expect(dialog(page)).toContainText("Request Headers");
    await expect(dialog(page)).toContainText(
      "Sent with every request. Values are stored encrypted and never shown again.",
    );

    // One empty row from the start, ready to type into.
    await expect(headers.getByPlaceholder("X-API-Key")).toHaveCount(1);
    await headers.getByPlaceholder("X-API-Key").fill("X-API-Key");
    // A value is typed masked, as the Token and the Client Secret are.
    await expect(headers.getByPlaceholder("Value")).toHaveAttribute(
      "type",
      "password",
    );
    await headers.getByPlaceholder("Value").fill("ghp_example_value");
    await shoot(page, "create-custom-headers");

    await submit(page).click();
    await expect(testDialog(page)).toHaveAttribute("data-outcome", "connected");

    expect((await recorded(page)).creates[0]).toMatchObject({
      name: "GitHub",
      authType: "Headers",
      headers: { "X-API-Key": "ghp_example_value" },
    });
  });

  test("OAuth client credentials: a step of their own, scope and audience folded", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page);
    await fillServer(page, "Azure", "https://mcp.azure.example.com/mcp");

    await card(page, "OAuthClientCredentials").click();
    await next(page).click();

    const tokenUrl: Locator = dialog(page).getByPlaceholder(
      "https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token",
    );
    await expect(tokenUrl).toBeVisible();
    // Scope and Audience wait under More fields.
    await expect(
      dialog(page).getByPlaceholder("api://<application-id>/.default"),
    ).toBeHidden();

    await tokenUrl.fill(
      "https://login.microsoftonline.com/7f3e0c2a-0000-4000-8000-00000000aa01/oauth2/v2.0/token",
    );
    await dialog(page)
      .getByRole("textbox", { name: /^Client ID/ })
      .fill("4f1c2b3a-0000-4000-8000-00000000bb02");
    await dialog(page)
      .locator("input[type=password]")
      .first()
      .fill("client-secret-value");

    await dialog(page)
      .getByRole("button", { name: /More fields/ })
      .click();
    await dialog(page)
      .getByPlaceholder("api://<application-id>/.default")
      .fill("api://mcp-azure/.default");
    await shoot(page, "create-oauth-step");

    await submit(page).click();
    await expect(testDialog(page)).toBeVisible();

    const created: Record<string, unknown> = (await recorded(page)).creates[0]!;
    expect(created).toMatchObject({
      name: "Azure",
      authType: "OAuthClientCredentials",
      oauthTokenUrl:
        "https://login.microsoftonline.com/7f3e0c2a-0000-4000-8000-00000000aa01/oauth2/v2.0/token",
      oauthClientId: "4f1c2b3a-0000-4000-8000-00000000bb02",
      oauthScope: "api://mcp-azure/.default",
    });
    expect(secretSent(created["oauthClientSecret"])).toBe(
      "client-secret-value",
    );
  });

  test("a test that fails says why and what to check, and Test again tries anew", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "verdict=refused");
    await testFromRow(page, "mcp.github.example.com");

    await expect(testDialog(page)).toHaveAttribute("data-outcome", "failed");
    await expect(testResult(page)).toContainText("Could not connect");
    await expect(testResult(page)).toContainText(
      "The server refused the sign-in (HTTP 401): Bad credentials.",
    );
    await expect(testResult(page)).toContainText(
      "Check the token or headers under Authentication.",
    );
    await shoot(page, "test-failed");

    await setVerdict(page, "connected");
    await page.getByTestId("external-mcp-server-test-again").click();
    await expect(testDialog(page)).toHaveAttribute("data-outcome", "connected");

    const sent: Recorded = await recorded(page);
    expect(
      sent.tests.map((sentTest: Recorded["tests"][number]) => {
        return sentTest.body["externalMcpServerId"];
      }),
    ).toEqual([SERVER_IDS["github"], SERVER_IDS["github"]]);

    // The list now has what the last test found.
    await page.getByTestId("modal-footer-close-button").click();
    await expect(status(row(page, "mcp.github.example.com"))).toHaveAttribute(
      "data-status",
      "Connected",
    );
  });

  test("while a test runs the dialog says so, and its answer lands when it comes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "verdict=slow");
    await testFromRow(page, "mcp.azure.example.com");

    await expect(testDialog(page)).toHaveAttribute("data-outcome", "testing");
    await expect(testDialog(page)).toContainText(
      "Connecting to the MCP server and reading its tools…",
    );
    await shoot(page, "test-running");

    await release(page, "notools");
    await expect(testDialog(page)).toHaveAttribute("data-outcome", "connected");
    await expect(testResult(page)).toContainText(
      "The server answered over SSE.",
    );
    await expect(testDialog(page)).toContainText("The server offers no tools.");
  });

  test("whoever may not change a server sees the servers, but cannot add one, and Test says who may", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "role=member");

    await expect(status(row(page, "mcp.aws.example.com"))).toHaveAttribute(
      "data-status",
      "Connected",
    );
    // Create is locked, and says who may add a server.
    const create: Locator = page.getByRole("button", {
      name: "Create External MCP Server",
    });
    await expect(create).toBeDisabled();
    await create.hover({ force: true });
    await expect(tooltip(page)).toContainText("Project Owner");
    await page.mouse.move(0, 0);
    await expect(tooltip(page)).toHaveCount(0);

    await row(page, "mcp.aws.example.com")
      .getByTestId("row-actions-more-button")
      .click();
    const item: Locator = page.getByRole("menuitem", { name: "Test" });
    await expect(item).toHaveAttribute("aria-disabled", "true");
    await item.hover();
    await expect(tooltip(page)).toContainText(REFUSAL);
    await expect(tooltip(page)).toContainText("Project Owner");
    await expect(tooltip(page)).toContainText("Project Admin");
    await shoot(page, "list-member-test-locked");

    expect((await recorded(page)).tests).toEqual([]);
  });
});

test.describe("A server's own page", () => {
  test("what it is, the switch that lets OneUptime AI use it, and its tools", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=view&server=aws");

    const details: Locator = page.locator("#model-detail-external-mcp-server");
    await expect(details).toContainText("AWS");
    await expect(details).toContainText("https://mcp.aws.example.com/mcp");
    await expect(details).toContainText(
      "Production AWS account, read-only role",
    );
    await expect(details).toContainText("Bearer token");

    const toggle: Locator = page.getByTestId("external-mcp-server-enabled");
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    const tools: Locator = page.getByTestId("external-mcp-server-tools-card");
    await expect(status(tools)).toHaveAttribute("data-status", "Connected");
    await expect(tools).toContainText("3 tools");
    await expect(tools).toContainText("Streamable HTTP");
    await expect(tools).toContainText("aws-mcp 1.4.0");
    expect(await toolBadges(tools)).toEqual([
      "Reads only",
      "Reads only",
      "May change things",
    ]);
    await shoot(page, "view");
  });

  test("an edit starts the secrets empty, and leaving them empty keeps them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=view&server=aws");

    await page
      .getByRole("button", { name: "Edit External MCP Server" })
      .click();
    await expect(dialog(page)).toBeVisible();
    const name: Locator = dialog(page).getByTestId("external-mcp-server-name");
    await expect(name).toHaveValue("AWS");
    await name.fill("AWS production");
    await next(page).click();

    // The way it signs in is picked; the token it holds is never shown.
    await expect(card(page, "BearerToken")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(
      dialog(page).getByTestId("external-mcp-server-token"),
    ).toHaveValue("");
    await shoot(page, "edit-authentication-step");

    await submit(page).click();
    await expect(dialog(page)).toHaveCount(0);

    const edits: Recorded["edits"] = (await recorded(page)).edits;
    expect(edits).toHaveLength(1);
    expect(edits[0]!.id).toBe(SERVER_IDS["aws"]);
    expect(edits[0]!.data).toMatchObject({
      name: "AWS production",
      authType: "BearerToken",
    });
    // Nothing typed, nothing sent: the stored token stays.
    expect(secretSent(edits[0]!.data["bearerToken"]) || undefined).toBe(
      undefined,
    );
    await expect(
      page.locator("#model-detail-external-mcp-server"),
    ).toContainText("AWS production");
  });

  test("turning a server off asks first, then saves at once", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=view&server=aws");

    const toggle: Locator = page.getByTestId("external-mcp-server-enabled");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();

    await expect(page.getByTestId("modal-title")).toHaveText(
      "Turn this server off?",
    );
    await expect(dialog(page)).toContainText(
      "OneUptime AI stops using it at once, in every investigation and fix. Fixes waiting for approval that use it can no longer be approved.",
    );
    // Nothing is saved before it is confirmed.
    expect((await recorded(page)).updates).toEqual([]);
    await shoot(page, "view-turn-off");

    await submit(page).click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    expect((await recorded(page)).updates).toEqual([
      { id: SERVER_IDS["aws"], data: { isEnabled: false } },
    ]);
  });

  test("a server that can't connect shows what it said, and the names of its headers only", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=view&server=github");

    const details: Locator = page.locator("#model-detail-external-mcp-server");
    await expect(details).toContainText("Custom headers");
    await expect(details).toContainText("Request Headers");
    await expect(details).toContainText("X-API-Key");

    await expect(
      page.getByTestId("external-mcp-server-last-error"),
    ).toContainText(
      "The server refused the sign-in (HTTP 401): Bad credentials.",
    );
    await expect(
      page.getByTestId("external-mcp-server-tools-card"),
    ).toContainText(
      "OneUptime has not read this server's tools yet. Test the connection to read them.",
    );

    // Test connection, from the card: what it finds replaces the error.
    await page.getByRole("button", { name: "Test connection" }).click();
    await expect(testDialog(page)).toHaveAttribute("data-outcome", "connected");
    await page.getByTestId("modal-footer-close-button").click();
    await expect(
      page.getByTestId("external-mcp-server-last-error"),
    ).toHaveCount(0);
    await expect(
      status(page.getByTestId("external-mcp-server-tools-card")),
    ).toHaveAttribute("data-status", "Connected");
    await shoot(page, "view-after-test");
  });
});

/*
 * Inside the Dashboard's real Project Settings layout (layout=page): the
 * side menu and the breadcrumbs beside the page, so the table has the
 * product's width - a 938px card at 1280px - not the fixture's.
 */

/*
 * The list fits its card - nothing scrolls sideways - and every row's
 * status ends before the row's buttons begin; the row's one button is
 * the short View. The address is one line, cut short, whole on hover.
 */
async function expectEveryRowToFit(page: Page, view: string): Promise<void> {
  const table: Locator = page.locator("table").first();
  await expect(table).toBeVisible();

  const scroll: { scrollWidth: number; clientWidth: number } =
    await table.evaluate((element: Element) => {
      const box: HTMLElement = element.parentElement as HTMLElement;
      return { scrollWidth: box.scrollWidth, clientWidth: box.clientWidth };
    });
  expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth + 1);

  const rows: Locator = table.locator("tbody tr");
  await expect(rows).toHaveCount(6);

  for (let index: number = 0; index < 6; index++) {
    const tableRow: Locator = rows.nth(index);
    await expect(
      tableRow.getByRole("button", { name: view, exact: true }),
    ).toBeVisible();

    const statusBox: { x: number; width: number } =
      (await status(tableRow).boundingBox())!;
    const actionsBox: { x: number } = (await tableRow
      .locator("td")
      .last()
      .boundingBox())!;
    expect(statusBox.x + statusBox.width).toBeLessThanOrEqual(actionsBox.x + 1);

    const url: Locator = tableRow.getByTestId("external-mcp-server-url-cell");
    const urlLines: number = await url.evaluate((element: Element): number => {
      return Math.round(
        element.getBoundingClientRect().height /
          parseFloat(getComputedStyle(element).lineHeight),
      );
    });
    expect(urlLines).toBe(1);
    expect(await url.getAttribute("title")).toBe(
      (await url.textContent())?.trim(),
    );
  }
}
test.describe("In the Project Settings layout", () => {
  test("at 1280px, a long name and a long address leave every row's status in sight", async ({
    page,
  }: {
    page: Page;
  }) => {
    // German's longer words first: "Verbunden 14 Werkzeuge", "Anzeigen".
    await open(page, "layout=page&servers=many&lang=de");
    await expectEveryRowToFit(page, "Anzeigen");
    await shoot(page, "list-in-settings-de");

    await open(page, "layout=page&servers=many");
    await expectEveryRowToFit(page, "View");

    const rows: Locator = page.locator("table").first().locator("tbody tr");

    // A long server shows in one line each, cut short; whole on its page.
    const platform: Locator = rows.filter({ hasText: "Kubernetes platform" });
    await expect(status(platform)).toContainText("Connected");
    await expect(status(platform)).toContainText("14 tools");
    // The pill and the count share one line.
    const pillAndCount: Array<number> = await status(platform).evaluate(
      (element: Element): Array<number> => {
        return Array.from(element.children).map((child: Element): number => {
          const box: DOMRect = child.getBoundingClientRect();
          return Math.round(box.top + box.height / 2);
        });
      },
    );
    expect(Math.abs(pillAndCount[0]! - pillAndCount[1]!)).toBeLessThanOrEqual(
      2,
    );

    // The side menu marks the page.
    await expect(sideMenuLink(page, "External MCP Servers")).toHaveClass(
      /bg-indigo-50/,
    );
    await shoot(page, "list-in-settings");
  });

  test("a server's page keeps External MCP Servers marked, and shows the server's ID", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "layout=page&page=view&server=aws");

    await expect(
      page.locator("#model-detail-external-mcp-server"),
    ).toContainText("AWS");

    // The side menu's entry, not the breadcrumb of the same name.
    const menuLink: Locator = sideMenuLink(page, "External MCP Servers");
    await expect(menuLink).toHaveClass(/bg-indigo-50/);
    expect(
      new URL(
        (await menuLink.getAttribute("href")) || "",
        "http://127.0.0.1",
      ).pathname
        .split("/")
        .slice(-2),
    ).toEqual(["settings", "external-mcp-servers"]);

    // The ID line under the details, as on other settings pages.
    await expect(page.getByTestId("detail-id-value")).toHaveText(
      SERVER_IDS["aws"]!,
    );
    await shoot(page, "view-in-settings");
  });

  test("a server with many tools lists ten on its page, and Show all opens the rest", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "layout=page&servers=many&page=view&server=platform");

    const tools: Locator = page.getByTestId("external-mcp-server-tools-card");
    await expect(tools).toContainText("14 tools");
    await expect(tools.getByTestId("external-mcp-server-tool")).toHaveCount(10);

    const toggle: Locator = tools.getByTestId(
      "external-mcp-server-tools-show-all",
    );
    await expect(toggle).toHaveText("Show all 14 tools");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await shoot(page, "view-many-tools");

    await toggle.click();
    await expect(tools.getByTestId("external-mcp-server-tool")).toHaveCount(14);
    await expect(toggle).toHaveText("Show fewer");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    await toggle.click();
    await expect(tools.getByTestId("external-mcp-server-tool")).toHaveCount(10);
  });
});

test.describe("At phone width, in the dark theme and in German", () => {
  test("a phone: the list and the create dialog fit the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);

    await expect(page.getByText("mcp.aws.example.com").first()).toBeVisible();
    expect(
      await page.evaluate(() => {
        return document.documentElement.scrollWidth <= window.innerWidth;
      }),
    ).toBe(true);
    await shoot(page, "list-phone");

    await page
      .getByRole("button", { name: "Create External MCP Server" })
      .click();
    await fillServer(page, "AWS", "https://mcp.aws.example.com/mcp");
    for (const [value] of AUTH_CARDS_IN_ORDER) {
      const box: { x: number; width: number } | null = await card(
        page,
        value,
      ).boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    }
    await shoot(page, "create-authentication-step-phone");
  });

  test("dark mode", async ({ page }: { page: Page }) => {
    await open(page, "theme=dark");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(status(row(page, "mcp.aws.example.com"))).toBeVisible();
    await shoot(page, "list-dark");

    await open(page, "theme=dark&page=view&server=aws");
    await expect(
      page.getByTestId("external-mcp-server-tools-card"),
    ).toBeVisible();
    await shoot(page, "view-dark");
  });

  test("German: the page, the cards and the switch in the Dashboard's German words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=de");

    await expect(
      page.getByRole("heading", { name: "Externe MCP-Server" }),
    ).toBeVisible();
    await expect(row(page, "mcp.github.example.com")).toContainText(
      "Keine Verbindung",
    );
    await shoot(page, "list-de");

    await page
      .getByRole("button", { name: "Externer MCP-Server erstellen" })
      .click();
    await expect(dialog(page)).toBeVisible();
    await fillServer(page, "AWS", "https://mcp.aws.example.com/mcp");
    await expect(card(page, "BearerToken")).toContainText("Bearer-Token");
    await expect(card(page, "Headers")).toContainText(
      "Benutzerdefinierte Header",
    );
    await shoot(page, "create-authentication-step-de");

    await open(page, "lang=de&page=view&server=aws");
    await expect(
      page.getByTestId("external-mcp-server-enabled-row"),
    ).toContainText("OneUptime AI diesen Server nutzen lassen");
    await shoot(page, "view-de");
  });
});
