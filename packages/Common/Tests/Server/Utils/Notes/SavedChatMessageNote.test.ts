import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import User from "../../../../Models/DatabaseModels/User";
import UserService from "../../../../Server/Services/UserService";
import SavedChatMessageNote, {
  SavedChatMessageNoteKind,
} from "../../../../Server/Utils/Notes/SavedChatMessageNote";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import Email from "../../../../Types/Email";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import SavedChatMessage from "../../../../Types/Workspace/SavedChatMessage";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import FeedMarkdown, { mdText } from "../../../../Utils/Markdown/FeedMarkdown";

jest.mock("../../../../Server/Utils/Logger");

/*
 * A NOTE SAVED FROM A CHAT MESSAGE, AS EVERY NOTE SERVICE SAVES ONE
 * (SavedChatMessageNote). NotesSavedFromChatMessages.test.ts runs it in
 * each service's real create; these hold its pieces.
 */

const NITIN_ID: ObjectID = new ObjectID("5d000000-0000-4000-8000-000000000001");

const FROM_SLACK: SavedChatMessage = {
  workspaceType: WorkspaceType.Slack,
  authorName: "Aidil Rahman",
  postedAt: "2026-10-08T10:17:00.000Z",
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SavedChatMessageNote.create and writeHandedOver", () => {
  test("what a create was handed over with is written on it, once its checks have passed", async () => {
    const note: IncidentInternalNote = new IncidentInternalNote();
    const createBy: CreateBy<IncidentInternalNote> = {
      data: note,
      props: { isRoot: true },
    };

    let seenDuringCreate: unknown = undefined;

    await SavedChatMessageNote.create({
      createBy: createBy,
      savedFromChatMessage: { ...FROM_SLACK, authorName: "Aidil\nRahman" },
      create: async (
        handed: CreateBy<IncidentInternalNote>,
      ): Promise<IncidentInternalNote> => {
        // Nothing is on the note until the service writes it.
        expect(handed.data.savedFromChatMessage).toBeUndefined();
        SavedChatMessageNote.writeHandedOver(handed);
        seenDuringCreate = handed.data.savedFromChatMessage;
        return handed.data;
      },
    });

    expect(seenDuringCreate).toEqual({
      workspaceType: WorkspaceType.Slack,
      authorName: "Aidil Rahman",
      postedAt: "2026-10-08T10:17:00.000Z",
    });

    // Handed over for that create only.
    const later: CreateBy<IncidentInternalNote> = {
      data: new IncidentInternalNote(),
      props: { isRoot: true },
    };
    SavedChatMessageNote.writeHandedOver(later);
    expect(later.data.savedFromChatMessage).toBeUndefined();
  });

  test("a create handed nothing - an API call, a note typed in the dashboard - writes nothing, whatever it sent", async () => {
    const note: IncidentInternalNote = new IncidentInternalNote();
    note.savedFromChatMessage = { workspaceType: WorkspaceType.Slack };
    const createBy: CreateBy<IncidentInternalNote> = {
      data: note,
      props: { isRoot: true },
    };

    await SavedChatMessageNote.create({
      createBy: createBy,
      create: async (
        handed: CreateBy<IncidentInternalNote>,
      ): Promise<IncidentInternalNote> => {
        const before: unknown = handed.data.savedFromChatMessage;
        SavedChatMessageNote.writeHandedOver(handed);
        // Left as the caller sent it: the column's own check refuses it.
        expect(handed.data.savedFromChatMessage).toBe(before);
        return handed.data;
      },
    });
  });

  test("a create that throws hands nothing over to the next", async () => {
    const createBy: CreateBy<IncidentInternalNote> = {
      data: new IncidentInternalNote(),
      props: { isRoot: true },
    };

    await expect(
      SavedChatMessageNote.create({
        createBy: createBy,
        savedFromChatMessage: FROM_SLACK,
        create: async (): Promise<IncidentInternalNote> => {
          throw new Error("refused");
        },
      }),
    ).rejects.toThrow("refused");

    SavedChatMessageNote.writeHandedOver(createBy);
    expect(createBy.data.savedFromChatMessage).toBeUndefined();
  });
});

