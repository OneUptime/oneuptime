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

import { useLayoutEffect } from "react";

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

/*
 * Restoring means putting the page back exactly as it was found, and "as it
 * was found" is usually no inline value at all rather than an empty one. Going
 * through removeProperty for that case says so directly — and it is also the
 * only spelling jsdom honours for a longhand like padding-right, so the
 * restore is assertable in a test instead of being taken on trust.
 */
type RestoreBodyStyleFunction = (property: string, value: string) => void;

const restoreBodyStyle: RestoreBodyStyleFunction = (
  property: string,
  value: string,
): void => {
  if (value === "") {
    document.body.style.removeProperty(property);

    return;
  }

  document.body.style.setProperty(property, value);
};

export const unlockPageScroll: PageScrollLockFunction = (): void => {
  /*
   * Nothing is open, so there is nothing of ours on the page to put back. A
   * stray unlock — one surface releasing twice, a cleanup that outlives the
   * lock it was paired with — has to be inert rather than paint a snapshot
   * taken for some earlier dialog over whatever the page is wearing now.
   */
  if (openDialogCount === 0) {
    return;
  }

  openDialogCount--;

  if (openDialogCount > 0 || typeof document === "undefined") {
    return;
  }

  restoreBodyStyle("overflow", bodyOverflowBeforeLock);
  restoreBodyStyle("padding-right", bodyPaddingRightBeforeLock);
};

/*
 * The declarative form, and the one new surfaces should reach for.
 *
 * Every caller of the pair above writes the same effect: acquire on the way
 * in, release from the cleanup, keyed on whether the surface is up. Written by
 * hand that is four lines with three ways to get it wrong — release omitted,
 * the wrong dependency, or the call placed after an early `return` so it stops
 * running once the surface closes. Issue #3553 is what the first two look like
 * from the outside: the Ask AI panel declared aria-modal, dimmed the page
 * behind it, and let that page scroll away under the wheel because nothing
 * ever took the lock.
 *
 * Passing the open flag straight in keeps the invariant to one line, and keeps
 * it correct for surfaces like AIChatPanel that stay mounted while closed
 * rather than being unmounted by their parent.
 *
 * A layout effect, not an ordinary one, and that is load-bearing for every
 * caller rather than a detail of one. Hiding the page scrollbar widens the
 * viewport that a fixed overlay resolves against, so a surface that painted
 * before the lock landed jumps sideways by the scrollbar's width on any
 * platform drawing a classic scrollbar — the full width for a panel pinned to
 * `right: 0`, half of it for a centred dialog. Locking before paint means the
 * surface is only ever drawn in its final position.
 */
export type UsePageScrollLockFunction = (isLocked: boolean) => void;

export const usePageScrollLock: UsePageScrollLockFunction = (
  isLocked: boolean,
): void => {
  useLayoutEffect(() => {
    if (!isLocked) {
      return undefined;
    }

    lockPageScroll();

    return () => {
      unlockPageScroll();
    };
  }, [isLocked]);
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
