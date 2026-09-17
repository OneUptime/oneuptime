import {
  lockPageScroll,
  resetPageScrollLockForTesting,
  unlockPageScroll,
  usePageScrollLock,
} from "../../../UI/Utils/PageScrollLock";
import { render, RenderResult } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Issue #3553: the Ask AI panel dimmed the page, declared aria-modal, and then
 * let the incident list behind it scroll away under the wheel, because nothing
 * ever took this lock. The panel now takes it through usePageScrollLock, which
 * is the surface every dialog is meant to use — so the guarantees it makes are
 * pinned here, at the one place they are implemented, rather than re-derived in
 * each component suite.
 *
 * The counter is module state that outlives a single test, so every case starts
 * from a known zero and a known body.
 */

type SetBodyFunction = (overflow: string, paddingRight?: string) => void;

const setBody: SetBodyFunction = (
  overflow: string,
  paddingRight: string = "",
): void => {
  /*
   * setProperty/removeProperty rather than assignment: jsdom's CSS layer
   * silently ignores `style.paddingRight = ""`, so an assigning reset would
   * carry one case's gutter into the next and quietly hand a later assertion
   * the wrong page to look at.
   */
  document.body.style.setProperty("overflow", overflow);
  document.body.style.setProperty("padding-right", paddingRight);
};

/*
 * jsdom reports innerWidth === clientWidth, so it never has a scrollbar to
 * reclaim. Faking the gap is the only way to exercise the padding compensation,
 * which is the half of the lock a user notices as the page jumping sideways.
 */
type SetScrollbarWidthFunction = (width: number) => void;

const setScrollbarWidth: SetScrollbarWidthFunction = (width: number): void => {
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    value: window.innerWidth - width,
  });
};

const Locker: FunctionComponent<{ isLocked: boolean }> = (props: {
  isLocked: boolean;
}): ReactElement => {
  usePageScrollLock(props.isLocked);

  return <div data-testid="locker" />;
};

