import { afterEach, describe, expect, jest, test } from "@jest/globals";
import Incident from "../../../../Models/DatabaseModels/Incident";
import WorkspaceActionAnswers, {
  WorkspaceAnswer,
} from "../../../../Server/Utils/Workspace/WorkspaceActionAnswers";
import WorkspaceMemberActions, {
  WorkspaceEvent,
  WorkspaceEventType,
} from "../../../../Server/Utils/Workspace/WorkspaceMemberActions";
import WorkspaceNoteForm, {
  SCHEDULED_MAINTENANCE_NOTE_NOUN,
  WORKSPACE_NOTE_FORM_TEXT,
  WorkspaceNoteFormType,
  WorkspaceSubmittedNote,
} from "../../../../Server/Utils/Workspace/WorkspaceNoteForm";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import { PrivateRecordKind } from "../../../../Types/StatusPage/PrivateRecordPublicNotes";
import {
  WorkspaceDropdownBlock,
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import { WorkspaceNoteType } from "../../../../Types/Workspace/WorkspaceNoteReaction";
import {
  PrivateRecordLookup,
  stubPrivateRecords,
} from "../../TestingUtils/PrivateRecords";

/*
 * THE ADD NOTE FORM OF AN INCIDENT'S OR AN EPISODE'S CHAT MESSAGE.
 *
 * A private incident or episode takes no public notes (Types/StatusPage/
 * PrivateRecordPublicNotes): it is on no status page and told to no
 * subscriber. Its form - in Slack and Microsoft Teams alike - asks for no
 * kind: "Add Private Note", one line that says why, and the note. What a
 * submission writes is decided again when it arrives, from the record as it
 * is then: a public note asked for on a record made private since the form
 * opened is written as a private note, and the answer says so. These hold
 * WorkspaceNoteForm word for word; the chats' suites drive it through their
 * handlers (SlackMemberActions, SlackIncidentActionsRoute,
 * MicrosoftTeamsCreateCommandsEndToEnd).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5f000000-0000-4000-8000-000000000001",
);
const RECORD_ID: ObjectID = new ObjectID(
  "5f000000-0000-4000-8000-000000000002",
);

// The member's own props, as a chat's check hands them on.
const PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("5f000000-0000-4000-8000-0000000000a1"),
  tenantId: PROJECT_ID,
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("WorkspaceNoteForm: the words of the form", () => {
  test("both chats' forms say the same thing", () => {
    expect(WORKSPACE_NOTE_FORM_TEXT).toEqual({
      title: "Add Note",
      privateTitle: "Add Private Note",
      noteTypeLabel: "Note Type",
      noteTypePlaceholder: "Select Note Type",
      publicOption: "Public Note (Will be posted on Status Page)",
      publicOptionWithApproval:
        "Public Note (Posted on Status Page once approved)",
      noteLabel: "Note",
      notePlaceholder: "Note",
      noteDescription: "Please type in plain text or markdown.",
      submit: "Submit",
      cancel: "Cancel",
    });
  });

  test.each([
    [
      "incident",
      PrivateRecordKind.Incident,
      "🔒 This incident is private, so this note is private too: only the people who can see the incident can read it.",
    ],
    [
      "incident episode",
      PrivateRecordKind.IncidentEpisode,
      "🔒 This incident episode is private, so this note is private too: only the people who can see the incident episode can read it.",
    ],
  ])(
    "a private %s's form says why in one line",
    (_noun: string, kind: PrivateRecordKind, line: string) => {
      expect(WorkspaceNoteForm.getPrivateRecordLine(kind)).toBe(line);
      // Nothing it says promises a status page or a subscriber.
      expect(line).not.toContain("status page");
      expect(line).not.toContain("subscriber");
    },
  );

  test.each([
    [
      "an incident",
      PrivateRecordKind.Incident,
      "The incident is private, so public notes cannot be added to it.",
    ],
    [
      "an incident episode",
      PrivateRecordKind.IncidentEpisode,
      "The incident episode is private, so public notes cannot be added to it.",
    ],
  ])(
    "why %s's public note was saved private",
    (_noun: string, kind: PrivateRecordKind, reason: string) => {
      expect(WorkspaceNoteForm.getSavedPrivatelyReason(kind)).toBe(reason);
    },
  );
});

describe("WorkspaceNoteForm.getSlackForm", () => {
  test("a private record's form: 'Add Private Note', its one line, then the note - no Note Type", () => {
    const form: { title: string; blocks: Array<WorkspaceMessageBlock> } =
      WorkspaceNoteForm.getSlackForm({
        kind: PrivateRecordKind.Incident,
        isPrivateRecord: true,
      });

    expect(form).toEqual({
      title: "Add Private Note",
      blocks: [
        {
          _type: "WorkspacePayloadMarkdown",
          text: "🔒 This incident is private, so this note is private too: only the people who can see the incident can read it.",
        },
        {
          _type: "WorkspaceTextAreaBlock",
          label: "Note",
          blockId: "note",
          placeholder: "Note",
          description: "Please type in plain text or markdown.",
        },
      ],
    });
  });

  test("a private episode's line names the incident episode", () => {
    const form: { title: string; blocks: Array<WorkspaceMessageBlock> } =
      WorkspaceNoteForm.getSlackForm({
        kind: PrivateRecordKind.IncidentEpisode,
        isPrivateRecord: true,
      });

    expect(form.title).toBe("Add Private Note");
    expect((form.blocks[0] as WorkspacePayloadMarkdown).text).toBe(
      "🔒 This incident episode is private, so this note is private too: only the people who can see the incident episode can read it.",
    );
  });

  test("a record that is not private: 'Add Note', Public Note or Private Note, then the note - as it always was", () => {
    const form: { title: string; blocks: Array<WorkspaceMessageBlock> } =
      WorkspaceNoteForm.getSlackForm({
        kind: PrivateRecordKind.Incident,
        isPrivateRecord: false,
      });

    expect(form.title).toBe("Add Note");
    expect(form.blocks).toHaveLength(2);

    const noteType: WorkspaceDropdownBlock = form
      .blocks[0] as WorkspaceDropdownBlock;

    expect(noteType).toEqual({
      _type: "WorkspaceDropdownBlock",
      label: "Note Type",
      blockId: "noteType",
      placeholder: "Select Note Type",
      options: [
        {
          label: "Public Note (Will be posted on Status Page)",
          value: "public",
        },
        {
          label:
            "Private Note (Only people who can see the incident can read it)",
          value: "private",
        },
      ],
    });
    // Required, as Slack's inputs are unless said otherwise.
    expect(noteType.optional).toBeUndefined();
    expect(form.blocks[1]!._type).toBe("WorkspaceTextAreaBlock");
  });

  /*
   * While the project asks for public notes to be approved (#6254), the
   * public option says the note is posted once it is approved - not that it
   * will be posted - so nobody sends one expecting it on the status page at
   * once. Its value is the same: what is written is decided as before.
   */
  test("while public notes need approval, the public option says it is posted once approved", () => {
    const form: { title: string; blocks: Array<WorkspaceMessageBlock> } =
      WorkspaceNoteForm.getSlackForm({
        kind: PrivateRecordKind.IncidentEpisode,
        isPrivateRecord: false,
        isPublicNoteApprovalRequired: true,
      });

    expect((form.blocks[0] as WorkspaceDropdownBlock).options).toEqual([
      {
        label: "Public Note (Posted on Status Page once approved)",
        value: "public",
      },
      {
        label:
          "Private Note (Only people who can see the incident episode can read it)",
        value: "private",
      },
    ]);
  });

  test("approval off, or not said, the public option reads as it always has", () => {
    for (const isPublicNoteApprovalRequired of [false, undefined]) {
      const form: { title: string; blocks: Array<WorkspaceMessageBlock> } =
        WorkspaceNoteForm.getSlackForm({
          kind: PrivateRecordKind.Incident,
          isPrivateRecord: false,
          isPublicNoteApprovalRequired: isPublicNoteApprovalRequired,
        });

      expect((form.blocks[0] as WorkspaceDropdownBlock).options[0]!.label).toBe(
        "Public Note (Will be posted on Status Page)",
      );
    }
  });

  test("a private record's form offers no public note, approval or not", () => {
    const form: { title: string; blocks: Array<WorkspaceMessageBlock> } =
      WorkspaceNoteForm.getSlackForm({
        kind: PrivateRecordKind.Incident,
        isPrivateRecord: true,
        isPublicNoteApprovalRequired: true,
      });

    expect(form.title).toBe("Add Private Note");
    expect(JSON.stringify(form)).not.toContain("Public Note");
  });
});

