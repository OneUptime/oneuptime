import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";

/*
 * The answer's markdown is the markdown viewer's to draw: stubbed here, as
 * the other answer suites do. What is under test is what sits under it.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/SafeChatMarkdown",
  () => {
    return {
      __esModule: true,
      default: (props: { text: string }): React.ReactElement => {
        const react: typeof React = jest.requireActual("react") as typeof React;
        return react.createElement("p", null, props.text);
      },
    };
  },
);

import ChatMessageList from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatMessageList";
import ToolApprovalCard from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ToolApprovalCard";
import {
  ACTION_ARGUMENT_LABELS,
  ActionArgumentPart,
  getActionArgumentParts,
  getShownToolActions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ToolActionWords";
import WidgetBuilder from "../../../Server/Utils/AI/Toolbox/WidgetBuilder";
import AIConversationMessage from "../../../Models/DatabaseModels/AIConversationMessage";
import {
  AI_ACTION_CARD_KINDS,
  AI_ACTION_CARD_LINES,
  aiActionSentence,
  aiActionTerm,
} from "../../../Types/AI/AIActionWords";
import AIChatMessageRole from "../../../Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "../../../Types/AI/AIChatMessageStatus";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
  AIChatWidget,
  AIChatWidgetType,
} from "../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * WHAT AN ANSWER LISTS UNDER ITS WORDS (#5349's reviewer, #5623's
 * follow-up).
 *
 *   - An action that ran and left a card above names it (widgetId): the
 *     card says what was made or changed, so the action's "Executed" line
 *     is not drawn again under it. One that failed, was skipped, or ran
 *     before actions named their cards is still listed.
 *   - The approval card's line of arguments named them by the tool's own
 *     keys and as JSON ("note: ...", "changes: [{...}]",
 *     "notifySubscribers: true"). Each argument a write tool takes is named
 *     in the reader's words, a list says how many it holds, yes or no is
 *     said in words; what the model wrote stays as it wrote it.
 */

const DE: Record<string, string> = readDashboardLocale("de");

const MESSAGE_ID: string = "11111111-1111-4111-8111-111111111111";

