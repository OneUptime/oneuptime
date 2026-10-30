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
 * record for a reason the project chose AND the card's own Remediation step
 * says fixing did nothing for one either; it stays whole whenever either
 * step did something, or could not for a reason that needs someone to
 * look. Folded, the line is the card's header, the conversation it closes
 * with is folded into the line's Ask OneUptime AI while it is empty, and
 * the project's switches are read so the line says what is on now - read
 * while the card may still fold, and folded only once they are, so the
 * line is drawn once, in its final words.
 *
 * The Remediation step is a stand-in (RemediationStepStub) that says what a
 * test sets, and records how the card told it it is drawn.
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep",
  () => {
    return jest.requireActual("./RemediationStepStub");
  },
);

import InvestigationPanel, {
  InvestigationConversationSlot,
  InvestigationSubjectType,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationPanel";
import { RemediationFoldState } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiOffSummaryData";
import {
  lastAiCardFold,
  lastRemediationStepProps,
  resetRemediationStepStub,
  setRemediationStepReads,
} from "./RemediationStepStub";
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
  rerender: (data: {
    remediationState?: RemediationFoldState | undefined;
    subjectId?: ObjectID;
  }) => void;
}

/*
 * The card, with its Remediation step saying what fixing did for the
 * record (remediationState) - or, left out, not having read it yet.
 */
