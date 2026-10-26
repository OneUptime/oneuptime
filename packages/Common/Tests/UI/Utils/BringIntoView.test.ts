import bringIntoView, {
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
