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

import RemediationStep, {
  getActionErrorTitle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep";
import CloudDryRunNote, {
  CLOUD_DRY_RUN_NOTE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/CloudDryRunNote";
import {
  CLOUD_DRY_RUN_COPY,
  getCloudDryRunButtonTitle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/CloudDryRunCopy";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import {
  AiRemediationCommandDryRun,
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPolicyVerdict,
  AiRemediationDryRunStatus,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

/*
 * The dry run of a fix's cloud changes on the Remediation card:
 *
 *  - each cloud change that waits for approval shows its latest dry run
 *    under it: being checked, would run (what the agent said: the call,
 *    the undo), would be refused (why, in amber) or could not finish -
 *    each saying nothing was changed; a dry run still "Running" five
 *    minutes on reads as could not finish;
 *  - before any dry run, the change says how its undo is written, as it
 *    did; once it ran, its outcome replaces both;
 *  - "Dry run" (or "Dry run again") sits beside Approve & Run on a fix that
 *    waits for approval and changes a cloud account, posts
 *    /auto-remediation/dry-run once, and is disabled while a dry run is on
 *    its way; nothing else gets it;
 *  - the card polls while a dry run is on its way, so the answer lands;
 *  - a refused click says nothing was changed.
 */

const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-3333-4aaa-8bbb-000000000003",
);
const SUGGESTION_ID: string = "0193c0de-6666-4aaa-8bbb-000000000006";
const ACCOUNT_ID: string = "0193c0de-7777-4aaa-8bbb-000000000007";
const AGENT_ID: string = "0193c0de-8888-4aaa-8bbb-000000000008";
const ECS: string = "arn:aws:ecs:us-east-1:123456789012:service/prod/web";
const COMMAND: string = `cloud scale-out ${ECS} --count 4`;

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function cloudCommand(
  overrides: Partial<Record<string, unknown>> = {},
): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.ResourceCommand,
    runnerId: AGENT_ID,
    runnerNameSnapshot: "Cloud AI agent",
    resourceType: AiResourceType.AwsAccount,
    resourceId: ACCOUNT_ID,
    resourceNameSnapshot: "prod",
    resourceCommandTier: "SafeWrite",
    command: COMMAND,
    timeoutInMs: 60000,
    rationale: "Tasks are saturated.",
    expectedEffect: "Latency drops.",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    ...overrides,
  } as JSONObject;
}

function suggestion(
  commands: Array<JSONObject>,
  status: AutoRemediationSuggestionStatus = AutoRemediationSuggestionStatus.Suggested,
): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: SUGGESTION_ID,
    status,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    ruleNameSnapshot: 'AI remediation for AWS account "prod"',
    resourceType: AiResourceType.AwsAccount,
    resourceId: new ObjectID(ACCOUNT_ID),
    commandPlan: { commands } as JSONObject,
    createdAt: new Date("2026-10-29T10:00:00Z"),
  });
}

let getListSpy: ReturnType<typeof jest.spyOn>;

function serve(row: AutoRemediationSuggestion): void {
  getListSpy.mockImplementation(
    async (): Promise<ListResult<AutoRemediationSuggestion>> => {
      return { data: [row], count: 1, skip: 0, limit: 10 };
    },
  );
}

async function renderCard(
  row: AutoRemediationSuggestion,
): Promise<HTMLElement> {
  serve(row);
  render(
    <RemediationStep investigationStage="reported" incidentId={INCIDENT_ID} />,
  );
  const command: HTMLElement = await screen.findByText(COMMAND);
  const commandRow: HTMLElement | null = command.closest("li");

  if (!commandRow) {
    throw new Error("The command is not rendered inside a command row.");
  }

  return commandRow;
}

