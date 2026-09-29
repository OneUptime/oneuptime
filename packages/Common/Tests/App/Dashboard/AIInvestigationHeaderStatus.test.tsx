import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SpyInstance } from "jest-mock";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import AIInvestigationHeaderStatus, {
  AI_INVESTIGATION_READY_ANNOUNCEMENT,
  AI_INVESTIGATION_VERDICT_BADGES,
  AIInvestigationStatusLiveRegion,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AIInvestigationHeaderStatus";
import {
  AI_INVESTIGATION_PANEL_ID,
  getAIInvestigationVerdict,
  hasAIInvestigationSummary,
  isActiveAIInvestigationStatus,
  isCompletedAIInvestigationWithSummary,
  scrollToAIInvestigationPanel,
  shouldShowAIInvestigationHeaderStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AIInvestigationStatus";
import AIRunHumanVerdict from "../../../Types/AI/AIRunHumanVerdict";
import AIRunStatus from "../../../Types/AI/AIRunStatus";

const ACTIVE_STATUSES: Array<AIRunStatus> = [
  AIRunStatus.Queued,
  AIRunStatus.Running,
];

const INACTIVE_STATUSES: Array<AIRunStatus> = Object.values(AIRunStatus).filter(
  (status: AIRunStatus) => {
    return !ACTIVE_STATUSES.includes(status);
  },
);

type SetReducedMotionFunction = (matches: boolean) => void;

const setReducedMotion: SetReducedMotionFunction = (matches: boolean): void => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: jest.fn().mockReturnValue({ matches: matches }),
  });
};

afterEach(() => {
  cleanup();
  document.getElementById(AI_INVESTIGATION_PANEL_ID)?.remove();
});

beforeEach(() => {
  setReducedMotion(false);
});

describe("AIInvestigationHeaderStatus", () => {
  test.each(Object.values(AIRunStatus))(
    "classifies %s without leaving a new status unaccounted for",
    (status: AIRunStatus) => {
      expect(isActiveAIInvestigationStatus(status)).toBe(
        ACTIVE_STATUSES.includes(status),
      );
    },
  );

  test("treats a missing status as inactive", () => {
    expect(isActiveAIInvestigationStatus(null)).toBe(false);
    expect(isActiveAIInvestigationStatus(undefined)).toBe(false);
  });

  test("makes a running investigation obvious", () => {
    render(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Running}
        onViewProgress={() => {}}
      />,
    );

    expect(screen.getByText("AI is investigating")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Reviewing telemetry and tracing the likely root cause.",
      ),
    ).toBeInTheDocument();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  test("uses honest queued copy before investigation work has begun", () => {
    render(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Queued}
        onViewProgress={() => {}}
      />,
    );

    expect(screen.getByText("AI investigation queued")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Waiting for an AI worker. Telemetry review will begin automatically.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("AI is investigating")).not.toBeInTheDocument();
  });

  test("only animates when AI is actively investigating", () => {
    const { container, rerender } = render(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Running}
        onViewProgress={() => {}}
      />,
    );

    expect(container.innerHTML).toContain("motion-safe:animate-ping");
    expect(container.innerHTML).not.toContain(" animate-ping ");

    rerender(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Queued}
        onViewProgress={() => {}}
      />,
    );

    expect(container.innerHTML).not.toContain("motion-safe:animate-ping");
  });

  test.each(INACTIVE_STATUSES)(
    "renders no stale header notice for %s",
    (status: AIRunStatus) => {
      const { container } = render(
        <AIInvestigationHeaderStatus
          status={status}
          onViewProgress={() => {}}
        />,
      );

      expect(container).toBeEmptyDOMElement();
    },
  );

  test("exposes a native progress button tied to the full investigation panel", async () => {
    const onViewProgress: MockFunction = getJestMockFunction();
    render(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Running}
        onViewProgress={onViewProgress}
      />,
    );

    const button: HTMLButtonElement = screen.getByRole("button", {
      name: "View live AI investigation progress",
    });

    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-controls", AI_INVESTIGATION_PANEL_ID);

    await userEvent.click(button);
    button.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");

    expect(onViewProgress).toHaveBeenCalledTimes(3);
  });
});

const SUMMARY: string =
  "Connection pool exhaustion on checkout-db after the 18:00 deploy doubled worker concurrency.";

const NON_COMPLETED_INACTIVE_STATUSES: Array<AIRunStatus> =
  INACTIVE_STATUSES.filter((status: AIRunStatus) => {
    return status !== AIRunStatus.Completed;
  });

