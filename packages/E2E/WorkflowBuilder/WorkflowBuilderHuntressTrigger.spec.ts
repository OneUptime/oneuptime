import { expect, Locator, Page, test, TestInfo } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * The Huntress Incident Report trigger in the real workflow builder.
 *
 * The maintainer's ask: "We have Huntress integration directly, but we do
 * all the integrations via workflows. Can you make sure this is a part of
 * workflows as well and not directly an integration inside of incidents?"
 *
 * So Huntress starts a workflow now, and connecting it happens in the
 * trigger's settings: the URL to give Huntress, the endpoint's signing
 * secret, and whether Huntress reaches the workflow. What only a browser
 * shows is checked here: the template's workflow drawn whole on the canvas
 * with nothing left to fix; the panel above the trigger's settings, walking
 * the three things to do in Huntress; Copy URL putting all of the URL on
 * the clipboard; the signing secret dialog over the settings, checking what
 * is pasted, sending it once, and never showing it again; a test from
 * Huntress showing up while the dialog is open; a refused request saying
 * why; and the panel on a phone and in the dark theme. The rules themselves
 * are unit tested in packages/Common.
 *
 * The fixture stands in for the API with the workflow and the project
 * (HuntressScenario.js).
 */

type Box = { x: number; y: number; width: number; height: number };

type SavedArguments = Record<string, unknown>;

const SETTINGS_DIALOG: string = '[role="dialog"][aria-modal="true"]';

const TRIGGER: string = "huntress-1";

// The fixture's workflow: its webhook secret key, and so its Huntress URL.
const WEBHOOK_KEY: string = "6f9b2c1e-3a4d-4e8f-9b7a-2c5d8e1f0a3b";
const HUNTRESS_URL: string = `http://localhost/workflow/huntress/${WEBHOOK_KEY}`;

// A secret as Huntress shows one: whsec_ and base64.
const SECRET: string =
  "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw8GKYqrTwjUPD8ILPZIo2LaLaSw";

// The fixture project's most severe incident severity.
const SEV_1: string = "1e5e0000-0000-4000-8000-000000000001";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/workflow-builder-ui/huntress",
);

