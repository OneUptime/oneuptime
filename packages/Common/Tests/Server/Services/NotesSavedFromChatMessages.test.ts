import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeInternalNoteService from "../../../Server/Services/AlertEpisodeInternalNoteService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertInternalNoteService from "../../../Server/Services/AlertInternalNoteService";
import AlertService from "../../../Server/Services/AlertService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeInternalNoteService from "../../../Server/Services/IncidentEpisodeInternalNoteService";
import IncidentEpisodePublicNoteService from "../../../Server/Services/IncidentEpisodePublicNoteService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentInternalNoteService from "../../../Server/Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../Server/Services/IncidentService";
import ScheduledMaintenanceFeedService from "../../../Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenanceInternalNoteService from "../../../Server/Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenancePublicNoteService from "../../../Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import UserService from "../../../Server/Services/UserService";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import User from "../../../Models/DatabaseModels/User";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import SavedChatMessage from "../../../Types/Workspace/SavedChatMessage";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import { getJestSpyOn } from "../../Spy";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { stubReadableParents } from "../TestingUtils/ReadableParents";
import { mockProjectStates } from "../TestingUtils/Services/ProjectStatesHelper";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * A SLACK OR MICROSOFT TEAMS MESSAGE SAVED AS A NOTE, THROUGH EACH NOTE
 * SERVICE'S REAL CREATE.
 *
 * Nitin pins a message Aidil wrote. The note is Nitin's - his permissions,
 * his name as its creator - and records whose words it is, in which chat,
 * posted when (savedFromChatMessage): written by the service only once
 * Nitin's checks have passed, and by nobody else - an API caller who sends
 * it is refused. A private note is filed in the timeline when the message
 * was posted. The note's timeline entry names Aidil, the chat and Nitin,
 * and is not posted back into the channel the message is in.
 *
 * These run DatabaseService's create - its checks, the hooks, the save,
 * the success hook - over an in-memory table, for every kind of note.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5c000000-0000-4000-8000-000000000001",
);
const RECORD_ID: ObjectID = new ObjectID(
  "5c000000-0000-4000-8000-000000000002",
);
// Nitin, who pins.
const NITIN_ID: ObjectID = new ObjectID("5c000000-0000-4000-8000-000000000003");

const POSTED_AT: Date = new Date("2026-10-08T10:17:00.000Z");
const MESSAGE: string =
  "Not sure what's happening here, is this triggered by something?";
const SLACK_KEY: string = "C0INC8:1791454620.000200";
const TEAMS_KEY: string = "19:inc-8@thread.tacv2:1700000000200";

const FROM_SLACK: SavedChatMessage = {
  workspaceType: WorkspaceType.Slack,
  authorName: "Aidil Rahman",
  postedAt: POSTED_AT.toISOString(),
};

interface NoteCase {
  name: string;
  service: DatabaseService<BaseModel>;
  recordColumn: string;
  isPublic: boolean;
  // A role that may post the note.
  role: Array<Permission>;
  // The record, as the entry links it.
  record: string;
  // Stubs what the success hook reads; the feed writer it calls.
  stub: () => jest.SpyInstance;
  feedEventColumn: string;
}

const LINK: (path: string) => URL = (path: string): URL => {
  return URL.fromString(`https://oneuptime.example/dashboard/${path}`);
};