describe("shouldShowAIInvestigationHeaderStatus", () => {
  test.each(ACTIVE_STATUSES)(
    "shows %s with or without a summary",
    (status: AIRunStatus) => {
      expect(shouldShowAIInvestigationHeaderStatus(status)).toBe(true);
      expect(shouldShowAIInvestigationHeaderStatus(status, null)).toBe(true);
      expect(shouldShowAIInvestigationHeaderStatus(status, SUMMARY)).toBe(true);
    },
  );

  test("shows a completed run only when it left a summary", () => {
    expect(
      shouldShowAIInvestigationHeaderStatus(AIRunStatus.Completed, SUMMARY),
    ).toBe(true);
    expect(
      shouldShowAIInvestigationHeaderStatus(AIRunStatus.Completed, undefined),
    ).toBe(false);
    expect(
      shouldShowAIInvestigationHeaderStatus(AIRunStatus.Completed, null),
    ).toBe(false);
    expect(
      shouldShowAIInvestigationHeaderStatus(AIRunStatus.Completed, ""),
    ).toBe(false);
    expect(
      shouldShowAIInvestigationHeaderStatus(AIRunStatus.Completed, "  \n\t "),
    ).toBe(false);
  });

  test.each(NON_COMPLETED_INACTIVE_STATUSES)(
    "never shows %s, even with a leftover summary",
    (status: AIRunStatus) => {
      expect(shouldShowAIInvestigationHeaderStatus(status, SUMMARY)).toBe(
        false,
      );
    },
  );

  test("never shows without a status", () => {
    expect(shouldShowAIInvestigationHeaderStatus(null, SUMMARY)).toBe(false);
    expect(shouldShowAIInvestigationHeaderStatus(undefined, SUMMARY)).toBe(
      false,
    );
  });

  test("classifies summaries and completed-with-summary runs", () => {
    expect(hasAIInvestigationSummary(SUMMARY)).toBe(true);
    expect(hasAIInvestigationSummary(" x ")).toBe(true);
    expect(hasAIInvestigationSummary("   ")).toBe(false);
    expect(hasAIInvestigationSummary(null)).toBe(false);
    expect(hasAIInvestigationSummary(undefined)).toBe(false);
    expect(hasAIInvestigationSummary(42 as unknown as string)).toBe(false);

    expect(
      isCompletedAIInvestigationWithSummary(AIRunStatus.Completed, SUMMARY),
    ).toBe(true);
    expect(
      isCompletedAIInvestigationWithSummary(AIRunStatus.Running, SUMMARY),
    ).toBe(false);
    expect(
      isCompletedAIInvestigationWithSummary(AIRunStatus.Completed, " "),
    ).toBe(false);
  });
});

