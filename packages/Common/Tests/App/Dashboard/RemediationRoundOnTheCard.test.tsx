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

// The reasoning's Markdown, as one element the suite can find.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "markdown" },
        props.text,
      );
    },
  };
});

import RemediationStep from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep";
import { formatAiRunTime } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiRunFailureWords";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import {
  AIRunAttemptOutcome,
  AIRunFailureKind,
} from "../../../Types/AI/AIRunAttempt";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  REMEDIATION_ROUND_PATH,
  REMEDIATION_ROUND_TRY_AGAIN_PATH,
  REMEDIATION_ROUND_TRY_AGAIN_REFUSALS,
  RemediationRoundTryAgainRefusal,
} from "../../../Types/AutoRemediation/RemediationRound";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { APP_API_URL } from "../../../UI/Config";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * A ROUND OF AN AI FIX, ON THE AI CARD'S REMEDIATION STEP (issues #6436,
 * #6487).
 *
 * "We have things like no safe fix found, but it doesn't tell me anything
 * about why? Why wasn't the safe fix found? What did you do to remediate
 * that you found no safe fix? If no safe fix was found - did you ask for an
 * approval? What fix wasn't safe? What commands did you run to find a fix
 * that wasn't safe."
 *
 * The step reads each fix's round (POST /auto-remediation/round) and says
 * what it did: a round that stopped says so - never "Found no safe fix" -
 * with why, what to do and Try again for whoever may; a round that found
 * none says why in the AI's words, the fixes it ruled out with why not
 * and the commands they would run, the commands it checked with and how
 * each went, and that no fix ran and nobody was asked to approve one.
 */

const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-3333-4aaa-8bbb-000000000071",
);
const CLUSTER_ID: string = "0193c0de-4444-4aaa-8bbb-000000000075";
const FIX_ID: string = "0193c0de-6666-4aaa-8bbb-000000000072";
const RUN_ID: string = "0193c0de-7777-4aaa-8bbb-000000000073";
const NEW_RUN_ID: string = "0193c0de-7777-4aaa-8bbb-000000000074";

const AT_STARTED: string = "2026-11-09T10:00:00.000Z";
const AT_ENDED: string = "2026-11-09T10:06:00.000Z";

const ROUND_URL: string = URL.fromString(
  APP_API_URL.toString() + REMEDIATION_ROUND_PATH,
).toString();
const TRY_AGAIN_URL: string = URL.fromString(
  APP_API_URL.toString() + REMEDIATION_ROUND_TRY_AGAIN_PATH,
).toString();

const SWEEP_NOTE: string =
  "The AI fix did not finish — the planning run failed. Nothing was run or proposed.";

function kubectlFix(
  status: AutoRemediationSuggestionStatus,
  extra: Partial<JSONObject> = {},
): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: FIX_ID,
    status,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    ruleNameSnapshot: 'AI remediation for cluster "prod-east"',
    kubernetesClusterId: new ObjectID(CLUSTER_ID),
    aiRunId: new ObjectID(RUN_ID),
    rationaleMarkdown: SWEEP_NOTE,
    createdAt: new Date(AT_STARTED),
    ...extra,
  });
}

function runbookPick(
  status: AutoRemediationSuggestionStatus,
  extra: Partial<JSONObject> = {},
): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: FIX_ID,
    status,
    suggestionType: AutoRemediationSuggestionType.Runbook,
    ruleNameSnapshot: "OneUptime AI",
    aiRunId: new ObjectID(RUN_ID),
    createdAt: new Date(AT_STARTED),
    ...extra,
  });
}

function dateJson(value: string): JSONObject {
  return { _type: "DateTime", value };
}

function eventJson(
  sequence: number,
  eventType: AIRunEventType,
  resultSummary: JSONObject = {},
): JSONObject {
  return {
    _id: `0193c0de-8888-4aaa-8bbb-0000000001${String(sequence).padStart(2, "0")}`,
    sequence,
    eventType,
    resultSummary,
    createdAt: dateJson(AT_STARTED),
  };
}

// A run that gave up after three attempts: the provider kept timing out.
function timedOutEvents(): Array<JSONObject> {
  return [
    eventJson(1, AIRunEventType.RunStarted),
    eventJson(2, AIRunEventType.RunStarted),
    eventJson(3, AIRunEventType.RunStarted),
    eventJson(4, AIRunEventType.RunFailed, {
      attemptEnd: {
        outcome: AIRunAttemptOutcome.GaveUp,
        failureKind: AIRunFailureKind.ProviderTimeout,
        attempt: 3,
        maxAttempts: 3,
        timeoutInSeconds: 120,
      },
      errorMessage: "OpenAICompatible API request timed out after 120000 ms",
    }),
  ];
}

