import {
  DropFilterCandidate,
  DropFilterValidationOptions,
  isSqlExpressionValue,
  SAMPLE_ACTION,
  validateDropFilter,
  validateDropFilterFilterQuery,
  validateDropFilterSamplePercentage,
} from "../../../Server/Utils/DropFilterValidation";
import BadDataException from "../../../Types/Exception/BadDataException";
import {
  MAX_SAMPLE_PERCENTAGE,
  MIN_SAMPLE_PERCENTAGE,
} from "../../../Types/Telemetry/DropFilterSampling";
import LogDropFilterAction from "../../../Types/Log/LogDropFilterAction";
import TraceDropFilterAction from "../../../Types/Trace/TraceDropFilterAction";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the save-time gate on drop filters.
 *
 * Both drop-filter models used to accept configurations the ingest engine
 * could not honour, and both failed silently AND destructively:
 *
 *   - A blank `filterQuery` compiles to "match every record", so saving a
 *     drop filter with an empty query discarded 100% of a project's
 *     telemetry with nothing to notice it by.
 *   - `action = "sample"` could be saved with no percentage, which the engine
 *     read as "throw away half".
 *
 * The API boundary is the only place a human is present to read the error,
 * which is why this runs on create and on update rather than only in the
 * dashboard form.
 */

const LOGS: DropFilterValidationOptions = { recordNoun: "logs" };
const SPANS: DropFilterValidationOptions = { recordNoun: "spans" };

function candidate(
  overrides: Partial<DropFilterCandidate>,
): DropFilterCandidate {
  return {
    action: "drop",
    samplePercentage: null,
    filterQuery: "severityText = 'Error'",
    ...overrides,
  };
}

describe("drop filter action vocabulary", () => {
  /*
   * The validator compares a raw string so one implementation can serve both
   * services. If either enum ever renames its member, this fails instead of
   * silently skipping sample validation.
   */
  it("matches the literal both action enums use for sampling", () => {
    expect(LogDropFilterAction.Sample).toBe(SAMPLE_ACTION);
    expect(TraceDropFilterAction.Sample).toBe(SAMPLE_ACTION);
  });
});