describe("AIInvestigationHeaderStatus completed summary", () => {
  test("shows the summary under an AI root cause heading", () => {
    render(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Completed}
        summary={SUMMARY}
        onViewProgress={() => {}}
      />,
    );

    const eyebrow: HTMLElement = screen.getByRole("heading", {
      level: 3,
      name: "AI root cause analysis",
    });
    const summary: HTMLElement = screen.getByText(SUMMARY);

    expect(eyebrow).toHaveClass(
      "text-xs",
      "font-semibold",
      "uppercase",
      "tracking-wider",
      "text-indigo-600",
    );
    // Three lines at a readable measure; Show more has the rest.
    expect(summary).toHaveClass("line-clamp-3", "max-w-4xl", "text-sm");
    // The whole summary is reachable on the page, so no hover-only copy.
    expect(summary).not.toHaveAttribute("title");
    expect(
      eyebrow.compareDocumentPosition(summary) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("uses the compact indigo notice with a Sparkles badge and no live animation", () => {
    const { container } = render(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Completed}
        summary={SUMMARY}
        onViewProgress={() => {}}
      />,
    );

    const notice: HTMLElement = container.firstElementChild as HTMLElement;

    expect(notice).toHaveClass("rounded-lg", "border", "border-indigo-100");
    expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
    expect(container.innerHTML).not.toContain("animate-ping");
    expect(screen.queryByText("AI is investigating")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "View live AI investigation progress",
      }),
    ).not.toBeInTheDocument();
  });

  test("offers a native View full report button tied to the investigation panel", async () => {
    const onViewProgress: MockFunction = getJestMockFunction();
    render(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Completed}
        summary={SUMMARY}
        onViewProgress={onViewProgress}
      />,
    );

    const button: HTMLButtonElement = screen.getByRole("button", {
      name: "View full report",
    });

    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-controls", AI_INVESTIGATION_PANEL_ID);

    await userEvent.click(button);
    button.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");

    expect(onViewProgress).toHaveBeenCalledTimes(3);
  });

  test("renders a hostile summary as inert text", () => {
    const hostile: string =
      '<img src=x onerror="alert(1)"> **bold** [link](https://evil.example) <a href="https://evil.example">x</a>';

    const { container } = render(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Completed}
        summary={hostile}
        onViewProgress={() => {}}
      />,
    );

    expect(screen.getByText(hostile)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
  });

  test("trims surrounding whitespace from the summary", () => {
    render(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Completed}
        summary={`  \n${SUMMARY}\n  `}
        onViewProgress={() => {}}
      />,
    );

    // getByText ignores surrounding whitespace, so read the raw text.
    expect(screen.getByText(SUMMARY).textContent).toBe(SUMMARY);
  });

  test.each([null, undefined, "", "   "])(
    "renders nothing for a completed run with summary %p",
    (summary: string | null | undefined) => {
      const { container } = render(
        <AIInvestigationHeaderStatus
          status={AIRunStatus.Completed}
          summary={summary}
          onViewProgress={() => {}}
        />,
      );

      expect(container).toBeEmptyDOMElement();
    },
  );

  test.each(NON_COMPLETED_INACTIVE_STATUSES)(
    "ignores a leftover summary for %s",
    (status: AIRunStatus) => {
      const { container } = render(
        <AIInvestigationHeaderStatus
          status={status}
          summary={SUMMARY}
          onViewProgress={() => {}}
        />,
      );

      expect(container).toBeEmptyDOMElement();
    },
  );

  test.each(ACTIVE_STATUSES)(
    "keeps the live %s notice while a new run is in flight, even with an old summary",
    (status: AIRunStatus) => {
      render(
        <AIInvestigationHeaderStatus
          status={status}
          summary={SUMMARY}
          onViewProgress={() => {}}
        />,
      );

      expect(screen.queryByText(SUMMARY)).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "View full report" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", {
          name: "View live AI investigation progress",
        }),
      ).toBeInTheDocument();
    },
  );

  test("switches between live progress and the summary as the run finishes", () => {
    const { rerender } = render(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Running}
        summary={null}
        onViewProgress={() => {}}
      />,
    );

    expect(screen.getByText("AI is investigating")).toBeInTheDocument();

    rerender(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Completed}
        summary={SUMMARY}
        onViewProgress={() => {}}
      />,
    );

    expect(screen.queryByText("AI is investigating")).not.toBeInTheDocument();
    expect(screen.getByText(SUMMARY)).toBeInTheDocument();
  });

  test("keeps the layout safe on narrow screens", () => {
    render(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Completed}
        summary={SUMMARY}
        onViewProgress={() => {}}
      />,
    );

    const summary: HTMLElement = screen.getByText(SUMMARY);
    const grid: HTMLElement = summary.parentElement as HTMLElement;
    const heading: HTMLElement = screen.getByRole("heading", {
      name: "AI root cause analysis",
    });
    const headingGroup: HTMLElement = heading.parentElement as HTMLElement;
    const header: HTMLElement = headingGroup.parentElement as HTMLElement;
    const viewReport: HTMLElement = screen.getByRole("button", {
      name: "View full report",
    });

    // The text column may shrink below its content; long tokens wrap.
    expect(grid).toHaveClass("grid", "grid-cols-[minmax(0,1fr)_auto]");
    expect(header.parentElement).toBe(grid);
    expect(summary).toHaveClass("col-span-2", "break-words");
    /*
     * Below lg (a phone, or a tablet's column beside the side menu) the label
     * has the row to itself; from lg up it shares it with the button.
     */
    expect(header).toHaveClass(
      "min-w-0",
      "col-span-2",
      "lg:col-span-1",
      "flex-wrap",
    );
    expect(header.className).not.toMatch(/(^|\s)(sm|md):col-span-1/);
    // The icon and the label never wrap apart, whatever wraps beside them.
    expect(headingGroup).toHaveClass("flex", "min-w-0");
    expect(headingGroup).not.toHaveClass("flex-wrap");
    expect(heading).toHaveClass("truncate");
    // Below lg the button drops to the bottom row, beside Show more.
    expect(viewReport).toHaveClass(
      "row-start-3",
      "lg:row-start-1",
      "whitespace-nowrap",
    );
    expect(viewReport.className).not.toMatch(/(^|\s)(sm|md):row-start-1/);
    /*
     * Aligned to the top of its row, so it stays level with the label's
     * line when a verdict badge wraps below it.
     */
    expect(viewReport).toHaveClass("self-start", "-my-0.5");
    // The paragraphs hold only text: Icon renders a <div>, never inside a <p>.
    expect(summary.querySelector("div")).toBeNull();
    expect(heading.querySelector("div")).toBeNull();
  });

  test("reads as heading, report button, then summary", () => {
    const { container } = render(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Completed}
        summary={SUMMARY}
        onViewProgress={() => {}}
      />,
    );

    const heading: HTMLElement = screen.getByRole("heading", {
      name: "AI root cause analysis",
    });
    const viewReport: HTMLElement = screen.getByRole("button", {
      name: "View full report",
    });
    const summary: HTMLElement = screen.getByText(SUMMARY);

    expect(
      heading.compareDocumentPosition(viewReport) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      viewReport.compareDocumentPosition(summary) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The only control while the summary fits is the report button.
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });
});

