import RemediationChatMessage, {
  describeTrackRecordLine,
  getTrackRecordRunKey,
  RemediationChatFix,
  TrackRecordRunLinks,
} from "../../../../Server/Utils/AutoRemediation/RemediationChatMessage";
import WorkspaceRemediationActions, {
  RemediationApprovalDialog,
} from "../../../../Server/Utils/Workspace/WorkspaceRemediationActions";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import { MessageBlocksByWorkspaceType } from "../../../../Server/Services/WorkspaceNotificationRuleService";
import logger from "../../../../Server/Utils/Logger";
import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../../Models/DatabaseModels/Incident";
import URL from "../../../../Types/API/URL";
import {
  AiRemediationCommand,
  AiRemediationCommandPolicyVerdict,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  RemediationTrackRecord,
  RemediationTrackRecordOutcome,
  serializeRemediationTrackRecord,
} from "../../../../Types/AutoRemediation/RemediationTrackRecord";
import { JSONObject } from "../../../../Types/JSON";
import { KubectlCommandTier } from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../../Types/ObjectID";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Contract under test - how the same change, or the same runbook, went
 * before, in a fix's Slack and Microsoft Teams message (#5519's follow-ups):
 *
 *  - the incidents and alerts a track record names are links to their
 *    pages in OneUptime, as the AI card links them - each page built once,
 *    a run whose page cannot be built named as text, a run without a
 *    number not named;
 *  - Slack draws them as its own links, Teams as Markdown links in the
 *    change's text block;
 *  - a runbook fix's message carries how its runbook went before, under
 *    the line that names it, and its approval dialog too, a paragraph each
 *    in Teams;
 *  - a fix with no record is what it was.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000c1",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-0000000000c2",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "30000000-0000-4000-8000-0000000000c3",
);
const EARLIER_INCIDENT: string = "40000000-0000-4000-8000-0000000000c4";
const EARLIER_ALERT: string = "50000000-0000-4000-8000-0000000000c5";
const RUNBOOK_ID: ObjectID = new ObjectID(
  "60000000-0000-4000-8000-0000000000c6",
);
const DASHBOARD: string = `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}`;

const RECORD: RemediationTrackRecord = {
  workedCount: 1,
  didNotWorkCount: 1,
  runs: [
    {
      subjectKind: "incident",
      subjectId: EARLIER_INCIDENT,
      subjectNumber: "INC-41",
      ranAt: "2026-10-28T10:00:00.000Z",
      outcome: RemediationTrackRecordOutcome.Worked,
    },
    {
      subjectKind: "alert",
      subjectId: EARLIER_ALERT,
      subjectNumber: "#305",
      ranAt: "2026-10-20T10:00:00.000Z",
      outcome: RemediationTrackRecordOutcome.DidNotWork,
    },
  ],
};

// A change with RECORD, or with no record at all (null).
function kubectlChange(
  trackRecord: RemediationTrackRecord | null = RECORD,
): AiRemediationCommand {
  return {
    sequence: 1,
    stepType: RunbookStepType.Kubectl,
    runnerId: "70000000-0000-4000-8000-0000000000c7",
    runnerNameSnapshot: "Kubernetes AI agent",
    kubernetesClusterId: "80000000-0000-4000-8000-0000000000c8",
    kubernetesClusterNameSnapshot: "prod-eu-west-1",
    kubectlTier: KubectlCommandTier.SafeWrite,
    command: "kubectl rollout restart deployment/web -n shop",
    timeoutInMs: 60000,
    rationale: "Pods hold a stale config.",
    expectedEffect: "Fresh pods pick it up.",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    ...(trackRecord ? { trackRecord } : {}),
  };
}

function commandFix(
  commands: Array<AiRemediationCommand> = [kubectlChange()],
): RemediationChatFix {
  return {
    suggestionId: SUGGESTION_ID,
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    commandPlan: { commands },
    verificationWindowMinutes: 15,
  };
}

// A runbook fix with RECORD, or with no record at all (null).
function runbookFix(
  runbookTrackRecord: RemediationTrackRecord | null = RECORD,
): RemediationChatFix {
  return {
    suggestionId: SUGGESTION_ID,
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    suggestionType: AutoRemediationSuggestionType.Runbook,
    runbookId: RUNBOOK_ID,
    runbookName: "Restart checkout",
    ...(runbookTrackRecord ? { runbookTrackRecord } : {}),
    verificationWindowMinutes: 15,
  };
}

