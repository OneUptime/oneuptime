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

/*
 * The AI card as one line, inside the incident and alert pages' one AI card
 * (InvestigationPanel): it folds when OneUptime AI did not investigate the
 * record for a reason the project chose AND the page's Remediation card
 * says fixing did nothing for one either; it stays whole whenever either
 * part did something, or could not for a reason that needs someone to
 * look. Folded, the line is the card's header, the conversation it closes
 * with is folded into the line's Ask OneUptime AI while it is empty, and
 * the project's switches are read so the line says what is on now.
 */

const postMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return postMock(...args);
      },
      getFriendlyMessage: (): string => {
        return "Request failed";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "33333333-3333-4333-8333-333333333333" };
      },
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
    },
  };
});

import InvestigationPanel, {
  InvestigationConversationSlot,
  InvestigationSubjectType,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationPanel";
import {
  AiCardFold,
  RemediationFoldState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiOffSummaryData";
import { AI_INVESTIGATION_PANEL_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AIInvestigationStatus";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import InvestigationNotStartedReason, {
  InvestigationNotStartedCode,
} from "../../../Types/AI/InvestigationNotStartedReason";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";
import { goTo } from "./SideMenuHarness";

const PROJECT_ID: string = "33333333-3333-4333-8333-333333333333";
const SUBJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const NEXT_SUBJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const EVALUATED_AT: string = "2026-09-14T18:01:20.000Z";

const FIXING_OFF: RemediationFoldState = { kind: "off", reason: "fixing_off" };

function reasonFor(
  code: InvestigationNotStartedCode,
): InvestigationNotStartedReason {
  return {
    code,
    title: `Server title for ${code}`,
    description: `Server description for ${code}.`,
    nextStep: `Server next step for ${code}.`,
    source: "recorded",
    evaluatedAt: EVALUATED_AT,
  };
}

function noRun(code: InvestigationNotStartedCode): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    {
      run: null,
      events: [],
      notInvestigatedReason: reasonFor(code) as unknown as JSONObject,
      analysisMarkdown: null,
      isAnalysisPending: false,
    },
    {},
  );
}

function queuedRun(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    {
      run: {
        _id: "44444444-4444-4444-8444-444444444444",
        status: AIRunStatus.Queued,
        toolCallCount: 0,
        totalTokens: 0,
      },
      events: [],
      analysisMarkdown: null,
      isAnalysisPending: false,
    },
    {},
  );
}

function waiting(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    {
      run: null,
      notInvestigatedReason: null,
      waitingInvestigation: {
        waitUntil: "2026-09-14T18:28:00.000Z",
        waitMinutes: 10,
        canStartNow: true,
      },
      events: [],
      analysisMarkdown: null,
      isAnalysisPending: false,
    },
    {},
  );
}

/*
 * The conversation the page hands the card, as a stand-in: what the card
 * tells it (the slot), a box whose text is its own state - so a test can
 * see the card keep the same conversation when it unfolds - and a way for
 * a test to say the thread has something in it.
 */
const slots: Array<InvestigationConversationSlot> = [];

function ConversationStub(props: {
  slot: InvestigationConversationSlot;
}): React.ReactElement {
  const [typed, setTyped] = React.useState<string>("");
  slots.push(props.slot);

  if (props.slot.fold && props.slot.fold.askRequest === 0) {
    return (
      <button
        type="button"
        data-testid="stub-thread-has-content"
        onClick={() => {
          props.slot.fold?.onHasContentChange(true);
        }}
      >
        (hidden conversation)
      </button>
    );
  }

  return (
    <section data-testid="stub-conversation">
      <textarea
        aria-label="Stub question"
        value={typed}
        onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
          setTyped(event.target.value);
        }}
      />
    </section>
  );
}

function lastSlot(): InvestigationConversationSlot {
  return slots[slots.length - 1]!;
}

async function flush(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let index: number = 0; index < 6; index++) {
      await Promise.resolve();
    }
  });
}

async function advance(milliseconds: number): Promise<void> {
  await act(async (): Promise<void> => {
    jest.advanceTimersByTime(milliseconds);
    for (let index: number = 0; index < 6; index++) {
      await Promise.resolve();
    }
  });
}

interface Rendered {
  onFold: MockFunction;
  rerender: (data: {
    remediationState?: RemediationFoldState | undefined;
    subjectId?: ObjectID;
  }) => void;
}

