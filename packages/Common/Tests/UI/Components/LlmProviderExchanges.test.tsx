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
import LlmProviderExchanges, {
  formatExchangeBody,
  formatExchangeHeaders,
  formatExchangesForCopy,
  getExchangeTone,
} from "../../../UI/Components/AI/LlmProviderExchanges";
import TestLlmProviderModal, {
  LlmProviderTestOutcome,
} from "../../../UI/Components/AI/TestLlmProviderModal";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import { LLMProviderExchange } from "../../../Types/LLM/LLMProviderExchange";
import API from "../../../UI/Utils/API/API";
import TestLLMProvider from "../../../UI/Utils/TestLLMProvider";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * REQUEST AND RESPONSE, under Test LLM Provider's verdict (issue #7080).
 *
 * A customer's admins asked to see, when a test fails, the request that was
 * sent, the provider's raw answer and its headers, and the status - without
 * digging through server logs. The dialog now folds them under the verdict:
 * closed at first, so the verdict stays the first thing read; opened, one
 * block per request with its status, timing, URL, headers and bodies, and a
 * Copy all for a support ticket.
 */

const PROVIDER_ID: string = "33333333-3333-4333-8333-333333333333";

const PASSED_EXCHANGE: LLMProviderExchange = {
  method: "POST",
  url: "https://api.openai.com/v1/chat/completions",
  requestHeaders: {
    Authorization: "Bearer sk-p…1234",
    "Content-Type": "application/json",
  },
  requestBody: { model: "gpt-4o", messages: [{ role: "user", content: "OK" }] },
  statusCode: 200,
  responseHeaders: { "content-type": "application/json", "x-request-id": "r1" },
  responseBody: { id: "chatcmpl-1", choices: [] },
  durationMs: 1234,
};

const REFUSED_EXCHANGE: LLMProviderExchange = {
  method: "POST",
  url: "https://api.openai.com/v1/chat/completions",
  requestHeaders: { Authorization: "Bearer sk-p…1234" },
  requestBody: { model: "gpt-4o" },
  statusCode: 401,
  responseHeaders: { "x-request-id": "req_401" },
  responseBody: {
    error: { message: "Incorrect API key provided.", code: "invalid_api_key" },
  },
  durationMs: 87,
};

const UNREACHABLE_EXCHANGE: LLMProviderExchange = {
  method: "POST",
  url: "http://llm.internal:8000/v1/chat/completions",
  requestHeaders: {},
  requestBody: { model: "chat-large" },
  error:
    "OneUptime could not reach the OpenAI-compatible server: connection refused.",
  durationMs: 5,
};

function toggle(): HTMLElement {
  return screen.getByTestId("llm-provider-exchanges-toggle");
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the fold", () => {
  test("shows nothing at all when there are no requests to show", () => {
    render(<LlmProviderExchanges exchanges={[]} />);

    expect(screen.queryByTestId("llm-provider-exchanges")).toBeNull();
  });

  test("starts closed, says which way it is, and opens and closes", () => {
    render(<LlmProviderExchanges exchanges={[PASSED_EXCHANGE]} />);

    expect(toggle()).toHaveTextContent("Show request and response");
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("llm-provider-exchange-list")).toBeNull();

    fireEvent.click(toggle());

    expect(toggle()).toHaveTextContent("Hide request and response");
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(toggle()).toHaveAttribute(
      "aria-controls",
      "llm-provider-exchange-list",
    );
    expect(screen.getByTestId("llm-provider-exchange-list")).toHaveAttribute(
      "id",
      "llm-provider-exchange-list",
    );
    expect(
      screen.getByText(
        "What was sent to your provider and what came back. API keys and cookies are masked.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(toggle());

    expect(toggle()).toHaveTextContent("Show request and response");
    expect(screen.queryByTestId("llm-provider-exchange-list")).toBeNull();
  });

  test("Copy all is offered once it is open", () => {
    render(<LlmProviderExchanges exchanges={[PASSED_EXCHANGE]} />);

    expect(screen.queryByText("Copy all")).toBeNull();
    fireEvent.click(toggle());
    expect(screen.getByText("Copy all")).toBeInTheDocument();
  });
});

