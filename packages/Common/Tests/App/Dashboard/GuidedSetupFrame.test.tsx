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
  GUIDED_SETUP_ASIDE_TEST_ID,
  GUIDED_SETUP_COLUMNS_CLASS_NAME,
  GUIDED_SETUP_GUIDE_LINK_TEST_ID,
  GUIDED_SETUP_GUIDE_TEXT,
  GUIDED_SETUP_OUTCOMES_TITLE,
  GUIDED_SETUP_PAGE_CLASS_NAME,
  GuidedSetupFrameStep,
  SUMMARY_STEP_KEY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupFrame";
import { GuidedSetupRunSync } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupProgress";
import { GuidedSetupResourceRow } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupResources";
import { GuidedSetupResourceStatus } from "../../../Types/GuidedSetup/GuidedSetupRun";
import Route from "../../../Types/API/Route";
import fs from "fs";
import path from "path";
import { getLearnMoreUrl } from "../../../UI/Components/Link/LearnMoreLink";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import {
  GuidedSetupEntryPoint,
  getGuidedSetupEntryPoint,
  withGuidedSetupEntryPoint,
} from "../../../UI/Utils/GuidedSetupEvents";

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

/*
 * WHERE A SETUP WAS OPENED FROM (#7054): a way in that names itself puts
 * `?from=` on the setup's address, and started says it - only the ways in
 * OneUptime knows, never a word typed into the address.
 */
describe("where it was opened from (#7054)", () => {
  const openedAt: (search: string) => void = (search: string): void => {
    window.history.replaceState({}, "", `/dashboard/project/setup${search}`);
  };

  afterEach(() => {
    openedAt("");
  });

  test.each([
    [GuidedSetupEntryPoint.EmptyList, "empty_list"],
    [GuidedSetupEntryPoint.HowItWorks, "how_it_works"],
    [GuidedSetupEntryPoint.CreateMonitor, "create_monitor"],
    [GuidedSetupEntryPoint.WebsiteDownSummary, "website_down_summary"],
  ])("started says %s", (entryPoint: GuidedSetupEntryPoint, word: string) => {
    expect(entryPoint).toBe(word);
    openedAt(withGuidedSetupEntryPoint("", entryPoint));
    render(draw({ steps: steps(), openStepKey: "first" }));

    expect(sent(ProductEventName.GuidedSetupStarted)).toEqual([
      { setup: "example_setup", from: word },
    ]);
  });

  test("an address that names no way in OneUptime knows sends no from at all", () => {
    openedAt("?from=Ada%20typed%20this");
    render(draw({ steps: steps(), openStepKey: "first" }));

    expect(sent(ProductEventName.GuidedSetupStarted)).toEqual([
      { setup: "example_setup" },
    ]);
  });

  test("opened with no from - Home, the checklist, Search - says nothing of it", () => {
    render(draw({ steps: steps(), openStepKey: "first" }));

    expect(sent(ProductEventName.GuidedSetupStarted)).toEqual([
      { setup: "example_setup" },
    ]);
  });

  test("an address that has a query already keeps it", () => {
    expect(
      withGuidedSetupEntryPoint(
        "/dashboard/p/status-pages/setup?monitorId=m",
        GuidedSetupEntryPoint.WebsiteDownSummary,
      ),
    ).toBe(
      "/dashboard/p/status-pages/setup?monitorId=m&from=website_down_summary",
    );
    expect(
      withGuidedSetupEntryPoint(
        "/dashboard/p/monitors/setup",
        GuidedSetupEntryPoint.EmptyList,
      ),
    ).toBe("/dashboard/p/monitors/setup?from=empty_list");
  });

  test("only the known words are read back", () => {
    expect(getGuidedSetupEntryPoint("how_it_works")).toBe(
      GuidedSetupEntryPoint.HowItWorks,
    );
    expect(getGuidedSetupEntryPoint("How_It_Works")).toBeNull();
    expect(getGuidedSetupEntryPoint("")).toBeNull();
    expect(getGuidedSetupEntryPoint(null)).toBeNull();
    expect(getGuidedSetupEntryPoint(undefined)).toBeNull();
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
    /*
     * On the progress line's row, so it never pushes the steps down - beside
     * Describe it instead, when the setup offers it (#7245).
     */
    expect(link.parentElement?.parentElement).toContainElement(
      screen.getByTestId("guided-setup-progress"),
    );
  });

  test("is not drawn for a setup with no guide", () => {
    render(draw({ steps: steps(), openStepKey: "first" }));

    expect(screen.queryByTestId(GUIDED_SETUP_GUIDE_LINK_TEST_ID)).toBeNull();
    expect(screen.getByTestId("guided-setup-progress")).toBeInTheDocument();
  });
});

