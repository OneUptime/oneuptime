import { expect, Page } from "@playwright/test";

/*
 * Whether a page scrolls sideways, read until it has settled.
 *
 * A page that fits its window can draw a frame or two that does not.
 * Common's Table measures its card after it paints (useTableBoxWidth) and
 * fits its columns on the next frame; on a phone it first paints the
 * desktop table and becomes cards a moment later. A chart keeps the width
 * recharts' ResponsiveContainer gave it until the container's
 * ResizeObserver runs, a frame or more after the window narrows. The
 * dashboard canvas resizes its widgets after their rows show; a font swaps
 * in. A test that read document.documentElement.scrollWidth once, right
 * after a resize, a click or a page load, could catch such a frame and fail
 * a page that fits: about twenty suites did so on slow runners in October
 * and November 2026 (CloudConnect's account Changes one run in 97 under
 * load; 14.0.96's gate read a Logs monitor's preview chart 748 pixels too
 * wide 11 ms after going to a phone's width). Holding every
 * requestAnimationFrame 250 ms reproduced it on a quiet machine; slowing
 * the CPU did not.
 *
 * So the page is read again until it fits, for as long as an expect waits:
 * a page that fits passes on the frame it settles in, and one that really
 * runs past its window still fails, saying by how many pixels. Every suite
 * reads a page's sideways scroll through this module
 * (Tests/Ops/E2EPageFitReads holds them to it).
 */

export interface PageFitOptions {
  /*
   * How many pixels past its width the page may reach: none when left out.
   * A suite that measured a box whose width rounds up a pixel says 1.
   */
  tolerance?: number | undefined;
  // What a failure says first: the page and the moment it was read at.
  message?: string | undefined;
  // How long to keep reading, in milliseconds: the expect timeout when left out.
  timeout?: number | undefined;
  /*
   * A soft assertion (expect.soft): a page that does not fit is reported
   * and the test goes on, as a test that checks every language in a loop
   * reports each one that fails.
   */
  soft?: boolean | undefined;
}

// How long settledSidewaysScrollOf reads when not told: Playwright's own expect timeout.
export const SETTLE_TIMEOUT_IN_MS: number = 5000;

// How long settledSidewaysScrollOf waits between reads.
const READ_AGAIN_AFTER_IN_MS: number = 100;

export type SidewaysScrollOfFunction = (page: Page) => Promise<number>;

/*
 * How many pixels the page reaches past the width of its window, read once:
 * 0 or less when it fits. The window's width is the root element's
 * clientWidth - the window less any scrollbar that takes room - which is
 * what the page can be scrolled across: a page that runs under a scrollbar
 * scrolls sideways too. For a check inside expect.poll or toPass, or to
 * compare the page with itself before and after; to hold a page to its
 * width, use expectNoSidewaysScroll.
 */
export const sidewaysScrollOf: SidewaysScrollOfFunction = async (
  page: Page,
): Promise<number> => {
  return await page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
};

export type SettledSidewaysScrollOfFunction = (
  page: Page,
  options?: { tolerance?: number | undefined; timeout?: number | undefined },
) => Promise<number>;

/*
 * How many pixels the page reaches past its window once it has settled: read
 * until it reaches no more than `tolerance` pixels past it (none when left
 * out), or until `timeout` (SETTLE_TIMEOUT_IN_MS when left out) is up, and
 * the last read answered. For a test that collects what is wrong across
 * languages and widths rather than failing at the first.
 */
export const settledSidewaysScrollOf: SettledSidewaysScrollOfFunction = async (
  page: Page,
  options: {
    tolerance?: number | undefined;
    timeout?: number | undefined;
  } = {},
): Promise<number> => {
  const tolerance: number =
    options.tolerance === undefined ? 0 : options.tolerance;
  const deadline: number =
    Date.now() +
    (options.timeout === undefined ? SETTLE_TIMEOUT_IN_MS : options.timeout);

  for (;;) {
    const sideways: number = await sidewaysScrollOf(page);

    if (sideways <= tolerance || Date.now() >= deadline) {
      return sideways;
    }

    await page.waitForTimeout(READ_AGAIN_AFTER_IN_MS);
  }
};

export type ExpectNoSidewaysScrollFunction = (
  page: Page,
  options?: PageFitOptions,
) => Promise<void>;

/*
 * Passes once the page fits its window: reads it until it reaches no more
 * than `tolerance` pixels past its width, and fails with how far it reaches
 * when it still does when the expect's time is up.
 */
export const expectNoSidewaysScroll: ExpectNoSidewaysScrollFunction = async (
  page: Page,
  options: PageFitOptions = {},
): Promise<void> => {
  const tolerance: number =
    options.tolerance === undefined ? 0 : options.tolerance;
  const message: string = `${
    options.message ? `${options.message}: ` : ""
  }how many pixels the page reaches past its window (at most ${tolerance})`;

  if (options.soft) {
    expect
      .soft(
        await settledSidewaysScrollOf(page, {
          tolerance: tolerance,
          timeout: options.timeout,
        }),
        message,
      )
      .toBeLessThanOrEqual(tolerance);
    return;
  }

  await expect
    .poll(
      (): Promise<number> => {
        return sidewaysScrollOf(page);
      },
      {
        message: message,
        ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
      },
    )
    .toBeLessThanOrEqual(tolerance);
};
