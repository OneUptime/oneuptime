import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
import ExceptionSimilar from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionSimilar";
import ExceptionMergedPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionMergedPanel";
import {
  MERGE_ROUTE_PREFIX,
  UNMERGE_ROUTE_PREFIX,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionMerge";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  DuplicateVerdictKind,
  SimilarExceptionReason,
} from "../../../Types/Telemetry/SimilarExceptions";

/*
 * Merging duplicates, on screen.
 *
 *   - Similar exceptions offers Merge on a row OneUptime AI calls "Likely
 *     the same bug", in the same service, to someone who may edit
 *     exceptions; it asks first, merges, and tells the page to read itself
 *     again.
 *   - A merged exception's page says where it went, with Unmerge; an
 *     exception others were merged into lists them, each with Unmerge.
 */

interface RequestArgs {
  url: { toString: () => string };
  data: JSONObject;
}

let canEdit: boolean = true;
const postMock: Mock<(args: RequestArgs) => Promise<unknown>> =
  jest.fn<(args: RequestArgs) => Promise<unknown>>();

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/UseAiOffered", () => {
  return {
    __esModule: true,
    default: (): boolean => {
      return true;
    },
  };
});

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

const EXCEPTION_ID: string = "50000000-0000-4000-8000-000000000001";
const DUPLICATE_ID: string = "50000000-0000-4000-8000-000000000002";
const RELATED_ID: string = "50000000-0000-4000-8000-000000000003";
const OTHER_SERVICE_ID: string = "50000000-0000-4000-8000-000000000004";

function similarRow(id: string, sameService: boolean = true): JSONObject {
  return {
    telemetryExceptionId: id,
    exceptionType: "TypeError",
    message: `failed ${id.slice(-1)}`,
    occurrenceCount: 4,
    isResolved: false,
    isArchived: false,
    reason: SimilarExceptionReason.SameCodeLocation,
    ...(sameService ? { isSameService: true } : {}),
  };
}

const SIMILAR: Array<JSONObject> = [
  similarRow(DUPLICATE_ID),
  similarRow(RELATED_ID),
  similarRow(OTHER_SERVICE_ID, false),
];

function ok(data: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, data, {});
}

function posts(prefix: string): Array<RequestArgs> {
  return postMock.mock.calls
    .map((call: Array<unknown>): RequestArgs => {
      return call[0] as RequestArgs;
    })
    .filter((args: RequestArgs): boolean => {
      return args.url.toString().includes(prefix);
    });
}

beforeEach(() => {
  canEdit = true;
  postMock.mockReset();
  postMock.mockImplementation(async (args: RequestArgs) => {
    const url: string = args.url.toString();

    if (url.includes("/similar-ai-check/")) {
      return ok({
        similar: SIMILAR,
        verdicts: [
          {
            telemetryExceptionId: DUPLICATE_ID,
            verdict: DuplicateVerdictKind.Duplicate,
            reason: "Same frame.",
          },
          {
            telemetryExceptionId: RELATED_ID,
            verdict: DuplicateVerdictKind.Related,
            reason: "Same area.",
          },
          {
            telemetryExceptionId: OTHER_SERVICE_ID,
            verdict: DuplicateVerdictKind.Duplicate,
            reason: "Same frame, another service.",
          },
        ],
        generatedAt: new Date().toISOString(),
      });
    }

    if (url.includes("/similar/")) {
      return ok({ similar: SIMILAR });
    }

    if (url.includes(MERGE_ROUTE_PREFIX) || url.includes(UNMERGE_ROUTE_PREFIX)) {
      return ok({});
    }

    return ok({});
  });
});

afterEach(() => {
  cleanup();
});

async function renderChecked(
  props: { canMerge?: boolean; onMerged?: () => void } = {},
): Promise<void> {
  render(
    <MemoryRouter>
      <ExceptionSimilar
        telemetryExceptionId={new ObjectID(EXCEPTION_ID)}
        canMerge={props.canMerge ?? true}
        onMerged={props.onMerged}
      />
    </MemoryRouter>,
  );

  await screen.findAllByTestId("exception-similar-item");
  fireEvent.click(screen.getByTestId("exception-similar-ai-check"));
  await screen.findAllByTestId("exception-similar-verdict");
}

