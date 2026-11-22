import User from "../../../../Models/DatabaseModels/User";
import UserService from "../../../../Server/Services/UserService";
import SecurityPlaybookApprovalReader, {
  SecurityPlaybookApprovalRound,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookApprovalReader";
import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceSecurityPlaybookApproval, {
  SecurityPlaybookApprovalMessage,
} from "../../../../Server/Utils/Workspace/WorkspaceSecurityPlaybookApproval";
import ObjectID from "../../../../Types/ObjectID";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus, {
  SecurityPlaybookStepStatus,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  SecurityPlaybookApprovalDecision,
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import SecurityPlaybookTrigger from "../../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import {
  SecurityPlaybookApprovalAsk,
  SecurityPlaybookApprovalEvidenceKind,
  SecurityPlaybookApprovalProgress,
  SecurityPlaybookApprovalSource,
  SecurityPlaybookApprovalSourceKind,
  SecurityPlaybookApprovalStanding,
  SecurityPlaybookApprovalStandingKind,
} from "../../../../Utils/SecurityPlaybook/SecurityPlaybookApprovalWords";
import {
  FEED_MEMBER_CASES,
  FeedPersonCase,
  expectNoAddressIn,
  feedPersonAccount,
  nameAsEveryChatShowsIt,
} from "../../../Helpers/FeedPersonCases";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A PLAYBOOK STEP'S APPROVAL NAMES WHO ASKED FOR IT, WHO DECIDED IT AND WHO
 * UNDID A TARGET WITHOUT THEIR ADDRESS (#10681).
 *
 * A step waiting for approval is posted to the case's Slack and Microsoft
 * Teams channels with its buttons, sent to each approver, and emailed to
 * them, and every copy is kept up to date as it is decided and undone.
 * Each says who started the run by hand, who approved or rejected it and
 * who undid a target - by their name, else their address. Each of them
 * acted on the run, so each is a member, named as every line names one
 * now (FeedPersonName.getMemberName): by their name, else the part of
 * their address before the "@".
 *
 * The approval reader's own code reads the people; only the account it
 * reads is answered here, and the messages are the ones each chat is sent.
 */

const PERSON_ID: ObjectID = new ObjectID(
  "10681ccc-0000-4000-8000-0000000000a1",
);

const ROUND: SecurityPlaybookApprovalRound = {
  projectId: new ObjectID("10681ccc-0000-4000-8000-000000000001"),
  runId: new ObjectID("10681ccc-0000-4000-8000-000000000002"),
  securityCaseId: new ObjectID("10681ccc-0000-4000-8000-000000000003"),
  stepIndex: 0,
  stepId: "contain",
  targetsDigest: "abcdefghijklmnopqrstuv",
};

const DECIDED_AT: string = "2026-11-22T08:00:00.000Z";

let account: User | null;

beforeEach(() => {
  account = null;

  jest.spyOn(UserService, "findOneById").mockImplementation((async () => {
    return account;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The approval of a step whose run `source` started and `standing` decided.
function askOf(data: {
  source: SecurityPlaybookApprovalSource;
  standing: SecurityPlaybookApprovalStanding;
  undoneByName?: string | undefined;
}): SecurityPlaybookApprovalAsk {
  return {
    caseNumber: "SEC-12",
    caseTitle: "Credential stuffing",
    caseUrl: "https://oneuptime.example/dashboard/case",
    action: SecurityPlaybookActionType.SuspendOktaUser,
    connectionName: "Okta",
    // What the step acts on: the case's own accounts, not OneUptime's people.
    targets: [
      {
        value: "mallory",
        reason: SecurityPlaybookTargetReason.GroupedOn,
        state: data.undoneByName
          ? SecurityPlaybookTargetState.Undone
          : SecurityPlaybookTargetState.Proposed,
        ...(data.undoneByName
          ? { undoneByName: data.undoneByName, undoneAt: new Date(DECIDED_AT) }
          : {}),
      },
    ],
    source: data.source,
    evidence: [{ kind: SecurityPlaybookApprovalEvidenceKind.NotProtected }],
    undoAction: SecurityPlaybookActionType.UnsuspendOktaUser,
    standing: data.standing,
  };
}

// What `workspaceType` is sent of the message, as JSON.
function sentTo(
  workspaceType: WorkspaceType,
  ask: SecurityPlaybookApprovalAsk,
): string {
  const message: SecurityPlaybookApprovalMessage =
    WorkspaceSecurityPlaybookApproval.getMessage({
      ask,
      round: ROUND,
      workspaceType,
    });

  return JSON.stringify(
    workspaceType === WorkspaceType.Slack
      ? {
          blocks: SlackUtil.getBlocksFromWorkspaceMessagePayload({
            messageBlocks: message.messageBlocks,
          }),
          text: message.notificationText,
        }
      : {
          card: MicrosoftTeamsUtil.buildAdaptiveCardFromMessageBlocks({
            messageBlocks: message.messageBlocks,
          }),
          text: message.notificationText,
        },
  );
}

describe.each(FEED_MEMBER_CASES)("$label", (who: FeedPersonCase) => {
  test("is named as every line names a member", async () => {
    account = feedPersonAccount(PERSON_ID, who);

    expect(await SecurityPlaybookApprovalReader.getPersonName(PERSON_ID)).toBe(
      who.named,
    );
    expect(
      await SecurityPlaybookApprovalReader.getPersonName(PERSON_ID.toString()),
    ).toBe(who.named);
  });

  test("who started the run by hand: the approval is asked for in their name", async () => {
    account = feedPersonAccount(PERSON_ID, who);

    expect(
      await SecurityPlaybookApprovalReader.getSource({
        playbookName: "Contain account takeover",
        trigger: SecurityPlaybookTrigger.Manual,
        triggeredByUserId: PERSON_ID,
      }),
    ).toEqual({
      kind: SecurityPlaybookApprovalSourceKind.Person,
      playbookName: "Contain account takeover",
      personName: who.named,
    });
  });

  test("who decided: the approval's standing names them so", async () => {
    account = feedPersonAccount(PERSON_ID, who);

    for (const decision of [
      SecurityPlaybookApprovalDecision.Approved,
      SecurityPlaybookApprovalDecision.Rejected,
    ]) {
      const standing: SecurityPlaybookApprovalStanding =
        await SecurityPlaybookApprovalReader.getStanding({
          run: { status: SecurityPlaybookRunStatus.Succeeded },
          result: {
            stepId: ROUND.stepId,
            action: SecurityPlaybookActionType.SuspendOktaUser,
            status: SecurityPlaybookStepStatus.Succeeded,
            approval: {
              decision,
              decidedByUserId: PERSON_ID.toString(),
              decidedAt: DECIDED_AT,
            },
          },
        });

      expect(standing).toMatchObject({ deciderName: who.named });
    }
  });

  test.each([WorkspaceType.Slack, WorkspaceType.MicrosoftTeams])(
    "what %s is sent says who asked, decided and undid it by that name, and no address",
    async (workspaceType: WorkspaceType) => {
      account = feedPersonAccount(PERSON_ID, who);

      const name: string =
        await SecurityPlaybookApprovalReader.getPersonName(PERSON_ID);
      const asked: SecurityPlaybookApprovalSource =
        await SecurityPlaybookApprovalReader.getSource({
          playbookName: "Contain account takeover",
          trigger: SecurityPlaybookTrigger.Manual,
          triggeredByUserId: PERSON_ID,
        });

      const waiting: string = sentTo(
        workspaceType,
        askOf({
          source: asked,
          standing: { kind: SecurityPlaybookApprovalStandingKind.Waiting },
        }),
      );
      const decided: string = sentTo(
        workspaceType,
        askOf({
          source: asked,
          standing: {
            kind: SecurityPlaybookApprovalStandingKind.Approved,
            deciderName: name,
            decidedAt: new Date(DECIDED_AT),
            progress: SecurityPlaybookApprovalProgress.Done,
          },
          undoneByName: name,
        }),
      );

      for (const posted of [waiting, decided]) {
        expect(posted).toContain(nameAsEveryChatShowsIt(who.named));
        expectNoAddressIn(posted);
      }
    },
  );
});

describe("nobody to name", () => {
  test("somebody who is gone, or no id at all, is named by nothing", async () => {
    expect(await SecurityPlaybookApprovalReader.getPersonName(PERSON_ID)).toBe(
      "",
    );
    expect(await SecurityPlaybookApprovalReader.getPersonName(undefined)).toBe(
      "",
    );
    expect(
      await SecurityPlaybookApprovalReader.getPersonName("not-an-id"),
    ).toBe("");
  });

  test("a run whose starter has neither a name nor an address is asked for by its playbook", async () => {
    account = new User(PERSON_ID);

    expect(
      await SecurityPlaybookApprovalReader.getSource({
        playbookName: "Contain account takeover",
        trigger: SecurityPlaybookTrigger.Manual,
        triggeredByUserId: PERSON_ID,
      }),
    ).toMatchObject({
      kind: SecurityPlaybookApprovalSourceKind.Playbook,
      playbookName: "Contain account takeover",
    });
  });
});