function textsOf(
  blocks: Array<MessageBlocksByWorkspaceType>,
  workspaceType: WorkspaceType,
): Array<string> {
  return blocks
    .find((each: MessageBlocksByWorkspaceType): boolean => {
      return each.workspaceType === workspaceType;
    })!
    .messageBlocks.filter((block: WorkspaceMessageBlock): boolean => {
      return block._type === "WorkspacePayloadMarkdown";
    })
    .map((block: WorkspaceMessageBlock): string => {
      return (block as WorkspacePayloadMarkdown).text;
    });
}

let incidentLinks: jest.SpyInstance;
let alertLinks: jest.SpyInstance;

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  incidentLinks = jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockImplementation(
      async (projectId: ObjectID, incidentId: ObjectID): Promise<URL> => {
        return URL.fromString(
          `https://oneuptime.example.com/dashboard/${projectId.toString()}/incidents/${incidentId.toString()}`,
        );
      },
    );
  alertLinks = jest
    .spyOn(AlertService, "getAlertLinkInDashboard")
    .mockImplementation(
      async (projectId: ObjectID, alertId: ObjectID): Promise<URL> => {
        return URL.fromString(
          `https://oneuptime.example.com/dashboard/${projectId.toString()}/alerts/${alertId.toString()}`,
        );
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a track record's line", () => {
  test("names each run as a link to its page when one was built", () => {
    const links: TrackRecordRunLinks = new Map<string, URL>([
      [
        getTrackRecordRunKey(RECORD.runs[0]!),
        URL.fromString(`${DASHBOARD}/incidents/${EARLIER_INCIDENT}`),
      ],
      [
        getTrackRecordRunKey(RECORD.runs[1]!),
        URL.fromString(`${DASHBOARD}/alerts/${EARLIER_ALERT}`),
      ],
    ]);

    expect(describeTrackRecordLine(RECORD, links).toString()).toBe(
      `⚠️ Worked 1 of the 2 times it ran here before ([INC-41](${DASHBOARD}/incidents/${EARLIER_INCIDENT}), [#305](${DASHBOARD}/alerts/${EARLIER_ALERT})).`,
    );
  });

  test("names a run as text when its page could not be built, and leaves an unnumbered run out", () => {
    expect(describeTrackRecordLine(RECORD).toString()).toBe(
      "⚠️ Worked 1 of the 2 times it ran here before (INC-41, \\#305).",
    );
    expect(
      describeTrackRecordLine({
        workedCount: 2,
        didNotWorkCount: 0,
        runs: [{ ...RECORD.runs[0]!, subjectNumber: undefined }],
      }).toString(),
    ).toBe("✅ Worked both times it ran here before.");
  });

  test("a run's key is its kind and its record's id, whatever its case", () => {
    expect(
      getTrackRecordRunKey({
        ...RECORD.runs[0]!,
        subjectId: EARLIER_INCIDENT.toUpperCase(),
      }),
    ).toBe(`incident:${EARLIER_INCIDENT}`);
  });
});

describe("the pages a fix's track records name", () => {
  test("are built once each, for a change's runs and a runbook's", async () => {
    const links: TrackRecordRunLinks =
      await RemediationChatMessage.getTrackRecordRunLinks(
        commandFix([kubectlChange(), { ...kubectlChange(), sequence: 2 }]),
      );

    expect(links.get(getTrackRecordRunKey(RECORD.runs[0]!))?.toString()).toBe(
      `${DASHBOARD}/incidents/${EARLIER_INCIDENT}`,
    );
    expect(links.get(getTrackRecordRunKey(RECORD.runs[1]!))?.toString()).toBe(
      `${DASHBOARD}/alerts/${EARLIER_ALERT}`,
    );
    expect(incidentLinks).toHaveBeenCalledTimes(1);
    expect(alertLinks).toHaveBeenCalledTimes(1);

    const runbook: TrackRecordRunLinks =
      await RemediationChatMessage.getTrackRecordRunLinks(runbookFix());

    expect(runbook.size).toBe(2);
  });

  test("a run with no number or no id builds none; one that fails is left out", async () => {
    alertLinks.mockRejectedValue(new Error("no host"));

    const links: TrackRecordRunLinks =
      await RemediationChatMessage.getTrackRecordRunLinks(
        runbookFix({
          workedCount: 3,
          didNotWorkCount: 0,
          runs: [
            { ...RECORD.runs[0]!, subjectNumber: undefined },
            { ...RECORD.runs[0]!, subjectId: "not-an-id" },
            RECORD.runs[1]!,
          ],
        }),
      );

    expect(links.size).toBe(0);
    expect(incidentLinks).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "could not build the link of a track record's run",
      ),
    );
  });
});

