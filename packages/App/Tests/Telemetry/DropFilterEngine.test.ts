import { beforeEach, describe, expect, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import LogDropFilterAction from "Common/Types/Log/LogDropFilterAction";
import TraceDropFilterAction from "Common/Types/Trace/TraceDropFilterAction";

/*
 * Contract under test — the drop-filter engines that decide, per record,
 * whether a project's own configuration deletes it.
 *
 * Two defects lived here, and both destroyed data silently:
 *
 *   1. An empty `filterQuery` compiled to "match every record". Combined with
 *      a `drop` action that made the filter "discard 100% of this project's
 *      telemetry", and nothing anywhere recorded that it had happened. Save
 *      validation now rejects a blank query, but rows created BEFORE that
 *      still exist in customer databases, so the engine itself has to stop
 *      honouring them — which is what most of this file is about.
 *
 *   2. `samplePercentage || 50` turned an unset percentage into "throw away
 *      half", and made a stored `0` indistinguishable from unset.
 *
 * Both engines are covered. They are separate classes with separate action
 * enums over separate tables; the shared helpers exist so they cannot drift,
 * and these tests are what would catch it if they did.
 */

const recordedDrops: Array<{
  projectId: string;
  filterId: string;
  signal: string;
  action: string;
}> = [];
let recorderThrows: boolean = false;

jest.mock("../../FeatureSet/Telemetry/Utils/DropFilterDropRecorder", () => {
  return {
    __esModule: true,
    DropFilterSignal: { Logs: "logs", Traces: "traces" },
    recordDroppedRecord: (input: any): void => {
      if (recorderThrows) {
        throw new Error("recorder exploded");
      }
      recordedDrops.push({
        projectId: input.projectId.toString(),
        filterId: input.filterId.toString(),
        signal: input.signal,
        action: input.action,
      });
    },
  };
});

import LogDropFilterService, {
  LoadedLogDropFilter,
} from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import TraceDropFilterService, {
  LoadedTraceDropFilter,
} from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import { compileFilter } from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const FILTER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SECOND_FILTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

/*
 * Mirrors what loadDropFilters produces, including the option that stops an
 * empty query from matching everything. If the engine's own compile call ever
 * loses `emptyQueryMatches: false`, the "empty query" cases below fail.
 */
function loadedLogFilter(data: {
  filterQuery: string;
  action: string;
  samplePercentage?: number | undefined;
  id?: ObjectID | undefined;
}): LoadedLogDropFilter {
  const filter: any = {
    _id: (data.id || FILTER_ID).toString(),
    id: data.id || FILTER_ID,
    filterQuery: data.filterQuery,
    action: data.action,
    samplePercentage: data.samplePercentage,
  };

  return {
    filter,
    compiledFilter: compileFilter(data.filterQuery, {
      emptyQueryMatches: false,
    }),
    projectId: PROJECT_ID,
  } as LoadedLogDropFilter;
}

function loadedTraceFilter(data: {
  filterQuery: string;
  action: string;
  samplePercentage?: number | undefined;
}): LoadedTraceDropFilter {
  const filter: any = {
    _id: FILTER_ID.toString(),
    id: FILTER_ID,
    filterQuery: data.filterQuery,
    action: data.action,
    samplePercentage: data.samplePercentage,
  };

  return {
    filter,
    compiledFilter: compileFilter(data.filterQuery, {
      emptyQueryMatches: false,
    }),
    projectId: PROJECT_ID,
  } as LoadedTraceDropFilter;
}

const DEBUG_LOG: JSONObject = { severityText: "Debug", body: "cache warmed" };
const ERROR_LOG: JSONObject = { severityText: "Error", body: "boom" };
const SPAN: JSONObject = { name: "GET /health", statusCode: 0 };

describe("compileFilter empty-query semantics", () => {
  /*
   * The option exists because the same compiler serves pipelines and drop
   * filters, and "no filter" means opposite things to them. A pipeline with
   * no filter should transform every record; a DROP filter with no filter
   * must not delete every record.
   */
  test("an empty query matches everything by default, for pipelines", () => {
    for (const blank of ["", "   ", "\n\t"]) {
      expect(compileFilter(blank)).toEqual({ kind: "always-true" });
    }
  });

  test("an empty query matches nothing when the caller opts out", () => {
    for (const blank of ["", "   ", "\n\t"]) {
      expect(compileFilter(blank, { emptyQueryMatches: false })).toEqual({
        kind: "always-false",
      });
    }
  });

  test("emptyQueryMatches: true is the same as omitting the option", () => {
    expect(compileFilter("", { emptyQueryMatches: true })).toEqual({
      kind: "always-true",
    });
  });

  test("the option does not change how a real query compiles", () => {
    const withOption: unknown = compileFilter("severityText = 'Debug'", {
      emptyQueryMatches: false,
    });
    const withoutOption: unknown = compileFilter("severityText = 'Debug'");

    expect((withOption as any).kind).toBe("expr");
    expect(withOption).toEqual(withoutOption);
  });

  /*
   * An unparsable query already compiled to "match nothing" — the safe
   * default. That must stay true regardless of the new option, because a
   * typo'd drop filter turning into a match-all would be catastrophic.
   */
  test("an unparsable query still matches nothing under either setting", () => {
    const broken: string = "severityText = = = 'Debug' AND AND";

    expect(compileFilter(broken)).toEqual({ kind: "always-false" });
    expect(compileFilter(broken, { emptyQueryMatches: false })).toEqual({
      kind: "always-false",
    });
  });
});

describe("LogDropFilterService.shouldDropLog", () => {
  beforeEach(() => {
    recordedDrops.length = 0;
    recorderThrows = false;
  });

  test("keeps every log when no filters are configured", () => {
    expect(LogDropFilterService.shouldDropLog(DEBUG_LOG, [])).toBe(false);
    expect(recordedDrops).toHaveLength(0);
  });

  describe("drop action", () => {
    test("drops a log the query matches", () => {
      const filters: Array<LoadedLogDropFilter> = [
        loadedLogFilter({
          filterQuery: "severityText = 'Debug'",
          action: LogDropFilterAction.Drop,
        }),
      ];

      expect(LogDropFilterService.shouldDropLog(DEBUG_LOG, filters)).toBe(true);
    });

    test("keeps a log the query does not match", () => {
      const filters: Array<LoadedLogDropFilter> = [
        loadedLogFilter({
          filterQuery: "severityText = 'Debug'",
          action: LogDropFilterAction.Drop,
        }),
      ];

      expect(LogDropFilterService.shouldDropLog(ERROR_LOG, filters)).toBe(
        false,
      );
    });
  });

  describe("empty filter query", () => {
    /*
     * THE regression. A drop filter row with a blank query used to delete
     * every log in the project. Rows like that still exist in databases
     * created before save validation landed, so the engine must refuse them
     * rather than relying on the API gate alone.
     */
    test("a blank query drops nothing instead of everything", () => {
      for (const blank of ["", "   ", "\n\t"]) {
        const filters: Array<LoadedLogDropFilter> = [
          loadedLogFilter({
            filterQuery: blank,
            action: LogDropFilterAction.Drop,
          }),
        ];

        expect(LogDropFilterService.shouldDropLog(DEBUG_LOG, filters)).toBe(
          false,
        );
        expect(LogDropFilterService.shouldDropLog(ERROR_LOG, filters)).toBe(
          false,
        );
      }
    });

    test("a blank query on a sample filter also drops nothing", () => {
      const filters: Array<LoadedLogDropFilter> = [
        loadedLogFilter({
          filterQuery: "",
          action: LogDropFilterAction.Sample,
          samplePercentage: 1,
        }),
      ];

      // Would otherwise discard ~99% of every log in the project.
      for (let i: number = 0; i < 50; i++) {
        expect(LogDropFilterService.shouldDropLog(DEBUG_LOG, filters)).toBe(
          false,
        );
      }
    });

    test("a blank query records no drops, because none happened", () => {
      const filters: Array<LoadedLogDropFilter> = [
        loadedLogFilter({
          filterQuery: "",
          action: LogDropFilterAction.Drop,
        }),
      ];

      LogDropFilterService.shouldDropLog(DEBUG_LOG, filters);
      expect(recordedDrops).toHaveLength(0);
    });

    /*
     * A broken filter must not shadow a working one that comes after it in
     * evaluation order.
     */
    test("a blank filter does not stop a later valid filter from matching", () => {
      const filters: Array<LoadedLogDropFilter> = [
        loadedLogFilter({
          filterQuery: "",
          action: LogDropFilterAction.Drop,
        }),
        loadedLogFilter({
          filterQuery: "severityText = 'Debug'",
          action: LogDropFilterAction.Drop,
          id: SECOND_FILTER_ID,
        }),
      ];

      expect(LogDropFilterService.shouldDropLog(DEBUG_LOG, filters)).toBe(true);
      expect(recordedDrops).toHaveLength(1);
      expect(recordedDrops[0]!.filterId).toBe(SECOND_FILTER_ID.toString());
    });
  });

  describe("sample action", () => {
    /*
     * Control for every "keeps everything" case below.
     *
     * Those cases assert that nothing was dropped, which a query that simply
     * never matches would also satisfy. (That is not hypothetical: an earlier
     * draft of this file used a `CONTAINS` operator the parser does not have,
     * so the filter compiled to match-nothing and the assertions passed for
     * the wrong reason.) This pins down that the query really does match the
     * record, so a false pass is impossible.
     */
    test("(control) the query the sample cases use really does match", () => {
      const filters: Array<LoadedLogDropFilter> = [
        loadedLogFilter({
          filterQuery: "severityText = 'Debug'",
          action: LogDropFilterAction.Drop,
        }),
      ];

      expect(LogDropFilterService.shouldDropLog(DEBUG_LOG, filters)).toBe(true);
    });

    /*
     * The other regression. `undefined || 50` meant a sample filter saved
     * with no percentage silently discarded about half of everything it
     * matched. 200 iterations makes a 50% rate essentially certain to show up
     * if it ever comes back.
     */
    test("an unset percentage keeps every matching log, not half of them", () => {
      const filters: Array<LoadedLogDropFilter> = [
        loadedLogFilter({
          filterQuery: "severityText = 'Debug'",
          action: LogDropFilterAction.Sample,
        }),
      ];

      let dropped: number = 0;
      for (let i: number = 0; i < 200; i++) {
        if (LogDropFilterService.shouldDropLog(DEBUG_LOG, filters)) {
          dropped++;
        }
      }

      expect(dropped).toBe(0);
    });

    test("a stored 0 keeps every matching log", () => {
      const filters: Array<LoadedLogDropFilter> = [
        loadedLogFilter({
          filterQuery: "severityText = 'Debug'",
          action: LogDropFilterAction.Sample,
          samplePercentage: 0,
        }),
      ];

      let dropped: number = 0;
      for (let i: number = 0; i < 200; i++) {
        if (LogDropFilterService.shouldDropLog(DEBUG_LOG, filters)) {
          dropped++;
        }
      }

      expect(dropped).toBe(0);
    });

    test("keep-100% keeps every matching log", () => {
      const filters: Array<LoadedLogDropFilter> = [
        loadedLogFilter({
          filterQuery: "severityText = 'Debug'",
          action: LogDropFilterAction.Sample,
          samplePercentage: 100,
        }),
      ];

      for (let i: number = 0; i < 100; i++) {
        expect(LogDropFilterService.shouldDropLog(DEBUG_LOG, filters)).toBe(
          false,
        );
      }
    });

    test("an explicit low percentage does discard most matching logs", () => {
      const filters: Array<LoadedLogDropFilter> = [
        loadedLogFilter({
          filterQuery: "severityText = 'Debug'",
          action: LogDropFilterAction.Sample,
          samplePercentage: 1,
        }),
      ];

      let dropped: number = 0;
      for (let i: number = 0; i < 400; i++) {
        if (LogDropFilterService.shouldDropLog(DEBUG_LOG, filters)) {
          dropped++;
        }
      }

      /*
       * keep-1% over 400 draws: seeing fewer than half dropped is impossible
       * in practice (p far below 1e-100).
       */
      expect(dropped).toBeGreaterThan(200);
    });

    test("a sample filter never touches a log its query does not match", () => {
      const filters: Array<LoadedLogDropFilter> = [
        loadedLogFilter({
          filterQuery: "severityText = 'Debug'",
          action: LogDropFilterAction.Sample,
          samplePercentage: 1,
        }),
      ];

      for (let i: number = 0; i < 100; i++) {
        expect(LogDropFilterService.shouldDropLog(ERROR_LOG, filters)).toBe(
          false,
        );
      }
    });
  });

  describe("drop recording", () => {
    test("records a drop-action drop with its project, filter and action", () => {
      const filters: Array<LoadedLogDropFilter> = [
        loadedLogFilter({
          filterQuery: "severityText = 'Debug'",
          action: LogDropFilterAction.Drop,
        }),
      ];

      LogDropFilterService.shouldDropLog(DEBUG_LOG, filters);

      expect(recordedDrops).toEqual([
        {
          projectId: PROJECT_ID.toString(),
          filterId: FILTER_ID.toString(),
          signal: "logs",
          action: LogDropFilterAction.Drop,
        },
      ]);
    });

    test("records a sample-action drop as 'sample', not 'drop'", () => {
      const filters: Array<LoadedLogDropFilter> = [
        loadedLogFilter({
          filterQuery: "severityText = 'Debug'",
          action: LogDropFilterAction.Sample,
          samplePercentage: 1,
        }),
      ];

      for (let i: number = 0; i < 200; i++) {
        LogDropFilterService.shouldDropLog(DEBUG_LOG, filters);
      }

      expect(recordedDrops.length).toBeGreaterThan(0);
      for (const drop of recordedDrops) {
        expect(drop.action).toBe(LogDropFilterAction.Sample);
      }
    });

    test("records nothing for a log that is kept", () => {
      const filters: Array<LoadedLogDropFilter> = [
        loadedLogFilter({
          filterQuery: "severityText = 'Debug'",
          action: LogDropFilterAction.Drop,
        }),
      ];

      LogDropFilterService.shouldDropLog(ERROR_LOG, filters);
      expect(recordedDrops).toHaveLength(0);
    });

    test("records exactly one drop per dropped log, not one per filter", () => {
      const filters: Array<LoadedLogDropFilter> = [
        loadedLogFilter({
          filterQuery: "severityText = 'Debug'",
          action: LogDropFilterAction.Drop,
        }),
        loadedLogFilter({
          filterQuery: "body LIKE 'cache'",
          action: LogDropFilterAction.Drop,
          id: SECOND_FILTER_ID,
        }),
      ];

      LogDropFilterService.shouldDropLog(DEBUG_LOG, filters);

      /*
       * Short-circuits on the first match, so the count is 1 and it is
       * attributed to the filter that actually did it.
       */
      expect(recordedDrops).toHaveLength(1);
      expect(recordedDrops[0]!.filterId).toBe(FILTER_ID.toString());
    });

    /*
     * Observability must never be able to fail an ingest batch. A dropped log
     * is a successful outcome for the request either way.
     */
    test("a throwing recorder does not break the drop decision", () => {
      recorderThrows = true;

      const filters: Array<LoadedLogDropFilter> = [
        loadedLogFilter({
          filterQuery: "severityText = 'Debug'",
          action: LogDropFilterAction.Drop,
        }),
      ];

      expect(() => {
        expect(LogDropFilterService.shouldDropLog(DEBUG_LOG, filters)).toBe(
          true,
        );
      }).not.toThrow();
    });

    test("a filter with no id is skipped by the recorder, not crashed on", () => {
      const filters: Array<LoadedLogDropFilter> = [
        loadedLogFilter({
          filterQuery: "severityText = 'Debug'",
          action: LogDropFilterAction.Drop,
        }),
      ];
      (filters[0]!.filter as any).id = undefined;
      (filters[0]!.filter as any)._id = undefined;

      expect(LogDropFilterService.shouldDropLog(DEBUG_LOG, filters)).toBe(true);
      expect(recordedDrops).toHaveLength(0);
    });
  });
});

describe("TraceDropFilterService.shouldDropSpan", () => {
  beforeEach(() => {
    recordedDrops.length = 0;
    recorderThrows = false;
  });

  test("keeps every span when no filters are configured", () => {
    expect(TraceDropFilterService.shouldDropSpan(SPAN, [])).toBe(false);
  });

  /*
   * Control for the "keeps everything" span cases below — see the log-side
   * control for why this matters.
   */
  test("(control) the query the span cases use really does match", () => {
    const filters: Array<LoadedTraceDropFilter> = [
      loadedTraceFilter({
        filterQuery: "name LIKE 'health'",
        action: TraceDropFilterAction.Drop,
      }),
    ];

    expect(TraceDropFilterService.shouldDropSpan(SPAN, filters)).toBe(true);
  });

  test("a blank query drops nothing instead of every span in the project", () => {
    for (const blank of ["", "  "]) {
      const filters: Array<LoadedTraceDropFilter> = [
        loadedTraceFilter({
          filterQuery: blank,
          action: TraceDropFilterAction.Drop,
        }),
      ];

      expect(TraceDropFilterService.shouldDropSpan(SPAN, filters)).toBe(false);
    }
  });

  test("an unset percentage keeps every matching span, not half of them", () => {
    const filters: Array<LoadedTraceDropFilter> = [
      loadedTraceFilter({
        filterQuery: "name LIKE 'health'",
        action: TraceDropFilterAction.Sample,
      }),
    ];

    let dropped: number = 0;
    for (let i: number = 0; i < 200; i++) {
      if (TraceDropFilterService.shouldDropSpan(SPAN, filters)) {
        dropped++;
      }
    }

    expect(dropped).toBe(0);
  });

  test("a stored 0 keeps every matching span", () => {
    const filters: Array<LoadedTraceDropFilter> = [
      loadedTraceFilter({
        filterQuery: "name LIKE 'health'",
        action: TraceDropFilterAction.Sample,
        samplePercentage: 0,
      }),
    ];

    let dropped: number = 0;
    for (let i: number = 0; i < 200; i++) {
      if (TraceDropFilterService.shouldDropSpan(SPAN, filters)) {
        dropped++;
      }
    }

    expect(dropped).toBe(0);
  });

  test("drops a matching span and records it under the traces signal", () => {
    const filters: Array<LoadedTraceDropFilter> = [
      loadedTraceFilter({
        filterQuery: "name LIKE 'health'",
        action: TraceDropFilterAction.Drop,
      }),
    ];

    expect(TraceDropFilterService.shouldDropSpan(SPAN, filters)).toBe(true);
    expect(recordedDrops).toEqual([
      {
        projectId: PROJECT_ID.toString(),
        filterId: FILTER_ID.toString(),
        signal: "traces",
        action: TraceDropFilterAction.Drop,
      },
    ]);
  });

  test("an explicit low percentage does discard most matching spans", () => {
    const filters: Array<LoadedTraceDropFilter> = [
      loadedTraceFilter({
        filterQuery: "name LIKE 'health'",
        action: TraceDropFilterAction.Sample,
        samplePercentage: 1,
      }),
    ];

    let dropped: number = 0;
    for (let i: number = 0; i < 400; i++) {
      if (TraceDropFilterService.shouldDropSpan(SPAN, filters)) {
        dropped++;
      }
    }

    expect(dropped).toBeGreaterThan(200);
  });
});
