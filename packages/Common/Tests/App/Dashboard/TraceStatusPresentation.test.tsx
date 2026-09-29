import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * OpenTelemetry's Unset span status (0) is the default: instrumentation sets
 * Error when an operation fails and leaves successful spans Unset. The trace
 * rows and the span panel painted Unset grey, and the status dot in the span
 * tables gave Unset and Ok the same brand green, so a healthy service read
 * as "mostly unknown" (#4118).
 *
 * This renders the REAL TraceRow, SpanDetailsPanel and SpanStatusElement and
 * asserts what a user sees and a screen reader announces for each status: 0,
 * 1, 2, a missing status and a code the UI does not know. The last two read
 * as Unset, the rule the server uses when it buckets the Traces chart.
 *
 * "Unset (no error)" speaks about the status field, and recording an
 * exception does not change a span's status. So where exceptions are in
 * view the status is named alone, "Unset": in the span panel of a span that
 * carries exception events, and in SpanStatusElement's plainLabel, which the
 * exception tables use because each of their rows is an exception.
 */

const analyticsGetListMock: MockFunction = getJestMockFunction();
const apiPostMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factories run.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async () => {
        return { data: [], count: 0 };
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return apiPostMock(...args);
      },
      getFriendlyMessage: () => {
        return "error";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<any>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

import TraceRow from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceRow";
import SpanDetailsPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/SpanDetailsPanel";
import SpanStatusElement, {
  ComponentProps as SpanStatusElementProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Span/SpanStatusElement";
import Span, {
  SpanEvent,
  SpanStatus,
} from "../../../Models/AnalyticsModels/Span";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const ENTITY_ID: string = "22222222-2222-4222-8222-222222222222";
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN_ID: string = "a1b2c3d4e5f60718";
const MAX_DURATION_NANO: number = 4_000_000;

/*
 * What each status must look like, spelled out here rather than read back
 * from SpanStatusPresentation, so the tests pin what the user sees. The
 * rgb() values are how jsdom reports the inline hex colors (#10b981,
 * #0891b2, #ef4444).
 */
interface ExpectedStatus {
  label: string;
  displayLabel: string;
  description: string;
  rgb: string;
  dotClassName: string;
  ringClassName: string;
  barClassName: string;
  barTrackClassName: string;
  pillClassNames: Array<string>;
}

const UNSET: ExpectedStatus = {
  label: "Unset",
  displayLabel: "Unset (no error)",
  description:
    "No error status was set. Unset is the OpenTelemetry default for spans that finish without one.",
  rgb: "rgb(16, 185, 129)",
  dotClassName: "bg-emerald-500",
  ringClassName: "ring-emerald-200",
  barClassName: "bg-emerald-500",
  barTrackClassName: "bg-gray-100",
  pillClassNames: ["bg-emerald-50", "text-emerald-700"],
};

/*
 * Cyan rather than a darker green: #047857 sat next to Error's red for
 * protanopes, and Ok meets Error in the Traces chart wherever a bucket has
 * no Unset spans.
 */
const OK: ExpectedStatus = {
  label: "Ok",
  displayLabel: "Ok",
  description:
    "Explicitly marked successful by the application or a trace pipeline.",
  rgb: "rgb(8, 145, 178)",
  dotClassName: "bg-cyan-600",
  ringClassName: "ring-cyan-200",
  barClassName: "bg-cyan-600",
  barTrackClassName: "bg-gray-100",
  pillClassNames: ["bg-cyan-50", "text-cyan-800"],
};

const ERROR: ExpectedStatus = {
  label: "Error",
  displayLabel: "Error",
  description: "The operation failed: the span's status is Error.",
  rgb: "rgb(239, 68, 68)",
  dotClassName: "bg-red-500",
  ringClassName: "ring-red-100",
  barClassName: "bg-red-500",
  barTrackClassName: "bg-red-50",
  pillClassNames: ["bg-red-50", "text-red-700"],
};

interface StatusCase {
  name: string;
  statusCode: SpanStatus | number | undefined;
  expected: ExpectedStatus;
}

const STATUS_CASES: Array<StatusCase> = [
  { name: "Unset (0)", statusCode: SpanStatus.Unset, expected: UNSET },
  { name: "Ok (1)", statusCode: SpanStatus.Ok, expected: OK },
  { name: "Error (2)", statusCode: SpanStatus.Error, expected: ERROR },
  { name: "a missing status", statusCode: undefined, expected: UNSET },
  { name: "an unknown code (5)", statusCode: 5, expected: UNSET },
];

const NON_ERROR_CASES: Array<StatusCase> = STATUS_CASES.filter(
  (statusCase: StatusCase): boolean => {
    return statusCase.expected !== ERROR;
  },
);

type BuildSpanFunction = (
  statusCode: SpanStatus | number | undefined,
  statusMessage?: string | undefined,
) => Span;

const buildSpan: BuildSpanFunction = (
  statusCode: SpanStatus | number | undefined,
  statusMessage?: string | undefined,
): Span => {
  const span: Span = new Span();
  span.name = "GET /api/orders/:id";
  span.traceId = TRACE_ID;
  span.spanId = SPAN_ID;
  span.primaryEntityId = new ObjectID(ENTITY_ID);
  span.startTime = new Date("2026-09-28T10:00:00.000Z");
  span.durationUnixNano = MAX_DURATION_NANO / 2;
  if (statusCode !== undefined) {
    span.statusCode = statusCode as SpanStatus;
  }
  if (statusMessage !== undefined) {
    span.statusMessage = statusMessage;
  }
  return span;
};

const GREY_CLASS: RegExp = /^(bg|ring|text)-gray-/;

// Every grey background, ring or text class on an element and its subtree.
const greyClassTokens: (root: Element) => Array<string> = (
  root: Element,
): Array<string> => {
  const tokens: Array<string> = [];
  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    for (const token of Array.from(element.classList)) {
      if (GREY_CLASS.test(token)) {
        tokens.push(token);
      }
    }
  }
  return tokens;
};

beforeEach(() => {
  getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
  apiPostMock.mockImplementation(async () => {
    return { data: {} };
  });
  // The span panel's lazy full-span read: nothing more to add by default.
  analyticsGetListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("TraceRow status", () => {
  interface RenderedRow {
    indicator: HTMLElement;
    pulse: HTMLElement;
    dot: HTMLElement;
    barTrack: HTMLElement;
    bar: HTMLElement;
  }

  const renderRow: (span: Span) => RenderedRow = (span: Span): RenderedRow => {
    const result: RenderResult = render(
      <TraceRow span={span} maxDurationNano={MAX_DURATION_NANO} />,
    );

    /*
     * Found by its label rather than its role, so the color assertions
     * below run (and fail) on a row that has lost role="img" too; the role
     * is asserted on its own.
     */
    const indicator: HTMLElement | null =
      result.container.querySelector<HTMLElement>('[aria-label^="Status:"]');
    expect(indicator).not.toBeNull();
    // The pulsing halo, then the solid dot.
    const circles: Array<HTMLElement> = Array.from(
      indicator!.querySelectorAll("span"),
    );
    expect(circles).toHaveLength(2);

    const barTrack: HTMLElement | null =
      result.container.querySelector<HTMLElement>("div.h-1.w-24");
    expect(barTrack).not.toBeNull();
    const bar: HTMLElement | null = barTrack!.querySelector("div");
    expect(bar).not.toBeNull();

    return {
      indicator: indicator!,
      pulse: circles[0]!,
      dot: circles[1]!,
      barTrack: barTrack!,
      bar: bar!,
    };
  };

  test("REGRESSION: an Unset span's dot and duration bar are green, not grey", () => {
    const row: RenderedRow = renderRow(buildSpan(SpanStatus.Unset));

    expect(row.dot).toHaveClass("bg-emerald-500", "ring-emerald-200");
    expect(row.pulse).toHaveClass("bg-emerald-500");
    expect(row.bar).toHaveClass("bg-emerald-500");

    // The old theme: bg-gray-300 dot, ring-gray-100 ring, bg-gray-400 bar.
    expect(greyClassTokens(row.indicator)).toEqual([]);
    expect(row.bar).not.toHaveClass("bg-gray-400");
  });

  test("REGRESSION: the status dot is an image a screen reader announces as 'Status: Unset (no error)'", () => {
    renderRow(buildSpan(SpanStatus.Unset));

    /*
     * The old dot was a plain span: its aria-label ("Status: Unset") was
     * never announced, and getByRole("img") found nothing.
     */
    expect(
      screen.getByRole("img", { name: "Status: Unset (no error)" }),
    ).toHaveAttribute("title", `Unset: ${UNSET.description}`);
  });

  test.each(STATUS_CASES)(
    "$name: the dot, its tooltip and the duration bar read as $expected.displayLabel",
    (statusCase: StatusCase) => {
      const expected: ExpectedStatus = statusCase.expected;
      const row: RenderedRow = renderRow(buildSpan(statusCase.statusCode));

      expect(
        screen.getByRole("img", { name: `Status: ${expected.displayLabel}` }),
      ).toBe(row.indicator);
      // The title names the stored status and explains it.
      expect(row.indicator).toHaveAttribute(
        "title",
        `${expected.label}: ${expected.description}`,
      );

      expect(row.dot).toHaveClass(
        expected.dotClassName,
        "ring-2",
        expected.ringClassName,
      );
      expect(row.pulse).toHaveClass(expected.dotClassName);
      // Only an error pulses.
      expect(row.pulse.classList.contains("animate-ping")).toBe(
        expected === ERROR,
      );

      expect(row.barTrack).toHaveClass(expected.barTrackClassName);
      expect(row.bar).toHaveClass(expected.barClassName);
      // Half the longest span on the page: the bar is this row's duration.
      expect(row.bar.style.width).toBe("50%");
    },
  );

  test("an Error span also gets the ERROR text pill", () => {
    renderRow(buildSpan(SpanStatus.Error));

    const pill: HTMLElement = screen.getByText("Error");
    expect(pill).toHaveClass("uppercase", ...ERROR.pillClassNames);
  });

  test.each(NON_ERROR_CASES)(
    "$name: no text pill, the dot carries the status",
    (statusCase: StatusCase) => {
      renderRow(buildSpan(statusCase.statusCode));

      for (const text of ["Error", "Ok", "Unset", "Unset (no error)"]) {
        expect(screen.queryByText(text)).not.toBeInTheDocument();
      }
    },
  );

  /*
   * A span whose statusCode reads back as a string ("0" / "1" / "2"), the
   * form a facet or chart key carries. Span's setter parses a numeric string
   * (statusCode is a Number column), so the string is put on the instance
   * itself, where the setter never sees it.
   */
  const buildSpanWithStatusText: (
    statusCode: string,
    statusMessage: string,
  ) => Span = (statusCode: string, statusMessage: string): Span => {
    const span: Span = buildSpan(undefined, statusMessage);
    Object.defineProperty(span, "statusCode", {
      configurable: true,
      value: statusCode as unknown as SpanStatus,
    });
    // Still a string when the row reads it.
    expect(span.statusCode).toBe(statusCode);
    return span;
  };

  test('REGRESSION: a status of "2" as a string gets the ERROR pill, the pulse and the red message as well as the red dot', () => {
    const row: RenderedRow = renderRow(
      buildSpanWithStatusText("2", "connection refused"),
    );

    // The dot already read "2" as Error...
    expect(screen.getByRole("img", { name: "Status: Error" })).toBe(
      row.indicator,
    );
    expect(row.dot).toHaveClass(ERROR.dotClassName, ERROR.ringClassName);
    expect(row.bar).toHaveClass(ERROR.barClassName);

    /*
     * ...but the row decided "error" with a strict === against the number 2,
     * so the pulse, the pill and the message were missing.
     */
    expect(row.pulse).toHaveClass("animate-ping", ERROR.dotClassName);
    expect(screen.getByText("Error")).toHaveClass(
      "uppercase",
      ...ERROR.pillClassNames,
    );
    const message: HTMLElement = screen.getByText("connection refused");
    expect(message).toHaveClass("text-red-500");
    expect(message).toHaveAttribute("title", "connection refused");
  });

  test.each([
    { statusCode: "1", expected: OK },
    { statusCode: "0", expected: UNSET },
  ])(
    'a status of "$statusCode" as a string reads as $expected.displayLabel, with no pill, pulse or message',
    (textCase: { statusCode: string; expected: ExpectedStatus }) => {
      const expected: ExpectedStatus = textCase.expected;
      const row: RenderedRow = renderRow(
        buildSpanWithStatusText(
          textCase.statusCode,
          "upstream answered 404 (handled)",
        ),
      );

      expect(
        screen.getByRole("img", { name: `Status: ${expected.displayLabel}` }),
      ).toBe(row.indicator);
      expect(row.dot).toHaveClass(
        expected.dotClassName,
        expected.ringClassName,
      );
      expect(row.bar).toHaveClass(expected.barClassName);
      expect(row.pulse).not.toHaveClass("animate-ping");

      for (const text of ["Error", "Ok", "Unset", "Unset (no error)"]) {
        expect(screen.queryByText(text)).not.toBeInTheDocument();
      }
      // The row shows a status message only for an error.
      expect(
        screen.queryByText("upstream answered 404 (handled)"),
      ).not.toBeInTheDocument();
    },
  );

  /*
   * Recording an exception does not change a span's status. The list query
   * brings hasException along, so the row can say so without "no error".
   */
  test("REGRESSION: an Unset span that recorded an exception is announced as a plain 'Status: Unset'", () => {
    const span: Span = buildSpan(SpanStatus.Unset);
    span.hasException = true;

    const row: RenderedRow = renderRow(span);

    expect(screen.getByRole("img", { name: "Status: Unset" })).toBe(
      row.indicator,
    );
    // Only the words change: still Unset's green, tooltip and bar.
    expect(row.indicator).toHaveAttribute(
      "title",
      `Unset: ${UNSET.description}`,
    );
    expect(row.dot).toHaveClass(UNSET.dotClassName, UNSET.ringClassName);
    expect(row.bar).toHaveClass(UNSET.barClassName);
  });

  test.each([
    { name: "false", hasException: false },
    { name: "missing", hasException: undefined },
  ])(
    "an Unset span whose hasException is $name is still announced as 'Status: Unset (no error)'",
    (exceptionCase: { name: string; hasException: boolean | undefined }) => {
      const span: Span = buildSpan(SpanStatus.Unset);
      if (exceptionCase.hasException !== undefined) {
        span.hasException = exceptionCase.hasException;
      }

      renderRow(span);

      expect(
        screen.getByRole("img", { name: "Status: Unset (no error)" }),
      ).toBeInTheDocument();
    },
  );

  test("an Error span that recorded an exception is announced as 'Status: Error', with its pill", () => {
    const span: Span = buildSpan(SpanStatus.Error);
    span.hasException = true;

    renderRow(span);

    expect(
      screen.getByRole("img", { name: "Status: Error" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
  });
});

describe("SpanDetailsPanel status", () => {
  const renderPanel: (span: Span) => Promise<void> = async (
    span: Span,
  ): Promise<void> => {
    // The lazy full-span read resolves inside act.
    await act(async () => {
      render(<SpanDetailsPanel span={span} />);
    });
  };

  // The <dd> next to an Overview row's <dt>.
  const overviewValue: (label: string) => HTMLElement = (
    label: string,
  ): HTMLElement => {
    const term: HTMLElement = screen.getByText(label, { selector: "dt" });
    const value: Element | null = term.nextElementSibling;
    expect(value?.tagName).toBe("DD");
    return value as HTMLElement;
  };

  const statusPill: () => HTMLElement = (): HTMLElement => {
    return screen.getByTestId("span-details-status");
  };

  const statusPillDot: () => HTMLElement = (): HTMLElement => {
    const dot: HTMLElement | null = statusPill().querySelector("span");
    expect(dot).not.toBeNull();
    return dot!;
  };

  /*
   * The box holding a status message, found by the message itself so the
   * color assertions reach it on any version of the panel.
   */
  const statusMessageBox: (message: string) => HTMLElement = (
    message: string,
  ): HTMLElement => {
    const box: HTMLElement = screen.getByText(message);
    expect(box.closest("section")).toHaveTextContent("Status Message");
    return box;
  };

  test("REGRESSION: an Unset span's pill reads 'Unset (no error)' in green, not a grey 'Unset'", async () => {
    await renderPanel(buildSpan(SpanStatus.Unset));

    expect(statusPill().textContent).toBe("Unset (no error)");
    expect(statusPill()).toHaveClass("bg-emerald-50", "text-emerald-700");
    // Was the grey #9ca3af, rgb(156, 163, 175).
    expect(statusPillDot().style.backgroundColor).toBe("rgb(16, 185, 129)");
    expect(overviewValue("Status").textContent).toBe("Unset (no error)");
  });

  test.each(STATUS_CASES)(
    "$name: the header pill and the Overview row read $expected.displayLabel",
    async (statusCase: StatusCase) => {
      const expected: ExpectedStatus = statusCase.expected;
      await renderPanel(buildSpan(statusCase.statusCode));

      const pill: HTMLElement = statusPill();
      expect(pill.textContent).toBe(expected.displayLabel);
      expect(pill).toHaveClass(...expected.pillClassNames);
      expect(pill).toHaveAttribute("title", expected.description);

      /*
       * Theme-aware classes color the pill: an inline color (the old
       * `${statusColor}1a` background) is one Theme.css cannot re-color.
       */
      expect(pill.style.color).toBe("");
      expect(pill.style.backgroundColor).toBe("");

      expect(statusPillDot().style.backgroundColor).toBe(expected.rgb);
      expect(statusPillDot()).toHaveAttribute("aria-hidden", "true");

      expect(overviewValue("Status").textContent).toBe(expected.displayLabel);
    },
  );

  test.each(NON_ERROR_CASES)(
    "REGRESSION: $name: a status message sits in a neutral box, not a red one",
    async (statusCase: StatusCase) => {
      await renderPanel(
        buildSpan(statusCase.statusCode, "upstream answered 404 (handled)"),
      );

      const box: HTMLElement = statusMessageBox(
        "upstream answered 404 (handled)",
      );
      expect(box).toHaveClass("border-gray-200", "bg-gray-50", "text-gray-700");
      expect(box).not.toHaveClass("bg-red-50");
      expect(box).not.toHaveClass("border-red-100");
      expect(box).not.toHaveClass("text-red-700");
      expect(box).toHaveAttribute("data-testid", "span-details-status-message");
    },
  );

  test("an Error span's status message stays red", async () => {
    await renderPanel(buildSpan(SpanStatus.Error, "connection refused"));

    const box: HTMLElement = statusMessageBox("connection refused");
    expect(box).toHaveClass("border-red-100", "bg-red-50", "text-red-700");
    expect(box).not.toHaveClass("bg-gray-50");
    expect(box).toHaveAttribute("data-testid", "span-details-status-message");
  });

  test.each([
    { name: "Unset", statusCode: SpanStatus.Unset, isRed: false },
    { name: "Error", statusCode: SpanStatus.Error, isRed: true },
  ])(
    "a message that only the lazily fetched full span carries follows the same rule ($name)",
    async (fetchCase: {
      name: string;
      statusCode: SpanStatus;
      isRed: boolean;
    }) => {
      analyticsGetListMock.mockImplementation(async () => {
        const fullSpan: Span = new Span();
        fullSpan.statusMessage = "retried after 503";
        return { data: [fullSpan], count: 1 };
      });

      // The row's light span has no message of its own.
      await renderPanel(buildSpan(fetchCase.statusCode));

      expect(analyticsGetListMock).toHaveBeenCalled();
      const box: HTMLElement = statusMessageBox("retried after 503");
      expect(box.classList.contains("bg-red-50")).toBe(fetchCase.isRed);
      expect(box.classList.contains("bg-gray-50")).toBe(!fetchCase.isRed);
    },
  );

  test.each(STATUS_CASES)(
    "$name without a status message shows no message box",
    async (statusCase: StatusCase) => {
      await renderPanel(buildSpan(statusCase.statusCode));

      expect(
        screen.queryByTestId("span-details-status-message"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Status Message")).not.toBeInTheDocument();
    },
  );

  const EVENT_TIME: Date = new Date("2026-09-28T10:00:00.250Z");

  // An OpenTelemetry exception event, as the lazily fetched full span has it.
  const exceptionEvent: (message: string) => SpanEvent = (
    message: string,
  ): SpanEvent => {
    return {
      name: "exception",
      time: EVENT_TIME,
      timeUnixNano: EVENT_TIME.getTime() * 1_000_000,
      attributes: {
        "exception.type": "TimeoutError",
        "exception.message": message,
      },
    };
  };

  /*
   * The lazy full-span read answers with these events. The row's light span
   * never has events of its own.
   */
  const fullSpanWithEvents: (events: Array<SpanEvent>) => void = (
    events: Array<SpanEvent>,
  ): void => {
    analyticsGetListMock.mockImplementation(async () => {
      const fullSpan: Span = new Span();
      fullSpan.events = events;
      return { data: [fullSpan], count: 1 };
    });
  };

  test("REGRESSION: an Unset span that carries an exception reads a plain 'Unset', not 'Unset (no error)'", async () => {
    fullSpanWithEvents([exceptionEvent("upstream timed out after 30s")]);

    await renderPanel(buildSpan(SpanStatus.Unset));

    // The events come from the lazy read, which has to ask for them.
    expect(analyticsGetListMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ events: true }),
      }),
    );

    // The exception is listed with the span...
    expect(screen.getByText("Exceptions (1)")).toBeInTheDocument();
    expect(
      screen.getByText("upstream timed out after 30s"),
    ).toBeInTheDocument();

    /*
     * ...so "no error" would contradict it. Recording an exception does not
     * change a span's status: the status is named, not explained.
     */
    const pill: HTMLElement = statusPill();
    expect(pill.textContent).toBe("Unset");
    expect(overviewValue("Status").textContent).toBe("Unset");

    // Only the words change: the pill keeps Unset's green and its tooltip.
    expect(pill).toHaveClass(...UNSET.pillClassNames);
    expect(pill).toHaveAttribute("title", UNSET.description);
    expect(statusPillDot().style.backgroundColor).toBe(UNSET.rgb);
    expect(greyClassTokens(pill)).toEqual([]);
  });

  test.each(STATUS_CASES)(
    "$name carrying an exception: the header pill and the Overview row read $expected.label",
    async (statusCase: StatusCase) => {
      const expected: ExpectedStatus = statusCase.expected;
      fullSpanWithEvents([exceptionEvent("connection reset by peer")]);

      await renderPanel(buildSpan(statusCase.statusCode));

      expect(screen.getByText("connection reset by peer")).toBeInTheDocument();

      const pill: HTMLElement = statusPill();
      expect(pill.textContent).toBe(expected.label);
      expect(pill).toHaveClass(...expected.pillClassNames);
      expect(pill).toHaveAttribute("title", expected.description);
      expect(statusPillDot().style.backgroundColor).toBe(expected.rgb);

      expect(overviewValue("Status").textContent).toBe(expected.label);
    },
  );

  test("an Unset span whose events hold no exception still reads 'Unset (no error)'", async () => {
    fullSpanWithEvents([
      {
        name: "cache.miss",
        time: EVENT_TIME,
        timeUnixNano: EVENT_TIME.getTime() * 1_000_000,
        attributes: { "cache.key": "orders:42" },
      },
    ]);

    await renderPanel(buildSpan(SpanStatus.Unset));

    expect(analyticsGetListMock).toHaveBeenCalled();
    expect(screen.queryByText(/^Exceptions \(/)).not.toBeInTheDocument();

    const pill: HTMLElement = statusPill();
    expect(pill.textContent).toBe("Unset (no error)");
    expect(pill).toHaveClass(...UNSET.pillClassNames);
    expect(overviewValue("Status").textContent).toBe("Unset (no error)");
  });

  /*
   * The row's light span carries hasException, so the panel names the status
   * plainly from the start — not only once the full span's events arrive.
   */
  test("REGRESSION: an Unset span flagged hasException reads 'Unset' while the full span is still loading", async () => {
    // The lazy read has not answered yet.
    analyticsGetListMock.mockImplementation(() => {
      return new Promise<never>(() => {});
    });
    const span: Span = buildSpan(SpanStatus.Unset);
    span.hasException = true;

    await renderPanel(span);

    expect(analyticsGetListMock).toHaveBeenCalled();
    expect(statusPill().textContent).toBe("Unset");
    expect(overviewValue("Status").textContent).toBe("Unset");
    expect(statusPill()).toHaveClass(...UNSET.pillClassNames);
  });

  test("REGRESSION: an Unset span flagged hasException still reads 'Unset' when the full-span read fails", async () => {
    analyticsGetListMock.mockImplementation(async () => {
      throw new Error("span read failed");
    });
    const span: Span = buildSpan(SpanStatus.Unset);
    span.hasException = true;

    await renderPanel(span);

    expect(analyticsGetListMock).toHaveBeenCalled();
    expect(statusPill().textContent).toBe("Unset");
    expect(overviewValue("Status").textContent).toBe("Unset");
  });

  test("an Unset span flagged hasException false reads 'Unset (no error)'", async () => {
    const span: Span = buildSpan(SpanStatus.Unset);
    span.hasException = false;

    await renderPanel(span);

    expect(statusPill().textContent).toBe("Unset (no error)");
    expect(overviewValue("Status").textContent).toBe("Unset (no error)");
  });
});

describe("SpanStatusElement", () => {
  const renderStatusElement: (props: SpanStatusElementProps) => void = (
    props: SpanStatusElementProps,
  ): void => {
    render(
      <MemoryRouter>
        <SpanStatusElement {...props} />
      </MemoryRouter>,
    );
  };

  const CIRCLE_CASES: Array<StatusCase> = STATUS_CASES.filter(
    (statusCase: StatusCase): boolean => {
      return statusCase.statusCode !== undefined;
    },
  );

  test.each(CIRCLE_CASES)(
    "$name: a circle named 'Span Status: $expected.displayLabel' in its status color",
    (statusCase: StatusCase) => {
      const expected: ExpectedStatus = statusCase.expected;
      renderStatusElement({
        spanStatusCode: statusCase.statusCode as SpanStatus,
      });

      const circle: HTMLElement = screen.getByRole("img");
      expect(circle).toHaveAccessibleName(
        `Span Status: ${expected.displayLabel}`,
      );
      expect(circle.style.backgroundColor).toBe(expected.rgb);
    },
  );

  test("REGRESSION: Unset and Ok get colors of their own, and neither is the old brand green", () => {
    renderStatusElement({ spanStatusCode: SpanStatus.Unset });
    renderStatusElement({ spanStatusCode: SpanStatus.Ok });

    // A prefix match, so the old "Span Status: Unset" circle is compared too.
    const unset: HTMLElement = screen.getByRole("img", {
      name: /^Span Status: Unset/,
    });
    const ok: HTMLElement = screen.getByRole("img", {
      name: "Span Status: Ok",
    });

    // Both were BrandColors Green (#2ab57d), rgb(42, 181, 125).
    expect(unset.style.backgroundColor).toBe("rgb(16, 185, 129)");
    expect(ok.style.backgroundColor).toBe("rgb(8, 145, 178)");
    expect(ok.style.backgroundColor).not.toBe(unset.style.backgroundColor);
  });

  test("REGRESSION: Unset is 0, a falsy value, and still gets its circle", () => {
    expect(SpanStatus.Unset).toBe(0);

    renderStatusElement({ spanStatusCode: SpanStatus.Unset });

    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(
      screen.getByRole("img", { name: "Span Status: Unset (no error)" }),
    ).toBeInTheDocument();
  });

  test("an Error span's circle is red", () => {
    renderStatusElement({ spanStatusCode: SpanStatus.Error });

    expect(
      screen.getByRole("img", { name: "Span Status: Error" }).style
        .backgroundColor,
    ).toBe("rgb(239, 68, 68)");
  });

  test.each(CIRCLE_CASES)(
    "$name with plainLabel: a circle named 'Span Status: $expected.label' in the same color",
    (statusCase: StatusCase) => {
      const expected: ExpectedStatus = statusCase.expected;
      renderStatusElement({
        spanStatusCode: statusCase.statusCode as SpanStatus,
        plainLabel: true,
      });

      const circle: HTMLElement = screen.getByRole("img");
      expect(circle).toHaveAccessibleName(`Span Status: ${expected.label}`);
      expect(circle.style.backgroundColor).toBe(expected.rgb);
    },
  );

  test("plainLabel names Unset alone; without it, or set to false, the circle says 'Unset (no error)'", () => {
    /*
     * The exception tables pass plainLabel: each of their rows is an
     * exception, which "no error" would contradict.
     */
    renderStatusElement({ spanStatusCode: SpanStatus.Unset, plainLabel: true });
    renderStatusElement({ spanStatusCode: SpanStatus.Unset });
    renderStatusElement({
      spanStatusCode: SpanStatus.Unset,
      plainLabel: false,
    });

    const names: Array<string | null> = screen
      .getAllByRole("img")
      .map((circle: HTMLElement): string | null => {
        return circle.getAttribute("aria-label");
      });
    expect(names).toEqual([
      "Span Status: Unset",
      "Span Status: Unset (no error)",
      "Span Status: Unset (no error)",
    ]);
  });

  test.each([
    { name: "undefined", value: undefined },
    { name: "null", value: null },
  ])(
    "a $name status renders no circle, with or without plainLabel",
    (missingCase: { name: string; value: undefined | null }) => {
      renderStatusElement({ spanStatusCode: missingCase.value });
      renderStatusElement({
        spanStatusCode: missingCase.value,
        plainLabel: true,
      });

      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    },
  );

  test("a missing status with a title still links the title to its trace, with no circle", () => {
    renderStatusElement({
      spanStatusCode: undefined,
      title: "GET /api/orders/:id",
      traceId: TRACE_ID,
      plainLabel: true,
    });

    expect(
      screen.getByRole("link", { name: "GET /api/orders/:id" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/traces/view/${TRACE_ID}`,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  test("with a title and a trace id, the title links to that trace", () => {
    renderStatusElement({
      spanStatusCode: SpanStatus.Error,
      title: SPAN_ID,
      traceId: TRACE_ID,
    });

    expect(screen.getByRole("link", { name: SPAN_ID })).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/traces/view/${TRACE_ID}`,
    );
    // The circle still sits beside it.
    expect(
      screen.getByRole("img", { name: "Span Status: Error" }),
    ).toBeInTheDocument();
  });

  test("an empty title renders the circle alone, with no link", () => {
    renderStatusElement({ spanStatusCode: SpanStatus.Ok, title: "" });

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Span Status: Ok" }),
    ).toBeInTheDocument();
  });
});