const NOTE_CASES: Array<NoteCase> = [
  {
    name: "an incident's private note",
    service: IncidentInternalNoteService as never,
    recordColumn: "incidentId",
    isPublic: false,
    role: [Permission.IncidentMember],
    record: "[Incident INC-8](https://oneuptime.example/dashboard/incidents/8)",
    feedEventColumn: "incidentFeedEventType",
    stub: (): jest.SpyInstance => {
      getJestSpyOn(IncidentService, "getIncidentNumber").mockResolvedValue({
        number: 8,
        numberWithPrefix: "INC-8",
      });
      getJestSpyOn(
        IncidentService,
        "getIncidentLinkInDashboard",
      ).mockResolvedValue(LINK("incidents/8"));
      return getJestSpyOn(
        IncidentFeedService,
        "createIncidentFeedItem",
      ).mockResolvedValue(undefined) as never;
    },
  },
  {
    name: "an incident's public note",
    service: IncidentPublicNoteService as never,
    recordColumn: "incidentId",
    isPublic: true,
    role: [Permission.IncidentMember],
    record: "[Incident INC-8](https://oneuptime.example/dashboard/incidents/8)",
    feedEventColumn: "incidentFeedEventType",
    stub: (): jest.SpyInstance => {
      getJestSpyOn(IncidentService, "findOneBy").mockResolvedValue(null);
      getJestSpyOn(IncidentService, "getIncidentNumber").mockResolvedValue({
        number: 8,
        numberWithPrefix: "INC-8",
      });
      getJestSpyOn(
        IncidentService,
        "getIncidentLinkInDashboard",
      ).mockResolvedValue(LINK("incidents/8"));
      return getJestSpyOn(
        IncidentFeedService,
        "createIncidentFeedItem",
      ).mockResolvedValue(undefined) as never;
    },
  },
  {
    name: "an alert's private note",
    service: AlertInternalNoteService as never,
    recordColumn: "alertId",
    isPublic: false,
    role: [Permission.AlertMember],
    record: "[Alert ALT-3](https://oneuptime.example/dashboard/alerts/3)",
    feedEventColumn: "alertFeedEventType",
    stub: (): jest.SpyInstance => {
      getJestSpyOn(AlertService, "getAlertNumber").mockResolvedValue({
        number: 3,
        numberWithPrefix: "ALT-3",
      });
      getJestSpyOn(AlertService, "getAlertLinkInDashboard").mockResolvedValue(
        LINK("alerts/3"),
      );
      return getJestSpyOn(
        AlertFeedService,
        "createAlertFeedItem",
      ).mockResolvedValue(undefined) as never;
    },
  },
  {
    name: "a scheduled maintenance event's private note",
    service: ScheduledMaintenanceInternalNoteService as never,
    recordColumn: "scheduledMaintenanceId",
    isPublic: false,
    role: [Permission.ProjectMember],
    record:
      "[Scheduled Maintenance SM-2](https://oneuptime.example/dashboard/scheduled-maintenance/2)",
    feedEventColumn: "scheduledMaintenanceFeedEventType",
    stub: (): jest.SpyInstance => {
      getJestSpyOn(
        ScheduledMaintenanceService,
        "getScheduledMaintenanceNumber",
      ).mockResolvedValue({ number: 2, numberWithPrefix: "SM-2" });
      getJestSpyOn(
        ScheduledMaintenanceService,
        "getScheduledMaintenanceLinkInDashboard",
      ).mockResolvedValue(LINK("scheduled-maintenance/2"));
      return getJestSpyOn(
        ScheduledMaintenanceFeedService,
        "createScheduledMaintenanceFeedItem",
      ).mockResolvedValue(undefined) as never;
    },
  },
  {
    name: "a scheduled maintenance event's public note",
    service: ScheduledMaintenancePublicNoteService as never,
    recordColumn: "scheduledMaintenanceId",
    isPublic: true,
    role: [Permission.ProjectMember],
    record:
      "[Scheduled Maintenance SM-2](https://oneuptime.example/dashboard/scheduled-maintenance/2)",
    feedEventColumn: "scheduledMaintenanceFeedEventType",
    stub: (): jest.SpyInstance => {
      getJestSpyOn(ScheduledMaintenanceService, "findOneBy").mockResolvedValue(
        null,
      );
      getJestSpyOn(
        ScheduledMaintenanceService,
        "getScheduledMaintenanceNumber",
      ).mockResolvedValue({ number: 2, numberWithPrefix: "SM-2" });
      getJestSpyOn(
        ScheduledMaintenanceService,
        "getScheduledMaintenanceLinkInDashboard",
      ).mockResolvedValue(LINK("scheduled-maintenance/2"));
      return getJestSpyOn(
        ScheduledMaintenanceFeedService,
        "createScheduledMaintenanceFeedItem",
      ).mockResolvedValue(undefined) as never;
    },
  },
  {
    name: "an incident episode's private note",
    service: IncidentEpisodeInternalNoteService as never,
    recordColumn: "incidentEpisodeId",
    isPublic: false,
    role: [Permission.IncidentMember],
    record:
      "[Episode IE-5](https://oneuptime.example/dashboard/incident-episodes/5)",
    feedEventColumn: "feedInfoInMarkdown",
    stub: (): jest.SpyInstance => {
      getJestSpyOn(
        IncidentEpisodeService,
        "getEpisodeNumber",
      ).mockResolvedValue({ number: 5, numberWithPrefix: "IE-5" });
      getJestSpyOn(
        IncidentEpisodeService,
        "getEpisodeLinkInDashboard",
      ).mockResolvedValue(LINK("incident-episodes/5"));
      return getJestSpyOn(
        IncidentEpisodeFeedService,
        "createIncidentEpisodeFeedItem",
      ).mockResolvedValue(undefined) as never;
    },
  },
  {
    name: "an incident episode's public note",
    service: IncidentEpisodePublicNoteService as never,
    recordColumn: "incidentEpisodeId",
    isPublic: true,
    role: [Permission.IncidentMember],
    record:
      "[Episode IE-5](https://oneuptime.example/dashboard/incident-episodes/5)",
    feedEventColumn: "feedInfoInMarkdown",
    stub: (): jest.SpyInstance => {
      getJestSpyOn(IncidentEpisodeService, "findOneBy").mockResolvedValue(null);
      getJestSpyOn(
        IncidentEpisodeService,
        "getEpisodeNumber",
      ).mockResolvedValue({ number: 5, numberWithPrefix: "IE-5" });
      getJestSpyOn(
        IncidentEpisodeService,
        "getEpisodeLinkInDashboard",
      ).mockResolvedValue(LINK("incident-episodes/5"));
      return getJestSpyOn(
        IncidentEpisodeFeedService,
        "createIncidentEpisodeFeedItem",
      ).mockResolvedValue(undefined) as never;
    },
  },
  {
    name: "an alert episode's private note",
    service: AlertEpisodeInternalNoteService as never,
    recordColumn: "alertEpisodeId",
    isPublic: false,
    role: [Permission.AlertMember],
    record:
      "[Episode AE-4](https://oneuptime.example/dashboard/alert-episodes/4)",
    feedEventColumn: "feedInfoInMarkdown",
    stub: (): jest.SpyInstance => {
      getJestSpyOn(AlertEpisodeService, "getEpisodeNumber").mockResolvedValue({
        number: 4,
        numberWithPrefix: "AE-4",
      });
      getJestSpyOn(
        AlertEpisodeService,
        "getEpisodeLinkInDashboard",
      ).mockResolvedValue(LINK("alert-episodes/4"));
      return getJestSpyOn(
        AlertEpisodeFeedService,
        "createAlertEpisodeFeedItem",
      ).mockResolvedValue(undefined) as never;
    },
  },
];

