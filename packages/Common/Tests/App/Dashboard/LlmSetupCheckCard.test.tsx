import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import LlmConnectionProvider from "../../../Types/LlmObservability/LlmConnectionProvider";
import {
  LlmMetricSource,
  LlmSetupCheckApps,
  LlmSetupCheckConnection,
  LlmSetupCheckResponse,
} from "../../../Types/Telemetry/LlmSetupCheckApi";

/*
 * AI / LLM > Connect > SETUP CHECK (#5776): what each way of sending AI is
 * bringing in right now, for this project - so a project whose provider
 * accounts read fine, and whose apps send nothing, sees both at once.
 *
 * Rendered against a stand-in for the setup check read: its loading and
 * failed states, each group's lines, the parts the reader may not read, the
 * actions that open a way, and "Check again".
 */

const fetchCheckMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmObservabilityReads",
  () => {
    return {
      __esModule: true,
      fetchLlmSetupCheck: (...args: Array<unknown>) => {
        return fetchCheckMock(...args);
      },
    };
  },
);

import LlmSetupCheckCard from "../../../../App/FeatureSet/Dashboard/src/Components/AI/SetupCheck/LlmSetupCheckCard";

const NAMES: Record<string, string> = {
  "svc-checkout": "checkout",
  "svc-search": "search",
};

function serviceName(serviceId: string): string {
  return NAMES[serviceId] || "";
}

function recent(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function apps(overrides: Partial<LlmSetupCheckApps> = {}): LlmSetupCheckApps {
  return {
    callsInWindow: null,
    callsRecently: 0,
    newestCallAt: null,
    services: [],
    providers: [],
    answersRecently: 0,
    answersWithContent: 0,
    contentInLogs: null,
    uninstrumented: null,
    ...overrides,
  };
}

function connection(
  overrides: Partial<LlmSetupCheckConnection> = {},
): LlmSetupCheckConnection {
  return {
    connectionId: "openai",
    name: "OpenAI production",
    provider: LlmConnectionProvider.OpenAI,
    kind: "provider-account",
    isEnabled: true,
    lastReadAt: recent(5),
    lastSuccessfulReadAt: recent(5),
    lastError: "",
    newestUsageAt: "2026-11-03T00:00:00.000Z",
    resources: null,
    readSince: null,
    callsRecently: null,
    ...overrides,
  };
}

function check(
  overrides: Partial<LlmSetupCheckResponse> = {},
): LlmSetupCheckResponse {
  return {
    checkedAt: new Date().toISOString(),
    apps: apps(),
    metrics: [],
    connections: [],
    ...overrides,
  };
}

let onPickWay: jest.Mock;

async function renderCard(refreshToken?: number): Promise<{
  rerender: (token: number) => Promise<void>;
}> {
  let rendered: ReturnType<typeof render> | undefined;

  await act(async () => {
    rendered = render(
      <LlmSetupCheckCard
        onPickWay={onPickWay as never}
        serviceName={serviceName}
        refreshToken={refreshToken}
      />,
    );
  });

  return {
    rerender: async (token: number) => {
      await act(async () => {
        rendered!.rerender(
          <LlmSetupCheckCard
            onPickWay={onPickWay as never}
            serviceName={serviceName}
            refreshToken={token}
          />,
        );
      });
    },
  };
}

function group(testId: string): HTMLElement {
  return screen.getByTestId(testId);
}

beforeEach(() => {
  fetchCheckMock.mockReset();
  onPickWay = jest.fn();
});

afterEach(() => {
  cleanup();
});

describe("the Setup check card while it reads, and when it cannot", () => {
  test("while the check reads: a placeholder, and Check again waits", async () => {
    fetchCheckMock.mockReturnValue(new Promise(() => {}) as never);

    await renderCard();

    expect(screen.getByTestId("llm-setup-check-loading")).toBeInTheDocument();
    expect(screen.getByText("Setup check")).toBeInTheDocument();
    expect(
      screen.getByText(
        "What each way is bringing in right now, and what is missing.",
      ),
    ).toBeInTheDocument();
  });

  test("a check that cannot be read says so, never a diagnosis it could not make", async () => {
    fetchCheckMock.mockRejectedValue(new Error("Timeout exceeded") as never);

    await renderCard();

    expect(screen.getByTestId("llm-setup-check-error")).toHaveTextContent(
      "The setup check could not be read. Check again in a moment.",
    );
    expect(screen.queryByTestId("llm-setup-check-apps")).not.toBeInTheDocument();
  });

  test("Check again reads it again", async () => {
    fetchCheckMock.mockResolvedValue(check() as never);

    await renderCard();

    expect(fetchCheckMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Check again/ }));
    });

    expect(fetchCheckMock).toHaveBeenCalledTimes(2);
  });

  test("a connection the page changed reads it again", async () => {
    fetchCheckMock.mockResolvedValue(check() as never);

    const card: { rerender: (token: number) => Promise<void> } =
      await renderCard(0);

    await card.rerender(1);

    expect(fetchCheckMock).toHaveBeenCalledTimes(2);
  });

  test("the check covers the project, not a view's window", async () => {
    fetchCheckMock.mockResolvedValue(check() as never);

    await renderCard();

    expect(fetchCheckMock.mock.calls[0]![0]).toBeUndefined();
  });
});

