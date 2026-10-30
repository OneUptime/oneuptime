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

// Only rendered when "Show reasoning" is opened; keep the lazy import out.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("div", { "data-testid": "markdown" });
    },
  };
});

import RemediationStep, {
  ComponentProps as RemediationStepProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep";
import {
  REMEDIATION_CODE_FIX_COPY,
  REMEDIATION_STEP_WAITING,
  REMEDIATION_TRY_AGAIN_FAILED,
  REMEDIATION_TRY_AGAIN_HINT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepCopy";
import AutoRemediationDecision from "../../../Models/DatabaseModels/AutoRemediationDecision";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * WHAT THE REMEDIATION STEP DOES BEYOND SAYING WHAT HAPPENED (block 43).
 *
 * "I have auto remediation enabled ... but I do not see any remediation
 * happening at all." A decision is written once, with the project's
 * settings of that moment, and nothing reaches back when a switch is turned
 * on later. So the step:
 *
 *   - says a switch that was off is on now, and offers Try again, which
 *     decides again with the settings of now (POST
 *     /auto-remediation/try-again) - to someone who may edit the record,
 *     on an open record, when nothing was fixed;
 *   - asks what came of the fix in the code the investigation recommends
 *     (POST /ai-investigation/code-fix-suggestion), and reads it again
 *     while the pull request is being written;
 *   - says it waits while the investigation runs, and reads the decision
 *     the moment the investigation is done.
 */

const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-7777-4aaa-8bbb-000000000007",
);
const ALERT_ID: ObjectID = new ObjectID("0193c0de-7777-4aaa-8bbb-000000000008");
const RUN_ID: string = "0193c0de-8888-4aaa-8bbb-000000000008";
const AI_RUN_ID: string = "0193c0de-9999-4aaa-8bbb-000000000009";

const LINKED_TO_NOTHING: JSONObject = {
  stage: "Evaluated",
  createdAt: new Date("2026-10-05T10:00:00Z"),
  entries: [
    { lane: "KubernetesCluster", reason: "ClusterNoneLinked" },
    { lane: "Resource", reason: "ResourceNoneLinked" },
    { lane: "Rule", reason: "NoRulesConfigured" },
  ],
};

const FIXING_WAS_OFF: JSONObject = {
  stage: "Evaluated",
  createdAt: new Date("2026-10-05T10:00:00Z"),
  entries: [{ lane: "Project", reason: "RemediationOff" }],
};

const AI_WAS_OFF: JSONObject = {
  stage: "Evaluated",
  createdAt: new Date("2026-10-05T10:00:00Z"),
  entries: [{ lane: "Project", reason: "EnableAiOff" }],
};

const PROPOSED: JSONObject = {
  stage: "Evaluated",
  createdAt: new Date("2026-10-05T10:05:00Z"),
  entries: [
    {
      lane: "Rule",
      reason: "RuleRunbookProposed",
      ruleName: "Restart checkout",
      runbookName: "Restart the checkout pods",
    },
  ],
};

function proposedFix(): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: "0193c0de-6666-4aaa-8bbb-000000000016",
    status: AutoRemediationSuggestionStatus.Suggested,
    ruleNameSnapshot: "Restart checkout",
    runbookNameSnapshot: "Restart the checkout pods",
    createdAt: new Date("2026-10-05T10:05:00Z"),
  });
}

interface Served {
  suggestions: Array<AutoRemediationSuggestion>;
  decisions: Array<JSONObject>;
}

let served: Served = { suggestions: [], decisions: [] };
let getListSpy: ReturnType<typeof jest.spyOn>;
let getItemSpy: ReturnType<typeof jest.spyOn>;
let postSpy: ReturnType<typeof jest.spyOn>;

interface PostRequest {
  url: { toString: () => string };
  data: JSONObject;
}

function posts(path: string): Array<PostRequest> {
  return (postSpy.mock.calls as Array<Array<PostRequest>>)
    .map((call: Array<PostRequest>): PostRequest => {
      return call[0]!;
    })
    .filter((request: PostRequest): boolean => {
      return request.url.toString().includes(path);
    });
}

