import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import PublicNoteApprovalEngine from "../../../../Server/Utils/Notes/PublicNoteApprovalEngine";
import { PublicNoteApprovalWaitingFor } from "../../../../Server/Utils/Notes/PublicNoteApprovalFeed";
import PublicNoteApprovalPolicy from "../../../../Server/Utils/Notes/PublicNoteApprovalPolicy";
import WorkspaceActionAnswers, {
  WorkspaceAnswer,
} from "../../../../Server/Utils/Workspace/WorkspaceActionAnswers";
import WorkspaceHeldPublicNote from "../../../../Server/Utils/Workspace/WorkspaceHeldPublicNote";
import WorkspaceMemberActions, {
  WorkspaceEventRecord,
  WorkspaceEventType,
} from "../../../../Server/Utils/Workspace/WorkspaceMemberActions";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import {
  PublicNoteApprovalEventType,
  PublicNoteApprovalStatus,
  PublicNoteApprovalStepRule,
} from "../../../../Types/StatusPage/PublicNoteApproval";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A PUBLIC NOTE SENT FROM CHAT THAT WAITS FOR APPROVAL (#6254).
 *
 * A public note added from Slack, Microsoft Teams or Mattermost while its
 * project asks for approval is held: posted to no status page and no
 * channel. The channel post was the answer that a note was posted, so the
 * person who sent it is answered here instead, in the Dashboard's words -
 * sent for approval, published once approved, and who it waits for - and
 * the note forms say so before anything is sent. The chats' suites drive
 * this through their handlers (SlackHeldPublicNoteAnswers,
 * MicrosoftTeamsHeldPublicNoteAnswers, MattermostActions,
 * WorkspaceReactionNote).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-000000000002",
);

const PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("6a000000-0000-4000-8000-0000000000a1"),
  tenantId: PROJECT_ID,
};

const SUPPORT: PublicNoteApprovalStepRule = {
  id: "s1",
  name: "Support",
  order: 1,
  userIds: ["u1"],
  teamIds: ["t1"],
};

// Who a note waits for: step 1 of 2 (Support), Bob and the Platform team.
const WAITING_FOR_SUPPORT: PublicNoteApprovalWaitingFor = {
  position: {
    step: SUPPORT,
    number: 1,
    count: 2,
    isFinal: false,
    isAskedAgain: false,
  },
  approverNames: ["Bob", "Platform"],
};

function note(isPublished: boolean | undefined): IncidentPublicNote {
  const created: IncidentPublicNote = new IncidentPublicNote();
  created._id = "6a000000-0000-4000-8000-0000000000b1";
  created.projectId = PROJECT_ID;
  created.incidentId = INCIDENT_ID;
  created.note = "We are rolling back the deploy.";

  if (isPublished !== undefined) {
    created.isPublished = isPublished;
  }

  if (isPublished === false) {
    created.approvalStatus = PublicNoteApprovalStatus.WaitingForApproval;
  }

  return created;
}

function stubRecord(found: boolean): jest.SpyInstance {
  const record: WorkspaceEventRecord = {
    type: WorkspaceEventType.Incident,
    id: INCIDENT_ID,
    projectId: PROJECT_ID,
    currentStateId: undefined,
    number: 42,
    numberWithPrefix: "INC-42",
  };

  return getJestSpyOn(
    WorkspaceMemberActions,
    "findEventForMember",
  ).mockResolvedValue(
    found ? ({ record: {}, event: record } as never) : (null as never),
  );
}

