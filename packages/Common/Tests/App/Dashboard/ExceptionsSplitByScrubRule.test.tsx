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
 * while a link or a saved view asks for it.
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
    useTelemetryEntityLookup: () => {
      return { names: {}, notFound: new Set<string>() };
    },
  };
});

import ExceptionsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsViewer";
import { EXCEPTION_LIST_SELECT } from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionListRead";
import { SPLIT_FINGERPRINT_SELECT } from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionSplitPairs";
import { NO_MATCH_FINGERPRINT } from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionsAttributeScope";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import Includes from "../../../Types/BaseDatabase/Includes";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import ObjectID from "../../../Types/ObjectID";
import TelemetrySavedViewState from "../../../Types/Telemetry/TelemetrySavedViewState";
import TimeRange from "../../../Types/Time/TimeRange";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

const NOW: Date = new Date("2026-11-24T12:00:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
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

// The Error Class facet's counts: one per class, from the list's query.
function errorClassCounts(): Array<Record<string, unknown>> {
  return countQueries().filter((query: Record<string, unknown>): boolean => {
    return "errorClass" in query;
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
  test("a project with some: the toggle, off, with how many it has", async () => {
    await openAt("");

    const toggle: DrawnToggle = await drawnToggle();
    expect(toggle.isShown).toBe(true);
    expect(toggle.isPressed).toBe(false);
    expect(toggle.count).toBe("3");
    expect(toggle.text).toBe("Split by a scrub rule3");
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
      count: "3",
      text: "Split by a scrub rule3",
    });
    // The count landing reads nothing again.
    expect(listReads()).toHaveLength(1);
  });

  test("it is counted once, by the split column, for the project", async () => {
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
    expect(toggle.count).toBe("3");
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

  test("a fingerprint read that fails counts nothing, never every exception under the filter", async () => {
    fingerprintReadFails = true;

    await openAt("");
    await pressSplitToggle();

    expect(lastHistogramRead()["fingerprints"]).toEqual([NO_MATCH_FINGERPRINT]);
    expect(lastFacetRead()["fingerprints"]).toEqual([NO_MATCH_FINGERPRINT]);
    // The list needs none: it is narrowed by its own column, and read once.
    expect(listReads()).toHaveLength(2);
    expect(isNarrowedToSplitOnes(lastListRead())).toBe(true);
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
      count: "3",
      text: "Split by a scrub rule3",
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

  test("a link that asks for it while the count fails or runs shows it pressed, without a count", async () => {
    splitCount = new Error("Server Error");

    await openAt(`?${SPLIT_FILTER}`);

    expect(await drawnToggle()).toEqual({
      isShown: true,
      isPressed: true,
      count: null,
      text: "Split by a scrub rule",
    });

    cleanup();
    splitCount = 4;
    splitCountGate = defer();
    await openAt(`?${SPLIT_FILTER}`);

    expect((await drawnToggle()).count).toBeNull();
    expect((await drawnToggle()).isPressed).toBe(true);

    await act(async () => {
      splitCountGate!.resolve();
    });
    await settle();

    expect((await drawnToggle()).count).toBe("4");
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