function renderPanel(data: {
  subjectType?: InvestigationSubjectType;
  remediationState?: RemediationFoldState | undefined;
  withConversation?: boolean;
}): Rendered {
  const subjectType: InvestigationSubjectType = data.subjectType || "incident";

  const element: (props: {
    subjectId: ObjectID;
  }) => React.ReactElement = (props: {
    subjectId: ObjectID;
  }): React.ReactElement => {
    return (
      <InvestigationPanel
        subjectType={subjectType}
        subjectId={props.subjectId}
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

  setRemediationStepReads(data.remediationState || null);
  const view: ReturnType<typeof render> = render(
    element({ subjectId: SUBJECT_ID }),
  );

  return {
    rerender: (next: {
      remediationState?: RemediationFoldState | undefined;
      subjectId?: ObjectID;
    }): void => {
      setRemediationStepReads(next.remediationState || null);
      view.rerender(element({ subjectId: next.subjectId || SUBJECT_ID }));
    },
  };
}

function region(): HTMLElement {
  return screen.getByRole("region", { name: "OneUptime AI" });
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
  resetRemediationStepStub();
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

    /*
     * AI was off for the project then and is on now: with the record's
     * switch not known to be off, nothing is left to do to investigate the
     * next one, so the line says it was off.
     */
    test.each<[InvestigationNotStartedCode, string, string]>([
      [
        "automatic_investigation_disabled",
        "AI investigation is off",
        `“Investigate new ${noun}s” was off when this ${noun} was created.`,
      ],
      [
        "ai_disabled",
        "AI investigation was off",
        `AI was off for this project when this ${noun} was created.`,
      ],
      [
        "no_investigation_rule_matched",
        "AI investigation is off",
        `This ${noun} matched none of the AI rules that investigate.`,
      ],
      [
        "severity_below_threshold",
        "AI investigation is off",
        `This ${noun}'s severity was below the minimum for AI investigation.`,
      ],
    ])(
      "%s with fixing off: one line, the card's only header",
      async (
        code: InvestigationNotStartedCode,
        title: string,
        reason: string,
      ) => {
        postMock.mockResolvedValue(noRun(code));
        renderPanel({
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
            name: title,
          }),
        ).toBeVisible();
        expect(screen.getByTestId("ai-off-summary-reason")).toHaveTextContent(
          reason,
        );

        // No header of its own: no title, no pill, no description.
        expect(
          screen.queryByRole("heading", { name: "OneUptime AI" }),
        ).toBeNull();
        expect(screen.queryByLabelText("Investigation status")).toBeNull();
        expect(screen.queryByTestId("card-header")).toBeNull();
        expect(screen.getAllByTestId("card")).toHaveLength(1);
        // The full card's explanation is folded away with it.
        expect(screen.queryByTestId("investigation-not-started")).toBeNull();
        expect(screen.queryByText(`Server title for ${code}`)).toBeNull();

        expect(lastAiCardFold()).toBe("folded");
      },
    );

    test("nothing recorded about fixing folds it too", async () => {
      postMock.mockResolvedValue(noRun("automatic_investigation_disabled"));
      renderPanel({
        subjectType,
        remediationState: { kind: "off", reason: "not_recorded" },
      });
      await flush();

      expect(screen.getByTestId("ai-off-summary")).toBeVisible();
      expect(lastAiCardFold()).toBe("folded");
    });

    test("while the Remediation step is still reading, the card checks rather than draw one and then the other", async () => {
      postMock.mockResolvedValue(noRun("automatic_investigation_disabled"));
      const { rerender } = renderPanel({
        subjectType,
        remediationState: { kind: "loading" },
      });
      await flush();

      expect(region()).toHaveAttribute("aria-busy", "true");
      expect(screen.getByText("Checking investigation status…")).toBeVisible();
      expect(screen.queryByTestId("ai-off-summary")).toBeNull();
      expect(lastAiCardFold()).toBe("checking");
      // The conversation waits for the card to know, as it does while checking.
      expect(lastSlot().investigationStage).toBe("checking");

      rerender({ remediationState: FIXING_OFF });
      await flush();

      expect(screen.getByTestId("ai-off-summary")).toBeVisible();
      expect(lastAiCardFold()).toBe("folded");
    });

    test("fixing did something: the card stays whole, as it was", async () => {
      postMock.mockResolvedValue(noRun("automatic_investigation_disabled"));
      renderPanel({
        subjectType,
        remediationState: { kind: "on" },
      });
      await flush();

      expect(screen.queryByTestId("ai-off-summary")).toBeNull();
      expect(
        screen.getByRole("heading", { level: 2, name: "OneUptime AI" }),
      ).toBeVisible();
      expect(screen.getByLabelText("Investigation status")).toHaveTextContent(
        "Not investigated",
      );
      expect(
        screen.getByText("Server title for automatic_investigation_disabled"),
      ).toBeVisible();
      expect(lastAiCardFold()).toBe("full");
      expect(lastSlot().fold).toBeUndefined();
    });

    /*
     * The step is the card's own now, and says what fixing did for every
     * record: until it has, the card never folds on a guess - it checks.
     */
    test("until its Remediation step says what fixing did, the card never folds", async () => {
      postMock.mockResolvedValue(noRun("automatic_investigation_disabled"));
      renderPanel({ subjectType });
      await flush();
      await advance(30_000);

      expect(screen.queryByTestId("ai-off-summary")).toBeNull();
      expect(region()).toHaveAttribute("aria-busy", "true");
      expect(lastAiCardFold()).toBe("checking");
    });

    test("the step is told the record and how far the investigation got", async () => {
      postMock.mockResolvedValue(noRun("automatic_investigation_disabled"));
      renderPanel({ subjectType, remediationState: { kind: "on" } });
      await flush();

      const props: ReturnType<typeof lastRemediationStepProps> =
        lastRemediationStepProps();
      expect(
        (subjectType === "incident"
          ? props.incidentId
          : props.alertId
        )?.toString(),
      ).toBe(SUBJECT_ID.toString());
      expect(
        subjectType === "incident" ? props.alertId : props.incidentId,
      ).toBeUndefined();
      expect(props.investigationStage).toBe("none");
      expect(props.codeFix?.isRecommended).toBe(false);
      expect(screen.getByTestId("remediation-step")).toBeVisible();
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
        renderPanel({
          subjectType,
          remediationState: FIXING_OFF,
        });
        await flush();

        expect(screen.queryByTestId("ai-off-summary")).toBeNull();
        expect(screen.getByText(`Server title for ${code}`)).toBeVisible();
        expect(lastAiCardFold()).toBe("full");
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
      expect(lastAiCardFold()).toBe("full");
      // A card that cannot fold never reads the switches.
      expect(getItemMock).not.toHaveBeenCalled();

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
      expect(lastAiCardFold()).toBe("full");
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

    test("waits for the switches, then draws the line once, in its final words", async () => {
      let answer: (project: Project) => void = (): void => {};
      getItemMock.mockImplementationOnce((): Promise<Project> => {
        return new Promise<Project>((resolve: (project: Project) => void) => {
          answer = resolve;
        });
      });
      postMock.mockResolvedValue(noRun("automatic_investigation_disabled"));
      renderPanel({
        subjectType,
        remediationState: FIXING_OFF,
      });
      await flush();

      // Still checking: no line yet that would say "is off" and then "was off".
      expect(getItemMock).toHaveBeenCalledTimes(1);
      expect(region()).toHaveAttribute("aria-busy", "true");
      expect(screen.queryByTestId("ai-off-summary")).toBeNull();
      expect(lastAiCardFold()).toBe("checking");

      answer(
        Object.assign(new Project(), {
          enableAutomaticIncidentInvestigation: true,
          enableAutomaticIncidentRemediation: true,
          enableAutomaticAlertInvestigation: true,
          enableAutomaticAlertRemediation: true,
        }),
      );
      await flush();

      expect(
        screen.getByRole("heading", {
          level: 2,
          name: "AI investigation was off",
        }),
      ).toBeVisible();
      expect(screen.getByTestId("ai-off-summary-reason")).toHaveTextContent(
        `“Investigate new ${noun}s” was off when this ${noun} was created.`,
      );
      expect(lastAiCardFold()).toBe("folded");
      // The card never drew the present tense over steps that are done.
      expect(screen.queryByText("AI investigation is off")).toBeNull();
    });

    test("reads the switches beside the Remediation step's own read", async () => {
      postMock.mockResolvedValue(noRun("automatic_investigation_disabled"));
      renderPanel({ subjectType, remediationState: { kind: "loading" } });
      await flush();
      await flush();

      expect(getItemMock).toHaveBeenCalledTimes(1);
    });

    /*
     * They are read beside the step's own first read, so the line is never
     * held up by them; once the step says fixing did something, the card
     * stays whole and never reads them again.
     */
    test("a card its step keeps whole reads them no more than once, and draws no line", async () => {
      postMock.mockResolvedValue(noRun("automatic_investigation_disabled"));
      renderPanel({ subjectType, remediationState: { kind: "on" } });
      await flush();
      await flush();

      expect(getItemMock.mock.calls.length).toBeLessThanOrEqual(1);
      const reads: number = getItemMock.mock.calls.length;

      await advance(30_000);
      await advance(30_000);

      expect(getItemMock).toHaveBeenCalledTimes(reads);
      expect(screen.queryByTestId("ai-off-summary")).toBeNull();
      expect(lastAiCardFold()).toBe("full");
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
    renderPanel({ remediationState: FIXING_OFF });
    await flush();

    expect(lastAiCardFold()).toBe("folded");

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
    expect(lastAiCardFold()).toBe("full");
    // The same conversation, in the same place: its text survived.
    expect(screen.getByLabelText("Stub question")).toHaveValue("What changed?");
  });

  test("fixing that does something later unfolds it", async () => {
    postMock.mockResolvedValue(noRun("automatic_investigation_disabled"));
    const { rerender } = renderPanel({ remediationState: FIXING_OFF });
    await flush();

    expect(lastAiCardFold()).toBe("folded");

    rerender({ remediationState: { kind: "on" } });
    await flush();

    expect(screen.queryByTestId("ai-off-summary")).toBeNull();
    expect(
      screen.getByRole("heading", { level: 2, name: "OneUptime AI" }),
    ).toBeVisible();
    expect(lastAiCardFold()).toBe("full");
  });

  test("the next record starts folded shut, with nothing asked", async () => {
    postMock.mockResolvedValue(noRun("automatic_investigation_disabled"));
    const { rerender } = renderPanel({ remediationState: FIXING_OFF });
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
    expect(lastAiCardFold()).toBe("folded");
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
    renderPanel({ remediationState: FIXING_OFF });
    await flush();

    expect(screen.queryByTestId("ai-off-summary")).toBeNull();
    expect(screen.getByLabelText("Investigation status")).toHaveTextContent(
      "Unable to check",
    );
    expect(lastAiCardFold()).toBe("full");
  });
});
