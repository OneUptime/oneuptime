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
      privateOption: "Private Note (Only visible to team members)",
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
          label: "Private Note (Only visible to team members)",
          value: "private",
        },
      ],
    });
    // Required, as Slack's inputs are unless said otherwise.
    expect(noteType.optional).toBeUndefined();
    expect(form.blocks[1]!._type).toBe("WorkspaceTextAreaBlock");
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
