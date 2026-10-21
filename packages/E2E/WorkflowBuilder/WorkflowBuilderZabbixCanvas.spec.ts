import { expect, Locator, Page, test, TestInfo } from "@playwright/test";

/*
 * The Zabbix templates' workflows as the Builder opens them right after
 * Create Workflow: the real Builder page and canvas (the fixture's
 * ?page=builder-page&template=<id>, BuilderPage.js), drawing the graph the
 * template builds, its Page step still waiting for who to page.
 *
 * Their UI review found the first template's workflow 3,556 px wide, most
 * of it off screen when the Builder opened, with its Page step drawn over
 * the two steps under it - a card that asks to be set up is taller than the
 * template had room for - and two of the Switch / Case's four connections
 * running along one line, so which output led where could not be told. The
 * templates now lay their steps on a grid (Templates.ts, ZABBIX_CANVAS_ROW).
 * jsdom draws no cards, so the layout is checked here, on the cards as the
 * browser draws them.
 *
 * Desktop only: a card is the same size on a phone, and the canvas there
 * is a window onto the same graph.
 */

type Box = { x: number; y: number; width: number; height: number };

const ZABBIX_TEMPLATE_IDS: Array<string> = [
  "zabbix-declare-incident-from-problem",
  "zabbix-update-problem-on-incident-state",
  "zabbix-message-from-incident-private-note",
  "zabbix-create-alert-from-problem",
  "zabbix-update-problem-on-alert-state",
  "zabbix-message-from-alert-private-note",
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

test.describe("The Zabbix templates on the Builder's canvas", () => {
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

  for (const templateId of ZABBIX_TEMPLATE_IDS) {
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
  }

  /*
   * The Page step is left for whoever creates the workflow to set up, and
   * says so on its card, which makes it taller than the others: its
   * outputs, Success and Error, are what lead to the two steps under it,
   * and nothing may lie on them.
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
   * Each of the Switch / Case's four outputs - problem, recovery, update and
   * Default - has a line of its own: no two of its connections run along
   * the same line, or even come close, so each can be followed by eye from
   * its output to the step it leads to.
   */
  test("each of the Switch / Case's outputs has a line of its own", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTemplate(page, "zabbix-declare-incident-from-problem");

    const closest: Array<{ pair: string; distance: number }> =
      await page.evaluate((): Array<{ pair: string; distance: number }> => {
        const EDGE_LABEL: RegExp = /^Edge from (\S+) to (\S+)$/;
        const nameOf: Map<string, string> = new Map();

        document
          .querySelectorAll(".react-flow__node")
          .forEach((node: Element): void => {
            nameOf.set(
              node.getAttribute("data-id") || "",
              (node as HTMLElement).innerText.split("\n")[1] || "",
            );
          });

        const fromSwitch: Array<{ target: string; points: Array<DOMPoint> }> =
          [];

        document
          .querySelectorAll(".react-flow__edge")
          .forEach((edge: Element): void => {
            const label: string = edge.getAttribute("aria-label") || "";
            const match: RegExpMatchArray | null = label.match(EDGE_LABEL);

            if (!match || nameOf.get(match[1] as string) !== "switch-1") {
              return;
            }

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

            fromSwitch.push({
              target: nameOf.get(match[2] as string) || "",
              points: points,
            });
          });

        const pairs: Array<{ pair: string; distance: number }> = [];

        fromSwitch.forEach(
          (
            a: { target: string; points: Array<DOMPoint> },
            index: number,
          ): void => {
            for (const b of fromSwitch.slice(index + 1)) {
              let distance: number = Infinity;

              for (const p of a.points) {
                for (const q of b.points) {
                  distance = Math.min(
                    distance,
                    Math.hypot(p.x - q.x, p.y - q.y),
                  );
                }
              }

              pairs.push({
                pair: [a.target, b.target].sort().join(" and "),
                distance: Math.round(distance),
              });
            }
          },
        );

        return pairs;
      });

    // Four connections: six pairs, the four the template's paths start with.
    expect(
      closest.map((entry: { pair: string }): string => {
        return entry.pair;
      }),
    ).toHaveLength(6);
    expect(
      Array.from(
        new Set(
          closest.flatMap((entry: { pair: string }): Array<string> => {
            return entry.pair.split(" and ");
          }),
        ),
      ).sort(),
    ).toEqual([
      "find-incident-0",
      "find-incident-1",
      "find-incident-2",
      "log-ignored",
    ]);

    // Ten pixels on screen at the zoom the Builder opens at: lines apart.
    for (const entry of closest) {
      expect({ pair: entry.pair, apart: entry.distance >= 10 }).toEqual({
        pair: entry.pair,
        apart: true,
      });
    }
  });

  /*
   * What a laptop shows when the Builder opens: the trigger, the Switch /
   * Case and the first step of each path, and what is ignored, side by
   * side - the whole width of the workflow, so nothing of it starts off
   * screen. A 1,440 px window, whose Builder column beside the side menu
   * is 1,120 px wide.
   */
  test("the Builder opens on the whole width of the workflow: every path's first step is in view", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openTemplate(
      page,
      "zabbix-declare-incident-from-problem",
      "&column=1120",
    );

    const canvas: Box = await boxOf(page.locator(".react-flow").first());

    for (const componentId of [
      "webhook-1",
      "switch-1",
      "find-incident-0",
      "find-incident-1",
      "find-incident-2",
      "log-ignored",
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
