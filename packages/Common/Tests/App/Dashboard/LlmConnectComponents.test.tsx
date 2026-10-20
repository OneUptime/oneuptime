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
import LlmConnectWayPicker from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmConnectWayPicker";
import {
  LlmConnectWayKey,
  LlmConnectWayStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmConnectWays";
import LlmConnectionTiles from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmConnectionTiles";
import LlmConnectionTestPanel from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmConnectionTestPanel";
import LlmTellYourPeopleNote from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmTellYourPeopleNote";
import LlmOtherAiTools from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmOtherAiTools";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The pieces of AI / LLM > Connect, drawn:
 *
 *   - the three ways in, as tabs: each says what it brings, ticks itself
 *     from what is true (calls arriving, connections, any not working),
 *     says nothing while it does not know, and is picked by a click or
 *     the arrow keys;
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

const UNKNOWN: LlmConnectWayStatus = {
  isSetUp: undefined,
  connected: 0,
  failing: 0,
};

const NOTHING_KNOWN: Record<LlmConnectWayKey, LlmConnectWayStatus> = {
  apps: UNKNOWN,
  providers: UNKNOWN,
  tools: UNKNOWN,
};

function renderWays(data: {
  value: LlmConnectWayKey;
  statuses: Record<LlmConnectWayKey, LlmConnectWayStatus>;
  onChange?: (key: LlmConnectWayKey, withKeyboard: boolean) => void;
}): void {
  render(
    <LlmConnectWayPicker
      value={data.value}
      statuses={data.statuses}
      onChange={data.onChange || ((): void => {})}
    />,
  );
}

describe("the three ways", () => {
  test("your apps, your provider accounts and your company's AI tools, each with what it brings", () => {
    renderWays({ value: "apps", statuses: NOTHING_KNOWN });

    for (const [key, title, description] of [
      [
        "apps",
        "Your apps",
        "Every call as it happens: the conversation, the person, tokens, cost and bad answers.",
      ],
      [
        "providers",
        "Your AI provider accounts",
        "What your OpenAI, Anthropic, Azure, Bedrock or Vertex AI accounts used and cost, with no code.",
      ],
      [
        "tools",
        "Your company's AI tools",
        "What your people ask Claude Enterprise or Microsoft 365 Copilot, by person.",
      ],
    ] as Array<[string, string, string]>) {
      const way: HTMLElement = screen.getByTestId(`llm-connect-way-${key}`);

      expect(way).toHaveAttribute("role", "tab");
      expect(way).toHaveTextContent(title);
      expect(way).toHaveTextContent(description);
    }
  });

  test("the picked way is the selected tab, and the only one in the tab order", () => {
    renderWays({ value: "providers", statuses: NOTHING_KNOWN });

    expect(screen.getByTestId("llm-connect-way-providers")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("llm-connect-way-providers")).toHaveAttribute(
      "tabindex",
      "0",
    );

    for (const key of ["apps", "tools"]) {
      expect(screen.getByTestId(`llm-connect-way-${key}`)).toHaveAttribute(
        "aria-selected",
        "false",
      );
      expect(screen.getByTestId(`llm-connect-way-${key}`)).toHaveAttribute(
        "tabindex",
        "-1",
      );
    }
  });

  test("nothing known yet: no way is done or to do, and none says anything", () => {
    renderWays({ value: "apps", statuses: NOTHING_KNOWN });

    for (const key of ["apps", "providers", "tools"]) {
      expect(screen.getByTestId(`llm-connect-way-${key}`)).toHaveAttribute(
        "data-done",
        "unknown",
      );
      expect(
        screen.queryByTestId(`llm-connect-way-${key}-status`),
      ).not.toBeInTheDocument();
    }
  });

  test("a way ticks itself from what is true: calls arriving, connections, and any not working", () => {
    renderWays({
      value: "apps",
      statuses: {
        apps: { isSetUp: true, connected: 0, failing: 0 },
        providers: { isSetUp: true, connected: 3, failing: 1 },
        tools: { isSetUp: true, connected: 1, failing: 0 },
      },
    });

    expect(screen.getByTestId("llm-connect-way-apps")).toHaveAttribute(
      "data-done",
      "true",
    );
    expect(
      screen.getByTestId("llm-connect-way-apps-receiving"),
    ).toHaveTextContent("Receiving AI calls");
    expect(
      screen.getByTestId("llm-connect-way-providers-connected"),
    ).toHaveTextContent("Connected (3)");
    expect(
      screen.getByTestId("llm-connect-way-providers-failing"),
    ).toHaveTextContent("Not working");
    expect(
      screen.getByTestId("llm-connect-way-tools-connected"),
    ).toHaveTextContent(/^Connected$/);
    expect(
      screen.queryByTestId("llm-connect-way-tools-failing"),
    ).not.toBeInTheDocument();
  });

  test("not set up says nothing: the absence of a tick is enough", () => {
    renderWays({
      value: "apps",
      statuses: {
        apps: { isSetUp: false, connected: 0, failing: 0 },
        providers: { isSetUp: false, connected: 0, failing: 0 },
        tools: { isSetUp: false, connected: 0, failing: 0 },
      },
    });

    for (const key of ["apps", "providers", "tools"]) {
      expect(screen.getByTestId(`llm-connect-way-${key}`)).toHaveAttribute(
        "data-done",
        "false",
      );
      expect(
        screen.queryByTestId(`llm-connect-way-${key}-status`),
      ).not.toBeInTheDocument();
    }
  });

  test("a click picks a way, and picking the picked one again does nothing", () => {
    const onChange: MockFunction = getJestMockFunction();

    renderWays({ value: "apps", statuses: NOTHING_KNOWN, onChange });

    fireEvent.click(screen.getByTestId("llm-connect-way-tools"));
    fireEvent.click(screen.getByTestId("llm-connect-way-apps"));

    expect(onChange.mock.calls).toEqual([["tools", false]]);
  });

  test("arrow keys, Home and End pick along the ways, around the ends, and say they were keys", () => {
    const onChange: MockFunction = getJestMockFunction();

    renderWays({ value: "apps", statuses: NOTHING_KNOWN, onChange });

    const apps: HTMLElement = screen.getByTestId("llm-connect-way-apps");

    fireEvent.keyDown(apps, { key: "ArrowRight" });
    fireEvent.keyDown(apps, { key: "ArrowLeft" });
    fireEvent.keyDown(apps, { key: "End" });
    fireEvent.keyDown(apps, { key: "Home" });
    fireEvent.keyDown(apps, { key: "Enter" });

    expect(onChange.mock.calls).toEqual([
      ["providers", true],
      ["tools", true],
      ["tools", true],
      ["apps", true],
    ]);
  });

  test("a screen reader hears a list of tabs, each controlling its panel", () => {
    renderWays({ value: "apps", statuses: NOTHING_KNOWN });

    const list: HTMLElement = screen.getByRole("tablist", {
      name: "Ways to bring AI in",
    });

    for (const tab of within(list).getAllByRole("tab")) {
      expect(tab.getAttribute("aria-controls")).toBe(
        tab.id.replace("llm-connect-way-", "llm-connect-panel-"),
      );
    }
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
    // "It works", not "Connected": nothing is saved until Connect.
    expect(status).toHaveTextContent(
      "It works. Here is what the account used in the last 7 days.",
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

  test("opened from a connection's row, the dialog says what the test does: the panel shows the answer and Test again under it", async () => {
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

    const panel: HTMLElement = screen.getByTestId("llm-connection-test-panel");

    // Not "until you connect": it is connected.
    expect(panel).not.toHaveTextContent("Test the connection");
    expect(panel).not.toHaveTextContent("Nothing is kept until you connect.");

    const button: HTMLElement = screen.getByTestId(
      "llm-connection-test-button",
    );

    expect(button).toHaveTextContent("Test again");
    // Under the answer.
    expect(
      screen
        .getByTestId("llm-connection-test-pass")
        .compareDocumentPosition(button) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await act(async () => {
      fireEvent.click(button);
    });

    expect(runTest).toHaveBeenCalledTimes(2);
  });

  test("a failure's details sit under their own label, apart from the advice", async () => {
    const runTest: MockFunction = getJestMockFunction().mockResolvedValue({
      provider: LlmConnectionProvider.OpenAI,
      status: "fail",
      message: "HTTP 403: insufficient permissions",
      failureKind: LlmConnectionFailureKind.Permission,
      durationMs: 80,
    } as LlmConnectionTestResult);

    render(<LlmConnectionTestPanel definition={openAi} runTest={runTest} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("llm-connection-test-button"));
    });

    const status: HTMLElement = screen.getByTestId("llm-connection-test-fail");

    expect(status).toHaveTextContent("Details");
    expect(status).toHaveTextContent(
      "Give it the role or scope the setup guide names, then test again.",
    );
    expect(screen.getByTestId("llm-connection-test-details")).toHaveTextContent(
      "HTTP 403: insufficient permissions",
    );
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

  test("the tools with no API are folded under a question, closed until opened", () => {
    render(<LlmOtherAiTools />);

    const fold: HTMLElement = screen.getByTestId("llm-other-ai-tools");

    expect(fold.tagName).toBe("DETAILS");
    expect(fold).not.toHaveAttribute("open");
    expect(screen.getByTestId("llm-other-ai-tools-summary")).toHaveTextContent(
      "Using another AI tool?",
    );

    fireEvent.click(screen.getByTestId("llm-other-ai-tools-summary"));

    expect(fold).toHaveAttribute("open");
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
