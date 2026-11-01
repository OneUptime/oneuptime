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
import ExceptionAIDigest, {
  DIGEST_ROUTE,
  getExceptionRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionAIDigest";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  ExceptionDigestKind,
  ExceptionDigestPriority,
} from "../../../Types/Telemetry/ExceptionAIDigest";

/*
 * Insights' What's new card: one click asks OneUptime AI to sum up the
 * exceptions first seen, or back, in the last day; it lists them the most
 * urgent first, each a link to the exception; with nothing new it says so;
 * a failure shows inline; and it is hidden while the project's AI is off.
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

const NEW_ID: string = "20000000-0000-4000-8000-000000000001";
const REGRESSED_ID: string = "20000000-0000-4000-8000-000000000002";

function ok(data: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, data, {});
}

function renderDigest(): void {
  render(
    <MemoryRouter>
      <ExceptionAIDigest />
    </MemoryRouter>,
  );
}

async function summarize(): Promise<void> {
  fireEvent.click(screen.getByTestId("exception-ai-digest-summarize"));
  await waitFor(() => {
    expect(postMock).toHaveBeenCalled();
  });
}

beforeEach(() => {
  aiOffered = true;
  postMock.mockReset();
  postMock.mockImplementation(async () => {
    return ok({
      digest: {
        headline: "Checkout broke after 2.3.2, and the cart bug is back.",
        items: [
          {
            telemetryExceptionId: NEW_ID,
            kind: ExceptionDigestKind.New,
            exceptionType: "TypeError",
            summary: "Empty carts crash checkout.",
            priority: ExceptionDigestPriority.Low,
          },
          {
            telemetryExceptionId: REGRESSED_ID,
            kind: ExceptionDigestKind.Regressed,
            exceptionType: "PaymentError",
            summary: "The <b>payment</b> bug is back.",
            priority: ExceptionDigestPriority.High,
          },
        ],
      },
      exceptionCount: 2,
      generatedAt: "2026-10-30T12:00:00.000Z",
      windowHours: 24,
    });
  });
});

afterEach(() => {
  cleanup();
});

describe("ExceptionAIDigest", () => {
  test("offers to sum up the last day's new and regressed exceptions", () => {
    renderDigest();

    expect(screen.getByTestId("exception-ai-digest")).toHaveTextContent(
      "What's new",
    );
    expect(
      screen.getByTestId("exception-ai-digest-summarize"),
    ).toHaveTextContent("Summarize with OneUptime AI");
    expect(postMock).not.toHaveBeenCalled();
  });

  test("one click asks for the digest and lists them, the most urgent first, each a link", async () => {
    renderDigest();
    await summarize();

    expect(postMock.mock.calls[0]?.[0].url.toString()).toContain(DIGEST_ROUTE);

    await screen.findByTestId("exception-ai-digest-headline");
    expect(
      screen.getByTestId("exception-ai-digest-headline"),
    ).toHaveTextContent(
      "Checkout broke after 2.3.2, and the cart bug is back.",
    );

    const items: Array<HTMLElement> = screen.getAllByTestId(
      "exception-ai-digest-item",
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Regressed");
    expect(items[0]).toHaveTextContent("PaymentError");
    expect(items[1]).toHaveTextContent("New");
    expect(items[0]?.getAttribute("href")).toBe(
      getExceptionRoute(REGRESSED_ID).toString(),
    );

    // The model's words are text: nothing in them is markup.
    expect(items[0]).toHaveTextContent("The <b>payment</b> bug is back.");
    expect(items[0]?.querySelector("b")).toBeNull();

    expect(
      screen.getByTestId("exception-ai-digest-summarize"),
    ).toHaveTextContent("Summarize again");
  });

  test("with nothing new it says so", async () => {
    postMock.mockImplementation(async () => {
      return ok({
        digest: null,
        exceptionCount: 0,
        generatedAt: "2026-10-30T12:00:00.000Z",
        windowHours: 24,
      });
    });

    renderDigest();
    await summarize();

    expect(
      await screen.findByTestId("exception-ai-digest-nothing-new"),
    ).toHaveTextContent(
      "No exceptions were first seen or came back in the last 24 hours.",
    );
    expect(screen.queryByTestId("exception-ai-digest-item")).toBeNull();
  });

  test("a failure shows inline, and the button stays to try again", async () => {
    postMock.mockImplementation(async () => {
      return new HTTPErrorResponse(
        400,
        { message: "AI is turned off for this project." },
        {},
      );
    });

    renderDigest();
    await summarize();

    expect(
      await screen.findByTestId("exception-ai-digest-error"),
    ).toHaveTextContent("AI is turned off for this project.");
    expect(
      screen.getByTestId("exception-ai-digest-summarize"),
    ).not.toBeDisabled();
  });

  test("an answer with exceptions but no digest is an error", async () => {
    postMock.mockImplementation(async () => {
      return ok({ digest: { items: [] }, exceptionCount: 3 });
    });

    renderDigest();
    await summarize();

    expect(
      await screen.findByTestId("exception-ai-digest-error"),
    ).toHaveTextContent(
      "OneUptime AI did not return a summary. Please try again.",
    );
  });

  test("hidden while the project's AI is off", () => {
    aiOffered = false;
    renderDigest();

    expect(screen.queryByTestId("exception-ai-digest")).toBeNull();
  });
});