describe("PageScrollLock", () => {
  beforeEach(() => {
    resetPageScrollLockForTesting();
    setBody("");
    setScrollbarWidth(0);
  });

  afterEach(() => {
    resetPageScrollLockForTesting();
    setBody("");
    setScrollbarWidth(0);
  });

  describe("lockPageScroll / unlockPageScroll", () => {
    test("hides the page scrollbar while a dialog is up", () => {
      setBody("auto");

      lockPageScroll();

      expect(document.body.style.overflow).toBe("hidden");
    });

    test("puts back whatever the page had before, not a hardcoded default", () => {
      setBody("scroll");

      lockPageScroll();
      unlockPageScroll();

      expect(document.body.style.overflow).toBe("scroll");
    });

    test("restores an empty inline overflow rather than inventing one", () => {
      setBody("");

      lockPageScroll();
      unlockPageScroll();

      expect(document.body.style.overflow).toBe("");
    });

    test("keeps the page locked while an inner dialog closes over an outer one", () => {
      setBody("auto");

      lockPageScroll();
      lockPageScroll();

      unlockPageScroll();

      expect(document.body.style.overflow).toBe("hidden");

      unlockPageScroll();

      expect(document.body.style.overflow).toBe("auto");
    });

    test("restores the page exactly once no matter how deep the nesting went", () => {
      setBody("auto");

      lockPageScroll();
      lockPageScroll();
      lockPageScroll();
      unlockPageScroll();
      unlockPageScroll();
      unlockPageScroll();

      expect(document.body.style.overflow).toBe("auto");
    });

    test("leaves the page alone when unlocked with nothing open", () => {
      /*
       * A stray release — a surface unlocking twice, a cleanup outliving the
       * lock it was paired with — used to paint the snapshot from some earlier
       * dialog straight over the live page, wiping whatever overflow the page
       * had set for itself. Nothing is open, so there is nothing to put back.
       */
      setBody("auto", "8px");

      unlockPageScroll();
      unlockPageScroll();

      expect(document.body.style.overflow).toBe("auto");
      expect(document.body.style.paddingRight).toBe("8px");
    });

    test("counts the next lock after a stray unlock as a first lock", () => {
      /*
       * The stray unlocks must not leave a credit behind either: one lock still
       * has to inert the page, and one unlock still has to hand it back. A
       * counter allowed to run negative would need three locks before anything
       * happened at all.
       */
      setBody("auto");

      unlockPageScroll();
      unlockPageScroll();

      lockPageScroll();

      expect(document.body.style.overflow).toBe("hidden");

      unlockPageScroll();

      expect(document.body.style.overflow).toBe("auto");
    });

    test("re-reads the page on every fresh lock instead of reusing a stale snapshot", () => {
      setBody("auto");

      lockPageScroll();
      unlockPageScroll();

      setBody("scroll");

      lockPageScroll();
      unlockPageScroll();

      expect(document.body.style.overflow).toBe("scroll");
    });

    test("pads the page by the width of the scrollbar it just hid", () => {
      setScrollbarWidth(15);

      lockPageScroll();

      expect(document.body.style.paddingRight).toBe("15px");
    });

    test("removes that padding again on unlock", () => {
      setScrollbarWidth(15);

      lockPageScroll();
      unlockPageScroll();

      expect(document.body.style.paddingRight).toBe("");
    });

    test("preserves padding the page already had of its own", () => {
      setBody("auto", "8px");
      setScrollbarWidth(15);

      lockPageScroll();

      expect(document.body.style.paddingRight).toBe("15px");

      unlockPageScroll();

      expect(document.body.style.paddingRight).toBe("8px");
    });

    test("adds no padding on overlay-scrollbar platforms, where nothing was reclaimed", () => {
      setScrollbarWidth(0);

      lockPageScroll();

      expect(document.body.style.paddingRight).toBe("");
    });

    test("pads only for the outermost dialog, so nesting does not stack gutters", () => {
      setScrollbarWidth(15);

      lockPageScroll();
      lockPageScroll();

      expect(document.body.style.paddingRight).toBe("15px");
    });
  });

  describe("usePageScrollLock", () => {
    test("locks the page for a surface that mounts open", () => {
      setBody("auto");

      render(<Locker isLocked={true} />);

      expect(document.body.style.overflow).toBe("hidden");
    });

    test("leaves the page alone for a surface that is mounted but closed", () => {
      setBody("auto");

      render(<Locker isLocked={false} />);

      expect(document.body.style.overflow).toBe("auto");
    });

    test("locks when a mounted-but-closed surface opens", () => {
      setBody("auto");

      const rendered: RenderResult = render(<Locker isLocked={false} />);

      rendered.rerender(<Locker isLocked={true} />);

      expect(document.body.style.overflow).toBe("hidden");
    });

    test("releases when the surface closes without unmounting", () => {
      /*
       * AIChatPanel's shape exactly: it stays mounted for the life of the app
       * and swaps its own open flag, so a lock keyed on mount alone would never
       * be handed back.
       */
      setBody("auto");

      const rendered: RenderResult = render(<Locker isLocked={true} />);

      rendered.rerender(<Locker isLocked={false} />);

      expect(document.body.style.overflow).toBe("auto");
    });

    test("releases when the surface unmounts while still open", () => {
      setBody("auto");

      const rendered: RenderResult = render(<Locker isLocked={true} />);

      rendered.unmount();

      expect(document.body.style.overflow).toBe("auto");
    });

    test("survives being opened and closed repeatedly", () => {
      setBody("auto");

      const rendered: RenderResult = render(<Locker isLocked={false} />);

      for (let index: number = 0; index < 5; index++) {
        rendered.rerender(<Locker isLocked={true} />);
        expect(document.body.style.overflow).toBe("hidden");

        rendered.rerender(<Locker isLocked={false} />);
        expect(document.body.style.overflow).toBe("auto");
      }
    });

    test("does not re-take the lock on a re-render that leaves it open", () => {
      setBody("auto");

      const rendered: RenderResult = render(<Locker isLocked={true} />);

      rendered.rerender(<Locker isLocked={true} />);
      rendered.rerender(<Locker isLocked={true} />);

      /*
       * A dependency array that missed would acquire once per render and leave
       * the counter far above zero, so one unmount could never unlock the page.
       */
      rendered.unmount();

      expect(document.body.style.overflow).toBe("auto");
    });

    test("shares one lock across two surfaces open at the same time", () => {
      setBody("auto");

      const first: RenderResult = render(<Locker isLocked={true} />);
      const second: RenderResult = render(<Locker isLocked={true} />);

      first.unmount();

      expect(document.body.style.overflow).toBe("hidden");

      second.unmount();

      expect(document.body.style.overflow).toBe("auto");
    });

    test("shares that lock with imperative callers too", () => {
      setBody("auto");

      lockPageScroll();

      const rendered: RenderResult = render(<Locker isLocked={true} />);

      rendered.unmount();

      expect(document.body.style.overflow).toBe("hidden");

      unlockPageScroll();

      expect(document.body.style.overflow).toBe("auto");
    });

    test("locks before paint, so a right-pinned surface never draws in the wrong place", () => {
      /*
       * useLayoutEffect, not useEffect. Hiding the scrollbar widens the
       * viewport a fixed overlay resolves `right: 0` against, so a lock that
       * landed after paint would shift the panel sideways by the scrollbar's
       * width on its first frame — the jump SideOver used to document.
       *
       * React flushes every layout effect in a commit before any passive one,
       * so a passive effect ordered AHEAD of the locker in the tree is the
       * discriminator: it sees "hidden" only if the lock was taken during
       * layout. Were the hook a plain useEffect, this probe would run first and
       * still see the page scrolling.
       */
      setBody("auto");

      let overflowSeenAfterPaint: string = "";

      const Probe: FunctionComponent = (): ReactElement => {
        React.useEffect(() => {
          overflowSeenAfterPaint = document.body.style.overflow;
        }, []);

        return <div />;
      };

      render(
        <React.Fragment>
          <Probe />
          <Locker isLocked={true} />
        </React.Fragment>,
      );

      expect(overflowSeenAfterPaint).toBe("hidden");
    });
  });
});
