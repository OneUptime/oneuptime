import IncidentAIContextBuilder, {
  AIGenerationContext,
  IncidentContextData,
} from "../../../../Server/Utils/AI/IncidentAIContextBuilder";
import AlertAIContextBuilder, {
  AlertContextData,
} from "../../../../Server/Utils/AI/AlertAIContextBuilder";
import ScheduledMaintenanceAIContextBuilder, {
  ScheduledMaintenanceContextData,
} from "../../../../Server/Utils/AI/ScheduledMaintenanceAIContextBuilder";
import IncidentEpisodeAIContextBuilder, {
  IncidentEpisodeContextData,
} from "../../../../Server/Utils/AI/IncidentEpisodeAIContextBuilder";
import AlertInternalNoteService from "../../../../Server/Services/AlertInternalNoteService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import IncidentEpisodeInternalNoteService from "../../../../Server/Services/IncidentEpisodeInternalNoteService";
import IncidentEpisodeMemberService from "../../../../Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "../../../../Server/Services/IncidentEpisodeStateTimelineService";
import IncidentInternalNoteService from "../../../../Server/Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "../../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import ScheduledMaintenanceInternalNoteService from "../../../../Server/Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenancePublicNoteService from "../../../../Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "../../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import TablePermission from "../../../../Server/Types/Database/Permissions/TablePermission";
import WorkspaceUtil from "../../../../Server/Utils/Workspace/Workspace";
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AlertInternalNote from "../../../../Models/DatabaseModels/AlertInternalNote";
import IncidentEpisodeInternalNote from "../../../../Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import Incident from "../../../../Models/DatabaseModels/Incident";
import ScheduledMaintenanceInternalNote from "../../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenancePublicNote from "../../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseRequestType from "../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AN AI NOTE OR POSTMORTEM IS WRITTEN FROM WHAT ITS READER MAY READ.
 *
 * Generate with AI on an incident, an alert, a maintenance event or an
 * episode builds its prompt from the record's notes, its channel's
 * discussion and, for an episode, its incidents. Those used to be read as
 * OneUptime, so someone who may only post public notes - or whose team
 * blocks reading internal notes - got the internal notes summarised into
 * their draft, and an episode's draft named private incidents. Now each
 * is read with the reader's props (readContextRows): a table they may not
 * read is no notes at all, the channel's discussion goes with the internal
 * notes, and an incident outside their read is left out. OneUptime's own
 * drafts (no reader) read everything, as before.
 *
 * Each read below answers as findBy does: the table's own read rule first
 * (TablePermission: an allow row for one of its read permissions, and no
 * block on them), then the rows.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "9e1d3c50-2a4b-4c6d-8e0f-1a2b3c4d5e01",
);
const RECORD_ID: ObjectID = new ObjectID(
  "9e1d3c50-2a4b-4c6d-8e0f-1a2b3c4d5e02",
);
const PRIVATE_INCIDENT_ID: ObjectID = new ObjectID(
  "9e1d3c50-2a4b-4c6d-8e0f-1a2b3c4d5e03",
);
const OPEN_INCIDENT_ID: ObjectID = new ObjectID(
  "9e1d3c50-2a4b-4c6d-8e0f-1a2b3c4d5e04",
);

const INTERNAL_NOTE: string =
  "Root cause: the payroll database password leaked";
const PUBLIC_NOTE: string = "We are looking into slow checkouts.";
const CHANNEL_MESSAGE: string = "rotating the leaked payroll credentials now";
const PRIVATE_INCIDENT_TITLE: string = "Payroll data exposure";
const OPEN_INCIDENT_TITLE: string = "Checkout latency";

interface Row {
  permission: Permission;
  isBlockPermission?: boolean | undefined;
}

function reader(rows: Array<Row>): DatabaseCommonInteractionProps {
  return {
    userId: ObjectID.generate(),
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows.map((row: Row): UserPermission => {
          return {
            _type: "UserPermission",
            permission: row.permission,
            labelIds: [],
            isBlockPermission: Boolean(row.isBlockPermission),
          };
        }),
      },
    },
    ...ON_HIGHEST_PLAN,
  };
}