/*
 * Who can read a private note, as the form's Private Note option says it
 * (#7595): the people who can see the record it is on - never "team
 * members", which read as one of OneUptime's Teams, or as the team in
 * Microsoft Teams. Slack refuses an option longer than 75 characters.
 */
describe("WorkspaceNoteForm.getPrivateOption", () => {
  const SLACK_OPTION_TEXT_LIMIT: number = 75;

  test.each([
    [
      PrivateRecordKind.Incident,
      "Private Note (Only people who can see the incident can read it)",
    ],
    [
      PrivateRecordKind.IncidentEpisode,
      "Private Note (Only people who can see the incident episode can read it)",
    ],
  ])("an %s's form names it", (kind: PrivateRecordKind, option: string) => {
    expect(WorkspaceNoteForm.getRecordPrivateOption(kind)).toBe(option);
  });

  test("a scheduled maintenance event's forms call it the maintenance event", () => {
    expect(SCHEDULED_MAINTENANCE_NOTE_NOUN).toBe("maintenance event");
    expect(
      WorkspaceNoteForm.getPrivateOption(SCHEDULED_MAINTENANCE_NOTE_NOUN),
    ).toBe(
      "Private Note (Only people who can see the maintenance event can read it)",
    );
  });

  test("every option fits Slack's 75 characters, and none says team", () => {
    const options: Array<string> = [
      WorkspaceNoteForm.getRecordPrivateOption(PrivateRecordKind.Incident),
      WorkspaceNoteForm.getRecordPrivateOption(
        PrivateRecordKind.IncidentEpisode,
      ),
      WorkspaceNoteForm.getPrivateOption(SCHEDULED_MAINTENANCE_NOTE_NOUN),
      WorkspaceNoteForm.getPublicOption(false),
      WorkspaceNoteForm.getPublicOption(true),
    ];

    for (const option of options) {
      expect({
        option: option,
        fits: option.length <= SLACK_OPTION_TEXT_LIMIT,
      }).toEqual({ option: option, fits: true });
      expect(option.toLowerCase()).not.toContain("team");
    }
  });

  test("the form's words no longer hold one private option for every record", () => {
    expect(Object.keys(WORKSPACE_NOTE_FORM_TEXT)).not.toContain(
      "privateOption",
    );
    expect(JSON.stringify(WORKSPACE_NOTE_FORM_TEXT)).not.toContain("team");
  });
});

