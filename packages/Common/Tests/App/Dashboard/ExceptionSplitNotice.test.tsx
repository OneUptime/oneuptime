import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import ExceptionSplitNotice from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionSplitNotice";
import ExceptionMergedPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionMergedPanel";
import {
  MAX_SPLIT_INTO_EXCEPTIONS,
  MERGE_ROUTE_PREFIX,
  MERGE_SPLIT_ROUTE_PREFIX,
  SPLIT_INTO_EXCEPTION_SELECT,
  getListedMergedExceptions,
  getSplitIntoNoticeExceptions,
  isSplitNoticeShown,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionMerge";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Toast from "../../../UI/Utils/Toast";

/*
 * An exception a scrub rule split before #10434, on screen (#10618).
 *
 *   - Its page says which exception it was split from, linked, and why.
 *   - Someone who may edit exceptions merges the two with one click, with no
 *     OneUptime AI asked: one request, the server keeps the older one, a
 *     toast says it worked and the page reads itself again.
 *   - Anyone else reads the note, without the button.
 *   - Merged already, or nothing recorded: no note.
 *
 * And an exception moved to a private fingerprint (#10619): the row that
 * keeps its old fingerprint is part of it, never listed as merged into it.
 */

interface RequestArgs {
  url: { toString: () => string };
  data: JSONObject;
}

let canEdit: boolean = true;
let mergeFails: boolean = false;
const postMock: Mock<(args: RequestArgs) => Promise<unknown>> =
  jest.fn<(args: RequestArgs) => Promise<unknown>>();

jest.mock("../../../UI/Utils/PermissionGate", () => {
  return {
    __esModule: true,
    ModelAction: { Update: "update", Create: "create" },
    default: {
      check: (): { isAllowed: boolean } => {
        return { isAllowed: canEdit };
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (args: RequestArgs): Promise<unknown> => {
        return postMock(args);
      },
      getFriendlyMessage: (error: unknown): string => {
        if (error instanceof HTTPErrorResponse) {
          return String((error.data as JSONObject)?.["message"] || "Failed");
        }
        return error instanceof Error ? error.message : String(error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): JSONObject => {
        return {};
      },
    },
  };
});

const SPLIT_ID: string = "60000000-0000-4000-8000-000000000001";
const SPLIT_FROM_ID: string = "60000000-0000-4000-8000-000000000002";
const OTHER_ID: string = "60000000-0000-4000-8000-000000000003";

function exception(
  id: string,
  values: Partial<TelemetryException> = {},
): TelemetryException {
  const row: TelemetryException = new TelemetryException();
  row._id = id;
  row.exceptionType = "CartNotFoundError";
  row.message =
    id === SPLIT_ID ? "No cart for [REDACTED]" : "No cart for ada@example.com";
  row.occuranceCount = 3;
  Object.assign(row, values);
  return row;
}

const SPLIT: TelemetryException = exception(SPLIT_ID, {
  splitFromTelemetryExceptionId: new ObjectID(SPLIT_FROM_ID),
});

function posts(prefix: string): Array<RequestArgs> {
  return postMock.mock.calls
    .map((call: Array<unknown>): RequestArgs => {
      return call[0] as RequestArgs;
    })
    .filter((args: RequestArgs): boolean => {
      return args.url.toString().includes(prefix);
    });
}

function renderNotice(
  values: {
    exception?: TelemetryException;
    splitFrom?: TelemetryException | null;
    onMerged?: () => void;
  } = {},
): void {
  render(
    <MemoryRouter>
      <ExceptionSplitNotice
        exception={values.exception || SPLIT}
        splitFrom={
          values.splitFrom === undefined
            ? exception(SPLIT_FROM_ID)
            : values.splitFrom
        }
        onMerged={values.onMerged || ((): void => {})}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  canEdit = true;
  mergeFails = false;
  postMock.mockReset();
  postMock.mockImplementation(async () => {
    if (mergeFails) {
      return new HTTPErrorResponse(
        400,
        {
          message:
            "You do not have permission to edit the exception this one was split from.",
        },
        {},
      );
    }

    return new HTTPResponse<JSONObject>(
      200,
      {
        telemetryExceptionId: SPLIT_FROM_ID,
        merged: [{ telemetryExceptionId: SPLIT_ID, outcome: "merged" }],
      },
      {},
    );
  });
  jest.spyOn(Toast, "success");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("an exception a scrub rule split, on its page", () => {
  test("says plainly which exception it was split from, and why, linked to it", () => {
    renderNotice();

    const note: HTMLElement = screen.getByTestId("exception-split-from");
    expect(note).toHaveTextContent(
      "A scrub rule split this exception from CartNotFoundError: No cart for ada@example.com. Once the rule hid part of what it says, its occurrences were counted here instead of there.",
    );
    expect(screen.getByTestId("exception-split-from-link")).toHaveAttribute(
      "href",
      expect.stringContaining(SPLIT_FROM_ID),
    );
  });

  test("an editor merges the two with one click: one request, no AI, a toast, and the page reads itself again", async () => {
    const onMerged: Mock<() => void> = jest.fn<() => void>();
    renderNotice({ onMerged });

    expect(screen.getByTestId("exception-split-from-hint")).toHaveTextContent(
      "Merge them to count every occurrence as one exception again. The older one is kept, and you can unmerge them later.",
    );

    fireEvent.click(screen.getByTestId("exception-split-merge"));

    await waitFor(() => {
      expect(onMerged).toHaveBeenCalledTimes(1);
    });

    const requests: Array<RequestArgs> = posts(MERGE_SPLIT_ROUTE_PREFIX);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url.toString()).toContain(
      `${MERGE_SPLIT_ROUTE_PREFIX}/${SPLIT_ID}`,
    );
    // The server picks the older one: the page names no survivor.
    expect(requests[0]!.data).toEqual({});
    // Nothing else was asked, OneUptime AI least of all.
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(posts("similar-ai-check")).toEqual([]);
    expect(Toast.success).toHaveBeenCalledWith("Exceptions merged");
  });

  test("a merge that is refused says why where it was asked, and the page stays as it is", async () => {
    const onMerged: Mock<() => void> = jest.fn<() => void>();
    mergeFails = true;
    renderNotice({ onMerged });

    fireEvent.click(screen.getByTestId("exception-split-merge"));

    await waitFor(() => {
      expect(
        screen.getByTestId("exception-split-merge-error"),
      ).toHaveTextContent(
        "You do not have permission to edit the exception this one was split from.",
      );
    });
    expect(onMerged).not.toHaveBeenCalled();
    expect(Toast.success).not.toHaveBeenCalled();
  });

  test("someone who may not edit exceptions reads the note, with no Merge", () => {
    canEdit = false;
    renderNotice();

    expect(screen.getByTestId("exception-split-from")).toBeInTheDocument();
    expect(screen.queryByTestId("exception-split-merge")).toBeNull();
    expect(screen.getByTestId("exception-split-from-hint")).toHaveTextContent(
      "Someone who can edit exceptions can merge them into one.",
    );
  });

  test.each([
    ["no scrub rule split it", exception(SPLIT_ID), exception(SPLIT_FROM_ID)],
    [
      "it is merged into the other already",
      exception(SPLIT_ID, {
        splitFromTelemetryExceptionId: new ObjectID(SPLIT_FROM_ID),
        mergedIntoTelemetryExceptionId: new ObjectID(SPLIT_FROM_ID),
      }),
      exception(SPLIT_FROM_ID),
    ],
    [
      "the other is merged into it already",
      SPLIT,
      exception(SPLIT_FROM_ID, {
        mergedIntoTelemetryExceptionId: new ObjectID(SPLIT_ID),
      }),
    ],
    ["the other could not be read", SPLIT, null],
  ])(
    "no note when %s",
    (
      _name: string,
      splitException: TelemetryException,
      splitFrom: TelemetryException | null,
    ) => {
      renderNotice({ exception: splitException, splitFrom });

      expect(screen.queryByTestId("exception-split-from")).toBeNull();
    },
  );

  test("the other merged into a third exception still names the pair: the server merges into that one", () => {
    expect(
      isSplitNoticeShown({
        exception: SPLIT,
        splitFrom: exception(SPLIT_FROM_ID, {
          mergedIntoTelemetryExceptionId: new ObjectID(OTHER_ID),
        }),
      }),
    ).toBe(true);
  });
});

describe("an exception moved to a private fingerprint, on its page", () => {
  test("the row that keeps its old fingerprint is not listed as merged into it, and offers no Unmerge", () => {
    const formerFingerprint: TelemetryException = exception(OTHER_ID, {
      formerFingerprintOfTelemetryExceptionId: new ObjectID(SPLIT_FROM_ID),
    });
    const merged: TelemetryException = exception(SPLIT_ID, {
      occuranceCount: 2,
    });

    expect(getListedMergedExceptions([formerFingerprint, merged])).toEqual([
      merged,
    ]);

    render(
      <MemoryRouter>
        <ExceptionMergedPanel
          exception={exception(SPLIT_FROM_ID)}
          members={[formerFingerprint, merged]}
          onChanged={(): void => {}}
        />
      </MemoryRouter>,
    );

    expect(screen.getAllByTestId("exception-merged-member")).toHaveLength(1);
    expect(
      screen.getAllByTestId("exception-merged-member-unmerge"),
    ).toHaveLength(1);
    expect(posts(MERGE_ROUTE_PREFIX)).toEqual([]);
  });

  test("with nothing else merged into it, there is no list at all", () => {
    render(
      <MemoryRouter>
        <ExceptionMergedPanel
          exception={exception(SPLIT_FROM_ID)}
          members={[
            exception(OTHER_ID, {
              formerFingerprintOfTelemetryExceptionId: new ObjectID(
                SPLIT_FROM_ID,
              ),
            }),
          ]}
          onChanged={(): void => {}}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("exception-merged-members")).toBeNull();
  });
});

/*
 * The exception a scrub rule split another from, on its page (#10897).
 *
 * The older of the two - the one that went quiet, often resolved by the
 * time anyone looks - records nothing of the pair itself. Its page reads
 * the exceptions recorded as split from it, and says so as the split one's
 * page does: which, linked, and why, with the same Merge Exceptions.
 */
describe("the exception a scrub rule split others from, on its page", () => {
  const OLDER: TelemetryException = exception(SPLIT_FROM_ID);
  const SECOND_SPLIT_ID: string = "60000000-0000-4000-8000-000000000004";
  const SECOND_SPLIT: TelemetryException = exception(SECOND_SPLIT_ID, {
    message: "No cart for a***@***.com",
    splitFromTelemetryExceptionId: new ObjectID(SPLIT_FROM_ID),
  });

  function renderOlderPage(
    values: {
      exception?: TelemetryException;
      splitFrom?: TelemetryException | null;
      splitInto?: Array<TelemetryException>;
      onMerged?: () => void;
    } = {},
  ): void {
    render(
      <MemoryRouter>
        <ExceptionSplitNotice
          exception={values.exception || OLDER}
          splitFrom={values.splitFrom === undefined ? null : values.splitFrom}
          splitInto={values.splitInto || [SPLIT]}
          onMerged={values.onMerged || ((): void => {})}
        />
      </MemoryRouter>,
    );
  }

  test("names the exception split from it, linked, and why", () => {
    renderOlderPage();

    const note: HTMLElement = screen.getByTestId("exception-split-into");
    expect(note).toHaveTextContent(
      "A scrub rule split CartNotFoundError: No cart for [REDACTED] from this exception. Once the rule hid part of what it says, its occurrences were counted there instead of here.",
    );
    expect(screen.getByTestId("exception-split-into-link")).toHaveAttribute(
      "href",
      expect.stringContaining(SPLIT_ID),
    );
    expect(screen.getByTestId("exception-split-into-hint")).toHaveTextContent(
      "Merge them to count every occurrence as one exception again. The older one is kept, and you can unmerge them later.",
    );
    // The split one's note is not drawn here: this one was split from none.
    expect(screen.queryByTestId("exception-split-from")).toBeNull();
    expect(screen.queryByTestId("exception-split-into-list")).toBeNull();
  });

  test("an editor merges the two with one click from here too: one request for the split one, no AI, a toast, and the page reads itself again", async () => {
    const onMerged: Mock<() => void> = jest.fn<() => void>();
    renderOlderPage({ onMerged });

    fireEvent.click(screen.getByTestId("exception-split-into-merge"));

    await waitFor(() => {
      expect(onMerged).toHaveBeenCalledTimes(1);
    });

    const requests: Array<RequestArgs> = posts(MERGE_SPLIT_ROUTE_PREFIX);
    expect(requests).toHaveLength(1);
    // The pair is recorded on the split one: the server reads it from there.
    expect(requests[0]!.url.toString()).toContain(
      `${MERGE_SPLIT_ROUTE_PREFIX}/${SPLIT_ID}`,
    );
    expect(requests[0]!.data).toEqual({});
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(posts("similar-ai-check")).toEqual([]);
    expect(Toast.success).toHaveBeenCalledWith("Exceptions merged");
  });

  test("split into several: lists each, linked, oldest kept, and one Merge Exceptions merges them all, one after another", async () => {
    const onMerged: Mock<() => void> = jest.fn<() => void>();
    renderOlderPage({ splitInto: [SPLIT, SECOND_SPLIT], onMerged });

    expect(screen.getByTestId("exception-split-into")).toHaveTextContent(
      "A scrub rule split these exceptions from this one. Once the rule hid part of what it says, its occurrences were counted there instead of here.",
    );
    const links: Array<HTMLElement> = within(
      screen.getByTestId("exception-split-into-list"),
    ).getAllByTestId("exception-split-into-link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent(
      "CartNotFoundError: No cart for [REDACTED]",
    );
    expect(links[1]).toHaveTextContent(
      "CartNotFoundError: No cart for a***@***.com",
    );
    expect(links[1]).toHaveAttribute(
      "href",
      expect.stringContaining(SECOND_SPLIT_ID),
    );
    expect(screen.getByTestId("exception-split-into-hint")).toHaveTextContent(
      "Merge them to count every occurrence as one exception again. The oldest one is kept, and you can unmerge them later.",
    );
    expect(screen.getAllByTestId("exception-split-into-merge")).toHaveLength(1);

    fireEvent.click(screen.getByTestId("exception-split-into-merge"));

    await waitFor(() => {
      expect(onMerged).toHaveBeenCalledTimes(1);
    });

    expect(
      posts(MERGE_SPLIT_ROUTE_PREFIX).map((args: RequestArgs): string => {
        return args.url.toString();
      }),
    ).toEqual([
      expect.stringContaining(`${MERGE_SPLIT_ROUTE_PREFIX}/${SPLIT_ID}`),
      expect.stringContaining(`${MERGE_SPLIT_ROUTE_PREFIX}/${SECOND_SPLIT_ID}`),
    ]);
    expect(Toast.success).toHaveBeenCalledTimes(1);
  });

  test("a refusal part-way stops there and says why: the page stays, and Merge Exceptions again merges what is left", async () => {
    const onMerged: Mock<() => void> = jest.fn<() => void>();
    let calls: number = 0;
    postMock.mockImplementation(async () => {
      calls++;
      if (calls === 2) {
        return new HTTPErrorResponse(
          400,
          { message: "You do not have permission to edit this exception." },
          {},
        );
      }
      return new HTTPResponse<JSONObject>(
        200,
        { telemetryExceptionId: SPLIT_FROM_ID, merged: [] },
        {},
      );
    });
    renderOlderPage({ splitInto: [SPLIT, SECOND_SPLIT], onMerged });

    fireEvent.click(screen.getByTestId("exception-split-into-merge"));

    await waitFor(() => {
      expect(
        screen.getByTestId("exception-split-into-merge-error"),
      ).toHaveTextContent("You do not have permission to edit this exception.");
    });
    expect(onMerged).not.toHaveBeenCalled();
    expect(Toast.success).not.toHaveBeenCalled();
    expect(posts(MERGE_SPLIT_ROUTE_PREFIX)).toHaveLength(2);

    fireEvent.click(screen.getByTestId("exception-split-into-merge"));

    await waitFor(() => {
      expect(onMerged).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId("exception-split-into-merge-error")).toBeNull();
  });

  test("someone who may not edit exceptions reads the note, with no Merge", () => {
    canEdit = false;
    renderOlderPage({ splitInto: [SPLIT, SECOND_SPLIT] });

    expect(screen.getByTestId("exception-split-into")).toBeInTheDocument();
    expect(screen.queryByTestId("exception-split-into-merge")).toBeNull();
    expect(screen.getByTestId("exception-split-into-hint")).toHaveTextContent(
      "Someone who can edit exceptions can merge them into one.",
    );
    expect(postMock).not.toHaveBeenCalled();
  });

  test.each([
    ["nothing was split from it", OLDER, []],
    [
      "it is merged into another exception, whose page says so instead",
      exception(SPLIT_FROM_ID, {
        mergedIntoTelemetryExceptionId: new ObjectID(OTHER_ID),
      }),
      [SPLIT],
    ],
    [
      "the split one is merged already",
      OLDER,
      [
        exception(SPLIT_ID, {
          splitFromTelemetryExceptionId: new ObjectID(SPLIT_FROM_ID),
          mergedIntoTelemetryExceptionId: new ObjectID(SPLIT_FROM_ID),
        }),
      ],
    ],
    [
      "what was read was split from another exception",
      OLDER,
      [
        exception(SPLIT_ID, {
          splitFromTelemetryExceptionId: new ObjectID(OTHER_ID),
        }),
      ],
    ],
    [
      "what was read is this exception itself",
      exception(SPLIT_FROM_ID, {
        splitFromTelemetryExceptionId: new ObjectID(SPLIT_FROM_ID),
      }),
      [
        exception(SPLIT_FROM_ID, {
          splitFromTelemetryExceptionId: new ObjectID(SPLIT_FROM_ID),
        }),
      ],
    ],
  ])(
    "no note when %s",
    (
      _name: string,
      older: TelemetryException,
      splitInto: Array<TelemetryException>,
    ) => {
      renderOlderPage({ exception: older, splitInto });

      expect(screen.queryByTestId("exception-split-into")).toBeNull();
    },
  );

  test("an exception split from one and split into another says both, each with its own Merge Exceptions", () => {
    const middleId: string = "60000000-0000-4000-8000-000000000005";
    const middle: TelemetryException = exception(middleId, {
      splitFromTelemetryExceptionId: new ObjectID(SPLIT_FROM_ID),
    });
    const newest: TelemetryException = exception(SPLIT_ID, {
      splitFromTelemetryExceptionId: new ObjectID(middleId),
    });

    renderOlderPage({
      exception: middle,
      splitFrom: exception(SPLIT_FROM_ID),
      splitInto: [newest],
    });

    expect(screen.getByTestId("exception-split-from")).toBeInTheDocument();
    expect(screen.getByTestId("exception-split-into")).toBeInTheDocument();
    expect(screen.getByTestId("exception-split-merge")).toBeInTheDocument();
    expect(
      screen.getByTestId("exception-split-into-merge"),
    ).toBeInTheDocument();
  });

  test("names each split one once, in the order the page read them: oldest first", () => {
    expect(
      getSplitIntoNoticeExceptions({
        exception: OLDER,
        splitInto: [SPLIT, SECOND_SPLIT, SPLIT],
      }),
    ).toEqual([SPLIT, SECOND_SPLIT]);
    expect(
      getSplitIntoNoticeExceptions({ exception: OLDER, splitInto: null }),
    ).toEqual([]);
    expect(
      getSplitIntoNoticeExceptions({
        exception: new TelemetryException(),
        splitInto: [SPLIT],
      }),
    ).toEqual([]);
  });

  test("the page reads them as the lists read exceptions, by the split column, oldest first, at most a page's worth", () => {
    expect(SPLIT_INTO_EXCEPTION_SELECT).toEqual({
      _id: true,
      exceptionType: true,
      message: true,
      firstSeenAt: true,
      splitFromTelemetryExceptionId: true,
      mergedIntoTelemetryExceptionId: true,
    });
    expect(MAX_SPLIT_INTO_EXCEPTIONS).toBeGreaterThanOrEqual(10);
  });
});
