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
  AIInvestigationStatusLiveRegion,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AIInvestigationHeaderStatus";
import {
  AI_INVESTIGATION_PANEL_ID,
  isActiveAIInvestigationStatus,
  scrollToAIInvestigationPanel,
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