describe("WorkspaceNoteForm.getPublicOption", () => {
  test("posted on the status page, or posted once approved while approval is on", () => {
    expect(WorkspaceNoteForm.getPublicOption(false)).toBe(
      "Public Note (Will be posted on Status Page)",
    );
    expect(WorkspaceNoteForm.getPublicOption(true)).toBe(
      "Public Note (Posted on Status Page once approved)",
    );
  });
});

describe("WorkspaceNoteForm.getSubmittedNote: what a submission writes", () => {
  function submitted(
    submittedNoteType: unknown,
    kind: PrivateRecordKind = PrivateRecordKind.Incident,
  ): Promise<WorkspaceSubmittedNote | null> {
    return WorkspaceNoteForm.getSubmittedNote({
      submittedNoteType: submittedNoteType,
      kind: kind,
      recordId: RECORD_ID,
      projectId: PROJECT_ID,
    });
  }

  test.each([
    ["no Note Type (a private record's form asks for none)", undefined],
    ["a Note Type of null", null],
    ["Private Note", WorkspaceNoteFormType.Private],
  ])(
    "%s: a private note, and nothing is read",
    async (_label: string, submittedNoteType: unknown) => {
      const lookups: Array<PrivateRecordLookup> = stubPrivateRecords([
        RECORD_ID,
      ]);

      await expect(submitted(submittedNoteType)).resolves.toEqual({
        noteType: WorkspaceNoteType.Private,
        isPublicAskedOnPrivateRecord: false,
      });
      expect(lookups).toEqual([]);
    },
  );

  test("Public Note on a record that is not private: a public note", async () => {
    const lookups: Array<PrivateRecordLookup> = stubPrivateRecords();

    await expect(submitted(WorkspaceNoteFormType.Public)).resolves.toEqual({
      noteType: WorkspaceNoteType.Public,
      isPublicAskedOnPrivateRecord: false,
    });
    // Asked about this record, in its project, when it arrives.
    expect(lookups).toEqual([
      {
        kind: PrivateRecordKind.Incident,
        recordId: RECORD_ID.toString(),
        projectId: PROJECT_ID.toString(),
      },
    ]);
  });

  test.each([
    ["an incident", PrivateRecordKind.Incident],
    ["an incident episode", PrivateRecordKind.IncidentEpisode],
  ])(
    "Public Note on %s made private since the form opened: a private note, and the answer is to say why",
    async (_noun: string, kind: PrivateRecordKind) => {
      const lookups: Array<PrivateRecordLookup> = stubPrivateRecords([
        RECORD_ID,
      ]);

      await expect(
        submitted(WorkspaceNoteFormType.Public, kind),
      ).resolves.toEqual({
        noteType: WorkspaceNoteType.Private,
        isPublicAskedOnPrivateRecord: true,
      });
      expect(lookups[0]!.kind).toBe(kind);
    },
  );

  test.each([["everyone"], [""], [42], [{ value: "public" }]])(
    "a Note Type no form offers (%p) writes nothing, and nothing is read",
    async (submittedNoteType: unknown) => {
      const lookups: Array<PrivateRecordLookup> = stubPrivateRecords();

      await expect(submitted(submittedNoteType)).resolves.toBeNull();
      expect(lookups).toEqual([]);
    },
  );
});