async function screenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-${testInfo.project.name}.png`),
    animations: "disabled",
  });
}

async function openBuilder(page: Page, query: string = ""): Promise<void> {
  await page.goto(`/?scenario=huntress${query ? `&${query}` : ""}`);
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
}

function stepCard(page: Page, componentId: string): Locator {
  return page.locator(".react-flow__node", { hasText: componentId });
}

/*
 * The trigger's settings, once its panel has read the workflow. Opened with
 * Enter on the focused card, as the canvas lets any step be: on a phone the
 * canvas shows a slice of a workflow this big, and the trigger is outside
 * it. Clicking the card is checked where it is in view.
 */
async function openTrigger(page: Page): Promise<Locator> {
  await stepCard(page, TRIGGER).press("Enter");
  const dialog: Locator = page.locator(SETTINGS_DIALOG).first();
  await expect(dialog).toBeVisible();
  await expect(
    panel(dialog).getByTestId("huntress-trigger-state"),
  ).toBeVisible();
  return dialog;
}

function panel(dialog: Locator): Locator {
  return dialog.getByTestId("workflow-component-section-huntress");
}

function state(dialog: Locator): Locator {
  return panel(dialog).getByTestId("huntress-trigger-state");
}

// The dialog the signing secret is pasted into, over the settings.
function secretDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: /Signing Secret$/ });
}

async function openSecretDialog(page: Page, dialog: Locator): Promise<Locator> {
  await panel(dialog)
    .getByTestId("huntress-trigger-signing-secret-button")
    .click();
  const secret: Locator = secretDialog(page);
  await expect(secret).toBeVisible();
  return secret;
}

async function secretWrites(page: Page): Promise<Array<SavedArguments>> {
  return page.evaluate((): Array<SavedArguments> => {
    return (
      window as unknown as { __huntressSecretWrites: Array<SavedArguments> }
    ).__huntressSecretWrites;
  });
}

async function reads(page: Page): Promise<number> {
  return page.evaluate((): number => {
    return (window as unknown as { __huntressReads: number }).__huntressReads;
  });
}

// What the builder would save for a step's settings.
async function savedArguments(
  page: Page,
  componentId: string,
): Promise<SavedArguments> {
  return page.evaluate((id: string): SavedArguments => {
    type SavedNode = { data: { id: string; arguments?: SavedArguments } };

    const graph: { nodes: Array<SavedNode> } = (
      window as unknown as { __savedGraph: { nodes: Array<SavedNode> } }
    ).__savedGraph;

    const node: SavedNode | undefined = graph.nodes.find(
      (candidate: SavedNode): boolean => {
        return candidate.data.id === id;
      },
    );

    return JSON.parse(JSON.stringify(node?.data.arguments || {}));
  }, componentId);
}

async function savedCounts(
  page: Page,
): Promise<{ nodes: number; edges: number }> {
  return page.evaluate((): { nodes: number; edges: number } => {
    const graph: { nodes: Array<unknown>; edges: Array<unknown> } = (
      window as unknown as {
        __savedGraph: { nodes: Array<unknown>; edges: Array<unknown> };
      }
    ).__savedGraph;

    return { nodes: graph.nodes.length, edges: graph.edges.length };
  });
}

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();

  if (!box) {
    throw new Error("Expected the element to be drawn.");
  }

  return box;
}

// Whether a box is wholly on the screen, side to side.
async function isWithinViewport(
  page: Page,
  locator: Locator,
): Promise<boolean> {
  const box: Box = await boxOf(locator);
  const width: number = page.viewportSize()?.width || 0;

  return box.x >= -0.5 && box.x + box.width <= width + 0.5;
}

async function hasNoSidewaysScroll(page: Page): Promise<boolean> {
  return page.evaluate((): boolean => {
    return (
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth
    );
  });
}

/*
 * A colour's relative luminance, 0 (black) to 1 (white), from the
 * rgb()/rgba() a computed style gives.
 */
function luminanceOf(color: string): number {
  const channels: Array<number> = (color.match(/[\d.]+/g) || [])
    .slice(0, 3)
    .map((part: string): number => {
      const value: number = Number(part) / 255;
      return value <= 0.03928
        ? value / 12.92
        : Math.pow((value + 0.055) / 1.055, 2.4);
    });

  return (
    0.2126 * (channels[0] || 0) +
    0.7152 * (channels[1] || 0) +
    0.0722 * (channels[2] || 0)
  );
}

// The colour behind an element: its own, or the nearest painted one under it.
async function paintBehind(locator: Locator): Promise<string> {
  return locator.evaluate((element: Element): string => {
    let current: Element | null = element;

    while (current) {
      const color: string = getComputedStyle(current).backgroundColor;

      if (color && color !== "transparent" && color !== "rgba(0, 0, 0, 0)") {
        return color;
      }

      current = current.parentElement;
    }

    return "rgb(255, 255, 255)";
  });
}

test.describe("Workflow builder: the Huntress trigger", () => {
  let pageErrors: Array<string> = [];
  let reactFlowWarnings: Array<string> = [];

  test.beforeEach(async ({ page }: { page: Page }) => {
    pageErrors = [];
    reactFlowWarnings = [];
    page.on("pageerror", (error: Error) => {
      pageErrors.push(error.message);
    });
    page.on("console", (message: { text: () => string }) => {
      if (message.text().includes("[React Flow]")) {
        reactFlowWarnings.push(message.text());
      }
    });
  });

  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
    expect(reactFlowWarnings).toEqual([]);
  });

  test("the template's workflow is drawn whole, the trigger on top, with nothing left to fix", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openBuilder(page);

    const counts: { nodes: number; edges: number } = await savedCounts(page);

    await expect(page.locator(".react-flow__node")).toHaveCount(counts.nodes);
    await expect(page.locator(".react-flow__edge")).toHaveCount(counts.edges);

    const trigger: Locator = stepCard(page, TRIGGER);

    await expect(trigger).toContainText("Huntress Incident Report");

    // Every step sits below the trigger: it starts the workflow.
    const triggerBox: Box = await boxOf(trigger);
    const tops: Array<number> = await page
      .locator(".react-flow__node")
      .evaluateAll((nodes: Array<Element>): Array<number> => {
        return nodes.map((node: Element): number => {
          return node.getBoundingClientRect().top;
        });
      });

    for (const top of tops) {
      expect(top).toBeGreaterThanOrEqual(triggerBox.y - 0.5);
    }

    // No card lies on another, as drawn: each can be read and clicked.
    const overlapping: Array<string> = await page
      .locator(".react-flow__node")
      .evaluateAll((nodes: Array<Element>): Array<string> => {
        const boxes: Array<{ name: string; box: DOMRect }> = nodes.map(
          (node: Element): { name: string; box: DOMRect } => {
            return {
              name: node.getAttribute("data-id") || "",
              box: node.getBoundingClientRect(),
            };
          },
        );
        const found: Array<string> = [];

        boxes.forEach(
          (a: { name: string; box: DOMRect }, index: number): void => {
            for (const b of boxes.slice(index + 1)) {
              if (
                a.box.left < b.box.right - 0.5 &&
                b.box.left < a.box.right - 0.5 &&
                a.box.top < b.box.bottom - 0.5 &&
                b.box.top < a.box.bottom - 0.5
              ) {
                found.push(`${a.name} and ${b.name}`);
              }
            }
          },
        );

        return found;
      });

    expect(overlapping).toEqual([]);

    // The Switch / Case has a path for each Huntress event.
    const switchHandles: Array<string> = await stepCard(page, "switch-1")
      .locator(".react-flow__handle.source")
      .evaluateAll((handles: Array<Element>): Array<string> => {
        return handles.map((handle: Element): string => {
          return handle.getAttribute("data-handleid") || "";
        });
      });

    expect(switchHandles).toEqual(
      expect.arrayContaining(["case-1", "case-2", "case-3", "default"]),
    );

    // With the on-call policy picked, no step needs anything more.
    await expect(page.getByTestId("workflow-node-issue-badge")).toHaveCount(0);

    await screenshot(page, testInfo, "canvas");
  });

  test("clicking the trigger opens its settings on the Huntress panel", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    test.skip(
      testInfo.project.name === "mobile",
      "On a phone the canvas shows a slice of this workflow, without the trigger.",
    );

    await openBuilder(page);
    await stepCard(page, TRIGGER).click();

    const dialog: Locator = page.locator(SETTINGS_DIALOG);

    await expect(dialog).toHaveCount(1);
    await expect(dialog).toContainText("Huntress Incident Report");
    await expect(
      panel(dialog).getByTestId("huntress-trigger-state"),
    ).toBeVisible();
  });

  test("opening the trigger walks the three things to do in Huntress, above its settings", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openBuilder(page);
    const dialog: Locator = await openTrigger(page);

    await expect(state(dialog)).toHaveAttribute(
      "data-state",
      "needs-signing-secret",
    );
    await expect(state(dialog)).toHaveText("Signing secret needed");

    // In the order Huntress asks for them, none done yet.
    for (const step of ["endpoint", "secret", "test"]) {
      await expect(
        panel(dialog).getByTestId(`huntress-trigger-step-${step}-todo`),
      ).toBeVisible();
    }

    const stepTops: Array<number> = [];

    for (const step of ["endpoint", "secret", "test"]) {
      stepTops.push(
        (
          await boxOf(
            panel(dialog).getByTestId(`huntress-trigger-step-${step}`),
          )
        ).y,
      );
    }

    expect(
      [...stepTops].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(stepTops);

    // The URL to paste into Huntress is in the first step, whole.
    await expect(
      panel(dialog)
        .getByTestId("huntress-trigger-step-endpoint")
        .getByTestId("huntress-trigger-url"),
    ).toHaveText(HUNTRESS_URL);

    // The settings are folded below the panel.
    const moreFields: Locator = dialog.getByRole("button", {
      name: /^More fields/,
    });

    await expect(moreFields).toBeVisible();
    expect((await boxOf(moreFields)).y).toBeGreaterThan(
      (await boxOf(panel(dialog))).y,
    );
    await expect(
      dialog.getByRole("textbox", { name: /^Only These Organizations/ }),
    ).toHaveCount(0);

    await screenshot(page, testInfo, "setup");
  });

  test("Copy URL puts all of the URL on the clipboard", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await openBuilder(page);
    const dialog: Locator = await openTrigger(page);

    await panel(dialog).getByText("Copy URL", { exact: true }).click();
    await expect(panel(dialog).getByText("Copied!")).toBeVisible();

    expect(
      await page.evaluate(async (): Promise<string> => {
        return await navigator.clipboard.readText();
      }),
    ).toBe(HUNTRESS_URL);
  });

  test("the signing secret is checked as it is pasted, sent once, and never shown again", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openBuilder(page);
    const dialog: Locator = await openTrigger(page);
    const secret: Locator = await openSecretDialog(page, dialog);
    const field: Locator = secret.getByPlaceholder("whsec_…");

    // Typed like a password, and not offered to a password manager as one.
    await expect(field).toHaveAttribute("type", "password");

    // The webhook URL pasted back by mistake is caught before it is sent.
    await field.fill(HUNTRESS_URL);
    await secret.getByRole("button", { name: "Save Signing Secret" }).click();
    await expect(
      secret.getByText(
        "This is not a signing secret. In Huntress, choose View Signing Secret on the endpoint and copy all of it: it starts with whsec_.",
      ),
    ).toBeVisible();
    expect(await secretWrites(page)).toEqual([]);

    await screenshot(page, testInfo, "secret-dialog-problem");

    await field.fill(` ${SECRET} `);
    await secret.getByRole("button", { name: "Save Signing Secret" }).click();
    await expect(secretDialog(page)).toHaveCount(0);

    // Trimmed, and the only thing written.
    expect(await secretWrites(page)).toEqual([
      { webhookSigningSecret: SECRET },
    ]);

    await expect(
      panel(dialog).getByTestId("huntress-trigger-step-secret-done"),
    ).toBeVisible();
    await expect(
      panel(dialog).getByTestId("huntress-trigger-signing-secret-saved"),
    ).toHaveText("Signing secret saved");
    await expect(state(dialog)).toHaveText("Waiting for Huntress");
    await expect(
      panel(dialog).getByTestId("huntress-trigger-signing-secret-button"),
    ).toHaveText("Replace Signing Secret");

    // The secret is not on the page anywhere: it is write-only.
    expect(await page.content()).not.toContain(SECRET);

    // Nor in the graph: the trigger's settings are as they were.
    expect(await savedArguments(page, TRIGGER)).toEqual({});

    await screenshot(page, testInfo, "secret-saved");
  });

  test("a secret the server refuses keeps the dialog open, with the server's reason", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "secret=fail");
    const dialog: Locator = await openTrigger(page);
    const secret: Locator = await openSecretDialog(page, dialog);

    await secret.getByPlaceholder("whsec_…").fill(SECRET);
    await secret.getByRole("button", { name: "Save Signing Secret" }).click();

    await expect(
      secret.getByText(
        "The signing secret is not one Huntress issues. In Huntress, open the endpoint's menu (⋯), choose View Signing Secret and copy all of it. It starts with whsec_.",
      ),
    ).toBeVisible();
    await expect(secretDialog(page)).toBeVisible();
    await expect(state(dialog)).toHaveText("Signing secret needed");
  });

  test("Huntress's test shows up while the dialog is open", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openBuilder(page, "facts=waiting");
    const dialog: Locator = await openTrigger(page);

    await expect(state(dialog)).toHaveText("Waiting for Huntress");
    await expect(
      panel(dialog).getByTestId("huntress-trigger-step-test-todo"),
    ).toBeVisible();

    await screenshot(page, testInfo, "waiting");

    const readsBefore: number = await reads(page);

    await page.evaluate((): void => {
      (window as unknown as { huntressArrives: () => void }).huntressArrives();
    });

    // Read again within the poll interval, without closing anything.
    await expect(
      panel(dialog).getByTestId("huntress-trigger-status"),
    ).toBeVisible();
    await expect(state(dialog)).toHaveText("Receiving reports");
    await expect(panel(dialog)).toContainText("Last event");
    expect(await reads(page)).toBeGreaterThan(readsBefore);

    // Once Huntress reaches it, the steps give way to where it stands.
    await expect(
      panel(dialog).getByTestId("huntress-trigger-setup"),
    ).toHaveCount(0);
    await expect(panel(dialog).getByTestId("huntress-trigger-url")).toHaveText(
      HUNTRESS_URL,
    );

    // And it stops reading: nothing is waited for.
    const readsAfter: number = await reads(page);

    await page.waitForTimeout(6000);
    expect(await reads(page)).toBe(readsAfter);

    await screenshot(page, testInfo, "receiving");
  });

  test("a refused request says why, above the URL", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openBuilder(page, "facts=failing");
    const dialog: Locator = await openTrigger(page);

    await expect(state(dialog)).toHaveAttribute("data-state", "failing");
    await expect(state(dialog)).toHaveText("Refusing requests");

    const refusal: Locator = panel(dialog).getByTestId(
      "huntress-trigger-last-error",
    );

    await expect(refusal).toContainText("The last request was refused");
    await expect(refusal).toContainText(
      "The request's signature does not match the signing secret. Copy the endpoint's signing secret from Huntress again.",
    );
    expect((await boxOf(refusal)).y).toBeLessThan(
      (await boxOf(panel(dialog).getByTestId("huntress-trigger-url"))).y,
    );

    await screenshot(page, testInfo, "failing");
  });

  test("someone who may not see the workflow's key is told so, and shown no URL", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "url=hidden");
    const dialog: Locator = await openTrigger(page);

    await expect(
      panel(dialog).getByTestId("huntress-trigger-url-hidden"),
    ).toBeVisible();
    await expect(panel(dialog).getByTestId("huntress-trigger-url")).toHaveCount(
      0,
    );
    expect(await page.content()).not.toContain(WEBHOOK_KEY);
  });

  test("a workflow that is off says so in the panel", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "off=1");
    const dialog: Locator = await openTrigger(page);

    await expect(
      panel(dialog).getByTestId("huntress-trigger-workflow-off"),
    ).toBeVisible();
  });

  test("the incident severity of each Huntress severity is one of the project's, most severe first", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page);
    const dialog: Locator = await openTrigger(page);

    await dialog.getByRole("button", { name: /^More fields/ }).click();
    await expect(
      dialog.getByRole("textbox", { name: /^Only These Organizations/ }),
    ).toBeVisible();

    const critical: Locator = dialog.getByRole("combobox", {
      name: /^Severity For Critical Reports/,
    });

    await critical.click();
    await expect(page.getByRole("option")).toHaveText([
      "SEV 1",
      "SEV 2",
      "SEV 3",
    ]);
    await page.getByRole("option", { name: "SEV 1" }).click();

    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator(SETTINGS_DIALOG)).toHaveCount(0);

    expect(
      (await savedArguments(page, TRIGGER))["critical-incident-severity"],
    ).toBe(SEV_1);
  });

  test("the panel fits the screen: the URL wraps, nothing scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page);
    const dialog: Locator = await openTrigger(page);

    expect(await hasNoSidewaysScroll(page)).toBe(true);

    for (const part of [
      panel(dialog).getByTestId("huntress-trigger-url"),
      panel(dialog).getByText("Copy URL", { exact: true }),
      panel(dialog).getByTestId("huntress-trigger-signing-secret-button"),
      panel(dialog).getByTestId("huntress-trigger-url-note"),
    ]) {
      expect(await isWithinViewport(page, part)).toBe(true);
    }

    const secret: Locator = await openSecretDialog(page, dialog);

    expect(
      await isWithinViewport(page, secret.getByPlaceholder("whsec_…")),
    ).toBe(true);
    expect(await hasNoSidewaysScroll(page)).toBe(true);
  });

  test("in the dark theme the panel, the URL and a refusal are dark like the dialog", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openBuilder(page, "facts=failing&theme=dark");
    const dialog: Locator = await openTrigger(page);

    for (const part of [
      panel(dialog),
      panel(dialog).getByTestId("huntress-trigger-url"),
      panel(dialog).getByTestId("huntress-trigger-last-error"),
    ]) {
      await expect(part).toBeVisible();
      expect(luminanceOf(await paintBehind(part))).toBeLessThan(0.2);
    }

    await screenshot(page, testInfo, "failing-dark");
  });
});