function renderPanel(data: {
  subjectType?: InvestigationSubjectType;
  remediationState?: RemediationFoldState | undefined;
  withConversation?: boolean;
}): Rendered {
  const onFold: MockFunction = getJestMockFunction();
  const subjectType: InvestigationSubjectType = data.subjectType || "incident";

  const element: (props: {
    remediationState?: RemediationFoldState | undefined;
    subjectId: ObjectID;
  }) => React.ReactElement = (props: {
    remediationState?: RemediationFoldState | undefined;
    subjectId: ObjectID;
  }): React.ReactElement => {
    return (
      <InvestigationPanel
        subjectType={subjectType}
        subjectId={props.subjectId}
        remediationState={props.remediationState}
        onCardFoldChange={onFold as unknown as (fold: AiCardFold) => void}
        renderConversation={
          data.withConversation === false
            ? undefined
            : (slot: InvestigationConversationSlot) => {
                return <ConversationStub slot={slot} />;
              }
        }
      />
    );
  };

  const view: ReturnType<typeof render> = render(
    element({
      remediationState: data.remediationState,
      subjectId: SUBJECT_ID,
    }),
  );

  return {
    onFold,
    rerender: (next: {
      remediationState?: RemediationFoldState | undefined;
      subjectId?: ObjectID;
    }): void => {
      view.rerender(
        element({
          remediationState: next.remediationState,
          subjectId: next.subjectId || SUBJECT_ID,
        }),
      );
    },
  };
}

function lastFold(onFold: MockFunction): AiCardFold {
  return onFold.mock.calls[onFold.mock.calls.length - 1]![0] as AiCardFold;
}

function region(): HTMLElement {
  return screen.getByRole("region", { name: "AI Investigation" });
}

