import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
import fs from "fs";
import path from "path";
import * as React from "react";
import ExceptionRow from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionRow";
import {
  ExceptionSplitPill,
  getExceptionSplitPillPresentation,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionIssueBadges";
import { EXCEPTION_LIST_SELECT } from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionListRead";
import {
  MAX_EXCEPTIONS_SPLIT_FROM_A_PAGE,
  SPLIT_BY_SCRUB_RULE_PARAM,
  SPLIT_BY_SCRUB_RULE_PARAM_VALUE,
  SPLIT_FINGERPRINT_SELECT,
  SPLIT_FROM_ONE_SELECT,
  SPLIT_ONE_SELECT,
  countSplitExceptions,
  getOccurrenceFingerprints,
  getSplitExceptionsQuery,
  getSplitPairExceptionIds,
  idOf,
  readSplitExceptionFingerprints,
  readSplitPairExceptionIds,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionSplitPairs";
import { MAX_SCOPED_FINGERPRINTS } from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionsAttributeScope";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { Translator } from "../../../UI/Utils/TranslateTemplate";

/*
 * A pair a scrub rule split before #10434, in the exceptions list (#10897).
 *
 * Ingest records the pair on the split one; the list marks both halves -
 * the split one, and the one it was split from, which records nothing
 * itself - with a Split pill beside the row's other badges, so a person
 * tidying up sees each pair at a glance. As on the exceptions' pages, a pair
 * stops being marked once the two are merged, either way, and is not marked
 * when the other cannot be read.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

const SPLIT_ID: string = "80000000-0000-4000-8000-000000000001";
const SPLIT_FROM_ID: string = "80000000-0000-4000-8000-000000000002";
const THIRD_ID: string = "80000000-0000-4000-8000-000000000003";
const PLAIN_ID: string = "80000000-0000-4000-8000-000000000004";
const SECOND_SPLIT_ID: string = "80000000-0000-4000-8000-000000000005";

function exception(
  id: string,
  values: Partial<TelemetryException> = {},
): TelemetryException {
  const row: TelemetryException = new TelemetryException();
  row._id = id;
  row.exceptionType = "CartNotFoundError";
  row.message = "No cart for [REDACTED]";
  row.occuranceCount = 3;
  Object.assign(row, values);
  return row;
}

const SPLIT: TelemetryException = exception(SPLIT_ID, {
  splitFromTelemetryExceptionId: new ObjectID(SPLIT_FROM_ID),
});

describe("which rows of a page are one of a split pair", () => {
  test("the split one, when the one it was split from can be read and is not merged into it", () => {
    expect(
      getSplitPairExceptionIds({
        rows: [SPLIT, exception(PLAIN_ID)],
        splitFroms: [exception(SPLIT_FROM_ID)],
        splitOnes: [],
      }),
    ).toEqual(new Set<string>([SPLIT_ID]));
  });

  test("the one it was split from, which records nothing itself, when a split one points at it", () => {
    expect(
      getSplitPairExceptionIds({
        rows: [exception(SPLIT_FROM_ID), exception(PLAIN_ID)],
        splitFroms: [],
        splitOnes: [SPLIT],
      }),
    ).toEqual(new Set<string>([SPLIT_FROM_ID]));
  });

  test("both halves, when both are on the page", () => {
    expect(
      getSplitPairExceptionIds({
        rows: [SPLIT, exception(SPLIT_FROM_ID), exception(PLAIN_ID)],
        splitFroms: [exception(SPLIT_FROM_ID)],
        splitOnes: [SPLIT],
      }),
    ).toEqual(new Set<string>([SPLIT_ID, SPLIT_FROM_ID]));
  });

  test("one split into several: the one they were split from once, and each of them", () => {
    const second: TelemetryException = exception(SECOND_SPLIT_ID, {
      splitFromTelemetryExceptionId: new ObjectID(SPLIT_FROM_ID),
    });

    expect(
      getSplitPairExceptionIds({
        rows: [SPLIT, second, exception(SPLIT_FROM_ID)],
        splitFroms: [exception(SPLIT_FROM_ID)],
        splitOnes: [SPLIT, second],
      }),
    ).toEqual(new Set<string>([SPLIT_ID, SECOND_SPLIT_ID, SPLIT_FROM_ID]));
  });

  test("not once the one it was split from is merged into it", () => {
    expect(
      getSplitPairExceptionIds({
        rows: [SPLIT],
        splitFroms: [
          exception(SPLIT_FROM_ID, {
            mergedIntoTelemetryExceptionId: new ObjectID(SPLIT_ID),
          }),
        ],
        splitOnes: [],
      }),
    ).toEqual(new Set<string>());
  });

  test("still when the one it was split from is merged into a third exception: Merge Exceptions merges into that one", () => {
    expect(
      getSplitPairExceptionIds({
        rows: [SPLIT],
        splitFroms: [
          exception(SPLIT_FROM_ID, {
            mergedIntoTelemetryExceptionId: new ObjectID(THIRD_ID),
          }),
        ],
        splitOnes: [],
      }),
    ).toEqual(new Set<string>([SPLIT_ID]));
  });

  test("not when the one it was split from cannot be read, as its page shows no note then", () => {
    expect(
      getSplitPairExceptionIds({
        rows: [SPLIT],
        splitFroms: [],
        splitOnes: [],
      }),
    ).toEqual(new Set<string>());
  });

  test("never a row that is not on the page, nor an exception split from itself", () => {
    const self: TelemetryException = exception(PLAIN_ID, {
      splitFromTelemetryExceptionId: new ObjectID(PLAIN_ID),
    });

    expect(
      getSplitPairExceptionIds({
        rows: [self],
        splitFroms: [self],
        splitOnes: [self, SPLIT],
      }),
    ).toEqual(new Set<string>());
  });

  test("ids are compared however they are written", () => {
    const upper: TelemetryException = exception(SPLIT_ID.toUpperCase(), {
      splitFromTelemetryExceptionId: new ObjectID(SPLIT_FROM_ID.toUpperCase()),
    });

    expect(
      getSplitPairExceptionIds({
        rows: [upper, exception(SPLIT_FROM_ID)],
        splitFroms: [exception(SPLIT_FROM_ID)],
        splitOnes: [upper],
      }),
    ).toEqual(new Set<string>([SPLIT_ID, SPLIT_FROM_ID]));
    expect(idOf(upper)).toBe(SPLIT_ID);
    expect(idOf({})).toBe("");
  });
});

describe("what the list reads for a page's split pairs", () => {
  interface ListArgs {
    query: Record<string, unknown>;
    select: unknown;
    limit: number;
    skip: number;
  }

  let listMock: Mock<(args: ListArgs) => Promise<unknown>>;

  beforeEach(() => {
    listMock = jest.fn<(args: ListArgs) => Promise<unknown>>();
    jest.spyOn(ModelAPI, "getList").mockImplementation(((args: ListArgs) => {
      return listMock(args);
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function calls(): Array<ListArgs> {
    return listMock.mock.calls.map((call: Array<unknown>): ListArgs => {
      return call[0] as ListArgs;
    });
  }

  test("nothing at all for an empty page", async () => {
    expect(await readSplitPairExceptionIds([])).toEqual(new Set<string>());
    expect(listMock).not.toHaveBeenCalled();
  });

  test("a page with no split one: the exceptions split from its rows, by the split column's index, nothing else", async () => {
    listMock.mockResolvedValue({
      data: [SPLIT],
      count: 1,
      skip: 0,
      limit: 1,
    });

    const ids: Set<string> = await readSplitPairExceptionIds([
      exception(SPLIT_FROM_ID),
      exception(PLAIN_ID),
    ]);

    expect(ids).toEqual(new Set<string>([SPLIT_FROM_ID]));
    expect(calls()).toHaveLength(1);
    const read: ListArgs = calls()[0]!;
    const includes: Includes = read.query[
      "splitFromTelemetryExceptionId"
    ] as Includes;
    expect(includes).toBeInstanceOf(Includes);
    expect(includes.values).toEqual([SPLIT_FROM_ID, PLAIN_ID]);
    expect(read.select).toBe(SPLIT_ONE_SELECT);
    expect(read.limit).toBe(MAX_EXCEPTIONS_SPLIT_FROM_A_PAGE);
    // As the lists read: merged exceptions are left out by the server.
    expect(read.query).not.toHaveProperty("mergedIntoTelemetryExceptionId");
  });

  test("a page with split ones also reads the exceptions they were split from, by id, at once", async () => {
    listMock.mockImplementation(async (args: ListArgs) => {
      if ("_id" in args.query) {
        return {
          data: [exception(SPLIT_FROM_ID)],
          count: 1,
          skip: 0,
          limit: 1,
        };
      }
      return { data: [], count: 0, skip: 0, limit: 0 };
    });

    const ids: Set<string> = await readSplitPairExceptionIds([
      SPLIT,
      exception(PLAIN_ID),
    ]);

    expect(ids).toEqual(new Set<string>([SPLIT_ID]));
    expect(calls()).toHaveLength(2);
    const byId: ListArgs = calls().find((args: ListArgs): boolean => {
      return "_id" in args.query;
    })!;
    expect((byId.query["_id"] as Includes).values).toEqual([SPLIT_FROM_ID]);
    expect(byId.select).toBe(SPLIT_FROM_ONE_SELECT);
    expect(byId.limit).toBe(1);
    expect(SPLIT_FROM_ONE_SELECT).toHaveProperty(
      "mergedIntoTelemetryExceptionId",
      true,
    );
  });

  test("a read that fails marks nothing, and never fails the list", async () => {
    listMock.mockRejectedValue(new Error("Server Error"));

    expect(await readSplitPairExceptionIds([SPLIT])).toEqual(new Set<string>());
  });

  test("the list reads which exception each row was split from with its rows", () => {
    expect(EXCEPTION_LIST_SELECT).toHaveProperty(
      "splitFromTelemetryExceptionId",
      true,
    );
  });
});

describe("the Split pill on a row", () => {
  const SERVICE: Service = (() => {
    const service: Service = new Service();
    service.name = "checkout";
    return service;
  })();

  afterEach(() => {
    cleanup();
  });

  test("a row that is one of a split pair says Split, and why on hover, beside its other badges", () => {
    render(
      <ExceptionRow
        exception={exception(SPLIT_ID, {
          unhandled: true,
          splitFromTelemetryExceptionId: new ObjectID(SPLIT_FROM_ID),
        })}
        service={SERVICE}
        isSplitPair={true}
      />,
    );

    const pill: HTMLElement = screen.getByTestId("exception-badge-split");
    expect(pill).toHaveTextContent("Split");
    expect(pill).toHaveAttribute(
      "title",
      "A scrub rule split this exception and another one apart. Open it to merge them.",
    );
    // On the service line, after the issue badges, inside the row's button.
    const unhandled: HTMLElement = screen.getByTestId(
      "exception-badge-unhandled",
    );
    expect(unhandled.parentElement).toBe(pill.parentElement);
    expect(
      unhandled.compareDocumentPosition(pill) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(screen.getByRole("button")).getByText("Split")).toBe(pill);
  });

  test("every other row says nothing of it", () => {
    render(
      <ExceptionRow
        exception={exception(PLAIN_ID)}
        service={SERVICE}
        isSplitPair={false}
      />,
    );
    expect(screen.queryByTestId("exception-badge-split")).toBeNull();

    cleanup();
    // A split one the list could not confirm as a pair says nothing either.
    render(<ExceptionRow exception={SPLIT} service={SERVICE} />);
    expect(screen.queryByTestId("exception-badge-split")).toBeNull();
  });

  test("a framed 11px chip in the split note's indigo, as readable as the badges beside it", () => {
    render(<ExceptionSplitPill />);

    const pill: HTMLElement = screen.getByTestId("exception-badge-split");
    for (const className of [
      "rounded-full",
      "border",
      "text-[11px]",
      "border-indigo-200",
      "bg-indigo-50",
      "text-indigo-700",
      "whitespace-nowrap",
    ]) {
      expect(pill).toHaveClass(className);
    }
  });

  test("its words are the reader's: the label and the reason go through the translator", () => {
    const asked: Array<string> = [];
    const translator: Translator = {
      translateText: (text: string): string => {
        asked.push(text);
        return `«${text}»`;
      },
    } as unknown as Translator;

    const pill: { label: string; title: string } =
      getExceptionSplitPillPresentation(translator);

    expect(pill.label).toBe("«Split»");
    expect(pill.title).toBe(
      "«A scrub rule split this exception and another one apart. Open it to merge them.»",
    );
    expect(asked).toEqual([
      "Split",
      "A scrub rule split this exception and another one apart. Open it to merge them.",
    ]);
  });
});

describe("the exceptions list, wired", () => {
  const viewer: string = fs.readFileSync(
    path.join(
      __dirname,
      "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsViewer.tsx",
    ),
    "utf-8",
  );

  test("reads the page's split pairs once its rows are in, and hands each row whether it is one", () => {
    expect(viewer).toContain("readSplitPairExceptionIds(exceptions)");
    expect(viewer).toContain("isSplitPair={splitPairIds.has(idOf(exception))}");
    // Read again whenever the rows are.
    expect(viewer.replace(/\s+/g, " ")).toMatch(
      /readSplitPairExceptionIds\(exceptions\)[\s\S]*?\}, \[exceptions\]\);/,
    );
  });
});

/*
 * The list's filter for them, Split by a scrub rule (#11026): what it
 * counts, what it reads for the chart, and how the chart's fingerprints
 * are worked out. What the list does with them is
 * ExceptionsSplitByScrubRule.test.
 */
describe("what the filter for a project's split pairs reads", () => {
  const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

  interface ReadArgs {
    modelType: unknown;
    query: Record<string, unknown>;
    select: unknown;
    limit: number;
    skip: number;
    sort: Record<string, unknown>;
  }

  let listMock: Mock<(args: ReadArgs) => Promise<unknown>>;
  let countMock: Mock<(args: ReadArgs) => Promise<number>>;

  beforeEach(() => {
    listMock = jest.fn<(args: ReadArgs) => Promise<unknown>>();
    countMock = jest.fn<(args: ReadArgs) => Promise<number>>();
    jest.spyOn(ModelAPI, "getList").mockImplementation(((args: ReadArgs) => {
      return listMock(args);
    }) as never);
    jest.spyOn(ModelAPI, "count").mockImplementation(((args: ReadArgs) => {
      return countMock(args);
    }) as never);
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function reads(): Array<ReadArgs> {
    return listMock.mock.calls.map((call: Array<unknown>): ReadArgs => {
      return call[0] as ReadArgs;
    });
  }

  function withFingerprint(
    id: string,
    fingerprint: string,
  ): TelemetryException {
    return exception(id, { fingerprint });
  }

  test("the address bar's word for it is split=scrub-rule", () => {
    expect(SPLIT_BY_SCRUB_RULE_PARAM).toBe("split");
    expect(SPLIT_BY_SCRUB_RULE_PARAM_VALUE).toBe("scrub-rule");
  });

  test("the exceptions it lists are the project's split ones: splitFromTelemetryExceptionId set, nothing else", () => {
    const query: Record<string, unknown> = getSplitExceptionsQuery() as Record<
      string,
      unknown
    >;

    expect(Object.keys(query).sort()).toEqual([
      "projectId",
      "splitFromTelemetryExceptionId",
    ]);
    expect(query["splitFromTelemetryExceptionId"]).toBeInstanceOf(NotNull);
    expect(String(query["projectId"])).toBe(PROJECT_ID);
    // In any state, last seen at any time; merged ones are the server's to leave out.
    expect(query).not.toHaveProperty("isResolved");
    expect(query).not.toHaveProperty("lastSeenAt");
    expect(query).not.toHaveProperty("mergedIntoTelemetryExceptionId");
  });

  test("with no project picked, it still asks for the split ones only", () => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);

    const query: Record<string, unknown> = getSplitExceptionsQuery() as Record<
      string,
      unknown
    >;

    expect(Object.keys(query)).toEqual(["splitFromTelemetryExceptionId"]);
  });

  test("it is counted with one count of that query", async () => {
    countMock.mockResolvedValue(3);

    expect(await countSplitExceptions()).toBe(3);
    expect(countMock).toHaveBeenCalledTimes(1);
    const args: ReadArgs = countMock.mock.calls[0]![0];
    expect(args.modelType).toBe(TelemetryException);
    expect(args.query["splitFromTelemetryExceptionId"]).toBeInstanceOf(NotNull);
    expect(String(args.query["projectId"])).toBe(PROJECT_ID);
    expect(listMock).not.toHaveBeenCalled();
  });

  test("a project with none counts 0, and a count that fails is null: no filter either way", async () => {
    countMock.mockResolvedValue(0);
    expect(await countSplitExceptions()).toBe(0);

    countMock.mockRejectedValue(new Error("Server Error"));
    expect(await countSplitExceptions()).toBeNull();
  });

  test("the chart's fingerprints: the split ones', then those merged into them, by id, each once", async () => {
    listMock.mockImplementation(async (args: ReadArgs) => {
      if ("mergedIntoTelemetryExceptionId" in args.query) {
        return {
          data: [
            withFingerprint(THIRD_ID, "fp-merged-into-split"),
            // A former fingerprint of the split one, which is merged into it.
            withFingerprint(PLAIN_ID, "fp-split-before-rekey"),
            withFingerprint(SECOND_SPLIT_ID, "fp-split"),
          ],
          count: 3,
        };
      }
      return {
        data: [
          withFingerprint(SPLIT_ID, "fp-split"),
          withFingerprint(SECOND_SPLIT_ID, "fp-second-split"),
          // A row without its fingerprint names no occurrence.
          exception(SPLIT_FROM_ID),
        ],
        count: 3,
      };
    });

    expect(await readSplitExceptionFingerprints()).toEqual([
      "fp-split",
      "fp-second-split",
      "fp-merged-into-split",
      "fp-split-before-rekey",
    ]);

    expect(reads()).toHaveLength(2);
    const [splitOnes, mergedIn] = reads() as [ReadArgs, ReadArgs];
    expect(splitOnes.modelType).toBe(TelemetryException);
    expect(splitOnes.query["splitFromTelemetryExceptionId"]).toBeInstanceOf(
      NotNull,
    );
    expect(String(splitOnes.query["projectId"])).toBe(PROJECT_ID);
    expect(splitOnes.select).toBe(SPLIT_FINGERPRINT_SELECT);
    expect(splitOnes.limit).toBe(MAX_SCOPED_FINGERPRINTS);
    expect(splitOnes.skip).toBe(0);
    expect(splitOnes.sort).toEqual({ _id: SortOrder.Ascending });

    const ids: Includes = mergedIn.query[
      "mergedIntoTelemetryExceptionId"
    ] as Includes;
    expect(ids).toBeInstanceOf(Includes);
    expect(ids.values).toEqual([SPLIT_ID, SECOND_SPLIT_ID, SPLIT_FROM_ID]);
    expect(mergedIn.select).toBe(SPLIT_FINGERPRINT_SELECT);
    expect(mergedIn.limit).toBe(MAX_SCOPED_FINGERPRINTS);
    expect(SPLIT_FINGERPRINT_SELECT).toEqual({ _id: true, fingerprint: true });
  });

  test("a project with no split one reads nothing more, and narrows the chart to nothing", async () => {
    listMock.mockResolvedValue({ data: [], count: 0 });

    expect(await readSplitExceptionFingerprints()).toEqual([]);
    expect(reads()).toHaveLength(1);
  });

  test("a read that fails is no fingerprint at all, never every exception", async () => {
    listMock.mockRejectedValue(new Error("Server Error"));
    expect(await readSplitExceptionFingerprints()).toEqual([]);

    listMock.mockReset();
    listMock.mockImplementation(async (args: ReadArgs) => {
      if ("mergedIntoTelemetryExceptionId" in args.query) {
        throw new Error("Server Error");
      }
      return { data: [withFingerprint(SPLIT_ID, "fp-split")], count: 1 };
    });
    expect(await readSplitExceptionFingerprints()).toEqual([]);
  });
});

describe("the fingerprints the chart and the facet counts read occurrences of", () => {
  test("none narrow them while nothing asks to", () => {
    expect(
      getOccurrenceFingerprints({
        scopeFingerprints: null,
        splitFingerprints: null,
      }),
    ).toBeNull();
  });

  test("an instance scope alone: its own, as before the filter", () => {
    expect(
      getOccurrenceFingerprints({
        scopeFingerprints: ["fp-a", "fp-b"],
        splitFingerprints: null,
      }),
    ).toEqual(["fp-a", "fp-b"]);
    // One that matched nothing still narrows them, to nothing.
    expect(
      getOccurrenceFingerprints({
        scopeFingerprints: [],
        splitFingerprints: null,
      }),
    ).toEqual([]);
  });

  test("the filter alone: the split exceptions'", () => {
    expect(
      getOccurrenceFingerprints({
        scopeFingerprints: null,
        splitFingerprints: ["fp-split", "fp-merged-in"],
      }),
    ).toEqual(["fp-split", "fp-merged-in"]);
    expect(
      getOccurrenceFingerprints({
        scopeFingerprints: null,
        splitFingerprints: [],
      }),
    ).toEqual([]);
  });

  test("both: what both keep, in the scope's order", () => {
    expect(
      getOccurrenceFingerprints({
        scopeFingerprints: ["fp-c", "fp-split", "fp-a", "fp-merged-in"],
        splitFingerprints: ["fp-merged-in", "fp-split", "fp-other-split"],
      }),
    ).toEqual(["fp-split", "fp-merged-in"]);
    expect(
      getOccurrenceFingerprints({
        scopeFingerprints: ["fp-a"],
        splitFingerprints: ["fp-split"],
      }),
    ).toEqual([]);
  });

  test("never hands back the list it was given", () => {
    const scope: Array<string> = ["fp-a"];
    const split: Array<string> = ["fp-split"];

    expect(
      getOccurrenceFingerprints({
        scopeFingerprints: scope,
        splitFingerprints: null,
      }),
    ).not.toBe(scope);
    expect(
      getOccurrenceFingerprints({
        scopeFingerprints: null,
        splitFingerprints: split,
      }),
    ).not.toBe(split);
  });
});
