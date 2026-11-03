import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
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
import RemediationTrackRecordLine, {
  TRACK_RECORD_RUN_LINK_CLASS_NAMES,
  TRACK_RECORD_RUN_TITLES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationTrackRecordLine";
import {
  REMEDIATION_FIX_FACT_ALARMING_TEXT_CLASS_NAME,
  REMEDIATION_FIX_FACT_TEXT_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationFixFact";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import {
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPolicyVerdict,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  RemediationTrackRecord,
  RemediationTrackRecordOutcome,
} from "../../../Types/AutoRemediation/RemediationTrackRecord";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { openRemediationFixes } from "./RemediationFixHarness";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * WHAT THE PERSON APPROVING A FIX SEES OF ITS CHANGES (RemediationStep):
 *
 *  - a cloud change says what it does in plain words above its exact
 *    command - "Scale the ECS service web out to 4 tasks" - read from the
 *    command, never from the model's words; any other change has no such
 *    line, and its command is what it was;
 *  - a change that waits for approval says how the same change went the
 *    last times it ran here (RemediationTrackRecordLine): its words, a dot
 *    coloured by how it went - red words when it never worked - and the
 *    incidents and alerts it ran for, kept together, each a link to its
 *    page that says how that run went (its title) and is red when that
 *    run did not work;
 *  - once the change has run, its outcome is what it says, and the record
 *    is gone; a record that cannot be read is no line.
 */

const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-3333-4aaa-8bbb-000000000013",
);
const SUGGESTION_ID: string = "0193c0de-6666-4aaa-8bbb-000000000016";
const ACCOUNT_ID: string = "0193c0de-7777-4aaa-8bbb-000000000017";
const AGENT_ID: string = "0193c0de-8888-4aaa-8bbb-000000000018";
const CLUSTER_ID: string = "0193c0de-9999-4aaa-8bbb-000000000019";
const EARLIER_INCIDENT_ID: string = "0193c0de-aaaa-4aaa-8bbb-00000000001a";
const EARLIER_ALERT_ID: string = "0193c0de-bbbb-4aaa-8bbb-00000000001b";
const ECS: string = "arn:aws:ecs:us-east-1:123456789012:service/prod/web";
const CLOUD_COMMAND: string = `cloud scale-out ${ECS} --count 4`;
const KUBECTL_COMMAND: string =
  "kubectl rollout restart deployment/web -n shop";

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

function cloudCommand(overrides: JSONObject = {}): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.ResourceCommand,
    runnerId: AGENT_ID,
    runnerNameSnapshot: "Cloud AI agent",
    resourceType: AiResourceType.AwsAccount,
    resourceId: ACCOUNT_ID,
    resourceNameSnapshot: "prod",
    resourceCommandTier: "SafeWrite",
    command: CLOUD_COMMAND,
    timeoutInMs: 60000,
    rationale: "Tasks are saturated.",
    expectedEffect: "Latency drops.",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    trackRecord: record() as unknown as JSONObject,
    ...overrides,
  };
}

function kubectlCommand(overrides: JSONObject = {}): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.Kubectl,
    runnerId: AGENT_ID,
    runnerNameSnapshot: "Kubernetes AI agent",
    kubernetesClusterId: CLUSTER_ID,
    kubernetesClusterNameSnapshot: "prod-east",
    kubectlTier: KubectlCommandTier.SafeWrite,
    command: KUBECTL_COMMAND,
    timeoutInMs: 60000,
    rationale: "Pods hold a stale config.",
    expectedEffect: "Fresh pods pick up the config.",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    ...overrides,
  };
}

function fix(
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
    createdAt: new Date("2026-10-30T10:00:00Z"),
  });
}

