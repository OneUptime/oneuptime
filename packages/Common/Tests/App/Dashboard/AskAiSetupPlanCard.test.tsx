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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import ToolApprovalCard, {
  SETUP_PLAN_END,
  ToolDecision,
  isSetupPlan,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ToolApprovalCard";
import AskAiTestPageOffer, {
  getAnswerTestPageOffer,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiTestPageOffer";
import {
  getPendingSetupActions,
  getSetupApprovedEvent,
  getSetupProposedEvent,
  getSetupTestPageSentEvent,
  takeNewSetupProposal,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiSetupEvents";
import {
  AI_ACTION_LINES,
  AI_ACTION_TITLES,
  aiActionSentence,
  describeAIActionWords,
} from "../../../Types/AI/AIActionWords";
import AIChatMessageStatus from "../../../Types/AI/AIChatMessageStatus";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
  AIChatWidget,
  AIChatWidgetType,
} from "../../../Types/AI/AIChatTypes";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * ASK AI SETS THINGS UP (issue #6829), AS THE PERSON SEES IT.
 *
 *   - One card for one plan: each part a line, each one Allow or Skip, and
 *     a plan made only of setup actions ends "Nothing else changes." - in
 *     the reader's language, and never under a plan mixed with any other
 *     action, which may change something else.
 *   - It ends with the test: under the answer, the test page of the policy
 *     it made, else one to yourself for a monitor you now own - never an
 *     id that is not one.
 *   - What people do with it is counted - the plan's parts, how many were
 *     approved and skipped, a test page sent - never what the parts name.
 */

const sentEvents: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ProductEvents", () => {
  return {
    __esModule: true,
    default: {
      send: (name: unknown, properties: unknown): void => {
        sentEvents(name, properties);
      },
    },
  };
});

// The test page's own button, which opens #6811's dialog: its props are what is read.
const testPageButtons: MockFunction = getJestMockFunction();

// What the dialog says became of the test page the button sent.
const ACKNOWLEDGED_TEST_PAGE: Record<string, string> = {
  status: "Acknowledged",
  acknowledgedByName: "Me Myself",
  statusMessage: "",
};
let nextTestPageResult: Record<string, string> = ACKNOWLEDGED_TEST_PAGE;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/SendTestPageButton",
  () => {
    return {
      __esModule: true,
      default: (props: {
        target: unknown;
        dataTestId?: string;
        onSent?: (id: string) => void;
        onResult?: (result: unknown) => void;
      }): React.ReactElement => {
        testPageButtons(props.target);
        return (
          <button
            type="button"
            data-testid={props.dataTestId}
            onClick={() => {
              props.onSent?.("execution-log-1");
              props.onResult?.(nextTestPageResult);
            }}
          >
            send
          </button>
        );
      },
    };
  },
);

const DE: Record<string, string> = readDashboardLocale("de");
const AR: Record<string, string> = readDashboardLocale("ar");
const POLICY_ID: string = "77777777-7777-4777-8777-777777777777";

function setupAction(
  id: string,
  toolName: string,
  status: AIChatToolActionStatus = AIChatToolActionStatus.Pending,
): AIChatToolAction {
  const title: ReturnType<typeof aiActionSentence> =
    toolName === "set_up_paging"
      ? aiActionSentence(AI_ACTION_TITLES.createOnCallPolicy, {
          policy: '"Default on-call policy"',
        })
      : aiActionSentence(AI_ACTION_TITLES.setUpWebsiteMonitoring, {
          address: "example.com",
        });
  const words: { title: typeof title; description: Array<typeof title> } = {
    title,
    description:
      toolName === "set_up_paging"
        ? [aiActionSentence(AI_ACTION_LINES.pagesYouForEveryNewEvent)]
        : [aiActionSentence(AI_ACTION_LINES.monitorOwnerEmailed)],
  };
  const english: { title: string; description?: string | undefined } =
    describeAIActionWords(words);

  return {
    id,
    toolName,
    title: english.title,
    description: english.description,
    words,
    arguments: {},
    isMutation: true,
    requiresApproval: true,
    status,
  };
}

const INCIDENT_ACTION: AIChatToolAction = {
  id: "call-incident",
  toolName: "create_incident",
  title: "Create incident: Checkout down",
  arguments: { title: "Checkout down" },
  isMutation: true,
  requiresApproval: true,
  status: AIChatToolActionStatus.Pending,
};

