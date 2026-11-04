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

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("div", { "data-testid": "markdown" });
    },
  };
});

import RemediationStep from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep";
import {
  REMEDIATION_FIX_DISMISS,
  REMEDIATION_FIX_DISMISS_REFUSED,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepCopy";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { AiRemediationCommandPolicyVerdict } from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  RemediationTrackRecord,
  RemediationTrackRecordOutcome,
} from "../../../Types/AutoRemediation/RemediationTrackRecord";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { FIX_DISMISS_REFUSED_MESSAGE } from "../../../Types/Runbook/RunbookRunPermissions";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { openRemediationFixes } from "./RemediationFixHarness";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * A RUNBOOK FIX ON THE REMEDIATION STEP (#5519's follow-ups).
 *
 *  - A runbook OneUptime AI proposes says how it went the last times
 *    OneUptime AI ran it for other incidents and alerts here, as a cloud or
 *    Kubernetes change does under its command: the same line, the same
 *    words and links, right over what approving does and Approve & Run,
 *    since a runbook has no plan to open. Gone once the fix is decided; a
 *    record that cannot be read, or none kept, is no line.
 *  - Its Dismiss is the step's own words, "Dismiss fix" - the shared
 *    "Dismiss" reads as each language's Hide since #5512 - and a refusal for
 *    want of the permission approving asks says so under the buttons, in
 *    the server's words, which are a key of the Dashboard's own.
 */

const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-3333-4aaa-8bbb-000000000023",
);
const SUGGESTION_ID: string = "0193c0de-6666-4aaa-8bbb-000000000026";
const RUNBOOK_ID: string = "0193c0de-7777-4aaa-8bbb-000000000027";
const EARLIER_INCIDENT_ID: string = "0193c0de-aaaa-4aaa-8bbb-00000000002a";
const EARLIER_ALERT_ID: string = "0193c0de-bbbb-4aaa-8bbb-00000000002b";

function record(
  overrides: Partial<RemediationTrackRecord> = {},
): RemediationTrackRecord {
  return {
    workedCount: 3,
    didNotWorkCount: 0,
    runs: [
      {
        subjectKind: "incident",
        subjectId: EARLIER_INCIDENT_ID,
        subjectNumber: "INC-41",
        ranAt: "2026-10-28T10:00:00.000Z",
        outcome: RemediationTrackRecordOutcome.Worked,
      },
      {
        subjectKind: "alert",
        subjectId: EARLIER_ALERT_ID,
        subjectNumber: "#305",
        ranAt: "2026-10-20T10:00:00.000Z",
        outcome: RemediationTrackRecordOutcome.Worked,
      },
    ],
    ...overrides,
  };
}

function runbookFix(
  overrides: Partial<Record<string, unknown>> = {},
): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: SUGGESTION_ID,
    status: AutoRemediationSuggestionStatus.Suggested,
    suggestionType: AutoRemediationSuggestionType.Runbook,
    ruleNameSnapshot: "Restart checkout",
    runbookNameSnapshot: "Restart the checkout pods",
    runbookId: new ObjectID(RUNBOOK_ID),
    runbookTrackRecord: record() as unknown as JSONObject,
    createdAt: new Date("2026-11-03T10:00:00Z"),
    ...overrides,
  });
}

// What the step asks ModelAPI.getList for: the model and the columns it reads.
interface ListCallArgs {
  modelType: unknown;
  select: JSONObject;
}

let getListSpy: ReturnType<typeof jest.spyOn>;
let postSpy: ReturnType<typeof jest.spyOn>;
let served: Array<AutoRemediationSuggestion> = [];

