import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { FunctionComponent, ReactElement, useRef } from "react";
import useOfflinePlace, {
  OfflinePlace,
  giveBackOfflinePlace,
  takeOfflinePlace,
} from "../../../UI/Utils/UseOfflinePlace";

/*
 * The reader's place in a page MasterPage puts away while the browser is
 * offline - how far the window was scrolled, and what had focus with its
 * caret - given back when the page comes back. A page put away is not laid
 * out, so the browser scrolls the window to the top under the card and
 * takes focus from the field; without this the page came back "just as you
 * left it" except at the top, with nothing focused.
 *
 * jsdom lays nothing out and never moves the window or focus by itself, so
 * the tests do what the browser does: scroll to the top and blur, while
 * the page is put away.
 */

let scrollXForTest: number = 0;
let scrollYForTest: number = 0;
let scrolledTo: Array<[number, number]> = [];
const originalScrollTo: typeof window.scrollTo = window.scrollTo;

const setScroll: (x: number, y: number) => void = (
  x: number,
  y: number,
): void => {
  scrollXForTest = x;
  scrollYForTest = y;
};

const setOnline: (isOnline: boolean) => void = (isOnline: boolean): void => {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: (): boolean => {
      return isOnline;
    },
  });
};

beforeEach(() => {
  setOnline(true);
  setScroll(0, 0);
  scrolledTo = [];
  Object.defineProperty(window, "scrollX", {
    configurable: true,
    get: (): number => {
      return scrollXForTest;
    },
  });
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    get: (): number => {
      return scrollYForTest;
    },
  });
  window.scrollTo = ((x: number, y: number): void => {
    scrolledTo.push([x, y]);
    setScroll(x, y);
  }) as unknown as typeof window.scrollTo;
  window.history.replaceState({}, "", "/dashboard/monitors");
});

afterEach(() => {
  cleanup();
  setOnline(true);
  window.scrollTo = originalScrollTo;
  window.history.replaceState({}, "", "/");
});

describe("takeOfflinePlace", () => {
  test("takes the address, the window's scroll and what has focus in the page", () => {
    document.body.innerHTML =
      '<div id="page"><textarea id="note"></textarea></div><input id="header" />';

    const note: HTMLElement = document.getElementById("note")!;

    note.focus();
    setScroll(0, 1200);

    const place: OfflinePlace = takeOfflinePlace(
      document.getElementById("page"),
    );

    expect(place).toEqual({
      address: window.location.href,
      scrollX: 0,
      scrollY: 1200,
      focused: note,
    });
  });

  test("focus outside the page is not the page's: nothing to give back", () => {
    document.body.innerHTML =
      '<div id="page"><textarea id="note"></textarea></div><input id="header" />';

    document.getElementById("header")!.focus();

    expect(takeOfflinePlace(document.getElementById("page")).focused).toBe(
      null,
    );
    expect(takeOfflinePlace(null).focused).toBe(null);
  });
});

describe("giveBackOfflinePlace", () => {
  const placeAt: (
    focused: HTMLElement | null,
    scrollY: number,
  ) => OfflinePlace = (
    focused: HTMLElement | null,
    scrollY: number,
  ): OfflinePlace => {
    return {
      address: window.location.href,
      scrollX: 0,
      scrollY: scrollY,
      focused: focused,
    };
  };

  test("scrolls the window back and focuses what had focus, without moving the window again", () => {
    document.body.innerHTML = '<textarea id="note"></textarea>';

    const note: HTMLElement = document.getElementById("note")!;
    const focusOptions: Array<FocusOptions | undefined> = [];
    const focus: (options?: FocusOptions) => void = note.focus.bind(note);

    note.focus = (options?: FocusOptions): void => {
      focusOptions.push(options);
      focus(options);
    };

    giveBackOfflinePlace(placeAt(note, 1200));

    expect(scrolledTo).toEqual([[0, 1200]]);
    expect(document.activeElement).toBe(note);
    expect(focusOptions).toEqual([{ preventScroll: true }]);
  });

  test("a window already where it was is not scrolled again", () => {
    setScroll(0, 1200);

    giveBackOfflinePlace(placeAt(null, 1200));

    expect(scrolledTo).toEqual([]);
  });

  test("another address - a page opened meanwhile - keeps its own place", () => {
    document.body.innerHTML = '<textarea id="note"></textarea>';

    const note: HTMLElement = document.getElementById("note")!;
    const place: OfflinePlace = placeAt(note, 1200);

    window.history.pushState({}, "", "/dashboard/incidents");
    giveBackOfflinePlace(place);

    expect(scrolledTo).toEqual([]);
    expect(document.activeElement).not.toBe(note);
  });

  test("focus the reader gave something else meanwhile stays there", () => {
    document.body.innerHTML =
      '<textarea id="note"></textarea><input id="header" />';

    const header: HTMLElement = document.getElementById("header")!;

    header.focus();
    giveBackOfflinePlace(placeAt(document.getElementById("note"), 0));

    expect(document.activeElement).toBe(header);
  });

  test("a field that left the page is not focused", () => {
    document.body.innerHTML = '<textarea id="note"></textarea>';

    const note: HTMLElement = document.getElementById("note")!;

    note.remove();
    giveBackOfflinePlace(placeAt(note, 0));

    expect(document.activeElement).toBe(document.body);
  });
});

