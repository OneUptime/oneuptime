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

// What one element is drawn as in a frame: its bounding box and its pieces.
interface DrawnElement {
  bounds: FrameBox;
  pieces: Array<FrameBox>;
}

/*
 * The locators' elements as drawn in one frame of the page they belong to,
 * in the order given: each one's bounding box and its client rects. Each
 * locator waits for its element as boundingBox() does. An element that is
 * not displayed (display: none, or nothing of it in the layout) has no box,
 * and the read fails naming it, as the boundingBox() reads this replaced
 * failed on their null: a box of zeros would let a comparison pass that
 * never saw the element.
 */
async function drawnInOneFrame(
  locators: Array<Locator>,
  reader: string,
): Promise<Array<DrawnElement>> {
  if (locators.length === 0) {
    return [];
  }

  const page: Page = locators[0]!.page();
  const elements: Array<ElementHandle<HTMLElement | SVGElement>> = [];
  let drawn: Array<DrawnElement | null>;

  try {
    for (const locator of locators) {
      elements.push(
        (await locator.elementHandle()) as ElementHandle<
          HTMLElement | SVGElement
        >,
      );
    }

    drawn = await page.evaluate(
      (nodes: Array<HTMLElement | SVGElement>): Array<DrawnElement | null> => {
        const boxOf: (rect: DOMRect) => FrameBox = (
          rect: DOMRect,
        ): FrameBox => {
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          };
        };

        return nodes.map(
          (node: HTMLElement | SVGElement): DrawnElement | null => {
            const rects: Array<DOMRect> = Array.from(node.getClientRects());

            // No box at all, where boundingBox() answers null.
            if (rects.length === 0) {
              return null;
            }

            return {
              bounds: boxOf(node.getBoundingClientRect()),
              pieces: rects.map(boxOf),
            };
          },
        );
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
      return drawn[index] === null;
    })
    .map((locator: Locator): string => {
      return String(locator);
    });

  if (notDisplayed.length > 0) {
    throw new Error(
      `${reader}: not displayed, so there is no box to compare: ${notDisplayed.join(", ")}`,
    );
  }

  return drawn as Array<DrawnElement>;
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
 *
 * An inline element that wraps has one box over every line it is drawn on:
 * compare what sits beside it on a line with lineBoxesInOneFrame.
 */
export const boxesInOneFrame: BoxesInOneFrameFunction = async (
  locators: Array<Locator>,
): Promise<Array<FrameBox>> => {
  return (await drawnInOneFrame(locators, "boxesInOneFrame")).map(
    (element: DrawnElement): FrameBox => {
      return element.bounds;
    },
  );
};

/*
 * The boxes of a line's pieces, joined into one box per line, top to
 * bottom. Two pieces are on one line when each one's vertical middle is
 * within the other's height: a Latin word and a Persian one on a line can
 * sit a pixel apart, but a line is never half a line below another. A
 * piece with no width - the space a line wraps at - draws nothing, and is
 * left out where the element draws anything else.
 */
export const joinPiecesByLine: (pieces: Array<FrameBox>) => Array<FrameBox> = (
  pieces: Array<FrameBox>,
): Array<FrameBox> => {
  const drawing: Array<FrameBox> = pieces.filter((piece: FrameBox): boolean => {
    return piece.width > 0;
  });
  const read: Array<FrameBox> = (drawing.length > 0 ? drawing : pieces)
    .slice()
    .sort((a: FrameBox, b: FrameBox): number => {
      return a.y - b.y || a.x - b.x;
    });
  const lines: Array<FrameBox> = [];

  const middleOf: (box: FrameBox) => number = (box: FrameBox): number => {
    return box.y + box.height / 2;
  };

  const isWithin: (middle: number, box: FrameBox) => boolean = (
    middle: number,
    box: FrameBox,
  ): boolean => {
    return middle >= box.y && middle <= box.y + box.height;
  };

  for (const piece of read) {
    const line: FrameBox | undefined = lines[lines.length - 1];

    if (
      line &&
      isWithin(middleOf(piece), line) &&
      isWithin(middleOf(line), piece)
    ) {
      const left: number = Math.min(line.x, piece.x);
      const top: number = Math.min(line.y, piece.y);
      const right: number = Math.max(
        line.x + line.width,
        piece.x + piece.width,
      );
      const bottom: number = Math.max(
        line.y + line.height,
        piece.y + piece.height,
      );

      lines[lines.length - 1] = {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      };
    } else {
      lines.push({ ...piece });
    }
  }

  return lines;
};

export type LineBoxesInOneFrameFunction = (
  locators: Array<Locator>,
) => Promise<Array<Array<FrameBox>>>;

/*
 * Each element's boxes, one per line it is drawn on, top to bottom, read in
 * one frame as boxesInOneFrame reads (and failing as it does on an element
 * not displayed).
 *
 * An inline element that wraps is drawn on two or more lines, and its
 * bounding box spans them all: from the start of its first line's piece to
 * the far edge of the next line, at its first line's top. Beside what
 * shares its first line, that box overlaps, though nothing is drawn over
 * anything: Cloud Connect's Persian Azure health line read Azure's
 * sentence over OneUptime's words, which went on to the next line (#8690).
 * Its client rects are its pieces, one or more on each line - a line that
 * runs both ways, Latin words in a Persian sentence, is drawn in more than
 * one - so they are joined into one box per line (joinPiecesByLine).
 */
export const lineBoxesInOneFrame: LineBoxesInOneFrameFunction = async (
  locators: Array<Locator>,
): Promise<Array<Array<FrameBox>>> => {
  return (await drawnInOneFrame(locators, "lineBoxesInOneFrame")).map(
    (element: DrawnElement): Array<FrameBox> => {
      return joinPiecesByLine(element.pieces);
    },
  );
};
