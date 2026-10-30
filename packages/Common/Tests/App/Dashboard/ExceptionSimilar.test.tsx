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
import ExceptionSimilar, {
  SIMILAR_AI_CHECK_ROUTE_PREFIX,
  SIMILAR_ROUTE_PREFIX,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionSimilar";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  DuplicateVerdictKind,
  SimilarExceptionReason,
} from "../../../Types/Telemetry/SimilarExceptions";

/*
 * The Overview's Similar exceptions card: read on open, shown only when
 * there are some, each a link with why it is similar and its status; Check
 * with OneUptime AI adds a verdict to each, and is not offered while AI is
 * off.
 */

interface RequestArgs {
  url: { toString: () => string };
  data: JSONObject;
}

let aiOffered: boolean = true;
const postMock: Mock<(args: RequestArgs) => Promise<unknown>> =
  jest.fn<(args: RequestArgs) => Promise<unknown>>();

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/UseAiOffered", () => {
  return {
    __esModule: true,
    default: (): boolean => {
      return aiOffered;
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

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): ObjectID => {
        return new ObjectID("10000000-0000-4000-8000-000000000001");
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
const SIMILAR_ID: string = "50000000-0000-4000-8000-000000000002";

const SIMILAR: Array<JSONObject> = [
  {
    telemetryExceptionId: SIMILAR_ID,
    exceptionType: "TypeError",
    message: "Order 1002 failed to reserve stock",
    occurrenceCount: 7,
    isResolved: true,
    isArchived: false,
    reason: SimilarExceptionReason.SimilarMessage,
  },
];

function ok(data: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, data, {});
}

function renderSimilar(): void {
  render(
    <MemoryRouter>
      <ExceptionSimilar telemetryExceptionId={new ObjectID(EXCEPTION_ID)} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  aiOffered = true;
  postMock.mockReset();
  postMock.mockImplementation(async (args: RequestArgs) => {
    const url: string = args.url.toString();

    if (url.includes(SIMILAR_AI_CHECK_ROUTE_PREFIX)) {
      return ok({
        similar: SIMILAR,
        verdicts: [
          {
            telemetryExceptionId: SIMILAR_ID,
            verdict: DuplicateVerdictKind.Duplicate,
            reason: "Both fail reserving stock in the same function.",
          },
        ],
        generatedAt: "2026-10-30T12:00:00.000Z",
      });
    }

    if (url.includes(SIMILAR_ROUTE_PREFIX)) {
      return ok({ similar: SIMILAR });
    }

    throw new Error(`Unexpected POST ${url}`);
  });
});

afterEach(() => {
  cleanup();
});

describe("ExceptionSimilar", () => {
  test("lists the similar exceptions, each a link with why and its status", async () => {
    renderSimilar();

    const item: HTMLElement = await screen.findByTestId(
      "exception-similar-item",
    );
    expect(postMock.mock.calls[0]?.[0].url.toString()).toContain(
      `${SIMILAR_ROUTE_PREFIX}/${EXCEPTION_ID}`,
    );
    expect(item).toHaveTextContent("TypeError");
    expect(item).toHaveTextContent("Similar message");
    expect(item).toHaveTextContent("Resolved");
    expect(item).toHaveTextContent("7 occurrences");
    expect(item).toHaveTextContent("Order 1002 failed to reserve stock");
    expect(item.getAttribute("href")).toContain(SIMILAR_ID);
    expect(screen.queryByTestId("exception-similar-verdict")).toBeNull();
  });

  test("none similar: no card at all", async () => {
    postMock.mockImplementation(async () => {
      return ok({ similar: [] });
    });

    renderSimilar();

    await waitFor(() => {
      expect(postMock).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("exception-similar")).toBeNull();
  });

  test("a failed read shows no card", async () => {
    postMock.mockImplementation(async () => {
      return new HTTPErrorResponse(500, { message: "down" }, {});
    });

    renderSimilar();

    await waitFor(() => {
      expect(postMock).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("exception-similar")).toBeNull();
  });

  test("Check with OneUptime AI adds a verdict and its reason to each", async () => {
    renderSimilar();
    await screen.findByTestId("exception-similar-item");

    fireEvent.click(screen.getByTestId("exception-similar-ai-check"));

    expect(
      await screen.findByTestId("exception-similar-verdict"),
    ).toHaveTextContent("Likely the same bug");
    expect(
      screen.getByTestId("exception-similar-verdict-reason"),
    ).toHaveTextContent("Both fail reserving stock in the same function.");
  });

  test("a failed check shows inline", async () => {
    renderSimilar();
    await screen.findByTestId("exception-similar-item");

    postMock.mockImplementation(async () => {
      return new HTTPErrorResponse(
        400,
        { message: "AI is turned off for this project." },
        {},
      );
    });
    fireEvent.click(screen.getByTestId("exception-similar-ai-check"));

    expect(
      await screen.findByTestId("exception-similar-error"),
    ).toHaveTextContent("AI is turned off for this project.");
  });

  test("while AI is off: the list, but no check", async () => {
    aiOffered = false;
    renderSimilar();

    await screen.findByTestId("exception-similar-item");
    expect(screen.queryByTestId("exception-similar-ai-check")).toBeNull();
  });
});
