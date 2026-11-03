import { Page } from "@playwright/test";

/*
 * Where elements are drawn, in every frame a page paints from its first:
 * for a test that holds an element to the one size it is drawn at.
 *
 * A read once the page has settled sees only how it ends: a box drawn small
 * and grown into its size - by a transition, or by a layout that measures
 * itself a frame late - reads the same as one drawn at its size from the
 * start. The dashboard's board did that on every load until November 2026:
 * each widget was drawn a few pixels across, then grew to its size over a
 * quarter of a second with its rows already in it, and suites that read a
 * widget's table the moment its rows showed read it mid-growth on busy
 * runners (DashboardWidgetSort, three times).
 *
 * recordDrawnBoxes adds, before the page's own scripts, a recorder that
 * reads the page as each frame is painted and keeps, for each element the
 * selector finds, every change of where it is drawn inside its parent and
 * how big, how many animations (CSS transitions among them) run on it, and
 * how many of its descendants a content selector finds (a table's rows,
 * say). readDrawnBoxes reads what it kept; waitForFrames lets the page draw
 * a number of frames first.
 */

export interface DrawnBox {
  // Milliseconds after the page's first script ran.
  time: number;
  /*
   * The frame it was first drawn in, counted from the page's first: boxes
   * of several elements with one frame were painted together.
   */
  frame: number;
  // Where the element is drawn inside its parent's box.
  x: number;
  y: number;
  width: number;
  height: number;
  // Animations running on the element itself, CSS transitions among them.
  animations: number;
  // Descendants the content selector finds: 0 without one.
  content: number;
}

// Each element's boxes, oldest first, by its id (else its data-testid).
export type DrawnBoxes = Record<string, Array<DrawnBox>>;

interface DrawnBoxesRecord {
  frames: number;
  boxes: DrawnBoxes;
}

declare global {
  interface Window {
    __drawnBoxes?: DrawnBoxesRecord | undefined;
  }
}

export interface RecordDrawnBoxesOptions {
  // The elements to follow; each needs an id or a data-testid.
  selector: string;
  // Descendants to count in each, as its content.
  contentSelector?: string | undefined;
}

export type RecordDrawnBoxesFunction = (
  page: Page,
  options: RecordDrawnBoxesOptions,
) => Promise<void>;

/*
 * Starts recording on the page's next navigation, from its first frame: call
 * it before page.goto. A box is kept when it differs from the element's
 * last one, so the record stays small however long the page runs.
 */
export const recordDrawnBoxes: RecordDrawnBoxesFunction = async (
  page: Page,
  options: RecordDrawnBoxesOptions,
): Promise<void> => {
  await page.addInitScript(
    (settings: { selector: string; contentSelector: string | null }): void => {
      const start: number = performance.now();
      const record: DrawnBoxesRecord = { frames: 0, boxes: {} };

      window.__drawnBoxes = record;

      const keep: (element: HTMLElement) => void = (
        element: HTMLElement,
      ): void => {
        const key: string =
          element.id || element.getAttribute("data-testid") || "";

        if (!key) {
          return;
        }

        const box: DOMRect = element.getBoundingClientRect();
        const parentBox: DOMRect | null = element.parentElement
          ? element.parentElement.getBoundingClientRect()
          : null;
        const drawn: DrawnBox = {
          time: Math.round(performance.now() - start),
          frame: record.frames,
          x: box.x - (parentBox ? parentBox.x : 0),
          y: box.y - (parentBox ? parentBox.y : 0),
          width: box.width,
          height: box.height,
          animations: element.getAnimations().length,
          content: settings.contentSelector
            ? element.querySelectorAll(settings.contentSelector).length
            : 0,
        };
        const kept: Array<DrawnBox> = record.boxes[key] || [];
        const last: DrawnBox | undefined = kept[kept.length - 1];

        if (
          !last ||
          last.x !== drawn.x ||
          last.y !== drawn.y ||
          last.width !== drawn.width ||
          last.height !== drawn.height ||
          last.animations !== drawn.animations ||
          last.content !== drawn.content
        ) {
          kept.push(drawn);
          record.boxes[key] = kept;
        }
      };

      /*
       * Each frame is read as the browser is about to paint it: in a
       * ResizeObserver's callback, which runs once the frame is laid out,
       * after every ResizeObserver made before it - so a page that lays
       * itself out again there (the dashboard's board does, to follow its
       * width) is read after it has. A box of its own, out of the page's
       * flow and out of sight, is resized on every frame, so the observer
       * reports on every frame; and the observer is made again whenever the
       * selector finds an element it had not, so it comes after the
       * observers that element brought with it. Read in the frame's
       * requestAnimationFrame callback, or in a task after it, the record
       * would hold boxes no frame painted.
       */
      const ticker: HTMLDivElement = document.createElement("div");
      ticker.setAttribute("aria-hidden", "true");
      ticker.style.cssText =
        "position:fixed;top:0;left:0;width:1px;height:1px;visibility:hidden;pointer-events:none;";

      const known: WeakSet<Element> = new WeakSet<Element>();
      let sampler: ResizeObserver | null = null;

      const onFrame: () => void = (): void => {
        record.frames += 1;

        const found: Array<HTMLElement> = Array.from(
          document.querySelectorAll<HTMLElement>(settings.selector),
        );
        const hasNew: boolean = found.some((element: HTMLElement): boolean => {
          return !known.has(element);
        });

        for (const element of found) {
          known.add(element);
        }

        if (hasNew) {
          if (sampler) {
            sampler.disconnect();
          }

          if (!ticker.isConnected) {
            document.documentElement.appendChild(ticker);
          }

          sampler = new ResizeObserver((): void => {
            document
              .querySelectorAll<HTMLElement>(settings.selector)
              .forEach(keep);
          });
          sampler.observe(ticker);
        }

        ticker.style.width = ticker.style.width === "1px" ? "2px" : "1px";
        window.requestAnimationFrame(onFrame);
      };

      window.requestAnimationFrame(onFrame);
    },
    {
      selector: options.selector,
      contentSelector: options.contentSelector || null,
    },
  );
};

