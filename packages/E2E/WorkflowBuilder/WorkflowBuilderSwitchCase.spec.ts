import { expect, Locator, Page, test } from "@playwright/test";

/*
 * Switch / Case in the real workflow builder.
 *
 * The maintainer's ask: "Can we have case component in addition to just
 * if/else?" So a Switch / Case step compares one value with a list of cases
 * and carries on down the first case that matches, or down Default.
 *
 * Every case is an output of the step, named after the case, so its outputs
 * come from its settings and change as the cases do. What only a browser
 * shows is checked here: the dots react-flow draws for those outputs, each
 * right under its name; a dot added by the settings taking a connection
 * dragged from it (react-flow has to measure it again first); a case taken
 * out taking its connection with it; a case dragged by its grip changing the
 * order the outputs are checked in; and the settings on a phone and in the
 * dark theme. The rules themselves are unit tested in packages/Common.
 */

type Box = { x: number; y: number; width: number; height: number };

type SavedEdge = { source: string; sourceHandle: string; target: string };

const SETTINGS_DIALOG: string = '[role="dialog"][aria-modal="true"]';

const SWITCH_CARD_ID: string = "canvas-switch-1";

async function openBuilder(page: Page, scenario: string): Promise<void> {
  await page.goto(`/?scenario=${scenario}`);
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
}

function stepCard(page: Page, componentId: string): Locator {
  return page.locator(".react-flow__node", { hasText: componentId });
}

// The names along the bottom of a card, one per output.
function outputNames(card: Locator): Locator {
  return card.getByTestId("workflow-node-output");
}

// A card's output dots, in the order it draws them.
async function outputDotIds(card: Locator): Promise<Array<string>> {
  return card
    .locator(".react-flow__handle.source")
    .evaluateAll((handles: Array<Element>): Array<string> => {
      return handles.map((handle: Element): string => {
        return handle.getAttribute("data-handleid") || "";
      });
    });
}

function outputDot(card: Locator, portId: string): Locator {
  return card.locator(`.react-flow__handle.source[data-handleid="${portId}"]`);
}

function inputDot(card: Locator): Locator {
  return card.locator(".react-flow__handle.target");
}

/*
 * How far each output's dot is, across, from the middle of its name, in the
 * order the card draws them; Infinity for a name without its dot. Read in
 * one frame: the canvas may still be gliding to a new step, and a card that
 * gains an output grows wider over a moment, names and dots together.
 */
async function dotOffsetsFromNames(
  card: Locator,
  portIds: Array<string>,
): Promise<Array<number>> {
  return card.evaluate(
    (element: Element, ids: Array<string>): Array<number> => {
      const names: Array<Element> = Array.from(
        element.querySelectorAll("[data-testid='workflow-node-output']"),
      );

      return ids.map((id: string, index: number): number => {
        const name: Element | undefined = names[index];
        const dot: Element | null = element.querySelector(
          `.react-flow__handle.source[data-handleid='${id}']`,
        );

        if (!name || !dot) {
          return Number.POSITIVE_INFINITY;
        }

        const nameBox: DOMRect = name.getBoundingClientRect();
        const dotBox: DOMRect = dot.getBoundingClientRect();

        return Math.abs(
          nameBox.left + nameBox.width / 2 - (dotBox.left + dotBox.width / 2),
        );
      });
    },
    portIds,
  );
}

async function expectDotsUnderNames(
  card: Locator,
  portIds: Array<string>,
): Promise<void> {
  await expect
    .poll(async () => {
      return Math.max(...(await dotOffsetsFromNames(card, portIds)));
    })
    .toBeLessThan(1.5);
}

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();

  if (!box) {
    throw new Error("Expected the element to be drawn.");
  }

  return box;
}

function centerX(box: Box): number {
  return box.x + box.width / 2;
}

/*
 * How far, across the screen, a drawn connection starts from the middle of
 * the dot it should leave from. React Flow draws it from where it measured
 * the dot: a dot it measured in the wrong place sends it out of nowhere.
 */