/*
 * jsdom does no layout: every element is 0px tall, so the clamp never looks
 * like it hides anything. These tests give the summary paragraph a height
 * that depends on whether it carries line-clamp-3, which is what the
 * browser does.
 */
const CLAMPED_HEIGHT: number = 72;

interface SummaryLayout {
  // The paragraph's full height with no clamp.
  setFullHeight: (height: number) => void;
  restore: () => void;
}

function installSummaryLayout(fullHeight: number): SummaryLayout {
  let currentFullHeight: number = fullHeight;

  const isSummary: (element: Element) => boolean = (
    element: Element,
  ): boolean => {
    return element.tagName === "P" && element.classList.contains("text-sm");
  };

  const scrollHeight: SpyInstance<() => number> = jest
    .spyOn(Element.prototype, "scrollHeight", "get")
    .mockImplementation(function (this: Element): number {
      return isSummary(this) ? currentFullHeight : 0;
    });
  const clientHeight: SpyInstance<() => number> = jest
    .spyOn(Element.prototype, "clientHeight", "get")
    .mockImplementation(function (this: Element): number {
      if (!isSummary(this)) {
        return 0;
      }

      return this.classList.contains("line-clamp-3")
        ? Math.min(currentFullHeight, CLAMPED_HEIGHT)
        : currentFullHeight;
    });

  return {
    setFullHeight: (height: number): void => {
      currentFullHeight = height;
    },
    restore: (): void => {
      scrollHeight.mockRestore();
      clientHeight.mockRestore();
    },
  };
}

/*
 * A ResizeObserver whose callbacks a test fires by hand. Like the real one,
 * a disconnected observer is never called again.
 */
interface FakeResizeObserver {
  observed: Array<Element>;
  disconnectCount: () => number;
  trigger: () => void;
  restore: () => void;
}

function installResizeObserver(): FakeResizeObserver {
  const original: PropertyDescriptor | undefined =
    Object.getOwnPropertyDescriptor(window, "ResizeObserver");
  const observed: Array<Element> = [];
  const callbacks: Array<ResizeObserverCallback> = [];
  const instances: Array<ResizeObserver> = [];
  const disconnected: Set<ResizeObserver> = new Set<ResizeObserver>();

  class TestResizeObserver implements ResizeObserver {
    public constructor(callback: ResizeObserverCallback) {
      callbacks.push(callback);
      instances.push(this);
    }
    public observe(target: Element): void {
      observed.push(target);
    }
    public unobserve(): void {
      return;
    }
    public disconnect(): void {
      disconnected.add(this);
    }
  }

  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: TestResizeObserver,
  });

  return {
    observed: observed,
    disconnectCount: (): number => {
      return disconnected.size;
    },
    trigger: (): void => {
      act((): void => {
        for (let index: number = 0; index < callbacks.length; index++) {
          const instance: ResizeObserver = instances[index] as ResizeObserver;

          if (!disconnected.has(instance)) {
            callbacks[index]?.([], instance);
          }
        }
      });
    },
    restore: (): void => {
      if (original) {
        Object.defineProperty(window, "ResizeObserver", original);
      } else {
        delete (window as unknown as { ResizeObserver?: unknown })
          .ResizeObserver;
      }
    },
  };
}

