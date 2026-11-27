/** @timezone UTC */

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
  fireEvent,
  render,
  RenderResult,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * SPLIT BY A SCRUB RULE, ON THE EXCEPTIONS LIST (#11026).
 *
 * The list marks both halves of a pair a scrub rule split before #10434
 * with a Split pill; this filter lists only them, each pair once, by its
 * split one, whose page offers Merge Exceptions. Only projects whose scrub
 * rules split exceptions have any, so the list counts them once as it opens
 * and shows the toggle beside Assigned to me only while there are some, or
 * while a link or a saved view asks for it. Its figure is the list's own
 * (#11116): how many of what the list shows - in its status, its time
 * window and its filters - turning it on lists.
 *
 * The real ExceptionsViewer runs with TelemetryViewer and the saved-views
 * control captured and the data layer mocked: the toolbar is drawn on its
 * own from the viewer's latest props, as TelemetryViewer draws it, and each
 * read is caught where it leaves. What the helpers read is
 * ExceptionSplitPairs.test; the toggle's words in every language are
 * ExceptionsSplitByScrubRuleInEveryLanguage.test.
 */

let viewerProps: any = null;
let controlProps: any = null;

jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (props: any) => {
      viewerProps = props;
      return null;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySavedViewsControl",
  () => {
    return {
      __esModule: true,
      default: (props: any) => {
        controlProps = props;
        return null;
      },
    };
  },
);

const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      count: (...args: Array<any>) => {
        return countMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
      updateById: () => {
        return Promise.resolve();
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return error instanceof Error ? error.message : "Something went wrong";
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

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: () => {
      return {};
    },
  };
});

import ExceptionsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsViewer";
import { EXCEPTION_LIST_SELECT } from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionListRead";
import {
  SPLIT_FINGERPRINT_SELECT,
  forgetRememberedSplitExceptions,
  getSplitExceptionsHintKey,
  rememberSplitExceptions,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionSplitPairs";
import { NO_MATCH_FINGERPRINT } from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionsAttributeScope";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import Includes from "../../../Types/BaseDatabase/Includes";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import ObjectID from "../../../Types/ObjectID";
import TelemetrySavedViewState from "../../../Types/Telemetry/TelemetrySavedViewState";
import TimeRange from "../../../Types/Time/TimeRange";
import LocalStorage from "../../../UI/Utils/LocalStorage";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

const NOW: Date = new Date("2026-11-24T12:00:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ME: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const SERVICE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

// The project's split exceptions, and one merged into the first of them.
const SPLIT_A_ID: string = "90000000-0000-4000-8000-00000000000a";
const SPLIT_B_ID: string = "90000000-0000-4000-8000-00000000000b";
const MERGED_IN_ID: string = "90000000-0000-4000-8000-00000000000c";
const SPLIT_FINGERPRINTS: Array<string> = [
  "fp-split-a",
  "fp-split-b",
  "fp-merged-into-split-a",
];

const SPLIT_FILTER: string = "split=scrub-rule";
const TOGGLE_TEST_ID: string = "exceptions-split-by-scrub-rule";
const COUNT_TEST_ID: string = "exceptions-split-by-scrub-rule-count";
const PENDING_TEST_ID: string = "exceptions-split-by-scrub-rule-count-pending";
const ASSIGNED_TEST_ID: string = "exceptions-assigned-to-me";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function defer(): Deferred {
  let resolve: () => void = (): void => {};
  const promise: Promise<void> = new Promise<void>((res: () => void) => {
    resolve = res;
  });
  return { promise, resolve };
}

/*
 * How the project's split exceptions are counted: how many, or a failure.
 * When the gate is set, the count waits for it.
 */
let splitCount: number | Error = 3;
let splitCountGate: Deferred | null = null;
/*
 * How many of the list's own exceptions a scrub rule split - the toggle's
 * figure (#11116): a number, a failure, or worked out from the list's
 * query. When the gate is set, each such count waits for it.
 */
let listSplitCount:
  | number
  | Error
  | ((query: Record<string, unknown>) => number) = 2;
let listSplitCountGate: Deferred | null = null;
// When set, the fingerprints of the split ones wait for it.
let fingerprintGate: Deferred | null = null;
let fingerprintReadFails: boolean = false;
// The fingerprints an attribute filter resolves to.
let scopeFingerprints: Array<string> = [];

interface ReadArgs {
  modelType: unknown;
  query: Record<string, unknown>;
  select: unknown;
  sort: Record<string, unknown>;
  limit: number;
  skip: number;
}

function exception(id: string, fingerprint: string): TelemetryException {
  const row: TelemetryException = new TelemetryException();
  row._id = id;
  row.fingerprint = fingerprint;
  return row;
}

function getListReads(): Array<ReadArgs> {
  return getListMock.mock.calls.map((call: Array<unknown>): ReadArgs => {
    return call[0] as ReadArgs;
  });
}

// The list's own reads: a page of rows with the columns a row draws.
function listReads(): Array<ReadArgs> {
  return getListReads().filter((args: ReadArgs): boolean => {
    return (
      args.modelType === TelemetryException &&
      args.select === EXCEPTION_LIST_SELECT
    );
  });
}

function lastListRead(): ReadArgs {
  const reads: Array<ReadArgs> = listReads();
  return reads[reads.length - 1]!;
}

// The chart's narrowing: the split ones' fingerprints, then those merged in.
function splitFingerprintReads(): Array<ReadArgs> {
  return getListReads().filter((args: ReadArgs): boolean => {
    return (
      args.select === SPLIT_FINGERPRINT_SELECT &&
      !("mergedIntoTelemetryExceptionId" in args.query)
    );
  });
}

function mergedInReads(): Array<ReadArgs> {
  return getListReads().filter((args: ReadArgs): boolean => {
    return (
      args.select === SPLIT_FINGERPRINT_SELECT &&
      "mergedIntoTelemetryExceptionId" in args.query
    );
  });
}

function countQueries(): Array<Record<string, unknown>> {
  return countMock.mock.calls.map(
    (call: Array<unknown>): Record<string, unknown> => {
      return (call[0] as ReadArgs).query;
    },
  );
}

// The query that counts the project's split exceptions, and nothing else.
function isSplitCount(query: Record<string, unknown>): boolean {
  return (
    Object.keys(query).sort().join(",") ===
      "projectId,splitFromTelemetryExceptionId" &&
    query["splitFromTelemetryExceptionId"] instanceof NotNull
  );
}

function splitCounts(): Array<Record<string, unknown>> {
  return countQueries().filter(isSplitCount);
}

/*
 * The toggle's figure: the list's own query with the split filter on - not
 * the project's count, nor an Error Class count (one class, as a word).
 */
function isListSplitCount(query: Record<string, unknown>): boolean {
  return (
    !isSplitCount(query) &&
    query["splitFromTelemetryExceptionId"] instanceof NotNull &&
    typeof query["errorClass"] !== "string"
  );
}

function listSplitCounts(): Array<Record<string, unknown>> {
  return countQueries().filter(isListSplitCount);
}

function lastListSplitCount(): Record<string, unknown> {
  const counts: Array<Record<string, unknown>> = listSplitCounts();
  return counts[counts.length - 1]!;
}

/*
 * The Error Class facet's counts: one per class, from the list's query, each
 * naming its class as a word (the list's own carries the lens's clause).
 */
function errorClassCounts(): Array<Record<string, unknown>> {
  return countQueries().filter((query: Record<string, unknown>): boolean => {
    return typeof query["errorClass"] === "string";
  });
}

function postsTo(path: string): Array<Record<string, unknown>> {
  return postMock.mock.calls
    .filter((call: Array<unknown>): boolean => {
      return String((call[0] as { url: unknown }).url).endsWith(path);
    })
    .map((call: Array<unknown>): Record<string, unknown> => {
      return (call[0] as { data: Record<string, unknown> }).data;
    });
}

function histogramReads(): Array<Record<string, unknown>> {
  return postsTo("/telemetry/exceptions/histogram");
}

function lastHistogramRead(): Record<string, unknown> {
  const reads: Array<Record<string, unknown>> = histogramReads();
  return reads[reads.length - 1]!;
}

// One facet read: the request for every facet nothing is chosen in.
function facetReads(): Array<Record<string, unknown>> {
  return postsTo("/telemetry/exceptions/facets").filter(
    (body: Record<string, unknown>): boolean => {
      return (body["facetKeys"] as Array<string>).length > 1;
    },
  );
}

function lastFacetRead(): Record<string, unknown> {
  const reads: Array<Record<string, unknown>> = facetReads();
  return reads[reads.length - 1]!;
}

function isNarrowedToSplitOnes(read: ReadArgs): boolean {
  return read.query["splitFromTelemetryExceptionId"] instanceof NotNull;
}

function params(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

async function settle(): Promise<void> {
  for (let round: number = 0; round < 8; round++) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

async function openAt(
  search: string,
  element: React.ReactElement = <ExceptionsViewer />,
): Promise<RenderResult> {
  window.history.replaceState({}, "", `/dashboard/project/exceptions${search}`);
  let view: RenderResult | null = null;
  await act(async () => {
    view = render(element);
  });
  await settle();
  return view!;
}

/*
 * The toolbar the viewer last handed TelemetryViewer, drawn on its own,
 * and what `look` makes of it.
 */
async function inToolbar<T>(
  look: (toolbar: HTMLElement) => T | Promise<T>,
): Promise<T> {
  controlProps = null;
  let view: RenderResult | null = null;
  await act(async () => {
    view = render(viewerProps.toolbarLeadingActions);
  });
  try {
    return await look(view!.container);
  } finally {
    view!.unmount();
  }
}

function byTestId(toolbar: HTMLElement, testId: string): HTMLElement | null {
  return toolbar.querySelector(`[data-testid="${testId}"]`);
}

interface DrawnToggle {
  isShown: boolean;
  isPressed: boolean | null;
  count: string | null;
  text: string;
}

// The toggle as the toolbar draws it now.
async function drawnToggle(): Promise<DrawnToggle> {
  return await inToolbar((toolbar: HTMLElement): DrawnToggle => {
    const toggle: HTMLElement | null = byTestId(toolbar, TOGGLE_TEST_ID);

    if (!toggle) {
      return { isShown: false, isPressed: null, count: null, text: "" };
    }

    return {
      isShown: true,
      isPressed: toggle.getAttribute("aria-pressed") === "true",
      count: byTestId(toggle, COUNT_TEST_ID)?.textContent ?? null,
      text: toggle.textContent || "",
    };
  });
}

// The toggle as the toolbar draws it now, kept apart from the page.
async function toggleElement(): Promise<HTMLElement | null> {
  return await inToolbar((toolbar: HTMLElement): HTMLElement | null => {
    const toggle: HTMLElement | null = byTestId(toolbar, TOGGLE_TEST_ID);
    return toggle ? (toggle.cloneNode(true) as HTMLElement) : null;
  });
}

// Whether the toggle holds a figure's room while its figure is counted.
function isFigurePending(toggle: HTMLElement | null): boolean {
  return Boolean(toggle?.querySelector(`[data-testid="${PENDING_TEST_ID}"]`));
}

async function pressSplitToggle(): Promise<void> {
  await inToolbar(async (toolbar: HTMLElement): Promise<void> => {
    const toggle: HTMLElement | null = byTestId(toolbar, TOGGLE_TEST_ID);
    expect(toggle).not.toBeNull();
    await act(async () => {
      fireEvent.click(toggle!);
    });
  });
  await settle();
}

// The saved-views control as the viewer last drew it.
async function drawnControl(): Promise<any> {
  return await inToolbar((): any => {
    return controlProps;
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.history.replaceState({}, "", "/");
  viewerProps = null;
  controlProps = null;
  splitCount = 3;
  splitCountGate = null;
  listSplitCount = 2;
  listSplitCountGate = null;
  // Each test is a page load in a browser that has seen no project before.
  forgetRememberedSplitExceptions();
  window.localStorage.clear();
  fingerprintGate = null;
  fingerprintReadFails = false;
  scopeFingerprints = [];

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(ME);

  getListMock.mockReset();
  countMock.mockReset();
  postMock.mockReset();
  analyticsGetListMock.mockReset();

  getListMock.mockImplementation(async (args: unknown) => {
    const read: ReadArgs = args as ReadArgs;

    if (read.select === SPLIT_FINGERPRINT_SELECT) {
      if (fingerprintGate) {
        await fingerprintGate.promise;
      }
      if (fingerprintReadFails) {
        throw new Error("The split exceptions could not be read");
      }
      if ("mergedIntoTelemetryExceptionId" in read.query) {
        return {
          data: [exception(MERGED_IN_ID, "fp-merged-into-split-a")],
          count: 1,
        };
      }
      return {
        data: [
          exception(SPLIT_A_ID, "fp-split-a"),
          exception(SPLIT_B_ID, "fp-split-b"),
        ],
        count: 2,
      };
    }

    return { data: [], count: 0 };
  });

  countMock.mockImplementation(async (args: unknown) => {
    const query: Record<string, unknown> = (args as ReadArgs).query;

    if (isSplitCount(query)) {
      if (splitCountGate) {
        await splitCountGate.promise;
      }
      if (splitCount instanceof Error) {
        throw splitCount;
      }
      return splitCount;
    }

    if (isListSplitCount(query)) {
      if (listSplitCountGate) {
        await listSplitCountGate.promise;
      }
      if (listSplitCount instanceof Error) {
        throw listSplitCount;
      }
      return typeof listSplitCount === "function"
        ? listSplitCount(query)
        : listSplitCount;
    }

    return 0;
  });

  analyticsGetListMock.mockImplementation(async (args: unknown) => {
    if ((args as ReadArgs).modelType !== ExceptionInstance) {
      return { data: [], count: 0 };
    }
    return {
      data: scopeFingerprints.map((fingerprint: string): ExceptionInstance => {
        const instance: ExceptionInstance = new ExceptionInstance();
        instance.fingerprint = fingerprint;
        return instance;
      }),
      count: scopeFingerprints.length,
    };
  });

  postMock.mockImplementation(async () => {
    return { data: { facets: {}, buckets: [], attributes: [] } };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("Split by a scrub rule shows only for a project with split pairs", () => {
  test("a project with some: the toggle, off, with how many of the list's it narrows to", async () => {
    await openAt("");

    const toggle: DrawnToggle = await drawnToggle();
    expect(toggle.isShown).toBe(true);
    expect(toggle.isPressed).toBe(false);
    expect(toggle.count).toBe("2");
    expect(toggle.text).toBe("Split by a scrub rule2");
    // Off, the list is every exception, as it always was.
    expect(isNarrowedToSplitOnes(lastListRead())).toBe(false);
  });

  test("a project with none: no toggle at all", async () => {
    splitCount = 0;

    await openAt("");

    expect((await drawnToggle()).isShown).toBe(false);
    // Assigned to me is there as ever.
    await inToolbar((toolbar: HTMLElement): void => {
      expect(byTestId(toolbar, ASSIGNED_TEST_ID)).not.toBeNull();
    });
  });

  test("a count that fails: no toggle, and the list reads as usual", async () => {
    splitCount = new Error("Server Error");

    await openAt("");

    expect((await drawnToggle()).isShown).toBe(false);
    expect(listReads()).toHaveLength(1);
    expect(viewerProps.error).toBeUndefined();
  });

  test("while it is counted: no toggle, until the count says there are some", async () => {
    splitCountGate = defer();

    await openAt("");

    expect((await drawnToggle()).isShown).toBe(false);
    // The list does not wait for the count.
    expect(listReads()).toHaveLength(1);

    await act(async () => {
      splitCountGate!.resolve();
    });
    await settle();

    expect(await drawnToggle()).toEqual({
      isShown: true,
      isPressed: false,
      count: "2",
      text: "Split by a scrub rule2",
    });
    // The count landing reads nothing again.
    expect(listReads()).toHaveLength(1);
  });

  test("whether the project has any is counted once, by the split column, for the project", async () => {
    await openAt("");

    expect(splitCounts()).toHaveLength(1);
    expect(String(splitCounts()[0]!["projectId"])).toBe(PROJECT_ID.toString());

    // Nothing the reader changes counts it again.
    await act(async () => {
      viewerProps.onTimeRangeChange({ range: TimeRange.PAST_ONE_WEEK });
    });
    await settle();
    await pressSplitToggle();
    await pressSplitToggle();

    expect(splitCounts()).toHaveLength(1);
  });

  test("it sits beside Assigned to me and is drawn as it is: a pressed button, its words, then its count", async () => {
    await openAt("");

    await inToolbar((toolbar: HTMLElement): void => {
      const assigned: HTMLElement = byTestId(toolbar, ASSIGNED_TEST_ID)!;
      const split: HTMLElement = byTestId(toolbar, TOGGLE_TEST_ID)!;

      expect(assigned.nextElementSibling).toBe(split);
      // The sort menu comes right after it, as it came after Assigned to me.
      const sort: HTMLElement = byTestId(toolbar, "exceptions-sort")!;
      const next: Element = split.nextElementSibling!;
      expect(next === sort || next.contains(sort)).toBe(true);

      expect(split.tagName).toBe("BUTTON");
      expect(split).toHaveAttribute("type", "button");
      expect(split).toHaveAttribute("aria-pressed", "false");
      expect(split.className).toBe(assigned.className);
      expect(split).toHaveAttribute(
        "title",
        "Only the exceptions a scrub rule split from another one, each pair once. Open one to merge the two.",
      );

      // Its words, then its count with nothing written between them.
      expect(split.childNodes).toHaveLength(2);
      expect(split.childNodes[0]!.textContent).toBe("Split by a scrub rule");
      const count: HTMLElement = byTestId(split, COUNT_TEST_ID)!;
      expect(split.childNodes[1]).toBe(count);
      expect(count).toHaveClass("tabular-nums");
      // A figure in the button's own colour, never a chip of its own.
      expect(count.className).not.toMatch(/\bbg-|\brounded/);
    });
  });
});

describe("pressing it", () => {
  test("narrows the list to the split ones, from the first page, and the address bar says so", async () => {
    await openAt("?page=3");
    expect(lastListRead().skip).toBe(100);

    await pressSplitToggle();

    const read: ReadArgs = lastListRead();
    expect(isNarrowedToSplitOnes(read)).toBe(true);
    expect(read.skip).toBe(0);
    // Each pair once, by its split one, in the list's status and window.
    expect(read.query["isResolved"]).toBe(false);
    expect(read.query["lastSeenAt"]).toBeDefined();
    expect(params().get("split")).toBe("scrub-rule");
    expect(params().get("page")).toBeNull();

    const toggle: DrawnToggle = await drawnToggle();
    expect(toggle.isPressed).toBe(true);
    expect(toggle.count).toBe("2");
  });

  test("pressing it again widens the list again, and the address bar forgets it", async () => {
    await openAt("");

    await pressSplitToggle();
    await pressSplitToggle();

    expect(isNarrowedToSplitOnes(lastListRead())).toBe(false);
    expect(lastListRead().query).not.toHaveProperty(
      "splitFromTelemetryExceptionId",
    );
    expect(params().get("split")).toBeNull();
    expect((await drawnToggle()).isPressed).toBe(false);
  });

  test("each press reads the list once, and the chart and the facets once", async () => {
    await openAt("");
    expect(listReads()).toHaveLength(1);
    expect(histogramReads()).toHaveLength(1);
    expect(facetReads()).toHaveLength(1);

    await pressSplitToggle();

    expect(listReads()).toHaveLength(2);
    expect(histogramReads()).toHaveLength(2);
    expect(facetReads()).toHaveLength(2);

    await pressSplitToggle();

    expect(listReads()).toHaveLength(3);
    expect(histogramReads()).toHaveLength(3);
    expect(facetReads()).toHaveLength(3);
  });

  test("the Error Class counts, read from the list's own rows, are narrowed with it", async () => {
    await openAt("");
    const before: number = errorClassCounts().length;
    expect(before).toBeGreaterThan(0);
    for (const query of errorClassCounts()) {
      expect(query).not.toHaveProperty("splitFromTelemetryExceptionId");
    }

    await pressSplitToggle();

    const after: Array<Record<string, unknown>> =
      errorClassCounts().slice(before);
    expect(after.length).toBe(before);
    for (const query of after) {
      expect(query["splitFromTelemetryExceptionId"]).toBeInstanceOf(NotNull);
    }
  });
});

describe("the chart and the facet counts count what the list lists", () => {
  test("off, they count every exception's occurrences, and nothing is read for them", async () => {
    await openAt("");

    expect(lastHistogramRead()).not.toHaveProperty("fingerprints");
    expect(lastFacetRead()).not.toHaveProperty("fingerprints");
    expect(splitFingerprintReads()).toHaveLength(0);
    expect(mergedInReads()).toHaveLength(0);
  });

  test("on, only the split ones' occurrences, and those of the exceptions merged into them", async () => {
    await openAt("");

    await pressSplitToggle();

    expect(lastHistogramRead()["fingerprints"]).toEqual(SPLIT_FINGERPRINTS);
    expect(lastFacetRead()["fingerprints"]).toEqual(SPLIT_FINGERPRINTS);

    // The split ones, then the exceptions merged into them, by their ids.
    expect(splitFingerprintReads()).toHaveLength(1);
    expect(
      splitFingerprintReads()[0]!.query["splitFromTelemetryExceptionId"],
    ).toBeInstanceOf(NotNull);
    expect(mergedInReads()).toHaveLength(1);
    const ids: Includes = mergedInReads()[0]!.query[
      "mergedIntoTelemetryExceptionId"
    ] as Includes;
    expect(ids.values).toEqual([SPLIT_A_ID, SPLIT_B_ID]);
  });

  test("nothing goes out before the fingerprints are in, and everything once they are", async () => {
    await openAt("");
    fingerprintGate = defer();
    const before: string = JSON.stringify([
      listReads().length,
      histogramReads().length,
      facetReads().length,
    ]);

    await pressSplitToggle();

    // Held, and read as loading meanwhile - not as an empty list or chart.
    expect(
      JSON.stringify([
        listReads().length,
        histogramReads().length,
        facetReads().length,
      ]),
    ).toBe(before);
    expect(viewerProps.isLoading).toBe(true);
    expect(viewerProps.histogramLoading).toBe(true);
    expect(viewerProps.facetLoading).toBe(true);

    await act(async () => {
      fingerprintGate!.resolve();
    });
    await settle();

    expect(listReads()).toHaveLength(2);
    expect(histogramReads()).toHaveLength(2);
    expect(facetReads()).toHaveLength(2);
    // Never once with a stand-in for the fingerprints.
    expect(JSON.stringify(postMock.mock.calls)).not.toContain(
      NO_MATCH_FINGERPRINT,
    );
  });

  test("the fingerprints are read once: off and on again reads none", async () => {
    await openAt("");

    await pressSplitToggle();
    await pressSplitToggle();
    expect(lastHistogramRead()).not.toHaveProperty("fingerprints");

    await pressSplitToggle();

    expect(splitFingerprintReads()).toHaveLength(1);
    expect(mergedInReads()).toHaveLength(1);
    expect(lastHistogramRead()["fingerprints"]).toEqual(SPLIT_FINGERPRINTS);
  });

  test("a fingerprint read that fails counts nothing, never every exception under the filter: the chart and the sidebar say why", async () => {
    fingerprintReadFails = true;

    await openAt("");
    const histogramBefore: number = histogramReads().length;
    const facetsBefore: number = facetReads().length;
    await pressSplitToggle();

    // No chart or facet read with a stand-in for the fingerprints: none at all.
    expect(histogramReads()).toHaveLength(histogramBefore);
    expect(facetReads()).toHaveLength(facetsBefore);
    expect(JSON.stringify(postMock.mock.calls)).not.toContain(
      NO_MATCH_FINGERPRINT,
    );
    // Each says so in its own place, in the server's words, with Try again.
    expect(viewerProps.histogramError).toEqual({
      kind: "failed",
      message: "The split exceptions could not be read",
    });
    expect(viewerProps.facetError).toEqual(viewerProps.histogramError);
    expect(viewerProps.histogramLoading).toBe(false);
    expect(viewerProps.facetLoading).toBe(false);
    expect(viewerProps.histogramBuckets).toEqual([]);
    // The list needs none: it is narrowed by its own column, and read once.
    expect(listReads()).toHaveLength(2);
    expect(isNarrowedToSplitOnes(lastListRead())).toBe(true);
    expect(viewerProps.isLoading).toBe(false);
  });

  test("with an attribute filter too, they count what both keep", async () => {
    scopeFingerprints = ["fp-split-a", "fp-not-split"];

    await openAt(
      `?filters=${encodeURIComponent(
        JSON.stringify([["attributes.http.route", "/checkout"]]),
      )}`,
    );
    expect(lastHistogramRead()["fingerprints"]).toEqual([
      "fp-split-a",
      "fp-not-split",
    ]);

    await pressSplitToggle();

    expect(lastHistogramRead()["fingerprints"]).toEqual(["fp-split-a"]);
    expect(lastFacetRead()["fingerprints"]).toEqual(["fp-split-a"]);
    // The list keeps both: the filter's exceptions, and only split ones.
    const read: ReadArgs = lastListRead();
    expect(isNarrowedToSplitOnes(read)).toBe(true);
    expect(read.query["fingerprint"]).toEqual(
      new Includes(["fp-split-a", "fp-not-split"]),
    );
  });
});

describe("the address bar", () => {
  test("a link with split=scrub-rule opens the list narrowed, the toggle pressed, and keeps it", async () => {
    await openAt(`?${SPLIT_FILTER}`);

    // Read once, narrowed: never every exception first.
    expect(listReads()).toHaveLength(1);
    expect(isNarrowedToSplitOnes(lastListRead())).toBe(true);
    // The chart's first read is narrowed too.
    expect(histogramReads()).toHaveLength(1);
    expect(lastHistogramRead()["fingerprints"]).toEqual(SPLIT_FINGERPRINTS);
    expect(params().get("split")).toBe("scrub-rule");

    expect(await drawnToggle()).toEqual({
      isShown: true,
      isPressed: true,
      count: "2",
      text: "Split by a scrub rule2",
    });
  });

  test("pressed, then reloaded: the list opens as it was left", async () => {
    await openAt("?status=all");
    await pressSplitToggle();
    const left: string = window.location.search;
    expect(left).toContain(SPLIT_FILTER);

    cleanup();
    getListMock.mockClear();
    await openAt(left);

    expect(listReads()).toHaveLength(1);
    expect(isNarrowedToSplitOnes(lastListRead())).toBe(true);
    expect(lastListRead().query).not.toHaveProperty("isResolved");
    expect((await drawnToggle()).isPressed).toBe(true);
  });

  test("a value it does not know opens the list as ever, and is dropped", async () => {
    await openAt("?split=yes");

    expect(isNarrowedToSplitOnes(lastListRead())).toBe(false);
    expect(params().get("split")).toBeNull();
    expect((await drawnToggle()).isPressed).toBe(false);
  });

  test("a link that asks for it where no pair is left keeps it on, and shows the toggle pressed with 0", async () => {
    splitCount = 0;
    listSplitCount = 0;

    await openAt(`?${SPLIT_FILTER}`);

    // Not narrowed to nothing by a filter nobody can see.
    expect(isNarrowedToSplitOnes(lastListRead())).toBe(true);
    expect(await drawnToggle()).toEqual({
      isShown: true,
      isPressed: true,
      count: "0",
      text: "Split by a scrub rule0",
    });

    // Pressed, the list widens, and the toggle goes: there is nothing to list.
    await pressSplitToggle();

    expect(isNarrowedToSplitOnes(lastListRead())).toBe(false);
    expect(params().get("split")).toBeNull();
    expect((await drawnToggle()).isShown).toBe(false);
  });

  test("a link that asks for it while the counts fail shows it pressed, without a figure", async () => {
    splitCount = new Error("Server Error");
    listSplitCount = new Error("Server Error");

    await openAt(`?${SPLIT_FILTER}`);

    expect(await drawnToggle()).toEqual({
      isShown: true,
      isPressed: true,
      count: null,
      text: "Split by a scrub rule",
    });
    expect(isFigurePending(await toggleElement())).toBe(false);
  });

  test("a link that asks for it while the counts run keeps a figure's room, then shows the list's figure", async () => {
    splitCount = new Error("Server Error");
    listSplitCount = 4;
    listSplitCountGate = defer();

    await openAt(`?${SPLIT_FILTER}`);

    expect((await drawnToggle()).count).toBeNull();
    expect((await drawnToggle()).isPressed).toBe(true);
    expect(isFigurePending(await toggleElement())).toBe(true);

    await act(async () => {
      listSplitCountGate!.resolve();
    });
    await settle();

    // The project's count failed; the list's figure is the list's.
    expect((await drawnToggle()).count).toBe("4");
    expect(isFigurePending(await toggleElement())).toBe(false);
  });
});

describe("only the Exceptions list itself counts and offers it", () => {
  test("a service's exceptions: no count, no toggle, and a link's split=scrub-rule is dropped", async () => {
    await openAt(
      `?${SPLIT_FILTER}`,
      <ExceptionsViewer primaryEntityId={SERVICE_ID} />,
    );

    expect(splitCounts()).toHaveLength(0);
    expect(isNarrowedToSplitOnes(lastListRead())).toBe(false);
    expect((await drawnToggle()).isShown).toBe(false);
    expect(params().get("split")).toBeNull();
  });

  test("an inventory item's exceptions: no count, no toggle", async () => {
    await openAt(
      "",
      <ExceptionsViewer entityKeysFilter={["k8s.pod:checkout-7d9f"]} />,
    );

    expect(splitCounts()).toHaveLength(0);
    expect((await drawnToggle()).isShown).toBe(false);
  });

  test("a list its host owns: no count, no toggle, and the address bar is not read", async () => {
    await openAt(
      `?${SPLIT_FILTER}`,
      <ExceptionsViewer disableUrlSync={true} />,
    );

    expect(splitCounts()).toHaveLength(0);
    expect(isNarrowedToSplitOnes(lastListRead())).toBe(false);
    expect((await drawnToggle()).isShown).toBe(false);
    // Nor written: the host's address bar is the host's.
    expect(params().get("split")).toBe("scrub-rule");
  });
});

describe("saved views keep it as they keep Assigned to me", () => {
  test("Save keeps it on, and off", async () => {
    await openAt(`?${SPLIT_FILTER}`);
    expect(
      (await drawnControl()).captureCurrentState().exceptionSplitByScrubRule,
    ).toBe(true);

    await pressSplitToggle();
    expect(
      (await drawnControl()).captureCurrentState().exceptionSplitByScrubRule,
    ).toBe(false);
  });

  test("a view that has it narrows the list, presses the toggle and writes the address bar", async () => {
    await openAt("");

    const view: TelemetrySavedViewState = {
      exceptionStatus: "all",
      exceptionSplitByScrubRule: true,
    };
    const control: any = await drawnControl();
    await act(async () => {
      control.applyState(view);
    });
    await settle();

    expect(isNarrowedToSplitOnes(lastListRead())).toBe(true);
    expect(lastListRead().query).not.toHaveProperty("isResolved");
    expect(params().get("split")).toBe("scrub-rule");
    expect((await drawnToggle()).isPressed).toBe(true);
    expect(lastHistogramRead()["fingerprints"]).toEqual(SPLIT_FINGERPRINTS);
  });

  test("a view saved before it existed opens with it off", async () => {
    await openAt(`?${SPLIT_FILTER}`);
    expect(isNarrowedToSplitOnes(lastListRead())).toBe(true);

    const savedBefore: TelemetrySavedViewState = {
      search: "",
      filters: [],
      timeRange: { range: TimeRange.PAST_ONE_WEEK },
      pageSize: 50,
      exceptionStatus: "resolved",
      exceptionClassScope: "issues",
      exceptionAssignedToMe: true,
      exceptionSort: "last-seen",
    };
    const control: any = await drawnControl();
    await act(async () => {
      control.applyState(savedBefore);
    });
    await settle();

    expect(isNarrowedToSplitOnes(lastListRead())).toBe(false);
    expect(lastListRead().query["isResolved"]).toBe(true);
    expect(params().get("split")).toBeNull();
    expect(params().get("assigned")).toBe("me");
    // The project still has pairs: the toggle stays, off.
    expect(await drawnToggle()).toMatchObject({
      isShown: true,
      isPressed: false,
    });
  });

  test("Clear view, the empty state, turns it off", async () => {
    await openAt(`?${SPLIT_FILTER}`);

    const control: any = await drawnControl();
    await act(async () => {
      control.applyState({});
    });
    await settle();

    expect(isNarrowedToSplitOnes(lastListRead())).toBe(false);
    expect(params().get("split")).toBeNull();
  });

  test("a link that asks for it keeps the project's default view off it, and lays it over a view it names", async () => {
    await openAt(`?${SPLIT_FILTER}`);
    let control: any = await drawnControl();
    expect(control.hasInitialUrlState).toBe(true);
    expect(control.initialStateOverrides).toEqual({
      exceptionSplitByScrubRule: true,
    });

    cleanup();
    await openAt(`?savedView=view-split-pairs&${SPLIT_FILTER}`);
    control = await drawnControl();
    expect(control.initialSavedViewId).toBe("view-split-pairs");
    expect(control.initialStateOverrides).toEqual({
      exceptionSplitByScrubRule: true,
    });

    // A link that does not ask for it lays nothing of it over a view.
    cleanup();
    await openAt("?savedView=view-split-pairs");
    expect((await drawnControl()).initialStateOverrides).toBeUndefined();
  });
});

// Picks a status pill (Unresolved, Resolved, Archived), as a reader does.
async function pickStatus(label: string): Promise<void> {
  await inToolbar(async (toolbar: HTMLElement): Promise<void> => {
    const pill: HTMLButtonElement | undefined = Array.from(
      toolbar.querySelectorAll("button"),
    ).find((button: HTMLButtonElement): boolean => {
      return button.textContent === label;
    });
    expect(pill).toBeDefined();
    await act(async () => {
      fireEvent.click(pill!);
    });
  });
  await settle();
}

// Where the toggle sits: right after Assigned to me, with the Sort menu after it.
async function expectInItsPlace(): Promise<void> {
  await inToolbar((toolbar: HTMLElement): void => {
    const assigned: HTMLElement = byTestId(toolbar, ASSIGNED_TEST_ID)!;
    const split: HTMLElement | null = byTestId(toolbar, TOGGLE_TEST_ID);
    const sort: HTMLElement = byTestId(toolbar, "exceptions-sort")!;

    expect(split).not.toBeNull();
    expect(assigned.nextElementSibling).toBe(split);
    const next: Element = split!.nextElementSibling!;
    expect(next === sort || next.contains(sort)).toBe(true);
  });
}

function toggleFigure(toggle: HTMLElement | null): HTMLElement | null {
  return toggle?.querySelector(`[data-testid="${COUNT_TEST_ID}"]`) || null;
}

describe("its figure is what turning it on lists (#11116)", () => {
  test("counted with the list's own query - its status, its time window, its search, Assigned to me - and the filter on", async () => {
    await openAt(
      `?status=resolved&assigned=me&search=${encodeURIComponent("cart")}`,
    );

    const count: Record<string, unknown> = lastListSplitCount();
    const read: Record<string, unknown> = lastListRead().query;

    expect(count["splitFromTelemetryExceptionId"]).toBeInstanceOf(NotNull);
    // Off, the list has no split filter; everything else is the list's.
    expect(read).not.toHaveProperty("splitFromTelemetryExceptionId");
    const rest: Record<string, unknown> = { ...count };
    delete rest["splitFromTelemetryExceptionId"];
    expect(rest).toEqual(read);
    expect(count["isResolved"]).toBe(true);
    expect(count["isArchived"]).toBe(false);
    expect(count["lastSeenAt"]).toBeDefined();
    expect(String(count["assignToUserId"])).toBe(ME.toString());
    expect(count["message"]).toBeDefined();
  });

  test("its figure follows the status and the time range, as the list under it does", async () => {
    listSplitCount = (query: Record<string, unknown>): number => {
      if (query["isResolved"] === true) {
        return 1;
      }
      if (query["isArchived"] === true) {
        return 0;
      }
      return "isResolved" in query ? 2 : 3;
    };

    await openAt("");
    expect((await drawnToggle()).count).toBe("2");

    await pickStatus("Resolved");
    expect((await drawnToggle()).count).toBe("1");

    await pickStatus("Unresolved");
    expect((await drawnToggle()).count).toBe("2");

    // A wider window: counted again, with the list's new window.
    const before: unknown = lastListSplitCount()["lastSeenAt"];
    await act(async () => {
      viewerProps.onTimeRangeChange({ range: TimeRange.PAST_ONE_WEEK });
    });
    await settle();
    expect(lastListSplitCount()["lastSeenAt"]).not.toEqual(before);
    expect(lastListSplitCount()["lastSeenAt"]).toEqual(
      lastListRead().query["lastSeenAt"],
    );
  });

  test("a status that holds none of the project's pairs keeps the toggle where it is, saying 0", async () => {
    listSplitCount = (query: Record<string, unknown>): number => {
      return query["isArchived"] === true ? 0 : 2;
    };

    await openAt("");
    await expectInItsPlace();

    await pickStatus("Archived");

    expect(await drawnToggle()).toEqual({
      isShown: true,
      isPressed: false,
      count: "0",
      text: "Split by a scrub rule0",
    });
    await expectInItsPlace();
  });

  test("pressed, its figure is the list's own total: the count asks what the list reads", async () => {
    await openAt("");

    await pressSplitToggle();

    const count: Record<string, unknown> = lastListSplitCount();
    const read: Record<string, unknown> = lastListRead().query;

    expect(read["splitFromTelemetryExceptionId"]).toBeInstanceOf(NotNull);
    expect(count).toEqual(read);
  });

  test("while the next figure is counted, the last one stays, dimmed - nothing flickers or moves - then the new one", async () => {
    listSplitCount = (query: Record<string, unknown>): number => {
      return query["isResolved"] === true ? 7 : 2;
    };

    await openAt("");
    expect((await drawnToggle()).count).toBe("2");

    listSplitCountGate = defer();
    await pickStatus("Resolved");

    const counting: HTMLElement | null = toggleFigure(await toggleElement());
    expect(counting?.textContent).toBe("2");
    expect(counting?.className).toContain("opacity-60");
    await expectInItsPlace();

    await act(async () => {
      listSplitCountGate!.resolve();
    });
    await settle();

    const counted: HTMLElement | null = toggleFigure(await toggleElement());
    expect(counted?.textContent).toBe("7");
    expect(counted?.className).not.toContain("opacity-60");
  });

  test("counted once for each list the reader asks for, and only once that list's read goes out", async () => {
    await openAt("");
    expect(listSplitCounts()).toHaveLength(1);

    await act(async () => {
      viewerProps.onTimeRangeChange({ range: TimeRange.PAST_ONE_WEEK });
    });
    await settle();
    expect(listSplitCounts()).toHaveLength(2);

    // Pressed: held with the list while the split ones' fingerprints are read.
    fingerprintGate = defer();
    await pressSplitToggle();
    expect(listSplitCounts()).toHaveLength(2);

    await act(async () => {
      fingerprintGate!.resolve();
    });
    await settle();
    expect(listSplitCounts()).toHaveLength(3);
    expect(lastListSplitCount()).toEqual(lastListRead().query);
  });

  test("a project with none is never counted again as its list changes", async () => {
    splitCount = 0;

    await openAt("");
    await act(async () => {
      viewerProps.onTimeRangeChange({ range: TimeRange.PAST_ONE_WEEK });
    });
    await settle();
    await pickStatus("Resolved");

    expect(listSplitCounts()).toHaveLength(0);
    expect((await drawnToggle()).isShown).toBe(false);
  });

  test("a figure that cannot be counted is left out, the toggle kept", async () => {
    listSplitCount = new Error("Server Error");

    await openAt("");

    expect(await drawnToggle()).toEqual({
      isShown: true,
      isPressed: false,
      count: null,
      text: "Split by a scrub rule",
    });
    expect(isFigurePending(await toggleElement())).toBe(false);
  });
});

describe("the toggle is drawn with the toolbar, and nothing after it moves (#11116)", () => {
  test("a project whose toggle showed before is drawn with it at once, its figure's room kept, before any count is in", async () => {
    rememberSplitExceptions(PROJECT_ID, true);
    splitCountGate = defer();
    listSplitCountGate = defer();

    await openAt("");

    expect(isFigurePending(await toggleElement())).toBe(true);
    await expectInItsPlace();

    await act(async () => {
      splitCountGate!.resolve();
      listSplitCountGate!.resolve();
    });
    await settle();

    // Where it was, its figure in its room.
    await expectInItsPlace();
    expect((await drawnToggle()).count).toBe("2");
    expect(isFigurePending(await toggleElement())).toBe(false);
  });

  test("the figure's room is a figure's: the figure itself, unseen and unread, under a quiet bar in the toggle's own colour", async () => {
    rememberSplitExceptions(PROJECT_ID, true);
    listSplitCountGate = defer();

    await openAt("");

    await inToolbar((toolbar: HTMLElement): void => {
      const toggle: HTMLElement = byTestId(toolbar, TOGGLE_TEST_ID)!;
      const pending: HTMLElement = byTestId(toggle, PENDING_TEST_ID)!;

      expect(pending).toHaveAttribute("aria-hidden", "true");
      // As wide as a figure: one, in the figure's own font, unseen.
      expect(pending.className).toContain("font-semibold");
      expect(pending.className).toContain("tabular-nums");
      const room: HTMLElement = pending.children[0] as HTMLElement;
      expect(room).toHaveClass("invisible");
      expect(room.textContent).toBe("0");
      const bar: HTMLElement = pending.children[1] as HTMLElement;
      expect(bar.className).toContain("bg-current");
      expect(bar.className).toContain("motion-safe:animate-pulse");
      // Its name is its words alone while it is counted.
      expect(
        within(toolbar).getByRole("button", { name: "Split by a scrub rule" }),
      ).toBe(toggle);
    });
  });

  test("remembered for the project's next page load, in the browser, and for that project alone", async () => {
    await openAt("");
    expect((await drawnToggle()).isShown).toBe(true);
    expect(
      LocalStorage.getItem(getSplitExceptionsHintKey(PROJECT_ID.toString())),
    ).toBe(true);

    // A new page load: what the page remembered is gone, the browser's is not.
    cleanup();
    forgetRememberedSplitExceptions();
    splitCountGate = defer();
    listSplitCountGate = defer();
    await openAt("");
    expect(isFigurePending(await toggleElement())).toBe(true);

    // Another project: nothing is remembered for it.
    cleanup();
    forgetRememberedSplitExceptions();
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(OTHER_PROJECT_ID);
    await openAt("");
    expect(await toggleElement()).toBeNull();
  });

  test("remembered for the visit when the browser keeps nothing, and nothing fails", async () => {
    // A browser whose storage refuses this list's key, as a private window may.
    const hintKey: string = getSplitExceptionsHintKey(PROJECT_ID.toString());
    const getItem: typeof LocalStorage.getItem = LocalStorage.getItem;
    const setItem: typeof LocalStorage.setItem = LocalStorage.setItem;
    jest
      .spyOn(LocalStorage, "getItem")
      .mockImplementation((key: string): ReturnType<typeof getItem> => {
        if (key === hintKey) {
          throw new Error("SecurityError");
        }
        return getItem.call(LocalStorage, key);
      });
    jest
      .spyOn(LocalStorage, "setItem")
      .mockImplementation(
        (key: string, value: Parameters<typeof setItem>[1]): void => {
          if (key === hintKey) {
            throw new Error("QuotaExceededError");
          }
          setItem.call(LocalStorage, key, value);
        },
      );

    await openAt("");
    expect((await drawnToggle()).isShown).toBe(true);
    expect(viewerProps.error).toBeUndefined();

    // Back to the list in the same visit: drawn at once.
    cleanup();
    splitCountGate = defer();
    listSplitCountGate = defer();
    await openAt("");
    expect(isFigurePending(await toggleElement())).toBe(true);
  });

  test("a count that finds none takes it away, and is remembered so", async () => {
    rememberSplitExceptions(PROJECT_ID, true);
    splitCount = 0;

    await openAt("");
    expect((await drawnToggle()).isShown).toBe(false);
    expect(
      LocalStorage.getItem(getSplitExceptionsHintKey(PROJECT_ID.toString())),
    ).toBe(false);

    cleanup();
    forgetRememberedSplitExceptions();
    countMock.mockClear();
    splitCountGate = defer();
    await openAt("");

    expect(await toggleElement()).toBeNull();
    expect(listSplitCounts()).toHaveLength(0);
  });

  test("a count that fails keeps what was remembered", async () => {
    rememberSplitExceptions(PROJECT_ID, true);
    splitCount = new Error("Server Error");

    await openAt("");

    expect(await drawnToggle()).toMatchObject({ isShown: true, count: "2" });
  });

  test("a project never seen draws it once its count says there are some, its figure's room kept until the list's count is in", async () => {
    splitCountGate = defer();
    listSplitCountGate = defer();

    await openAt("");
    expect(await toggleElement()).toBeNull();

    await act(async () => {
      splitCountGate!.resolve();
    });
    await settle();
    expect(isFigurePending(await toggleElement())).toBe(true);
    await expectInItsPlace();

    await act(async () => {
      listSplitCountGate!.resolve();
    });
    await settle();
    expect((await drawnToggle()).count).toBe("2");
  });
});

describe("a read of the split ones' fingerprints that fails is read again (#11116)", () => {
  async function pressedWithAFailedRead(): Promise<void> {
    fingerprintReadFails = true;
    await openAt("");
    await pressSplitToggle();
    expect(splitFingerprintReads()).toHaveLength(1);
    expect(viewerProps.histogramError).toBeDefined();
    fingerprintReadFails = false;
  }

  test("on the list's next change: each read goes out once, with the fingerprints, and the chart and the sidebar count again", async () => {
    await pressedWithAFailedRead();
    const lists: number = listReads().length;
    const histograms: number = histogramReads().length;
    const facets: number = facetReads().length;

    await act(async () => {
      viewerProps.onTimeRangeChange({ range: TimeRange.PAST_ONE_WEEK });
    });
    await settle();

    expect(splitFingerprintReads()).toHaveLength(2);
    expect(viewerProps.histogramError).toBeUndefined();
    expect(viewerProps.facetError).toBeUndefined();
    expect(lastHistogramRead()["fingerprints"]).toEqual(SPLIT_FINGERPRINTS);
    expect(lastFacetRead()["fingerprints"]).toEqual(SPLIT_FINGERPRINTS);
    expect(listReads()).toHaveLength(lists + 1);
    expect(histogramReads()).toHaveLength(histograms + 1);
    expect(facetReads()).toHaveLength(facets + 1);
  });

  test("on a change of status too", async () => {
    await pressedWithAFailedRead();

    await pickStatus("Resolved");

    expect(splitFingerprintReads()).toHaveLength(2);
    expect(lastHistogramRead()["fingerprints"]).toEqual(SPLIT_FINGERPRINTS);
  });

  test("on Try again in the chart's card", async () => {
    await pressedWithAFailedRead();
    const lists: number = listReads().length;

    await act(async () => {
      viewerProps.onRetryHistogram();
    });
    await settle();

    expect(splitFingerprintReads()).toHaveLength(2);
    expect(viewerProps.histogramError).toBeUndefined();
    expect(viewerProps.facetError).toBeUndefined();
    expect(lastHistogramRead()["fingerprints"]).toEqual(SPLIT_FINGERPRINTS);
    // The list needed none: it is not read again for them.
    expect(listReads()).toHaveLength(lists);
  });

  test("on Try again in the sidebar's note", async () => {
    await pressedWithAFailedRead();

    await act(async () => {
      viewerProps.onRetryFacets();
    });
    await settle();

    expect(splitFingerprintReads()).toHaveLength(2);
    expect(viewerProps.facetError).toBeUndefined();
    expect(lastFacetRead()["fingerprints"]).toEqual(SPLIT_FINGERPRINTS);
  });

  test("when it is turned off and on again", async () => {
    await pressedWithAFailedRead();

    // Off: the chart counts every exception again, and says nothing of it.
    await pressSplitToggle();
    expect(viewerProps.histogramError).toBeUndefined();
    expect(viewerProps.facetError).toBeUndefined();
    expect(lastHistogramRead()).not.toHaveProperty("fingerprints");

    await pressSplitToggle();
    expect(splitFingerprintReads()).toHaveLength(2);
    expect(lastHistogramRead()["fingerprints"]).toEqual(SPLIT_FINGERPRINTS);
  });

  test("never again for the same list on its own: a failure is said once, not read in a loop", async () => {
    await pressedWithAFailedRead();

    await settle();
    await settle();

    expect(splitFingerprintReads()).toHaveLength(1);
    expect(viewerProps.histogramError).toBeDefined();
  });

  test("one that fails again says so again, for the new list, and nothing is read with a stand-in", async () => {
    await pressedWithAFailedRead();
    fingerprintReadFails = true;

    await act(async () => {
      viewerProps.onTimeRangeChange({ range: TimeRange.PAST_ONE_WEEK });
    });
    await settle();

    expect(splitFingerprintReads()).toHaveLength(2);
    expect(viewerProps.histogramError).toEqual({
      kind: "failed",
      message: "The split exceptions could not be read",
    });
    expect(JSON.stringify(postMock.mock.calls)).not.toContain(
      NO_MATCH_FINGERPRINT,
    );
  });

  test("once they are in, they are kept: the list's next change reads none", async () => {
    await pressedWithAFailedRead();

    await act(async () => {
      viewerProps.onTimeRangeChange({ range: TimeRange.PAST_ONE_WEEK });
    });
    await settle();
    await pickStatus("Resolved");

    expect(splitFingerprintReads()).toHaveLength(2);
  });
});

describe("Try again, for the list they failed for (#11116)", () => {
  test("while it reads them, the chart and the sidebar wait for them, and the list is not held or read again", async () => {
    fingerprintReadFails = true;
    await openAt("");
    await pressSplitToggle();
    fingerprintReadFails = false;
    const lists: number = listReads().length;
    fingerprintGate = defer();

    await act(async () => {
      viewerProps.onRetryHistogram();
    });
    await settle();

    expect(viewerProps.histogramLoading).toBe(true);
    expect(viewerProps.histogramError).toBeUndefined();
    expect(viewerProps.facetLoading).toBe(true);
    expect(viewerProps.facetError).toBeUndefined();
    expect(viewerProps.isLoading).toBe(false);

    await act(async () => {
      fingerprintGate!.resolve();
    });
    await settle();

    expect(viewerProps.histogramLoading).toBe(false);
    expect(lastHistogramRead()["fingerprints"]).toEqual(SPLIT_FINGERPRINTS);
    expect(listReads()).toHaveLength(lists);
  });

  test("one that fails again says so again, and Try again is still there", async () => {
    fingerprintReadFails = true;
    await openAt("");
    await pressSplitToggle();

    await act(async () => {
      viewerProps.onRetryFacets();
    });
    await settle();

    expect(splitFingerprintReads()).toHaveLength(2);
    expect(viewerProps.facetError).toEqual({
      kind: "failed",
      message: "The split exceptions could not be read",
    });
    expect(viewerProps.histogramError).toEqual(viewerProps.facetError);
    expect(viewerProps.facetLoading).toBe(false);
    expect(typeof viewerProps.onRetryFacets).toBe("function");
    expect(JSON.stringify(postMock.mock.calls)).not.toContain(
      NO_MATCH_FINGERPRINT,
    );
  });
});
