import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import AIInvestigationHeaderStatus, {
  AI_INVESTIGATION_READY_ANNOUNCEMENT,
  AIInvestigationStatusLiveRegion,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AIInvestigationHeaderStatus";
import {
  AI_INVESTIGATION_PANEL_ID,
  hasAIInvestigationSummary,
  isActiveAIInvestigationStatus,
  isCompletedAIInvestigationWithSummary,
  scrollToAIInvestigationPanel,
  shouldShowAIInvestigationHeaderStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AIInvestigationStatus";
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
  test("shows the summary under an AI root cause eyebrow", () => {
    render(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Completed}
        summary={SUMMARY}
        onViewProgress={() => {}}
      />,
    );

    const eyebrow: HTMLElement = screen.getByText("AI root cause analysis");
    const summary: HTMLElement = screen.getByText(SUMMARY);

    expect(eyebrow).toHaveClass(
      "text-xs",
      "font-semibold",
      "uppercase",
      "tracking-wider",
      "text-indigo-600",
    );
    expect(summary).toHaveClass("line-clamp-2", "text-sm");
    expect(summary).toHaveAttribute("title", SUMMARY);
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

  test("offers a native Read report button tied to the investigation panel", async () => {
    const onViewProgress: MockFunction = getJestMockFunction();
    render(
      <AIInvestigationHeaderStatus
        status={AIRunStatus.Completed}
        summary={SUMMARY}
        onViewProgress={onViewProgress}
      />,
    );

    const button: HTMLButtonElement = screen.getByRole("button", {
      name: "Read report",
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

    expect(screen.getByText(SUMMARY)).toHaveAttribute("title", SUMMARY);
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
        screen.queryByRole("button", { name: "Read report" }),
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
    const textColumn: HTMLElement = summary.parentElement as HTMLElement;
    const row: HTMLElement = textColumn.parentElement!
      .parentElement as HTMLElement;

    expect(textColumn).toHaveClass("min-w-0");
    expect(summary).toHaveClass("break-words");
    expect(row).toHaveClass("flex-col", "sm:flex-row");
    // The paragraphs hold only text: Icon renders a <div>, never inside a <p>.
    expect(summary.querySelector("div")).toBeNull();
  });
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