describe("SavedChatMessageNote.read and getSourceChannel", () => {
  test("a note's column, read as SavedChatMessageUtil reads it", () => {
    const note: IncidentInternalNote = new IncidentInternalNote();
    note.savedFromChatMessage = {
      workspaceType: WorkspaceType.MicrosoftTeams,
      authorName: "  Aidil  ",
      authorUserId: "not an id",
    };

    expect(SavedChatMessageNote.read(note)).toEqual({
      workspaceType: WorkspaceType.MicrosoftTeams,
      authorName: "Aidil",
    });
    expect(SavedChatMessageNote.read(new IncidentInternalNote())).toBeNull();
    expect(SavedChatMessageNote.read(null)).toBeNull();
  });

  test("the channel is what comes before the message's id", () => {
    expect(
      SavedChatMessageNote.getSourceChannel({
        saved: FROM_SLACK,
        messageKey: "C0INC8:1791454620.000200",
      }),
    ).toEqual({ workspaceType: WorkspaceType.Slack, channelId: "C0INC8" });

    // A Teams channel's id has colons of its own.
    expect(
      SavedChatMessageNote.getSourceChannel({
        saved: { workspaceType: WorkspaceType.MicrosoftTeams },
        messageKey: "19:inc-8@thread.tacv2:1700000000200",
      }),
    ).toEqual({
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelId: "19:inc-8@thread.tacv2",
    });
  });

  test("no chat message, or no key to read a channel from: no channel to skip", () => {
    for (const messageKey of [
      null,
      undefined,
      "",
      "   ",
      "no-separator",
      ":1.2",
    ]) {
      expect(
        SavedChatMessageNote.getSourceChannel({
          saved: FROM_SLACK,
          messageKey: messageKey,
        }),
      ).toBeUndefined();
    }

    expect(
      SavedChatMessageNote.getSourceChannel({
        saved: null,
        messageKey: "C0INC8:1.2",
      }),
    ).toBeUndefined();
  });
});

describe("SavedChatMessageNote.getFeedMarkdown", () => {
  const RECORD: ReturnType<typeof mdText> =
    mdText`[Incident INC-8](${"https://oneuptime.test/incidents/8"})`;
  const NOTE: ReturnType<typeof mdText> = FeedMarkdown.asMarkdown(
    "Not sure what's happening here, is this triggered by something?",
  );

  test("the screenshot's entry: author, chat, who added it, then the note", () => {
    expect(
      SavedChatMessageNote.getFeedMarkdown({
        saved: FROM_SLACK,
        noteKind: SavedChatMessageNoteKind.Private,
        record: RECORD,
        savedByName: "Nitin Kumar",
        note: NOTE,
      }).toString(),
    ).toBe(
      "📄 **Aidil Rahman** posted **private note** for this [Incident INC-8](https://oneuptime.test/incidents/8) via Slack (note added by Nitin Kumar):\n\nNot sure what's happening here, is this triggered by something?",
    );
  });

  test("a public note is on the status page; Microsoft Teams is named as such", () => {
    expect(
      SavedChatMessageNote.getFeedMarkdown({
        saved: { ...FROM_SLACK, workspaceType: WorkspaceType.MicrosoftTeams },
        noteKind: SavedChatMessageNoteKind.Public,
        record: RECORD,
        savedByName: "Nitin Kumar",
        note: NOTE,
      }).toString(),
    ).toBe(
      "📄 **Aidil Rahman** posted **public note** for this [Incident INC-8](https://oneuptime.test/incidents/8) on status page via Microsoft Teams (note added by Nitin Kumar):\n\nNot sure what's happening here, is this triggered by something?",
    );
  });

  test("nobody else to name: no 'note added by'; a chat that named nobody: 'Someone'", () => {
    const markdown: string = SavedChatMessageNote.getFeedMarkdown({
      saved: { workspaceType: WorkspaceType.Slack },
      noteKind: SavedChatMessageNoteKind.Private,
      record: RECORD,
      savedByName: null,
      note: NOTE,
    }).toString();

    expect(markdown.startsWith("📄 **Someone** posted **private note**")).toBe(
      true,
    );
    expect(markdown).not.toContain("note added by");

    // The author saving their own message is named once.
    expect(
      SavedChatMessageNote.getFeedMarkdown({
        saved: FROM_SLACK,
        noteKind: SavedChatMessageNoteKind.Private,
        record: RECORD,
        savedByName: "Aidil Rahman",
        note: NOTE,
      }).toString(),
    ).not.toContain("note added by");
  });

  test("names are text: no emphasis, link or mention of their own", () => {
    const markdown: string = SavedChatMessageNote.getFeedMarkdown({
      saved: { ...FROM_SLACK, authorName: "*Aidil* [x](https://evil.example)" },
      noteKind: SavedChatMessageNoteKind.Private,
      record: RECORD,
      savedByName: "<!channel> Nitin",
      note: NOTE,
    }).toString();

    expect(markdown).toContain(
      "📄 **\\*Aidil\\* \\[x\\](https://evil.example)**",
    );
    expect(markdown).not.toContain("<!channel>");
  });
});