async function renderStep(
  rows: Array<AutoRemediationSuggestion>,
): Promise<HTMLElement> {
  served = rows;
  render(
    <RemediationStep investigationStage="reported" incidentId={INCIDENT_ID} />,
  );

  return await screen.findByTestId("remediation-fix");
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID.toString()}`);
  served = [];
  getListSpy = jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation((async (data: {
      modelType: unknown;
    }): Promise<ListResult<AutoRemediationSuggestion>> => {
      // The step reads its decisions beside its fixes: none here.
      if (data.modelType !== AutoRemediationSuggestion) {
        return { data: [], count: 0, skip: 0, limit: 5 };
      }

      return { data: served, count: served.length, skip: 0, limit: 10 };
    }) as never);
  postSpy = jest.spyOn(API, "post");
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a runbook that waits for approval", () => {
  test("says how it went the last times it ran here, right over what approving does and Approve & Run", async () => {
    const fix: HTMLElement = await renderStep([runbookFix()]);

    const trackRecord: HTMLElement = within(fix).getByTestId(
      "remediation-runbook-track-record",
    );
    expect(
      within(trackRecord).getByTestId("remediation-command-track-record-text"),
    ).toHaveTextContent("Worked all 3 times it ran here before");
    expect(
      within(trackRecord).getByTestId("remediation-command-track-record"),
    ).toHaveAttribute("data-tone", "Worked");

    // The runs it fixed, each a link to its page.
    const runs: Array<HTMLElement> = within(trackRecord).getAllByTestId(
      "remediation-track-record-run",
    );
    expect(
      runs.map((run: HTMLElement): [string, string | null] => {
        return [run.textContent || "", run.getAttribute("href")];
      }),
    ).toEqual([
      ["INC-41", `/dashboard/${PROJECT_ID}/incidents/${EARLIER_INCIDENT_ID}`],
      ["#305", `/dashboard/${PROJECT_ID}/alerts/${EARLIER_ALERT_ID}`],
    ]);

    // Over what approving does, which is right over Approve & Run.
    const note: HTMLElement = within(fix).getByTestId(
      "remediation-approval-note",
    );
    expect(
      trackRecord.compareDocumentPosition(note) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(fix).getByTestId("remediation-approve-button"),
    ).toHaveTextContent("Approve & Run");

    // Its container spaces its lines: the line brings no gap of its own.
    expect(
      within(trackRecord).getByTestId("remediation-command-track-record"),
    ).not.toHaveClass("mt-2");
  });

  test("one that never worked here says it in red, its runs the red links", async () => {
    const fix: HTMLElement = await renderStep([
      runbookFix({
        runbookTrackRecord: record({
          workedCount: 0,
          didNotWorkCount: 2,
          runs: [
            {
              subjectKind: "incident",
              subjectId: EARLIER_INCIDENT_ID,
              subjectNumber: "INC-41",
              ranAt: "2026-10-28T10:00:00.000Z",
              outcome: RemediationTrackRecordOutcome.DidNotWork,
            },
          ],
        }) as unknown as JSONObject,
      }),
    ]);

    const line: HTMLElement = within(fix).getByTestId(
      "remediation-command-track-record",
    );
    expect(line).toHaveAttribute("data-tone", "DidNotWork");
    expect(line).toHaveTextContent(
      "Didn't work either time it ran here before",
    );
    expect(
      within(line).getByTestId("remediation-track-record-run"),
    ).toHaveClass("text-rose-700");
  });

  test.each([
    AutoRemediationSuggestionStatus.Approved,
    AutoRemediationSuggestionStatus.AutoExecuted,
    AutoRemediationSuggestionStatus.Dismissed,
  ])("once it is %s, the record is gone", async (status: string) => {
    const isStarted: boolean =
      status !== AutoRemediationSuggestionStatus.Dismissed;
    const fix: HTMLElement = await renderStep([
      runbookFix({
        status,
        // A runbook that started: its execution, which the fix opens.
        ...(isStarted
          ? {
              runbookExecutionId: new ObjectID(
                "0193c0de-8888-4aaa-8bbb-000000000028",
              ),
            }
          : {}),
      }),
    ]);

    if (isStarted) {
      // Its buttons are there - View Execution - but not the record.
      expect(
        within(fix).getByRole("button", { name: "View Execution" }),
      ).toBeInTheDocument();
    }
    expect(
      within(fix).queryByTestId("remediation-runbook-track-record"),
    ).not.toBeInTheDocument();
    expect(
      within(fix).queryByTestId("remediation-command-track-record"),
    ).not.toBeInTheDocument();
  });

  test.each<[string, unknown]>([
    ["a record that cannot be read", { workedCount: "many" }],
    ["none kept (a runbook OneUptime AI never ran here)", undefined],
  ])("%s is no line", async (_: string, runbookTrackRecord: unknown) => {
    const fix: HTMLElement = await renderStep([
      runbookFix({ runbookTrackRecord }),
    ]);

    expect(
      within(fix).queryByTestId("remediation-runbook-track-record"),
    ).not.toBeInTheDocument();
    // The rest of the fix as it was: what approving does, and its press.
    expect(
      within(fix).getByTestId("remediation-approval-note"),
    ).toBeInTheDocument();
    expect(
      within(fix).getByTestId("remediation-approve-button"),
    ).toBeInTheDocument();
  });

  test("only a runbook's: a plan of changes keeps its records under each change", async () => {
    const fix: HTMLElement = await renderStep([
      runbookFix({
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
        commandPlan: {
          commands: [
            {
              sequence: 1,
              stepType: RunbookStepType.Bash,
              runnerId: "0193c0de-5555-4aaa-8bbb-000000000025",
              runnerNameSnapshot: "web-1",
              command: "systemctl restart checkout",
              timeoutInMs: 30000,
              rationale: "r",
              expectedEffect: "e",
              policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
            },
          ],
        },
      }),
    ]);
    await openRemediationFixes();

    expect(
      within(fix).queryByTestId("remediation-runbook-track-record"),
    ).not.toBeInTheDocument();
  });

  test("the step reads the record, and where each fix was approved", async () => {
    await renderStep([runbookFix()]);

    const select: JSONObject | undefined = (
      getListSpy.mock.calls as Array<Array<ListCallArgs>>
    )
      .map((call: Array<ListCallArgs>): ListCallArgs => {
        return call[0]!;
      })
      .find((args: ListCallArgs): boolean => {
        return args.modelType === AutoRemediationSuggestion;
      })?.select;

    expect(select?.["runbookTrackRecord"]).toBe(true);
    expect(select?.["approvedFrom"]).toBe(true);
  });
});

describe("Dismiss fix", () => {
  test("is the step's own words: a fix is dismissed, never hidden", async () => {
    const fix: HTMLElement = await renderStep([runbookFix()]);

    expect(REMEDIATION_FIX_DISMISS).toBe("Dismiss fix");
    expect(
      within(fix).getByTestId("remediation-dismiss-button"),
    ).toHaveTextContent(/^Dismiss fix$/);
    expect(
      within(fix).queryByRole("button", { name: "Dismiss" }),
    ).not.toBeInTheDocument();
    expect(within(fix).queryByText("Hide")).not.toBeInTheDocument();
  });

  test("dismisses the fix it is on", async () => {
    postSpy.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, {}, {}) as never,
    );
    const fix: HTMLElement = await renderStep([runbookFix()]);

    await act(async (): Promise<void> => {
      fireEvent.click(within(fix).getByTestId("remediation-dismiss-button"));
    });

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledTimes(1);
    });
    const request: JSONObject = postSpy.mock.calls[0]![0] as JSONObject;
    expect(String(request["url"])).toMatch(/\/auto-remediation\/dismiss$/);
    expect(request["data"]).toEqual({ suggestionId: SUGGESTION_ID });
  });

  test("refused for want of the permission approving asks: why, under the buttons, in the server's words", async () => {
    postSpy.mockResolvedValue(
      new HTTPErrorResponse(
        403,
        { message: FIX_DISMISS_REFUSED_MESSAGE },
        {},
      ) as never,
    );
    const fix: HTMLElement = await renderStep([runbookFix()]);

    await act(async (): Promise<void> => {
      fireEvent.click(within(fix).getByTestId("remediation-dismiss-button"));
    });

    const notice: HTMLElement = await within(fix).findByTestId(
      "remediation-action-error",
    );
    expect(notice).toHaveAttribute("role", "alert");
    expect(notice).toHaveTextContent(
      "Could not save your action: the suggestion was not dismissed",
    );
    expect(notice).toHaveTextContent(FIX_DISMISS_REFUSED_MESSAGE);
    // The fix still waits, Dismiss fix and all.
    expect(
      within(fix).getByTestId("remediation-dismiss-button"),
    ).toBeInTheDocument();

    // Word for word the Dashboard's key, so it reads in every language.
    expect(REMEDIATION_FIX_DISMISS_REFUSED).toBe(FIX_DISMISS_REFUSED_MESSAGE);
  });
});