describe("AIInvestigationHeaderStatus Show more", () => {
  let layout: SummaryLayout | null = null;
  let resizeObserver: FakeResizeObserver | null = null;

  afterEach(() => {
    layout?.restore();
    layout = null;
    resizeObserver?.restore();
    resizeObserver = null;
  });

  test("offers no toggle when the summary fits in three lines", () => {
    layout = installSummaryLayout(48);

    render(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Completed}
        summary={SUMMARY}
        onViewProgress={() => {}}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /Show (more|less)/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(SUMMARY)).toHaveClass("line-clamp-3");
  });

  test("expands and collapses a summary the clamp cuts short", async () => {
    layout = installSummaryLayout(168);

    render(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Completed}
        summary={SUMMARY}
        onViewProgress={() => {}}
      />,
    );

    const summary: HTMLElement = screen.getByText(SUMMARY);
    const toggle: HTMLElement = screen.getByRole("button", {
      name: "Show more",
    });

    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", summary.id);
    expect(summary.id).not.toBe("");
    expect(summary).toHaveClass("line-clamp-3");
    // Placed beside View full report on a phone, under the summary above.
    expect(toggle).toHaveClass("col-start-1", "row-start-3");
    expect(
      summary.compareDocumentPosition(toggle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await userEvent.click(toggle);

    // The same button, so keyboard focus stays where the reader left it.
    expect(toggle).toHaveTextContent("Show less");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(summary).not.toHaveClass("line-clamp-3");

    toggle.focus();
    await userEvent.keyboard("{Enter}");

    expect(toggle).toHaveTextContent("Show more");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(summary).toHaveClass("line-clamp-3");
    expect(toggle).toHaveFocus();
  });

  test("never calls the report handler from the toggle", async () => {
    layout = installSummaryLayout(168);
    const onViewProgress: MockFunction = getJestMockFunction();

    render(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Completed}
        summary={SUMMARY}
        onViewProgress={onViewProgress}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    await userEvent.click(screen.getByRole("button", { name: "Show less" }));

    expect(onViewProgress).not.toHaveBeenCalled();
  });

  test("starts a new summary collapsed", async () => {
    layout = installSummaryLayout(168);

    const { rerender } = render(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Completed}
        summary={SUMMARY}
        onViewProgress={() => {}}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText(SUMMARY)).not.toHaveClass("line-clamp-3");

    const nextSummary: string =
      "A config reload cut the ledger client timeout from 5s to 1s, so slow ledger writes failed.";

    rerender(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Completed}
        summary={nextSummary}
        onViewProgress={() => {}}
      />,
    );

    expect(screen.getByText(nextSummary)).toHaveClass("line-clamp-3");
    expect(screen.getByRole("button", { name: "Show more" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("drops the toggle when a new summary fits", () => {
    layout = installSummaryLayout(168);

    const { rerender } = render(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Completed}
        summary={SUMMARY}
        onViewProgress={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Show more" }),
    ).toBeInTheDocument();

    layout.setFullHeight(24);
    rerender(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Completed}
        summary="Short TL;DR."
        onViewProgress={() => {}}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /Show (more|less)/ }),
    ).not.toBeInTheDocument();
  });

  test("re-measures when the notice is resized", () => {
    layout = installSummaryLayout(48);
    resizeObserver = installResizeObserver();

    const { unmount } = render(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Completed}
        summary={SUMMARY}
        onViewProgress={() => {}}
      />,
    );

    expect(resizeObserver.observed).toEqual([screen.getByText(SUMMARY)]);
    expect(
      screen.queryByRole("button", { name: "Show more" }),
    ).not.toBeInTheDocument();

    // The window narrowed: the same summary now needs seven lines.
    layout.setFullHeight(168);
    resizeObserver.trigger();

    expect(
      screen.getByRole("button", { name: "Show more" }),
    ).toBeInTheDocument();

    // And widened again.
    layout.setFullHeight(48);
    resizeObserver.trigger();

    expect(
      screen.queryByRole("button", { name: "Show more" }),
    ).not.toBeInTheDocument();

    const disconnectsBeforeUnmount: number = resizeObserver.disconnectCount();
    unmount();
    expect(resizeObserver.disconnectCount()).toBe(disconnectsBeforeUnmount + 1);
  });

  test("stops observing while expanded and keeps Show less", async () => {
    layout = installSummaryLayout(168);
    resizeObserver = installResizeObserver();

    render(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Completed}
        summary={SUMMARY}
        onViewProgress={() => {}}
      />,
    );

    const disconnectsBeforeExpanding: number = resizeObserver.disconnectCount();

    await userEvent.click(screen.getByRole("button", { name: "Show more" }));

    expect(resizeObserver.disconnectCount()).toBe(
      disconnectsBeforeExpanding + 1,
    );
    /*
     * Expanded, the paragraph is as tall as its text, which is no reason to
     * take the only way back to the short form away.
     */
    resizeObserver.trigger();
    expect(
      screen.getByRole("button", { name: "Show less" }),
    ).toBeInTheDocument();
  });

  test("falls back to window resize events without ResizeObserver", () => {
    expect("ResizeObserver" in window).toBe(false);
    layout = installSummaryLayout(48);
    const removeEventListener: SpyInstance<typeof window.removeEventListener> =
      jest.spyOn(window, "removeEventListener");

    const { unmount } = render(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Completed}
        summary={SUMMARY}
        onViewProgress={() => {}}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Show more" }),
    ).not.toBeInTheDocument();

    layout.setFullHeight(168);
    act((): void => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(
      screen.getByRole("button", { name: "Show more" }),
    ).toBeInTheDocument();

    unmount();
    expect(removeEventListener).toHaveBeenCalledWith(
      "resize",
      expect.any(Function),
    );
    removeEventListener.mockRestore();
  });
});

/*
 * A responder's Confirmed / Rejected verdict, lifted from the panel. Other
 * responders read the header first, so a report someone has ruled out must
 * say so there instead of standing as the root cause.
 */
