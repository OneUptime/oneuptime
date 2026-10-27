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
import { act, cleanup, render, RenderResult } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4709, on the exceptions explorer: one read of the list, the chart,
 * the facets and the error-class counts per page load and per real change.
 *
 * It read every one of them twice on every load. The list query, the chart
 * and the facet requests were all keyed on the `@service:` resolution, an
 * object rebuilt when the project's service list landed a moment after
 * mount - with no `@service:` token it resolved to the same nothing, but a
 * new nothing. A link with an attribute filter (or an embed scoped by
 * entity key) read everything a third time: once with the no-match sentinel
 * while the instance scope's fingerprints were still out. And an embedding
 * page re-rendering with an equal scope (an ObjectID read from the URL in
 * the render, a stored query re-read on a background refresh) read it all
 * again.
 *
 * The real ExceptionsViewer runs with TelemetryViewer captured and the data
 * layer mocked, so each read can be counted where it leaves.
 */

let viewerProps: any = null;

jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (props: any) => {
      viewerProps = props;
      return null;
    },
  };
});

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
import TelemetryFirstStepsEmptyState from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetryFirstStepsEmptyState";
import { NO_MATCH_FINGERPRINT } from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionsAttributeScope";
import { NO_MATCH_ENTITY_ID } from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionsSearchQuery";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import Service from "../../../Models/DatabaseModels/Service";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import ProjectUtil from "../../../UI/Utils/Project";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SERVICE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_SERVICE_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FINGERPRINTS: Array<string> = ["fp-checkout-timeout", "fp-db-deadlock"];

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

// When set, the project's service list waits for it.
let serviceListGate: Deferred | null = null;

// When set, the fingerprint resolution waits for it.
let fingerprintGate: Deferred | null = null;

type ModelType = { new (): unknown };

interface ListArgs {
  modelType: ModelType;
  query: Record<string, unknown>;
  skip: number;
  limit: number;
}

function callsOf(mock: MockFunction, modelType: ModelType): Array<ListArgs> {
  return mock.mock.calls
    .map((call: Array<unknown>): ListArgs => {
      return call[0] as ListArgs;
    })
    .filter((args: ListArgs): boolean => {
      return args.modelType === modelType;
    });
}

function listReads(): Array<ListArgs> {
  return callsOf(getListMock, TelemetryException);
}

function fingerprintReads(): Array<ListArgs> {
  return callsOf(analyticsGetListMock, ExceptionInstance);
}

