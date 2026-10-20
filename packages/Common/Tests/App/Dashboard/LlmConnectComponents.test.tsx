import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import {
  LlmConnectionDefinition,
  LlmConnectionKind,
  getLlmConnectionDefinition,
} from "../../../Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "../../../Types/LlmObservability/LlmConnectionProvider";
import {
  LlmConnectionFailureKind,
  LlmConnectionTestResult,
} from "../../../Types/LlmObservability/LlmConnectionTest";
import LlmConnectChecklist, {
  LlmConnectChecklistFacts,
  LlmConnectChecklistKey,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmConnectChecklist";
import LlmConnectionTiles from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmConnectionTiles";
import LlmConnectionTestPanel from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmConnectionTestPanel";
import LlmTellYourPeopleNote from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmTellYourPeopleNote";
import LlmOtherAiTools from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmOtherAiTools";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The pieces of AI / LLM > Connect, drawn:
 *
 *   - the checklist ticks what is true, says when it does not know yet,
 *     and offers a way in only for what is not done;
 *   - a tile per provider or tool, saying whether it is connected and how
 *     many times, and handing the click on - or disabled without the right
 *     to connect;
 *   - the test panel waits for the required settings, runs once, shows
 *     what it found or what to fix, and keeps the provider's words apart;
 *   - the note to tell your people, and the AI tools with no API, each
 *     with a guide.
 */

afterEach(() => {
  cleanup();
});

const NOTHING_KNOWN: LlmConnectChecklistFacts = {
  hasAiCalls: undefined,
  hasProviderAccount: undefined,
  hasCompanyTool: undefined,
  hasBudget: undefined,
};

function renderChecklist(
  facts: LlmConnectChecklistFacts,
  onOpen: (key: LlmConnectChecklistKey) => void = (): void => {},
): void {
  render(<LlmConnectChecklist facts={facts} onOpen={onOpen} />);
}

describe("the checklist", () => {
  test("nothing done: four things to do, each with its way in", () => {
    renderChecklist({
      hasAiCalls: false,
      hasProviderAccount: false,
      hasCompanyTool: false,
      hasBudget: false,
    });

    expect(
      screen.getByTestId("llm-connect-checklist-progress"),
    ).toHaveTextContent("0 of 4 done");

    for (const [key, title, action] of [
      ["apps", "Send AI calls from your apps", "Show the snippet"],
      ["providers", "Connect an AI provider account", "Pick a provider"],
      ["companyTools", "Connect your company's AI tools", "Pick a tool"],
      ["budget", "Set a daily budget", "Open Budgets"],
    ] as Array<[string, string, string]>) {
      const item: HTMLElement = screen.getByTestId(
        `llm-connect-checklist-${key}`,
      );

      expect(item).toHaveAttribute("data-done", "false");
      expect(item).toHaveTextContent(`To do: ${title}`);
      expect(
        within(item).getByTestId(`llm-connect-checklist-open-${key}`),
      ).toHaveTextContent(action);
    }
  });

  test("ticks what is true, in its done words, with no way in left to take", () => {
    renderChecklist({
      hasAiCalls: true,
      hasProviderAccount: true,
      hasCompanyTool: false,
      hasBudget: true,
    });

    expect(
      screen.getByTestId("llm-connect-checklist-progress"),
    ).toHaveTextContent("3 of 4 done");

    const apps: HTMLElement = screen.getByTestId("llm-connect-checklist-apps");

    expect(apps).toHaveAttribute("data-done", "true");
    expect(apps).toHaveTextContent("Done: Your apps send their AI calls");
    expect(
      screen.queryByTestId("llm-connect-checklist-open-apps"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("llm-connect-checklist-providers"),
    ).toHaveTextContent("A provider account is connected");
    expect(
      screen.getByTestId("llm-connect-checklist-budget"),
    ).toHaveTextContent("A daily budget is set");
    expect(
      screen.getByTestId("llm-connect-checklist-open-companyTools"),
    ).toBeInTheDocument();
  });

  test("not known yet is neither done nor to do", () => {
    renderChecklist(NOTHING_KNOWN);

    for (const key of ["apps", "providers", "companyTools", "budget"]) {
      expect(
        screen.getByTestId(`llm-connect-checklist-${key}`),
      ).toHaveAttribute("data-done", "unknown");
    }

    expect(
      screen.getByTestId("llm-connect-checklist-progress"),
    ).toHaveTextContent("0 of 4 done");
  });

  test("a way in opens its own part of the page", () => {
    const onOpen: MockFunction = getJestMockFunction();

    renderChecklist(
      {
        hasAiCalls: false,
        hasProviderAccount: false,
        hasCompanyTool: false,
        hasBudget: false,
      },
      onOpen,
    );

    fireEvent.click(
      screen.getByTestId("llm-connect-checklist-open-companyTools"),
    );
    fireEvent.click(screen.getByTestId("llm-connect-checklist-open-budget"));

    expect(onOpen.mock.calls).toEqual([["companyTools"], ["budget"]]);
  });
});

describe("the tiles", () => {
  function renderTiles(
    kind: LlmConnectionKind,
    props: Partial<{
      connectionCounts: Partial<Record<LlmConnectionProvider, number>>;
      canConnect: boolean;
      onConnect: (provider: LlmConnectionProvider) => void;
    }> = {},
  ): void {
    render(
      <LlmConnectionTiles
        kind={kind}
        connectionCounts={props.connectionCounts || {}}
        canConnect={props.canConnect ?? true}
        connectDisabledReason="You do not have permission to create this AI Connection."
        onConnect={props.onConnect || ((): void => {})}
      />,
    );
  }

  function tileProviders(): Array<string> {
    return screen.getAllByRole("button").map((button: HTMLElement): string => {
      return (button.getAttribute("data-testid") || "").replace(
        "llm-connection-tile-",
        "",
      );
    });
  }

  test("provider accounts: OpenAI, Anthropic, Azure, Bedrock and Vertex AI", () => {
    renderTiles(LlmConnectionKind.ProviderAccount);

    expect(tileProviders()).toEqual([
      LlmConnectionProvider.OpenAI,
      LlmConnectionProvider.Anthropic,
      LlmConnectionProvider.AzureOpenAI,
      LlmConnectionProvider.AwsBedrock,
      LlmConnectionProvider.GoogleVertexAI,
    ]);
    expect(
      screen.getByTestId(`llm-connection-tile-${LlmConnectionProvider.OpenAI}`),
    ).toHaveTextContent("Usage and cost of your OpenAI organization.");
  });

  test("company AI tools: Claude Enterprise and Microsoft 365 Copilot", () => {
    renderTiles(LlmConnectionKind.CompanyTool);

    expect(tileProviders()).toEqual([
      LlmConnectionProvider.ClaudeEnterprise,
      LlmConnectionProvider.Microsoft365Copilot,
    ]);
  });

  test("a connected provider says so, and how many times", () => {
    renderTiles(LlmConnectionKind.ProviderAccount, {
      connectionCounts: {
        [LlmConnectionProvider.OpenAI]: 1,
        [LlmConnectionProvider.AzureOpenAI]: 2,
      },
    });

    const openAi: HTMLElement = screen.getByTestId(
      `llm-connection-tile-${LlmConnectionProvider.OpenAI}`,
    );
    const azure: HTMLElement = screen.getByTestId(
      `llm-connection-tile-${LlmConnectionProvider.AzureOpenAI}`,
    );
    const anthropic: HTMLElement = screen.getByTestId(
      `llm-connection-tile-${LlmConnectionProvider.Anthropic}`,
    );

    expect(
      within(openAi).getByTestId(
        `llm-connection-tile-connected-${LlmConnectionProvider.OpenAI}`,
      ),
    ).toHaveTextContent(/^Connected$/);
    expect(openAi).toHaveTextContent("Connect another");
    expect(azure).toHaveTextContent("Connected (2)");
    expect(
      within(anthropic).queryByTestId(
        `llm-connection-tile-connected-${LlmConnectionProvider.Anthropic}`,
      ),
    ).not.toBeInTheDocument();
    expect(anthropic).not.toHaveTextContent("Connect another");
  });

  test("a click hands on the provider", () => {
    const onConnect: MockFunction = getJestMockFunction();

    renderTiles(LlmConnectionKind.CompanyTool, { onConnect });

    fireEvent.click(
      screen.getByTestId(
        `llm-connection-tile-${LlmConnectionProvider.Microsoft365Copilot}`,
      ),
    );

    expect(onConnect).toHaveBeenCalledWith(
      LlmConnectionProvider.Microsoft365Copilot,
    );
  });

  test("without the right to connect, every tile is disabled and does nothing", () => {
    const onConnect: MockFunction = getJestMockFunction();

    renderTiles(LlmConnectionKind.ProviderAccount, {
      canConnect: false,
      onConnect,
    });

    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }

    expect(onConnect).not.toHaveBeenCalled();
  });
});

describe("the test panel", () => {
  const openAi: LlmConnectionDefinition = getLlmConnectionDefinition(
    LlmConnectionProvider.OpenAI,
  )!;
  const claude: LlmConnectionDefinition = getLlmConnectionDefinition(
    LlmConnectionProvider.ClaudeEnterprise,
  )!;

  function passing(): LlmConnectionTestResult {
    return {
      provider: LlmConnectionProvider.OpenAI,
      status: "pass",
      message: "Read 7 days of usage.",
      counts: { costUsd: 41.5, inputTokens: 900_000, outputTokens: 100_000 },
      durationMs: 300,
    };
  }

  test("says what a test reads, and keeps nothing", () => {
    render(
      <LlmConnectionTestPanel
        definition={openAi}
        runTest={getJestMockFunction()}
      />,
    );

    expect(screen.getByTestId("llm-connection-test-panel")).toHaveTextContent(
      "Reads the last 7 days of usage. Nothing is kept until you connect.",
    );
    expect(screen.getByTestId("llm-connection-test-button")).toHaveTextContent(
      "Test connection",
    );
  });

  test("a company tool's test counts chats and reads nothing anyone wrote", () => {
    render(
      <LlmConnectionTestPanel
        definition={claude}
        runTest={getJestMockFunction()}
      />,
    );

    expect(screen.getByTestId("llm-connection-test-panel")).toHaveTextContent(
      "Counts the chats of the last 7 days. Nothing anyone wrote is read, shown or kept.",
    );
  });

  test("waits for the required settings", () => {
    const runTest: MockFunction = getJestMockFunction();

    render(
      <LlmConnectionTestPanel
        definition={openAi}
        runTest={runTest}
        disabledReason="Fill in Admin key to test."
      />,
    );

    const button: HTMLElement = screen.getByTestId(
      "llm-connection-test-button",
    );

    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(runTest).not.toHaveBeenCalled();
  });

  test("shows what a working account used, then offers to test again", async () => {
    const runTest: MockFunction =
      getJestMockFunction().mockResolvedValue(passing());

    render(<LlmConnectionTestPanel definition={openAi} runTest={runTest} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("llm-connection-test-button"));
    });

    const status: HTMLElement = screen.getByTestId("llm-connection-test-pass");

    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveTextContent(
      "Connected. Here is what the account used in the last 7 days.",
    );

    const figures: HTMLElement = within(status).getByTestId(
      "llm-connection-test-figures",
    );

    expect(figures).toHaveTextContent("Cost$41.50");
    expect(figures).toHaveTextContent("Tokens1.0M");
    expect(
      screen.queryByTestId("llm-connection-test-details"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("llm-connection-test-button")).toHaveTextContent(
      "Test again",
    );
    expect(runTest).toHaveBeenCalledTimes(1);
  });

  test("a refused key says what to fix, with the provider's words apart", async () => {
    const refused: LlmConnectionTestResult = {
      provider: LlmConnectionProvider.OpenAI,
      status: "fail",
      message: "OpenAI answered 401: Incorrect API key provided.",
      failureKind: LlmConnectionFailureKind.Authentication,
      durationMs: 80,
    };
    const runTest: MockFunction =
      getJestMockFunction().mockResolvedValue(refused);

    render(<LlmConnectionTestPanel definition={openAi} runTest={runTest} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("llm-connection-test-button"));
    });

    const status: HTMLElement = screen.getByTestId("llm-connection-test-fail");

    expect(status).toHaveTextContent("The key or secret was not accepted.");
    expect(status).toHaveTextContent("has not been revoked");
    expect(
      within(status).queryByTestId("llm-connection-test-figures"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("llm-connection-test-details")).toHaveTextContent(
      "OpenAI answered 401: Incorrect API key provided.",
    );
  });

  test("a request that fails is an alert, not a result", async () => {
    const runTest: MockFunction = getJestMockFunction().mockRejectedValue(
      new Error("Network went away"),
    );

    render(<LlmConnectionTestPanel definition={openAi} runTest={runTest} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("llm-connection-test-button"));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Network went away");
    expect(
      screen.queryByTestId("llm-connection-test-fail"),
    ).not.toBeInTheDocument();
  });

  test("opened from a connection's row, it tests at once, once", async () => {
    const runTest: MockFunction =
      getJestMockFunction().mockResolvedValue(passing());

    await act(async () => {
      render(
        <LlmConnectionTestPanel
          definition={openAi}
          runTest={runTest}
          startImmediately={true}
        />,
      );
    });

    expect(screen.getByTestId("llm-connection-test-pass")).toBeInTheDocument();
    expect(runTest).toHaveBeenCalledTimes(1);
  });
});