describe("the Setup check card: the customer's case", () => {
  /*
   * Provider accounts connected and reading, no app sending AI calls: the
   * card says both, and the way to send the calls.
   */
  test("working provider accounts, and no app sending AI calls", async () => {
    fetchCheckMock.mockResolvedValue(
      check({
        connections: [
          connection(),
          connection({
            connectionId: "azure",
            name: "Azure production",
            provider: LlmConnectionProvider.AzureOpenAI,
            newestUsageAt: null,
            resources: 0,
          }),
        ],
      }) as never,
    );

    await renderCard();

    const appsGroup: HTMLElement = group("llm-setup-check-apps");

    expect(appsGroup).toHaveTextContent(
      "No app has sent an AI call yet. Calls and conversations come from your apps.",
    );
    expect(
      within(appsGroup).getByTestId("llm-setup-check-line-apps-none"),
    ).toHaveAttribute("data-tone", "off");

    await act(async () => {
      fireEvent.click(screen.getByTestId("llm-setup-check-apps-action"));
    });

    expect(onPickWay).toHaveBeenCalledWith("apps");

    const accounts: HTMLElement = group("llm-setup-check-accounts");

    expect(
      within(accounts).getByTestId("llm-setup-check-connection-openai"),
    ).toHaveTextContent("OpenAI production");
    expect(
      within(
        within(accounts).getByTestId("llm-setup-check-connection-openai"),
      ).getByTestId("llm-setup-check-line-connection-openai"),
    ).toHaveAttribute("data-tone", "ok");
    expect(accounts).toHaveTextContent(/Last used/);
    // OpenAI's reports leave Azure OpenAI out.
    expect(accounts).toHaveTextContent(
      "Azure OpenAI and ChatGPT use are not in it.",
    );

    const azure: HTMLElement = within(accounts).getByTestId(
      "llm-setup-check-connection-azure",
    );

    expect(azure).toHaveTextContent("Monitoring Reader role");
    expect(
      within(azure).getByTestId("llm-setup-check-line-connection-azure"),
    ).toHaveAttribute("data-tone", "warning");

    // Accounts are connected: no "Connect one" on them.
    expect(
      screen.queryByTestId("llm-setup-check-accounts-action"),
    ).not.toBeInTheDocument();
  });
});

describe("the Setup check card: your apps", () => {
  test("apps sending AI calls: no way to open, and what was said is not recorded", async () => {
    fetchCheckMock.mockResolvedValue(
      check({
        apps: apps({
          callsRecently: 12,
          newestCallAt: recent(3),
          services: [
            { serviceId: "svc-checkout", calls: 10, newestAt: recent(3) },
            { serviceId: "svc-search", calls: 2, newestAt: recent(30) },
          ],
          providers: [{ name: "az.ai.inference", calls: 12 }],
          answersRecently: 12,
          answersWithContent: 0,
          contentInLogs: true,
        }),
      }) as never,
    );

    await renderCard();

    const appsGroup: HTMLElement = group("llm-setup-check-apps");

    expect(appsGroup).toHaveTextContent(
      "12 AI calls in the past 7 days, from checkout and search.",
    );
    // A provider by its title, whatever spelling its rows were stored under.
    expect(appsGroup).toHaveTextContent("Through Azure AI Inference.");
    expect(appsGroup).toHaveTextContent(
      "Your app sends them as log records, which conversations don't read: record them on the spans instead.",
    );
    expect(
      within(appsGroup).getByTestId("llm-setup-check-line-apps-content"),
    ).toHaveAttribute("data-tone", "warning");
    expect(
      screen.queryByTestId("llm-setup-check-apps-action"),
    ).not.toBeInTheDocument();
  });

  test("an app calling an AI API that nothing records", async () => {
    fetchCheckMock.mockResolvedValue(
      check({
        apps: apps({
          uninstrumented: [
            {
              serviceId: "svc-checkout",
              host: "contoso.openai.azure.com",
              provider: "azure.ai.openai",
              calls: 7,
            },
          ],
        }),
      }) as never,
    );

    await renderCard();

    expect(group("llm-setup-check-apps")).toHaveTextContent(
      "checkout called contoso.openai.azure.com 7 times in the past day",
    );
    expect(
      screen.getByTestId("llm-setup-check-apps-action"),
    ).toBeInTheDocument();
  });

  test("apps the reader may not read: said, not guessed", async () => {
    fetchCheckMock.mockResolvedValue(
      check({ apps: null, connections: null }) as never,
    );

    await renderCard();

    for (const testId of [
      "llm-setup-check-apps",
      "llm-setup-check-accounts",
      "llm-setup-check-tools",
    ]) {
      expect(group(testId)).toHaveTextContent(
        "This part could not be read for you.",
      );
    }
  });
});