function decisionReads(): number {
  return getListSpy.mock.calls.filter((call: Array<unknown>): boolean => {
    return (
      (call[0] as { modelType: unknown }).modelType === AutoRemediationDecision
    );
  }).length;
}

function serve(next: Served): void {
  served = next;
}

/*
 * The project the dashboard has selected: Enable AI as it holds it, and the
 * record kind's fixing switch as a read of the project returns it.
 */
function selectProject(data: {
  enableAi?: boolean | undefined;
  isFixingOn?: boolean | undefined;
}): void {
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(
    Object.assign(new Project(), {
      _id: PROJECT_ID,
      ...(data.enableAi === undefined ? {} : { enableAi: data.enableAi }),
    }) as Project,
  );
  getItemSpy.mockResolvedValue(
    Object.assign(new Project(), {
      enableAutomaticIncidentInvestigation: true,
      enableAutomaticAlertInvestigation: true,
      ...(data.isFixingOn === undefined
        ? {}
        : {
            enableAutomaticIncidentRemediation: data.isFixingOn,
            enableAutomaticAlertRemediation: data.isFixingOn,
          }),
    }) as never,
  );
}

function renderStep(
  props: Partial<RemediationStepProps> = {},
): ReturnType<typeof render> {
  return render(
    <RemediationStep
      incidentId={INCIDENT_ID}
      investigationStage="reported"
      {...props}
    />,
  );
}

function statusPill(): HTMLElement {
  return screen.getByLabelText("Remediation status");
}