async function edgeStartOffset(
  page: Page,
  edgeTestId: string,
  dot: Locator,
): Promise<number> {
  const startX: number = await page
    .locator(
      `[data-testid^="rf__edge-${edgeTestId}"] path.react-flow__edge-path`,
    )
    .first()
    .evaluate((element: Element): number => {
      const path: SVGPathElement = element as SVGPathElement;
      const matrix: DOMMatrix | null = path.getScreenCTM();

      if (!matrix) {
        throw new Error("The connection is not drawn.");
      }

      return path.getPointAtLength(0).matrixTransform(matrix).x;
    });

  return Math.abs(startX - centerX(await boxOf(dot)));
}

async function openSettings(page: Page): Promise<Locator> {
  await stepCard(page, "switch-1").click();
  const dialog: Locator = page.locator(SETTINGS_DIALOG);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("switch-cases-editor")).toBeVisible();
  return dialog;
}

async function save(page: Page, dialog: Locator): Promise<void> {
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(SETTINGS_DIALOG)).toHaveCount(0);
}

function caseValue(dialog: Locator, number: number): Locator {
  return dialog.getByRole("textbox", { name: `Value for case ${number}` });
}

// The connections the builder would save, as source, output and target.
async function savedEdges(page: Page): Promise<Array<SavedEdge>> {
  return page.evaluate((): Array<SavedEdge> => {
    const graph: { edges: Array<SavedEdge> } = (
      window as unknown as { __savedGraph: { edges: Array<SavedEdge> } }
    ).__savedGraph;

    return graph.edges.map((edge: SavedEdge): SavedEdge => {
      return {
        source: edge.source,
        sourceHandle: edge.sourceHandle,
        target: edge.target,
      };
    });
  });
}

function edgesFromSwitch(edges: Array<SavedEdge>): Array<SavedEdge> {
  return edges.filter((edge: SavedEdge): boolean => {
    return edge.source === SWITCH_CARD_ID;
  });
}

// The cases the builder would save for the Switch / Case step.
async function savedCases(
  page: Page,
): Promise<Array<{ id: string; value: string }>> {
  return page.evaluate((): Array<{ id: string; value: string }> => {
    const graph: {
      nodes: Array<{
        data: { id: string; arguments?: Record<string, unknown> };
      }>;
    } = (
      window as unknown as {
        __savedGraph: {
          nodes: Array<{
            data: { id: string; arguments?: Record<string, unknown> };
          }>;
        };
      }
    ).__savedGraph;

    const node: { data: { arguments?: Record<string, unknown> } } | undefined =
      graph.nodes.find((candidate: { data: { id: string } }): boolean => {
        return candidate.data.id === "switch-1";
      });

    const cases: Array<{ id: string; value: string }> =
      ((node?.data.arguments || {})["cases"] as Array<{
        id: string;
        value: string;
      }>) || [];

    return cases.map((switchCase: { id: string; value: string }) => {
      return { id: switchCase.id, value: switchCase.value };
    });
  });
}

/*
 * A connection drawn the way a person draws one: press on an output's dot,
 * move to the next step's input dot, let go.
 */
