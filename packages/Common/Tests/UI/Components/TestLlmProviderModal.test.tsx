import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import TestLlmProviderModal, {
  getLlmProviderTestOutcome,
  LlmProviderTestOutcome,
} from "../../../UI/Components/AI/TestLlmProviderModal";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../UI/Utils/API/API";
import { LLM_PROVIDER_TEST_FAILED_NEXT_STEP } from "../../../UI/Utils/LlmProviderTestCopy";
import {
  DASHBOARD_TEST_ROUTE,
  dashboardTestBody,
} from "../../Helpers/LlmProviderTestRequest";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * TEST LLM PROVIDER, the dialog: what a person sees while their provider is
 * tested and after - and what it sends.
 *
 * The customer's dialog said "You do not have permissions to select on -
 * isGlobalLlm. You need any one of these permissions:" in a red banner, and
 * under it, as if still at work, "Testing the connection to your LLM
 * provider...". Now: while the test runs, what is happening (and Close
 * works); after it, one alert with a headline - passed, passed with a
 * warning, failed - and the server's verdict, the next step under a
 * provider's failure (not under a refusal: changing the provider would not
 * help), and Test again.
 */

const PROVIDER_ID: string = "33333333-3333-4333-8333-333333333333";

const PROJECT_HEADERS: Record<string, string> = {
  tenantid: "11111111-1111-4111-8111-111111111111",
};

const PASSED: string =
  "Connection successful. The LLM provider responded to a test prompt and used tool calling.";

const TOOLS_UNVERIFIED: string =
  "Connection successful, but tool calling could not be verified — the model answered in prose instead of calling the tool it was offered. OneUptime's AI features (Ask AI, investigations) read your data through tools, so a provider that cannot call them will answer that it has no tool for the question. Check that this model and endpoint support tool/function calling.";

const BAD_KEY: string =
  "OpenAI did not accept the API key (HTTP 401). Check the provider's API Key. OpenAI answered: Incorrect API key provided: sk-proj-****-key.";

const CUSTOMER_REFUSAL: string =
  "You do not have permissions to select on - isGlobalLlm. No permission allows it: the column is not readable through the API.";

const REFUSAL: string =
  "You do not have permission to test this LLM provider. You need one of these permissions: Project Owner, Project Admin, Project Member, Settings Admin, Settings Member, Edit LLM.";

// The statuses the server refuses with: NotAuthorized and PaymentRequired.
const NOT_AUTHORIZED: number = ExceptionCode.NotAuthorizedException;
const PAYMENT_REQUIRED: number = ExceptionCode.PaymentRequiredException;

const TESTING: string = "Sending a test prompt to your LLM provider…";

let fetchMock: MockFunction;
let onClose: MockFunction;

function verdict(data: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, data, {});
}

function failure(status: number, message: string): HTTPErrorResponse {
  return new HTTPErrorResponse(status, { message }, {});
}

// A request the test holds open until `answer` is called.
function heldRequest(): {
  answer: (response: HTTPResponse<JSONObject> | HTTPErrorResponse) => void;
} {
  let release: (response: unknown) => void = (): void => {};

  fetchMock.mockImplementationOnce((): Promise<unknown> => {
    return new Promise((resolve: (value: unknown) => void) => {
      release = resolve;
    });
  });

  return {
    answer: (response: HTTPResponse<JSONObject> | HTTPErrorResponse) => {
      release(response);
    },
  };
}

function renderModal(
  props: { testingDescription?: string; headers?: Record<string, string> } = {},
): void {
  render(
    <TestLlmProviderModal
      llmProviderId={PROVIDER_ID}
      headers={props.headers ?? PROJECT_HEADERS}
      testingDescription={props.testingDescription}
      onClose={onClose as unknown as () => void}
    />,
  );
}

function modal(): HTMLElement {
  return screen.getByTestId("modal");
}

function outcome(): string | null {
  return screen.getByTestId("llm-provider-test").getAttribute("data-outcome");
}

async function settled(expected: LlmProviderTestOutcome): Promise<void> {
  await waitFor(() => {
    expect(outcome()).toBe(expected);
  });
}

