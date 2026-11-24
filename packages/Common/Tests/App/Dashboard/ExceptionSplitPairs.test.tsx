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
  SPLIT_FROM_ONE_SELECT,
  SPLIT_ONE_SELECT,
  getSplitPairExceptionIds,
  idOf,
  readSplitPairExceptionIds,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionSplitPairs";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
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
