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
import {
  LLM_PROVIDER_TEST_CHECKS,
  LLM_PROVIDER_TEST_SENDING,
} from "../../../UI/Utils/LlmProviderTestCopy";
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
 * provider...". Now: while the test runs, what is happening and what it
 * checks (and every way out of a dialog closes it); after it, one alert with
 * a headline - passed, passed with a warning, failed - and the server's
 * verdict, which ends with what to do: nothing of the dialog's own under it,
 * so a provider that was only busy is never sent off to change its settings.
 * And Test again.
 */

const PROVIDER_ID: string = "33333333-3333-4333-8333-333333333333";

const PROJECT_HEADERS: Record<string, string> = {
  tenantid: "11111111-1111-4111-8111-111111111111",
};

const PASSED: string =
  "Connection successful. The LLM provider responded to a test prompt and used tool calling.";

const TOOLS_UNVERIFIED: string =
  "Connection successful, but tool calling could not be verified — the model answered in prose instead of calling the tool it was offered. OneUptime's AI features (Ask AI, investigations) read your data through tools, so a provider that cannot call them will answer that it has no tool for the question. Check that this model and endpoint support tool/function calling.";

// What to check, then - on a line of its own - the provider's words.
const BAD_KEY_LEAD: string =
  "OpenAI did not accept the API key (HTTP 401). Check the provider's API Key.";
const BAD_KEY_ANSWER: string =
  "OpenAI answered: Incorrect API key provided: sk-proj-****-key.";
const BAD_KEY: string = `${BAD_KEY_LEAD}\n${BAD_KEY_ANSWER}`;

// A provider that was only busy: its own advice is to wait, not to edit.
const PROVIDER_DOWN: string =
  "OpenAI could not answer the request (HTTP 503). Test again in a few minutes.\nOpenAI answered: The server is overloaded.";

const CUSTOMER_REFUSAL: string =
  "You do not have permissions to select on - isGlobalLlm. No permission allows it: the column is not readable through the API.";

const REFUSAL: string =
  "You do not have permission to test this LLM provider. You need one of these permissions: Project Owner, Project Admin, Project Member, Settings Admin, Settings Member, Edit LLM.";

// The statuses the server refuses with: NotAuthorized and PaymentRequired.
const NOT_AUTHORIZED: number = ExceptionCode.NotAuthorizedException;
const PAYMENT_REQUIRED: number = ExceptionCode.PaymentRequiredException;

// What the dialog said under the verdict before this review, and no more.
const RETIRED_NEXT_STEP: string =
  "Change the provider's settings, then test again.";

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