describe("one request, opened", () => {
  test("its status, time, method, URL, headers and bodies", () => {
    render(<LlmProviderExchanges exchanges={[PASSED_EXCHANGE]} />);
    fireEvent.click(toggle());

    const block: HTMLElement = screen.getByTestId("llm-provider-exchange");
    expect(block).toHaveAttribute("data-tone", "success");

    expect(
      within(block).getByTestId("llm-provider-exchange-status"),
    ).toHaveTextContent("HTTP 200");
    expect(within(block).getByText("1,234 ms")).toBeInTheDocument();
    expect(within(block).getByText("POST")).toBeInTheDocument();
    expect(
      within(block).getByTestId("llm-provider-exchange-url"),
    ).toHaveTextContent("https://api.openai.com/v1/chat/completions");

    expect(
      within(block).getByTestId("llm-provider-exchange-request-headers"),
    ).toHaveTextContent("Authorization: Bearer sk-p…1234");
    expect(
      within(block).getByTestId("llm-provider-exchange-request-body")
        .textContent,
    ).toBe(JSON.stringify(PASSED_EXCHANGE.requestBody, null, 2));
    expect(
      within(block).getByTestId("llm-provider-exchange-response-headers"),
    ).toHaveTextContent("x-request-id: r1");
    expect(
      within(block).getByTestId("llm-provider-exchange-response-body")
        .textContent,
    ).toBe(JSON.stringify(PASSED_EXCHANGE.responseBody, null, 2));

    // One request: no "Request 1 of 1".
    expect(within(block).queryByText(/Request 1 of/)).toBeNull();
  });

  test("a code block reads left to right on any page, and scrolls rather than cuts", () => {
    render(<LlmProviderExchanges exchanges={[PASSED_EXCHANGE]} />);
    fireEvent.click(toggle());

    const body: HTMLElement = screen.getByTestId(
      "llm-provider-exchange-request-body",
    );
    expect(body).toHaveAttribute("dir", "ltr");
    expect(body.className).toContain("overflow-auto");
  });

  test("a refused request: its status in red, and the provider's error body", () => {
    render(<LlmProviderExchanges exchanges={[REFUSED_EXCHANGE]} />);
    fireEvent.click(toggle());

    const block: HTMLElement = screen.getByTestId("llm-provider-exchange");
    expect(block).toHaveAttribute("data-tone", "danger");
    expect(
      within(block).getByTestId("llm-provider-exchange-status"),
    ).toHaveTextContent("HTTP 401");
    expect(
      within(block).getByTestId("llm-provider-exchange-response-body"),
    ).toHaveTextContent("invalid_api_key");
  });

  test("a request nothing answered: No response, why, and no response sections", () => {
    render(<LlmProviderExchanges exchanges={[UNREACHABLE_EXCHANGE]} />);
    fireEvent.click(toggle());

    const block: HTMLElement = screen.getByTestId("llm-provider-exchange");
    expect(block).toHaveAttribute("data-tone", "danger");
    expect(
      within(block).getByTestId("llm-provider-exchange-status"),
    ).toHaveTextContent("No response");
    expect(
      within(block).getByTestId("llm-provider-exchange-error"),
    ).toHaveTextContent("connection refused");
    expect(
      within(block).queryByTestId("llm-provider-exchange-response-headers"),
    ).toBeNull();
    expect(
      within(block).queryByTestId("llm-provider-exchange-response-body"),
    ).toBeNull();
    // No request headers were sent: no empty block for them.
    expect(
      within(block).queryByTestId("llm-provider-exchange-request-headers"),
    ).toBeNull();
  });
});