function stubRecordLink(): void {
  getJestSpyOn(WorkspaceActionAnswers, "getRecordName").mockResolvedValue({
    label: "Incident INC-42",
    link: "https://oneuptime.example/incidents/42",
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("whose approval a record's public notes wait for", () => {
  test("an incident's and an episode's share one; a maintenance event has its own", () => {
    expect(
      WorkspaceHeldPublicNote.getApprovalEventType(WorkspaceEventType.Incident),
    ).toBe(PublicNoteApprovalEventType.Incident);
    expect(
      WorkspaceHeldPublicNote.getApprovalEventType(
        WorkspaceEventType.IncidentEpisode,
      ),
    ).toBe(PublicNoteApprovalEventType.Incident);
    expect(
      WorkspaceHeldPublicNote.getApprovalEventType(
        WorkspaceEventType.ScheduledMaintenance,
      ),
    ).toBe(PublicNoteApprovalEventType.ScheduledMaintenance);
  });

  test("an alert and an alert episode take no public notes, so none", () => {
    expect(
      WorkspaceHeldPublicNote.getApprovalEventType(WorkspaceEventType.Alert),
    ).toBeNull();
    expect(
      WorkspaceHeldPublicNote.getApprovalEventType(
        WorkspaceEventType.AlertEpisode,
      ),
    ).toBeNull();
  });
});

describe("WorkspaceHeldPublicNote.isApprovalRequired, for a form before it is sent", () => {
  test("asks the project's switch for the record's kind", async () => {
    const isRequired: jest.SpyInstance = getJestSpyOn(
      PublicNoteApprovalPolicy,
      "isRequired",
    ).mockResolvedValue(true);

    await expect(
      WorkspaceHeldPublicNote.isApprovalRequired({
        type: WorkspaceEventType.IncidentEpisode,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBe(true);
    expect(isRequired).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      eventType: PublicNoteApprovalEventType.Incident,
    });

    await WorkspaceHeldPublicNote.isApprovalRequired({
      type: WorkspaceEventType.ScheduledMaintenance,
      projectId: PROJECT_ID,
    });
    expect(isRequired).toHaveBeenLastCalledWith({
      projectId: PROJECT_ID,
      eventType: PublicNoteApprovalEventType.ScheduledMaintenance,
    });
  });

  test("no project, or a record with no public notes: no, with nothing read", async () => {
    const isRequired: jest.SpyInstance = getJestSpyOn(
      PublicNoteApprovalPolicy,
      "isRequired",
    ).mockResolvedValue(true);

    for (const projectId of [null, undefined]) {
      await expect(
        WorkspaceHeldPublicNote.isApprovalRequired({
          type: WorkspaceEventType.Incident,
          projectId: projectId,
        }),
      ).resolves.toBe(false);
    }

    await expect(
      WorkspaceHeldPublicNote.isApprovalRequired({
        type: WorkspaceEventType.Alert,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBe(false);
    expect(isRequired).not.toHaveBeenCalled();
  });

  test("a read that fails says no: the form is still offered as it always was", async () => {
    getJestSpyOn(PublicNoteApprovalPolicy, "isRequired").mockRejectedValue(
      new Error("database is down"),
    );

    await expect(
      WorkspaceHeldPublicNote.isApprovalRequired({
        type: WorkspaceEventType.Incident,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBe(false);
  });
});

describe("WorkspaceHeldPublicNote.isHeldForApproval", () => {
  test("only a note written unpublished is held", () => {
    expect(WorkspaceHeldPublicNote.isHeldForApproval(note(false))).toBe(true);
    expect(WorkspaceHeldPublicNote.isHeldForApproval(note(true))).toBe(false);
    // A note that says nothing is published, as every note was before approval.
    expect(WorkspaceHeldPublicNote.isHeldForApproval(note(undefined))).toBe(
      false,
    );
    expect(WorkspaceHeldPublicNote.isHeldForApproval(null)).toBe(false);
    expect(WorkspaceHeldPublicNote.isHeldForApproval(undefined)).toBe(false);
  });
});

describe("WorkspaceHeldPublicNote.getWaitingFor", () => {
  test("reads who the note waits for, as the record's kind of approval", async () => {
    const read: jest.SpyInstance = getJestSpyOn(
      PublicNoteApprovalEngine,
      "getWaitingForNote",
    ).mockResolvedValue(WAITING_FOR_SUPPORT);
    const held: IncidentPublicNote = note(false);

    await expect(
      WorkspaceHeldPublicNote.getWaitingFor({
        type: WorkspaceEventType.IncidentEpisode,
        note: held,
      }),
    ).resolves.toEqual(WAITING_FOR_SUPPORT);
    expect(read).toHaveBeenCalledWith({
      eventType: PublicNoteApprovalEventType.Incident,
      note: held,
    });
  });

  test("no note, or a record with no public notes: nobody, with nothing read", async () => {
    const read: jest.SpyInstance = getJestSpyOn(
      PublicNoteApprovalEngine,
      "getWaitingForNote",
    );

    await expect(
      WorkspaceHeldPublicNote.getWaitingFor({
        type: WorkspaceEventType.Incident,
        note: null,
      }),
    ).resolves.toBeNull();
    await expect(
      WorkspaceHeldPublicNote.getWaitingFor({
        type: WorkspaceEventType.Alert,
        note: note(false),
      }),
    ).resolves.toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});

describe("WorkspaceHeldPublicNote.getAnswer: the Dashboard's words", () => {
  const RECORD: { label: string; link: string } = {
    label: "Incident INC-42",
    link: "https://oneuptime.example/incidents/42",
  };

  test("sent for approval, published once approved, and who it waits for", () => {
    const answer: WorkspaceAnswer = WorkspaceHeldPublicNote.getAnswer({
      record: RECORD,
      type: WorkspaceEventType.Incident,
      waitingFor: WAITING_FOR_SUPPORT,
    });

    expect(answer).toEqual({
      markdown:
        "⏳ Sent for approval: your public note on **[Incident INC-42](https://oneuptime.example/incidents/42)** is published on status pages once it is approved. It waits for step 1 of 2 (Support): Bob, Platform.",
      text: "Sent for approval: your public note on Incident INC-42 is published on status pages once it is approved",
    });
  });

  test("one step with no name waits for the approvers", () => {
    const answer: WorkspaceAnswer = WorkspaceHeldPublicNote.getAnswer({
      record: RECORD,
      type: WorkspaceEventType.ScheduledMaintenance,
      waitingFor: {
        position: {
          step: { id: "s1", order: 1, userIds: ["u1"], teamIds: [] },
          number: 1,
          count: 1,
          isFinal: true,
          isAskedAgain: false,
        },
        approverNames: ["Bob"],
      },
    });

    expect(answer.markdown).toContain(
      "is published on status pages once it is approved. It waits for the approvers: Bob.",
    );
  });

  test("who it waits for is left out when it could not be read", () => {
    const answer: WorkspaceAnswer = WorkspaceHeldPublicNote.getAnswer({
      record: RECORD,
      type: WorkspaceEventType.Incident,
      waitingFor: null,
    });

    expect(answer.markdown).toBe(
      "⏳ Sent for approval: your public note on **[Incident INC-42](https://oneuptime.example/incidents/42)** is published on status pages once it is approved.",
    );
  });

  test.each([
    [WorkspaceEventType.Incident, "the incident"],
    [WorkspaceEventType.IncidentEpisode, "the incident episode"],
    // A maintenance event, as the model has named it since #6817.
    [WorkspaceEventType.ScheduledMaintenance, "the maintenance event"],
  ])(
    "a record the member cannot read is named by its kind (%s)",
    (type: WorkspaceEventType, named: string) => {
      const answer: WorkspaceAnswer = WorkspaceHeldPublicNote.getAnswer({
        record: null,
        type: type,
        waitingFor: null,
      });

      expect(answer.markdown).toBe(
        `⏳ Sent for approval: your public note on ${named} is published on status pages once it is approved.`,
      );
      expect(answer.text).toBe(
        `Sent for approval: your public note on ${named} is published on status pages once it is approved`,
      );
    },
  );

  test("names - people's, teams', steps' and the record's - are text, never links or styling", () => {
    const answer: WorkspaceAnswer = WorkspaceHeldPublicNote.getAnswer({
      record: {
        label: "Incident *INC-42*",
        link: "https://oneuptime.example/incidents/42",
      },
      type: WorkspaceEventType.Incident,
      waitingFor: {
        position: {
          step: { ...SUPPORT, name: "Legal *team*" },
          number: 1,
          count: 2,
          isFinal: false,
          isAskedAgain: false,
        },
        approverNames: ["[Bob](https://evil.example)", "*Carol*"],
      },
    });

    expect(answer.markdown).toContain("\\[Bob\\](https://evil.example)");
    expect(answer.markdown).toContain("\\*Carol\\*");
    expect(answer.markdown).toContain("(Legal \\*team\\*)");
    expect(answer.markdown).toContain("Incident \\*INC-42\\*");
    expect(answer.markdown).not.toContain("[Bob](https://evil.example)");
  });
});

describe("WorkspaceHeldPublicNote.getAnswerForAddedNote", () => {
  test("a note published as it was posted gets no answer here, and nothing is read", async () => {
    const waiting: jest.SpyInstance = getJestSpyOn(
      PublicNoteApprovalEngine,
      "getWaitingForNote",
    );
    const record: jest.SpyInstance = stubRecord(true);

    for (const published of [note(true), note(undefined), null]) {
      await expect(
        WorkspaceHeldPublicNote.getAnswerForAddedNote({
          event: { type: WorkspaceEventType.Incident, id: INCIDENT_ID },
          note: published as DatabaseBaseModel | null,
          props: PROPS,
        }),
      ).resolves.toBeNull();
    }

    expect(waiting).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  test("a held note is answered with its record as the member reads it, and who it waits for", async () => {
    getJestSpyOn(
      PublicNoteApprovalEngine,
      "getWaitingForNote",
    ).mockResolvedValue(WAITING_FOR_SUPPORT);
    const record: jest.SpyInstance = stubRecord(true);
    stubRecordLink();

    const answer: WorkspaceAnswer | null =
      await WorkspaceHeldPublicNote.getAnswerForAddedNote({
        event: { type: WorkspaceEventType.Incident, id: INCIDENT_ID },
        note: note(false),
        props: PROPS,
      });

    expect(answer?.markdown).toBe(
      "⏳ Sent for approval: your public note on **[Incident INC-42](https://oneuptime.example/incidents/42)** is published on status pages once it is approved. It waits for step 1 of 2 (Support): Bob, Platform.",
    );
    // Read as the member, with their own props.
    expect(record).toHaveBeenCalledWith({
      event: { type: WorkspaceEventType.Incident, id: INCIDENT_ID },
      props: PROPS,
      select: { _id: true },
    });
  });

  test("a record they cannot read is the incident", async () => {
    getJestSpyOn(
      PublicNoteApprovalEngine,
      "getWaitingForNote",
    ).mockResolvedValue(WAITING_FOR_SUPPORT);
    stubRecord(false);

    const answer: WorkspaceAnswer | null =
      await WorkspaceHeldPublicNote.getAnswerForAddedNote({
        event: { type: WorkspaceEventType.Incident, id: INCIDENT_ID },
        note: note(false),
        props: PROPS,
      });

    expect(answer?.markdown).toBe(
      "⏳ Sent for approval: your public note on the incident is published on status pages once it is approved. It waits for step 1 of 2 (Support): Bob, Platform.",
    );
  });

  test("the note is written by now: a read that fails leaves its part out, and never fails the answer", async () => {
    getJestSpyOn(
      PublicNoteApprovalEngine,
      "getWaitingForNote",
    ).mockRejectedValue(new Error("steps could not be read"));
    getJestSpyOn(
      WorkspaceMemberActions,
      "findEventForMember",
    ).mockRejectedValue(new Error("record could not be read"));

    await expect(
      WorkspaceHeldPublicNote.getAnswerForAddedNote({
        event: {
          type: WorkspaceEventType.ScheduledMaintenance,
          id: INCIDENT_ID,
        },
        note: note(false),
        props: PROPS,
      }),
    ).resolves.toEqual({
      markdown:
        "⏳ Sent for approval: your public note on the maintenance event is published on status pages once it is approved.",
      text: "Sent for approval: your public note on the maintenance event is published on status pages once it is approved",
    });
  });
});
