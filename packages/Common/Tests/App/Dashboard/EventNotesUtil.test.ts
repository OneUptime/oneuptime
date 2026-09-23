/** @timezone UTC */

import { describe, expect, test } from "@jest/globals";
import {
  AUTOMATION_AUTHOR_NAME,
  NoteNotificationSummary,
  NoteNotificationTone,
  NoteRecord,
  UNDATED_GROUP_KEY,
  applyTemplateToDraft,
  buildNotesQuery,
  buildNotesSelect,
  canReadNoteColumn,
  canWriteNoteColumn,
  fromDateTimeInputValue,
  getAuthorName,
  getInitials,
  getNoteId,
  getNoteSourceLabel,
  getNoteTimeLabel,
  getNoteTimestamp,
  getRelativeTimeLabel,
  getNotesCopy,
  getPostedNotificationSummary,
  getUpdateNotificationSummary,
  getUserId,
  groupNotesByDay,
  hasNotificationInFlight,
  isNoteBlank,
  toDateTimeInputValue,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/EventNotesUtil";
import { getTemplatePreview } from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/NoteTemplateMenu";
import { getInitialsColor } from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/NoteAvatar";
import { getAttachmentDownloadUrl } from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/NoteAttachments";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import User from "../../../Models/DatabaseModels/User";
import Search from "../../../Types/BaseDatabase/Search";
import IconProp from "../../../Types/Icon/IconProp";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";

/*
 * The notes feed's decisions that need no React: where a note is filed in
 * time, how the feed is grouped, what a notification status reads as, what
 * the page says, and which columns the viewer may read or write.
 *
 * The test environment runs in UTC (Tests/Utils/TimezoneEnvironment.js), so
 * calendar days here are UTC days.
 */

const NOW: Date = new Date("2026-09-14T18:20:00.000Z");
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

interface DatedNote extends NoteRecord {
  label: string;
}

function dated(label: string, createdAt: Date | undefined): DatedNote {
  return { label, createdAt };
}

describe("getNoteTimestamp", () => {
  test("files a public note under the time it was posted", () => {
    const note: NoteRecord = {
      createdAt: ago(HOUR),
      postedAt: ago(3 * HOUR),
    };

    expect(getNoteTimestamp(note, "public")?.toISOString()).toBe(
      ago(3 * HOUR).toISOString(),
    );
  });

  test("falls back to when a public note was written when it has no posting time", () => {
    const note: NoteRecord = { createdAt: ago(HOUR) };

    expect(getNoteTimestamp(note, "public")?.toISOString()).toBe(
      ago(HOUR).toISOString(),
    );
  });

  test("files a private note under when it was written, ignoring any posting time", () => {
    const note: NoteRecord = {
      createdAt: ago(HOUR),
      postedAt: ago(5 * HOUR),
    };

    expect(getNoteTimestamp(note, "private")?.toISOString()).toBe(
      ago(HOUR).toISOString(),
    );
  });

  test("reads dates that arrive as strings", () => {
    const note: NoteRecord = {
      createdAt: "2026-09-14T10:00:00.000Z" as unknown as Date,
    };

    expect(getNoteTimestamp(note, "private")?.toISOString()).toBe(
      "2026-09-14T10:00:00.000Z",
    );
  });

  test("is null for a note with no usable date", () => {
    expect(getNoteTimestamp({}, "public")).toBeNull();
    expect(
      getNoteTimestamp(
        { createdAt: "not a date" as unknown as Date },
        "private",
      ),
    ).toBeNull();
  });
});

describe("groupNotesByDay", () => {
  function group(
    notes: Array<DatedNote>,
  ): Array<{ label: string; notes: Array<string> }> {
    return groupNotesByDay<DatedNote>({
      notes,
      getDate: (note: DatedNote) => {
        return note.createdAt || null;
      },
      now: NOW,
    }).map((day: { label: string; notes: Array<DatedNote> }) => {
      return {
        label: day.label,
        notes: day.notes.map((note: DatedNote) => {
          return note.label;
        }),
      };
    });
  }

  test("labels today and yesterday, and spells out older days", () => {
    expect(
      group([
        dated("a", ago(10 * MINUTE)),
        dated("b", ago(3 * HOUR)),
        dated("c", ago(DAY)),
        dated("d", ago(4 * DAY)),
      ]),
    ).toEqual([
      { label: "Today", notes: ["a", "b"] },
      { label: "Yesterday", notes: ["c"] },
      { label: "Sep 10, 2026", notes: ["d"] },
    ]);
  });

  test("keeps the order it was given, oldest first included", () => {
    expect(
      group([
        dated("old", ago(4 * DAY)),
        dated("yesterday", ago(DAY)),
        dated("today", ago(MINUTE)),
      ]),
    ).toEqual([
      { label: "Sep 10, 2026", notes: ["old"] },
      { label: "Yesterday", notes: ["yesterday"] },
      { label: "Today", notes: ["today"] },
    ]);
  });

  test("splits at midnight in the viewer's timezone", () => {
    const justAfterMidnight: Date = new Date("2026-09-14T00:00:30.000Z");
    const justBeforeMidnight: Date = new Date("2026-09-13T23:59:30.000Z");

    expect(
      group([
        dated("after", justAfterMidnight),
        dated("before", justBeforeMidnight),
      ]),
    ).toEqual([
      { label: "Today", notes: ["after"] },
      { label: "Yesterday", notes: ["before"] },
    ]);
  });

  test("puts notes with no date in their own group", () => {
    const groups: ReturnType<typeof groupNotesByDay<DatedNote>> =
      groupNotesByDay<DatedNote>({
        notes: [dated("a", ago(MINUTE)), dated("undated", undefined)],
        getDate: (note: DatedNote) => {
          return note.createdAt || null;
        },
        now: NOW,
      });

    expect(groups).toHaveLength(2);
    expect(groups[1]!.key).toBe(UNDATED_GROUP_KEY);
    expect(groups[1]!.label).toBe("Date unknown");
  });

  test("starts a new group when the same day comes back after another one", () => {
    expect(
      group([
        dated("a", ago(MINUTE)),
        dated("b", ago(DAY)),
        dated("c", ago(2 * MINUTE)),
      ]).map((day: { label: string }) => {
        return day.label;
      }),
    ).toEqual(["Today", "Yesterday", "Today"]);
  });

  test("is empty for an empty feed", () => {
    expect(group([])).toEqual([]);
  });
});

describe("getAuthorName", () => {
  test("uses the author's name", () => {
    const user: User = new User();
    user.name = new Name("Maya Chen");
    user.email = new Email("maya@example.com");

    expect(getAuthorName(user)).toEqual({
      name: "Maya Chen",
      isAutomation: false,
    });
  });

  test("falls back to the email when the author has no name", () => {
    const user: User = new User();
    user.email = new Email("maya@example.com");

    expect(getAuthorName(user).name).toBe("maya@example.com");
  });

  test("reads the serialized shape an API response carries", () => {
    expect(
      getAuthorName({
        name: { _type: "Name", value: "Sam Rivera" },
        email: { _type: "Email", value: "sam@example.com" },
      }).name,
    ).toBe("Sam Rivera");
  });

  test("treats a note with no author as posted by OneUptime", () => {
    expect(getAuthorName(undefined)).toEqual({
      name: AUTOMATION_AUTHOR_NAME,
      isAutomation: true,
    });
    expect(getAuthorName(null).isAutomation).toBe(true);
  });

  test("does not call a person with neither name nor email automation", () => {
    expect(getAuthorName({ name: "  " })).toEqual({
      name: "Unknown user",
      isAutomation: false,
    });
  });
});

describe("getInitials", () => {
  test.each([
    ["Maya Chen", "MC"],
    ["maya chen", "MC"],
    ["Jean-Luc Picard", "JP"],
    ["Cher", "CH"],
    ["Mary Ann Van Dyke", "MD"],
    ["maya.chen@example.com", "MC"],
    ["  ", "?"],
    ["Łukasz Żak", "ŁŻ"],
  ])("%s -> %s", (name: string, initials: string) => {
    expect(getInitials(name)).toBe(initials);
  });
});

describe("getInitialsColor", () => {
  test("gives the same person the same colour every time", () => {
    expect(getInitialsColor("maya")).toBe(getInitialsColor("maya"));
  });

  test("is always one of the palette's classes", () => {
    for (const seed of ["a", "bb", "maya", "sam", "", "80000000"]) {
      expect(getInitialsColor(seed)).toMatch(/^bg-\w+-100 text-\w+-\d00$/);
    }
  });
});

describe("getUserId and getNoteId", () => {
  const ID: string = "80000000-0000-4000-8000-000000000001";

  test("reads the id of a user model", () => {
    const user: User = new User();
    user._id = ID;
    expect(getUserId(user)?.toString()).toBe(ID);
  });

  test("reads the id of a plain user object", () => {
    expect(getUserId({ _id: ID })?.toString()).toBe(ID);
  });

  test("is null without a user or an id", () => {
    expect(getUserId(null)).toBeNull();
    expect(getUserId({})).toBeNull();
  });

  test("reads a note's id from either field", () => {
    expect(getNoteId({ _id: ID })).toBe(ID);
    expect(getNoteId({ id: new ObjectID(ID) })).toBe(ID);
    expect(getNoteId({})).toBeNull();
  });
});

describe("isNoteBlank", () => {
  test.each([
    [undefined, true],
    [null, true],
    ["", true],
    ["   \n\t ", true],
    ["&nbsp;", true],
    ["<br>", true],
    ["<br/> &nbsp; <br />", true],
    ["  ", true],
    ["Fix deployed", false],
    ["  x  ", false],
  ])("%p -> %p", (text: string | null | undefined, isBlank: boolean) => {
    expect(isNoteBlank(text)).toBe(isBlank);
  });
});

describe("applyTemplateToDraft", () => {
  test("an empty draft takes the template", () => {
    expect(applyTemplateToDraft("", "Investigating.")).toBe("Investigating.");
    expect(applyTemplateToDraft(undefined, "Investigating.")).toBe(
      "Investigating.",
    );
    expect(applyTemplateToDraft("  \n", "Investigating.")).toBe(
      "Investigating.",
    );
  });

  test("what was already typed is kept and the template follows a blank line", () => {
    expect(applyTemplateToDraft("We saw errors.\n\n", "Investigating.")).toBe(
      "We saw errors.\n\nInvestigating.",
    );
  });
});

describe("buildNotesQuery", () => {
  const PARENT: ObjectID = new ObjectID("20000000-0000-4000-8000-000000001042");
  const PROJECT: ObjectID = new ObjectID(
    "10000000-0000-4000-8000-000000000001",
  );

  test("scopes the feed to one parent and the project", () => {
    const query: Record<string, unknown> = buildNotesQuery({
      parentIdField: "incidentId",
      parentId: PARENT,
      projectId: PROJECT,
    });

    expect(Object.keys(query).sort()).toEqual(["incidentId", "projectId"]);
    expect(String(query["incidentId"])).toBe(PARENT.toString());
    expect(String(query["projectId"])).toBe(PROJECT.toString());
  });

  test("searches the note text, trimmed", () => {
    const query: Record<string, unknown> = buildNotesQuery({
      parentIdField: "alertId",
      parentId: PARENT,
      projectId: PROJECT,
      searchText: "  certificate ",
    });

    expect(query["note"]).toBeInstanceOf(Search);
    expect((query["note"] as Search<string>).value).toBe("certificate");
  });

  test("a blank search asks for every note", () => {
    const query: Record<string, unknown> = buildNotesQuery({
      parentIdField: "alertId",
      parentId: PARENT,
      projectId: PROJECT,
      searchText: "   ",
    });

    expect(query["note"]).toBeUndefined();
  });

  test("leaves the project out when there is none", () => {
    expect(
      buildNotesQuery({
        parentIdField: "incidentId",
        parentId: PARENT,
        projectId: null,
      })["projectId"],
    ).toBeUndefined();
  });
});

describe("getPostedNotificationSummary", () => {
  test.each([
    [
      StatusPageSubscriberNotificationStatus.Success,
      "Subscribers notified",
      NoteNotificationTone.Success,
      IconProp.CheckCircle,
      false,
    ],
    [
      StatusPageSubscriberNotificationStatus.Pending,
      "Notifying subscribers soon",
      NoteNotificationTone.Pending,
      IconProp.Clock,
      false,
    ],
    [
      StatusPageSubscriberNotificationStatus.InProgress,
      "Notifying subscribers",
      NoteNotificationTone.Progress,
      IconProp.ArrowPath,
      false,
    ],
    [
      StatusPageSubscriberNotificationStatus.Failed,
      "Notification failed",
      NoteNotificationTone.Danger,
      IconProp.Error,
      true,
    ],
    [
      StatusPageSubscriberNotificationStatus.Skipped,
      "Subscribers not notified",
      NoteNotificationTone.Neutral,
      IconProp.BellSlash,
      false,
    ],
    [
      undefined,
      "Subscribers not notified",
      NoteNotificationTone.Neutral,
      IconProp.BellSlash,
      false,
    ],
  ])(
    "%s reads as %s",
    (
      status: StatusPageSubscriberNotificationStatus | undefined,
      label: string,
      tone: NoteNotificationTone,
      icon: IconProp,
      isRetryable: boolean,
    ) => {
      const summary: NoteNotificationSummary = getPostedNotificationSummary(
        status,
        undefined,
      );

      expect(summary).toEqual({
        label,
        tone,
        icon,
        isRetryable,
        detail: null,
      });
    },
  );

  test("carries the worker's message, trimmed", () => {
    expect(
      getPostedNotificationSummary(
        StatusPageSubscriberNotificationStatus.Failed,
        "  SMTP relay refused the connection. ",
      ).detail,
    ).toBe("SMTP relay refused the connection.");
  });

  test("a blank message is no detail at all", () => {
    expect(
      getPostedNotificationSummary(
        StatusPageSubscriberNotificationStatus.Failed,
        "   ",
      ).detail,
    ).toBeNull();
  });
});

describe("getUpdateNotificationSummary", () => {
  test("shows nothing until somebody asked to notify about an edit", () => {
    expect(getUpdateNotificationSummary(undefined, undefined)).toBeNull();
    expect(getUpdateNotificationSummary(null, "anything")).toBeNull();
  });

  test.each([
    [StatusPageSubscriberNotificationStatus.Success, "Update sent", false],
    [StatusPageSubscriberNotificationStatus.Pending, "Update queued", false],
    [
      StatusPageSubscriberNotificationStatus.InProgress,
      "Sending update",
      false,
    ],
    [StatusPageSubscriberNotificationStatus.Failed, "Update failed", true],
    [StatusPageSubscriberNotificationStatus.Skipped, "Update not sent", false],
  ])(
    "%s reads as %s",
    (
      status: StatusPageSubscriberNotificationStatus,
      label: string,
      isRetryable: boolean,
    ) => {
      const summary: NoteNotificationSummary | null =
        getUpdateNotificationSummary(status, "message");

      expect(summary?.label).toBe(label);
      expect(summary?.isRetryable).toBe(isRetryable);
      expect(summary?.detail).toBe("message");
    },
  );
});

describe("hasNotificationInFlight", () => {
  test("is true while a posted or an update notification is queued or sending", () => {
    for (const status of [
      StatusPageSubscriberNotificationStatus.Pending,
      StatusPageSubscriberNotificationStatus.InProgress,
    ]) {
      expect(
        hasNotificationInFlight([
          { subscriberNotificationStatusOnNoteCreated: status },
        ]),
      ).toBe(true);
      expect(
        hasNotificationInFlight([
          {
            subscriberNotificationStatusOnNoteCreated:
              StatusPageSubscriberNotificationStatus.Success,
            subscriberNotificationStatusOnNoteUpdated: status,
          },
        ]),
      ).toBe(true);
    }
  });

  test("is false once everything has settled", () => {
    expect(
      hasNotificationInFlight([
        {
          subscriberNotificationStatusOnNoteCreated:
            StatusPageSubscriberNotificationStatus.Success,
        },
        {
          subscriberNotificationStatusOnNoteCreated:
            StatusPageSubscriberNotificationStatus.Failed,
          subscriberNotificationStatusOnNoteUpdated:
            StatusPageSubscriberNotificationStatus.Skipped,
        },
        {},
      ]),
    ).toBe(false);
    expect(hasNotificationInFlight([])).toBe(false);
  });
});

describe("getNotesCopy", () => {
  test("public notes say they are shown on the status page", () => {
    const copy: ReturnType<typeof getNotesCopy> = getNotesCopy(
      "public",
      "incident",
    );

    expect(copy.title).toBe("Public notes");
    expect(copy.audienceLabel).toBe("Public");
    expect(copy.audienceHint).toBe("Visible on your status page");
    expect(copy.description).toContain("this incident");
    expect(copy.description).toContain("status page");
    expect(copy.deleteDescription).toContain("removed from your status page");
    expect(copy.submitLabel).toBe("Post update");
  });

  test("private notes say they stay with the team", () => {
    const copy: ReturnType<typeof getNotesCopy> = getNotesCopy(
      "private",
      "scheduled maintenance event",
    );

    expect(copy.title).toBe("Private notes");
    expect(copy.audienceLabel).toBe("Private");
    expect(copy.audienceHint).toBe("Only your team can see this");
    expect(copy.description).toContain("this scheduled maintenance event");
    expect(copy.description).toContain("never shown on a status page");
    expect(copy.deleteDescription).not.toContain("status page");
    expect(copy.submitLabel).toBe("Add note");
  });

  test("every string is filled in for both kinds", () => {
    for (const visibility of ["public", "private"] as const) {
      for (const value of Object.values(getNotesCopy(visibility, "alert"))) {
        expect(value.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("canWriteNoteColumn", () => {
  const model: IncidentPublicNote = new IncidentPublicNote();

  test("a master admin may write anything", () => {
    expect(
      canWriteNoteColumn({
        model,
        column: "postedAt",
        action: "create",
        userPermissions: [],
        isMasterAdmin: true,
      }),
    ).toBe(true);
  });

  test("a project member may write and backdate a note", () => {
    const write: (column: string, action: "create" | "update") => boolean = (
      column: string,
      action: "create" | "update",
    ): boolean => {
      return canWriteNoteColumn({
        model,
        column,
        action,
        userPermissions: [Permission.ProjectMember],
        isMasterAdmin: false,
      });
    };

    expect(write("note", "create")).toBe(true);
    expect(write("note", "update")).toBe(true);
    expect(write("postedAt", "create")).toBe(true);
    expect(write("postedAt", "update")).toBe(true);
    expect(
      write("shouldStatusPageSubscribersBeNotifiedOnNoteCreated", "create"),
    ).toBe(true);
  });

  test("a note-only permission reaches exactly the columns it names", () => {
    const write: (column: string, action: "create" | "update") => boolean = (
      column: string,
      action: "create" | "update",
    ): boolean => {
      return canWriteNoteColumn({
        model,
        column,
        action,
        userPermissions: [Permission.CreateIncidentPublicNote],
        isMasterAdmin: false,
      });
    };

    expect(write("note", "create")).toBe(true);
    expect(write("postedAt", "create")).toBe(true);
    // Creating a note is not permission to edit one.
    expect(write("note", "update")).toBe(false);
  });

  test("a viewer may write nothing", () => {
    expect(
      canWriteNoteColumn({
        model,
        column: "note",
        action: "create",
        userPermissions: [Permission.Viewer],
        isMasterAdmin: false,
      }),
    ).toBe(false);
  });

  test("a column with no rule for the action cannot be written", () => {
    expect(
      canWriteNoteColumn({
        model,
        column: "postedFromSlackMessageId",
        action: "update",
        userPermissions: [Permission.ProjectOwner],
        isMasterAdmin: false,
      }),
    ).toBe(false);
  });
});

describe("canReadNoteColumn and buildNotesSelect", () => {
  test("a column without a read rule is readable", () => {
    const unguardedModel: IncidentPublicNote = new IncidentPublicNote();
    unguardedModel.getColumnAccessControlForAllColumns = () => {
      return {};
    };

    expect(
      canReadNoteColumn({
        model: unguardedModel,
        column: "note",
        userPermissions: [],
        isMasterAdmin: false,
      }),
    ).toBe(true);
  });

  test("a master admin reads every column", () => {
    expect(
      canReadNoteColumn({
        model: new IncidentPublicNote(),
        column: "note",
        userPermissions: [],
        isMasterAdmin: true,
      }),
    ).toBe(true);
  });

  test("a column with a read rule needs a matching permission", () => {
    expect(
      canReadNoteColumn({
        model: new IncidentPublicNote(),
        column: "note",
        userPermissions: [Permission.Viewer],
        isMasterAdmin: false,
      }),
    ).toBe(true);
    expect(
      canReadNoteColumn({
        model: new IncidentPublicNote(),
        column: "note",
        userPermissions: [Permission.ReadAlertInternalNote],
        isMasterAdmin: false,
      }),
    ).toBe(false);
  });

  test("a public feed asks for posting time and notification state", () => {
    const select: Record<string, unknown> = buildNotesSelect({
      model: new IncidentPublicNote(),
      visibility: "public",
      isAttachmentsEnabled: true,
      userPermissions: [Permission.ProjectOwner],
      isMasterAdmin: false,
    });

    expect(Object.keys(select).sort()).toEqual(
      [
        "_id",
        "attachments",
        "createdAt",
        "createdByUser",
        "note",
        "postedAt",
        "postedFromSlackMessageId",
        "subscriberNotificationStatusMessage",
        "subscriberNotificationStatusMessageOnNoteUpdated",
        "subscriberNotificationStatusOnNoteCreated",
        "subscriberNotificationStatusOnNoteUpdated",
      ].sort(),
    );
    expect(select["createdByUser"]).toEqual({
      _id: true,
      name: true,
      email: true,
    });
    expect(select["attachments"]).toEqual({
      _id: true,
      name: true,
      fileType: true,
    });
  });

  test("a private feed asks for none of the public columns", () => {
    const select: Record<string, unknown> = buildNotesSelect({
      model: new IncidentInternalNote(),
      visibility: "private",
      isAttachmentsEnabled: true,
      userPermissions: [Permission.ProjectOwner],
      isMasterAdmin: false,
    });

    expect(select["postedAt"]).toBeUndefined();
    expect(select["subscriberNotificationStatusOnNoteCreated"]).toBeUndefined();
    expect(select["note"]).toBe(true);
    expect(select["attachments"]).toBeDefined();
  });

  test("attachments are left out where the note type cannot serve them back", () => {
    expect(
      buildNotesSelect({
        model: new IncidentInternalNote(),
        visibility: "private",
        isAttachmentsEnabled: false,
        userPermissions: [Permission.ProjectOwner],
        isMasterAdmin: false,
      })["attachments"],
    ).toBeUndefined();
  });

  test("asks for every column while the viewer's permissions are still unknown", () => {
    const select: Record<string, unknown> = buildNotesSelect({
      model: new IncidentPublicNote(),
      visibility: "public",
      isAttachmentsEnabled: false,
      userPermissions: [],
      isMasterAdmin: false,
    });

    expect(select["note"]).toBe(true);
    expect(select["postedAt"]).toBe(true);
    expect(select["createdByUser"]).toBeDefined();
  });

  test("never asks for a column the viewer cannot read", () => {
    const select: Record<string, unknown> = buildNotesSelect({
      model: new IncidentPublicNote(),
      visibility: "public",
      isAttachmentsEnabled: true,
      userPermissions: [Permission.ReadAlertInternalNote],
      isMasterAdmin: false,
    });

    expect(select["note"]).toBeUndefined();
    expect(select["postedAt"]).toBeUndefined();
    expect(select["createdAt"]).toBeUndefined();
    // Every request names the row it wants.
    expect(select).toEqual({ _id: true });
  });
});

describe("date input round trip", () => {
  test("shows a date to the minute and reads it back as the same instant", () => {
    const date: Date = new Date("2026-09-14T18:20:45.000Z");
    const value: string = toDateTimeInputValue(date);

    expect(value).toBe("2026-09-14T18:20");
    expect(fromDateTimeInputValue(value)?.toISOString()).toBe(
      "2026-09-14T18:20:00.000Z",
    );
  });

  test("an empty input is no date", () => {
    expect(fromDateTimeInputValue("")).toBeNull();
    expect(fromDateTimeInputValue("   ")).toBeNull();
  });
});

describe("getNoteTimeLabel", () => {
  test("a recent note reads relative to the feed's now, not the wall clock", () => {
    expect(getNoteTimeLabel(ago(12 * MINUTE), NOW)).toBe("12 minutes ago");
    expect(getNoteTimeLabel(ago(2 * HOUR), NOW)).toBe("2 hours ago");
    expect(getNoteTimeLabel(ago(10 * 1000), NOW)).toBe("just now");
  });

  test.each([
    [0, "just now"],
    [59 * 1000, "just now"],
    [MINUTE, "1 minute ago"],
    [59 * MINUTE, "59 minutes ago"],
    [HOUR, "1 hour ago"],
    [5 * HOUR + 59 * MINUTE, "5 hours ago"],
    [-5 * MINUTE, "just now"],
  ])("%p ms reads as %p", (ageMs: number, label: string) => {
    expect(getRelativeTimeLabel(ageMs)).toBe(label);
  });

  test("an older note reads as a clock time, since its day heading names the date", () => {
    expect(getNoteTimeLabel(ago(DAY + 2 * HOUR), NOW)).toMatch(
      /^(16:20|4:20 PM)$/,
    );
  });

  test("a note posted for later reads as a clock time, not 'in 2 hours'", () => {
    expect(
      getNoteTimeLabel(new Date(NOW.getTime() + 2 * HOUR), NOW),
    ).not.toContain("in ");
  });
});

describe("getNoteSourceLabel", () => {
  test("names notes that came from Slack", () => {
    expect(getNoteSourceLabel({ postedFromSlackMessageId: "C1:1.2" })).toBe(
      "via Slack",
    );
    expect(getNoteSourceLabel({})).toBeNull();
  });
});

describe("getTemplatePreview", () => {
  test.each([
    ["## Investigating\nWe are looking.", "Investigating"],
    [
      "\n\n  **Identified.** The cause is known.",
      "Identified. The cause is known.",
    ],
    ["- first bullet\n- second", "first bullet"],
    ["`code` and _emphasis_", "code and emphasis"],
    ["", ""],
  ])("%p -> %p", (note: string, preview: string) => {
    expect(getTemplatePreview(note)).toBe(preview);
  });
});

describe("getAttachmentDownloadUrl", () => {
  test("builds the note model's authenticated download route", () => {
    const url: string | null = getAttachmentDownloadUrl({
      attachmentApiPath: "/incident-public-note/attachment",
      projectId: "p1",
      noteId: "n1",
      fileId: "f1",
    });

    expect(url).toMatch(/\/incident-public-note\/attachment\/p1\/n1\/f1$/);
  });

  test("is null without a project or a note", () => {
    expect(
      getAttachmentDownloadUrl({
        attachmentApiPath: "/x",
        projectId: null,
        noteId: "n1",
        fileId: "f1",
      }),
    ).toBeNull();
    expect(
      getAttachmentDownloadUrl({
        attachmentApiPath: "/x",
        projectId: "p1",
        noteId: null,
        fileId: "f1",
      }),
    ).toBeNull();
  });
});