function card(widget: Partial<AIChatWidget["data"]>): AIChatWidget {
  return {
    id: "W1",
    type: AIChatWidgetType.ResourceCard,
    title: "Created",
    data: { heading: "x", ...widget },
  };
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { de: { translation: DE }, ar: { translation: AR } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterAll(async () => {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

afterEach(() => {
  cleanup();
  sentEvents.mockReset();
  testPageButtons.mockReset();
  nextTestPageResult = ACKNOWLEDGED_TEST_PAGE;
});

describe("a setup plan's approval card", () => {
  test("lists each part with its own Allow and Skip, and ends: nothing else changes", () => {
    const decided: Array<Array<ToolDecision>> = [];

    render(
      <ToolApprovalCard
        toolActions={[
          setupAction("call-monitor", "set_up_website_monitoring"),
          setupAction("call-paging", "set_up_paging"),
        ]}
        interactive={true}
        isSubmitting={false}
        onRespond={(decisions: Array<ToolDecision>) => {
          decided.push(decisions);
        }}
      />,
    );

    expect(screen.getAllByTestId("tool-approval-action")).toHaveLength(2);
    expect(screen.getAllByTestId("tool-approval-title")[0]).toHaveTextContent(
      "Set up monitoring for example.com",
    );
    expect(screen.getAllByTestId("tool-approval-title")[1]).toHaveTextContent(
      'Create on-call policy "Default on-call policy"',
    );
    expect(
      screen.getByTestId("tool-approval-setup-plan-end"),
    ).toHaveTextContent("Nothing else changes.");

    // Skip the paging, run the rest: one press decides the whole plan.
    const skips: Array<HTMLElement> = screen.getAllByRole("button", {
      name: "Skip",
    });
    fireEvent.click(skips[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Run 1 action" }));

    expect(decided).toEqual([
      [
        { toolCallId: "call-monitor", approved: true },
        { toolCallId: "call-paging", approved: false },
      ],
    ]);
  });

  test("a plan mixed with another action does not say nothing else changes", () => {
    render(
      <ToolApprovalCard
        toolActions={[
          setupAction("call-monitor", "set_up_website_monitoring"),
          INCIDENT_ACTION,
        ]}
        interactive={true}
        isSubmitting={false}
        onRespond={() => {}}
      />,
    );

    expect(screen.queryByTestId("tool-approval-setup-plan-end")).toBeNull();
  });

  test("once decided, the card keeps its rows and drops the line", () => {
    render(
      <ToolApprovalCard
        toolActions={[
          setupAction(
            "call-monitor",
            "set_up_website_monitoring",
            AIChatToolActionStatus.Executed,
          ),
        ]}
        interactive={false}
        isSubmitting={false}
        onRespond={() => {}}
      />,
    );

    expect(screen.getAllByTestId("tool-approval-history")).toHaveLength(1);
    expect(screen.queryByTestId("tool-approval-setup-plan-end")).toBeNull();
  });

  test("is said in the reader's language", async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("de");
    });

    render(
      <ToolApprovalCard
        toolActions={[setupAction("call-paging", "set_up_paging")]}
        interactive={true}
        isSubmitting={false}
        onRespond={() => {}}
      />,
    );

    expect(DE[SETUP_PLAN_END]).toBe("Sonst ändert sich nichts.");
    expect(
      screen.getByTestId("tool-approval-setup-plan-end"),
    ).toHaveTextContent("Sonst ändert sich nichts.");
    expect(screen.getByTestId("tool-approval-title")).toHaveTextContent(
      'Bereitschaftsrichtlinie "Default on-call policy" erstellen',
    );

    await act(async (): Promise<void> => {
      await i18next.changeLanguage("en");
    });
  });

  test("isSetupPlan: every waiting action a setup action, and at least one", () => {
    expect(isSetupPlan([])).toBe(false);
    expect(isSetupPlan([setupAction("a", "set_up_website_monitoring")])).toBe(
      true,
    );
    expect(
      isSetupPlan([
        setupAction("a", "publish_status_page"),
        setupAction("b", "add_monitors_to_status_page"),
      ]),
    ).toBe(true);
    expect(
      isSetupPlan([setupAction("a", "set_up_paging"), INCIDENT_ACTION]),
    ).toBe(false);
  });
});

describe("the test page an answer that set something up offers", () => {
  test("is the policy's when a policy was made, else one to yourself", () => {
    expect(
      getAnswerTestPageOffer([
        card({ testPage: { kind: "self" } }),
        card({
          testPage: {
            kind: "policy",
            policyId: POLICY_ID,
            policyName: "Default on-call policy",
          },
        }),
      ]),
    ).toEqual({
      kind: "policy",
      policyId: POLICY_ID,
      policyName: "Default on-call policy",
    });
    expect(
      getAnswerTestPageOffer([card({ testPage: { kind: "self" } })]),
    ).toEqual({ kind: "self" });
  });

  test("is never a policy id that is not one, nor anything a card did not offer", () => {
    expect(
      getAnswerTestPageOffer([
        card({ testPage: { kind: "policy", policyId: "javascript:alert(1)" } }),
      ]),
    ).toBeNull();
    expect(
      getAnswerTestPageOffer([
        card({ testPage: { kind: "member" } as never }),
        card({}),
        {
          id: "W2",
          type: AIChatWidgetType.Table,
          title: "t",
          data: { testPage: { kind: "self" } },
        },
      ]),
    ).toBeNull();
  });

  test("draws the test page's own button, says how it went, and counts it sent", () => {
    render(
      <AskAiTestPageOffer
        widgets={[
          card({
            testPage: {
              kind: "policy",
              policyId: POLICY_ID,
              policyName: "Default on-call policy",
            },
          }),
        ]}
      />,
    );

    expect(testPageButtons).toHaveBeenCalledWith({
      kind: "policy",
      policyId: POLICY_ID,
      policyName: "Default on-call policy",
    });

    fireEvent.click(screen.getByTestId("ask-ai-send-test-page"));

    expect(sentEvents).toHaveBeenCalledWith(
      ProductEventName.AskAiSetupTestPageSent,
      { target: "policy" },
    );
    expect(screen.getByTestId("ask-ai-test-page-result")).toHaveTextContent(
      "It works",
    );
    expect(screen.getByTestId("ask-ai-test-page-result")).toHaveTextContent(
      "Me Myself acknowledged it.",
    );
  });

  /*
   * A run that failed says why in the words of the error that stopped it:
   * the server's own line, with no code. On a page read right to left it
   * is set apart, as the test page's own result sets it (#7182), so its
   * number keeps its "+" in front and its full stop at its end - after
   * the headline in the reader's words.
   */
  test("on an Arabic page, a failed run's own error reads left to right after the headline", async () => {
    const error: string =
      "Twilio error 20003: authentication failed while calling +15550100.";

    nextTestPageResult = { status: "Failed", statusMessage: error };

    await act(async (): Promise<void> => {
      await i18next.changeLanguage("ar");
    });

    try {
      render(
        <AskAiTestPageOffer
          widgets={[
            card({
              testPage: {
                kind: "policy",
                policyId: POLICY_ID,
                policyName: "Default on-call policy",
              },
            }),
          ]}
        />,
      );

      fireEvent.click(screen.getByTestId("ask-ai-send-test-page"));

      const line: HTMLElement = screen.getByTestId("ask-ai-test-page-result");
      const isolates: Array<Element> = Array.from(line.querySelectorAll("bdi"));

      expect(AR["The test could not run"]).toBeTruthy();
      expect(line).toHaveTextContent(AR["The test could not run"]!);
      expect(isolates).toHaveLength(1);
      expect(isolates[0]).toHaveAttribute("dir", "ltr");
      expect(isolates[0]!.textContent).toBe(error);
    } finally {
      await act(async (): Promise<void> => {
        await i18next.changeLanguage("en");
      });
    }
  });

  test("draws nothing when no card offers one", () => {
    const { container } = render(
      <AskAiTestPageOffer widgets={[card({ heading: "INC-1" })]} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(testPageButtons).not.toHaveBeenCalled();
  });
});

describe("what is counted, never what the parts name", () => {
  test("a plan waiting on its card: its parts in the order they run, how many, and the mode", () => {
    expect(
      getSetupProposedEvent({
        message: {
          status: AIChatMessageStatus.WaitingForApproval,
          toolActions: [
            setupAction("a", "publish_status_page"),
            setupAction("b", "set_up_website_monitoring"),
            setupAction("c", "set_up_paging"),
            INCIDENT_ACTION,
          ],
        },
        permissionMode: "AskForApproval",
      }),
    ).toEqual({
      parts: "paging.website_monitor.status_page",
      part_count: 3,
      permission_mode: "AskForApproval",
    });
  });

  test("nothing is counted for a message not waiting, or waiting on no setup action", () => {
    expect(
      getSetupProposedEvent({
        message: {
          status: AIChatMessageStatus.Completed,
          toolActions: [setupAction("a", "set_up_paging")],
        },
        permissionMode: "AutoRun",
      }),
    ).toBeNull();
    expect(
      getSetupProposedEvent({
        message: {
          status: AIChatMessageStatus.WaitingForApproval,
          toolActions: [INCIDENT_ACTION],
        },
        permissionMode: "AskForApproval",
      }),
    ).toBeNull();
    expect(
      getPendingSetupActions({
        status: AIChatMessageStatus.WaitingForApproval,
        toolActions: [
          setupAction("a", "set_up_paging", AIChatToolActionStatus.Executed),
        ],
      }),
    ).toEqual([]);
  });

  test("a plan is counted once per answer, however many polls bring it back", () => {
    const seen: Set<string> = new Set<string>();
    const waiting: (id: string) => {
      id: string;
      status: AIChatMessageStatus;
      toolActions: Array<AIChatToolAction>;
    } = (id: string) => {
      return {
        id: id,
        status: AIChatMessageStatus.WaitingForApproval,
        toolActions: [setupAction(`${id}-paging`, "set_up_paging")],
      };
    };

    // The first poll that brings the answer counts its plan.
    expect(
      takeNewSetupProposal({
        message: waiting("answer-1"),
        seen: seen,
        permissionMode: "AutoRun",
      }),
    ).toEqual({ parts: "paging", part_count: 1, permission_mode: "AutoRun" });

    // Every poll after brings the same answer back: never counted again.
    expect(
      takeNewSetupProposal({
        message: waiting("answer-1"),
        seen: seen,
        permissionMode: "AutoRun",
      }),
    ).toBeNull();

    // Another answer's plan is its own.
    expect(
      takeNewSetupProposal({
        message: waiting("answer-2"),
        seen: seen,
        permissionMode: "AutoRun",
      }),
    ).toEqual({ parts: "paging", part_count: 1, permission_mode: "AutoRun" });

    /*
     * An answer still being written, waiting on nothing, is not counted -
     * nor remembered, so its plan counts once it waits on its card.
     */
    expect(
      takeNewSetupProposal({
        message: {
          id: "answer-3",
          status: AIChatMessageStatus.InProgress,
          toolActions: [],
        },
        seen: seen,
        permissionMode: "AutoRun",
      }),
    ).toBeNull();
    expect(
      takeNewSetupProposal({
        message: waiting("answer-3"),
        seen: seen,
        permissionMode: "AutoRun",
      }),
    ).toEqual({ parts: "paging", part_count: 1, permission_mode: "AutoRun" });

    // A message the poll could not name is never counted.
    expect(
      takeNewSetupProposal({
        message: { ...waiting(""), id: undefined },
        seen: seen,
        permissionMode: "AutoRun",
      }),
    ).toBeNull();
  });

  test("the card answered: the parts approved, how many approved and skipped, other actions left out", () => {
    expect(
      getSetupApprovedEvent({
        toolActions: [
          setupAction("a", "set_up_website_monitoring"),
          setupAction("b", "set_up_paging"),
          INCIDENT_ACTION,
        ],
        decisions: [
          { toolCallId: "a", approved: true },
          { toolCallId: "b", approved: false },
          { toolCallId: "call-incident", approved: true },
        ],
      }),
    ).toEqual({
      parts: "website_monitor",
      approved_count: 1,
      skipped_count: 1,
    });
    expect(
      getSetupApprovedEvent({
        toolActions: [INCIDENT_ACTION],
        decisions: [{ toolCallId: "call-incident", approved: true }],
      }),
    ).toBeNull();
    expect(getSetupTestPageSentEvent({ kind: "self" })).toEqual({
      target: "self",
    });
  });
});