function isAiOn(value: boolean): void {
  jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue({
    enableAi: value,
  } as unknown as Project);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-09-14T18:20:00.000Z"));
  goTo(`/dashboard/${PROJECT_ID}/incidents`);
  postMock.mockReset();
  getItemMock.mockReset();
  getItemMock.mockResolvedValue(null);
  slots.length = 0;
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectOwner]);
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  isAiOn(true);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe.each<[InvestigationSubjectType]>([["incident"], ["alert"]])(
  "the %s's AI card as one line",
  (subjectType: InvestigationSubjectType) => {
    const noun: string = subjectType;

    test.each<[InvestigationNotStartedCode, string]>([
      [
        "automatic_investigation_disabled",
        `“Investigate new ${noun}s” was off when this ${noun} was created.`,
      ],
      [
        "ai_disabled",
        `AI was off for this project when this ${noun} was created.`,
      ],
      [
        "no_investigation_rule_matched",
        `This ${noun} matched none of the AI rules that investigate.`,
      ],
      [
        "severity_below_threshold",
        `This ${noun}'s severity was below the minimum for AI investigation.`,
      ],
    ])(
      "%s with fixing off: one line, the card's only header",
      async (code: InvestigationNotStartedCode, reason: string) => {
        postMock.mockResolvedValue(noRun(code));
        const { onFold } = renderPanel({
          subjectType,
          remediationState: FIXING_OFF,
        });
        await flush();

        // Still the card's one region, where the page's AI links land.
        expect(region()).toHaveAttribute("id", AI_INVESTIGATION_PANEL_ID);
        expect(region()).toHaveAttribute("aria-busy", "false");
        expect(
          within(region()).getByTestId("ai-off-summary"),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("heading", {
            level: 2,
            name: "AI investigation is off",
          }),
        ).toBeVisible();
        expect(screen.getByTestId("ai-off-summary-reason")).toHaveTextContent(
          reason,
        );

        // No header of its own: no title, no pill, no description.
        expect(
          screen.queryByRole("heading", { name: "AI Investigation" }),
        ).toBeNull();
        expect(screen.queryByLabelText("Investigation status")).toBeNull();
        expect(screen.queryByTestId("card-header")).toBeNull();
        expect(screen.getAllByTestId("card")).toHaveLength(1);
        // The full card's explanation is folded away with it.
        expect(screen.queryByTestId("investigation-not-started")).toBeNull();
        expect(screen.queryByText(`Server title for ${code}`)).toBeNull();

        expect(lastFold(onFold)).toBe("folded");
      },
    );

    test("nothing recorded about fixing folds it too", async () => {
      postMock.mockResolvedValue(noRun("automatic_investigation_disabled"));
      const { onFold } = renderPanel({
        subjectType,
        remediationState: { kind: "off", reason: "not_recorded" },
      });
      await flush();

      expect(screen.getByTestId("ai-off-summary")).toBeVisible();
      expect(lastFold(onFold)).toBe("folded");
    });

    test("while the Remediation card is still reading, the card checks rather than draw one and then the other", async () => {
      postMock.mockResolvedValue(noRun("automatic_investigation_disabled"));
      const { onFold, rerender } = renderPanel({
        subjectType,
        remediationState: { kind: "loading" },
      });
      await flush();

      expect(region()).toHaveAttribute("aria-busy", "true");
      expect(screen.getByText("Checking investigation status…")).toBeVisible();
      expect(screen.queryByTestId("ai-off-summary")).toBeNull();
      expect(lastFold(onFold)).toBe("checking");
      // The conversation waits for the card to know, as it does while checking.
      expect(lastSlot().investigationStage).toBe("checking");

      rerender({ remediationState: FIXING_OFF });
      await flush();

      expect(screen.getByTestId("ai-off-summary")).toBeVisible();
      expect(lastFold(onFold)).toBe("folded");
    });

    test("fixing did something: the card stays whole, as it was", async () => {
      postMock.mockResolvedValue(noRun("automatic_investigation_disabled"));
      const { onFold } = renderPanel({
        subjectType,
        remediationState: { kind: "on" },
      });
      await flush();

      expect(screen.queryByTestId("ai-off-summary")).toBeNull();
      expect(
        screen.getByRole("heading", { level: 2, name: "AI Investigation" }),
      ).toBeVisible();
      expect(screen.getByLabelText("Investigation status")).toHaveTextContent(
        "Not investigated",
      );
      expect(
        screen.getByText("Server title for automatic_investigation_disabled"),
      ).toBeVisible();
      expect(lastFold(onFold)).toBe("full");
      expect(lastSlot().fold).toBeUndefined();
    });

    test("a page that does not say what fixing did never folds the card", async () => {
      postMock.mockResolvedValue(noRun("automatic_investigation_disabled"));
      const { onFold } = renderPanel({ subjectType });
      await flush();

      expect(screen.queryByTestId("ai-off-summary")).toBeNull();
      expect(
        screen.getByRole("heading", { level: 2, name: "AI Investigation" }),
      ).toBeVisible();
      expect(lastFold(onFold)).toBe("full");
    });

    test.each<[InvestigationNotStartedCode]>([
      ["provider_missing"],
      ["insufficient_ai_balance"],
      ["project_daily_limit_reached"],
      ["monitor_cooldown"],
      ["created_resolved"],
      ["resolved_before_investigation"],
      ["daily_budget_exhausted"],
      ["eligibility_check_failed"],
      ["no_run_recorded"],
    ])(
      "%s keeps the card whole, fixing off or not",
      async (code: InvestigationNotStartedCode) => {
        postMock.mockResolvedValue(noRun(code));
        const { onFold } = renderPanel({
          subjectType,
          remediationState: FIXING_OFF,
        });
        await flush();

        expect(screen.queryByTestId("ai-off-summary")).toBeNull();
        expect(screen.getByText(`Server title for ${code}`)).toBeVisible();
        expect(lastFold(onFold)).toBe("full");
      },
    );

    test("a run, or an AI rule's wait, keeps the card whole", async () => {
      postMock.mockResolvedValue(queuedRun());
      const queued: Rendered = renderPanel({
        subjectType,
        remediationState: FIXING_OFF,
      });
      await flush();

      expect(screen.queryByTestId("ai-off-summary")).toBeNull();
      expect(screen.getByLabelText("Investigation status")).toHaveTextContent(
        "Queued",
      );
      expect(lastFold(queued.onFold)).toBe("full");

      cleanup();
      postMock.mockReset();
      postMock.mockResolvedValue(waiting());
      const waited: Rendered = renderPanel({
        subjectType,
        remediationState: FIXING_OFF,
      });
      await flush();

      expect(screen.queryByTestId("ai-off-summary")).toBeNull();
      expect(screen.getByLabelText("Investigation status")).toHaveTextContent(
        "Waiting",
      );
      expect(lastFold(waited.onFold)).toBe("full");
    });

    test("opens to what can be done, and closes again", async () => {
      postMock.mockResolvedValue(noRun("automatic_investigation_disabled"));
      renderPanel({ subjectType, remediationState: FIXING_OFF });
      await flush();

      const toggle: HTMLElement = screen.getByRole("button", {
        name: "What you can do",
      });

      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByTestId("ai-off-summary-steps")).not.toBeVisible();

      fireEvent.click(toggle);

      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByTestId("ai-off-summary-steps")).toBeVisible();
      expect(
        screen.getByText(`Turn on “Investigate new ${noun}s”.`),
      ).toBeVisible();
      expect(
        screen.getByText(`Turn on “Fix new ${noun}s automatically”.`),
      ).toBeVisible();

      fireEvent.click(toggle);

      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByTestId("ai-off-summary-steps")).not.toBeVisible();
    });

    test("reads the record's switches as they are now, once, and says what is on now", async () => {
      postMock.mockResolvedValue(noRun("automatic_investigation_disabled"));
      getItemMock.mockResolvedValue(
        Object.assign(new Project(), {
          enableAutomaticIncidentInvestigation: true,
          enableAutomaticIncidentRemediation: false,
          enableAutomaticAlertInvestigation: true,
          enableAutomaticAlertRemediation: false,
        }),
      );
      renderPanel({ subjectType, remediationState: FIXING_OFF });
      await flush();
      await flush();

      expect(getItemMock).toHaveBeenCalledTimes(1);

      const request: {
        modelType: unknown;
        id: ObjectID;
        select: JSONObject;
      } = getItemMock.mock.calls[0]![0] as {
        modelType: unknown;
        id: ObjectID;
        select: JSONObject;
      };

      expect(request.modelType).toBe(Project);
      expect(request.id.toString()).toBe(PROJECT_ID);
      // Only the record's own two switches.
      expect(request.select).toEqual(
        subjectType === "incident"
          ? {
              enableAutomaticIncidentInvestigation: true,
              enableAutomaticIncidentRemediation: true,
            }
          : {
              enableAutomaticAlertInvestigation: true,
              enableAutomaticAlertRemediation: true,
            },
      );

      fireEvent.click(screen.getByRole("button", { name: "What you can do" }));

      expect(
        screen.getByText(`“Investigate new ${noun}s” is on now.`),
      ).toBeVisible();
      expect(
        screen.getByText(`Turn on “Fix new ${noun}s automatically”.`),
      ).toBeVisible();

      // Settled polls do not read them again.
      await advance(30_000);
      await advance(30_000);

      expect(getItemMock).toHaveBeenCalledTimes(1);
    });

    test("a whole card never reads them", async () => {
      postMock.mockResolvedValue(noRun("automatic_investigation_disabled"));
      renderPanel({ subjectType, remediationState: { kind: "on" } });
      await flush();
      await flush();

      expect(getItemMock).not.toHaveBeenCalled();
    });

    test("switches that cannot be read leave the steps worded as ones to turn on", async () => {
      postMock.mockResolvedValue(noRun("automatic_investigation_disabled"));
      getItemMock.mockRejectedValue(new Error("Permission denied"));
      renderPanel({ subjectType, remediationState: FIXING_OFF });
      await flush();
      await flush();

      fireEvent.click(screen.getByRole("button", { name: "What you can do" }));

      expect(
        screen.getByText(`Turn on “Investigate new ${noun}s”.`),
      ).toBeVisible();
      expect(screen.queryByText(/is on now/)).toBeNull();
    });
  },
);