/*
 * "A narrow column of three steps that leaves two thirds of the screen
 * empty" (#8897). Beside its steps, a setup says what it sets up - each
 * step's outcome, marked as done, open now or still to come - and about how
 * long it takes. The steps keep their width; a setup with nothing to say
 * there keeps one column.
 */
describe("what the setup sets up, beside its steps", () => {
  const withOutcomes: (
    ...done: Array<boolean>
  ) => Array<GuidedSetupFrameStep> = (
    ...done: Array<boolean>
  ): Array<GuidedSetupFrameStep> => {
    return steps(...done).map(
      (step: GuidedSetupFrameStep): GuidedSetupFrameStep => {
        return { ...step, outcome: `${step.title} works.` };
      },
    );
  };

  const drawWith: (props: {
    steps: Array<GuidedSetupFrameStep>;
    openStepKey: string | null;
    minutes?: number;
  }) => React.ReactElement = (props: {
    steps: Array<GuidedSetupFrameStep>;
    openStepKey: string | null;
    minutes?: number;
  }): React.ReactElement => {
    return (
      <GuidedSetupFrame
        setup="example_setup"
        steps={props.steps}
        openStepKey={props.openStepKey}
        onOpenStep={() => {}}
        summary={<p>All set</p>}
        isFinished={false}
        minutes={props.minutes}
      />
    );
  };

  test("lists every step's outcome, in the steps' order, under its heading", () => {
    render(drawWith({ steps: withOutcomes(), openStepKey: "first" }));

    const aside: HTMLElement = screen.getByTestId(GUIDED_SETUP_ASIDE_TEST_ID);

    expect(GUIDED_SETUP_OUTCOMES_TITLE).toBe("What this sets up");
    expect(aside.tagName).toBe("ASIDE");
    expect(aside).toHaveAttribute("aria-label", "What this sets up");
    expect(aside).toHaveTextContent("What this sets up");
    expect(
      Array.from(
        aside.querySelectorAll('[data-testid^="guided-setup-outcome-"]'),
      )
        .filter((item: Element): boolean => {
          return item.tagName === "LI";
        })
        .map((item: Element): string => {
          return (
            item.querySelector('[data-testid$="-text"]')?.textContent || ""
          );
        }),
    ).toEqual(["First step works.", "Second step works.", "Third step works."]);
  });

  test("numbers each outcome as its step is numbered, and ticks it once the step is done", () => {
    render(
      drawWith({
        steps: withOutcomes(true, false, false),
        openStepKey: "second",
      }),
    );

    // Done: a tick, no number. Open and to come: the step's number.
    expect(
      screen.getByTestId("guided-setup-outcome-first"),
    ).not.toHaveTextContent(/^1/);
    expect(screen.getByTestId("guided-setup-outcome-second")).toHaveTextContent(
      /^2Second step works\.$/,
    );
    expect(screen.getByTestId("guided-setup-outcome-third")).toHaveTextContent(
      /^3Third step works\.$/,
    );
  });

  test("marks each as done, open now, or still to come, as the steps are", () => {
    render(
      drawWith({
        steps: withOutcomes(true, false, false),
        openStepKey: "second",
      }),
    );

    expect(screen.getByTestId("guided-setup-outcome-first")).toHaveAttribute(
      "data-state",
      "done",
    );
    expect(screen.getByTestId("guided-setup-outcome-second")).toHaveAttribute(
      "data-state",
      "open",
    );
    expect(screen.getByTestId("guided-setup-outcome-second")).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(screen.getByTestId("guided-setup-outcome-third")).toHaveAttribute(
      "data-state",
      "upcoming",
    );
    expect(
      screen.getByTestId("guided-setup-outcome-third"),
    ).not.toHaveAttribute("aria-current");
  });

  test("ticks off as the steps are done, and all of them once the summary shows", () => {
    const { rerender } = render(
      drawWith({ steps: withOutcomes(), openStepKey: "first" }),
    );

    expect(screen.getByTestId("guided-setup-outcome-first")).toHaveAttribute(
      "data-state",
      "open",
    );

    rerender(
      drawWith({ steps: withOutcomes(true, true, true), openStepKey: null }),
    );

    for (const key of ["first", "second", "third"]) {
      expect(screen.getByTestId(`guided-setup-outcome-${key}`)).toHaveAttribute(
        "data-state",
        "done",
      );
    }
  });

  test("says about how long the setup takes", () => {
    render(
      drawWith({ steps: withOutcomes(), openStepKey: "first", minutes: 3 }),
    );

    expect(screen.getByTestId("guided-setup-minutes")).toHaveTextContent(
      /^About 3\sminutes$/,
    );
    // Its clock is an Icon, which draws a div: no paragraph holds one.
    expect(
      screen.getByTestId(GUIDED_SETUP_ASIDE_TEST_ID).querySelectorAll("p div"),
    ).toHaveLength(0);
  });

  test("sits beside the steps from lg up, the steps taking the room the page has", () => {
    render(drawWith({ steps: withOutcomes(), openStepKey: "first" }));

    const frame: HTMLElement = screen.getByTestId("guided-setup");
    const columns: HTMLElement = frame.firstElementChild as HTMLElement;

    // The page is as wide as both need (GUIDED_SETUP_PAGE_CLASS_NAME).
    expect(frame.className).not.toContain("max-w-");
    expect(columns.className).toBe(GUIDED_SETUP_COLUMNS_CLASS_NAME);
    expect(GUIDED_SETUP_COLUMNS_CLASS_NAME).toContain("grid-cols-1");
    // The steps take what is left; what it sets up is beside them.
    expect(GUIDED_SETUP_COLUMNS_CLASS_NAME).toContain(
      "lg:grid-cols-[minmax(0,1fr)_22rem]",
    );
    expect(GUIDED_SETUP_COLUMNS_CLASS_NAME).toContain(
      "xl:grid-cols-[minmax(0,1fr)_25rem]",
    );
    expect(columns.lastElementChild).toBe(
      screen.getByTestId(GUIDED_SETUP_ASIDE_TEST_ID),
    );
    expect(columns.firstElementChild).toContainElement(
      screen.getByTestId("guided-setup-progress"),
    );
  });

  test("a setup's page is centred and only as wide as its steps and panel need (#10276)", () => {
    /*
     * A 2,500-pixel screen drew the steps in its left third and nothing
     * beside them: the page is centred now, with its breadcrumbs and title
     * lined up over the steps.
     */
    expect(GUIDED_SETUP_PAGE_CLASS_NAME).toContain("mx-auto");
    expect(GUIDED_SETUP_PAGE_CLASS_NAME).toContain("max-w-7xl");
    expect(GUIDED_SETUP_PAGE_CLASS_NAME).toContain("w-full");
    // The Page's own padding, kept: a phone's 16px gutter.
    expect(GUIDED_SETUP_PAGE_CLASS_NAME).toContain("px-4");

    for (const page of [
      "Monitor/GuidedSetup.tsx",
      "OnCallDuty/GuidedSetup.tsx",
      "StatusPages/GuidedSetup.tsx",
      "Service/GuidedSetup.tsx",
    ]) {
      const source: string = fs.readFileSync(
        path.join(
          __dirname,
          "../../../../App/FeatureSet/Dashboard/src/Pages",
          page,
        ),
        "utf8",
      );

      expect(source).toContain("className={GUIDED_SETUP_PAGE_CLASS_NAME}");
    }
  });

  test("stays put while the steps scroll past, from lg up", () => {
    render(drawWith({ steps: withOutcomes(), openStepKey: "first" }));

    expect(screen.getByTestId(GUIDED_SETUP_ASIDE_TEST_ID).className).toContain(
      "lg:sticky",
    );
  });

  test("a setup with nothing to say there keeps one column, as wide as before", () => {
    render(draw({ steps: steps(), openStepKey: "first" }));

    expect(screen.queryByTestId(GUIDED_SETUP_ASIDE_TEST_ID)).toBeNull();
    expect(screen.getByTestId("guided-setup").className).toContain("max-w-3xl");
  });

  test("a setup with only its minutes says them alone", () => {
    render(drawWith({ steps: steps(), openStepKey: "first", minutes: 1 }));

    expect(
      screen.getByTestId(GUIDED_SETUP_ASIDE_TEST_ID).querySelector("li"),
    ).toBeNull();
    expect(screen.getByTestId("guided-setup-minutes")).toHaveTextContent(
      /^About 1\sminute$/,
    );
  });
});