function roundJson(data: {
  runStatus: AIRunStatus;
  runId?: string;
  // When its run was created: a round tried again started later.
  createdAt?: string;
  events?: Array<JSONObject>;
  checks?: Array<JSONObject>;
  otherCheckCount?: number;
  explanation?: JSONObject | null;
  appliedSteps?: JSONObject;
  mayTryAgain?: boolean;
  errorMessage?: string;
}): JSONObject {
  const isOver: boolean = [
    AIRunStatus.Completed,
    AIRunStatus.NoFixFound,
    AIRunStatus.Error,
    AIRunStatus.Cancelled,
    AIRunStatus.Stale,
  ].includes(data.runStatus);

  return {
    run: {
      _id: data.runId || RUN_ID,
      status: data.runStatus,
      createdAt: dateJson(data.createdAt || AT_STARTED),
      startedAt: dateJson(data.createdAt || AT_STARTED),
      ...(isOver ? { completedAt: dateJson(AT_ENDED) } : {}),
      ...(data.errorMessage ? { errorMessage: data.errorMessage } : {}),
    },
    events: data.events || [],
    checks: data.checks || [],
    otherCheckCount: data.otherCheckCount || 0,
    explanation: data.explanation === undefined ? null : data.explanation,
    appliedSteps: data.appliedSteps || {
      commandCount: 0,
      changeCount: 0,
      isRunbookStarted: false,
    },
    mayTryAgain: Boolean(data.mayTryAgain),
  };
}

function unfinishedRound(mayTryAgain: boolean): JSONObject {
  return roundJson({
    runStatus: AIRunStatus.Error,
    events: timedOutEvents(),
    errorMessage: "OpenAICompatible API request timed out after 120000 ms",
    checks: [
      {
        command: "kubectl get pods -n web",
        why: "See which pods are failing.",
        status: "ran",
        at: AT_STARTED,
        error: "",
      },
    ],
    mayTryAgain,
  });
}

let served: Array<AutoRemediationSuggestion> = [];
// The round the server answers, and how it answers Try again.
let roundServed: JSONObject | HTTPErrorResponse | null = null;
let tryAgainServed: () => HTTPResponse<JSONObject> | HTTPErrorResponse = () => {
  return new HTTPResponse<JSONObject>(200, { runId: NEW_RUN_ID }, {});
};
let postSpy: ReturnType<typeof jest.spyOn>;

interface Posted {
  url: string;
  data: JSONObject;
}

function posted(): Array<Posted> {
  return postSpy.mock.calls.map((call: Array<unknown>): Posted => {
    const request: { url: { toString: () => string }; data: JSONObject } =
      call[0] as { url: { toString: () => string }; data: JSONObject };

    return { url: request.url.toString(), data: request.data };
  });
}