async function renderCommandRow(
  row: AutoRemediationSuggestion,
  command: string,
): Promise<HTMLElement> {
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (data: {
    modelType: unknown;
  }): Promise<ListResult<AutoRemediationSuggestion>> => {
    // The step reads its decisions beside its fixes: none here.
    if (data.modelType !== AutoRemediationSuggestion) {
      return { data: [], count: 0, skip: 0, limit: 5 };
    }

    return { data: [row], count: 1, skip: 0, limit: 10 };
  }) as never);

  render(
    <RemediationStep investigationStage="reported" incidentId={INCIDENT_ID} />,
  );
  // Folded to its sentence: opened, as a reader does.
  await openRemediationFixes();

  const shown: HTMLElement = await screen.findByText(command);
  const commandRow: HTMLElement | null = shown.closest("li");

  if (!commandRow) {
    throw new Error("The command is not rendered inside a command row.");
  }

  return commandRow;
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID.toString()}`);
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("RemediationTrackRecordLine", () => {
  test("a change that always worked: its words after a green dot, and the runs it fixed, each linked", () => {
    render(<RemediationTrackRecordLine record={record()} />);

    const line: HTMLElement = screen.getByTestId(
      "remediation-command-track-record",
    );
    expect(line).toHaveAttribute("data-tone", "Worked");
    expect(
      screen.getByTestId("remediation-command-track-record-text"),
    ).toHaveTextContent("Worked all 3 times it ran here before");

    const fact: HTMLElement = screen.getByTestId(
      "remediation-command-track-record-text",
    ).parentElement!;
    expect(fact).toHaveClass(REMEDIATION_FIX_FACT_TEXT_CLASS_NAME);
    expect(fact).not.toHaveClass(REMEDIATION_FIX_FACT_ALARMING_TEXT_CLASS_NAME);

    const dot: HTMLElement = fact.querySelector("[aria-hidden='true']")!;
    expect(dot).toHaveClass("rounded-full", "bg-emerald-500");
    expect(dot).toBeEmptyDOMElement();

    const runs: Array<HTMLElement> = screen.getAllByTestId(
      "remediation-track-record-run",
    );
    expect(
      runs.map((run: HTMLElement): string => {
        return run.textContent || "";
      }),
    ).toEqual(["INC-41", "#305"]);
    expect(runs[0]!.getAttribute("href")).toBe(
      `/dashboard/${PROJECT_ID}/incidents/${EARLIER_INCIDENT_ID}`,
    );
    expect(runs[1]!.getAttribute("href")).toBe(
      `/dashboard/${PROJECT_ID}/alerts/${EARLIER_ALERT_ID}`,
    );
    // The link says how its run went: a screen reader reads it with it.
    expect(runs[0]).toHaveAttribute("title", "Worked here");
    expect(runs[0]).toHaveClass("text-indigo-600");
    expect(runs[0]).not.toHaveClass("text-rose-700");

    // The runs stay together, apart from the sentence.
    const group: HTMLElement = screen.getByTestId(
      "remediation-track-record-runs",
    );
    expect(
      within(group).getAllByTestId("remediation-track-record-run"),
    ).toEqual(runs);
    expect(group).toHaveClass("inline-flex", "flex-wrap");
    expect(line).toContainElement(group);
  });

  test("a change that never worked here is said in red, after a red dot", () => {
    render(
      <RemediationTrackRecordLine
        record={record({
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
        })}
      />,
    );

    expect(
      screen.getByTestId("remediation-command-track-record"),
    ).toHaveAttribute("data-tone", "DidNotWork");

    const text: HTMLElement = screen.getByTestId(
      "remediation-command-track-record-text",
    );
    expect(text).toHaveTextContent(
      "Didn't work either time it ran here before",
    );
    expect(text.parentElement!).toHaveClass(
      REMEDIATION_FIX_FACT_ALARMING_TEXT_CLASS_NAME,
    );
    expect(
      text.parentElement!.querySelector("[aria-hidden='true']"),
    ).toHaveClass("bg-rose-500");
    const run: HTMLElement = screen.getByTestId("remediation-track-record-run");
    expect(run).toHaveAttribute(
      "title",
      TRACK_RECORD_RUN_TITLES[RemediationTrackRecordOutcome.DidNotWork],
    );
    expect(run).toHaveClass("text-rose-700");
  });

  test("worked some times: the runs that did not work are the red links", () => {
    render(
      <RemediationTrackRecordLine
        record={record({
          workedCount: 2,
          didNotWorkCount: 1,
          runs: [
            {
              subjectKind: "incident",
              subjectId: EARLIER_INCIDENT_ID,
              subjectNumber: "INC-41",
              ranAt: "2026-10-28T10:00:00.000Z",
              outcome: RemediationTrackRecordOutcome.DidNotWork,
            },
            {
              subjectKind: "alert",
              subjectId: EARLIER_ALERT_ID,
              subjectNumber: "#305",
              ranAt: "2026-10-20T10:00:00.000Z",
              outcome: RemediationTrackRecordOutcome.Worked,
            },
          ],
        })}
      />,
    );

    const [failed, worked] = screen.getAllByTestId(
      "remediation-track-record-run",
    ) as [HTMLElement, HTMLElement];

    expect(failed).toHaveTextContent("INC-41");
    expect(failed).toHaveAttribute("title", "Didn't work here");
    for (const name of TRACK_RECORD_RUN_LINK_CLASS_NAMES[
      RemediationTrackRecordOutcome.DidNotWork
    ].split(" ")) {
      expect(failed).toHaveClass(name);
    }

    expect(worked).toHaveTextContent("#305");
    expect(worked).toHaveAttribute("title", "Worked here");
    for (const name of TRACK_RECORD_RUN_LINK_CLASS_NAMES[
      RemediationTrackRecordOutcome.Worked
    ].split(" ")) {
      expect(worked).toHaveClass(name);
    }
    expect(worked).not.toHaveClass("text-rose-700");
  });

  test("worked some times and not others: amber, and a run without a number is counted, not linked", () => {
    render(
      <RemediationTrackRecordLine
        record={record({
          workedCount: 2,
          didNotWorkCount: 1,
          runs: [
            {
              subjectKind: "incident",
              subjectId: EARLIER_INCIDENT_ID,
              ranAt: "2026-10-28T10:00:00.000Z",
              outcome: RemediationTrackRecordOutcome.DidNotWork,
            },
          ],
        })}
      />,
    );

    const text: HTMLElement = screen.getByTestId(
      "remediation-command-track-record-text",
    );
    expect(text).toHaveTextContent(
      "Worked 2 of the 3 times it ran here before",
    );
    expect(
      text.parentElement!.querySelector("[aria-hidden='true']"),
    ).toHaveClass("bg-amber-500");
    expect(
      screen.queryAllByTestId("remediation-track-record-run"),
    ).toHaveLength(0);
    // Nothing to keep together: no empty group.
    expect(
      screen.queryByTestId("remediation-track-record-runs"),
    ).not.toBeInTheDocument();
  });
});

describe("a cloud change on the Remediation step", () => {
  test("says what it does in plain words above its exact command, and how it went before under it", async () => {
    const row: HTMLElement = await renderCommandRow(
      fix([cloudCommand()]),
      CLOUD_COMMAND,
    );

    const words: HTMLElement = within(row).getByTestId(
      "remediation-command-words",
    );
    expect(words).toHaveTextContent("Scale the ECS service web out to 4 tasks");
    expect(words).toHaveAttribute("dir", "auto");

    const command: HTMLElement = within(row).getByText(CLOUD_COMMAND);
    const trackRecord: HTMLElement = within(row).getByTestId(
      "remediation-command-track-record",
    );

    // The words first, then the command that runs, then how it went before.
    expect(
      words.compareDocumentPosition(command) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      command.compareDocumentPosition(trackRecord) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(trackRecord).toHaveTextContent(
      "Worked all 3 times it ran here before",
    );
    // The expected effect is a sentence with the effect set into it.
    expect(
      within(row).getByTestId("remediation-command-expected-effect"),
    ).toHaveTextContent("Expected effect: Latency drops.");
  });

  test("once it ran, its outcome speaks, and the record is gone", async () => {
    const row: HTMLElement = await renderCommandRow(
      fix(
        [
          cloudCommand({
            execution: {
              status: AiRemediationCommandExecutionStatus.Succeeded,
            },
          }),
        ],
        AutoRemediationSuggestionStatus.Approved,
      ),
      CLOUD_COMMAND,
    );

    expect(
      within(row).getByTestId("remediation-command-words"),
    ).toHaveTextContent("Scale the ECS service web out to 4 tasks");
    expect(
      within(row).queryByTestId("remediation-command-track-record"),
    ).not.toBeInTheDocument();
  });

  test("the fix's source is set apart, so an English name keeps its quotes on a right-to-left page", async () => {
    await renderCommandRow(fix([cloudCommand()]), CLOUD_COMMAND);

    const source: HTMLElement = screen.getByTestId("remediation-fix-source");
    const isolated: Element | null = source.firstElementChild;

    expect(isolated?.tagName).toBe("BDI");
    expect(isolated).toHaveTextContent('AI remediation for AWS account "prod"');
  });

  test("a record that cannot be read is no line", async () => {
    const row: HTMLElement = await renderCommandRow(
      fix([cloudCommand({ trackRecord: { workedCount: "many" } })]),
      CLOUD_COMMAND,
    );

    expect(
      within(row).queryByTestId("remediation-command-track-record"),
    ).not.toBeInTheDocument();
  });

  test("a command the catalog has no sentence for keeps its command alone", async () => {
    const unknown: string = `cloud describe-service ${ECS}`;
    const row: HTMLElement = await renderCommandRow(
      fix([cloudCommand({ command: unknown, trackRecord: undefined })]),
      unknown,
    );

    expect(
      within(row).queryByTestId("remediation-command-words"),
    ).not.toBeInTheDocument();
  });
});

describe("any other change", () => {
  test("a kubectl change has no plain-words line, and shows its track record the same way", async () => {
    const row: HTMLElement = await renderCommandRow(
      Object.assign(
        fix([
          kubectlCommand({
            trackRecord: record({
              workedCount: 1,
              runs: [],
            }) as unknown as JSONObject,
          }),
        ]),
        {
          resourceType: undefined,
          resourceId: undefined,
          kubernetesClusterId: new ObjectID(CLUSTER_ID),
          ruleNameSnapshot: 'AI remediation for cluster "prod-east"',
        },
      ),
      KUBECTL_COMMAND,
    );

    expect(
      within(row).queryByTestId("remediation-command-words"),
    ).not.toBeInTheDocument();
    expect(
      within(row).getByTestId("remediation-command-track-record-text"),
    ).toHaveTextContent("Worked the one time it ran here before");
  });
});
