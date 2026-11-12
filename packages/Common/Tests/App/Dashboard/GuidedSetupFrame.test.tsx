// UX rule: Docs/ux/README.md#a-products-first-page
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The frame every guided setup is drawn in (issue #6804; #6805 and #6806
 * reuse it): the steps on one page, the open one showing what it asks,
 * done ones folded to a line, upcoming ones only named, the summary once
 * nothing is open - and the setup's events, sent the same way for every
 * setup (#6830).
 */

const sendMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ProductEvents", () => {
  return {
    __esModule: true,
    default: {
      send: (...args: Array<unknown>) => {
        return sendMock(...args);
      },
    },
  };
});

import GuidedSetupFrame, {
  GUIDED_SETUP_GUIDE_LINK_TEST_ID,
  GUIDED_SETUP_GUIDE_TEXT,
  GuidedSetupFrameStep,
  SUMMARY_STEP_KEY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupFrame";
import { getLearnMoreUrl } from "../../../UI/Components/Link/LearnMoreLink";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";

const steps: (...done: Array<boolean>) => Array<GuidedSetupFrameStep> = (
  ...done: Array<boolean>
): Array<GuidedSetupFrameStep> => {
  return [
    { key: "first", title: "First step" },
    { key: "second", title: "Second step" },
    { key: "third", title: "Third step" },
  ].map(
    (
      step: { key: string; title: string },
      index: number,
    ): GuidedSetupFrameStep => {
      return {
        ...step,
        isDone: Boolean(done[index]),
        doneLine: `${step.title} made a record.`,
        content: <p data-testid={`${step.key}-content`}>{step.title} asks</p>,
      };
    },
  );
};

const draw: (props: {
  steps: Array<GuidedSetupFrameStep>;
  openStepKey: string | null;
  isFinished?: boolean;
  onOpenStep?: (key: string) => void;
}) => ReactElementLike = (props: {
  steps: Array<GuidedSetupFrameStep>;
  openStepKey: string | null;
  isFinished?: boolean;
  onOpenStep?: (key: string) => void;
}): ReactElementLike => {
  return (
    <GuidedSetupFrame
      setup="example_setup"
      steps={props.steps}
      openStepKey={props.openStepKey}
      onOpenStep={props.onOpenStep || (() => {})}
      summary={<p>All set</p>}
      isFinished={Boolean(props.isFinished)}
    />
  );
};

type ReactElementLike = React.ReactElement;

const sent: (name: ProductEventName) => Array<unknown> = (
  name: ProductEventName,
): Array<unknown> => {
  return sendMock.mock.calls
    .filter((call: Array<unknown>): boolean => {
      return call[0] === name;
    })
    .map((call: Array<unknown>): unknown => {
      return call[1];
    });
};

afterEach(() => {
  cleanup();
  sendMock.mockReset();
});

describe("the steps", () => {
  test("the open step shows what it asks; the others do not", () => {
    render(draw({ steps: steps(true, false, false), openStepKey: "second" }));

    expect(screen.getByTestId("second-content")).toBeInTheDocument();
    expect(screen.queryByTestId("first-content")).toBeNull();
    expect(screen.queryByTestId("third-content")).toBeNull();
    expect(screen.getByTestId("guided-setup-step-second")).toHaveAttribute(
      "aria-current",
      "step",
    );
  });

  test("a done step folds to the line that says what it made", () => {
    render(draw({ steps: steps(true, false, false), openStepKey: "second" }));

    expect(
      screen.getByTestId("guided-setup-step-first-done-line"),
    ).toHaveTextContent("First step made a record.");
    expect(
      screen.queryByTestId("guided-setup-step-third-done-line"),
    ).toBeNull();
    expect(screen.getByTestId("guided-setup-step-first")).toHaveAttribute(
      "data-state",
      "done",
    );
    expect(screen.getByTestId("guided-setup-step-third")).toHaveAttribute(
      "data-state",
      "upcoming",
    );
  });

  test("a done step opens again when pressed; one not reached yet cannot be", () => {
    const onOpenStep: MockFunction = getJestMockFunction();
    render(
      draw({
        steps: steps(true, false, false),
        openStepKey: "second",
        onOpenStep: onOpenStep,
      }),
    );

    fireEvent.click(screen.getByText("First step"));
    expect(onOpenStep).toHaveBeenCalledWith("first");

    expect(
      screen.getByTestId("guided-setup-step-third").querySelector("button"),
    ).toBeNull();
    fireEvent.click(screen.getByText("Third step"));
    expect(onOpenStep).toHaveBeenCalledTimes(1);
  });

  test("says how many steps are done", () => {
    render(draw({ steps: steps(true, true, false), openStepKey: "third" }));

    expect(screen.getByTestId("guided-setup-progress")).toHaveTextContent(
      "2 of 3 steps done",
    );
  });

  test("the summary shows once no step is open, and only then", () => {
    const { rerender } = render(
      draw({ steps: steps(true, true, false), openStepKey: "third" }),
    );

    expect(screen.queryByTestId("guided-setup-summary")).toBeNull();

    rerender(draw({ steps: steps(true, true, true), openStepKey: null }));

    expect(screen.getByTestId("guided-setup-summary")).toHaveTextContent(
      "All set",
    );
  });
});

describe("the setup's events", () => {
  test("started once, and each step as it opens", () => {
    const { rerender } = render(draw({ steps: steps(), openStepKey: "first" }));
    rerender(draw({ steps: steps(true), openStepKey: "second" }));
    // Drawn again on the same step: not a new step.
    rerender(draw({ steps: steps(true), openStepKey: "second" }));
    rerender(draw({ steps: steps(true, true, true), openStepKey: null }));

    expect(sent(ProductEventName.GuidedSetupStarted)).toEqual([
      { setup: "example_setup" },
    ]);
    expect(sent(ProductEventName.GuidedSetupStepReached)).toEqual([
      { setup: "example_setup", step: "first", step_number: 1 },
      { setup: "example_setup", step: "second", step_number: 2 },
      { setup: "example_setup", step: SUMMARY_STEP_KEY, step_number: 3 },
    ]);
  });

  test("finished once the thing works and was tested, and nothing after", () => {
    const { rerender, unmount } = render(
      draw({ steps: steps(true, true, true), openStepKey: null }),
    );

    expect(sent(ProductEventName.GuidedSetupFinished)).toEqual([]);

    rerender(
      draw({
        steps: steps(true, true, true),
        openStepKey: null,
        isFinished: true,
      }),
    );
    rerender(
      draw({
        steps: steps(true, true, true),
        openStepKey: null,
        isFinished: true,
      }),
    );
    act(() => {
      unmount();
    });

    expect(sent(ProductEventName.GuidedSetupFinished)).toHaveLength(1);
    expect(sent(ProductEventName.GuidedSetupFinished)[0]).toMatchObject({
      setup: "example_setup",
    });
    expect(sent(ProductEventName.GuidedSetupLeft)).toEqual([]);
  });

  test("left, at the step it was on, when the page goes before the end", () => {
    const { unmount } = render(
      draw({ steps: steps(true), openStepKey: "second" }),
    );

    act(() => {
      unmount();
    });

    expect(sent(ProductEventName.GuidedSetupLeft)).toEqual([
      { setup: "example_setup", step: "second", step_number: 1 },
    ]);
  });
});

describe("the docs' guide to the same job (#6821)", () => {
  test("is linked beside the progress line, in a new tab, in the reader's language", () => {
    render(
      <GuidedSetupFrame
        setup="example_setup"
        steps={steps()}
        openStepKey="first"
        onOpenStep={() => {}}
        summary={<p>All set</p>}
        isFinished={false}
        guideDocsPath="/docs/guides/paging"
      />,
    );

    const link: HTMLElement = screen.getByTestId(
      GUIDED_SETUP_GUIDE_LINK_TEST_ID,
    );

    expect(GUIDED_SETUP_GUIDE_TEXT).toBe("Step-by-step guide");
    expect(link).toHaveTextContent(GUIDED_SETUP_GUIDE_TEXT);
    expect(link).toHaveAttribute(
      "href",
      getLearnMoreUrl("/docs/guides/paging", "en"),
    );
    expect(link.getAttribute("href")).toMatch(/\/guides\/paging$/);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // On the progress line's row, so it never pushes the steps down.
    expect(link.parentElement).toContainElement(
      screen.getByTestId("guided-setup-progress"),
    );
  });

  test("is not drawn for a setup with no guide", () => {
    render(draw({ steps: steps(), openStepKey: "first" }));

    expect(screen.queryByTestId(GUIDED_SETUP_GUIDE_LINK_TEST_ID)).toBeNull();
    expect(screen.getByTestId("guided-setup-progress")).toBeInTheDocument();
  });
});