describe("a change's track record, linked, as each chat draws it", () => {
  test("Slack draws the runs as its own links", async () => {
    const blocks: Array<MessageBlocksByWorkspaceType> =
      await RemediationChatMessage.getApprovalBlocks(commandFix());
    const markdown: string = textsOf(blocks, WorkspaceType.Slack)[0]!;

    expect(markdown).toContain(
      `([INC-41](${DASHBOARD}/incidents/${EARLIER_INCIDENT}), [#305](${DASHBOARD}/alerts/${EARLIER_ALERT})).`,
    );

    const drawn: string = JSON.stringify(
      SlackUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: blocks.find((each: MessageBlocksByWorkspaceType) => {
          return each.workspaceType === WorkspaceType.Slack;
        })!.messageBlocks,
      }),
    );

    expect(drawn).toContain(
      `<${DASHBOARD}/incidents/${EARLIER_INCIDENT}|INC-41>`,
    );
    expect(drawn).toContain(`<${DASHBOARD}/alerts/${EARLIER_ALERT}|#305>`);
  });

  test("Teams draws them as links in the change's own text block, its line a paragraph", async () => {
    const blocks: Array<MessageBlocksByWorkspaceType> =
      await RemediationChatMessage.getApprovalBlocks(commandFix());
    const drawn: JSONObject =
      MicrosoftTeamsUtil.buildAdaptiveCardFromMessageBlocks({
        messageBlocks: blocks.find((each: MessageBlocksByWorkspaceType) => {
          return each.workspaceType === WorkspaceType.MicrosoftTeams;
        })!.messageBlocks,
      });
    const change: string = String(
      (drawn["body"] as Array<JSONObject>)[0]!["text"],
    );

    expect(change.split("\n\n")).toEqual([
      '**1.** Safe change on cluster "prod-eu-west-1"',
      "`kubectl rollout restart deployment/web -n shop`",
      `⚠️ Worked 1 of the 2 times it ran here before ([INC-41](${DASHBOARD}/incidents/${EARLIER_INCIDENT}), [#305](${DASHBOARD}/alerts/${EARLIER_ALERT})).`,
    ]);
  });

  test("a change with no record is what it was", async () => {
    const blocks: Array<MessageBlocksByWorkspaceType> =
      await RemediationChatMessage.getApprovalBlocks(
        commandFix([kubectlChange(null)]),
      );

    expect(textsOf(blocks, WorkspaceType.Slack)[0]).not.toContain(
      "ran here before",
    );
    expect(incidentLinks).toHaveBeenCalledTimes(1);
  });
});