beforeEach(() => {
  getListSpy = jest.spyOn(ModelAPI, "getList");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("CloudDryRunNote", () => {
  const NOW: Date = new Date("2026-10-29T12:00:00.000Z");

  function renderNote(dryRun: AiRemediationCommandDryRun): HTMLElement {
    render(<CloudDryRunNote dryRun={dryRun} now={NOW} />);
    return screen.getByTestId(CLOUD_DRY_RUN_NOTE_TEST_ID);
  }

  test("being checked: a status line, nothing else", () => {
    const note: HTMLElement = renderNote({
      status: AiRemediationDryRunStatus.Running,
      checkedAt: new Date(NOW.getTime() - 30_000).toISOString(),
    });

    expect(note).toHaveAttribute("data-status", "Running");
    expect(note).toHaveAttribute("role", "status");
    expect(note).toHaveTextContent("Checking this change with a dry run…");
  });

  test("would run: says nothing was changed, then what the agent said", () => {
    const note: HTMLElement = renderNote({
      status: AiRemediationDryRunStatus.WouldRun,
      checkedAt: NOW.toISOString(),
      summary: `It would make ecs:UpdateService with desiredCount, and nothing else.\nTo undo it: cloud scale-in ${ECS} --count 2`,
      replaced: { count: "2" },
    });

    expect(note).toHaveAttribute("data-status", "WouldRun");
    expect(
      within(note).getByTestId(`${CLOUD_DRY_RUN_NOTE_TEST_ID}-headline`),
    ).toHaveTextContent(
      /^Dry run .+: this change would run\. Nothing was changed\.$/,
    );
    expect(
      within(note).getByTestId(`${CLOUD_DRY_RUN_NOTE_TEST_ID}-summary`),
    ).toHaveTextContent(`To undo it: cloud scale-in ${ECS} --count 2`);
    expect(note.className).not.toContain("amber");
  });

  test("would be refused: amber, with the agent's reason", () => {
    const note: HTMLElement = renderNote({
      status: AiRemediationDryRunStatus.WouldBeRefused,
      checkedAt: NOW.toISOString(),
      summary: "--count 4 is above 3, the most the ECS service may run.",
    });

    expect(note).toHaveAttribute("data-status", "WouldBeRefused");
    expect(note.className).toContain("amber");
    expect(note).toHaveTextContent("the agent would refuse this change");
    expect(note).toHaveTextContent(
      "--count 4 is above 3, the most the ECS service may run.",
    );
  });

  test("could not finish: says so, with why", () => {
    const note: HTMLElement = renderNote({
      status: AiRemediationDryRunStatus.Failed,
      checkedAt: NOW.toISOString(),
      summary: 'AWS account "prod" has no online Cloud AI agent.',
    });

    expect(note).toHaveAttribute("data-status", "Failed");
    expect(note).toHaveTextContent("it could not finish. Nothing was changed.");
    expect(note).toHaveTextContent("has no online Cloud AI agent");
  });

  test("a dry run still Running five minutes on reads as could not finish", () => {
    const note: HTMLElement = renderNote({
      status: AiRemediationDryRunStatus.Running,
      checkedAt: new Date(NOW.getTime() - 6 * 60_000).toISOString(),
    });

    expect(note).toHaveAttribute("data-status", "Failed");
    expect(note).toHaveTextContent("it could not finish");
  });

  test("its words are the copy's, so the docs and the extractor read the same", () => {
    expect(CLOUD_DRY_RUN_COPY.running).toBe(
      "Checking this change with a dry run…",
    );
    expect(CLOUD_DRY_RUN_COPY.wouldRun).toBe(
      "Dry run {{time}}: this change would run. Nothing was changed.",
    );
    expect(CLOUD_DRY_RUN_COPY.wouldBeRefused).toBe(
      "Dry run {{time}}: the agent would refuse this change. Nothing was changed.",
    );
    expect(CLOUD_DRY_RUN_COPY.failed).toBe(
      "Dry run {{time}}: it could not finish. Nothing was changed.",
    );
    expect(CLOUD_DRY_RUN_COPY.dryRun).toBe("Dry run");
    expect(CLOUD_DRY_RUN_COPY.dryRunAgain).toBe("Dry run again");
  });
});

describe("getCloudDryRunButtonTitle", () => {
  test("Dry run on a waiting fix with a cloud change; Dry run again once one was checked", () => {
    expect(
      getCloudDryRunButtonTitle({
        status: AutoRemediationSuggestionStatus.Suggested,
        plan: { commands: [cloudCommand() as never] },
      }),
    ).toBe("Dry run");
    expect(
      getCloudDryRunButtonTitle({
        status: AutoRemediationSuggestionStatus.Suggested,
        plan: {
          commands: [
            cloudCommand({
              dryRun: {
                status: AiRemediationDryRunStatus.WouldRun,
                checkedAt: minutesAgo(1),
              },
            }) as never,
          ],
        },
      }),
    ).toBe("Dry run again");
  });

  test("nothing for a fix that does not wait, or changes no cloud account", () => {
    for (const status of [
      AutoRemediationSuggestionStatus.Approved,
      AutoRemediationSuggestionStatus.AutoExecuted,
      AutoRemediationSuggestionStatus.Dismissed,
      AutoRemediationSuggestionStatus.Planning,
    ]) {
      expect(
        getCloudDryRunButtonTitle({
          status,
          plan: { commands: [cloudCommand() as never] },
        }),
      ).toBeNull();
    }

    expect(
      getCloudDryRunButtonTitle({
        status: AutoRemediationSuggestionStatus.Suggested,
        plan: {
          commands: [
            cloudCommand({
              resourceType: AiResourceType.DockerHost,
              command: "docker restart web",
            }) as never,
          ],
        },
      }),
    ).toBeNull();
    expect(
      getCloudDryRunButtonTitle({
        status: AutoRemediationSuggestionStatus.Suggested,
        plan: null,
      }),
    ).toBeNull();
  });
});

describe("the Remediation card", () => {
  let postSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    postSpy = jest.spyOn(API, "post");
    jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  });

  function dryRunPosts(): Array<JSONObject> {
    return postSpy.mock.calls
      .map((call: Array<unknown>): JSONObject => {
        return (call[0] || {}) as JSONObject;
      })
      .filter((request: JSONObject): boolean => {
        return String(request["url"]).endsWith("/auto-remediation/dry-run");
      });
  }

  test("shows a change's dry run under it, in place of the note about its undo", async () => {
    const row: HTMLElement = await renderCard(
      suggestion([
        cloudCommand({
          dryRun: {
            status: AiRemediationDryRunStatus.WouldRun,
            checkedAt: minutesAgo(2),
            summary: `To undo it: cloud scale-in ${ECS} --count 2`,
          },
        }),
      ]),
    );

    expect(within(row).getByTestId(CLOUD_DRY_RUN_NOTE_TEST_ID)).toHaveAttribute(
      "data-status",
      "WouldRun",
    );
    expect(
      within(row).queryByText(
        "The agent reads the value this change replaces before it makes it, and OneUptime writes the exact undo from it.",
      ),
    ).not.toBeInTheDocument();
  });

  test("before any dry run, the change says how its undo is written, as before", async () => {
    const row: HTMLElement = await renderCard(suggestion([cloudCommand()]));

    expect(
      within(row).queryByTestId(CLOUD_DRY_RUN_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      within(row).getByText(
        "The agent reads the value this change replaces before it makes it, and OneUptime writes the exact undo from it.",
      ),
    ).toBeInTheDocument();
  });

  test("once the change ran, its outcome is what shows: no dry run", async () => {
    const row: HTMLElement = await renderCard(
      suggestion(
        [
          cloudCommand({
            dryRun: {
              status: AiRemediationDryRunStatus.WouldRun,
              checkedAt: minutesAgo(5),
            },
            execution: {
              status: AiRemediationCommandExecutionStatus.Succeeded,
              exitCode: 0,
            },
          }),
        ],
        AutoRemediationSuggestionStatus.Approved,
      ),
    );

    expect(
      within(row).queryByTestId(CLOUD_DRY_RUN_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("remediation-dry-run-button"),
    ).not.toBeInTheDocument();
  });

  test("Dry run sits beside Approve & Run, and posts the dry run once", async () => {
    postSpy.mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}));
    await renderCard(suggestion([cloudCommand()]));

    const button: HTMLElement = screen.getByTestId(
      "remediation-dry-run-button",
    );

    expect(button).toHaveTextContent("Dry run");
    expect(
      screen.getByTestId("remediation-approve-button"),
    ).toBeInTheDocument();

    act(() => {
      button.click();
      button.click();
    });

    await waitFor(() => {
      expect(getListSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    expect(dryRunPosts()).toHaveLength(1);
    expect(dryRunPosts()[0]!["data"]).toEqual({ suggestionId: SUGGESTION_ID });
  });

  test("Dry run again once a change was checked, disabled while a dry run is on its way", async () => {
    await renderCard(
      suggestion([
        cloudCommand({
          dryRun: {
            status: AiRemediationDryRunStatus.Running,
            checkedAt: minutesAgo(0.5),
          },
        }),
      ]),
    );

    const button: HTMLElement = screen.getByTestId(
      "remediation-dry-run-button",
    );

    expect(button).toHaveTextContent("Dry run again");
    expect(button).toBeDisabled();
    // Approving does not wait for the dry run.
    expect(screen.getByTestId("remediation-approve-button")).not.toBeDisabled();
  });

  test("no Dry run on a fix that changes no cloud account", async () => {
    serve(
      suggestion([
        cloudCommand({
          resourceType: AiResourceType.DockerHost,
          runnerNameSnapshot: "Docker AI agent",
          command: "docker restart web",
        }),
      ]),
    );
    render(
      <RemediationStep
        investigationStage="reported"
        incidentId={INCIDENT_ID}
      />,
    );
    await screen.findByText("docker restart web");

    expect(
      screen.queryByTestId("remediation-dry-run-button"),
    ).not.toBeInTheDocument();
  });

  test("polls while a dry run is on its way, so its answer lands", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });

    await renderCard(
      suggestion([
        cloudCommand({
          dryRun: {
            status: AiRemediationDryRunStatus.Running,
            checkedAt: new Date().toISOString(),
          },
        }),
      ]),
    );

    const before: number = getListSpy.mock.calls.length;

    await act(async () => {
      jest.advanceTimersByTime(16_000);
    });

    expect(getListSpy.mock.calls.length).toBeGreaterThan(before);
  });

  test("a refused dry run says nothing was changed", () => {
    expect(getActionErrorTitle("dry-run")).toBe(
      "Could not start the dry run: nothing was changed",
    );
  });
});
