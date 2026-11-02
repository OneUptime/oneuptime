import { expect, Locator, Page, test, TestInfo } from "@playwright/test";

/*
 * The integration templates' workflows as the Builder opens them right
 * after Create Workflow: the real Builder page and canvas (the fixture's
 * ?page=builder-page&template=<id>, BuilderPage.js), drawing the graph the
 * template builds.
 *
 * The maintainer found the templates "very complicated to use": the Zabbix
 * one was 48 steps in a tree 3,556 px wide, a Switch / Case with a path for
 * each event and a Log on every Error output, and a new workflow opened
 * with "1 error" on it - its Page step waiting for who to page. Now every
 * template is five steps or fewer, laid top to bottom in one column, each
 * connection straight down from the output it leaves by
 * (Types/Workflow/TemplateLayout), and the create dialog asks who to page,
 * so a paging template opens with nothing left to set up.
 *
 * jsdom draws no cards, so the layout is checked here, on the cards and the
 * connections as the browser draws them. Desktop only: a card is the same
 * size on a phone, and the canvas there is a window onto the same graph.
 */

type Box = { x: number; y: number; width: number; height: number };

// The templates that bring another tool in, or write back to it: one column each.
const COLUMN_TEMPLATE_IDS: Array<string> = [
  "zabbix-declare-incident-from-problem",
  "zabbix-update-problem-on-incident-state",
  "zabbix-message-from-incident-private-note",
  "zabbix-create-alert-from-problem",
  "zabbix-update-problem-on-alert-state",
  "zabbix-message-from-alert-private-note",
  "huntress-incident-report-to-incident",
  "jira-declare-incident-from-issue",
  "jira-comment-to-alert-private-note",
  "dynamics-case-status-to-incident-state",
  "dynamics-create-case-for-alert",
];

// Every template with a Page step, and the Page steps the create dialog asks about.
const PAGING_TEMPLATES: Array<{
  templateId: string;
  pageSteps: Array<string>;
}> = [
  {
    templateId: "zabbix-declare-incident-from-problem",
    pageSteps: ["page-on-call-policy-1"],
  },
  {
    templateId: "zabbix-create-alert-from-problem",
    pageSteps: ["page-on-call-policy-1"],
  },
  {
    templateId: "huntress-incident-report-to-incident",
    pageSteps: ["page-on-call-policy-1"],
  },
  {
    templateId: "incident-critical-page-on-call",
    pageSteps: ["page-on-call-1"],
  },
  {
    templateId: "incident-severity-page",
    pageSteps: ["page-on-call-policy-1", "page-team-1"],
  },
  { templateId: "webhook-page-users", pageSteps: ["page-users-1"] },
];

/*
 * Room left between two cards, one above the other, in the graph's own
 * pixels: a connection turns 20 px under the card it leaves.
 */
const ROOM_UNDER_A_CARD: number = 20;

async function openTemplate(
  page: Page,
  templateId: string,
  query: string = "",
): Promise<void> {
  await page.goto(`/?page=builder-page&template=${templateId}${query}`);
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  // The Builder fits the graph once its cards are measured.
  await expect
    .poll(async (): Promise<number> => {
      return zoomOf(page);
    })
    .toBeGreaterThan(0);
}

function stepCard(page: Page, componentId: string): Locator {
  return page.locator(".react-flow__node", {
    has: page.getByText(componentId, { exact: true }),
  });
}

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();

  if (!box) {
    throw new Error("Expected the element to be drawn.");
  }

  return box;
}

// The canvas's zoom, from the transform react-flow puts on its viewport.
async function zoomOf(page: Page): Promise<number> {
  return page.locator(".react-flow__viewport").evaluate((viewport: Element) => {
    const SCALE: RegExp = /scale\(([0-9.]+)\)/;
    const scale: RegExpMatchArray | null = (
      viewport as HTMLElement
    ).style.transform.match(SCALE);

    return scale ? Number(scale[1]) : 0;
  });
}