describe("several requests", () => {
  test("each is numbered, in the order they were sent", () => {
    render(
      <LlmProviderExchanges exchanges={[REFUSED_EXCHANGE, PASSED_EXCHANGE]} />,
    );
    fireEvent.click(toggle());

    const blocks: Array<HTMLElement> = screen.getAllByTestId(
      "llm-provider-exchange",
    );
    expect(blocks).toHaveLength(2);
    expect(within(blocks[0]!).getByText("Request 1 of 2")).toBeInTheDocument();
    expect(within(blocks[1]!).getByText("Request 2 of 2")).toBeInTheDocument();
    expect(
      within(blocks[0]!).getByTestId("llm-provider-exchange-status"),
    ).toHaveTextContent("HTTP 401");
    expect(
      within(blocks[1]!).getByTestId("llm-provider-exchange-status"),
    ).toHaveTextContent("HTTP 200");
  });
});

describe("the helpers", () => {
  test.each([
    [{ statusCode: 200 }, "success"],
    [{ statusCode: 204 }, "success"],
    [{ statusCode: 429 }, "warning"],
    [{ statusCode: 408 }, "warning"],
    [{ statusCode: 400 }, "danger"],
    [{ statusCode: 401 }, "danger"],
    [{ statusCode: 503 }, "danger"],
    [{ statusCode: 302 }, "danger"],
    [{ error: "refused" }, "danger"],
    [{}, "neutral"],
  ])("%j is %s", (fields: Partial<LLMProviderExchange>, tone: string) => {
    expect(
      getExchangeTone({
        method: "POST",
        url: "https://p.example/",
        requestHeaders: {},
        durationMs: 0,
        ...fields,
      }),
    ).toBe(tone);
  });

  test("formatExchangeBody: JSON indented, text as it came, nothing for nothing", () => {
    expect(formatExchangeBody({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(formatExchangeBody("plain text")).toBe("plain text");
    expect(formatExchangeBody(undefined)).toBe("");
    expect(formatExchangeBody(null)).toBe("");
    expect(formatExchangeBody(0)).toBe("0");
  });

  test("formatExchangeHeaders: one name: value a line", () => {
    expect(formatExchangeHeaders({ a: "1", "b-c": "2" })).toBe("a: 1\nb-c: 2");
    expect(formatExchangeHeaders(undefined)).toBe("");
  });

  test("formatExchangesForCopy: every request and answer as plain text", () => {
    const text: string = formatExchangesForCopy([
      REFUSED_EXCHANGE,
      UNREACHABLE_EXCHANGE,
    ]);

    expect(text).toContain("### Request 1");
    expect(text).toContain(
      "POST https://api.openai.com/v1/chat/completions\nAuthorization: Bearer sk-p…1234",
    );
    expect(text).toContain(
      "### Response 1 (87 ms)\nHTTP 401\nx-request-id: req_401",
    );
    expect(text).toContain('"code": "invalid_api_key"');
    expect(text).toContain("### Request 2");
    expect(text).toContain("### Response 2 (5 ms)\nNo response");
    expect(text).toContain("Error: OneUptime could not reach");
  });
});

describe("in the Test LLM Provider dialog", () => {
  let fetchMock: MockFunction;

  beforeEach(() => {
    fetchMock = getJestMockFunction();
    jest
      .spyOn(API, "fetch")
      .mockImplementation(fetchMock as unknown as typeof API.fetch);
    jest.spyOn(API, "getFriendlyMessage").mockImplementation((err: unknown) => {
      return err instanceof HTTPErrorResponse ? err.message : String(err);
    });
  });

  function renderModal(): void {
    render(
      <TestLlmProviderModal
        llmProviderId={PROVIDER_ID}
        headers={{}}
        onClose={() => {}}
      />,
    );
  }

  async function settled(expected: LlmProviderTestOutcome): Promise<void> {
    await waitFor(() => {
      expect(
        screen.getByTestId("llm-provider-test").getAttribute("data-outcome"),
      ).toBe(expected);
    });
  }

  test("a failed test: the verdict, then the requests folded under it", async () => {
    fetchMock.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        {
          message:
            "OpenAI did not accept the API key (HTTP 401). Check the provider's API Key.",
          exchanges: [
            REFUSED_EXCHANGE,
            REFUSED_EXCHANGE,
          ] as unknown as Array<JSONObject>,
        },
        {},
      ) as never,
    );

    renderModal();
    await settled(LlmProviderTestOutcome.Failed);

    expect(screen.getByTestId("llm-provider-test-result")).toHaveTextContent(
      "OpenAI did not accept the API key",
    );
    expect(toggle()).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle());

    expect(screen.getAllByTestId("llm-provider-exchange")).toHaveLength(2);
    expect(
      screen.getAllByTestId("llm-provider-exchange-status")[0],
    ).toHaveTextContent("HTTP 401");
  });

  test("a passed test: the request and the answer are there too", async () => {
    fetchMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        {
          success: true,
          supportsToolCalling: true,
          message: "Connection successful.",
          exchanges: [PASSED_EXCHANGE] as unknown as Array<JSONObject>,
        },
        {},
      ) as never,
    );

    renderModal();
    await settled(LlmProviderTestOutcome.Passed);

    fireEvent.click(toggle());
    expect(
      screen.getByTestId("llm-provider-exchange-status"),
    ).toHaveTextContent("HTTP 200");
  });

  test("an older server that sends no requests: no fold at all", async () => {
    fetchMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        { success: true, supportsToolCalling: true, message: "OK." },
        {},
      ) as never,
    );

    renderModal();
    await settled(LlmProviderTestOutcome.Passed);

    expect(screen.queryByTestId("llm-provider-exchanges")).toBeNull();
  });

  test("Test again folds it away until the new answer, and shows the new requests", async () => {
    fetchMock.mockResolvedValueOnce(
      new HTTPErrorResponse(
        400,
        {
          message: "Failed.",
          exchanges: [REFUSED_EXCHANGE] as unknown as Array<JSONObject>,
        },
        {},
      ) as never,
    );

    renderModal();
    await settled(LlmProviderTestOutcome.Failed);
    fireEvent.click(toggle());

    fetchMock.mockResolvedValueOnce(
      new HTTPResponse<JSONObject>(
        200,
        {
          success: true,
          supportsToolCalling: true,
          message: "Connection successful.",
          exchanges: [PASSED_EXCHANGE] as unknown as Array<JSONObject>,
        },
        {},
      ) as never,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("llm-provider-test-again"));
    });
    await settled(LlmProviderTestOutcome.Passed);

    // A new verdict starts folded: the verdict is read first.
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle());
    expect(
      screen.getByTestId("llm-provider-exchange-status"),
    ).toHaveTextContent("HTTP 200");
  });
});