// A case as describe.each's row: its name, then the case.
const asRow: (noteCase: NoteCase) => [string, NoteCase] = (
  noteCase: NoteCase,
): [string, NoteCase] => {
  return [noteCase.name, noteCase];
};

function userPermission(
  permission: Permission,
  isBlockPermission: boolean,
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: isBlockPermission,
    scope: PermissionScope.All,
  };
}

// A member of the project with these permissions, asking in it.
function memberProps(
  allow: Array<Permission>,
  userId: ObjectID = NITIN_ID,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [Permission.CurrentUser, Permission.ProjectUser, ...allow].map(
      (permission: Permission): UserPermission => {
        return userPermission(permission, false);
      },
    ),
  };

  return {
    userId: userId,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
}

type AddNote = (data: JSONObject) => Promise<BaseModel>;

function addNoteOf(service: DatabaseService<BaseModel>): AddNote {
  return (service as unknown as { addNote: AddNote }).addNote.bind(
    service,
  ) as AddNote;
}

beforeEach(() => {
  mockProjectStates();
  stubProjectDirectory({});
  stubReadableParents();

  const nitin: User = new User();
  nitin.name = new Name("Nitin Kumar");
  getJestSpyOn(UserService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }): Promise<User | null> => {
    return data.id.toString() === NITIN_ID.toString() ? nitin : null;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(NOTE_CASES.map(asRow))(
  "%s, saved from a chat message",
  (_name: string, noteCase: NoteCase) => {
    let notes: InMemoryTable;
    let feed: jest.SpyInstance;

    beforeEach(() => {
      notes = useInMemoryTable(noteCase.service, []);
      getJestSpyOn(
        noteCase.service as never,
        "getAttachmentsMarkdown",
      ).mockResolvedValue("" as never);
      feed = noteCase.stub();
    });

    function save(data?: {
      saved?: SavedChatMessage | undefined;
      key?: string | undefined;
      props?: DatabaseCommonInteractionProps | undefined;
    }): Promise<BaseModel> {
      const saved: SavedChatMessage | undefined =
        data && "saved" in data ? data.saved : FROM_SLACK;

      return addNoteOf(noteCase.service)({
        [noteCase.recordColumn]: RECORD_ID,
        projectId: PROJECT_ID,
        note: MESSAGE,
        postedFromSlackMessageId: data?.key || SLACK_KEY,
        savedFromChatMessage: saved,
        // A private note is filed when the message was posted.
        postedAt: noteCase.isPublic ? undefined : POSTED_AT,
        props: data?.props || memberProps(noteCase.role),
      } as unknown as JSONObject);
    }

    test("is Nitin's, and records Aidil's message: chat, name, time", async () => {
      await save();

      expect(notes.inserts).toHaveLength(1);
      const row: StoredRow = notes.inserts[0]!;

      expect(row["note"]).toBe(MESSAGE);
      expect(String(row["createdByUserId"])).toBe(NITIN_ID.toString());
      expect(row["postedFromSlackMessageId"]).toBe(SLACK_KEY);
      expect(row["savedFromChatMessage"]).toEqual({
        workspaceType: WorkspaceType.Slack,
        authorName: "Aidil Rahman",
        postedAt: POSTED_AT.toISOString(),
      });

      if (noteCase.isPublic) {
        // Published now: when the status page's readers see it.
        expect((row["postedAt"] as Date).getTime()).toBeGreaterThan(
          POSTED_AT.getTime(),
        );
      } else {
        expect(row["postedAt"]).toEqual(POSTED_AT);
      }
    });

    test("its timeline entry names Aidil, the chat and Nitin, and is not posted back into the message's channel", async () => {
      await save();

      expect(feed).toHaveBeenCalledTimes(1);
      const item: JSONObject = feed.mock.calls[0]![0] as JSONObject;
      const where: string = noteCase.isPublic
        ? `posted **public note** for this ${noteCase.record} on status page via Slack`
        : `posted **private note** for this ${noteCase.record} via Slack`;

      expect(item["feedInfoInMarkdown"]).toBe(
        `📄 **Aidil Rahman** ${where} (note added by Nitin Kumar):\n\n${MESSAGE}`,
      );
      expect(String(item["userId"])).toBe(NITIN_ID.toString());
      expect(item["savedFromChatMessage"]).toEqual({
        workspaceType: WorkspaceType.Slack,
        authorName: "Aidil Rahman",
        postedAt: POSTED_AT.toISOString(),
      });
      expect(item["workspaceNotification"]).toEqual({
        sendWorkspaceNotification: true,
        // The entry names who wrote the message and who saved it itself.
        leadWithAuthor: false,
        exceptChannel: {
          workspaceType: WorkspaceType.Slack,
          channelId: "C0INC8",
        },
      });

      if (!noteCase.isPublic) {
        expect(item["postedAt"]).toEqual(POSTED_AT);
      }
    });

    test("a Microsoft Teams channel's id keeps its own colons", async () => {
      await save({
        saved: { ...FROM_SLACK, workspaceType: WorkspaceType.MicrosoftTeams },
        key: TEAMS_KEY,
      });

      const item: JSONObject = feed.mock.calls[0]![0] as JSONObject;

      expect(
        (item["workspaceNotification"] as JSONObject)["exceptChannel"],
      ).toEqual({
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelId: "19:inc-8@thread.tacv2",
      });
      expect(String(item["feedInfoInMarkdown"])).toContain(
        "via Microsoft Teams (note added by Nitin Kumar):",
      );
    });

    test("saved by its own author, the entry does not say who added it", async () => {
      await save({
        saved: {
          ...FROM_SLACK,
          authorUserId: NITIN_ID.toString(),
          authorName: "Nitin Kumar",
        },
      });

      const markdown: string = String(
        (feed.mock.calls[0]![0] as JSONObject)["feedInfoInMarkdown"],
      );

      expect(markdown.startsWith("📄 **Nitin Kumar** ")).toBe(true);
      expect(markdown).not.toContain("note added by");
    });

    test("a name with Markdown or a mention in it is text in the entry", async () => {
      await save({
        saved: {
          ...FROM_SLACK,
          authorName: "**Aidil** [x](https://evil.example) <!channel>",
        },
      });

      const markdown: string = String(
        (feed.mock.calls[0]![0] as JSONObject)["feedInfoInMarkdown"],
      );

      expect(markdown).toContain(
        "\\*\\*Aidil\\*\\* \\[x\\](https://evil.example)",
      );
      expect(markdown).not.toContain("<!channel>");
    });

    test("an API caller cannot say a note came from a chat message", async () => {
      const service: DatabaseService<BaseModel> = noteCase.service;
      const note: BaseModel = new (service.modelType as unknown as {
        new (): BaseModel;
      })();
      const row: Record<string, unknown> = note as unknown as Record<
        string,
        unknown
      >;
      row[noteCase.recordColumn] = RECORD_ID;
      row["projectId"] = PROJECT_ID;
      row["note"] = "A note I typed";
      row["savedFromChatMessage"] = {
        workspaceType: WorkspaceType.Slack,
        authorName: "The CEO",
      };

      const error: unknown = await rejectionOf(
        service.create({ data: note, props: memberProps(noteCase.role) }),
      );

      // Refused as a column nobody may write, before anything is saved.
      expect(error).toBeInstanceOf(ColumnWriteRefusedException);
      expect((error as ColumnWriteRefusedException).columnName).toBe(
        "savedFromChatMessage",
      );
      expect(notes.inserts).toEqual([]);
      expect(feed).not.toHaveBeenCalled();
    });

    test("a note typed in OneUptime reads as before, with no chat in it", async () => {
      await save({ saved: undefined });

      const row: StoredRow = notes.inserts[0]!;
      expect(row["savedFromChatMessage"]).toBeUndefined();

      const item: JSONObject = feed.mock.calls[0]![0] as JSONObject;

      expect(
        String(item["feedInfoInMarkdown"]).startsWith("📄 posted **"),
      ).toBe(true);
      expect(item["savedFromChatMessage"]).toBeUndefined();
      expect(
        (item["workspaceNotification"] as JSONObject)["exceptChannel"],
      ).toBeUndefined();
      // Its message opens with the person who posted it: its author.
      expect(
        (item["workspaceNotification"] as JSONObject)["leadWithAuthor"],
      ).toBe(true);
      expect(String(item["userId"])).toBe(NITIN_ID.toString());
    });

    test("a member who may not post the note saves nothing", async () => {
      const error: unknown = await rejectionOf(
        save({ props: memberProps([]) }),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(notes.inserts).toEqual([]);
      expect(feed).not.toHaveBeenCalled();
    });
  },
);

describe.each(
  NOTE_CASES.filter((noteCase: NoteCase) => {
    return !noteCase.isPublic;
  }).map(asRow),
)("%s typed in OneUptime", (_name: string, noteCase: NoteCase) => {
  test("is filed when it is written", async () => {
    const notes: InMemoryTable = useInMemoryTable(noteCase.service, []);
    getJestSpyOn(
      noteCase.service as never,
      "getAttachmentsMarkdown",
    ).mockResolvedValue("" as never);
    noteCase.stub();

    const before: number = Date.now();

    await addNoteOf(noteCase.service)({
      [noteCase.recordColumn]: RECORD_ID,
      projectId: PROJECT_ID,
      note: "Rolled back",
      props: memberProps(noteCase.role),
    } as unknown as JSONObject);

    const postedAt: Date = notes.inserts[0]!["postedAt"] as Date;

    expect(postedAt).toBeInstanceOf(Date);
    expect(postedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(postedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