function tryAgainButton(): HTMLElement | null {
  return screen.queryByTestId("remediation-try-again-button");
}

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let index: number = 0; index < 8; index++) {
      await Promise.resolve();
    }
  });
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID.toString()}`);
  served = { suggestions: [], decisions: [] };
  getListSpy = jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation((async (data: {
      modelType: { new (): unknown };
    }): Promise<
      ListResult<AutoRemediationDecision | AutoRemediationSuggestion>
    > => {
      if (data.modelType === AutoRemediationDecision) {
        const rows: Array<AutoRemediationDecision> = served.decisions.map(
          (row: JSONObject) => {
            return Object.assign(new AutoRemediationDecision(), row);
          },
        );
        return { data: rows, count: rows.length, skip: 0, limit: 5 };
      }

      return {
        data: served.suggestions,
        count: served.suggestions.length,
        skip: 0,
        limit: 10,
      };
    }) as never);
  getItemSpy = jest.spyOn(ModelAPI, "getItem");
  postSpy = jest.spyOn(API, "post");
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectOwner]);
  selectProject({ enableAi: true });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("Try again", () => {
  test("is offered on an open record nothing was fixed for, with what it does", async () => {
    serve({ suggestions: [], decisions: [LINKED_TO_NOTHING] });

    renderStep();

    expect(
      await screen.findByTestId("remediation-try-again"),
    ).toHaveTextContent(REMEDIATION_TRY_AGAIN_HINT.incident);
    expect(tryAgainButton()).toHaveTextContent("Try again");
    expect(tryAgainButton()).toBeEnabled();
  });

  test("decides again, then reads what it decided: a fix to approve, and no Try again", async () => {
    serve({ suggestions: [], decisions: [LINKED_TO_NOTHING] });
    postSpy.mockImplementation((async (request: PostRequest) => {
      if (request.url.toString().includes("/auto-remediation/try-again")) {
        // The engine wrote a new decision, and the fix it proposed.
        serve({ suggestions: [proposedFix()], decisions: [PROPOSED] });
        return new HTTPResponse<JSONObject>(200, { result: "Evaluated" }, {});
      }

      throw new Error(`unexpected ${request.url.toString()}`);
    }) as never);

    renderStep();
    await screen.findByTestId("remediation-try-again");
    const readsBefore: number = decisionReads();

    await act(async (): Promise<void> => {
      fireEvent.click(tryAgainButton()!);
    });
    await settle();

    expect(posts("/auto-remediation/try-again")).toHaveLength(1);
    expect(posts("/auto-remediation/try-again")[0]!.data).toEqual({
      incidentId: INCIDENT_ID.toString(),
    });
    // The new decision is read at once, not on the next visit.
    expect(decisionReads()).toBeGreaterThan(readsBefore);
    expect(
      await screen.findByText("Restart the checkout pods"),
    ).toBeInTheDocument();
    expect(statusPill()).toHaveTextContent("Needs your approval");
    expect(tryAgainButton()).toBeNull();
  });

  /*
   * The button is locked while it works, and a new decision that started a
   * fix takes it away: the keyboard's place fell to the top of the page,
   * and a screen reader said nothing of what changed. It lands on the
   * step's title then, from where the new lines are read.
   */
  test("once a fix started and Try again is gone, the keyboard is on the step's title", async () => {
    serve({ suggestions: [], decisions: [LINKED_TO_NOTHING] });
    postSpy.mockImplementation((async (request: PostRequest) => {
      if (request.url.toString().includes("/auto-remediation/try-again")) {
        serve({ suggestions: [proposedFix()], decisions: [PROPOSED] });
        return new HTTPResponse<JSONObject>(200, { result: "Evaluated" }, {});
      }

      throw new Error(`unexpected ${request.url.toString()}`);
    }) as never);

    renderStep();
    await screen.findByTestId("remediation-try-again");
    tryAgainButton()!.focus();

    await act(async (): Promise<void> => {
      fireEvent.click(tryAgainButton()!);
    });
    await settle();
    await screen.findByText("Restart the checkout pods");

    expect(tryAgainButton()).toBeNull();
    const title: HTMLElement = screen.getByRole("heading", {
      level: 3,
      name: "Remediation",
    });
    expect(title).toHaveFocus();
    expect(title).toHaveAttribute("tabindex", "-1");
  });

  test("a refusal leaves the keyboard on Try again, to press once more", async () => {
    serve({ suggestions: [], decisions: [LINKED_TO_NOTHING] });
    postSpy.mockResolvedValue(
      new HTTPErrorResponse(400, { message: "Busy." }, {}) as never,
    );
    jest.spyOn(API, "getFriendlyMessage").mockReturnValue("Busy.");

    renderStep();
    await screen.findByTestId("remediation-try-again");

    await act(async (): Promise<void> => {
      fireEvent.click(tryAgainButton()!);
    });
    await settle();

    expect(screen.getByTestId("remediation-try-again-error")).toBeVisible();
    expect(tryAgainButton()).toHaveFocus();
  });

  test("a reader who moved on meanwhile keeps their place", async () => {
    serve({ suggestions: [], decisions: [LINKED_TO_NOTHING] });
    let answer: (value: HTTPResponse<JSONObject>) => void = (): void => {};
    postSpy.mockImplementation((() => {
      return new Promise<HTTPResponse<JSONObject>>(
        (resolve: (value: HTTPResponse<JSONObject>) => void) => {
          answer = resolve;
        },
      );
    }) as never);

    renderStep();
    await screen.findByTestId("remediation-try-again");
    fireEvent.click(tryAgainButton()!);

    // Meanwhile the reader went on to a link of the step.
    const link: HTMLElement = screen.getAllByRole("link")[0]!;
    link.focus();

    await act(async (): Promise<void> => {
      answer(new HTTPResponse<JSONObject>(200, { result: "Evaluated" }, {}));
    });
    await settle();

    expect(link).toHaveFocus();
  });

  test("an alert's is the alert's", async () => {
    goTo(`/dashboard/${PROJECT_ID}/alerts/${ALERT_ID.toString()}`);
    serve({ suggestions: [], decisions: [LINKED_TO_NOTHING] });
    postSpy.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { result: "Evaluated" }, {}) as never,
    );

    renderStep({ incidentId: undefined, alertId: ALERT_ID });
    expect(
      await screen.findByTestId("remediation-try-again"),
    ).toHaveTextContent(REMEDIATION_TRY_AGAIN_HINT.alert);

    await act(async (): Promise<void> => {
      fireEvent.click(tryAgainButton()!);
    });
    await settle();

    expect(posts("/auto-remediation/try-again")[0]!.data).toEqual({
      alertId: ALERT_ID.toString(),
    });
  });

  test("one click at a time: a second click while it decides posts nothing", async () => {
    serve({ suggestions: [], decisions: [LINKED_TO_NOTHING] });
    let answer: (value: HTTPResponse<JSONObject>) => void = (): void => {};
    postSpy.mockImplementation((() => {
      return new Promise<HTTPResponse<JSONObject>>(
        (resolve: (value: HTTPResponse<JSONObject>) => void) => {
          answer = resolve;
        },
      );
    }) as never);

    renderStep();
    await screen.findByTestId("remediation-try-again");

    fireEvent.click(tryAgainButton()!);
    fireEvent.click(tryAgainButton()!);

    expect(posts("/auto-remediation/try-again")).toHaveLength(1);
    expect(tryAgainButton()).toBeDisabled();

    await act(async (): Promise<void> => {
      answer(new HTTPResponse<JSONObject>(200, { result: "Evaluated" }, {}));
    });
    await settle();

    expect(tryAgainButton()).toBeEnabled();
  });

  test("a refusal says why in the reader's words, and goes when dismissed", async () => {
    serve({ suggestions: [], decisions: [LINKED_TO_NOTHING] });
    postSpy.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        {
          message:
            "OneUptime AI has just checked this incident. Try again in a moment.",
        },
        {},
      ) as never,
    );
    jest
      .spyOn(API, "getFriendlyMessage")
      .mockReturnValue(
        "OneUptime AI has just checked this incident. Try again in a moment.",
      );

    renderStep();
    await screen.findByTestId("remediation-try-again");

    await act(async (): Promise<void> => {
      fireEvent.click(tryAgainButton()!);
    });
    await settle();

    const notice: HTMLElement = screen.getByTestId(
      "remediation-try-again-error",
    );
    expect(notice).toHaveAttribute("role", "alert");
    expect(notice).toHaveTextContent(REMEDIATION_TRY_AGAIN_FAILED);
    expect(notice).toHaveTextContent(
      "OneUptime AI has just checked this incident. Try again in a moment.",
    );

    fireEvent.click(within(notice).getByRole("button"));

    expect(screen.queryByTestId("remediation-try-again-error")).toBeNull();
  });

  test("a refusal on one record is not shown on the next", async () => {
    serve({ suggestions: [], decisions: [LINKED_TO_NOTHING] });
    postSpy.mockResolvedValue(
      new HTTPErrorResponse(400, { message: "Busy." }, {}) as never,
    );
    jest.spyOn(API, "getFriendlyMessage").mockReturnValue("Busy.");

    const view: ReturnType<typeof render> = renderStep();
    await screen.findByTestId("remediation-try-again");
    await act(async (): Promise<void> => {
      fireEvent.click(tryAgainButton()!);
    });
    await settle();
    expect(screen.getByTestId("remediation-try-again-error")).toBeVisible();

    view.rerender(
      <RemediationStep
        incidentId={new ObjectID("0193c0de-7777-4aaa-8bbb-000000000017")}
        investigationStage="reported"
      />,
    );
    await settle();

    expect(screen.queryByTestId("remediation-try-again-error")).toBeNull();
  });

  test.each<[string, () => void, Partial<RemediationStepProps>]>([
    ["on a resolved record", (): void => {}, { isRecordResolved: true }],
    [
      "to someone who may not edit it",
      (): void => {
        // May read the incident, not edit it.
        jest
          .spyOn(PermissionUtil, "getAllPermissions")
          .mockReturnValue([Permission.ReadProjectIncident]);
      },
      {},
    ],
  ])(
    "is not offered %s",
    async (
      _case: string,
      arrange: () => void,
      props: Partial<RemediationStepProps>,
    ) => {
      arrange();
      serve({ suggestions: [], decisions: [LINKED_TO_NOTHING] });

      renderStep(props);
      await screen.findByTestId("remediation-decision");
      await settle();

      expect(screen.queryByTestId("remediation-try-again")).toBeNull();
    },
  );

  test("is not offered beside a fix", async () => {
    serve({ suggestions: [proposedFix()], decisions: [PROPOSED] });

    renderStep();
    await screen.findByText("Restart the checkout pods");
    await settle();

    expect(screen.queryByTestId("remediation-try-again")).toBeNull();
  });
});

describe("a switch that was off when OneUptime AI checked", () => {
  test("fixing still off: says so, links to turn it on, and offers no Try again", async () => {
    selectProject({ enableAi: true, isFixingOn: false });
    serve({ suggestions: [], decisions: [FIXING_WAS_OFF] });

    renderStep();
    const line: HTMLElement = await screen.findByTestId(
      "remediation-decision-line",
    );
    await settle();

    expect(line).toHaveTextContent(
      '"Fix new incidents automatically" is off for this project, so OneUptime AI did not try to fix this incident.',
    );
    expect(
      within(line).getByRole("link", { name: "Turn on for incidents" }),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/incidents/ai/settings`);
    expect(statusPill()).toHaveTextContent("Off");
    expect(screen.queryByTestId("remediation-try-again")).toBeNull();
  });

  test("fixing on now: says it was off then and is on now, and offers Try again", async () => {
    selectProject({ enableAi: true, isFixingOn: true });
    serve({ suggestions: [], decisions: [FIXING_WAS_OFF] });

    renderStep();
    await waitFor(() => {
      expect(screen.getByTestId("remediation-decision-line")).toHaveTextContent(
        '"Fix new incidents automatically" was off when OneUptime AI checked this incident. It is on now.',
      );
    });

    // Read once, for the record kind's switches.
    expect(getItemSpy).toHaveBeenCalledTimes(1);
    expect(
      within(screen.getByTestId("remediation-decision-line")).queryByRole(
        "link",
      ),
    ).toBeNull();
    expect(await screen.findByTestId("remediation-try-again")).toBeVisible();
  });

  test("Enable AI on now: says it was off then, and offers Try again", async () => {
    selectProject({ enableAi: true });
    serve({ suggestions: [], decisions: [AI_WAS_OFF] });

    renderStep();

    expect(
      await screen.findByTestId("remediation-decision-line"),
    ).toHaveTextContent(
      "Enable AI was off when OneUptime AI checked this incident. It is on now.",
    );
    expect(await screen.findByTestId("remediation-try-again")).toBeVisible();
  });

  test("Enable AI not known: never 'it is on now'", async () => {
    jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(null);
    serve({ suggestions: [], decisions: [AI_WAS_OFF] });

    renderStep();
    const line: HTMLElement = await screen.findByTestId(
      "remediation-decision-line",
    );
    await settle();

    expect(line).toHaveTextContent(
      "Enable AI is off for this project, so nothing is fixed automatically",
    );
    expect(line).not.toHaveTextContent("It is on now");
    expect(screen.queryByTestId("remediation-try-again")).toBeNull();
  });

  test("a decision that did not find fixing off never reads the switches", async () => {
    serve({ suggestions: [], decisions: [LINKED_TO_NOTHING] });

    renderStep();
    await screen.findByTestId("remediation-decision");
    await settle();

    expect(getItemSpy).not.toHaveBeenCalled();
  });
});