test.describe("The templates on the Builder's canvas", () => {
  let pageErrors: Array<string> = [];

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    test.skip(
      testInfo.project.name === "mobile",
      "A card is drawn the same size on a phone.",
    );

    pageErrors = [];
    page.on("pageerror", (error: Error) => {
      pageErrors.push(error.message);
    });
  });

  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
  });

  for (const templateId of COLUMN_TEMPLATE_IDS) {
    test(`${templateId}: no card lies on another, and each has room under it for its connections`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openTemplate(page, templateId);

      const zoom: number = await zoomOf(page);
      const tooClose: Array<string> = await page
        .locator(".react-flow__node")
        .evaluateAll((nodes: Array<Element>, room: number): Array<string> => {
          const cards: Array<{ name: string; box: DOMRect }> = nodes.map(
            (node: Element): { name: string; box: DOMRect } => {
              return {
                name: (node as HTMLElement).innerText.split("\n")[1] || "",
                box: node.getBoundingClientRect(),
              };
            },
          );
          const found: Array<string> = [];

          cards.forEach(
            (a: { name: string; box: DOMRect }, index: number): void => {
              for (const b of cards.slice(index + 1)) {
                const sideBySide: boolean =
                  a.box.left < b.box.right && b.box.left < a.box.right;
                const gap: number = Math.max(
                  b.box.top - a.box.bottom,
                  a.box.top - b.box.bottom,
                );

                if (sideBySide && gap < room) {
                  found.push(`${a.name} and ${b.name}: ${Math.round(gap)}`);
                }
              }
            },
          );

          return found;
        }, ROOM_UNDER_A_CARD * zoom);

      expect(tooClose).toEqual([]);
    });

    /*
     * Top to bottom: each connection leaves its output's dot and runs
     * straight down into the step under it - one line, so the way the run
     * goes reads at a glance.
     */
    test(`${templateId}: every connection runs straight down from its output into the step under it`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openTemplate(page, templateId);

      const connections: Array<{
        edge: string;
        drift: number;
        drop: number;
      }> = await page.evaluate(
        (): Array<{ edge: string; drift: number; drop: number }> => {
          const found: Array<{ edge: string; drift: number; drop: number }> =
            [];

          document
            .querySelectorAll(".react-flow__edge")
            .forEach((edge: Element): void => {
              const path: SVGPathElement | null = edge.querySelector(
                ".react-flow__edge-path",
              );

              if (!path) {
                return;
              }

              const length: number = path.getTotalLength();
              const matrix: DOMMatrix | null = path.getScreenCTM();
              const points: Array<DOMPoint> = [];

              for (let at: number = 0; at <= length; at += 2) {
                const point: DOMPoint = path.getPointAtLength(at);
                points.push(matrix ? point.matrixTransform(matrix) : point);
              }

              const first: DOMPoint = points[0] as DOMPoint;
              const last: DOMPoint = points[points.length - 1] as DOMPoint;

              found.push({
                edge: edge.getAttribute("aria-label") || "",
                drift: Math.max(
                  ...points.map((point: DOMPoint): number => {
                    return Math.abs(point.x - first.x);
                  }),
                ),
                drop: last.y - first.y,
              });
            });

          return found;
        },
      );

      expect(connections.length).toBeGreaterThan(0);

      for (const connection of connections) {
        expect({
          edge: connection.edge,
          straight: connection.drift <= 1.5,
          down: connection.drop > 0,
        }).toEqual({ edge: connection.edge, straight: true, down: true });
      }
    });
  }

  /*
   * A Page step opened without the create dialog - the template's own
   * graph - is left for whoever creates the workflow to set up, and says
   * so on its card, which makes it taller than the others: nothing may lie
   * on its outputs, Success and Error.
   */
  test("the Page step, waiting to be set up, has nothing over its outputs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTemplate(page, "zabbix-declare-incident-from-problem");

    const pageStep: Locator = stepCard(page, "page-on-call-policy-1");

    await pageStep.scrollIntoViewIfNeeded();
    await expect(
      pageStep.getByTestId("workflow-node-setup-hint"),
    ).toBeVisible();

    const outputs: Locator = pageStep.getByTestId("workflow-node-output");

    await expect(outputs).toHaveText(["Success", "Error"]);

    for (const output of await outputs.all()) {
      const box: Box = await boxOf(output);
      const onTop: boolean = await page.evaluate(
        ({ x, y }: { x: number; y: number }): boolean => {
          const hit: Element | null = document.elementFromPoint(x, y);

          return Boolean(
            hit &&
              hit.closest(".react-flow__node") &&
              (hit.closest(".react-flow__node") as HTMLElement).innerText
                .split("\n")
                .includes("page-on-call-policy-1"),
          );
        },
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      );

      expect(onTop).toBe(true);
    }
  });

  /*
   * The "1 error" a new workflow opened with: its Page step waiting for who
   * to page. With the create dialog's pick on every Page step, a paging
   * template opens with nothing left to set up and nothing for the checks
   * to point out.
   */
  for (const paging of PAGING_TEMPLATES) {
    test(`${paging.templateId}: opened as the create dialog makes it, with who to page picked, nothing waits to be set up`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openTemplate(page, paging.templateId, "&picked=1");

      for (const componentId of paging.pageSteps) {
        await expect(stepCard(page, componentId)).toBeVisible();
      }

      await expect(page.getByTestId("workflow-node-setup-hint")).toHaveCount(0);
      await expect(page.getByTestId("workflow-node-issue-badge")).toHaveCount(
        0,
      );
      await expect(page.getByTestId("workflow-lint-status-button")).toHaveCount(
        0,
      );
    });
  }

  // And the same template opened as it is: its Page step is what the checks point out.
  test("opened as the template has it, the Page step waits for who to page, and the checks say so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTemplate(page, "incident-critical-page-on-call");

    await expect(
      stepCard(page, "page-on-call-1").getByTestId("workflow-node-setup-hint"),
    ).toBeVisible();
    await expect(page.getByTestId("workflow-lint-status-button")).toBeVisible();
  });

  /*
   * Zabbix and Huntress may page nobody: with nobody picked, the Page step
   * and the If / Else only it needs are left out, and what is left opens
   * clean.
   */
  test("a template that may page nobody, opened with nobody picked, has no Page step and nothing to point out", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTemplate(
      page,
      "zabbix-declare-incident-from-problem",
      "&picked=none",
    );

    await expect(page.locator(".react-flow__node")).toHaveCount(3);

    for (const componentId of [
      "webhook-1",
      "read-event-1",
      "incident-from-another-tool-1",
    ]) {
      await expect(stepCard(page, componentId)).toBeVisible();
    }

    await expect(stepCard(page, "page-on-call-policy-1")).toHaveCount(0);
    await expect(stepCard(page, "if-page-1")).toHaveCount(0);
    await expect(page.getByTestId("workflow-lint-status-button")).toHaveCount(
      0,
    );
  });

  /*
   * What a laptop shows when the Builder opens: the whole workflow, every
   * step of it in view, where the old Zabbix tree started off screen. A
   * 1,440 px window, whose Builder column beside the side menu is 1,120 px
   * wide.
   */
  test("the Builder opens on the whole workflow: every step is in view", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openTemplate(
      page,
      "zabbix-declare-incident-from-problem",
      "&column=1120&picked=1",
    );

    const canvas: Box = await boxOf(page.locator(".react-flow").first());

    for (const componentId of [
      "webhook-1",
      "read-event-1",
      "incident-from-another-tool-1",
      "if-page-1",
      "page-on-call-policy-1",
    ]) {
      const card: Box = await boxOf(stepCard(page, componentId));

      expect({
        componentId: componentId,
        inView:
          card.x >= canvas.x &&
          card.x + card.width <= canvas.x + canvas.width &&
          card.y >= canvas.y &&
          card.y + card.height <= canvas.y + canvas.height,
      }).toEqual({ componentId: componentId, inView: true });
    }
  });
});
