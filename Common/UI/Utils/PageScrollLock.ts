/*
 * The page behind an open dialog surface must not scroll, and nested surfaces
 * share a single lock: a counter, rather than a boolean, is what stops an inner
 * dialog from handing scrolling back while the surface that opened it is still
 * up.
 *
 * This lives outside any one component on purpose. Modal and SideOver nest
 * inside each other in shipped code — Workflow's "Run Workflow" panel is a
 * SideOver that opens a ConfirmModal — and two private counters would race over
 * document.body.style. Whichever surface unmounted first would restore the
 * snapshot the other had already overwritten, leaving the page either scrolling
 * under a dialog that is still open or locked forever with no dialog on screen.
 */

let openDialogCount: number = 0;
let bodyOverflowBeforeLock: string = "";
let bodyPaddingRightBeforeLock: string = "";

export type PageScrollLockFunction = () => void;

export const lockPageScroll: PageScrollLockFunction = (): void => {
  openDialogCount++;

  if (openDialogCount > 1 || typeof document === "undefined") {
    return;
  }

  bodyOverflowBeforeLock = document.body.style.overflow;
  bodyPaddingRightBeforeLock = document.body.style.paddingRight;

  /*
   * Hiding the scrollbar reclaims its width, so the page underneath would
   * jump sideways by exactly that much. Pad it back to hold everything still.
   */
  const scrollbarWidth: number =
    window.innerWidth - document.documentElement.clientWidth;

  if (scrollbarWidth > 0) {
    document.body.style.paddingRight = `${scrollbarWidth}px`;
  }

  document.body.style.overflow = "hidden";
};

export const unlockPageScroll: PageScrollLockFunction = (): void => {
  openDialogCount = Math.max(0, openDialogCount - 1);

  if (openDialogCount > 0 || typeof document === "undefined") {
    return;
  }

  document.body.style.overflow = bodyOverflowBeforeLock;
  document.body.style.paddingRight = bodyPaddingRightBeforeLock;
};

/*
 * Test-only escape hatch. The counter is module state that survives between
 * cases in the same jest file, so a suite that asserts on the FIRST lock needs
 * a way back to a known zero.
 */
export const resetPageScrollLockForTesting: PageScrollLockFunction =
  (): void => {
    openDialogCount = 0;
    bodyOverflowBeforeLock = "";
    bodyPaddingRightBeforeLock = "";
  };