describe("the fix in the code the investigation recommends", () => {
  function answerCodeFix(answers: Array<JSONObject | HTTPErrorResponse>): void {
    let index: number = 0;
    postSpy.mockImplementation((async (request: PostRequest) => {
      if (
        request.url.toString().includes("/ai-investigation/code-fix-suggestion")
      ) {
        const answer: JSONObject | HTTPErrorResponse =
          answers[Math.min(index, answers.length - 1)]!;
        index++;
        return answer instanceof HTTPErrorResponse
          ? answer
          : new HTTPResponse<JSONObject>(200, answer, {});
      }

      throw new Error(`unexpected ${request.url.toString()}`);
    }) as never);
  }

  test("asks what came of it, and says so under the decision", async () => {
    serve({ suggestions: [], decisions: [LINKED_TO_NOTHING] });
    answerCodeFix([
      { offer: SuggestionOffer.Act, automaticBlocker: "NoRepository" },
    ]);

    renderStep({
      codeFix: { isRecommended: true, investigationRunId: RUN_ID },
    });

    const row: HTMLElement = await screen.findByTestId("remediation-code-fix");
    expect(posts("/ai-investigation/code-fix-suggestion")[0]!.data).toEqual({
      subjectType: "incident",
      subjectId: INCIDENT_ID.toString(),
    });
    expect(row).toHaveAttribute("data-offer", SuggestionOffer.Act);
    expect(
      within(row).getByTestId("remediation-code-fix-open"),
    ).toHaveTextContent(REMEDIATION_CODE_FIX_COPY.openPullRequest);
    // It comes after what the decision said.
    expect(
      screen.getByTestId("remediation-decision").compareDocumentPosition(row) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("being written: says so in the pill too, reads it again until it is done, then stops", async () => {
    jest.useFakeTimers();
    serve({ suggestions: [], decisions: [LINKED_TO_NOTHING] });
    answerCodeFix([
      {
        offer: SuggestionOffer.InProgress,
        aiRunId: AI_RUN_ID,
        isAutomatic: true,
      },
      {
        offer: SuggestionOffer.InProgress,
        aiRunId: AI_RUN_ID,
        isAutomatic: true,
      },
      {
        offer: SuggestionOffer.Done,
        aiRunId: AI_RUN_ID,
        isAutomatic: true,
        fixOutcome: "Fixed",
      },
    ]);

    renderStep({
      codeFix: { isRecommended: true, investigationRunId: RUN_ID },
    });
    await settle();

    expect(screen.getByTestId("remediation-code-fix")).toHaveAttribute(
      "data-offer",
      SuggestionOffer.InProgress,
    );
    expect(statusPill()).toHaveTextContent("Fixing…");
    // A pull request on its way: deciding again would only find it.
    expect(screen.queryByTestId("remediation-try-again")).toBeNull();

    await act(async (): Promise<void> => {
      jest.advanceTimersByTime(15_000);
    });
    await settle();
    await act(async (): Promise<void> => {
      jest.advanceTimersByTime(15_000);
    });
    await settle();

    expect(posts("/ai-investigation/code-fix-suggestion")).toHaveLength(3);
    expect(screen.getByTestId("remediation-code-fix")).toHaveAttribute(
      "data-offer",
      SuggestionOffer.Done,
    );
    expect(statusPill()).toHaveTextContent("Pull request opened");

    await act(async (): Promise<void> => {
      jest.advanceTimersByTime(60_000);
    });
    await settle();

    expect(posts("/ai-investigation/code-fix-suggestion")).toHaveLength(3);
  });

  /*
   * A record from before decisions were recorded says it was not tried -
   * unless the fix in the code says otherwise: a pull request being written
   * is OneUptime AI trying.
   */
  test("a pull request opened for a record nothing else was decided for: no 'not tried'", async () => {
    serve({ suggestions: [], decisions: [] });
    answerCodeFix([
      {
        offer: SuggestionOffer.Done,
        aiRunId: AI_RUN_ID,
        isAutomatic: true,
        fixOutcome: "Fixed",
      },
    ]);

    renderStep({
      codeFix: { isRecommended: true, investigationRunId: RUN_ID },
    });

    expect(await screen.findByTestId("remediation-code-fix")).toHaveAttribute(
      "data-offer",
      SuggestionOffer.Done,
    );
    expect(screen.queryByTestId("remediation-step-not-tried")).toBeNull();
    expect(statusPill()).toHaveTextContent("Pull request opened");
  });

  test("not asked about when the investigation recommends nothing in the code", async () => {
    serve({ suggestions: [], decisions: [LINKED_TO_NOTHING] });

    renderStep({
      codeFix: { isRecommended: false, investigationRunId: RUN_ID },
    });
    await screen.findByTestId("remediation-decision");
    await settle();

    expect(posts("/ai-investigation/code-fix-suggestion")).toHaveLength(0);
    expect(screen.queryByTestId("remediation-code-fix")).toBeNull();
  });

  test("not asked about while Enable AI is off: nothing new can start", async () => {
    selectProject({ enableAi: false });
    serve({ suggestions: [], decisions: [AI_WAS_OFF] });

    renderStep({
      codeFix: { isRecommended: true, investigationRunId: RUN_ID },
    });
    await screen.findByTestId("remediation-decision");
    await settle();

    expect(posts("/ai-investigation/code-fix-suggestion")).toHaveLength(0);
  });

  test("a read that fails says nothing, and hides nothing else", async () => {
    serve({ suggestions: [], decisions: [LINKED_TO_NOTHING] });
    answerCodeFix([new HTTPErrorResponse(500, { message: "Down." }, {})]);

    renderStep({
      codeFix: { isRecommended: true, investigationRunId: RUN_ID },
    });
    await screen.findByTestId("remediation-decision");
    await settle();

    expect(posts("/ai-investigation/code-fix-suggestion")).toHaveLength(1);
    expect(screen.queryByTestId("remediation-code-fix")).toBeNull();
    expect(screen.getAllByTestId("remediation-decision-line")[0]).toBeVisible();
  });
});

describe("while the investigation runs", () => {
  test("says fixing is decided once it is done, and reads the decision the moment it is", async () => {
    serve({ suggestions: [], decisions: [] });

    const view: ReturnType<typeof render> = renderStep({
      investigationStage: "underway",
    });

    expect(
      await screen.findByTestId("remediation-decision-line"),
    ).toHaveTextContent(REMEDIATION_STEP_WAITING.incident);
    expect(statusPill()).toHaveTextContent("Waiting");
    expect(screen.queryByTestId("remediation-step-not-tried")).toBeNull();
    expect(screen.queryByTestId("remediation-try-again")).toBeNull();
    const readsBefore: number = decisionReads();

    // The investigation reports, and the engine decides.
    serve({ suggestions: [], decisions: [LINKED_TO_NOTHING] });
    view.rerender(
      <RemediationStep
        incidentId={INCIDENT_ID}
        investigationStage="reported"
      />,
    );
    await settle();

    expect(decisionReads()).toBeGreaterThan(readsBefore);
    await waitFor(() => {
      expect(screen.getByTestId("remediation-decision")).toHaveTextContent(
        "This incident is not linked to a host, cluster or database, so OneUptime AI had nothing to fix.",
      );
    });
    expect(screen.getByTestId("remediation-decision")).not.toHaveTextContent(
      REMEDIATION_STEP_WAITING.incident,
    );
    expect(statusPill()).toHaveTextContent("Needs attention");
  });

  test("an alert's says the alert's", async () => {
    serve({ suggestions: [], decisions: [] });

    renderStep({
      incidentId: undefined,
      alertId: ALERT_ID,
      investigationStage: "underway",
    });

    expect(
      await screen.findByTestId("remediation-decision-line"),
    ).toHaveTextContent(REMEDIATION_STEP_WAITING.alert);
  });

  test("while it reads, it says it is checking, in the pill and the body", () => {
    getListSpy.mockImplementation((() => {
      return new Promise<never>(() => {});
    }) as never);

    renderStep();

    expect(statusPill()).toHaveTextContent("Checking…");
    expect(screen.getByTestId("remediation-step-checking")).toHaveTextContent(
      "Checking what OneUptime AI did to fix this…",
    );
  });
});
