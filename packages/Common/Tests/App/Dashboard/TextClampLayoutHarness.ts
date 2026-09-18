import { jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { act } from "react";

/*
 * A stand-in for the browser layout that DiscoveryScanStatusMessage measures.
 *
 * jsdom lays nothing out: every scrollHeight and clientHeight is 0, computed
 * styles carry no Tailwind, and there is no ResizeObserver. This harness gives
 * the message paragraph just enough of a layout to be measured the way a
 * browser measures it:
 *
 * - the text wraps into ceil(length / charactersPerLine) lines, so the column's
 *   width is a characters-per-line figure a test can change mid-test;
 * - scrollHeight is the whole text's height, clamped or not;
 * - clientHeight is the painted height, which `line-clamp-2` caps at two lines;
 * - getComputedStyle reports the line-height the test chose;
 * - ResizeObserver callbacks run when the test says the layout changed.
 *
 * Only the message paragraph is laid out — a <p> that carries an id, which is
 * what the toggle's aria-controls points at. Everything else keeps jsdom's
 * zeroes, so the rest of a rendered page behaves exactly as it did.
 *
 * The real-browser check of the same behaviour is E2E/Discovery.
 */

export const LINE_HEIGHT_IN_PIXELS: number = 20;

export interface TextClampLayoutOptions {
  charactersPerLine: number;
  // False leaves the page without a ResizeObserver, as jsdom has.
  withResizeObserver?: boolean | undefined;
}

export interface TextClampLayout {
  setCharactersPerLine: (count: number) => void;
  // The computed line-height, e.g. "20px" or "normal".
  setLineHeight: (value: string) => void;
  // A hidden element (display: none) has no size at all.
  setHidden: (isHidden: boolean) => void;
  // Runs every connected ResizeObserver, as the browser does after a reflow.
  resize: () => void;
  observedElements: () => Array<Element>;
  connectedObserverCount: () => number;
  createdObserverCount: () => number;
  restore: () => void;
}

export function isMeasuredMessage(element: Element): boolean {
  return element.tagName === "P" && element.id !== "";
}

export function installTextClampLayout(
  options: TextClampLayoutOptions,
): TextClampLayout {
  let charactersPerLine: number = options.charactersPerLine;
  let lineHeight: string = `${LINE_HEIGHT_IN_PIXELS}px`;
  let isHidden: boolean = false;

  const paintedLineHeight: () => number = (): number => {
    const parsed: number = Number.parseFloat(lineHeight);
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : LINE_HEIGHT_IN_PIXELS;
  };

  const lineCount: (element: Element) => number = (
    element: Element,
  ): number => {
    const length: number = (element.textContent || "").length;
    return length === 0 ? 0 : Math.ceil(length / charactersPerLine);
  };

  const scrollHeight: SpyInstance<() => number> = jest
    .spyOn(Element.prototype, "scrollHeight", "get")
    .mockImplementation(function (this: Element): number {
      if (!isMeasuredMessage(this) || isHidden) {
        return 0;
      }

      return Math.round(lineCount(this) * paintedLineHeight());
    });

  const clientHeight: SpyInstance<() => number> = jest
    .spyOn(Element.prototype, "clientHeight", "get")
    .mockImplementation(function (this: Element): number {
      if (!isMeasuredMessage(this) || isHidden) {
        return 0;
      }

      const lines: number = this.classList.contains("line-clamp-2")
        ? Math.min(lineCount(this), 2)
        : lineCount(this);

      return Math.round(lines * paintedLineHeight());
    });

  const originalGetComputedStyle: typeof window.getComputedStyle =
    window.getComputedStyle.bind(window);

  const getComputedStyle: SpyInstance<
    (element: Element, pseudoElement?: string | null) => CSSStyleDeclaration
  > = jest
    .spyOn(window, "getComputedStyle")
    .mockImplementation((element: Element, pseudoElement?: string | null) => {
      const style: CSSStyleDeclaration = originalGetComputedStyle(
        element,
        pseudoElement,
      );

      if (!isMeasuredMessage(element)) {
        return style;
      }

      return new Proxy(style, {
        get: (target: CSSStyleDeclaration, property: string | symbol) => {
          if (property === "lineHeight") {
            return lineHeight;
          }

          const value: unknown = Reflect.get(target, property);

          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    });

  interface ObserverRecord {
    instance: ResizeObserver;
    callback: ResizeObserverCallback;
    observed: Set<Element>;
    isConnected: boolean;
  }

  const records: Array<ObserverRecord> = [];

  class TestResizeObserver implements ResizeObserver {
    private record: ObserverRecord;

    public constructor(callback: ResizeObserverCallback) {
      this.record = {
        instance: this,
        callback: callback,
        observed: new Set<Element>(),
        isConnected: true,
      };
      records.push(this.record);
    }

    public observe(target: Element): void {
      this.record.observed.add(target);
    }

    public unobserve(target: Element): void {
      this.record.observed.delete(target);
    }

    public disconnect(): void {
      this.record.observed.clear();
      this.record.isConnected = false;
    }
  }

  const originalResizeObserver: PropertyDescriptor | undefined =
    Object.getOwnPropertyDescriptor(window, "ResizeObserver");

  if (options.withResizeObserver === false) {
    delete (window as unknown as { ResizeObserver?: unknown }).ResizeObserver;
  } else {
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: TestResizeObserver,
    });
  }

  const connected: () => Array<ObserverRecord> = (): Array<ObserverRecord> => {
    return records.filter((record: ObserverRecord): boolean => {
      return record.isConnected && record.observed.size > 0;
    });
  };

  return {
    setCharactersPerLine: (count: number): void => {
      charactersPerLine = count;
    },
    setLineHeight: (value: string): void => {
      lineHeight = value;
    },
    setHidden: (value: boolean): void => {
      isHidden = value;
    },
    resize: (): void => {
      act((): void => {
        for (const record of connected()) {
          record.callback([], record.instance);
        }
      });
    },
    observedElements: (): Array<Element> => {
      return connected().flatMap((record: ObserverRecord): Array<Element> => {
        return Array.from(record.observed);
      });
    },
    connectedObserverCount: (): number => {
      return connected().length;
    },
    createdObserverCount: (): number => {
      return records.length;
    },
    restore: (): void => {
      scrollHeight.mockRestore();
      clientHeight.mockRestore();
      getComputedStyle.mockRestore();

      if (originalResizeObserver) {
        Object.defineProperty(window, "ResizeObserver", originalResizeObserver);
      } else {
        delete (window as unknown as { ResizeObserver?: unknown })
          .ResizeObserver;
      }
    },
  };
}