describe("SavedChatMessageNote.getSavedByName", () => {
  test("whoever saved it, by name, else email; nobody when they wrote it, or cannot be read", async () => {
    const nitin: User = new User();
    nitin.name = new Name("Nitin Kumar");
    const findSpy: SpyInstance<typeof UserService.findOneById> = jest
      .spyOn(UserService, "findOneById")
      .mockResolvedValue(nitin);

    await expect(
      SavedChatMessageNote.getSavedByName({
        saved: FROM_SLACK,
        userId: NITIN_ID,
      }),
    ).resolves.toBe("Nitin Kumar");

    const emailOnly: User = new User();
    emailOnly.email = new Email("nitin@example.com");
    findSpy.mockResolvedValue(emailOnly);

    await expect(
      SavedChatMessageNote.getSavedByName({
        saved: FROM_SLACK,
        userId: NITIN_ID,
      }),
    ).resolves.toBe("nitin@example.com");

    // Nitin saving his own message.
    findSpy.mockClear();
    await expect(
      SavedChatMessageNote.getSavedByName({
        saved: { ...FROM_SLACK, authorUserId: NITIN_ID.toString() },
        userId: NITIN_ID,
      }),
    ).resolves.toBeNull();
    expect(findSpy).not.toHaveBeenCalled();

    findSpy.mockRejectedValue(new Error("database is down"));
    await expect(
      SavedChatMessageNote.getSavedByName({
        saved: FROM_SLACK,
        userId: NITIN_ID,
      }),
    ).resolves.toBeNull();

    await expect(
      SavedChatMessageNote.getSavedByName({ saved: FROM_SLACK, userId: null }),
    ).resolves.toBeNull();
  });
});

describe("SavedChatMessageNote.getPromptAuthor", () => {
  test("OneUptime AI reads whose words a saved message is, and who saved it", () => {
    const note: IncidentInternalNote = new IncidentInternalNote();

    expect(
      SavedChatMessageNote.getPromptAuthor({
        note: note,
        createdBy: "Nitin Kumar",
      }),
    ).toBe("Nitin Kumar");

    note.savedFromChatMessage = { ...FROM_SLACK };

    expect(
      SavedChatMessageNote.getPromptAuthor({
        note: note,
        createdBy: "Nitin Kumar",
      }),
    ).toBe("Aidil Rahman (via Slack, saved by Nitin Kumar)");

    note.savedFromChatMessage = {
      workspaceType: WorkspaceType.MicrosoftTeams,
      authorName: "Nitin Kumar",
    };

    expect(
      SavedChatMessageNote.getPromptAuthor({
        note: note,
        createdBy: "Nitin Kumar",
      }),
    ).toBe("Nitin Kumar (via Microsoft Teams)");
  });
});