function renderModal(props: { headers?: Record<string, string> } = {}): void {
  render(
    <TestLlmProviderModal
      llmProviderId={PROVIDER_ID}
      headers={props.headers ?? PROJECT_HEADERS}
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

function result(): HTMLElement {
  return within(modal()).getByTestId("llm-provider-test-result");
}

// The footer's buttons, left to right, by what they say.
function footerButtons(): Array<string> {
  return within(screen.getByTestId("modal-footer"))
    .getAllByRole("button")
    .map((button: HTMLElement) => {
      return button.textContent?.trim() || "";
    });
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
  test("it says what is happening and what it checks, offers no Test again yet, and Close still closes", async () => {
    const held: ReturnType<typeof heldRequest> = heldRequest();

    renderModal();

    expect(outcome()).toBe(LlmProviderTestOutcome.Testing);
    expect(within(modal()).getByText("Test LLM Provider")).toBeInTheDocument();
    expect(
      within(modal()).getByText(LLM_PROVIDER_TEST_SENDING),
    ).toBeInTheDocument();
    expect(
      within(modal()).getByText(LLM_PROVIDER_TEST_CHECKS),
    ).toBeInTheDocument();
    expect(within(modal()).getByRole("status")).toBeInTheDocument();
    // Nothing to run again yet: not a disabled button that looks pressable.
    expect(within(modal()).queryByTestId("llm-provider-test-again")).toBeNull();
    expect(footerButtons()).toEqual(["Close"]);
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

  test("the words it says meanwhile: one line of what happens, one of what it checks", () => {
    expect(LLM_PROVIDER_TEST_SENDING).toBe(
      "Sending a test prompt to your LLM provider…",
    );
    expect(LLM_PROVIDER_TEST_CHECKS).toBe(
      "This checks its API key, model and Base URL, and whether its model can call tools.",
    );
  });

  test("neither line leaves a word alone on its last line, in a language that runs long", () => {
    heldRequest();

    renderModal();

    /*
     * The headline line is balanced: at phone width in Japanese it ended
     * on a lone "す…". The sentence under it wraps as a paragraph does, but
     * never ends on a single word: balanced, it broke "Base URL" in two.
     */
    expect(within(modal()).getByText(LLM_PROVIDER_TEST_SENDING)).toHaveClass(
      "text-balance",
    );
    expect(within(modal()).getByText(LLM_PROVIDER_TEST_CHECKS)).toHaveClass(
      "text-pretty",
    );
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
});

describe("every way out of the dialog closes it, while it runs and after", () => {
  test("Escape closes it while the test runs", () => {
    heldRequest();

    renderModal();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("the header's X closes it once there is a verdict", async () => {
    fetchMock.mockResolvedValue(failure(400, BAD_KEY) as never);

    renderModal();

    await settled(LlmProviderTestOutcome.Failed);

    fireEvent.click(within(modal()).getByTestId("close-button"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("Escape closes it once there is a verdict", async () => {
    renderModal();

    await settled(LlmProviderTestOutcome.Passed);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("a press on the dark backdrop around it closes it", async () => {
    renderModal();

    await settled(LlmProviderTestOutcome.Passed);

    /*
     * The layer the panel is centred in: the press and the release both
     * land on it, outside the panel.
     */
    const backdrop: HTMLElement = modal().parentElement!.parentElement!;
    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("Close starts with the focus, so Enter closes the dialog", async () => {
    renderModal();

    await settled(LlmProviderTestOutcome.Passed);

    expect(closeButton()).toHaveFocus();
  });
});

describe("after the test", () => {
  test("passed: a success alert, headed Test passed, with the server's verdict", async () => {
    renderModal();

    await settled(LlmProviderTestOutcome.Passed);

    expect(result()).toHaveTextContent("Test passed");
    expect(result()).toHaveTextContent(PASSED);
    expect(result().className).toContain("bg-emerald-50");
    expect(within(modal()).queryByText(LLM_PROVIDER_TEST_SENDING)).toBeNull();
    expect(testAgainButton()).toBeEnabled();
  });

  test("the footer: Test again, then Close - which keeps its place, rightmost, from the start", async () => {
    const held: ReturnType<typeof heldRequest> = heldRequest();

    renderModal();

    expect(footerButtons()).toEqual(["Close"]);

    await act(async () => {
      held.answer(
        verdict({ success: true, supportsToolCalling: true, message: PASSED }),
      );
    });
    await settled(LlmProviderTestOutcome.Passed);

    /*
     * Test again arrives beside Close, never in its place: a person about
     * to press Close as the verdict lands still presses Close.
     */
    expect(footerButtons()).toEqual(["Test again", "Close"]);
    // No Cancel beside Close: the one way out in the footer is Close.
    expect(
      within(modal()).queryByTestId("modal-footer-close-button"),
    ).toBeNull();
  });

  test("neither button shouts: Close only closes, and Test again is rarely needed", async () => {
    renderModal();

    await settled(LlmProviderTestOutcome.Passed);

    for (const button of [closeButton(), testAgainButton()]) {
      expect(button.className).toContain("bg-white");
      expect(button.className).not.toContain("bg-indigo-600");
    }
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

    expect(result()).toHaveTextContent("Test passed, with a warning");
    expect(result()).toHaveTextContent(TOOLS_UNVERIFIED);
    expect(result().className).toContain("bg-amber-50");
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

  test("failed: a danger alert, headed Test failed, with what to check and then the provider's words on a line of their own", async () => {
    fetchMock.mockResolvedValue(failure(400, BAD_KEY) as never);

    renderModal();

    await settled(LlmProviderTestOutcome.Failed);

    expect(result()).toHaveTextContent("Test failed");
    expect(result().className).toContain("bg-red-50");

    // The break the server put between the two is kept, and drawn.
    const text: HTMLElement = result().querySelector(".alert-text")!;
    expect(text).toHaveClass("whitespace-pre-wrap");
    expect(text.textContent).toContain(`${BAD_KEY_LEAD}\n${BAD_KEY_ANSWER}`);

    // A failed test is the dialog's answer, not an error of the dialog.
    expect(within(modal()).queryByTestId("modal-error")).toBeNull();
  });

  test.each([
    ["a provider that refused the key (HTTP 400)", 400, BAD_KEY],
    ["a provider that was only busy (HTTP 400)", 400, PROVIDER_DOWN],
    ["a refusal of the test (HTTP 422)", NOT_AUTHORIZED, REFUSAL],
    [
      "a project below the plan that sells providers (HTTP 402)",
      PAYMENT_REQUIRED,
      "Please upgrade your plan to Growth to access this feature",
    ],
    ["a server error (HTTP 500)", 500, "Server Error"],
    ["a gateway that gave up waiting (HTTP 504)", 504, "Gateway Timeout"],
  ])(
    "%s: the server's words are the whole answer - no line of the dialog's own under them",
    async (_case: string, status: number, message: string) => {
      fetchMock.mockResolvedValue(failure(status, message) as never);

      renderModal();

      await settled(LlmProviderTestOutcome.Failed);

      expect(result()).toHaveTextContent("Test failed");
      expect(result().querySelector(".alert-text")!.textContent).toContain(
        message,
      );

      /*
       * Everything the dialog's body says is the alert: "Change the
       * provider's settings" under a provider that was busy, or under a
       * refusal, sent people off to fix what was not broken.
       */
      const body: HTMLElement = screen.getByTestId("llm-provider-test");
      expect(body.textContent).toBe(result().textContent);
      expect(within(modal()).queryByText(RETIRED_NEXT_STEP)).toBeNull();
      expect(testAgainButton()).toBeEnabled();
    },
  );

  test("a request that never reached the server: a failure, in the client's words", async () => {
    fetchMock.mockRejectedValue(new Error("Network Error") as never);

    renderModal();

    await settled(LlmProviderTestOutcome.Failed);

    expect(result()).toHaveTextContent("Network Error");
    expect(screen.getByTestId("llm-provider-test").textContent).toBe(
      result().textContent,
    );
  });

  test("an older server's refusal - the customer's - is shown whole, never as if the test were still running", async () => {
    fetchMock.mockResolvedValue(
      failure(NOT_AUTHORIZED, CUSTOMER_REFUSAL) as never,
    );

    renderModal();

    await settled(LlmProviderTestOutcome.Failed);

    expect(result()).toHaveTextContent(CUSTOMER_REFUSAL);
    expect(within(modal()).queryByText(LLM_PROVIDER_TEST_SENDING)).toBeNull();
    expect(within(modal()).queryByText(LLM_PROVIDER_TEST_CHECKS)).toBeNull();
  });

  test("Test again runs it again, says so meanwhile, and shows the new verdict", async () => {
    fetchMock.mockResolvedValueOnce(failure(400, BAD_KEY) as never);

    renderModal();

    await settled(LlmProviderTestOutcome.Failed);

    const held: ReturnType<typeof heldRequest> = heldRequest();

    fireEvent.click(testAgainButton());

    expect(outcome()).toBe(LlmProviderTestOutcome.Testing);
    expect(
      within(modal()).getByText(LLM_PROVIDER_TEST_SENDING),
    ).toBeInTheDocument();
    expect(
      within(modal()).queryByTestId("llm-provider-test-result"),
    ).toBeNull();
    expect(within(modal()).queryByTestId("llm-provider-test-again")).toBeNull();
    expect(footerButtons()).toEqual(["Close"]);

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