describe("Ask OneUptime AI on the folded line", () => {
  test("the empty conversation is folded into the line's Ask OneUptime AI, which opens it", async () => {
    postMock.mockResolvedValue(noRun("automatic_investigation_disabled"));
    renderPanel({ remediationState: FIXING_OFF });
    await flush();

    expect(lastSlot().fold).toEqual({
      askRequest: 0,
      onHasContentChange: expect.any(Function),
    });
    expect(screen.queryByTestId("stub-conversation")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Ask OneUptime AI" }));

    expect(lastSlot().fold?.askRequest).toBe(1);
    expect(screen.getByTestId("stub-conversation")).toBeVisible();
    // Once the conversation is on screen the line stops offering it.
    expect(
      screen.queryByRole("button", { name: "Ask OneUptime AI" }),
    ).toBeNull();
  });

  test("a conversation with something in it is on screen by itself, so the line does not offer it", async () => {
    postMock.mockResolvedValue(noRun("automatic_investigation_disabled"));
    renderPanel({ remediationState: FIXING_OFF });
    await flush();

    expect(
      screen.getByRole("button", { name: "Ask OneUptime AI" }),
    ).toBeVisible();

    fireEvent.click(screen.getByTestId("stub-thread-has-content"));

    expect(
      screen.queryByRole("button", { name: "Ask OneUptime AI" }),
    ).toBeNull();
  });

  test("with AI off for the project there is nothing to ask: no Ask, and the line says AI is off", async () => {
    isAiOn(false);
    postMock.mockResolvedValue(noRun("ai_disabled"));
    renderPanel({ remediationState: { kind: "off", reason: "ai_off" } });
    await flush();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "AI is off for this project",
      }),
    ).toBeVisible();
    expect(screen.getByTestId("ai-off-summary-reason")).toHaveTextContent(
      "OneUptime AI did not investigate or fix this incident.",
    );
    expect(
      screen.queryByRole("button", { name: "Ask OneUptime AI" }),
    ).toBeNull();
  });

  test("a page that hands no conversation gets no Ask", async () => {
    postMock.mockResolvedValue(noRun("automatic_investigation_disabled"));
    renderPanel({ remediationState: FIXING_OFF, withConversation: false });
    await flush();

    expect(screen.getByTestId("ai-off-summary")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Ask OneUptime AI" }),
    ).toBeNull();
  });
});