describe("Merge on a likely duplicate", () => {
  test("is offered only on a row called the same bug, in the same service", async () => {
    await renderChecked();

    const buttons: Array<HTMLElement> = screen.getAllByTestId(
      "exception-similar-merge",
    );
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.closest("li")).toHaveTextContent("failed 2");
  });

  test("is not offered before the check, nor to someone who may not merge into this exception", async () => {
    render(
      <MemoryRouter>
        <ExceptionSimilar
          telemetryExceptionId={new ObjectID(EXCEPTION_ID)}
          canMerge={true}
        />
      </MemoryRouter>,
    );
    await screen.findAllByTestId("exception-similar-item");
    expect(screen.queryByTestId("exception-similar-merge")).toBeNull();

    cleanup();
    await renderChecked({ canMerge: false });
    expect(screen.queryByTestId("exception-similar-merge")).toBeNull();
  });

  test("asks first, then merges it into this exception and has the page read itself again", async () => {
    const onMerged: Mock<() => void> = jest.fn<() => void>();
    await renderChecked({ onMerged });

    fireEvent.click(screen.getByTestId("exception-similar-merge"));
    expect(screen.getByText("Merge into this exception?")).toBeInTheDocument();
    expect(posts(MERGE_ROUTE_PREFIX)).toHaveLength(0);

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(onMerged).toHaveBeenCalledTimes(1);
    });
    expect(posts(MERGE_ROUTE_PREFIX)).toHaveLength(1);
    expect(posts(MERGE_ROUTE_PREFIX)[0]!.url.toString()).toContain(
      `${MERGE_ROUTE_PREFIX}/${EXCEPTION_ID}`,
    );
    expect(posts(MERGE_ROUTE_PREFIX)[0]!.data).toEqual({
      mergedTelemetryExceptionIds: [DUPLICATE_ID],
    });
    // The merged one leaves the list.
    expect(screen.queryByText("failed 2")).toBeNull();
  });

  test("cancelling merges nothing", async () => {
    await renderChecked();

    fireEvent.click(screen.getByTestId("exception-similar-merge"));
    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    expect(posts(MERGE_ROUTE_PREFIX)).toHaveLength(0);
    expect(screen.queryByText("Merge into this exception?")).toBeNull();
  });

  test("a refused merge says why, in the dialog, and keeps the row", async () => {
    postMock.mockImplementation(async (args: RequestArgs) => {
      const url: string = args.url.toString();
      if (url.includes(MERGE_ROUTE_PREFIX)) {
        return new HTTPErrorResponse(
          400,
          { message: "Only exceptions of the same service can be merged." },
          {},
        );
      }
      if (url.includes("/similar-ai-check/")) {
        return ok({
          similar: SIMILAR,
          verdicts: [
            {
              telemetryExceptionId: DUPLICATE_ID,
              verdict: DuplicateVerdictKind.Duplicate,
              reason: "Same frame.",
            },
          ],
          generatedAt: new Date().toISOString(),
        });
      }
      return ok({ similar: SIMILAR });
    });

    await renderChecked();
    fireEvent.click(screen.getByTestId("exception-similar-merge"));
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    expect(
      await screen.findByText(
        "Only exceptions of the same service can be merged.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("failed 2").length).toBeGreaterThan(0);
  });
});

function exception(
  id: string,
  values: Partial<TelemetryException> = {},
): TelemetryException {
  const row: TelemetryException = new TelemetryException();
  row._id = id;
  row.exceptionType = "TypeError";
  row.message = `failed ${id.slice(-1)}`;
  row.occuranceCount = 3;
  Object.assign(row, values);
  return row;
}

describe("what a merge leaves on an exception's page", () => {
  test("a merged exception says where it went, links there, and offers Unmerge", async () => {
    const onChanged: Mock<() => void> = jest.fn<() => void>();

    render(
      <MemoryRouter>
        <ExceptionMergedPanel
          exception={exception(DUPLICATE_ID, {
            mergedIntoTelemetryExceptionId: new ObjectID(EXCEPTION_ID),
          })}
          mergedInto={exception(EXCEPTION_ID)}
          members={[]}
          onChanged={onChanged}
        />
      </MemoryRouter>,
    );

    const note: HTMLElement = screen.getByTestId("exception-merged-into");
    expect(note).toHaveTextContent(
      "This exception was merged into TypeError: failed 1. Its occurrences count there.",
    );
    expect(screen.getByTestId("exception-merged-into-link")).toHaveAttribute(
      "href",
      expect.stringContaining(EXCEPTION_ID),
    );

    fireEvent.click(screen.getByTestId("exception-unmerge"));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    expect(posts(UNMERGE_ROUTE_PREFIX)[0]!.url.toString()).toContain(
      `${UNMERGE_ROUTE_PREFIX}/${DUPLICATE_ID}`,
    );
  });

  test("an exception others were merged into lists them, each with its occurrences and Unmerge", async () => {
    const onChanged: Mock<() => void> = jest.fn<() => void>();

    render(
      <MemoryRouter>
        <ExceptionMergedPanel
          exception={exception(EXCEPTION_ID)}
          members={[
            exception(DUPLICATE_ID, { occuranceCount: 1 }),
            exception(RELATED_ID, { occuranceCount: 12 }),
          ]}
          onChanged={onChanged}
        />
      </MemoryRouter>,
    );

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "exception-merged-member",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("TypeError: failed 2");
    expect(rows[0]).toHaveTextContent("1 occurrence");
    expect(rows[1]).toHaveTextContent("12 occurrences");

    fireEvent.click(screen.getAllByTestId("exception-merged-member-unmerge")[1]!);

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    expect(posts(UNMERGE_ROUTE_PREFIX)[0]!.url.toString()).toContain(
      `${UNMERGE_ROUTE_PREFIX}/${RELATED_ID}`,
    );
  });

  test("nothing merged in, and not merged: nothing at all", () => {
    const { container } = render(
      <MemoryRouter>
        <ExceptionMergedPanel
          exception={exception(EXCEPTION_ID)}
          members={[]}
          onChanged={() => {}}
        />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test("Unmerge is not offered to someone who may not edit exceptions", () => {
    canEdit = false;

    render(
      <MemoryRouter>
        <ExceptionMergedPanel
          exception={exception(EXCEPTION_ID)}
          members={[exception(DUPLICATE_ID)]}
          onChanged={() => {}}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("exception-merged-member")).toBeInTheDocument();
    expect(screen.queryByTestId("exception-merged-member-unmerge")).toBeNull();
  });

  test("a failed unmerge says why and changes nothing", async () => {
    const onChanged: Mock<() => void> = jest.fn<() => void>();
    postMock.mockImplementation(async () => {
      return new HTTPErrorResponse(
        403,
        { message: "You do not have permission to edit this exception." },
        {},
      );
    });

    render(
      <MemoryRouter>
        <ExceptionMergedPanel
          exception={exception(EXCEPTION_ID)}
          members={[exception(DUPLICATE_ID)]}
          onChanged={onChanged}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("exception-merged-member-unmerge"));

    expect(await screen.findByTestId("exception-merge-error")).toHaveTextContent(
      "You do not have permission to edit this exception.",
    );
    expect(onChanged).not.toHaveBeenCalled();
  });
});