function postsTo(url: string): Array<Posted> {
  return posted().filter((post: Posted): boolean => {
    return post.url === url;
  });
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID.toString()}`);
  served = [];
  roundServed = null;
  tryAgainServed = () => {
    return new HTTPResponse<JSONObject>(200, { runId: NEW_RUN_ID }, {});
  };
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (data: {
    modelType: unknown;
  }): Promise<ListResult<AutoRemediationSuggestion>> => {
    // The step reads its decisions beside its fixes: none here.
    if (data.modelType !== AutoRemediationSuggestion) {
      return { data: [], count: 0, skip: 0, limit: 5 };
    }

    return { data: served, count: served.length, skip: 0, limit: 10 };
  }) as never);
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  postSpy = jest.spyOn(API, "post").mockImplementation((async (request: {
    url: { toString: () => string };
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
    const url: string = request.url.toString();

    if (url === ROUND_URL) {
      if (roundServed instanceof HTTPErrorResponse) {
        return roundServed;
      }

      return roundServed
        ? new HTTPResponse<JSONObject>(200, roundServed, {})
        : new HTTPErrorResponse(404, { message: "Not found" }, {});
    }

    if (url === TRY_AGAIN_URL) {
      return tryAgainServed();
    }

    return new HTTPErrorResponse(404, { message: "Not found" }, {});
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderStep(
  fixes: Array<AutoRemediationSuggestion>,
): Promise<HTMLElement> {
  served = fixes;
  await act(async () => {
    render(
      <RemediationStep
        investigationStage="reported"
        incidentId={INCIDENT_ID}
      />,
    );
  });

  await screen.findAllByTestId("remediation-fix");

  // The round is read once the fixes are: let its answer land.
  await act(async () => {
    await Promise.resolve();
  });

  return screen.getAllByTestId("remediation-fix")[0]!;
}

function theFix(): HTMLElement {
  return screen.getAllByTestId("remediation-fix")[0]!;
}

function planStep(): HTMLElement {
  const step: HTMLElement | undefined = within(theFix())
    .getAllByTestId("remediation-fix-step")
    .find((element: HTMLElement): boolean => {
      return element.getAttribute("data-step") === "plan";
    });

  if (!step) {
    throw new Error("The fix has no plan step.");
  }

  return step;
}

function planTitle(): string {
  return (
    within(planStep()).getByTestId("remediation-fix-step-title").textContent ||
    ""
  );
}

function planSummary(): string {
  return (
    within(planStep()).queryByTestId("remediation-fix-step-summary")
      ?.textContent || ""
  );
}

function openPlan(): HTMLElement {
  fireEvent.click(
    within(planStep()).getByTestId("remediation-fix-step-toggle"),
  );

  return within(planStep()).getByTestId("remediation-fix-step-details");
}

describe("a fix whose round stopped before it found one", () => {
  test("says it stopped and why - never that it found no safe fix - on its plan step, the step's first sentence and its pill", async () => {
    roundServed = unfinishedRound(true);
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.NoneApplicable),
    ]);

    await waitFor(() => {
      expect(planTitle()).toBe("Stopped before it found a fix");
    });
    expect(planStep()).toHaveAttribute("data-tone", "failed");
    expect(planSummary()).toBe(
      "The LLM provider did not answer within 120 seconds.",
    );
    /*
     * Its one step says it under its name: no fact beside the name says it
     * again (issue #6860). The step opens with it in a sentence, and its
     * pill says it too.
     */
    expect(within(theFix()).queryByTestId("remediation-fix-status")).toBeNull();
    expect(screen.getByTestId("remediation-step-summary")).toHaveTextContent(
      "OneUptime AI stopped before it found a fix for this incident, so nothing was changed.",
    );
    expect(screen.getByTestId("remediation-step-summary")).toHaveAttribute(
      "data-summary",
      "stopped",
    );
    expect(
      screen.getByTestId("ai-card-step-remediation-status"),
    ).toHaveTextContent("Did not finish");
    expect(screen.queryByText("Found no safe fix")).toBeNull();
    expect(screen.queryByText("No fix found")).toBeNull();
    expect(screen.queryByText(/found no fix/)).toBeNull();
  });

  test("opens to why it stopped, how often it tried, what to do, Try again, and that nothing ran or was asked", async () => {
    roundServed = unfinishedRound(true);
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.NoneApplicable),
    ]);
    await waitFor(() => {
      expect(planTitle()).toBe("Stopped before it found a fix");
    });

    const details: HTMLElement = openPlan();
    const notice: HTMLElement = within(details).getByTestId(
      "remediation-round-failure",
    );

    expect(within(notice).getByText("Why it stopped")).toBeInTheDocument();
    expect(notice).toHaveTextContent(
      "The LLM provider did not answer within 120 seconds.",
    );
    expect(notice).toHaveTextContent("OneUptime tried 3 times.");
    expect(notice).toHaveTextContent(
      "raise the provider's Response Timeout in Project Settings > AI > LLM Providers",
    );
    expect(
      within(notice).getByRole("button", { name: "Try again" }),
    ).toBeVisible();

    // The notice starts with the step's summary: the open step says it once.
    expect(planSummary()).toBe("");
    expect(
      within(planStep()).getAllByText(
        "The LLM provider did not answer within 120 seconds.",
        { exact: false },
      ),
    ).toHaveLength(1);

    /*
     * Nothing ran and nobody was asked - in so many words: the step's
     * title already says it stopped before it found a fix.
     */
    expect(
      within(details).getByTestId("remediation-round-approval").textContent,
    ).toBe("No fix ran, and nobody was asked to approve one.");
    expect(
      within(planStep()).getAllByText(/stopped before it found a fix/i),
    ).toHaveLength(1);

    // What it checked before it stopped.
    expect(
      within(details).getByTestId("remediation-round-check-command"),
    ).toHaveTextContent("kubectl get pods -n web");

    // The sweep's note says less than the notice: it gives way.
    expect(within(details).queryByTestId("markdown")).toBeNull();
    expect(details).not.toHaveTextContent(SWEEP_NOTE);
  });

  test("Try again starts the round again: it asks the server for this fix, reads the fixes again, and the step works on it", async () => {
    roundServed = unfinishedRound(true);
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.NoneApplicable),
    ]);
    await waitFor(() => {
      expect(planTitle()).toBe("Stopped before it found a fix");
    });
    const details: HTMLElement = openPlan();
    const listReads: number = (ModelAPI.getList as unknown as jest.Mock).mock
      .calls.length;

    tryAgainServed = () => {
      // The round, as the server left it: named a new run, being worked out.
      served = [
        kubectlFix(AutoRemediationSuggestionStatus.Planning, {
          aiRunId: new ObjectID(NEW_RUN_ID),
          rationaleMarkdown: undefined,
        }),
      ];
      roundServed = roundJson({
        runStatus: AIRunStatus.Queued,
        runId: NEW_RUN_ID,
      });
      return new HTTPResponse<JSONObject>(200, { runId: NEW_RUN_ID }, {});
    };

    await act(async () => {
      fireEvent.click(
        within(details).getByRole("button", { name: "Try again" }),
      );
    });

    expect(postsTo(TRY_AGAIN_URL)).toEqual([
      { url: TRY_AGAIN_URL, data: { suggestionId: FIX_ID } },
    ]);
    expect(
      (ModelAPI.getList as unknown as jest.Mock).mock.calls.length,
    ).toBeGreaterThan(listReads);

    await waitFor(() => {
      expect(planTitle()).toBe("Working out a fix…");
    });
    expect(planStep()).toHaveAttribute("data-tone", "live");
    expect(screen.queryByTestId("remediation-round-failure")).toBeNull();
    // Its new round is read, for the new run.
    await waitFor(() => {
      expect(postsTo(ROUND_URL).length).toBeGreaterThanOrEqual(2);
    });
  });

  test("a refusal is said under the button, in the server's words, and the round is read again", async () => {
    roundServed = unfinishedRound(true);
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.NoneApplicable),
    ]);
    await waitFor(() => {
      expect(planTitle()).toBe("Stopped before it found a fix");
    });
    const details: HTMLElement = openPlan();
    const refusal: string =
      REMEDIATION_ROUND_TRY_AGAIN_REFUSALS[
        RemediationRoundTryAgainRefusal.AlreadyStarted
      ];
    tryAgainServed = () => {
      return new HTTPErrorResponse(400, { message: refusal }, {});
    };
    const roundReads: number = postsTo(ROUND_URL).length;

    await act(async () => {
      fireEvent.click(
        within(details).getByRole("button", { name: "Try again" }),
      );
    });

    expect(
      await screen.findByTestId("remediation-round-failure-try-again-error"),
    ).toHaveTextContent(refusal);
    expect(postsTo(ROUND_URL).length).toBeGreaterThan(roundReads);
    // Still stopped: nothing started.
    expect(planTitle()).toBe("Stopped before it found a fix");
  });

  test("a press that could not reach the server says what stopped it", async () => {
    roundServed = unfinishedRound(true);
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.NoneApplicable),
    ]);
    await waitFor(() => {
      expect(planTitle()).toBe("Stopped before it found a fix");
    });
    const details: HTMLElement = openPlan();
    tryAgainServed = () => {
      throw "network down";
    };

    await act(async () => {
      fireEvent.click(
        within(details).getByRole("button", { name: "Try again" }),
      );
    });

    expect(
      await screen.findByTestId("remediation-round-failure-try-again-error"),
    ).toHaveTextContent("network down");
  });

  test("who may not try it again reads why it stopped, and gets no Try again", async () => {
    roundServed = unfinishedRound(false);
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.NoneApplicable),
    ]);
    await waitFor(() => {
      expect(planTitle()).toBe("Stopped before it found a fix");
    });
    expect(within(theFix()).queryByRole("button", { name: "Try again" })).toBe(
      null,
    );

    const details: HTMLElement = openPlan();

    expect(
      within(details).getByTestId("remediation-round-failure"),
    ).toHaveTextContent("OneUptime tried 3 times.");
    expect(within(details).queryByRole("button", { name: "Try again" })).toBe(
      null,
    );
  });

  /*
   * Try again is what to do about a round that stopped: it is in sight
   * under the folded step, and in the notice the step opens to - one at a
   * time, never two.
   */
  test("Try again is in sight under the folded step, and in its notice once it opens", async () => {
    roundServed = unfinishedRound(true);
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.NoneApplicable),
    ]);
    await waitFor(() => {
      expect(planTitle()).toBe("Stopped before it found a fix");
    });

    expect(
      within(planStep()).getByTestId("remediation-round-try-again"),
    ).toHaveTextContent("Try again");
    expect(
      within(theFix()).getAllByRole("button", { name: "Try again" }),
    ).toHaveLength(1);

    const details: HTMLElement = openPlan();

    expect(
      within(planStep()).queryByTestId("remediation-round-try-again"),
    ).toBeNull();
    expect(
      within(theFix()).getAllByRole("button", { name: "Try again" }),
    ).toHaveLength(1);
    expect(
      within(
        within(details).getByTestId("remediation-round-failure"),
      ).getByRole("button", { name: "Try again" }),
    ).toBeVisible();
  });

  test("the folded Try again starts it again; the keyboard goes to the step that works on it, timed from its new start", async () => {
    const AT_TRIED_AGAIN: string = "2026-11-09T10:30:00.000Z";
    roundServed = unfinishedRound(true);
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.NoneApplicable),
    ]);
    await waitFor(() => {
      expect(planTitle()).toBe("Stopped before it found a fix");
    });
    tryAgainServed = () => {
      served = [
        kubectlFix(AutoRemediationSuggestionStatus.Planning, {
          aiRunId: new ObjectID(NEW_RUN_ID),
          rationaleMarkdown: undefined,
        }),
      ];
      roundServed = roundJson({
        runStatus: AIRunStatus.Queued,
        runId: NEW_RUN_ID,
        createdAt: AT_TRIED_AGAIN,
      });
      return new HTTPResponse<JSONObject>(200, { runId: NEW_RUN_ID }, {});
    };
    const button: HTMLElement = within(planStep()).getByTestId(
      "remediation-round-try-again",
    );
    button.focus();

    await act(async () => {
      fireEvent.click(button);
    });

    expect(postsTo(TRY_AGAIN_URL)).toEqual([
      { url: TRY_AGAIN_URL, data: { suggestionId: FIX_ID } },
    ]);
    await waitFor(() => {
      expect(planTitle()).toBe("Working out a fix…");
    });
    /*
     * The button went with the step that offered it: the keyboard is on
     * the step's title, not the top of the page.
     */
    expect(document.activeElement).not.toBe(document.body);
    expect(planStep()).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).toHaveTextContent("Working out a fix…");
    // When it started again - never when the fix was first worked out.
    await waitFor(() => {
      expect(
        within(planStep()).getByTestId("remediation-fix-step-time"),
      ).toHaveAttribute("dateTime", AT_TRIED_AGAIN);
    });
  });

  test("negative control: a reader who moved on keeps their place", async () => {
    roundServed = unfinishedRound(true);
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.NoneApplicable),
    ]);
    await waitFor(() => {
      expect(planTitle()).toBe("Stopped before it found a fix");
    });
    tryAgainServed = () => {
      served = [
        kubectlFix(AutoRemediationSuggestionStatus.Planning, {
          aiRunId: new ObjectID(NEW_RUN_ID),
          rationaleMarkdown: undefined,
        }),
      ];
      roundServed = roundJson({
        runStatus: AIRunStatus.Queued,
        runId: NEW_RUN_ID,
      });
      return new HTTPResponse<JSONObject>(200, { runId: NEW_RUN_ID }, {});
    };
    const elsewhere: HTMLButtonElement = document.createElement("button");
    document.body.appendChild(elsewhere);

    try {
      await act(async () => {
        fireEvent.click(
          within(planStep()).getByTestId("remediation-round-try-again"),
        );
        elsewhere.focus();
      });
      await waitFor(() => {
        expect(planTitle()).toBe("Working out a fix…");
      });

      expect(document.activeElement).toBe(elsewhere);
    } finally {
      elsewhere.remove();
    }
  });

  test("a runbook pick that stopped says it stopped before it picked a runbook", async () => {
    roundServed = roundJson({
      runStatus: AIRunStatus.Stale,
      events: [eventJson(1, AIRunEventType.RunStarted)],
      mayTryAgain: true,
    });
    await renderStep([
      runbookPick(AutoRemediationSuggestionStatus.NoneApplicable, {
        rationaleMarkdown:
          "AI planning did not produce a proposal — the planning run stopped responding. No runbook was proposed; you can still start one manually from the Runbooks card.",
      }),
    ]);

    await waitFor(() => {
      expect(planTitle()).toBe("Stopped before it picked a runbook");
    });

    const details: HTMLElement = openPlan();

    expect(
      within(details).getByTestId("remediation-round-approval").textContent,
    ).toBe("No runbook ran, and nobody was asked to approve one.");
  });

  test("a round still marked as being worked out, whose run is over, stopped too", async () => {
    roundServed = unfinishedRound(true);
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.Planning, {
        rationaleMarkdown: undefined,
      }),
    ]);

    await waitFor(() => {
      expect(planTitle()).toBe("Stopped before it found a fix");
    });
    expect(
      screen.getByTestId("ai-card-step-remediation-status"),
    ).toHaveTextContent("Did not finish");
  });
});

describe("a fix whose round found none", () => {
  function foundNoneRound(): JSONObject {
    return roundJson({
      runStatus: AIRunStatus.Completed,
      events: [
        eventJson(1, AIRunEventType.RunStarted),
        eventJson(2, AIRunEventType.RunCompleted),
      ],
      explanation: {
        reason:
          "The web pods are OOM-killed: their 512Mi limit is below their steady use, and raising it changes the Deployment.",
        ruledOutFixes: [
          {
            fix: "Raise the memory limit of deployment web to 1Gi",
            commands: [
              "kubectl set resources deployment web -n web --limits=memory=1Gi",
            ],
            whyNot:
              "Not allowed here: it changes the Deployment, which only a person may approve on this cluster.",
          },
          {
            fix: "Restart the web pods",
            commands: [],
            whyNot: "Would not fix the cause: they run out of memory again.",
          },
        ],
      },
      checks: [
        {
          command: "kubectl get pods -n web",
          why: "See which pods are failing.",
          status: "ran",
          at: AT_STARTED,
          error: "",
        },
        {
          command: "kubectl top pods -n web",
          why: "",
          status: "failed",
          at: AT_STARTED,
          error: "error: Metrics API not available",
        },
        {
          command: "kubectl describe deployment web -n web",
          why: "",
          status: "unknown",
          at: AT_STARTED,
          error: "kubectl result unknown: its result never came back.",
        },
      ],
      otherCheckCount: 3,
    });
  }

  test("says why in the AI's words on its plan step", async () => {
    roundServed = foundNoneRound();
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.NoneApplicable, {
        rationaleMarkdown: "A longer answer about the memory limits.",
      }),
    ]);

    await waitFor(() => {
      expect(planSummary()).toBe(
        "The web pods are OOM-killed: their 512Mi limit is below their steady use, and raising it changes the Deployment.",
      );
    });
    expect(planTitle()).toBe("Found no safe fix");
    expect(
      screen.getByTestId("ai-card-step-remediation-status"),
    ).toHaveTextContent("No fix found");
  });

  test("opens to the fixes it ruled out, the commands it checked with and how each went, and that nobody was asked", async () => {
    roundServed = foundNoneRound();
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.NoneApplicable, {
        rationaleMarkdown: "A longer answer about the memory limits.",
      }),
    ]);
    await waitFor(() => {
      expect(planSummary()).toBe(
        "The web pods are OOM-killed: their 512Mi limit is below their steady use, and raising it changes the Deployment.",
      );
    });

    const details: HTMLElement = openPlan();

    /*
     * Why, as the AI said it: the open step leaves its summary out, so its
     * details say it first, whole, in its own direction.
     */
    expect(planSummary()).toBe("");
    const reason: HTMLElement = within(details).getByTestId(
      "remediation-round-reason",
    );
    expect(reason).toHaveTextContent(
      "The web pods are OOM-killed: their 512Mi limit is below their steady use, and raising it changes the Deployment.",
    );
    expect(reason).toHaveAttribute("dir", "auto");
    const lead: HTMLElement = within(details).getByTestId(
      "remediation-round-lead",
    );
    expect(details.firstElementChild).toBe(lead);
    expect(lead.firstElementChild).toBe(reason);

    /*
     * The answer first, then how the round got there: the fixes it ruled
     * out, what it checked, and that nobody was asked.
     */
    expect(
      Array.from(details.children).map((child: Element): string | null => {
        return child.getAttribute("data-testid");
      }),
    ).toEqual([
      "remediation-round-lead",
      "remediation-round-ruled-out",
      "remediation-round-checks",
      "remediation-round-approval",
    ]);

    // The fixes it ruled out: what, why not, and the commands it would run.
    const fixes: Array<HTMLElement> = within(details).getAllByTestId(
      "remediation-round-ruled-out-fix",
    );
    expect(fixes).toHaveLength(2);
    expect(
      within(fixes[0]!).getByTestId("remediation-round-ruled-out-what"),
    ).toHaveTextContent("Raise the memory limit of deployment web to 1Gi");
    expect(
      within(fixes[0]!).getByTestId("remediation-round-ruled-out-why"),
    ).toHaveTextContent(
      "Not allowed here: it changes the Deployment, which only a person may approve on this cluster.",
    );
    const command: HTMLElement = within(fixes[0]!).getByTestId(
      "remediation-round-ruled-out-command",
    );
    expect(command).toHaveTextContent(
      "kubectl set resources deployment web -n web --limits=memory=1Gi",
    );
    expect(command).toHaveAttribute("dir", "ltr");
    expect(
      within(fixes[1]!).queryByTestId("remediation-round-ruled-out-command"),
    ).toBeNull();
    // The AI's words read their own way on a right-to-left page.
    expect(
      within(fixes[0]!).getByTestId("remediation-round-ruled-out-what"),
    ).toHaveAttribute("dir", "auto");
    expect(
      within(fixes[0]!).getByTestId("remediation-round-ruled-out-why"),
    ).toHaveAttribute("dir", "auto");
    // Headings under the card step's own (an h3).
    expect(
      within(details).getByRole("heading", {
        level: 4,
        name: "Fixes it ruled out",
      }),
    ).toBeInTheDocument();

    // What it checked, in order, each with how it went.
    const checks: Array<HTMLElement> = within(details).getAllByTestId(
      "remediation-round-check",
    );
    expect(
      checks.map((check: HTMLElement): [string | null, string | null] => {
        return [
          check.getAttribute("data-status"),
          within(check)
            .getByTestId("remediation-round-check-mark")
            .getAttribute("aria-label"),
        ];
      }),
    ).toEqual([
      ["ran", "Ran"],
      ["failed", "Failed"],
      ["unknown", "Result unknown"],
    ]);
    expect(
      within(checks[0]!).getByTestId("remediation-round-check-command"),
    ).toHaveAttribute("dir", "ltr");
    expect(
      within(checks[0]!).getByTestId("remediation-round-check-why"),
    ).toHaveTextContent("See which pods are failing.");
    expect(
      within(checks[0]!).getByTestId("remediation-round-check-why"),
    ).toHaveAttribute("dir", "auto");
    expect(
      within(checks[1]!).getByTestId("remediation-round-check-error"),
    ).toHaveTextContent("error: Metrics API not available");
    /*
     * When it ran, to the second, in its command's line; the full moment
     * under the pointer.
     */
    const time: HTMLElement = within(checks[0]!).getByTestId(
      "remediation-round-check-time",
    );
    expect(time).toHaveAttribute("dateTime", AT_STARTED);
    expect(time.textContent).toMatch(/\d:\d\d:\d\d/);
    expect(time.getAttribute("title")).toMatch(/\d:\d\d:\d\d/);
    expect(time.previousElementSibling).toBe(
      within(checks[0]!).getByTestId("remediation-round-check-command"),
    );
    expect(
      within(details).getByRole("heading", {
        level: 4,
        name: "What it checked",
      }),
    ).toBeInTheDocument();
    expect(
      within(details).getByTestId("remediation-round-other-checks"),
    ).toHaveTextContent("It also queried the project's telemetry 3 times.");

    // Nobody was asked: it proposed nothing.
    expect(
      within(details).getByTestId("remediation-round-approval"),
    ).toHaveTextContent(
      "No fix ran, and nobody was asked to approve one: OneUptime AI asks for approval only when it proposes a fix.",
    );

    /*
     * Its whole answer says the why again, at length: folded under the
     * reason, one press away - never a second copy of it at the bottom.
     */
    expect(within(details).queryByTestId("markdown")).toBeNull();
    const toggle: HTMLElement = within(lead).getByTestId(
      "remediation-round-reasoning-toggle",
    );
    expect(toggle).toHaveTextContent("Show full reasoning");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).not.toHaveAttribute("aria-controls");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent("Show less");
    const answer: HTMLElement = within(lead).getByTestId("markdown");
    expect(answer).toHaveTextContent(
      "A longer answer about the memory limits.",
    );
    expect(
      document.getElementById(toggle.getAttribute("aria-controls") || ""),
    ).toContainElement(answer);

    fireEvent.click(toggle);

    expect(within(details).queryByTestId("markdown")).toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    // It finished: nothing to try again.
    expect(within(details).queryByTestId("remediation-round-failure")).toBe(
      null,
    );
    expect(within(details).queryByRole("button", { name: "Try again" })).toBe(
      null,
    );
  });

  test("an answer that says no more than its reason is not offered again", async () => {
    roundServed = roundJson({
      runStatus: AIRunStatus.Completed,
      explanation: {
        reason: "The pods are healthy; nothing to change.",
        ruledOutFixes: [],
      },
    });
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.NoneApplicable, {
        rationaleMarkdown: "The pods are healthy;\nnothing to change.\n",
      }),
    ]);
    await waitFor(() => {
      expect(planSummary()).toBe("The pods are healthy; nothing to change.");
    });

    const details: HTMLElement = openPlan();

    expect(
      within(details).getByTestId("remediation-round-reason"),
    ).toHaveTextContent("The pods are healthy; nothing to change.");
    expect(
      within(details).queryByTestId("remediation-round-reasoning-toggle"),
    ).toBeNull();
    expect(within(details).queryByTestId("markdown")).toBeNull();
  });

  test("the AI's words are text: markup in them is never drawn", async () => {
    roundServed = roundJson({
      runStatus: AIRunStatus.Completed,
      explanation: {
        reason: "Nothing applies. <i>Really</i>",
        ruledOutFixes: [
          {
            fix: '<img src="x" onerror="alert(1)">Restart',
            commands: ['<script>alert("x")</script>'],
            whyNot: "<b>Not safe</b>",
          },
        ],
      },
    });
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.NoneApplicable),
    ]);
    await waitFor(() => {
      expect(planSummary()).toBe("Nothing applies. <i>Really</i>");
    });

    const details: HTMLElement = openPlan();
    const fix: HTMLElement = within(details).getByTestId(
      "remediation-round-ruled-out-fix",
    );
    const reason: HTMLElement = within(details).getByTestId(
      "remediation-round-reason",
    );

    expect(fix.querySelector("img")).toBeNull();
    expect(fix.querySelector("script")).toBeNull();
    expect(fix.querySelector("b")).toBeNull();
    expect(reason.querySelector("i")).toBeNull();
    expect(reason.textContent).toBe("Nothing applies. <i>Really</i>");
    expect(
      within(fix).getByTestId("remediation-round-ruled-out-what").textContent,
    ).toBe('<img src="x" onerror="alert(1)">Restart');
    expect(
      within(fix).getByTestId("remediation-round-ruled-out-why").textContent,
    ).toBe("<b>Not safe</b>");
  });

  test("a runbook pick that found none says no runbook ran, and the runbooks it ruled out", async () => {
    roundServed = roundJson({
      runStatus: AIRunStatus.Completed,
      explanation: {
        reason: "No candidate runbook fixes a full disk.",
        ruledOutFixes: [
          {
            fix: "Restart checkout-api pods",
            commands: [],
            whyNot: "It restarts pods; the disk stays full.",
          },
        ],
      },
    });
    await renderStep([
      runbookPick(AutoRemediationSuggestionStatus.NoneApplicable),
    ]);
    await waitFor(() => {
      expect(planSummary()).toBe("No candidate runbook fixes a full disk.");
    });
    expect(planTitle()).toBe("Found no runbook that applies");

    const details: HTMLElement = openPlan();

    expect(
      within(details).getByTestId("remediation-round-reason"),
    ).toHaveTextContent("No candidate runbook fixes a full disk.");
    expect(
      within(details).getByTestId("remediation-round-ruled-out-what"),
    ).toHaveTextContent("Restart checkout-api pods");
    expect(
      within(details).getByTestId("remediation-round-approval"),
    ).toHaveTextContent("No runbook ran, and nobody was asked to approve one.");
  });

  test("a round whose AI said nothing reads its reasoning as before, and still says nobody was asked", async () => {
    roundServed = roundJson({ runStatus: AIRunStatus.Completed });
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.NoneApplicable, {
        rationaleMarkdown: "The pods are healthy; nothing to change.",
      }),
    ]);
    await waitFor(() => {
      expect(postsTo(ROUND_URL)).toHaveLength(1);
    });

    expect(planTitle()).toBe("Found no safe fix");
    expect(planSummary()).toBe("The pods are healthy; nothing to change.");

    const details: HTMLElement = openPlan();

    expect(within(details).getByTestId("markdown")).toHaveTextContent(
      "The pods are healthy; nothing to change.",
    );
    // Its reasoning is its answer: first, before that nobody was asked.
    expect(
      Array.from(details.children).map((child: Element): string | null => {
        return child.getAttribute("data-testid");
      }),
    ).toEqual(["remediation-fix-reasoning", "remediation-round-approval"]);
    expect(
      within(details).queryByTestId("remediation-round-reasoning-toggle"),
    ).toBeNull();
    // Its reasoning is said once, in full: no reason of the AI's above it.
    expect(within(details).queryByTestId("remediation-round-reason")).toBe(
      null,
    );
    expect(
      within(details).queryByTestId("remediation-round-ruled-out"),
    ).toBeNull();
    expect(within(details).queryByTestId("remediation-round-checks")).toBe(
      null,
    );
  });
});

describe("what the step reads", () => {
  test("each fix with a run is read once, by its id", async () => {
    roundServed = roundJson({ runStatus: AIRunStatus.Completed });
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.NoneApplicable),
    ]);

    await waitFor(() => {
      expect(postsTo(ROUND_URL)).toEqual([
        { url: ROUND_URL, data: { suggestionId: FIX_ID } },
      ]);
    });
  });

  test("a fix no AI run worked out is not read, and still says nothing ran when it found none", async () => {
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.NoneApplicable, {
        aiRunId: undefined,
        rationaleMarkdown: "Nothing on this cluster can be changed safely.",
      }),
    ]);

    expect(postsTo(ROUND_URL)).toEqual([]);
    expect(planTitle()).toBe("Found no safe fix");

    const details: HTMLElement = openPlan();

    expect(
      within(details).getByTestId("remediation-round-approval"),
    ).toHaveTextContent(
      "No fix ran, and nobody was asked to approve one: OneUptime AI asks for approval only when it proposes a fix.",
    );
    expect(within(details).queryByTestId("remediation-round-failure")).toBe(
      null,
    );
  });

  test("a round that cannot be read leaves the fix as its row says", async () => {
    roundServed = new HTTPErrorResponse(500, { message: "down" }, {});
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.NoneApplicable),
    ]);
    await waitFor(() => {
      expect(postsTo(ROUND_URL)).toHaveLength(1);
    });

    expect(planTitle()).toBe("Found no safe fix");
    expect(planSummary()).toBe(SWEEP_NOTE);
    expect(screen.queryByText("Stopped before it found a fix")).toBeNull();
  });

  test("a round at work lists the commands it has checked with so far", async () => {
    roundServed = roundJson({
      runStatus: AIRunStatus.Running,
      events: [eventJson(1, AIRunEventType.RunStarted)],
      checks: [
        {
          command: "kubectl get events -n web",
          why: "Look for recent restarts.",
          status: "running",
          at: AT_STARTED,
          error: "",
        },
      ],
    });
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.Planning, {
        rationaleMarkdown: undefined,
      }),
    ]);
    await waitFor(() => {
      expect(
        within(planStep()).queryByTestId("remediation-fix-step-toggle"),
      ).not.toBeNull();
    });

    expect(planTitle()).toBe("Working out a fix…");
    expect(planStep()).toHaveAttribute("data-tone", "live");

    const details: HTMLElement = openPlan();
    const check: HTMLElement = within(details).getByTestId(
      "remediation-round-check",
    );

    expect(check).toHaveAttribute("data-status", "running");
    expect(
      within(check).getByTestId("remediation-round-check-mark"),
    ).toHaveAttribute("aria-label", "Running");
    // It is not over: nothing is said about approval yet.
    expect(within(details).queryByTestId("remediation-round-approval")).toBe(
      null,
    );
  });

  test("a round waiting to try again on its own says why its attempt ended, and when it tries again", async () => {
    const nextAttemptAt: Date = new Date(Date.now() + 5 * 60 * 1000);
    roundServed = roundJson({
      runStatus: AIRunStatus.Queued,
      events: [
        eventJson(1, AIRunEventType.RunStarted),
        eventJson(2, AIRunEventType.AttemptEnded, {
          attemptEnd: {
            outcome: AIRunAttemptOutcome.WillRetry,
            failureKind: AIRunFailureKind.ProviderTimeout,
            attempt: 1,
            maxAttempts: 3,
            timeoutInSeconds: 120,
            nextAttemptAt: nextAttemptAt.toISOString(),
          },
        }),
      ],
    });
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.Planning, {
        rationaleMarkdown: undefined,
      }),
    ]);

    await waitFor(() => {
      expect(planSummary()).toBe(
        `Did not finish: The LLM provider did not answer within 120 seconds. Trying again at ${formatAiRunTime(nextAttemptAt)}.`,
      );
    });
    expect(planTitle()).toBe("Working out a fix…");
    // Waiting on its own is not a failure: it is still working out a fix.
    expect(within(theFix()).queryByTestId("remediation-fix-status")).toBeNull();
    expect(screen.getByTestId("remediation-step-summary")).toHaveTextContent(
      "OneUptime AI is working out a fix for this incident.",
    );
    expect(
      screen.getByTestId("ai-card-step-remediation-status"),
    ).not.toHaveTextContent("Did not finish");
  });
});