function errorClassCounts(): number {
  return countMock.mock.calls.length;
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

function facetRequests(): Array<Record<string, unknown>> {
  return postsTo("/telemetry/exceptions/facets");
}

/*
 * The facet reads. A read is one request for every facet nothing is chosen
 * in, carrying every filter, sent after one request per facet with a value
 * chosen, which leaves that facet's own selection out (FacetCountPlan): a
 * read is counted by the former.
 */
function facetReads(): Array<Record<string, unknown>> {
  return facetRequests().filter((body: Record<string, unknown>): boolean => {
    return (body["facetKeys"] as Array<string>).length > 1;
  });
}

// The requests that count one chosen facet without its own selection.
function ownSelectionCounts(facetKey: string): Array<Record<string, unknown>> {
  return facetRequests().filter((body: Record<string, unknown>): boolean => {
    const keys: Array<string> = body["facetKeys"] as Array<string>;
    return keys.length === 1 && keys[0] === facetKey;
  });
}

// Every read, in one string, for "nothing more went out" assertions.
function readCounts(): string {
  return JSON.stringify({
    list: listReads().length,
    histogram: histogramReads().length,
    facets: facetReads().length,
    errorClassCounts: errorClassCounts(),
    fingerprints: fingerprintReads().length,
  });
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

async function mount(element: React.ReactElement): Promise<RenderResult> {
  let result: RenderResult | null = null;
  await act(async () => {
    result = render(element);
  });
  await settle();
  return result!;
}

async function openAt(search: string): Promise<RenderResult> {
  window.history.replaceState({}, "", `/dashboard/project/exceptions${search}`);
  return mount(<ExceptionsViewer />);
}

function service(id: string, name: string): Service {
  const item: Service = new Service();
  item.id = new ObjectID(id);
  item.name = name;
  return item;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.history.replaceState({}, "", "/");
  viewerProps = null;
  serviceListGate = null;
  fingerprintGate = null;

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);

  getListMock.mockReset();
  countMock.mockReset();
  postMock.mockReset();
  analyticsGetListMock.mockReset();

  getListMock.mockImplementation(async (args: unknown) => {
    const modelType: ModelType = (args as ListArgs).modelType;
    if (modelType === Service) {
      if (serviceListGate) {
        await serviceListGate.promise;
      }
      return {
        data: [
          service(SERVICE_ID, "checkout-api"),
          service(OTHER_SERVICE_ID, "billing-worker"),
        ],
        count: 2,
      };
    }
    if (modelType === TelemetryException) {
      const exception: TelemetryException = new TelemetryException();
      exception.fingerprint = FINGERPRINTS[0]!;
      exception.message = "checkout timed out";
      return { data: [exception], count: 40 };
    }
    return { data: [], count: 0 };
  });
  countMock.mockImplementation(async () => {
    return 3;
  });
  analyticsGetListMock.mockImplementation(async () => {
    if (fingerprintGate) {
      await fingerprintGate.promise;
    }
    return {
      data: FINGERPRINTS.map((fingerprint: string): ExceptionInstance => {
        const instance: ExceptionInstance = new ExceptionInstance();
        instance.fingerprint = fingerprint;
        return instance;
      }),
      count: FINGERPRINTS.length,
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

describe("a page load reads everything once (#4709)", () => {
  test("REGRESSION: the service list landing after the first reads does not read them again", async () => {
    serviceListGate = defer();

    await openAt("?range=Past%201%20Day&page=2");

    expect(listReads()).toHaveLength(1);
    expect(listReads()[0]!.skip).toBe(listReads()[0]!.limit);
    expect(histogramReads()).toHaveLength(1);
    expect(facetReads()).toHaveLength(1);
    const before: string = readCounts();

    await act(async () => {
      serviceListGate!.resolve();
    });
    await settle();

    // Before the fix: the list, the chart and the facets all over again.
    expect(readCounts()).toBe(before);
    expect(new URLSearchParams(window.location.search).get("page")).toBe("2");
  });

  test("a plain open: one list, one chart, one facet read, one round of class counts", async () => {
    await openAt("");

    expect(listReads()).toHaveLength(1);
    expect(histogramReads()).toHaveLength(1);
    expect(facetReads()).toHaveLength(1);
    // One count per error class, once.
    const classCounts: number = errorClassCounts();
    expect(classCounts).toBeGreaterThan(0);
    await settle();
    expect(errorClassCounts()).toBe(classCounts);
    expect(fingerprintReads()).toHaveLength(0);
  });

  test("a `@service:` token waits for the service names, then reads once with the real id", async () => {
    serviceListGate = defer();

    await openAt(`?search=${encodeURIComponent("@service:checkout-api")}`);

    // Nothing is read for a token that cannot resolve yet.
    expect(readCounts()).toBe(
      JSON.stringify({
        list: 0,
        histogram: 0,
        facets: 0,
        errorClassCounts: 0,
        fingerprints: 0,
      }),
    );
    /*
     * Every part reads as loading meanwhile - the list, the chart and the
     * facets - so nothing says "no exceptions" for a read not yet sent.
     */
    expect(viewerProps.isLoading).toBe(true);
    expect(viewerProps.histogramLoading).toBe(true);
    expect(viewerProps.facetLoading).toBe(true);
    /*
     * No facet key either - not even the error classes this explorer counts
     * itself: the sidebar reads a key as an answer, and would list every
     * facet as "No values in this time range" instead of its loader.
     */
    expect(viewerProps.facetData).toEqual({});

    await act(async () => {
      serviceListGate!.resolve();
    });
    await settle();

    // The answer is in: the error classes join the facets.
    expect(Object.keys(viewerProps.facetData)).toContain("errorClass");
    expect(listReads()).toHaveLength(1);
    expect(listReads()[0]!.query["primaryEntityId"]).toBe(SERVICE_ID);
    expect(histogramReads()).toHaveLength(1);
    expect(histogramReads()[0]!["serviceIds"]).toEqual([SERVICE_ID]);
    expect(facetReads()).toHaveLength(1);
    // No read ever asked for the "no such service" stand-in.
    expect(JSON.stringify(postMock.mock.calls)).not.toContain(
      NO_MATCH_ENTITY_ID,
    );
  });

  test("an attribute chip waits for its fingerprints, then reads once with them, never the sentinel", async () => {
    fingerprintGate = defer();

    await openAt(
      `?filters=${encodeURIComponent(
        JSON.stringify([["attributes.http.route", "/checkout"]]),
      )}`,
    );

    expect(fingerprintReads()).toHaveLength(1);
    expect(listReads()).toHaveLength(0);
    expect(histogramReads()).toHaveLength(0);
    expect(facetReads()).toHaveLength(0);
    expect(errorClassCounts()).toBe(0);
    // Reported as loading - not as "no exceptions".
    expect(viewerProps.isLoading).toBe(true);
    expect(viewerProps.histogramLoading).toBe(true);
    expect(viewerProps.facetLoading).toBe(true);

    await act(async () => {
      fingerprintGate!.resolve();
    });
    await settle();

    expect(fingerprintReads()).toHaveLength(1);
    expect(listReads()).toHaveLength(1);
    expect(listReads()[0]!.query["fingerprint"]).toEqual(
      new Includes(FINGERPRINTS),
    );
    expect(histogramReads()).toHaveLength(1);
    expect(histogramReads()[0]!["fingerprints"]).toEqual(FINGERPRINTS);
    expect(facetReads()).toHaveLength(1);
    expect(JSON.stringify(postMock.mock.calls)).not.toContain(
      NO_MATCH_FINGERPRINT,
    );
    expect(
      JSON.stringify(
        listReads().map((read: ListArgs): Record<string, unknown> => {
          return read.query;
        }),
      ),
    ).not.toContain(NO_MATCH_FINGERPRINT);
  });
});

describe("an embedded explorer reads once, and only on a real change of its scope", () => {
  // An Inventory item's exceptions, as its page renders them.
  function inventoryExceptions(keys: Array<string>): React.ReactElement {
    return (
      <ExceptionsViewer
        primaryEntityId={new ObjectID(SERVICE_ID)}
        entityKeysFilter={keys}
        defaultClassScope="all"
        disableUrlSync={true}
      />
    );
  }

  test("one resolution, then one read each, with the fingerprints", async () => {
    await mount(inventoryExceptions(["key-1"]));

    expect(fingerprintReads()).toHaveLength(1);
    expect(listReads()).toHaveLength(1);
    expect(histogramReads()).toHaveLength(1);
    expect(facetReads()).toHaveLength(1);
    expect(listReads()[0]!.query["fingerprint"]).toEqual(
      new Includes(FINGERPRINTS),
    );
  });

  test("the page re-rendering with an equal scope (a new ObjectID, a new array) reads nothing again", async () => {
    const view: RenderResult = await mount(inventoryExceptions(["key-1"]));
    const before: string = readCounts();

    for (let index: number = 0; index < 3; index++) {
      await act(async () => {
        view.rerender(inventoryExceptions(["key-1"]));
      });
      await settle();
    }

    expect(readCounts()).toBe(before);
  });

  test("a new entity key: one resolution and one read each", async () => {
    const view: RenderResult = await mount(inventoryExceptions(["key-1"]));

    await act(async () => {
      view.rerender(inventoryExceptions(["key-2"]));
    });
    await settle();

    expect(fingerprintReads()).toHaveLength(2);
    expect(listReads()).toHaveLength(2);
    expect(histogramReads()).toHaveLength(2);
    expect(facetReads()).toHaveLength(2);
  });

  test("an incident's stored query re-read on a background refresh reads nothing again", async () => {
    const stored: () => React.ReactElement = (): React.ReactElement => {
      return (
        <ExceptionsViewer
          defaultClassScope="all"
          exceptionInstanceQuery={
            {
              exceptionType: "TimeoutError",
              time: new InBetween<Date>(
                new Date("2026-09-20T08:00:00.000Z"),
                new Date("2026-09-20T09:30:00.000Z"),
              ),
            } as any
          }
        />
      );
    };

    const view: RenderResult = await mount(stored());
    expect(listReads()).toHaveLength(1);
    const before: string = readCounts();

    await act(async () => {
      view.rerender(stored());
    });
    await settle();

    expect(readCounts()).toBe(before);
  });
});

describe("a real change reads once", () => {
  test("a new range: one read each, for that range", async () => {
    await openAt("");
    const listBefore: number = listReads().length;

    await act(async () => {
      viewerProps.onTimeRangeChange({ range: TimeRange.PAST_ONE_WEEK });
    });
    await settle();

    expect(listReads()).toHaveLength(listBefore + 1);
    expect(histogramReads()).toHaveLength(2);
    expect(facetReads()).toHaveLength(2);
    expect(histogramReads()[1]!["startTime"]).toBe("2026-09-21T12:00:00.000Z");
  });

  test("a facet click: one read each, carrying it", async () => {
    await openAt("");

    await act(async () => {
      viewerProps.onFacetInclude("exceptionType", "TypeError");
    });
    await settle();

    expect(listReads()).toHaveLength(2);
    expect(listReads()[1]!.query["exceptionType"]).toBe("TypeError");
    expect(histogramReads()).toHaveLength(2);
    expect(facetReads()).toHaveLength(2);
    expect(facetReads()[1]!["exceptionTypes"]).toEqual(["TypeError"]);
    // Exception Type is counted without its own chip: the other types stay.
    expect(ownSelectionCounts("exceptionType")).toHaveLength(1);
    expect(ownSelectionCounts("exceptionType")[0]!["exceptionTypes"]).toBe(
      undefined,
    );
    expect(facetRequests()).toHaveLength(3);
  });

  test("paging: one list read per page, and the chart and facets stay", async () => {
    await openAt("");

    await act(async () => {
      viewerProps.onPageChange(2);
    });
    await settle();

    expect(listReads()).toHaveLength(2);
    expect(histogramReads()).toHaveLength(1);
    expect(facetReads()).toHaveLength(1);
  });
});

describe("the Unresolved page asks whether the project has any exception only of a list that came back empty", () => {
  /*
   * The Unresolved page offers exception tracking's setup guide when its
   * list is empty, nothing narrows it, and the project has no exception at
   * all - one count over everything it ever had (useProjectHasExceptions).
   *
   * The list was judged empty before its first read went out: on the first
   * render nothing is loading yet and there are no rows. So every load of
   * the page sent that count, rows or not - a seventh count where the
   * offline suite pins six (ExplorerListRequests.spec.ts).
   */

  // The explorer as Pages/Exceptions/Unresolved renders it.
  async function openUnresolved(search: string = ""): Promise<RenderResult> {
    window.history.replaceState(
      {},
      "",
      `/dashboard/project/exceptions/unresolved${search}`,
    );
    return mount(
      <ExceptionsViewer
        defaultStatus="unresolved"
        offersSetupWhenEmpty={true}
      />,
    );
  }

  interface CountArgs {
    modelType: ModelType;
    query: Record<string, unknown>;
  }

  /*
   * When each count over every exception the project ever had (no state,
   * time or class) went out, in the mocks' shared call order.
   */
  function projectWideCounts(): Array<number> {
    const orders: Array<number> = [];
    countMock.mock.calls.forEach((call: Array<unknown>, index: number) => {
      const args: CountArgs = call[0] as CountArgs;
      if (
        args.modelType === TelemetryException &&
        Object.keys(args.query).length === 0
      ) {
        orders.push(countMock.mock.invocationCallOrder[index]!);
      }
    });
    return orders;
  }

  // When each read of the exception list went out, in the same order.
  function listReadOrders(): Array<number> {
    const orders: Array<number> = [];
    getListMock.mock.calls.forEach((call: Array<unknown>, index: number) => {
      if ((call[0] as ListArgs).modelType === TelemetryException) {
        orders.push(getListMock.mock.invocationCallOrder[index]!);
      }
    });
    return orders;
  }

  function offersSetupGuide(): boolean {
    return (
      Boolean(viewerProps.emptyContent) &&
      viewerProps.emptyContent.type === TelemetryFirstStepsEmptyState
    );
  }

  function row(): TelemetryException {
    const exception: TelemetryException = new TelemetryException();
    exception.fingerprint = FINGERPRINTS[0]!;
    exception.message = "checkout timed out";
    return exception;
  }

  /*
   * The exception list answers with `rows` - after `gate` opens, when one is
   * given - or fails; every other list reads as the suite's default.
   */
  function exceptionListAnswers(answer: {
    rows: Array<TelemetryException>;
    gate?: Deferred | undefined;
    fails?: boolean | undefined;
  }): void {
    const fallback: ((...args: Array<any>) => any) | undefined =
      getListMock.getMockImplementation();
    getListMock.mockImplementation(async (args: unknown) => {
      if ((args as ListArgs).modelType !== TelemetryException) {
        return fallback!(args);
      }
      if (answer.gate) {
        await answer.gate.promise;
      }
      if (answer.fails) {
        throw new Error("The exceptions could not be read");
      }
      return { data: answer.rows, count: answer.rows.length };
    });
  }

  // How many exceptions the project ever had, as the project-wide count says.
  function projectHasEver(total: number): void {
    countMock.mockImplementation(async (args: unknown) => {
      return Object.keys((args as CountArgs).query).length === 0 ? total : 0;
    });
  }

  test("REGRESSION: a list with rows never asks, not even on the render before its read goes out", async () => {
    exceptionListAnswers({ rows: [row()] });

    await openUnresolved("?range=Past%201%20Day");
    await settle();

    expect(listReads()).toHaveLength(1);
    // Before the fix: one count over everything, on every page load.
    expect(projectWideCounts()).toHaveLength(0);
    expect(offersSetupGuide()).toBe(false);
  });

  test("while the first list read is out nothing asks, and the list reads as loading, not as empty", async () => {
    const gate: Deferred = defer();
    exceptionListAnswers({ rows: [row()], gate });

    await openUnresolved();

    expect(listReads()).toHaveLength(1);
    expect(viewerProps.isLoading).toBe(true);
    expect(projectWideCounts()).toHaveLength(0);
    expect(offersSetupGuide()).toBe(false);

    await act(async () => {
      gate.resolve();
    });
    await settle();

    expect(viewerProps.isLoading).toBe(false);
    expect(projectWideCounts()).toHaveLength(0);
    expect(offersSetupGuide()).toBe(false);
  });

  test("a list that comes back empty asks once, after it answers: a project without a single exception gets the setup guide", async () => {
    const gate: Deferred = defer();
    exceptionListAnswers({ rows: [], gate });
    projectHasEver(0);

    await openUnresolved();

    expect(projectWideCounts()).toHaveLength(0);
    expect(offersSetupGuide()).toBe(false);

    await act(async () => {
      gate.resolve();
    });
    await settle();

    expect(projectWideCounts()).toHaveLength(1);
    expect(projectWideCounts()[0]!).toBeGreaterThan(listReadOrders()[0]!);
    expect(offersSetupGuide()).toBe(true);

    await settle();
    expect(projectWideCounts()).toHaveLength(1);
  });

  test("a list that comes back empty on a project with exceptions asks once and keeps its own message: nothing unresolved is good news", async () => {
    exceptionListAnswers({ rows: [] });
    projectHasEver(12);

    await openUnresolved();

    expect(projectWideCounts()).toHaveLength(1);
    expect(offersSetupGuide()).toBe(false);
    expect(viewerProps.emptyContent).toBeUndefined();
    expect(viewerProps.emptyMessage).toBe("No exceptions found");
  });

  test("a list read that fails asks nothing: the error says why, not a setup guide", async () => {
    exceptionListAnswers({ rows: [], fails: true });
    projectHasEver(0);

    await openUnresolved();

    expect(listReads()).toHaveLength(1);
    expect(viewerProps.error).toBe("The exceptions could not be read");
    expect(projectWideCounts()).toHaveLength(0);
    expect(offersSetupGuide()).toBe(false);
  });

  test("a list a filter chip or a search emptied asks nothing", async () => {
    exceptionListAnswers({ rows: [] });
    projectHasEver(0);

    await openUnresolved(
      `?filters=${encodeURIComponent(
        JSON.stringify([["exceptionType", "TypeError"]]),
      )}`,
    );

    expect(listReads()).toHaveLength(1);
    expect(projectWideCounts()).toHaveLength(0);
    expect(offersSetupGuide()).toBe(false);

    cleanup();
    getListMock.mockClear();

    await openUnresolved("?search=timeout");

    expect(listReads()).toHaveLength(1);
    expect(projectWideCounts()).toHaveLength(0);
    expect(offersSetupGuide()).toBe(false);
  });

  test("an embed never asks, even when its list comes back empty", async () => {
    exceptionListAnswers({ rows: [] });
    projectHasEver(0);

    await mount(<ExceptionsViewer defaultStatus="unresolved" />);

    expect(listReads()).toHaveLength(1);
    expect(projectWideCounts()).toHaveLength(0);
    expect(offersSetupGuide()).toBe(false);
  });

  test("a list with rows that a new range empties asks once, after that read answers, and never again", async () => {
    let rows: Array<TelemetryException> = [row()];
    const fallback: ((...args: Array<any>) => any) | undefined =
      getListMock.getMockImplementation();
    getListMock.mockImplementation(async (args: unknown) => {
      if ((args as ListArgs).modelType !== TelemetryException) {
        return fallback!(args);
      }
      return { data: rows, count: rows.length };
    });
    projectHasEver(4);

    await openUnresolved();
    expect(projectWideCounts()).toHaveLength(0);

    rows = [];
    await act(async () => {
      viewerProps.onTimeRangeChange({ range: TimeRange.PAST_ONE_HOUR });
    });
    await settle();

    expect(listReads()).toHaveLength(2);
    expect(projectWideCounts()).toHaveLength(1);
    expect(projectWideCounts()[0]!).toBeGreaterThan(listReadOrders()[1]!);
    expect(offersSetupGuide()).toBe(false);

    await act(async () => {
      viewerProps.onTimeRangeChange({ range: TimeRange.PAST_ONE_DAY });
    });
    await settle();

    expect(listReads()).toHaveLength(3);
    expect(projectWideCounts()).toHaveLength(1);
  });
});
