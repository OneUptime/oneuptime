import { expect, Locator } from "@playwright/test";

/*
 * A POPUP IS DRAWN WHOLE.
 *
 * A tooltip, a menu or a panel opened from a control, a glossary term's
 * definition: each is drawn on the page's body (the tooltip layer,
 * Common/UI/Components/Tooltip/TooltipLayer.ts and LayeredPopover.tsx), or
 * on the part of the page shown full screen, never inside the box its
 * control is in, where a card, a table that scrolls sideways or a scrolling
 * panel cut it off (#9769, #9859, #9861, #9863).
 *
 * What a spec reads to say so, in one frame (one evaluate, as
 * SuiteHelpers/Frames.ts reads boxes): the popup's box, the window's, what
 * the page shows a few pixels in from each of its four corners - the popup
 * itself, where a box that clips it shows the page instead - the side
 * Popper put it on, and whether it hangs from the layer.
 */

export interface PopupBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DrawnPopup {
  box: PopupBox;
  window: { width: number; height: number };
  // What the page shows at its corners: top left, top right, bottom left, bottom right.
  cornersShown: Array<boolean>;
  // On the body, or on the part of the page shown full screen.
  isOnTheLayer: boolean;
  // Popper's side and edge ("bottom-end"), or a tooltip's box's.
  placement: string | null;
}

// Far enough in from a corner to be past its rounding.
const CORNER_INSET_PX: number = 6;

/*
 * The popup a locator finds, as drawn now. The locator may find the popup's
 * own element (a menu's panel, a tooltip's box) or anything inside it; its
 * box is the element's own, and the layer's element around it says where
 * it is drawn.
 */
export async function readDrawnPopup(popup: Locator): Promise<DrawnPopup> {
  return await popup.evaluate((element: Element, inset: number): DrawnPopup => {
    const rect: DOMRect = element.getBoundingClientRect();
    const root: Element | null = element.closest("[data-tippy-root]");
    const layer: Element = document.fullscreenElement || document.body;
    const box: Element | null = root ? root.querySelector(".tippy-box") : null;

    return {
      box: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      window: {
        width: document.documentElement.clientWidth || window.innerWidth,
        height: window.innerHeight,
      },
      cornersShown: [
        [rect.left + inset, rect.top + inset],
        [rect.right - inset, rect.top + inset],
        [rect.left + inset, rect.bottom - inset],
        [rect.right - inset, rect.bottom - inset],
      ].map(([x, y]: Array<number>): boolean => {
        const shown: Element | null = document.elementFromPoint(x!, y!);
        return Boolean(shown && element.contains(shown));
      }),
      isOnTheLayer: Boolean(root && root.parentElement === layer),
      placement:
        root?.getAttribute("data-popper-placement") ||
        box?.getAttribute("data-placement") ||
        null,
    };
  }, CORNER_INSET_PX);
}

/*
 * The popup is drawn on the layer, inside the window, and shows at its four
 * corners. Returns what it read, for a spec to say more about its side.
 */
export async function expectDrawnWhole(
  popup: Locator,
  what: string,
): Promise<DrawnPopup> {
  // Its corners are read once it has stopped moving into place.
  await expect
    .poll(
      async (): Promise<Array<boolean>> => {
        return (await readDrawnPopup(popup)).cornersShown;
      },
      { message: `${what}: what the page shows at its four corners` },
    )
    .toEqual([true, true, true, true]);

  const drawn: DrawnPopup = await readDrawnPopup(popup);

  expect(drawn.isOnTheLayer, `${what}: drawn on the page's body`).toBe(true);
  expect(drawn.box.x, `${what}: its left edge`).toBeGreaterThanOrEqual(0);
  expect(drawn.box.y, `${what}: its top edge`).toBeGreaterThanOrEqual(0);
  expect(
    drawn.box.x + drawn.box.width,
    `${what}: its right edge, in a window ${drawn.window.width}px wide`,
  ).toBeLessThanOrEqual(drawn.window.width);
  expect(
    drawn.box.y + drawn.box.height,
    `${what}: its bottom edge, in a window ${drawn.window.height}px tall`,
  ).toBeLessThanOrEqual(drawn.window.height);

  return drawn;
}

// The relative luminance of a CSS colour, as WCAG reads it.
export function luminanceOf(color: string): number {
  const channels: Array<number> = (color.match(/[\d.]+/g) || [])
    .slice(0, 3)
    .map((value: string): number => {
      const channel: number = Number(value) / 255;
      return channel <= 0.03928
        ? channel / 12.92
        : Math.pow((channel + 0.055) / 1.055, 2.4);
    });

  return (
    0.2126 * (channels[0] || 0) +
    0.7152 * (channels[1] || 0) +
    0.0722 * (channels[2] || 0)
  );
}

// WCAG's contrast of two CSS colours.
export function contrastOf(first: string, second: string): number {
  const [lighter, darker]: Array<number> = [
    luminanceOf(first),
    luminanceOf(second),
  ].sort((a: number, b: number): number => {
    return b - a;
  });

  return (lighter! + 0.05) / (darker! + 0.05);
}