describe("WorkspaceNoteForm.isPrivateRecord", () => {
  test("asks the one rule, about this record, in its project", async () => {
    const lookups: Array<PrivateRecordLookup> = stubPrivateRecords([RECORD_ID]);

    await expect(
      WorkspaceNoteForm.isPrivateRecord({
        kind: PrivateRecordKind.IncidentEpisode,
        recordId: RECORD_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBe(true);
    await expect(
      WorkspaceNoteForm.isPrivateRecord({
        kind: PrivateRecordKind.Incident,
        recordId: ObjectID.generate(),
        projectId: PROJECT_ID,
      }),
    ).resolves.toBe(false);

    expect(lookups[0]).toEqual({
      kind: PrivateRecordKind.IncidentEpisode,
      recordId: RECORD_ID.toString(),
      projectId: PROJECT_ID.toString(),
    });
  });
});

describe("WorkspaceNoteForm.getSavedPrivatelyAnswer: what a public note saved private is answered with", () => {
  function memberFinds(found: "record" | "nothing" | "an error"): jest.Mock {
    return jest
      .spyOn(WorkspaceMemberActions, "findEventForMember")
      .mockImplementation((async (data: { event: WorkspaceEvent }) => {
        if (found === "an error") {
          throw new Error("database is down");
        }

        if (found === "nothing") {
          return null;
        }

        return {
          record: new Incident(),
          event: {
            type: data.event.type,
            id: data.event.id,
            projectId: PROJECT_ID,
            currentStateId: undefined,
            number: 42,
            numberWithPrefix: "INC-42",
          },
        };
      }) as never) as unknown as jest.Mock;
  }

  test("names the record, linked, and says why", async () => {
    const find: jest.Mock = memberFinds("record");
    jest.spyOn(WorkspaceActionAnswers, "getRecordName").mockResolvedValue({
      label: "Incident INC-42",
      link: "https://oneuptime.test/incidents/42",
    });

    const answer: WorkspaceAnswer =
      await WorkspaceNoteForm.getSavedPrivatelyAnswer({
        kind: PrivateRecordKind.Incident,
        recordId: RECORD_ID,
        props: PROPS,
      });

    expect(answer).toEqual({
      markdown:
        "📄 You added a private note to **[Incident INC-42](https://oneuptime.test/incidents/42)**. The incident is private, so public notes cannot be added to it.",
      text: "You added a private note to Incident INC-42",
    });

    // Read as the member, as the note was added: only its id.
    expect(find).toHaveBeenCalledTimes(1);
    const asked: {
      event: WorkspaceEvent;
      props: DatabaseCommonInteractionProps;
      select: Record<string, unknown>;
    } = find.mock.calls[0]![0] as never;

    expect(asked.event).toEqual({
      type: WorkspaceEventType.Incident,
      id: RECORD_ID,
    });
    expect(asked.props).toBe(PROPS);
    expect(asked.select).toEqual({ _id: true });
  });

  test("an episode is named an incident episode", async () => {
    memberFinds("nothing");

    const answer: WorkspaceAnswer =
      await WorkspaceNoteForm.getSavedPrivatelyAnswer({
        kind: PrivateRecordKind.IncidentEpisode,
        recordId: RECORD_ID,
        props: PROPS,
      });

    expect(answer).toEqual({
      markdown:
        "📄 You added a private note to the incident episode. The incident episode is private, so public notes cannot be added to it.",
      text: "You added a private note to the incident episode",
    });
  });

  test.each([["nothing"], ["an error"]] as Array<["nothing" | "an error"]>)(
    "a record the member's read gives %s for is 'the incident'",
    async (found: "nothing" | "an error") => {
      memberFinds(found);

      const answer: WorkspaceAnswer =
        await WorkspaceNoteForm.getSavedPrivatelyAnswer({
          kind: PrivateRecordKind.Incident,
          recordId: RECORD_ID,
          props: PROPS,
        });

      expect(answer).toEqual({
        markdown:
          "📄 You added a private note to the incident. The incident is private, so public notes cannot be added to it.",
        text: "You added a private note to the incident",
      });
    },
  );

  test("a record's label is placed as text, never as formatting", async () => {
    memberFinds("record");
    jest.spyOn(WorkspaceActionAnswers, "getRecordName").mockResolvedValue({
      label: "Incident *INC-42*",
      link: null,
    });

    const answer: WorkspaceAnswer =
      await WorkspaceNoteForm.getSavedPrivatelyAnswer({
        kind: PrivateRecordKind.Incident,
        recordId: RECORD_ID,
        props: PROPS,
      });

    expect(answer.markdown).toBe(
      "📄 You added a private note to **Incident \\*INC-42\\***. The incident is private, so public notes cannot be added to it.",
    );
  });
});