describe("TestLLMProvider.test reads the requests off either answer", () => {
  let fetchMock: MockFunction;

  beforeEach(() => {
    fetchMock = getJestMockFunction();
    jest
      .spyOn(API, "fetch")
      .mockImplementation(fetchMock as unknown as typeof API.fetch);
    jest.spyOn(API, "getFriendlyMessage").mockImplementation((err: unknown) => {
      return err instanceof HTTPErrorResponse ? err.message : String(err);
    });
  });

  test("a failure", async () => {
    fetchMock.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        {
          message: "Failed.",
          exchanges: [REFUSED_EXCHANGE] as unknown as Array<JSONObject>,
        },
        {},
      ) as never,
    );

    const result: Awaited<ReturnType<typeof TestLLMProvider.test>> =
      await TestLLMProvider.test({ llmProviderId: PROVIDER_ID });

    expect(result.success).toBe(false);
    expect(result.exchanges).toEqual([REFUSED_EXCHANGE]);
  });

  test("a pass", async () => {
    fetchMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        {
          success: true,
          message: "OK.",
          exchanges: [PASSED_EXCHANGE] as unknown as Array<JSONObject>,
        },
        {},
      ) as never,
    );

    const result: Awaited<ReturnType<typeof TestLLMProvider.test>> =
      await TestLLMProvider.test({ llmProviderId: PROVIDER_ID });

    expect(result.success).toBe(true);
    expect(result.exchanges).toEqual([PASSED_EXCHANGE]);
  });

  test("a request that threw: none", async () => {
    fetchMock.mockRejectedValue(new Error("offline") as never);

    const result: Awaited<ReturnType<typeof TestLLMProvider.test>> =
      await TestLLMProvider.test({ llmProviderId: PROVIDER_ID });

    expect(result.success).toBe(false);
    expect(result.exchanges).toEqual([]);
  });
});