describe("the Setup check card: coding assistants", () => {
  test("the tools that send usage metrics, and the newest", async () => {
    fetchCheckMock.mockResolvedValue(
      check({
        metrics: [
          {
            source: LlmMetricSource.ClaudeCode,
            points: 200,
            newestAt: recent(120),
          },
          {
            source: LlmMetricSource.Cursor,
            points: 20,
            newestAt: recent(10),
          },
          // The conventions' own metrics come from apps, not a tool.
          { source: LlmMetricSource.GenAi, points: 900, newestAt: recent(1) },
          // A tool with nothing in the past week is not sending.
          { source: LlmMetricSource.Codex, points: 0, newestAt: null },
        ],
      }) as never,
    );

    await renderCard();

    const tools: HTMLElement = group("llm-setup-check-coding-tools");

    // The newest of the tools' points, not the first tool's.
    expect(tools).toHaveTextContent(
      "Claude Code and Cursor send usage metrics. The newest arrived 10 minutes ago.",
    );
    expect(tools).toHaveTextContent(
      "They show on Usage: who uses what, and what it costs. Coding assistants send no conversations.",
    );
    expect(tools).not.toHaveTextContent("Codex");
    expect(tools).not.toHaveTextContent("GenAI metrics");
  });

  test("no coding assistant: no group", async () => {
    fetchCheckMock.mockResolvedValue(
      check({
        metrics: [
          { source: LlmMetricSource.GenAi, points: 900, newestAt: recent(1) },
        ],
      }) as never,
    );

    await renderCard();

    expect(
      screen.queryByTestId("llm-setup-check-coding-tools"),
    ).not.toBeInTheDocument();
  });
});

describe("the Setup check card: connections", () => {
  test("nothing connected: each kind says what it would bring, and opens its way", async () => {
    fetchCheckMock.mockResolvedValue(check() as never);

    await renderCard();

    expect(group("llm-setup-check-accounts")).toHaveTextContent(
      "None connected. An account brings its usage and cost by day, with no code.",
    );
    expect(group("llm-setup-check-tools")).toHaveTextContent(
      "None connected. A company AI tool brings what your people ask it, by person.",
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("llm-setup-check-accounts-action"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("llm-setup-check-tools-action"));
    });

    expect(onPickWay.mock.calls).toEqual([["providers"], ["tools"]]);
  });

  test("a company AI tool under its own group, with its chats; a failing one in red", async () => {
    fetchCheckMock.mockResolvedValue(
      check({
        connections: [
          connection({
            connectionId: "claude",
            name: "Claude for the support team",
            provider: LlmConnectionProvider.ClaudeEnterprise,
            kind: "company-tool",
            newestUsageAt: null,
            callsRecently: 31,
          }),
          connection({
            connectionId: "copilot",
            name: "Copilot",
            provider: LlmConnectionProvider.Microsoft365Copilot,
            kind: "company-tool",
            newestUsageAt: null,
            lastError: "HTTP 403: Forbidden",
            lastReadAt: recent(2),
            lastSuccessfulReadAt: recent(600),
          }),
        ],
      }) as never,
    );

    await renderCard();

    const tools: HTMLElement = group("llm-setup-check-tools");

    expect(
      within(tools).getByTestId("llm-setup-check-connection-claude"),
    ).toHaveTextContent("31 chats in the past 7 days.");

    const copilot: HTMLElement = within(tools).getByTestId(
      "llm-setup-check-connection-copilot",
    );

    expect(copilot).toHaveTextContent(
      "Its last read failed: HTTP 403: Forbidden",
    );
    expect(
      within(copilot).getByTestId("llm-setup-check-line-connection-copilot"),
    ).toHaveAttribute("data-tone", "error");

    // Tools are not provider accounts.
    expect(group("llm-setup-check-accounts")).toHaveTextContent(
      "None connected.",
    );
  });

  test("every tone says itself to a screen reader", async () => {
    fetchCheckMock.mockResolvedValue(
      check({
        connections: [connection({ isEnabled: false })],
      }) as never,
    );

    await renderCard();

    const line: HTMLElement = screen.getByTestId(
      "llm-setup-check-line-connection-openai",
    );

    expect(line).toHaveAttribute("data-tone", "off");
    expect(within(line).getByText("Not set up")).toHaveClass("sr-only");
    expect(line).toHaveTextContent("Turned off");
  });
});
