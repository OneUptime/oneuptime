import { ElementHandle, Locator, Page } from "@playwright/test";

/*
 * Element boxes read in ONE frame, for a test that compares where two or
 * more elements are.
 *
 * Each locator.boundingBox() is a round trip of its own: two of them read
 * while the page moves come from two moments, and a gap or an alignment
 * between them is off by however far things moved in between. Things move
 * right after the actions tests take: a side panel slides in (SideOver, 200
 * ms), a dialog grows from 95% (Modal), More fields scrolls its fields into
 * view (FoldedSection's smooth scroll), a menu or a fold opens. Two suites
 * failed that way on master in October 2026: the Profiles function panel's
 * notice and the words it lines up with read 54 to 126 pixels apart (13 runs
 * in 15 on a busy machine), and the Auto-Remediation picker's hint read 96
 * pixels under its box for a gap of a few. Reading every box in one evaluate
 * measures them at the same moment, so how they sit relative to each other
 * is right even while they move.
 */

export interface FrameBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BoxesInOneFrameFunction = (
  locators: Array<Locator>,
) => Promise<Array<FrameBox>>;

/*
 * The boxes of the locators' elements, in the order given, read in one
 * frame of the page they belong to. Each locator waits for its element as
 * boundingBox() does. An element that is not displayed (display: none, or
 * nothing of it in the layout) has no box, and the read fails naming it, as
 * the boundingBox() reads this replaced failed on their null: a box of
 * zeros would let a comparison pass that never saw the element.
 */
export const boxesInOneFrame: BoxesInOneFrameFunction = async (
  locators: Array<Locator>,
): Promise<Array<FrameBox>> => {
  if (locators.length === 0) {
    return [];
  }

  const page: Page = locators[0]!.page();
  const elements: Array<ElementHandle<HTMLElement | SVGElement>> = [];
  let boxes: Array<FrameBox | null>;

  try {
    for (const locator of locators) {
      elements.push(
        (await locator.elementHandle()) as ElementHandle<
          HTMLElement | SVGElement
        >,
      );
    }

    boxes = await page.evaluate(
      (nodes: Array<HTMLElement | SVGElement>): Array<FrameBox | null> => {
        return nodes.map((node: HTMLElement | SVGElement): FrameBox | null => {
          // No box at all, where boundingBox() answers null.
          if (node.getClientRects().length === 0) {
            return null;
          }

          const rect: DOMRect = node.getBoundingClientRect();

          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          };
        });
      },
      elements,
    );
  } finally {
    await Promise.all(
      elements.map(
        (element: ElementHandle<HTMLElement | SVGElement>): Promise<void> => {
          return element.dispose();
        },
      ),
    );
  }

  const notDisplayed: Array<string> = locators
    .filter((_locator: Locator, index: number): boolean => {
      return boxes[index] === null;
    })
    .map((locator: Locator): string => {
      return String(locator);
    });

  if (notDisplayed.length > 0) {
    throw new Error(
      `boxesInOneFrame: not displayed, so there is no box to compare: ${notDisplayed.join(", ")}`,
    );
  }

  return boxes as Array<FrameBox>;
};
