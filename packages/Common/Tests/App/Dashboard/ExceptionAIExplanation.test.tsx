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
import * as React from "react";
import ExceptionAIExplanation, {
  EXPLAIN_ROUTE_PREFIX,
  formatSuspectFrame,
  getFollowUpPrompt,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionAIExplanation";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  ExceptionAIExplanation as ExplanationValue,
  ExceptionExplanationCategory,
  ExceptionExplanationConfidence,
} from "../../../Types/Telemetry/ExceptionAIExplanation";

/*
 * The Overview's What happened card: OneUptime AI's explanation of the
 * exception, asked for with one click and kept for the next reader. From it,
 * a fix pull request is one click away (the AI Assistance page), and so is a
 * follow-up question in Ask AI. Hidden while the project's AI is off, and its
 * Markdown shown in safe mode.
 */

interface RequestArgs {
  url: { toString: () => string };
  data: JSONObject;
}

let aiOffered: boolean = true;
const postMock: jest.Mock<(args: RequestArgs) => Promise<unknown>> = jest.fn();
const navigateMock: jest.Mock<(route: Route) => void> = jest.fn();
const openAskAiMock: jest.Mock<(request: { prompt?: string }) => void> =
  jest.fn();
const markdownProps: Array<{ text: string; safeMode?: boolean }> = [];

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

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (route: Route): void => {
        navigateMock(route);
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiEvents",
  () => {
    return {
      openAskAi: (request: { prompt?: string }): void => {
        openAskAiMock(request);
      },
    };
  },
);

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string; safeMode?: boolean }) => {
      markdownProps.push(props);
      return React.createElement(
        "div",
        { "data-testid": "markdown", "data-safe-mode": String(props.safeMode) },
        props.text,
      );
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

const EXCEPTION_ID: ObjectID = new ObjectID(
  "50000000-0000-4000-8000-0000000000aa",
);

const EXPLANATION: ExplanationValue = {
  version: 1,
  summary: "Checkout fails when the cart is empty.",
  rootCause: "`cart.items` is undefined after the 2.3.2 deploy.",
  suggestedFix: "Return early when the cart has no items.",
  confidence: ExceptionExplanationConfidence.High,
  category: ExceptionExplanationCategory.Code,
  suspectFrames: [{ file: "src/cart.ts", line: 42, function: "checkout" }],
  nextSteps: ["Add a test for an empty cart."],
};

function answer(explanation: unknown): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    {
      explanation: explanation as JSONObject,
      generatedAt: new Date().toISOString(),
    },
    {},
  );
}

