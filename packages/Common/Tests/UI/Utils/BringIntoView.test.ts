import bringIntoView, {
  focusInvalidControl,
  getInvalidControl,
  prefersReducedMotion,
} from "../../../UI/Utils/BringIntoView";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Utils/BringIntoView: an element scrolled into view by as little as it
 * takes (block and inline "nearest"), smoothly unless the reader asks for
 * less motion, and nothing at all where there is nothing to scroll with.
 */

const originalMatchMedia: unknown = window.matchMedia;
let reduced: boolean = false;

beforeEach(() => {
  reduced = false;
  window.matchMedia = ((query: string): MediaQueryList => {
    return {
      matches: query === "(prefers-reduced-motion: reduce)" && reduced,
      media: query,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
});

afterEach(() => {
  window.matchMedia = originalMatchMedia as typeof window.matchMedia;
});

function elementRecordingScrolls(): {
  element: HTMLElement;
  calls: Array<unknown>;
} {
  const element: HTMLElement = document.createElement("div");
  const calls: Array<unknown> = [];

  element.scrollIntoView = (options?: boolean | ScrollIntoViewOptions) => {
    calls.push(options);
  };

  return { element, calls };
}

describe("bringIntoView", () => {
  test("scrolls by as little as it takes, smoothly", () => {
    const { element, calls } = elementRecordingScrolls();

    bringIntoView(element);

    expect(calls).toEqual([
      { block: "nearest", inline: "nearest", behavior: "smooth" },
    ]);
  });

  test("jumps for a reader who asks for less motion", () => {
    reduced = true;
    const { element, calls } = elementRecordingScrolls();

    bringIntoView(element);

    expect(calls).toEqual([
      { block: "nearest", inline: "nearest", behavior: "auto" },
    ]);
  });

  test("does nothing without an element", () => {
    expect(() => {
      bringIntoView(null);
      bringIntoView(undefined);
    }).not.toThrow();
  });

  test("does nothing in a DOM without scrollIntoView (jsdom)", () => {
    const element: HTMLElement = document.createElement("div");
    (element as unknown as Record<string, unknown>)["scrollIntoView"] =
      undefined;

    expect(() => {
      bringIntoView(element);
    }).not.toThrow();
  });
});

describe("prefersReducedMotion", () => {
  test("follows the reader's setting", () => {
    expect(prefersReducedMotion()).toBe(false);

    reduced = true;

    expect(prefersReducedMotion()).toBe(true);
  });

  test("is false where there is no matchMedia", () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;

    expect(prefersReducedMotion()).toBe(false);
  });
});

/*
 * The control of a field in error, for the focus after a press: the first
 * one in the field that says it is invalid, or the first control in a group
 * that says so - never the label's own links or (i) buttons before it.
 */
function fieldWith(html: string): HTMLElement {
  const element: HTMLElement = document.createElement("div");
  element.innerHTML = html;
  document.body.appendChild(element);
  return element;
}

describe("getInvalidControl", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("the control that says it is invalid, not the label's button before it", () => {
    const field: HTMLElement = fieldWith(
      '<label>Name <button type="button">About Name</button></label>' +
        '<input data-testid="name" aria-invalid="true" />',
    );

    expect(getInvalidControl(field)?.getAttribute("data-testid")).toBe("name");
  });

  test("a long text box, and an editor that writes itself", () => {
    expect(
      getInvalidControl(fieldWith('<textarea aria-invalid="true"></textarea>'))
        ?.tagName,
    ).toBe("TEXTAREA");
    expect(
      getInvalidControl(
        fieldWith('<div contenteditable="true" aria-invalid="true"></div>'),
      )?.getAttribute("contenteditable"),
    ).toBe("true");
  });

  test("a group that says it is invalid: its first control that is not turned off", () => {
    const field: HTMLElement = fieldWith(
      '<div role="radiogroup" aria-invalid="true">' +
        '<input type="radio" value="a" disabled />' +
        '<input type="radio" value="b" />' +
        '<input type="radio" value="c" />' +
        "</div>",
    );

    expect((getInvalidControl(field) as HTMLInputElement).value).toBe("b");
  });

  test("nothing that says so, or nothing at all: none", () => {
    expect(getInvalidControl(fieldWith("<input />"))).toBeNull();
    expect(getInvalidControl(null)).toBeNull();
    expect(getInvalidControl(undefined)).toBeNull();
    expect(
      getInvalidControl(
        fieldWith('<div aria-invalid="true"><span>no control</span></div>'),
      ),
    ).toBeNull();
  });
});

describe("focusInvalidControl", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("puts the focus there without scrolling: bringIntoView has done that", () => {
    const field: HTMLElement = fieldWith(
      '<input data-testid="first" />' +
        '<input data-testid="bad" aria-invalid="true" />',
    );
    const bad: HTMLInputElement = field.querySelector(
      "[data-testid='bad']",
    ) as HTMLInputElement;
    const focusCalls: Array<FocusOptions | undefined> = [];
    const focus: (options?: FocusOptions) => void = bad.focus.bind(bad);

    bad.focus = (options?: FocusOptions): void => {
      focusCalls.push(options);
      focus(options);
    };

    expect(focusInvalidControl(field)).toBe(true);
    expect(document.activeElement).toBe(bad);
    expect(focusCalls).toEqual([{ preventScroll: true }]);
  });

  test("leaves the focus where it is when there is nothing to fix there", () => {
    const button: HTMLButtonElement = document.createElement("button");
    document.body.appendChild(button);
    button.focus();

    expect(focusInvalidControl(fieldWith("<input />"))).toBe(false);
    expect(focusInvalidControl(null)).toBe(false);
    expect(document.activeElement).toBe(button);
  });
});