describe("how far the person is (#10276)", () => {
  test("a bar over the steps fills as they are done, and says so to a screen reader", () => {
    const { rerender } = render(draw({ steps: steps(), openStepKey: "first" }));

    const bar: HTMLElement = screen.getByTestId("guided-setup-progress-bar");

    expect(bar).toHaveAttribute("role", "progressbar");
    expect(bar).toHaveAttribute("aria-label", "Setup progress");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "3");
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("0%");

    rerender(draw({ steps: steps(true, true), openStepKey: "third" }));

    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("67%");

    rerender(draw({ steps: steps(true, true, true), openStepKey: null }));

    expect((bar.firstElementChild as HTMLElement).style.width).toBe("100%");
  });
});

describe("why each step is there (#10276)", () => {
  const described: (...done: Array<boolean>) => Array<GuidedSetupFrameStep> = (
    ...done: Array<boolean>
  ): Array<GuidedSetupFrameStep> => {
    return steps(...done).map(
      (step: GuidedSetupFrameStep): GuidedSetupFrameStep => {
        return { ...step, description: `Why ${step.title} is there.` };
      },
    );
  };

  test("a step not reached yet says why it is there, under its title", () => {
    render(draw({ steps: described(), openStepKey: "first" }));

    expect(
      screen.getByTestId("guided-setup-step-second-description"),
    ).toHaveTextContent("Why Second step is there.");
    expect(
      screen.getByTestId("guided-setup-step-third-description"),
    ).toHaveTextContent("Why Third step is there.");
  });

  test("the open step's own content says it in full, and a done one says what it made", () => {
    render(draw({ steps: described(true), openStepKey: "second" }));

    expect(
      screen.queryByTestId("guided-setup-step-first-description"),
    ).toBeNull();
    expect(
      screen.getByTestId("guided-setup-step-first-done-line"),
    ).toHaveTextContent("First step made a record.");
    expect(
      screen.queryByTestId("guided-setup-step-second-description"),
    ).toBeNull();
    expect(
      screen.getByTestId("guided-setup-step-third-description"),
    ).toBeInTheDocument();
  });
});