beforeEach(() => {
  aiOffered = true;
  postMock.mockReset();
  navigateMock.mockReset();
  openAskAiMock.mockReset();
  markdownProps.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("the What happened card", () => {
  test("asks OneUptime AI with one click, and shows what it said", async () => {
    postMock.mockResolvedValue(answer(EXPLANATION));

    render(<ExceptionAIExplanation telemetryExceptionId={EXCEPTION_ID} />);

    expect(
      screen.getByTestId("exception-ai-explanation-empty"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("exception-ai-explain"));

    await waitFor(() => {
      expect(
        screen.getByTestId("exception-ai-explanation-summary"),
      ).toHaveTextContent("Checkout fails when the cart is empty.");
    });

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock.mock.calls[0]![0].url.toString()).toContain(
      `${EXPLAIN_ROUTE_PREFIX}/${EXCEPTION_ID.toString()}`,
    );
    expect(
      screen.getByTestId("exception-ai-explanation-confidence"),
    ).toHaveTextContent("High confidence");
    expect(
      screen.getByTestId("exception-ai-explanation-category"),
    ).toHaveTextContent("In the code");
    expect(
      screen.getByTestId("exception-ai-explanation-root-cause"),
    ).toHaveTextContent("`cart.items` is undefined after the 2.3.2 deploy.");
    expect(screen.getByTestId("exception-ai-explanation-fix")).toHaveTextContent(
      "Return early when the cart has no items.",
    );
    expect(
      screen.getByTestId("exception-ai-explanation-frames"),
    ).toHaveTextContent("src/cart.ts:42 in checkout");
    expect(
      screen.getByTestId("exception-ai-explanation-next-steps"),
    ).toHaveTextContent("Add a test for an empty cart.");
  });

  test("shows a kept explanation at once, and asks again only when told to", async () => {
    postMock.mockResolvedValue(
      answer({ ...EXPLANATION, summary: "A fresher answer." }),
    );

    render(
      <ExceptionAIExplanation
        telemetryExceptionId={EXCEPTION_ID}
        aiExplanation={EXPLANATION}
        aiExplanationGeneratedAt={new Date(Date.now() - 60 * 60 * 1000)}
      />,
    );

    expect(
      screen.getByTestId("exception-ai-explanation-summary"),
    ).toHaveTextContent("Checkout fails when the cart is empty.");
    expect(screen.getByText(/^Written by OneUptime AI .+\.$/)).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("exception-ai-explanation-regenerate"));

    await waitFor(() => {
      expect(
        screen.getByTestId("exception-ai-explanation-summary"),
      ).toHaveTextContent("A fresher answer.");
    });
  });

  test("its Markdown is shown in safe mode", () => {
    render(
      <ExceptionAIExplanation
        telemetryExceptionId={EXCEPTION_ID}
        aiExplanation={EXPLANATION}
      />,
    );

    expect(markdownProps.length).toBeGreaterThanOrEqual(2);
    for (const props of markdownProps) {
      expect(props.safeMode).toBe(true);
    }
  });

  test("Open a fix pull request goes to the exception's AI Assistance page", () => {
    render(
      <ExceptionAIExplanation
        telemetryExceptionId={EXCEPTION_ID}
        aiExplanation={EXPLANATION}
      />,
    );

    fireEvent.click(screen.getByTestId("exception-ai-explanation-fix-pr"));

    expect(navigateMock).toHaveBeenCalledTimes(1);
    const route: string = navigateMock.mock.calls[0]![0].toString();
    expect(route).toContain(EXCEPTION_ID.toString());
    expect(route).toContain("ai-assistance");
  });

  test("Ask a follow-up opens Ask AI on this exception", () => {
    render(
      <ExceptionAIExplanation
        telemetryExceptionId={EXCEPTION_ID}
        aiExplanation={EXPLANATION}
      />,
    );

    fireEvent.click(screen.getByTestId("exception-ai-explanation-ask"));

    expect(openAskAiMock).toHaveBeenCalledWith({
      prompt: getFollowUpPrompt(EXPLANATION),
    });
    expect(getFollowUpPrompt(EXPLANATION)).toContain(EXPLANATION.summary);
  });

  test("a refusal is shown in the server's words, and the button stays", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        { message: "AI is turned off for this project." },
        {},
      ),
    );

    render(<ExceptionAIExplanation telemetryExceptionId={EXCEPTION_ID} />);
    fireEvent.click(screen.getByTestId("exception-ai-explain"));

    await waitFor(() => {
      expect(
        screen.getByTestId("exception-ai-explanation-error"),
      ).toHaveTextContent("AI is turned off for this project.");
    });
    expect(screen.getByTestId("exception-ai-explain")).toBeInTheDocument();
  });

  test("an answer with no explanation in it says so", async () => {
    postMock.mockResolvedValue(answer({ rootCause: "no summary" }));

    render(<ExceptionAIExplanation telemetryExceptionId={EXCEPTION_ID} />);
    fireEvent.click(screen.getByTestId("exception-ai-explain"));

    await waitFor(() => {
      expect(
        screen.getByTestId("exception-ai-explanation-error"),
      ).toHaveTextContent(
        "OneUptime AI did not return an explanation. Please try again.",
      );
    });
  });

  test("a stored value that is not an explanation shows the button", () => {
    render(
      <ExceptionAIExplanation
        telemetryExceptionId={EXCEPTION_ID}
        aiExplanation={{ something: "else" }}
      />,
    );

    expect(screen.getByTestId("exception-ai-explain")).toBeInTheDocument();
  });

  test("nothing at all while the project's AI is off", () => {
    aiOffered = false;

    const { container } = render(
      <ExceptionAIExplanation
        telemetryExceptionId={EXCEPTION_ID}
        aiExplanation={EXPLANATION}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test("a frame reads as the stack trace names it", () => {
    expect(
      formatSuspectFrame({ file: "src/a.ts", line: 3, function: "run" }),
    ).toBe("src/a.ts:3 in run");
    expect(formatSuspectFrame({ file: "src/a.ts" })).toBe("src/a.ts");
  });
});
