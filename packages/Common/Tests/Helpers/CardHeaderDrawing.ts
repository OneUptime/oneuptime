/*
 * jsdom lays nothing out: every box is 0 x 0, so a test cannot show Card
 * where a browser put a stacked or toolbar header's actions - beside the
 * title, or on a line of their own under it (Card reads it with
 * cardHeaderActionsAreUnderTitle). These helpers draw the two boxes it
 * reads, the title's block and the actions, as Chromium does at md and up:
 *
 *   - "beside": the actions on the title's line, the title centred on them
 *     (block 7-31px, actions 0-38px: CardHeaders.spec.ts measures the same);
 *   - "under": the title's block alone on the first line, the actions 8px
 *     under it (block 0-24px, actions 32-70px);
 *   - "undrawn": jsdom's own 0 x 0 boxes - a hidden card, or no layout.
 *
 * Every other element keeps jsdom's answer. installFakeResizeObservers puts
 * a ResizeObserver on window that a test fires by hand, as a browser does
 * when the window, the language or the controls change the header's size.
 */

export type CardHeaderPlacement = "beside" | "under" | "undrawn";

interface Span {
  top: number;
  height: number;
}

const SPANS: Record<
  Exclude<CardHeaderPlacement, "undrawn">,
  { titleBlock: Span; actions: Span }
> = {
  beside: {
    titleBlock: { top: 7, height: 24 },
    actions: { top: 0, height: 38 },
  },
  under: {
    titleBlock: { top: 0, height: 24 },
    actions: { top: 32, height: 38 },
  },
};

function rectOf(span: Span): DOMRect {
  return {
    x: 0,
    y: span.top,
    top: span.top,
    bottom: span.top + span.height,
    left: 0,
    right: 600,
    width: 600,
    height: span.height,
    toJSON: (): Record<string, unknown> => {
      return {};
    },
  } as DOMRect;
}

export interface DrawnCardHeaders {
  // Draws every card header this way from now on (a resize, say).
  setPlacement: (placement: CardHeaderPlacement) => void;
  // Puts jsdom's own getBoundingClientRect back.
  restore: () => void;
}

export function drawCardHeaders(
  placement: CardHeaderPlacement,
): DrawnCardHeaders {
  const original: () => DOMRect = Element.prototype.getBoundingClientRect;
  let current: CardHeaderPlacement = placement;

  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    const testId: string | null = this.getAttribute("data-testid");

    if (current !== "undrawn") {
      if (testId === "card-header-title-block") {
        return rectOf(SPANS[current].titleBlock);
      }
      if (testId === "card-header-actions") {
        return rectOf(SPANS[current].actions);
      }
    }

    return original.call(this);
  };

  return {
    setPlacement: (next: CardHeaderPlacement): void => {
      current = next;
    },
    restore: (): void => {
      Element.prototype.getBoundingClientRect = original;
    },
  };
}

export interface FakeResizeObservers {
  // The elements every observer that is still connected watches.
  observed: () => Array<Element>;
  // How many observers were made, connected or not.
  made: () => number;
  // Calls every connected observer back, as a browser does after a resize.
  resize: () => void;
  restore: () => void;
}

export function installFakeResizeObservers(): FakeResizeObservers {
  const original: PropertyDescriptor | undefined =
    Object.getOwnPropertyDescriptor(window, "ResizeObserver");

  interface Watcher {
    observer: ResizeObserver;
    callback: ResizeObserverCallback;
    targets: Array<Element>;
    isConnected: boolean;
  }

  const watchers: Array<Watcher> = [];

  class TestResizeObserver implements ResizeObserver {
    private watcher: Watcher;

    public constructor(callback: ResizeObserverCallback) {
      this.watcher = {
        observer: this,
        callback: callback,
        targets: [],
        isConnected: true,
      };
      watchers.push(this.watcher);
    }

    public observe(target: Element): void {
      this.watcher.targets.push(target);
    }

    public unobserve(target: Element): void {
      this.watcher.targets = this.watcher.targets.filter(
        (watched: Element): boolean => {
          return watched !== target;
        },
      );
    }

    public disconnect(): void {
      this.watcher.isConnected = false;
      this.watcher.targets = [];
    }
  }

  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: TestResizeObserver,
  });

  const connected: () => Array<Watcher> = (): Array<Watcher> => {
    return watchers.filter((watcher: Watcher): boolean => {
      return watcher.isConnected;
    });
  };

  return {
    observed: (): Array<Element> => {
      return connected().flatMap((watcher: Watcher): Array<Element> => {
        return watcher.targets;
      });
    },
    made: (): number => {
      return watchers.length;
    },
    resize: (): void => {
      for (const watcher of connected()) {
        watcher.callback([], watcher.observer);
      }
    },
    restore: (): void => {
      if (original) {
        Object.defineProperty(window, "ResizeObserver", original);
      } else {
        delete (window as unknown as Record<string, unknown>)[
          "ResizeObserver"
        ];
      }
    },
  };
}