async function connect(page: Page, from: Locator, to: Locator): Promise<void> {
  /*
   * A card that just gained an output grows wider over a moment, and one
   * under the pointer lifts a pixel: aim at the dot once it has settled.
   */
  await expect
    .poll(async () => {
      const first: Box = await boxOf(from);
      await page.waitForTimeout(120);
      const second: Box = await boxOf(from);
      return Math.abs(first.x - second.x) + Math.abs(first.y - second.y);
    })
    .toBeLessThan(0.5);

  const hover: Box = await boxOf(from);
  await page.mouse.move(centerX(hover), hover.y + hover.height / 2);
  await page.waitForTimeout(300);

  const start: Box = await boxOf(from);
  const end: Box = await boxOf(to);

  await page.mouse.move(centerX(start), start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(centerX(end), end.y + end.height / 2, { steps: 12 });
  await page.mouse.up();
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

async function backgroundOf(locator: Locator): Promise<string> {
  return locator.evaluate((element: Element): string => {
    return getComputedStyle(element).backgroundColor;
  });
}

test.describe("Workflow builder: Switch / Case", () => {
  let pageErrors: Array<string> = [];
  let reactFlowWarnings: Array<string> = [];

  test.beforeEach(async ({ page }: { page: Page }) => {
    pageErrors = [];
    reactFlowWarnings = [];
    page.on("pageerror", (error: Error) => {
      pageErrors.push(error.message);
    });
    // React Flow warns when it draws a connection from a dot it never measured.
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

  test("a new Switch / Case arrives with two cases and Default to connect, each dot under its name", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "graph");
    await page.getByTestId("add-component").click();
    const panel: Locator = page.getByTestId("side-over");
    await panel.locator("#workflow-component-search").fill("case");
    await panel
      .getByRole("option", { name: "Switch / Case", exact: true })
      .click();
    await expect(panel).toHaveCount(0);

    const card: Locator = stepCard(page, "switch-1");
    await expect(card).toBeFocused();
    await expect(card.getByTestId("workflow-node-setup-hint")).toHaveText(
      "Click to set up",
    );
    // Named by their place until they say what they compare.
    await expect(outputNames(card)).toHaveText(["Case 1", "Case 2", "Default"]);
    expect(await outputDotIds(card)).toEqual(["case-1", "case-2", "default"]);
    expect(await savedCases(page)).toEqual([
      { id: "case-1", value: "" },
      { id: "case-2", value: "" },
    ]);

    await expectDotsUnderNames(card, ["case-1", "case-2", "default"]);
    expect((await boxOf(outputDot(card, "case-1"))).y).toBeGreaterThan(
      (await boxOf(outputNames(card).first())).y,
    );

    await page.waitForTimeout(500);
    await expect(page.locator(SETTINGS_DIALOG)).toHaveCount(0);
  });

  test("each case is an output named after its value, in the order the cases are checked, Default last", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "switch");

    const card: Locator = stepCard(page, "switch-1");
    await expect(card).toContainText("Checks environment against 2 cases");
    await expect(outputNames(card)).toHaveText([
      "production",
      "staging",
      "Default",
    ]);
    expect(await outputDotIds(card)).toEqual(["case-1", "case-2", "default"]);
    // Each connection leaves from its own case.
    await expect(page.locator(".react-flow__edge")).toHaveCount(4);
    for (const [portId, target] of [
      ["case-1", "canvas-log-1"],
      ["case-2", "canvas-log-2"],
      ["default", "canvas-log-3"],
    ] as Array<[string, string]>) {
      await expect
        .poll(() => {
          return edgeStartOffset(
            page,
            `${SWITCH_CARD_ID}-${portId}-to-${target}`,
            outputDot(card, portId),
          );
        })
        .toBeLessThan(1.5);
    }
    await expect(card.getByTestId("workflow-node-issue-badge")).toHaveCount(0);

    // A dot grows under the pointer, where it is: it does not jump aside.
    const dot: Locator = outputDot(card, "case-1");
    const before: Box = await boxOf(dot);
    await dot.hover();
    await page.waitForTimeout(300);
    const hovered: Box = await boxOf(dot);
    expect(hovered.width).toBeGreaterThan(before.width);
    expect(Math.abs(centerX(hovered) - centerX(before))).toBeLessThan(1);
  });

  test("a case added in the settings is a new output on the card, and its dot takes a connection", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "switch");
    const dialog: Locator = await openSettings(page);

    await dialog.getByRole("button", { name: "Add case" }).click();
    // The new case's value is where the typing goes.
    await expect(caseValue(dialog, 3)).toBeFocused();
    await page.keyboard.type("development");
    await expect(dialog.getByTestId("switch-case-connection-2")).toHaveText(
      "Not connected",
    );
    await save(page, dialog);

    const card: Locator = stepCard(page, "switch-1");
    await expect(outputNames(card)).toHaveText([
      "production",
      "staging",
      "development",
      "Default",
    ]);
    expect(await outputDotIds(card)).toEqual([
      "case-1",
      "case-2",
      "case-3",
      "default",
    ]);
    expect(await savedCases(page)).toEqual([
      { id: "case-1", value: "production" },
      { id: "case-2", value: "staging" },
      { id: "case-3", value: "development" },
    ]);
    // Nothing leaves from the new case yet, and the card says so.
    await expect(card.getByTestId("workflow-node-issue-badge")).toHaveAttribute(
      "data-tone",
      "Warning",
    );

    // The new dot sits under its name, and the others moved over for it.
    await expectDotsUnderNames(card, ["case-1", "case-2", "case-3", "default"]);

    await connect(
      page,
      outputDot(card, "case-3"),
      inputDot(stepCard(page, "log-4")),
    );

    await expect(page.locator(".react-flow__edge")).toHaveCount(5);
    await expect
      .poll(() => {
        return edgeStartOffset(
          page,
          `reactflow__edge-${SWITCH_CARD_ID}case-3`,
          outputDot(card, "case-3"),
        );
      })
      .toBeLessThan(1.5);
    // The cases already there moved over to make room, and so did their connections.
    await expect
      .poll(() => {
        return edgeStartOffset(
          page,
          `${SWITCH_CARD_ID}-case-1-to-canvas-log-1`,
          outputDot(card, "case-1"),
        );
      })
      .toBeLessThan(1.5);
    expect(edgesFromSwitch(await savedEdges(page))).toEqual(
      expect.arrayContaining([
        {
          source: SWITCH_CARD_ID,
          sourceHandle: "case-3",
          target: "canvas-log-4",
        },
      ]),
    );
    await expect(card.getByTestId("workflow-node-issue-badge")).toHaveCount(0);

    // The settings say where the new case leads.
    const reopened: Locator = await openSettings(page);
    await expect(reopened.getByTestId("switch-case-connection-2")).toHaveText(
      /Log\s*log-4/,
    );
  });

  test("taking out a connected case says what it disconnects, Put back undoes it, and Save drops only its connection", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "switch");
    const dialog: Locator = await openSettings(page);

    await dialog.getByRole("button", { name: "Remove case 1" }).click();

    const note: Locator = dialog.getByTestId("switch-removed-cases");
    await expect(note).toBeVisible();
    await expect(note).toHaveAttribute("role", "status");
    await expect(note).toContainText(
      "Saving removes the connections of the cases you took out",
    );
    await expect(note).toContainText("Case “production” led to Log (log-1).");
    await expect(caseValue(dialog, 1)).toHaveText("staging");

    await note
      .getByRole("button", { name: "Put case “production” back" })
      .click();
    await expect(note).toHaveCount(0);
    await expect(caseValue(dialog, 1)).toHaveText("production");
    await expect(caseValue(dialog, 2)).toHaveText("staging");

    await dialog.getByRole("button", { name: "Remove case 1" }).click();
    await expect(dialog.getByTestId("switch-removed-cases")).toBeVisible();
    await save(page, dialog);

    const card: Locator = stepCard(page, "switch-1");
    await expect(outputNames(card)).toHaveText(["staging", "Default"]);
    expect(await outputDotIds(card)).toEqual(["case-2", "default"]);
    await expect(page.locator(".react-flow__edge")).toHaveCount(3);

    const edges: Array<SavedEdge> = await savedEdges(page);
    expect(edgesFromSwitch(edges)).toEqual([
      {
        source: SWITCH_CARD_ID,
        sourceHandle: "case-2",
        target: "canvas-log-2",
      },
      {
        source: SWITCH_CARD_ID,
        sourceHandle: "default",
        target: "canvas-log-3",
      },
    ]);
    // The trigger's connection to the step is untouched.
    expect(edges).toContainEqual({
      source: "canvas-manual-1",
      sourceHandle: "success",
      target: SWITCH_CARD_ID,
    });
  });

  test("dragging a case by its grip changes the order the cases are checked in, and each connection follows its case", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "switch");
    const dialog: Locator = await openSettings(page);

    // From the keyboard: Space picks the case up, the arrows move it, Space drops it.
    const grip: Locator = dialog.getByRole("button", {
      name: "Drag to reorder Case 2",
    });
    await grip.focus();
    await page.keyboard.press("Space");
    await page.waitForTimeout(250);
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(400);
    await page.keyboard.press("Space");

    await expect(caseValue(dialog, 1)).toHaveText("staging");
    await expect(caseValue(dialog, 2)).toHaveText("production");
    // Each row still says where its own case leads.
    await expect(dialog.getByTestId("switch-case-connection-0")).toHaveText(
      /Log\s*log-2/,
    );
    await expect(dialog.getByTestId("switch-case-connection-1")).toHaveText(
      /Log\s*log-1/,
    );
    await save(page, dialog);

    const card: Locator = stepCard(page, "switch-1");
    await expect(outputNames(card)).toHaveText([
      "staging",
      "production",
      "Default",
    ]);
    expect(await outputDotIds(card)).toEqual(["case-2", "case-1", "default"]);
    expect(await savedCases(page)).toEqual([
      { id: "case-2", value: "staging" },
      { id: "case-1", value: "production" },
    ]);
    expect(edgesFromSwitch(await savedEdges(page))).toEqual([
      {
        source: SWITCH_CARD_ID,
        sourceHandle: "case-1",
        target: "canvas-log-1",
      },
      {
        source: SWITCH_CARD_ID,
        sourceHandle: "case-2",
        target: "canvas-log-2",
      },
      {
        source: SWITCH_CARD_ID,
        sourceHandle: "default",
        target: "canvas-log-3",
      },
    ]);

    // Each dot is still under its own name, in the new order.
    await expectDotsUnderNames(card, ["case-2", "case-1", "default"]);

    // And each connection leaves from its case's new place.
    for (const [portId, target] of [
      ["case-2", "canvas-log-2"],
      ["case-1", "canvas-log-1"],
    ] as Array<[string, string]>) {
      await expect
        .poll(() => {
          return edgeStartOffset(
            page,
            `${SWITCH_CARD_ID}-${portId}-to-${target}`,
            outputDot(card, portId),
          );
        })
        .toBeLessThan(1.5);
    }
  });

  test("a long case name widens the card and is cut short, whole in its tooltip", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "switch");
    const card: Locator = stepCard(page, "switch-1");
    const before: Box = await boxOf(card);

    const dialog: Locator = await openSettings(page);
    await caseValue(dialog, 1).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Critical incident from the payments service");
    await save(page, dialog);

    const name: Locator = outputNames(card).first();
    await expect(name).toHaveText(/^Critical incident/);
    // The card grows, over a moment, to give each name a wider column.
    await expect
      .poll(async () => {
        return (await boxOf(card)).width;
      })
      .toBeGreaterThan(before.width * 1.5);
    await expectDotsUnderNames(card, ["case-1", "case-2", "default"]);
    // Cut at the column's edge rather than running into the next name.
    expect(
      await name.evaluate((element: Element): boolean => {
        return element.scrollWidth > element.clientWidth;
      }),
    ).toBe(true);
    const nameBox: Box = await boxOf(name);
    expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(
      (await boxOf(outputNames(card).nth(1))).x,
    );

    await name.hover();
    await expect(
      page.getByText(
        "Runs next when the value is equal to “Critical incident from the payments service”.",
      ),
    ).toBeVisible();
  });

  test("the settings fit the screen: no case runs off the side", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "switch");
    const dialog: Locator = await openSettings(page);
    await dialog.getByRole("button", { name: "Add case" }).click();
    await page.keyboard.type("a value long enough to need the whole width");

    const panel: Box = await boxOf(dialog);

    for (let index: number = 0; index < 3; index++) {
      const row: Box = await boxOf(dialog.getByTestId(`switch-case-${index}`));
      expect(row.x).toBeGreaterThanOrEqual(panel.x);
      expect(row.x + row.width).toBeLessThanOrEqual(panel.x + panel.width);

      const remove: Box = await boxOf(
        dialog.getByRole("button", { name: `Remove case ${index + 1}` }),
      );
      expect(remove.x + remove.width).toBeLessThanOrEqual(row.x + row.width);
    }

    expect(
      await page.evaluate((): boolean => {
        return (
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth
        );
      }),
    ).toBe(true);
  });

  test("in the dark theme the cases, Default and the note are dark like the dialog", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/?scenario=switch&theme=dark");
    await expect(page.locator(".react-flow__node").first()).toBeVisible();
    const dialog: Locator = await openSettings(page);
    await dialog.getByRole("button", { name: "Remove case 1" }).click();

    for (const part of [
      dialog.getByTestId("switch-case-0"),
      dialog.getByTestId("switch-default"),
      dialog.getByTestId("switch-removed-cases"),
    ]) {
      await expect(part).toBeVisible();
      expect(luminanceOf(await backgroundOf(part))).toBeLessThan(0.1);
    }
  });
});