/*
 * The hook in a page that is put away while offline, as MasterPage does it:
 * display none, otherwise contents.
 */
const PutAwayPage: FunctionComponent<{ isOffline: boolean }> = (props: {
  isOffline: boolean;
}): ReactElement => {
  const pageRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);

  useOfflinePlace(pageRef, props.isOffline);

  return (
    <div
      ref={pageRef}
      data-testid="page"
      style={{ display: props.isOffline ? "none" : "contents" }}
    >
      <textarea data-testid="note" />
    </div>
  );
};

describe("useOfflinePlace", () => {
  // What the browser does as the page is put away.
  const browserPutsThePageAway: () => void = (): void => {
    setScroll(0, 0);
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const goOffline: (rerender: (ui: ReactElement) => void) => void = (
    rerender: (ui: ReactElement) => void,
  ): void => {
    setOnline(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    rerender(<PutAwayPage isOffline={true} />);
    browserPutsThePageAway();
  };

  test("the scroll and the focused field, its caret where it was, come back with the page", () => {
    const { rerender } = render(<PutAwayPage isOffline={false} />);
    const note: HTMLTextAreaElement = screen.getByTestId(
      "note",
    ) as HTMLTextAreaElement;

    note.value = "Rolled back the deploy";
    note.focus();
    note.setSelectionRange(6, 6);
    setScroll(0, 1200);

    goOffline(rerender);

    expect(document.activeElement).toBe(document.body);
    expect(window.scrollY).toBe(0);

    rerender(<PutAwayPage isOffline={false} />);

    expect(scrolledTo).toEqual([[0, 1200]]);
    expect(document.activeElement).toBe(note);
    expect(note.selectionStart).toBe(6);
  });

  test("a second offline while the page is put away keeps the first place", () => {
    const { rerender } = render(<PutAwayPage isOffline={false} />);

    setScroll(0, 900);
    goOffline(rerender);

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    rerender(<PutAwayPage isOffline={false} />);

    expect(scrolledTo).toEqual([[0, 900]]);
  });

  test("a page drawn while already offline has no place to give back", () => {
    setOnline(false);

    const { rerender } = render(<PutAwayPage isOffline={true} />);

    setOnline(true);
    rerender(<PutAwayPage isOffline={false} />);

    expect(scrolledTo).toEqual([]);
  });

  test("the place is given back once: a later return starts from where the reader is", () => {
    const { rerender } = render(<PutAwayPage isOffline={false} />);

    setScroll(0, 700);
    goOffline(rerender);
    rerender(<PutAwayPage isOffline={false} />);

    expect(scrolledTo).toEqual([[0, 700]]);

    // Put away and back again with no offline event in between.
    rerender(<PutAwayPage isOffline={true} />);
    setScroll(0, 0);
    rerender(<PutAwayPage isOffline={false} />);

    expect(scrolledTo).toEqual([[0, 700]]);
  });

  test("lets go of the browser's offline event when the page is gone", () => {
    const added: Array<unknown> = [];
    const removed: Array<unknown> = [];
    const addEventListener: typeof window.addEventListener =
      window.addEventListener;
    const removeEventListener: typeof window.removeEventListener =
      window.removeEventListener;

    window.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ): void => {
      if (type === "offline" && options === true) {
        added.push(listener);
      }

      addEventListener.call(window, type, listener, options);
    }) as typeof window.addEventListener;

    window.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ): void => {
      if (type === "offline" && options === true) {
        removed.push(listener);
      }

      removeEventListener.call(window, type, listener, options);
    }) as typeof window.removeEventListener;

    try {
      const { unmount } = render(<PutAwayPage isOffline={false} />);

      expect(added).toHaveLength(1);

      unmount();

      expect(removed).toEqual(added);
    } finally {
      window.addEventListener = addEventListener;
      window.removeEventListener = removeEventListener;
    }
  });
});