describe("the records each step makes, beside the steps (#10276)", () => {
  const MONITOR_ROUTE: Route = new Route("/dashboard/p/monitors/m-1");

  const withRecords: (data: {
    monitor: Partial<GuidedSetupResourceRow>;
    policy?: Partial<GuidedSetupResourceRow>;
    done?: Array<boolean>;
  }) => Array<GuidedSetupFrameStep> = (data: {
    monitor: Partial<GuidedSetupResourceRow>;
    policy?: Partial<GuidedSetupResourceRow>;
    done?: Array<boolean>;
  }): Array<GuidedSetupFrameStep> => {
    return steps(...(data.done || [])).map(
      (step: GuidedSetupFrameStep): GuidedSetupFrameStep => {
        const resources: Array<GuidedSetupResourceRow> = [];

        if (step.key === "first") {
          resources.push({
            key: "monitor",
            stepKey: "first",
            kind: "Monitor",
            status: GuidedSetupResourceStatus.Waiting,
            ...data.monitor,
          });
        }

        if (step.key === "second") {
          resources.push({
            key: "on_call_policy",
            stepKey: "second",
            kind: "On-call policy",
            status: GuidedSetupResourceStatus.Waiting,
            ...(data.policy || {}),
          });
        }

        return { ...step, outcome: `${step.title} works.`, resources };
      },
    );
  };

  test("each record sits under the outcome of the step that makes it", () => {
    render(
      draw({
        steps: withRecords({ monitor: {} }),
        openStepKey: "first",
      }),
    );

    expect(screen.getByTestId("guided-setup-outcome-first")).toContainElement(
      screen.getByTestId("guided-setup-resource-monitor"),
    );
    expect(screen.getByTestId("guided-setup-outcome-second")).toContainElement(
      screen.getByTestId("guided-setup-resource-on_call_policy"),
    );
    // A step with no records of its own still says its outcome.
    expect(screen.getByTestId("guided-setup-outcome-third")).toHaveTextContent(
      "Third step works.",
    );
  });

  test("a record being made, then made: the panel says so as it happens, with Open once it exists", () => {
    const { rerender } = render(
      draw({
        steps: withRecords({
          monitor: {
            status: GuidedSetupResourceStatus.Creating,
            name: "acme.example",
          },
        }),
        openStepKey: "first",
      }),
    );

    expect(screen.getByTestId("guided-setup-resource-monitor")).toHaveAttribute(
      "data-status",
      "creating",
    );
    expect(
      screen.getByTestId("guided-setup-resource-monitor-status"),
    ).toHaveTextContent("Creating…");
    expect(
      screen.queryByTestId("guided-setup-resource-monitor-open"),
    ).toBeNull();

    rerender(
      draw({
        steps: withRecords({
          monitor: {
            status: GuidedSetupResourceStatus.Created,
            name: "acme.example",
            route: MONITOR_ROUTE,
          },
        }),
        openStepKey: "first",
      }),
    );

    expect(
      screen.getByTestId("guided-setup-resource-monitor-status"),
    ).toHaveTextContent("Created");
    expect(
      screen.getByTestId("guided-setup-resource-monitor-name"),
    ).toHaveTextContent("acme.example");
    expect(
      screen.getByTestId("guided-setup-resource-monitor-open"),
    ).toHaveAttribute("href", MONITOR_ROUTE.toString());
  });

  test("the panel counts what is ready", () => {
    render(
      draw({
        steps: withRecords({
          monitor: { status: GuidedSetupResourceStatus.Created },
        }),
        openStepKey: "second",
      }),
    );

    expect(screen.getByTestId("guided-setup-ready")).toHaveTextContent(
      "1 of 2 ready",
    );
  });

  test("a failure says why, and Try again reruns the step's request", () => {
    const retry: MockFunction = getJestMockFunction();

    render(
      draw({
        steps: withRecords({
          monitor: { status: GuidedSetupResourceStatus.Created },
          policy: {
            status: GuidedSetupResourceStatus.Failed,
            error: "OneUptime is busy and could not save this.",
            onRetry: () => {
              retry();
            },
          },
          done: [true],
        }),
        openStepKey: "second",
      }),
    );

    expect(
      screen.getByTestId("guided-setup-resource-on_call_policy-error"),
    ).toHaveTextContent("OneUptime is busy and could not save this.");

    fireEvent.click(
      screen.getByTestId("guided-setup-resource-on_call_policy-retry"),
    );

    expect(retry).toHaveBeenCalledTimes(1);
  });

  test("where the run stands with the server is said under the records, with Try again when it is not saved", () => {
    const retrySync: MockFunction = getJestMockFunction();
    const frame: (sync: GuidedSetupRunSync) => React.ReactElement = (
      sync: GuidedSetupRunSync,
    ): React.ReactElement => {
      return (
        <GuidedSetupFrame
          setup="example_setup"
          steps={withRecords({ monitor: {} })}
          openStepKey="first"
          onOpenStep={() => {}}
          summary={<p>All set</p>}
          isFinished={false}
          runSync={sync}
          onRetryRunSync={() => {
            retrySync();
          }}
        />
      );
    };

    const { rerender } = render(frame(GuidedSetupRunSync.Saved));

    expect(screen.getByTestId("guided-setup-sync")).toHaveAttribute(
      "data-sync",
      "saved",
    );
    expect(screen.getByTestId("guided-setup-sync")).toHaveTextContent(
      "Saved to your account. Pick up where you left off on any device.",
    );
    expect(screen.queryByTestId("guided-setup-sync-retry")).toBeNull();

    rerender(frame(GuidedSetupRunSync.NotSaved));

    expect(screen.getByTestId("guided-setup-sync")).toHaveTextContent(
      "Not saved to your account yet",
    );
    fireEvent.click(screen.getByTestId("guided-setup-sync-retry"));
    expect(retrySync).toHaveBeenCalledTimes(1);
  });

  test("on a phone, the open step lists what it made, where the person is", () => {
    render(
      draw({
        steps: withRecords({
          monitor: {
            status: GuidedSetupResourceStatus.Created,
            name: "acme.example",
          },
        }),
        openStepKey: "first",
      }),
    );

    const records: HTMLElement = screen.getByTestId(
      "guided-setup-step-first-records",
    );

    // Hidden from lg up, where the panel beside the steps says it.
    expect(records.className).toContain("lg:hidden");
    expect(
      screen.getByTestId("guided-setup-step-first-content"),
    ).toContainElement(records);
    expect(
      screen.getByTestId("guided-setup-step-record-monitor"),
    ).toHaveTextContent("Monitor · acme.example");
    // Not a second live region: the panel's rows are one.
    expect(records.querySelector("[aria-live]")).toBeNull();
  });

  test("a step that has made nothing yet lists nothing in it", () => {
    render(
      draw({
        steps: withRecords({ monitor: {} }),
        openStepKey: "first",
      }),
    );

    expect(screen.queryByTestId("guided-setup-step-first-records")).toBeNull();
  });
});