function action(overrides: Partial<AIChatToolAction> = {}): AIChatToolAction {
  return {
    id: "call-1",
    toolName: "acknowledge_incident",
    title: "Acknowledge incident INC-42",
    arguments: { incidentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
    isMutation: true,
    requiresApproval: true,
    status: AIChatToolActionStatus.Executed,
    ...overrides,
  };
}

function card(id: string): AIChatWidget {
  return {
    ...WidgetBuilder.actionCard({
      title: "Incident acknowledged",
      heading: "INC-42 · Checkout down",
      words: {
        kind: aiActionTerm(AI_ACTION_CARD_KINDS.incident),
        line: [aiActionSentence(AI_ACTION_CARD_LINES.nowAcknowledged)],
      },
    }),
    id,
  };
}

function answer(data: {
  widgets: Array<AIChatWidget>;
  toolActions: Array<AIChatToolAction>;
}): AIConversationMessage {
  const message: AIConversationMessage = new AIConversationMessage();
  message.id = new ObjectID(MESSAGE_ID);
  message.role = AIChatMessageRole.Assistant;
  message.status = AIChatMessageStatus.Completed;
  message.contentInMarkdown = "Acknowledged.";
  message.widgets = data.widgets;
  message.toolActions = data.toolActions;
  message.createdAt = new Date("2026-11-03T10:00:00.000Z");
  return message;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { de: { translation: DE } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

describe("the actions an answer lists", () => {
  test("an action that left a card above is the card: its line is not listed again", () => {
    const actions: Array<AIChatToolAction> = [action({ widgetId: "W1" })];

    expect(getShownToolActions(actions, [card("W1")])).toEqual([]);
  });

  test("a failed, skipped or denied action is listed, whatever it names", () => {
    for (const status of [
      AIChatToolActionStatus.Failed,
      AIChatToolActionStatus.Skipped,
      AIChatToolActionStatus.Denied,
      AIChatToolActionStatus.Pending,
    ]) {
      const shown: Array<AIChatToolAction> = getShownToolActions(
        [action({ status, widgetId: "W1" })],
        [card("W1")],
      );

      expect(shown).toHaveLength(1);
    }
  });

  test("an action saved before it named its card, or naming one the answer does not hold, is listed", () => {
    expect(getShownToolActions([action()], [card("W1")])).toHaveLength(1);
    expect(
      getShownToolActions([action({ widgetId: "W2" })], [card("W1")]),
    ).toHaveLength(1);
  });

  test("a chart is no card of what an action made: an action that names one is listed", () => {
    const chart: AIChatWidget = {
      id: "W1",
      type: AIChatWidgetType.TimeSeriesChart,
      title: "p95",
      data: { series: [] },
    };

    expect(
      getShownToolActions([action({ widgetId: "W1" })], [chart]),
    ).toHaveLength(1);
  });

  test("under an answer, the card is drawn and the action's Executed line is not", () => {
    render(
      <ChatMessageList
        messages={[
          answer({
            widgets: [card("W1")],
            toolActions: [
              action({ widgetId: "W1" }),
              action({
                id: "call-2",
                title: "Resolve incident INC-42",
                status: AIChatToolActionStatus.Failed,
              }),
            ],
          }),
        ]}
        isSubmittingApproval={false}
        onRespondToApproval={(): void => {}}
      />,
    );

    expect(screen.getByTestId("ai-chat-resource-card")).toBeVisible();

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "tool-approval-history",
    );
    // Only the action that failed: it left no card to say what happened.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Resolve incident INC-42");
    expect(rows[0]).toHaveTextContent("Failed");
    expect(screen.queryByText("Executed")).not.toBeInTheDocument();
  });

  test("an answer whose only action left its card lists no actions at all", () => {
    const { container } = render(
      <ChatMessageList
        messages={[
          answer({
            widgets: [card("W1")],
            toolActions: [action({ widgetId: "W1" })],
          }),
        ]}
        isSubmittingApproval={false}
        onRespondToApproval={(): void => {}}
      />,
    );

    expect(
      screen.queryByTestId("tool-approval-history"),
    ).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("Acknowledge incident INC-42");
  });
});

describe("the approval card's line of arguments, in the reader's words", () => {
  const ARGUMENTS: JSONObject = {
    note: "Rolled back the deploy.",
    notifySubscribers: true,
    changes: [
      { filePath: "src/a.ts", content: "a" },
      { filePath: "src/b.ts", content: "b" },
      { filePath: "src/c.ts", content: "c" },
    ],
  };

  test("in German: each argument named in German, a list by how many it holds, yes in German", () => {
    const parts: Array<ActionArgumentPart> = getActionArgumentParts(
      ARGUMENTS,
      {},
      dashboardTranslator("de"),
    );

    expect(
      parts.map((part: ActionArgumentPart): [string, string, boolean] => {
        return [part.label, part.value, part.isWritten];
      }),
    ).toEqual([
      [DE["Note"], "Rolled back the deploy.", true],
      [DE["Notify subscribers"], DE["Yes"], false],
      [DE["Files"], "3", false],
    ]);
  });

  test("the card draws them, never the tool's keys or a list's JSON", async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("de");
    });

    render(
      <ToolApprovalCard
        toolActions={[
          action({
            toolName: "commit_code_to_branch",
            title: "Commit 3 files to fix/checkout",
            arguments: {
              branchName: "fix/checkout",
              commitMessage: "fix: checkout",
              changes: ARGUMENTS["changes"]!,
            },
            status: AIChatToolActionStatus.Pending,
          }),
        ]}
        interactive={true}
        isSubmitting={false}
        onRespond={(): void => {}}
      />,
    );

    const line: HTMLElement = screen.getByTestId("tool-approval-arguments");
    const labels: Array<string> = within(line)
      .getAllByTestId("tool-approval-argument-label")
      .map((label: HTMLElement): string => {
        return label.textContent || "";
      });

    expect(labels).toEqual([
      `${DE["Branch"]}:`,
      `${DE["Commit message"]}:`,
      `${DE["Files"]}:`,
    ]);
    expect(line).toHaveTextContent("fix/checkout");
    expect(line).not.toHaveTextContent("changes");
    expect(line).not.toHaveTextContent("filePath");
    expect(line).not.toHaveTextContent("branchName");

    await act(async (): Promise<void> => {
      await i18next.changeLanguage("en");
    });
  });

  test("a number is written the reader's way", () => {
    expect(
      getActionArgumentParts({ limit: 1234 }, {}, dashboardTranslator("de"))[0]!
        .value,
    ).toBe("1.234");
  });

  test("every label is worded in every Dashboard language", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      for (const label of Object.values(ACTION_ARGUMENT_LABELS)) {
        expect({
          language,
          label,
          worded: isWordedInDashboardLocale(label, language),
        }).toEqual({ language, label, worded: true });
      }
    }
  });
});