describe("telling your people, and the tools with no API", () => {
  test("the note says their chats are kept, who reads them, and to check the law", () => {
    render(<LlmTellYourPeopleNote />);

    const note: HTMLElement = screen.getByTestId("llm-tell-your-people");

    expect(note).toHaveTextContent("Tell your people first");
    expect(note).toHaveTextContent("their chats with this tool are kept");
    expect(note).toHaveTextContent("who can read them");
    expect(note).toHaveTextContent("legal or HR team");
  });

  test("each AI tool with no API has a guide", () => {
    render(<LlmOtherAiTools />);

    for (const [key, title, guide] of [
      [
        "chatgpt-enterprise",
        "ChatGPT Enterprise",
        "/telemetry/ai-company-tools#chatgpt-enterprise",
      ],
      [
        "gemini",
        "Gemini for Google Workspace",
        "/telemetry/ai-company-tools#gemini-for-google-workspace",
      ],
      [
        "coding-assistants",
        "Coding assistants",
        "/telemetry/ai-coding-assistants",
      ],
      [
        "self-hosted-chat",
        "Open WebUI and LibreChat",
        "/telemetry/ai-company-tools#open-webui-and-librechat",
      ],
    ] as Array<[string, string, string]>) {
      const tool: HTMLElement = screen.getByTestId(`llm-other-ai-tool-${key}`);
      const link: HTMLElement = within(tool).getByRole("link");

      expect(tool).toHaveTextContent(title);
      expect(link).toHaveTextContent("Read how");
      expect(link.getAttribute("href")?.endsWith(guide)).toBe(true);
      // A guide opens beside the page, without handing it the opener.
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });
});