// A read as findBy makes it: the table's read rule for the caller, then the rows.
function readAs<T>(
  modelType: { new (): DatabaseBaseModel },
  rows: () => Array<T>,
): (args: { props: DatabaseCommonInteractionProps }) => Promise<Array<T>> {
  return async (args: {
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<T>> => {
    if (!args.props.isRoot) {
      TablePermission.checkTableLevelPermissions(
        modelType as never,
        args.props,
        DatabaseRequestType.Read,
      );
      TablePermission.checkTableLevelBlockPermissions(
        modelType as never,
        args.props,
        DatabaseRequestType.Read,
      );
    }

    return rows();
  };
}

function note<T extends DatabaseBaseModel>(
  modelType: { new (): T },
  text: string,
): T {
  const row: T = new modelType();
  (row as unknown as { note: string }).note = text;
  (row as unknown as { createdAt: Date }).createdAt = new Date(
    "2026-10-27T10:00:00.000Z",
  );
  return row;
}

let channelRead: jest.SpyInstance;

beforeEach(() => {
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockResolvedValue({ authToken: "xoxb-test" } as never);
  channelRead = jest
    .spyOn(WorkspaceUtil, "getChannelMessages")
    .mockResolvedValue([
      {
        messageId: "1",
        text: CHANNEL_MESSAGE,
        username: "dana",
        timestamp: new Date("2026-10-27T10:05:00.000Z"),
        isBot: false,
      },
    ] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// What a draft's prompt holds, every message of it.
function promptOf(context: AIGenerationContext): string {
  return context.messages
    .map((message: { content: unknown }): string => {
      return String(message.content);
    })
    .join("\n");
}

describe("an incident's AI note and postmortem", () => {
  beforeEach(() => {
    const incident: Incident = new Incident(RECORD_ID);
    incident.projectId = PROJECT_ID;
    incident.title = "Checkout errors";
    incident.postUpdatesToWorkspaceChannels = [
      { id: "C1", name: "inc-1", workspaceType: WorkspaceType.Slack },
    ] as never;

    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(incident);
    jest.spyOn(IncidentStateTimelineService, "findBy").mockResolvedValue([]);
    jest.spyOn(IncidentInternalNoteService, "findBy").mockImplementation(
      readAs(IncidentInternalNote, () => {
        return [note(IncidentInternalNote, INTERNAL_NOTE)];
      }) as never,
    );
    jest.spyOn(IncidentPublicNoteService, "findBy").mockImplementation(
      readAs(IncidentPublicNote, () => {
        return [note(IncidentPublicNote, PUBLIC_NOTE)];
      }) as never,
    );
  });

  async function draftFor(
    readerProps: DatabaseCommonInteractionProps | undefined,
  ): Promise<string> {
    const context: IncidentContextData =
      await IncidentAIContextBuilder.buildIncidentContext({
        incidentId: RECORD_ID,
        includeWorkspaceMessages: true,
        readerProps,
      });

    return promptOf(
      IncidentAIContextBuilder.formatIncidentContextForNote(context, "public"),
    );
  }

  test("someone who may post public notes but not read internal ones gets neither the internal notes nor the channel's discussion", async () => {
    const prompt: string = await draftFor(
      reader([
        { permission: Permission.ReadProjectIncident },
        { permission: Permission.ReadIncidentPublicNote },
        { permission: Permission.CreateIncidentPublicNote },
      ]),
    );

    expect(prompt).not.toContain(INTERNAL_NOTE);
    expect(prompt).not.toContain(CHANNEL_MESSAGE);
    expect(channelRead).not.toHaveBeenCalled();
    expect(prompt).toContain(PUBLIC_NOTE);
  });

  test("an Incident Member whose team blocks reading internal notes gets neither", async () => {
    const prompt: string = await draftFor(
      reader([
        { permission: Permission.IncidentMember },
        {
          permission: Permission.ReadIncidentInternalNote,
          isBlockPermission: true,
        },
      ]),
    );

    expect(prompt).not.toContain(INTERNAL_NOTE);
    expect(prompt).not.toContain(CHANNEL_MESSAGE);
    expect(prompt).toContain(PUBLIC_NOTE);
  });

  test("an Incident Member gets the internal notes and the channel's discussion", async () => {
    const prompt: string = await draftFor(
      reader([{ permission: Permission.IncidentMember }]),
    );

    expect(prompt).toContain(INTERNAL_NOTE);
    expect(prompt).toContain(CHANNEL_MESSAGE);
    expect(prompt).toContain(PUBLIC_NOTE);
  });

  test("OneUptime's own draft - no reader - reads everything, as before", async () => {
    const prompt: string = await draftFor(undefined);

    expect(prompt).toContain(INTERNAL_NOTE);
    expect(prompt).toContain(CHANNEL_MESSAGE);
    expect(
      (
        (IncidentInternalNoteService.findBy as unknown as jest.Mock).mock
          .calls[0]![0] as { props: DatabaseCommonInteractionProps }
      ).props,
    ).toEqual({ isRoot: true });
  });
});

describe("an alert's AI note", () => {
  beforeEach(() => {
    jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue({ id: RECORD_ID, title: "High CPU" } as never);
    jest.spyOn(AlertStateTimelineService, "findBy").mockResolvedValue([]);
    jest.spyOn(AlertInternalNoteService, "findBy").mockImplementation(
      readAs(AlertInternalNote, () => {
        return [note(AlertInternalNote, INTERNAL_NOTE)];
      }) as never,
    );
  });

  async function draftFor(
    readerProps: DatabaseCommonInteractionProps,
  ): Promise<string> {
    const context: AlertContextData =
      await AlertAIContextBuilder.buildAlertContext({
        alertId: RECORD_ID,
        readerProps,
      });

    return promptOf(AlertAIContextBuilder.formatAlertContextForNote(context));
  }

  test("someone who may write the alert's notes but whose team blocks reading them does not get them", async () => {
    const prompt: string = await draftFor(
      reader([
        { permission: Permission.ReadAlert },
        { permission: Permission.CreateAlertInternalNote },
        { permission: Permission.ReadAlertInternalNote },
        {
          permission: Permission.ReadAlertInternalNote,
          isBlockPermission: true,
        },
      ]),
    );

    expect(prompt).not.toContain(INTERNAL_NOTE);
  });

  test("someone who may read them gets them", async () => {
    const prompt: string = await draftFor(
      reader([{ permission: Permission.AlertMember }]),
    );

    expect(prompt).toContain(INTERNAL_NOTE);
  });
});

describe("a scheduled maintenance event's AI note", () => {
  beforeEach(() => {
    jest
      .spyOn(ScheduledMaintenanceService, "findOneById")
      .mockResolvedValue({ id: RECORD_ID, title: "DB upgrade" } as never);
    jest
      .spyOn(ScheduledMaintenanceStateTimelineService, "findBy")
      .mockResolvedValue([]);
    jest
      .spyOn(ScheduledMaintenanceInternalNoteService, "findBy")
      .mockImplementation(
        readAs(ScheduledMaintenanceInternalNote, () => {
          return [note(ScheduledMaintenanceInternalNote, INTERNAL_NOTE)];
        }) as never,
      );
    jest
      .spyOn(ScheduledMaintenancePublicNoteService, "findBy")
      .mockImplementation(
        readAs(ScheduledMaintenancePublicNote, () => {
          return [note(ScheduledMaintenancePublicNote, PUBLIC_NOTE)];
        }) as never,
      );
  });

  test("someone who may post public notes but not read internal ones does not get the internal notes", async () => {
    const context: ScheduledMaintenanceContextData =
      await ScheduledMaintenanceAIContextBuilder.buildScheduledMaintenanceContext(
        {
          scheduledMaintenanceId: RECORD_ID,
          readerProps: reader([
            { permission: Permission.ReadProjectScheduledMaintenance },
            { permission: Permission.ReadScheduledMaintenancePublicNote },
            { permission: Permission.CreateScheduledMaintenancePublicNote },
          ]),
        },
      );

    const prompt: string = promptOf(
      ScheduledMaintenanceAIContextBuilder.formatScheduledMaintenanceContextForNote(
        context,
        "public",
      ),
    );

    expect(prompt).not.toContain(INTERNAL_NOTE);
    expect(prompt).toContain(PUBLIC_NOTE);
  });
});

describe("an incident episode's AI postmortem", () => {
  // Who may read the private incident: its owners, not this reader.
  let readableIncidentIds: Array<string>;

  beforeEach(() => {
    readableIncidentIds = [OPEN_INCIDENT_ID.toString()];

    jest.spyOn(IncidentEpisodeService, "findOneById").mockResolvedValue({
      id: RECORD_ID,
      title: "Checkout outage",
      projectId: PROJECT_ID,
      postUpdatesToWorkspaceChannels: [
        { id: "C2", name: "ep-1", workspaceType: WorkspaceType.Slack },
      ],
    } as never);
    jest
      .spyOn(IncidentEpisodeStateTimelineService, "findBy")
      .mockResolvedValue([]);
    jest.spyOn(IncidentEpisodeInternalNoteService, "findBy").mockImplementation(
      readAs(IncidentEpisodeInternalNote, () => {
        return [note(IncidentEpisodeInternalNote, INTERNAL_NOTE)];
      }) as never,
    );
    jest.spyOn(IncidentEpisodeMemberService, "findBy").mockResolvedValue([
      {
        createdAt: new Date("2026-10-27T09:00:00.000Z"),
        incident: {
          id: PRIVATE_INCIDENT_ID,
          title: PRIVATE_INCIDENT_TITLE,
        },
      },
      {
        createdAt: new Date("2026-10-27T09:05:00.000Z"),
        incident: { id: OPEN_INCIDENT_ID, title: OPEN_INCIDENT_TITLE },
      },
    ] as never);
    jest.spyOn(IncidentService, "findBy").mockImplementation((async (args: {
      props: DatabaseCommonInteractionProps;
    }) => {
      const ids: Array<string> = args.props.isRoot
        ? [PRIVATE_INCIDENT_ID.toString(), OPEN_INCIDENT_ID.toString()]
        : readableIncidentIds;

      return ids.map((id: string): Incident => {
        return new Incident(new ObjectID(id));
      });
    }) as never);
  });

  async function draftFor(
    readerProps: DatabaseCommonInteractionProps | undefined,
  ): Promise<string> {
    const context: IncidentEpisodeContextData =
      await IncidentEpisodeAIContextBuilder.buildEpisodeContext({
        episodeId: RECORD_ID,
        includeWorkspaceMessages: true,
        readerProps,
      });

    return promptOf(
      IncidentEpisodeAIContextBuilder.formatEpisodeContextForPostmortem(
        context,
      ),
    );
  }

  test("a private incident in the episode that the reader may not read is left out", async () => {
    const prompt: string = await draftFor(
      reader([{ permission: Permission.ProjectMember }]),
    );

    expect(prompt).not.toContain(PRIVATE_INCIDENT_TITLE);
    expect(prompt).toContain(OPEN_INCIDENT_TITLE);
  });

  test("an editor of episodes who may not read their internal notes gets neither the notes nor the channel's discussion", async () => {
    const prompt: string = await draftFor(
      reader([
        { permission: Permission.ReadIncidentEpisode },
        { permission: Permission.EditIncidentEpisode },
        { permission: Permission.ReadProjectIncident },
      ]),
    );

    expect(prompt).not.toContain(INTERNAL_NOTE);
    expect(prompt).not.toContain(CHANNEL_MESSAGE);
    expect(channelRead).not.toHaveBeenCalled();
  });

  test("OneUptime's own draft - no reader - reads every incident and note", async () => {
    const prompt: string = await draftFor(undefined);

    expect(prompt).toContain(PRIVATE_INCIDENT_TITLE);
    expect(prompt).toContain(OPEN_INCIDENT_TITLE);
    expect(prompt).toContain(INTERNAL_NOTE);
  });
});