describe("a runbook fix says how its runbook went before", () => {
  test("its message carries the record line in both chats, the runbook named once", async () => {
    const blocks: Array<MessageBlocksByWorkspaceType> =
      await RemediationChatMessage.getApprovalBlocks(runbookFix());

    for (const workspaceType of [
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
    ]) {
      const texts: Array<string> = textsOf(blocks, workspaceType);

      expect(texts).toEqual([
        `⚠️ Worked 1 of the 2 times it ran here before ([INC-41](${DASHBOARD}/incidents/${EARLIER_INCIDENT}), [#305](${DASHBOARD}/alerts/${EARLIER_ALERT})).`,
      ]);
      expect(texts.join("")).not.toContain("Restart checkout");
    }
  });

  test("a runbook that never ran before carries nothing above its buttons, as before", async () => {
    const blocks: Array<MessageBlocksByWorkspaceType> =
      await RemediationChatMessage.getApprovalBlocks(runbookFix(null));

    expect(textsOf(blocks, WorkspaceType.Slack)).toEqual([]);
    expect(textsOf(blocks, WorkspaceType.MicrosoftTeams)).toEqual([]);
  });

  test("its dialog names the runbook, then how it went, a paragraph each in Teams", () => {
    const parts: Array<string> = RemediationChatMessage.describeApprovalParts({
      fix: runbookFix(),
      subjectName: "Incident INC-42",
      subjectTitle: "Checkout is down",
      workspaceType: WorkspaceType.MicrosoftTeams,
    }).map((part: { toString: () => string }): string => {
      return part.toString();
    });

    expect(parts[1]!.split("\n\n")).toEqual([
      "Runbook **Restart checkout**",
      "⚠️ Worked 1 of the 2 times it ran here before (INC-41, \\#305).",
    ]);

    expect(
      RemediationChatMessage.describeApproval({
        fix: runbookFix(),
        subjectName: "Incident INC-42",
      }).toString(),
    ).toContain(
      "Runbook **Restart checkout**\n⚠️ Worked 1 of the 2 times it ran here before",
    );
  });

  test("the suggestion's stored record is read back for the message and the dialog", () => {
    const suggestion: AutoRemediationSuggestion = new AutoRemediationSuggestion(
      SUGGESTION_ID,
    );
    suggestion.projectId = PROJECT_ID;
    suggestion.incidentId = INCIDENT_ID;
    suggestion.suggestionType = AutoRemediationSuggestionType.Runbook;
    suggestion.runbookId = RUNBOOK_ID;
    suggestion.runbookNameSnapshot = "Restart checkout";
    suggestion.runbookTrackRecord = serializeRemediationTrackRecord(RECORD);

    expect(
      RemediationChatMessage.fromSuggestion(suggestion)?.runbookTrackRecord,
    ).toEqual(RECORD);

    suggestion.runbookTrackRecord = { workedCount: "many" } as JSONObject;

    expect(
      RemediationChatMessage.fromSuggestion(suggestion)?.runbookTrackRecord,
    ).toBeUndefined();
  });

  test("Review and approve's dialog links the runs, and reads the record with the fix", async () => {
    const findOneBy: jest.SpyInstance = jest
      .spyOn(AutoRemediationSuggestionService, "findOneBy")
      .mockResolvedValue(
        (() => {
          const suggestion: AutoRemediationSuggestion =
            new AutoRemediationSuggestion(SUGGESTION_ID);
          suggestion.projectId = PROJECT_ID;
          suggestion.incidentId = INCIDENT_ID;
          suggestion.status = AutoRemediationSuggestionStatus.Suggested;
          suggestion.suggestionType = AutoRemediationSuggestionType.Runbook;
          suggestion.runbookId = RUNBOOK_ID;
          suggestion.runbookNameSnapshot = "Restart checkout";
          suggestion.runbookTrackRecord =
            serializeRemediationTrackRecord(RECORD);
          return suggestion;
        })(),
      );
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(
      (() => {
        const incident: Incident = new Incident(INCIDENT_ID);
        incident.incidentNumber = 42;
        incident.title = "Checkout is down";
        return incident;
      })(),
    );

    const suggestion: AutoRemediationSuggestion | null =
      await WorkspaceRemediationActions.readFix({
        suggestionId: SUGGESTION_ID,
        projectId: PROJECT_ID,
      });

    expect(
      (findOneBy.mock.calls[0]![0] as { select: JSONObject }).select[
        "runbookTrackRecord"
      ],
    ).toBe(true);

    const dialog: RemediationApprovalDialog | null =
      await WorkspaceRemediationActions.getApprovalDialog(suggestion!);

    expect(dialog?.markdown).toContain(
      `([INC-41](${DASHBOARD}/incidents/${EARLIER_INCIDENT}), [#305](${DASHBOARD}/alerts/${EARLIER_ALERT})).`,
    );
    expect(dialog?.teamsParts.join("\n")).toContain(
      `[INC-41](${DASHBOARD}/incidents/${EARLIER_INCIDENT})`,
    );
  });
});