describe("the folded card follows what changes", () => {
  test("a run that appears later unfolds it, keeping the conversation and what was typed", async () => {
    postMock
      .mockResolvedValueOnce(noRun("automatic_investigation_disabled"))
      .mockResolvedValue(queuedRun());
    const { onFold } = renderPanel({ remediationState: FIXING_OFF });
    await flush();

    expect(lastFold(onFold)).toBe("folded");

    fireEvent.click(screen.getByRole("button", { name: "Ask OneUptime AI" }));
    fireEvent.change(screen.getByLabelText("Stub question"), {
      target: { value: "What changed?" },
    });

    // The settled poll finds the run someone started.
    await advance(30_000);

    expect(screen.queryByTestId("ai-off-summary")).toBeNull();
    expect(screen.getByLabelText("Investigation status")).toHaveTextContent(
      "Queued",
    );
    expect(lastFold(onFold)).toBe("full");
    // The same conversation, in the same place: its text survived.
    expect(screen.getByLabelText("Stub question")).toHaveValue("What changed?");
  });

  test("fixing that does something later unfolds it", async () => {
    postMock.mockResolvedValue(noRun("automatic_investigation_disabled"));
    const { onFold, rerender } = renderPanel({ remediationState: FIXING_OFF });
    await flush();

    expect(lastFold(onFold)).toBe("folded");

    rerender({ remediationState: { kind: "on" } });
    await flush();

    expect(screen.queryByTestId("ai-off-summary")).toBeNull();
    expect(
      screen.getByRole("heading", { level: 2, name: "AI Investigation" }),
    ).toBeVisible();
    expect(lastFold(onFold)).toBe("full");
  });

  test("the next record starts folded shut, with nothing asked", async () => {
    postMock.mockResolvedValue(noRun("automatic_investigation_disabled"));
    const { onFold, rerender } = renderPanel({ remediationState: FIXING_OFF });
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "What you can do" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask OneUptime AI" }));

    expect(screen.getByTestId("ai-off-summary-steps")).toBeVisible();

    rerender({ remediationState: FIXING_OFF, subjectId: NEXT_SUBJECT_ID });
    await flush();

    expect(screen.getByTestId("ai-off-summary")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "What you can do" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(lastSlot().fold?.askRequest).toBe(0);
    expect(
      screen.getByRole("button", { name: "Ask OneUptime AI" }),
    ).toBeVisible();
    expect(lastFold(onFold)).toBe("folded");
    // It asked about the new record.
    const lastRequest: { data: JSONObject } = postMock.mock.calls[
      postMock.mock.calls.length - 1
    ]![0] as { data: JSONObject };
    expect(lastRequest.data).toEqual({
      incidentId: NEXT_SUBJECT_ID.toString(),
    });
  });

  test("an answer that cannot be loaded is never folded", async () => {
    postMock.mockRejectedValue(new Error("offline"));
    const { onFold } = renderPanel({ remediationState: FIXING_OFF });
    await flush();

    expect(screen.queryByTestId("ai-off-summary")).toBeNull();
    expect(screen.getByLabelText("Investigation status")).toHaveTextContent(
      "Unable to check",
    );
    expect(lastFold(onFold)).toBe("full");
  });
});