describe("AIInvestigationHeaderStatus verdict", () => {
  type RenderNoticeFunction = (options: {
    verdict: AIRunHumanVerdict | null | undefined;
    status?: AIRunStatus | undefined;
    summary?: string | null | undefined;
  }) => ReturnType<typeof render>;

  const renderNotice: RenderNoticeFunction = (options: {
    verdict: AIRunHumanVerdict | null | undefined;
    status?: AIRunStatus | undefined;
    summary?: string | null | undefined;
  }): ReturnType<typeof render> => {
    return render(
      <AIInvestigationHeaderStatus
        status={options.status || AIRunStatus.Completed}
        summary={options.summary === undefined ? SUMMARY : options.summary}
        verdict={options.verdict}
        onViewProgress={() => {}}
      />,
    );
  };

  test.each([null, undefined])(
    "shows no badge while the verdict is %p",
    (verdict: null | undefined) => {
      renderNotice({ verdict });

      expect(screen.queryByText(/by a responder/)).not.toBeInTheDocument();
      expect(screen.getByText(SUMMARY)).toHaveClass("text-gray-900");
      expect(screen.getByText(SUMMARY)).not.toHaveClass("text-gray-600");
    },
  );

  test("marks a confirmed report and leaves it at full strength", () => {
    renderNotice({ verdict: AIRunHumanVerdict.Confirmed });

    const badge: HTMLElement = screen.getByText("Confirmed by a responder");

    expect(badge).toHaveAttribute("data-verdict", AIRunHumanVerdict.Confirmed);
    expect(badge).toHaveClass(
      "rounded-full",
      "bg-green-50",
      "text-green-700",
      "ring-green-200",
    );
    expect(badge.querySelector("svg")).not.toBeNull();
    expect(screen.getByText(SUMMARY)).toHaveClass("text-gray-900");
    expect(screen.getByText(SUMMARY)).not.toHaveClass("text-gray-600");
  });

  test("marks a rejected report and mutes its summary", () => {
    renderNotice({ verdict: AIRunHumanVerdict.Rejected });

    const badge: HTMLElement = screen.getByText("Rejected by a responder");

    expect(badge).toHaveAttribute("data-verdict", AIRunHumanVerdict.Rejected);
    expect(badge).toHaveClass(
      "rounded-full",
      "bg-rose-50",
      "text-rose-700",
      "ring-rose-200",
    );
    expect(badge.querySelector("svg")).not.toBeNull();
    // Still readable, no longer presented as the established root cause.
    expect(screen.getByText(SUMMARY)).toHaveClass("text-gray-600");
    expect(screen.getByText(SUMMARY)).not.toHaveClass("text-gray-900");
    expect(
      screen.getByRole("button", { name: "View full report" }),
    ).toBeInTheDocument();
  });

  test("sits beside the heading, outside it, before the report button", () => {
    renderNotice({ verdict: AIRunHumanVerdict.Rejected });

    const heading: HTMLElement = screen.getByRole("heading", {
      level: 3,
      name: "AI root cause analysis",
    });
    const badge: HTMLElement = screen.getByText("Rejected by a responder");
    const viewReport: HTMLElement = screen.getByRole("button", {
      name: "View full report",
    });
    const summary: HTMLElement = screen.getByText(SUMMARY);

    // The heading keeps its own name; the badge is its sibling group.
    expect(heading).not.toContainElement(badge);
    expect(badge.parentElement).toBe(heading.parentElement!.parentElement);
    // It never breaks inside itself; the header row wraps around it instead.
    expect(badge).toHaveClass("whitespace-nowrap");
    expect(badge.parentElement).toHaveClass("flex-wrap");

    const following: (earlier: HTMLElement, later: HTMLElement) => boolean = (
      earlier: HTMLElement,
      later: HTMLElement,
    ): boolean => {
      return Boolean(
        earlier.compareDocumentPosition(later) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      );
    };

    expect(following(heading, badge)).toBe(true);
    expect(following(badge, viewReport)).toBe(true);
    expect(following(viewReport, summary)).toBe(true);
  });

  test("follows the verdict as responders change it", () => {
    const { rerender } = renderNotice({ verdict: null });

    const renderWith: (verdict: AIRunHumanVerdict | null) => void = (
      verdict: AIRunHumanVerdict | null,
    ): void => {
      rerender(
        <AIInvestigationHeaderStatus
          status={AIRunStatus.Completed}
          summary={SUMMARY}
          verdict={verdict}
          onViewProgress={() => {}}
        />,
      );
    };

    renderWith(AIRunHumanVerdict.Confirmed);
    expect(screen.getByText("Confirmed by a responder")).toBeInTheDocument();
    expect(screen.getByText(SUMMARY)).toHaveClass("text-gray-900");

    renderWith(AIRunHumanVerdict.Rejected);
    expect(
      screen.queryByText("Confirmed by a responder"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Rejected by a responder")).toBeInTheDocument();
    expect(screen.getByText(SUMMARY)).toHaveClass("text-gray-600");

    renderWith(null);
    expect(screen.queryByText(/by a responder/)).not.toBeInTheDocument();
    expect(screen.getByText(SUMMARY)).toHaveClass("text-gray-900");
  });

  test.each(ACTIVE_STATUSES)(
    "keeps the live %s notice free of an earlier report's verdict",
    (status: AIRunStatus) => {
      renderNotice({ status, verdict: AIRunHumanVerdict.Rejected });

      expect(screen.queryByText(/by a responder/)).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", {
          name: "View live AI investigation progress",
        }),
      ).toBeInTheDocument();
    },
  );

  test.each(Object.values(AIRunHumanVerdict))(
    "shows nothing for a %s verdict without a summary",
    (verdict: AIRunHumanVerdict) => {
      const { container } = renderNotice({ verdict, summary: null });

      expect(container).toBeEmptyDOMElement();
    },
  );

  test("shows no badge for a verdict it cannot name", () => {
    renderNotice({ verdict: "Edited" as unknown as AIRunHumanVerdict });

    expect(screen.queryByText(/by a responder/)).not.toBeInTheDocument();
    expect(screen.getByText(SUMMARY)).toHaveClass("text-gray-900");
  });

  test.each(Object.values(AIRunHumanVerdict))(
    "has badge copy for the %s verdict",
    (verdict: AIRunHumanVerdict) => {
      const badge: { text: string; className: string } =
        AI_INVESTIGATION_VERDICT_BADGES[verdict];

      expect(badge.text).toBe(`${verdict} by a responder`);
      expect(badge.className).toMatch(/^bg-\w+-50 text-\w+-700 ring-\w+-200$/);
    },
  );
});