describe("validateDropFilterFilterQuery", () => {
  it("accepts a query with an actual condition", () => {
    expect(() => {
      return validateDropFilterFilterQuery("body CONTAINS 'debug'", LOGS);
    }).not.toThrow();
  });

  /*
   * The destructive case: empty means match-all, and match-all plus a drop
   * action means the project loses everything.
   */
  it("rejects an empty query", () => {
    expect(() => {
      return validateDropFilterFilterQuery("", LOGS);
    }).toThrow(BadDataException);
  });

  it("rejects a whitespace-only query", () => {
    for (const blank of [" ", "   ", "\t", "\n", " \t\n "]) {
      expect(() => {
        return validateDropFilterFilterQuery(blank, LOGS);
      }).toThrow(BadDataException);
    }
  });

  it("rejects a missing query", () => {
    expect(() => {
      return validateDropFilterFilterQuery(undefined, LOGS);
    }).toThrow(BadDataException);
    expect(() => {
      return validateDropFilterFilterQuery(null, LOGS);
    }).toThrow(BadDataException);
  });

  /*
   * The message has to explain the consequence, not just name the field —
   * "Filter query is required" alone does not tell someone that saving it
   * blank would have deleted all their logs.
   */
  it("explains the consequence in the message, in the caller's vocabulary", () => {
    expect(() => {
      return validateDropFilterFilterQuery("", LOGS);
    }).toThrow(/discard all of this project's logs/);

    expect(() => {
      return validateDropFilterFilterQuery("", SPANS);
    }).toThrow(/discard all of this project's spans/);
  });
});

describe("validateDropFilterSamplePercentage", () => {
  it("ignores the percentage entirely for a drop-action filter", () => {
    for (const percentage of [null, undefined, 0, -5, 100, 1000]) {
      expect(() => {
        return validateDropFilterSamplePercentage(
          candidate({ action: "drop", samplePercentage: percentage }),
          LOGS,
        );
      }).not.toThrow();
    }
  });

  it("accepts a sample filter inside the usable range", () => {
    for (const percentage of [
      MIN_SAMPLE_PERCENTAGE,
      10,
      50,
      MAX_SAMPLE_PERCENTAGE,
    ]) {
      expect(() => {
        return validateDropFilterSamplePercentage(
          candidate({ action: SAMPLE_ACTION, samplePercentage: percentage }),
          LOGS,
        );
      }).not.toThrow();
    }
  });

  it("rejects a sample filter with no percentage at all", () => {
    for (const missing of [null, undefined]) {
      expect(() => {
        return validateDropFilterSamplePercentage(
          candidate({ action: SAMPLE_ACTION, samplePercentage: missing }),
          LOGS,
        );
      }).toThrow(BadDataException);
    }
  });

  it("rejects a sample filter with a non-finite percentage", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => {
        return validateDropFilterSamplePercentage(
          candidate({ action: SAMPLE_ACTION, samplePercentage: bad }),
          LOGS,
        );
      }).toThrow(BadDataException);
    }
  });

  /*
   * 0 and 100 are the two values a user reaches for when they mean something
   * else. Point them at the tool that actually does it rather than accepting
   * a filter the engine will treat as a no-op.
   */
  it("rejects 0 and points at the Drop action instead", () => {
    expect(() => {
      return validateDropFilterSamplePercentage(
        candidate({ action: SAMPLE_ACTION, samplePercentage: 0 }),
        LOGS,
      );
    }).toThrow(/"Drop" action/);
  });

  it("rejects 100 and points at disabling the filter instead", () => {
    expect(() => {
      return validateDropFilterSamplePercentage(
        candidate({ action: SAMPLE_ACTION, samplePercentage: 100 }),
        LOGS,
      );
    }).toThrow(/disable the filter/);
  });

  it("rejects percentages outside the range on both sides", () => {
    for (const outOfRange of [-1, 0, 100, 101, 1000]) {
      expect(() => {
        return validateDropFilterSamplePercentage(
          candidate({ action: SAMPLE_ACTION, samplePercentage: outOfRange }),
          LOGS,
        );
      }).toThrow(BadDataException);
    }
  });

  it("names the allowed range in the message so the fix is obvious", () => {
    expect(() => {
      return validateDropFilterSamplePercentage(
        candidate({ action: SAMPLE_ACTION, samplePercentage: null }),
        LOGS,
      );
    }).toThrow(
      new RegExp(`${MIN_SAMPLE_PERCENTAGE} and ${MAX_SAMPLE_PERCENTAGE}`),
    );
  });
});

describe("validateDropFilter", () => {
  it("accepts a well-formed drop filter", () => {
    expect(() => {
      return validateDropFilter(
        candidate({ action: "drop", filterQuery: "severityText = 'Debug'" }),
        LOGS,
      );
    }).not.toThrow();
  });

  it("accepts a well-formed sample filter", () => {
    expect(() => {
      return validateDropFilter(
        candidate({
          action: SAMPLE_ACTION,
          samplePercentage: 10,
          filterQuery: "severityText = 'Debug'",
        }),
        LOGS,
      );
    }).not.toThrow();
  });

  /*
   * The query check runs first on purpose. A row that is broken both ways
   * should surface the more destructive problem, because a match-all drop
   * filter deletes everything while a bad percentage only samples.
   */
  it("reports the empty query first when a candidate is broken both ways", () => {
    expect(() => {
      return validateDropFilter(
        candidate({
          action: SAMPLE_ACTION,
          samplePercentage: null,
          filterQuery: "",
        }),
        LOGS,
      );
    }).toThrow(/Filter query is required/);
  });
});

describe("isSqlExpressionValue", () => {
  /*
   * `PartialEntity` values may be raw SQL expressions. We cannot evaluate one
   * to validate it, and stringifying a function to compare it would be worse
   * than skipping — so the update hook detects and skips.
   */
  it("detects a raw SQL expression value", () => {
    expect(
      isSqlExpressionValue(() => {
        return "NOW()";
      }),
    ).toBe(true);
  });

  it("treats every ordinary literal as a plain value", () => {
    for (const literal of ["sample", "", 0, 50, null, undefined, {}, []]) {
      expect(isSqlExpressionValue(literal)).toBe(false);
    }
  });
});