export type ReadDrawnBoxesFunction = (page: Page) => Promise<DrawnBoxes>;

// Every element's boxes so far; an error when nothing was recording.
export const readDrawnBoxes: ReadDrawnBoxesFunction = async (
  page: Page,
): Promise<DrawnBoxes> => {
  const boxes: DrawnBoxes | null = await page.evaluate(
    (): DrawnBoxes | null => {
      return window.__drawnBoxes ? window.__drawnBoxes.boxes : null;
    },
  );

  if (!boxes) {
    throw new Error(
      "readDrawnBoxes: nothing is recording - call recordDrawnBoxes before the page loads.",
    );
  }

  return boxes;
};

export type WaitForFramesFunction = (
  page: Page,
  frames: number,
) => Promise<void>;

/*
 * Waits until the page has drawn this many more frames: time for what moves
 * after a moment - a transition of a quarter of a second is some 15 frames
 * at 60 a second - to be drawn and recorded.
 */
export const waitForFrames: WaitForFramesFunction = async (
  page: Page,
  frames: number,
): Promise<void> => {
  const from: number = await page.evaluate((): number => {
    return window.__drawnBoxes ? window.__drawnBoxes.frames : 0;
  });

  await page.waitForFunction((target: number): boolean => {
    return (
      Boolean(window.__drawnBoxes) && window.__drawnBoxes!.frames >= target
    );
  }, from + frames);
};

export type DrawnBoxAtFunction = (
  boxes: Array<DrawnBox>,
  frame: number,
) => DrawnBox | null;

/*
 * Where an element was drawn in a frame: its last box drawn in that frame or
 * before it - a box is kept only when it changes - or null before its first.
 */
export const drawnBoxAt: DrawnBoxAtFunction = (
  boxes: Array<DrawnBox>,
  frame: number,
): DrawnBox | null => {
  let found: DrawnBox | null = null;

  for (const box of boxes) {
    if (box.frame > frame) {
      break;
    }

    found = box;
  }

  return found;
};

export type DrawnPlacesOfFunction = (boxes: Array<DrawnBox>) => Array<string>;

/*
 * The sizes and places an element was drawn at, in the order drawn, each
 * once and rounded to half a pixel - "268.5x310 at 0,0" - so an element
 * drawn once, where it stays, has one. Read in a failure, the list says
 * how it moved: "34x310 at 0,0", "166x310 at 0,0", ... "268.5x310 at 0,0".
 */
export const drawnPlacesOf: DrawnPlacesOfFunction = (
  boxes: Array<DrawnBox>,
): Array<string> => {
  const halfPixel: (value: number) => number = (value: number): number => {
    return Math.round(value * 2) / 2;
  };
  const places: Array<string> = [];

  for (const box of boxes) {
    const place: string = `${halfPixel(box.width)}x${halfPixel(box.height)} at ${halfPixel(box.x)},${halfPixel(box.y)}`;

    if (places[places.length - 1] !== place) {
      places.push(place);
    }
  }

  return places;
};