function testAgainButton(): HTMLElement {
  return within(modal()).getByTestId("llm-provider-test-again");
}

function closeButton(): HTMLElement {
  return within(modal()).getByTestId("modal-footer-submit-button");
}

beforeEach(() => {
  fetchMock = getJestMockFunction();
  fetchMock.mockResolvedValue(
    verdict({
      success: true,
      supportsToolCalling: true,
      message: PASSED,
    }) as never,
  );
  onClose = getJestMockFunction();

  jest
    .spyOn(API, "fetch")
    .mockImplementation(fetchMock as unknown as typeof API.fetch);
  jest.spyOn(API, "getFriendlyMessage").mockImplementation((err: unknown) => {
    return err instanceof HTTPErrorResponse ? err.message : String(err);
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("what Test sends", () => {
  test("one POST to the test route, the Dashboard's body, with the project's headers", async () => {
    renderModal();

    await settled(LlmProviderTestOutcome.Passed);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const request: {
      method: HTTPMethod;
      url: { toString: () => string };
      data: JSONObject;
      headers: Record<string, string>;
    } = fetchMock.mock.calls[0]![0] as never;

    expect(request.method).toBe(HTTPMethod.POST);
    expect(
      new URL(request.url.toString()).pathname.endsWith(DASHBOARD_TEST_ROUTE),
    ).toBe(true);
    expect(request.data).toEqual(dashboardTestBody(PROVIDER_ID));
    expect(request.headers).toEqual(PROJECT_HEADERS);
  });

  test("from the Admin Dashboard, no project header at all", async () => {
    renderModal({ headers: {} });

    await settled(LlmProviderTestOutcome.Passed);

    const request: { headers?: Record<string, string> } = fetchMock.mock
      .calls[0]![0] as never;
    expect(request.headers?.["tenantid"]).toBeUndefined();
  });
});

describe("while the test runs", () => {
  test("it says what is happening, offers no Test again yet, and Close still closes", async () => {
    const held: ReturnType<typeof heldRequest> = heldRequest();

    renderModal();

    expect(outcome()).toBe(LlmProviderTestOutcome.Testing);
    expect(within(modal()).getByText("Test LLM Provider")).toBeInTheDocument();
    expect(within(modal()).getByText(TESTING)).toBeInTheDocument();
    expect(
      within(modal()).getByText(
        "Testing the connection to your LLM provider. This sends a small prompt using your configured API key, model, and base URL.",
      ),
    ).toBeInTheDocument();
    expect(within(modal()).getByRole("status")).toBeInTheDocument();
    // Nothing to run again yet: not a disabled button that looks pressable.
    expect(within(modal()).queryByTestId("llm-provider-test-again")).toBeNull();
    expect(closeButton()).toBeEnabled();
    expect(
      within(modal()).queryByTestId("llm-provider-test-result"),
    ).toBeNull();

    // A provider that never answers can take minutes: the dialog closes at once.
    fireEvent.click(closeButton());
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      held.answer(
        verdict({ success: true, supportsToolCalling: true, message: PASSED }),
      );
    });
  });

  test("a verdict that arrives after the dialog closed is dropped", async () => {
    const held: ReturnType<typeof heldRequest> = heldRequest();
    const consoleError: MockFunction = jest
      .spyOn(console, "error")
      .mockImplementation(() => {}) as unknown as MockFunction;

    renderModal();
    cleanup();

    await act(async () => {
      held.answer(failure(400, BAD_KEY));
    });

    // Nothing was drawn for it, and React had nothing to warn about.
    expect(screen.queryByTestId("llm-provider-test-result")).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });

  test("the Admin Dashboard's words for a global provider, when given", async () => {
    heldRequest();

    renderModal({
      headers: {},
      testingDescription:
        "Testing the connection to this global LLM provider. This sends a small prompt using its configured API key, model, and base URL.",
    });

    expect(
      within(modal()).getByText(
        "Testing the connection to this global LLM provider. This sends a small prompt using its configured API key, model, and base URL.",
      ),
    ).toBeInTheDocument();
  });
});

describe("after the test", () => {
  test("passed: a success alert, headed Test passed, with the server's verdict", async () => {
    renderModal();

    await settled(LlmProviderTestOutcome.Passed);

    const result: HTMLElement = within(modal()).getByTestId(
      "llm-provider-test-result",
    );
    expect(result).toHaveTextContent("Test passed");
    expect(result).toHaveTextContent(PASSED);
    expect(result.className).toContain("bg-emerald-50");
    expect(within(modal()).queryByText(TESTING)).toBeNull();
    expect(
      within(modal()).queryByTestId("llm-provider-test-next-step"),
    ).toBeNull();
    expect(testAgainButton()).toBeEnabled();
  });

  test("tool calling not seen: a warning, headed Test passed, with a warning", async () => {
    fetchMock.mockResolvedValue(
      verdict({
        success: true,
        supportsToolCalling: false,
        message: TOOLS_UNVERIFIED,
      }) as never,
    );

    renderModal();

    await settled(LlmProviderTestOutcome.Warning);

    const result: HTMLElement = within(modal()).getByTestId(
      "llm-provider-test-result",
    );
    expect(result).toHaveTextContent("Test passed, with a warning");
    expect(result).toHaveTextContent(TOOLS_UNVERIFIED);
    expect(result.className).toContain("bg-amber-50");
  });

  test("an older server that does not say whether tools were called: a pass", async () => {
    fetchMock.mockResolvedValue(
      verdict({
        success: true,
        message:
          "Connection successful. The LLM provider responded to a test prompt.",
      }) as never,
    );

    renderModal();

    await settled(LlmProviderTestOutcome.Passed);
  });

  test("failed: a danger alert, headed Test failed, with what to check and the provider's words, then the next step", async () => {
    fetchMock.mockResolvedValue(failure(400, BAD_KEY) as never);

    renderModal();

    await settled(LlmProviderTestOutcome.Failed);

    const result: HTMLElement = within(modal()).getByTestId(
      "llm-provider-test-result",
    );
    expect(result).toHaveTextContent("Test failed");
    expect(result).toHaveTextContent(BAD_KEY);
    expect(result.className).toContain("bg-red-50");
    expect(
      within(modal()).getByTestId("llm-provider-test-next-step"),
    ).toHaveTextContent(LLM_PROVIDER_TEST_FAILED_NEXT_STEP);
    expect(LLM_PROVIDER_TEST_FAILED_NEXT_STEP).toBe(
      "Change the provider's settings, then test again.",
    );
    // A failed test is the dialog's answer, not an error of the dialog.
    expect(within(modal()).queryByTestId("modal-error")).toBeNull();
  });

  test("a refusal reads as a failure, in the server's words, with no next step: changing the provider would not help", async () => {
    fetchMock.mockResolvedValue(failure(NOT_AUTHORIZED, REFUSAL) as never);

    renderModal();

    await settled(LlmProviderTestOutcome.Failed);

    const result: HTMLElement = within(modal()).getByTestId(
      "llm-provider-test-result",
    );
    expect(result).toHaveTextContent("Test failed");
    expect(result).toHaveTextContent(REFUSAL);
    expect(
      within(modal()).queryByTestId("llm-provider-test-next-step"),
    ).toBeNull();
    expect(testAgainButton()).toBeEnabled();
  });

  test.each([
    [
      "below the plan that sells providers",
      PAYMENT_REQUIRED,
      "Please upgrade your plan to Growth to access this feature",
    ],
    ["a server error", 500, "Server Error"],
    ["a gateway that gave up waiting", 504, "Gateway Timeout"],
  ])(
    "%s (HTTP %s): the server's words, and no next step",
    async (_case: string, status: number, message: string) => {
      fetchMock.mockResolvedValue(failure(status, message) as never);

      renderModal();

      await settled(LlmProviderTestOutcome.Failed);

      expect(
        within(modal()).getByTestId("llm-provider-test-result"),
      ).toHaveTextContent(message);
      expect(
        within(modal()).queryByTestId("llm-provider-test-next-step"),
      ).toBeNull();
    },
  );

  test("a request that never reached the server: a failure, and no next step", async () => {
    fetchMock.mockRejectedValue(new Error("Network Error") as never);

    renderModal();

    await settled(LlmProviderTestOutcome.Failed);

    expect(
      within(modal()).getByTestId("llm-provider-test-result"),
    ).toHaveTextContent("Network Error");
    expect(
      within(modal()).queryByTestId("llm-provider-test-next-step"),
    ).toBeNull();
  });

  test("the next step follows each run: a refusal after a provider's failure drops it, a provider's failure after a refusal brings it back", async () => {
    fetchMock
      .mockResolvedValueOnce(failure(400, BAD_KEY) as never)
      .mockResolvedValueOnce(failure(NOT_AUTHORIZED, REFUSAL) as never)
      .mockResolvedValueOnce(failure(400, BAD_KEY) as never);

    renderModal();

    await waitFor(() => {
      expect(
        within(modal()).getByTestId("llm-provider-test-next-step"),
      ).toBeInTheDocument();
    });

    fireEvent.click(testAgainButton());

    await waitFor(() => {
      expect(
        within(modal()).getByTestId("llm-provider-test-result"),
      ).toHaveTextContent(REFUSAL);
    });
    expect(
      within(modal()).queryByTestId("llm-provider-test-next-step"),
    ).toBeNull();

    fireEvent.click(testAgainButton());

    await waitFor(() => {
      expect(
        within(modal()).getByTestId("llm-provider-test-result"),
      ).toHaveTextContent(BAD_KEY);
    });
    expect(
      within(modal()).getByTestId("llm-provider-test-next-step"),
    ).toBeInTheDocument();
  });

  test("an older server's refusal - the customer's - is shown whole, never as if the test were still running", async () => {
    fetchMock.mockResolvedValue(
      failure(NOT_AUTHORIZED, CUSTOMER_REFUSAL) as never,
    );

    renderModal();

    await settled(LlmProviderTestOutcome.Failed);

    expect(
      within(modal()).getByTestId("llm-provider-test-result"),
    ).toHaveTextContent(CUSTOMER_REFUSAL);
    expect(
      within(modal()).queryByText(
        "Testing the connection to your LLM provider. This sends a small prompt using your configured API key, model, and base URL.",
      ),
    ).toBeNull();
    expect(
      within(modal()).queryByTestId("llm-provider-test-next-step"),
    ).toBeNull();
  });

  test("Test again runs it again, says so meanwhile, and shows the new verdict", async () => {
    fetchMock.mockResolvedValueOnce(failure(400, BAD_KEY) as never);

    renderModal();

    await settled(LlmProviderTestOutcome.Failed);

    const held: ReturnType<typeof heldRequest> = heldRequest();

    fireEvent.click(testAgainButton());

    expect(outcome()).toBe(LlmProviderTestOutcome.Testing);
    expect(within(modal()).getByText(TESTING)).toBeInTheDocument();
    expect(
      within(modal()).queryByTestId("llm-provider-test-result"),
    ).toBeNull();
    expect(within(modal()).queryByTestId("llm-provider-test-again")).toBeNull();

    await act(async () => {
      held.answer(
        verdict({ success: true, supportsToolCalling: true, message: PASSED }),
      );
    });

    await settled(LlmProviderTestOutcome.Passed);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![0]).toEqual(fetchMock.mock.calls[0]![0]);
  });

  test("Close closes", async () => {
    renderModal();

    await settled(LlmProviderTestOutcome.Passed);

    expect(closeButton()).toHaveTextContent("Close");
    fireEvent.click(closeButton());

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("getLlmProviderTestOutcome", () => {
  test.each([
    [{ success: true, supportsToolCalling: true, message: "" }, "passed"],
    [{ success: true, supportsToolCalling: false, message: "" }, "warning"],
    [{ success: true, message: "" }, "passed"],
    [{ success: false, message: "" }, "failed"],
    [{ success: false, supportsToolCalling: true, message: "" }, "failed"],
  ])("%j is %s", (result: unknown, expected: string) => {
    expect(getLlmProviderTestOutcome(result as never)).toBe(expected);
  });
});