describe("getAIInvestigationVerdict", () => {
  test.each(Object.values(AIRunHumanVerdict))(
    "reads %s",
    (verdict: AIRunHumanVerdict) => {
      expect(getAIInvestigationVerdict(verdict)).toBe(verdict);
      expect(getAIInvestigationVerdict(`${verdict}`)).toBe(verdict);
    },
  );

  test.each([null, undefined, "", "confirmed", "REJECTED", "Edited", 1, {}])(
    "reads %p as no verdict",
    (value: unknown) => {
      expect(getAIInvestigationVerdict(value)).toBeNull();
    },
  );
});

describe("AIInvestigationStatusLiveRegion", () => {
  test("stays mounted and announces active status transitions without the CTA", () => {
    const { rerender } = render(
      <AIInvestigationStatusLiveRegion status={null} />,
    );
    const liveStatus: HTMLElement = screen.getByRole("status");

    expect(liveStatus).toHaveAttribute("aria-live", "polite");
    expect(liveStatus).toHaveAttribute("aria-atomic", "true");
    expect(liveStatus).toHaveClass("sr-only");
    expect(liveStatus).toBeEmptyDOMElement();

    rerender(<AIInvestigationStatusLiveRegion status={AIRunStatus.Queued} />);
    expect(liveStatus).toHaveTextContent(
      "AI investigation queued. Waiting for an AI worker. Telemetry review will begin automatically.",
    );
    expect(liveStatus).not.toHaveTextContent("View live progress");

    rerender(<AIInvestigationStatusLiveRegion status={AIRunStatus.Running} />);
    expect(liveStatus).toHaveTextContent(
      "AI is investigating. Reviewing telemetry and tracing the likely root cause.",
    );

    rerender(
      <AIInvestigationStatusLiveRegion status={AIRunStatus.Completed} />,
    );
    expect(liveStatus).toBeEmptyDOMElement();
  });

  test("announces a completed report once its summary is available", () => {
    const { rerender } = render(
      <AIInvestigationStatusLiveRegion status={AIRunStatus.Running} />,
    );
    const liveStatus: HTMLElement = screen.getByRole("status");

    rerender(
      <AIInvestigationStatusLiveRegion
        status={AIRunStatus.Completed}
        summary={null}
      />,
    );
    expect(liveStatus).toBeEmptyDOMElement();

    rerender(
      <AIInvestigationStatusLiveRegion
        status={AIRunStatus.Completed}
        summary={SUMMARY}
      />,
    );
    expect(liveStatus).toHaveTextContent("AI root cause analysis ready.");
    expect(AI_INVESTIGATION_READY_ANNOUNCEMENT).toBe(
      "AI root cause analysis ready.",
    );
    // The model-authored summary itself is never read out.
    expect(liveStatus).not.toHaveTextContent(SUMMARY);
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  test("does not re-announce when the summary changes or briefly drops out", () => {
    const { rerender } = render(
      <AIInvestigationStatusLiveRegion
        status={AIRunStatus.Completed}
        summary={SUMMARY}
      />,
    );
    const liveStatus: HTMLElement = screen.getByRole("status");
    const textNodeBefore: ChildNode | null = liveStatus.firstChild;

    expect(liveStatus).toHaveTextContent(AI_INVESTIGATION_READY_ANNOUNCEMENT);

    rerender(
      <AIInvestigationStatusLiveRegion
        status={AIRunStatus.Completed}
        summary="A shorter TL;DR replaced the summary."
      />,
    );
    expect(liveStatus).toHaveTextContent(AI_INVESTIGATION_READY_ANNOUNCEMENT);

    rerender(
      <AIInvestigationStatusLiveRegion
        status={AIRunStatus.Completed}
        summary={null}
      />,
    );
    expect(liveStatus).toHaveTextContent(AI_INVESTIGATION_READY_ANNOUNCEMENT);

    rerender(
      <AIInvestigationStatusLiveRegion
        status={AIRunStatus.Completed}
        summary={SUMMARY}
      />,
    );
    expect(liveStatus).toHaveTextContent(AI_INVESTIGATION_READY_ANNOUNCEMENT);
    // Same text node the whole time: nothing new for a screen reader to say.
    expect(liveStatus.firstChild).toBe(textNodeBefore);
  });

  test("announces the next report after a new run", () => {
    const { rerender } = render(
      <AIInvestigationStatusLiveRegion
        status={AIRunStatus.Completed}
        summary={SUMMARY}
      />,
    );
    const liveStatus: HTMLElement = screen.getByRole("status");

    rerender(
      <AIInvestigationStatusLiveRegion
        status={AIRunStatus.Queued}
        summary={SUMMARY}
      />,
    );
    expect(liveStatus).toHaveTextContent(/^AI investigation queued\./);

    rerender(
      <AIInvestigationStatusLiveRegion
        status={AIRunStatus.Completed}
        summary={null}
      />,
    );
    expect(liveStatus).toBeEmptyDOMElement();

    rerender(
      <AIInvestigationStatusLiveRegion
        status={AIRunStatus.Completed}
        summary="New report"
      />,
    );
    expect(liveStatus).toHaveTextContent(AI_INVESTIGATION_READY_ANNOUNCEMENT);
  });

  test("clears when the subject has no run", () => {
    const { rerender } = render(
      <AIInvestigationStatusLiveRegion
        status={AIRunStatus.Completed}
        summary={SUMMARY}
      />,
    );
    const liveStatus: HTMLElement = screen.getByRole("status");

    rerender(<AIInvestigationStatusLiveRegion status={null} summary={null} />);
    expect(liveStatus).toBeEmptyDOMElement();

    rerender(
      <AIInvestigationStatusLiveRegion
        status={AIRunStatus.Completed}
        summary={null}
      />,
    );
    expect(liveStatus).toBeEmptyDOMElement();
  });

  test.each(NON_COMPLETED_INACTIVE_STATUSES)(
    "stays silent for %s even with a summary",
    (status: AIRunStatus) => {
      render(
        <AIInvestigationStatusLiveRegion status={status} summary={SUMMARY} />,
      );

      expect(screen.getByRole("status")).toBeEmptyDOMElement();
    },
  );
});

describe("scrollToAIInvestigationPanel", () => {
  type AddTargetFunction = () => {
    target: HTMLElement;
    scrollIntoView: MockFunction;
    focus: MockFunction;
  };

  const addTarget: AddTargetFunction = () => {
    const target: HTMLElement = document.createElement("section");
    target.id = AI_INVESTIGATION_PANEL_ID;
    target.tabIndex = -1;

    const scrollIntoView: MockFunction = getJestMockFunction();
    const focus: MockFunction = getJestMockFunction();
    Object.defineProperty(target, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    Object.defineProperty(target, "focus", {
      configurable: true,
      value: focus,
    });
    document.body.appendChild(target);

    return { target, scrollIntoView, focus };
  };

  test("smoothly scrolls to and focuses the detailed investigation", () => {
    const { scrollIntoView, focus } = addTarget();

    scrollToAIInvestigationPanel();

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  test("honors reduced-motion preferences", () => {
    setReducedMotion(true);
    const { scrollIntoView, focus } = addTarget();

    scrollToAIInvestigationPanel();

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "start",
    });
    expect(focus).toHaveBeenCalledTimes(1);
  });

  test("is a safe no-op before a panel exists", () => {
    expect(() => {
      scrollToAIInvestigationPanel();
    }).not.toThrow();
  });
});
