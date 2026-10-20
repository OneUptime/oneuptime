import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";
import AlertEpisodeInternalNote from "../../../../Models/DatabaseModels/AlertEpisodeInternalNote";
import AlertInternalNote from "../../../../Models/DatabaseModels/AlertInternalNote";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisodeInternalNote from "../../../../Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import ScheduledMaintenanceInternalNote from "../../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenancePublicNote from "../../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import WorkspaceLiveMessage from "../../../../Models/DatabaseModels/WorkspaceLiveMessage";
import WorkspaceNotificationLog from "../../../../Models/DatabaseModels/WorkspaceNotificationLog";
import AlertEpisodeInternalNoteService from "../../../../Server/Services/AlertEpisodeInternalNoteService";
import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import AlertInternalNoteService from "../../../../Server/Services/AlertInternalNoteService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentEpisodeInternalNoteService from "../../../../Server/Services/IncidentEpisodeInternalNoteService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import IncidentInternalNoteService from "../../../../Server/Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "../../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../../Server/Services/IncidentService";
import ScheduledMaintenanceInternalNoteService from "../../../../Server/Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenancePublicNoteService from "../../../../Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import WorkspaceLiveMessageService from "../../../../Server/Services/WorkspaceLiveMessageService";
import WorkspaceNotificationLogService from "../../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceReactionNote, {
  WorkspaceNoteResource,
  WorkspaceNoteResourceType,
  WorkspaceNoteSaveResult,
} from "../../../../Server/Utils/Workspace/WorkspaceReactionNote";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import { WorkspaceEventType } from "../../../../Server/Utils/Workspace/WorkspaceMemberActions";
import SavedChatMessage from "../../../../Types/Workspace/SavedChatMessage";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../Types/ObjectID";
import { WorkspaceNoteType } from "../../../../Types/Workspace/WorkspaceNoteReaction";
import WorkspaceLiveMessageKey from "../../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { PrivateRecordKind } from "../../../../Types/StatusPage/PrivateRecordPublicNotes";
import {
  PrivateRecordLookup,
  stubPrivateRecords,
} from "../../TestingUtils/PrivateRecords";

const projectId: ObjectID = ObjectID.generate();
const otherProjectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const CHANNEL_ID: string = "C0INCIDENT";

// The member's own props, as the chat's authorization builds them.
const memberProps: DatabaseCommonInteractionProps = {
  userId: userId,
  tenantId: projectId,
};

type AnySpy = SpyInstance<(...args: Array<any>) => any>;

const RESOURCE_SERVICES: Record<WorkspaceNoteResourceType, any> = {
  [WorkspaceNoteResourceType.Incident]: IncidentService,
  [WorkspaceNoteResourceType.Alert]: AlertService,
  [WorkspaceNoteResourceType.ScheduledMaintenance]: ScheduledMaintenanceService,
  [WorkspaceNoteResourceType.IncidentEpisode]: IncidentEpisodeService,
  [WorkspaceNoteResourceType.AlertEpisode]: AlertEpisodeService,
};

// A row the jsonb lookup found.
function row(data: {
  createdAt: Date;
  projectId?: ObjectID | undefined;
}): Incident {
  const incident: Incident = new Incident();
  incident.id = ObjectID.generate();
  incident.projectId = data.projectId || projectId;
  incident.createdAt = data.createdAt;
  return incident;
}

function mockOwners(
  owners: Partial<Record<WorkspaceNoteResourceType, Incident | null>>,
): Record<WorkspaceNoteResourceType, AnySpy> {
  const spies: Partial<Record<WorkspaceNoteResourceType, AnySpy>> = {};

  for (const resourceType of Object.values(WorkspaceNoteResourceType)) {
    spies[resourceType] = jest
      .spyOn(RESOURCE_SERVICES[resourceType], "findOneBy")
      .mockResolvedValue(owners[resourceType] || null) as AnySpy;
  }

  return spies as Record<WorkspaceNoteResourceType, AnySpy>;
}

let logFindSpy: SpyInstance<typeof WorkspaceNotificationLogService.findOneBy>;

beforeEach((): void => {
  logFindSpy = jest
    .spyOn(WorkspaceNotificationLogService, "findOneBy")
    .mockResolvedValue(null);
});

afterEach((): void => {
  jest.restoreAllMocks();
});

describe("WorkspaceReactionNote capabilities", () => {
  test.each([
    [WorkspaceNoteResourceType.Incident, true],
    [WorkspaceNoteResourceType.ScheduledMaintenance, true],
    [WorkspaceNoteResourceType.Alert, false],
    [WorkspaceNoteResourceType.IncidentEpisode, false],
    [WorkspaceNoteResourceType.AlertEpisode, false],
  ])(
    "%s: private notes always, public notes only where there is a status page (%s)",
    (resourceType: WorkspaceNoteResourceType, supportsPublic: boolean) => {
      expect(
        WorkspaceReactionNote.supportsNoteType(
          resourceType,
          WorkspaceNoteType.Private,
        ),
      ).toBe(true);
      expect(
        WorkspaceReactionNote.supportsNoteType(
          resourceType,
          WorkspaceNoteType.Public,
        ),
      ).toBe(supportsPublic);
    },
  );

  test.each([
    [
      WorkspaceNoteResourceType.Incident,
      WorkspaceNoteType.Private,
      IncidentInternalNote,
    ],
    [
      WorkspaceNoteResourceType.Incident,
      WorkspaceNoteType.Public,
      IncidentPublicNote,
    ],
    [
      WorkspaceNoteResourceType.ScheduledMaintenance,
      WorkspaceNoteType.Private,
      ScheduledMaintenanceInternalNote,
    ],
    [
      WorkspaceNoteResourceType.ScheduledMaintenance,
      WorkspaceNoteType.Public,
      ScheduledMaintenancePublicNote,
    ],
    [
      WorkspaceNoteResourceType.Alert,
      WorkspaceNoteType.Private,
      AlertInternalNote,
    ],
    [
      WorkspaceNoteResourceType.IncidentEpisode,
      WorkspaceNoteType.Private,
      IncidentEpisodeInternalNote,
    ],
    [
      WorkspaceNoteResourceType.AlertEpisode,
      WorkspaceNoteType.Private,
      AlertEpisodeInternalNote,
    ],
  ])(
    "authorization checks the row the note writes: %s %s",
    (
      resourceType: WorkspaceNoteResourceType,
      noteType: WorkspaceNoteType,
      modelType: unknown,
    ) => {
      expect(
        WorkspaceReactionNote.getNoteModelType(resourceType, noteType),
      ).toBe(modelType);
    },
  );

  test.each([
    [
      WorkspaceNoteResourceType.Incident,
      WorkspaceNoteType.Public,
      "add a public note to this incident",
    ],
    [
      WorkspaceNoteResourceType.Alert,
      WorkspaceNoteType.Private,
      "add a private note to this alert",
    ],
    [
      WorkspaceNoteResourceType.ScheduledMaintenance,
      WorkspaceNoteType.Public,
      "add a public note to this scheduled maintenance",
    ],
    [
      WorkspaceNoteResourceType.IncidentEpisode,
      WorkspaceNoteType.Private,
      "add a private note to this incident episode",
    ],
    [
      WorkspaceNoteResourceType.AlertEpisode,
      WorkspaceNoteType.Private,
      "add a private note to this alert episode",
    ],
  ])(
    "refusals name the action: %s %s",
    (
      resourceType: WorkspaceNoteResourceType,
      noteType: WorkspaceNoteType,
      action: string,
    ) => {
      expect(
        WorkspaceReactionNote.getAuthorizationAction(resourceType, noteType),
      ).toBe(action);
    },
  );

  test("the authorization resource is the resource's own service", () => {
    for (const resourceType of Object.values(WorkspaceNoteResourceType)) {
      expect(WorkspaceReactionNote.getResourceService(resourceType)).toBe(
        RESOURCE_SERVICES[resourceType],
      );
    }
  });

  test("the source key is channel and message, as Slack notes always used", () => {
    expect(
      WorkspaceReactionNote.getSourceMessageKey({
        channelId: "C123",
        messageId: "1700000000.000100",
      }),
    ).toBe("C123:1700000000.000100");
  });

  test("every resource type is handled", () => {
    expect(WorkspaceReactionNote.getAllResourceTypes()).toEqual([
      WorkspaceNoteResourceType.Incident,
      WorkspaceNoteResourceType.Alert,
      WorkspaceNoteResourceType.ScheduledMaintenance,
      WorkspaceNoteResourceType.IncidentEpisode,
      WorkspaceNoteResourceType.AlertEpisode,
    ]);
  });
});

describe("WorkspaceReactionNote.resolveResourceForChannel", () => {
  test("REGRESSION: the channel OneUptime created for the resource is found without any notification log", async () => {
    // Logs are hard-deleted after a few days on OneUptime Cloud.
    const incident: Incident = row({ createdAt: new Date("2026-09-01") });
    const spies: Record<WorkspaceNoteResourceType, AnySpy> = mockOwners({
      [WorkspaceNoteResourceType.Incident]: incident,
    });

    const resource: WorkspaceNoteResource | null =
      await WorkspaceReactionNote.resolveResourceForChannel({
        projectIds: [projectId],
        workspaceType: WorkspaceType.Slack,
        channelId: CHANNEL_ID,
        messageId: "1.2",
      });

    expect(resource).toEqual({
      resourceType: WorkspaceNoteResourceType.Incident,
      resourceId: incident.id,
      projectId: projectId,
    });
    expect(logFindSpy).not.toHaveBeenCalled();

    // The lookup is a jsonb containment on the channel id, newest first.
    const findArgs: any =
      spies[WorkspaceNoteResourceType.Incident].mock.calls[0]![0];
    expect(findArgs.query.projectId).toBe(projectId);
    const channelsFilter: any = findArgs.query.postUpdatesToWorkspaceChannels;
    expect(channelsFilter.type).toBe("raw");
    expect(channelsFilter.getSql("i.channels")).toMatch(
      /^\(i\.channels @> CAST\(:\w+ AS JSONB\)\)$/,
    );
    expect(Object.values(channelsFilter.objectLiteralParameters)).toEqual([
      JSON.stringify([{ id: CHANNEL_ID }]),
    ]);
    expect(findArgs.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(findArgs.props).toEqual({ isRoot: true });
  });

  test("REGRESSION: an episode channel resolves to its episode", async () => {
    const episode: Incident = row({ createdAt: new Date("2026-09-01") });
    mockOwners({ [WorkspaceNoteResourceType.IncidentEpisode]: episode });

    const resource: WorkspaceNoteResource | null =
      await WorkspaceReactionNote.resolveResourceForChannel({
        projectIds: [projectId],
        workspaceType: WorkspaceType.Slack,
        channelId: CHANNEL_ID,
      });

    expect(resource?.resourceType).toBe(
      WorkspaceNoteResourceType.IncidentEpisode,
    );
    expect(resource?.resourceId.toString()).toBe(episode.id!.toString());
  });

  test("when two resources list the channel the newest one owns it", async () => {
    const olderIncident: Incident = row({ createdAt: new Date("2026-01-01") });
    const newerAlert: Incident = row({ createdAt: new Date("2026-06-01") });
    mockOwners({
      [WorkspaceNoteResourceType.Incident]: olderIncident,
      [WorkspaceNoteResourceType.Alert]: newerAlert,
    });

    const resource: WorkspaceNoteResource | null =
      await WorkspaceReactionNote.resolveResourceForChannel({
        projectIds: [projectId],
        workspaceType: WorkspaceType.Slack,
        channelId: CHANNEL_ID,
      });

    expect(resource?.resourceType).toBe(WorkspaceNoteResourceType.Alert);
    expect(resource?.resourceId.toString()).toBe(newerAlert.id!.toString());
  });

  test("looks in every connected project and reports the one that owns the channel", async () => {
    const incident: Incident = row({
      createdAt: new Date("2026-09-01"),
      projectId: otherProjectId,
    });
    const spies: Record<WorkspaceNoteResourceType, AnySpy> = mockOwners({
      [WorkspaceNoteResourceType.Incident]: incident,
    });

    const resource: WorkspaceNoteResource | null =
      await WorkspaceReactionNote.resolveResourceForChannel({
        projectIds: [projectId, otherProjectId],
        workspaceType: WorkspaceType.Slack,
        channelId: CHANNEL_ID,
      });

    expect(resource?.projectId).toBe(otherProjectId);

    // Several projects are an IN (...) filter, not the first project alone.
    const projectFilter: any =
      spies[WorkspaceNoteResourceType.Incident].mock.calls[0]![0].query
        .projectId;
    expect(projectFilter.type).toBe("raw");
    expect(Object.values(projectFilter.objectLiteralParameters)).toEqual([
      [projectId.toString(), otherProjectId.toString()],
    ]);
  });

  test("only the requested resource types are searched", async () => {
    const spies: Record<WorkspaceNoteResourceType, AnySpy> = mockOwners({
      [WorkspaceNoteResourceType.Incident]: row({ createdAt: new Date() }),
    });

    const resource: WorkspaceNoteResource | null =
      await WorkspaceReactionNote.resolveResourceForChannel({
        projectIds: [projectId],
        workspaceType: WorkspaceType.Slack,
        channelId: CHANNEL_ID,
        resourceTypes: [WorkspaceNoteResourceType.Alert],
      });

    expect(resource).toBeNull();
    expect(spies[WorkspaceNoteResourceType.Incident]).not.toHaveBeenCalled();
    expect(spies[WorkspaceNoteResourceType.Alert]).toHaveBeenCalledTimes(1);
  });

  test("a shared channel falls back to the notification the reacted-to message is", async () => {
    mockOwners({});
    const alertId: ObjectID = ObjectID.generate();

    logFindSpy.mockImplementation(async (args: any) => {
      // Only the alert log for this exact message matches.
      if (args.query.threadId === "1.2" && args.select.alertId) {
        const log: WorkspaceNotificationLog = new WorkspaceNotificationLog();
        log.alertId = alertId;
        log.projectId = projectId;
        log.createdAt = new Date("2026-01-01");
        return log;
      }
      return null;
    });

    const resource: WorkspaceNoteResource | null =
      await WorkspaceReactionNote.resolveResourceForChannel({
        projectIds: [projectId],
        workspaceType: WorkspaceType.Slack,
        channelId: CHANNEL_ID,
        messageId: "1.2",
      });

    expect(resource).toEqual({
      resourceType: WorkspaceNoteResourceType.Alert,
      resourceId: alertId,
      projectId: projectId,
    });

    const alertLogQuery: any = logFindSpy.mock.calls.find((call: any) => {
      return call[0].select.alertId;
    })![0];
    expect(alertLogQuery.query.channelId).toBe(CHANNEL_ID);
    expect(alertLogQuery.query.workspaceType).toBe(WorkspaceType.Slack);
    expect(alertLogQuery.sort).toEqual({ createdAt: SortOrder.Descending });
  });

  test("otherwise the resource OneUptime most recently posted about in the channel", async () => {
    mockOwners({});
    const olderIncidentId: ObjectID = ObjectID.generate();
    const newerScheduledMaintenanceId: ObjectID = ObjectID.generate();

    logFindSpy.mockImplementation(async (args: any) => {
      if (args.query.threadId) {
        return null;
      }

      const log: WorkspaceNotificationLog = new WorkspaceNotificationLog();
      log.projectId = projectId;

      if (args.select.incidentId) {
        log.incidentId = olderIncidentId;
        log.createdAt = new Date("2026-01-01");
        return log;
      }

      if (args.select.scheduledMaintenanceId) {
        log.scheduledMaintenanceId = newerScheduledMaintenanceId;
        log.createdAt = new Date("2026-02-01");
        return log;
      }

      return null;
    });

    const resource: WorkspaceNoteResource | null =
      await WorkspaceReactionNote.resolveResourceForChannel({
        projectIds: [projectId],
        workspaceType: WorkspaceType.Slack,
        channelId: CHANNEL_ID,
        messageId: "1.2",
      });

    expect(resource?.resourceType).toBe(
      WorkspaceNoteResourceType.ScheduledMaintenance,
    );
    expect(resource?.resourceId.toString()).toBe(
      newerScheduledMaintenanceId.toString(),
    );
  });

  test("the fallback only uses logs that name a resource of that type", async () => {
    mockOwners({});

    await WorkspaceReactionNote.resolveResourceForChannel({
      projectIds: [projectId],
      workspaceType: WorkspaceType.Slack,
      channelId: CHANNEL_ID,
      resourceTypes: [WorkspaceNoteResourceType.Incident],
    });

    const query: any = logFindSpy.mock.calls[0]![0].query;
    // A not-null filter on incidentId, so an alert log in the channel is not "the incident".
    expect(query.incidentId.getSql("log.incidentId")).toBe(
      "(log.incidentId IS NOT NULL)",
    );
  });

  /*
   * A shared channel where a rule keeps each incident's messages in one
   * thread (WorkspaceRecordThreads): somebody replies under incident A's
   * message and pins the reply. The reply is no notification of OneUptime's,
   * and incident B was posted about in the channel since. The reply belongs
   * to the incident whose thread it is in.
   */
  const REPLY_TS: string = "1.5";
  const ROOT_TS: string = "1.1";

  // B is the newest record posted about in the channel; the reply is not logged.
  function newestLogIs(incident: ObjectID): void {
    logFindSpy.mockImplementation(async (args: any) => {
      if (!args.select.incidentId || args.query.threadId) {
        return null;
      }

      const log: WorkspaceNotificationLog = new WorkspaceNotificationLog();
      log.projectId = projectId;
      log.incidentId = incident;
      log.createdAt = new Date("2026-10-01T11:00:00Z");
      return log;
    });
  }

  // The threads kept in the channel: incident A's, started by ROOT_TS - or none.
  function threadsInChannel(incidentA: ObjectID | null): SpyInstance {
    return jest
      .spyOn(WorkspaceLiveMessageService, "findOneBy")
      .mockImplementation(async (args: any) => {
        if (
          !incidentA ||
          (args.query.messageId && args.query.messageId !== ROOT_TS)
        ) {
          return null;
        }

        const thread: WorkspaceLiveMessage = new WorkspaceLiveMessage();
        thread.projectId = projectId;
        thread.messageKey = WorkspaceLiveMessageKey.forRecordThread(
          "Incident",
          incidentA,
        );
        return thread;
      }) as SpyInstance;
  }

  test("REGRESSION: a reaction on a reply in a thread is the incident whose thread it is, not the newest in the channel", async () => {
    mockOwners({});
    const incidentA: ObjectID = ObjectID.generate();
    const incidentB: ObjectID = ObjectID.generate();
    newestLogIs(incidentB);
    const threadFindSpy: SpyInstance = threadsInChannel(incidentA);

    const getThreadId: Mock<() => Promise<string | null>> = jest.fn(
      async (): Promise<string | null> => {
        return ROOT_TS;
      },
    );

    const resource: WorkspaceNoteResource | null =
      await WorkspaceReactionNote.resolveResourceForChannel({
        projectIds: [projectId],
        workspaceType: WorkspaceType.Slack,
        channelId: CHANNEL_ID,
        messageId: REPLY_TS,
        getThreadId: getThreadId,
      });

    expect(resource?.resourceType).toBe(WorkspaceNoteResourceType.Incident);
    expect(resource?.resourceId.toString()).toBe(incidentA.toString());
    expect(getThreadId).toHaveBeenCalledTimes(1);

    // Looked up in this channel's Slack threads, by the thread's first message.
    const threadQuery: any = threadFindSpy.mock.calls.find((call: any) => {
      return call[0].query.messageId === ROOT_TS;
    })![0];
    expect(threadQuery.query.channelId).toBe(CHANNEL_ID);
    expect(threadQuery.query.workspaceType).toBe(WorkspaceType.Slack);
  });

  test("a channel no rule keeps threads in: Slack is not read, and it is the newest record, as before", async () => {
    mockOwners({});
    const incidentB: ObjectID = ObjectID.generate();
    newestLogIs(incidentB);
    threadsInChannel(null);

    const getThreadId: Mock<() => Promise<string | null>> = jest.fn(
      async (): Promise<string | null> => {
        return ROOT_TS;
      },
    );

    const resource: WorkspaceNoteResource | null =
      await WorkspaceReactionNote.resolveResourceForChannel({
        projectIds: [projectId],
        workspaceType: WorkspaceType.Slack,
        channelId: CHANNEL_ID,
        messageId: REPLY_TS,
        getThreadId: getThreadId,
      });

    expect(getThreadId).not.toHaveBeenCalled();
    expect(resource?.resourceId.toString()).toBe(incidentB.toString());
  });

  test("a message in no thread, or in a thread OneUptime did not start, is the newest record, as before", async () => {
    mockOwners({});
    const incidentA: ObjectID = ObjectID.generate();
    const incidentB: ObjectID = ObjectID.generate();
    newestLogIs(incidentB);
    threadsInChannel(incidentA);

    // In no thread; and somebody's own thread, under a message OneUptime never posted.
    for (const threadId of [null, "1.0"]) {
      const resource: WorkspaceNoteResource | null =
        await WorkspaceReactionNote.resolveResourceForChannel({
          projectIds: [projectId],
          workspaceType: WorkspaceType.Slack,
          channelId: CHANNEL_ID,
          messageId: REPLY_TS,
          getThreadId: async (): Promise<string | null> => {
            return threadId;
          },
        });

      expect(resource?.resourceId.toString()).toBe(incidentB.toString());
    }
  });

  test("the thread is not read when the channel or the message itself already names the record", async () => {
    const getThreadId: Mock<() => Promise<string | null>> = jest.fn(
      async (): Promise<string | null> => {
        return ROOT_TS;
      },
    );

    // 1. The channel OneUptime created for the incident.
    const owner: Incident = row({ createdAt: new Date("2026-09-01") });
    mockOwners({ [WorkspaceNoteResourceType.Incident]: owner });

    expect(
      (
        await WorkspaceReactionNote.resolveResourceForChannel({
          projectIds: [projectId],
          workspaceType: WorkspaceType.Slack,
          channelId: CHANNEL_ID,
          messageId: REPLY_TS,
          getThreadId: getThreadId,
        })
      )?.resourceId.toString(),
    ).toBe(owner.id!.toString());

    // 2. OneUptime's own reply in the thread, logged with its incident.
    jest.restoreAllMocks();
    mockOwners({});
    const incidentA: ObjectID = ObjectID.generate();
    logFindSpy = jest
      .spyOn(WorkspaceNotificationLogService, "findOneBy")
      .mockImplementation(async (args: any) => {
        if (args.query.threadId === REPLY_TS && args.select.incidentId) {
          const log: WorkspaceNotificationLog = new WorkspaceNotificationLog();
          log.projectId = projectId;
          log.incidentId = incidentA;
          log.createdAt = new Date("2026-10-01T10:00:00Z");
          return log;
        }
        return null;
      });

    expect(
      (
        await WorkspaceReactionNote.resolveResourceForChannel({
          projectIds: [projectId],
          workspaceType: WorkspaceType.Slack,
          channelId: CHANNEL_ID,
          messageId: REPLY_TS,
          getThreadId: getThreadId,
        })
      )?.resourceId.toString(),
    ).toBe(incidentA.toString());

    expect(getThreadId).not.toHaveBeenCalled();
  });

  test("nothing linked returns null", async () => {
    mockOwners({});

    await expect(
      WorkspaceReactionNote.resolveResourceForChannel({
        projectIds: [projectId],
        workspaceType: WorkspaceType.Slack,
        channelId: CHANNEL_ID,
        messageId: "1.2",
      }),
    ).resolves.toBeNull();
  });

  test("no project or no channel returns null without querying", async () => {
    const spies: Record<WorkspaceNoteResourceType, AnySpy> = mockOwners({});

    await expect(
      WorkspaceReactionNote.resolveResourceForChannel({
        projectIds: [],
        workspaceType: WorkspaceType.Slack,
        channelId: CHANNEL_ID,
      }),
    ).resolves.toBeNull();

    await expect(
      WorkspaceReactionNote.resolveResourceForChannel({
        projectIds: [projectId],
        workspaceType: WorkspaceType.Slack,
        channelId: "",
      }),
    ).resolves.toBeNull();

    expect(spies[WorkspaceNoteResourceType.Incident]).not.toHaveBeenCalled();
    expect(logFindSpy).not.toHaveBeenCalled();
  });
});

type NoteServiceCase = {
  resourceType: WorkspaceNoteResourceType;
  noteType: WorkspaceNoteType;
  service: any;
  idKey: string;
};

const noteServiceCases: Array<NoteServiceCase> = [
  {
    resourceType: WorkspaceNoteResourceType.Incident,
    noteType: WorkspaceNoteType.Private,
    service: IncidentInternalNoteService,
    idKey: "incidentId",
  },
  {
    resourceType: WorkspaceNoteResourceType.Incident,
    noteType: WorkspaceNoteType.Public,
    service: IncidentPublicNoteService,
    idKey: "incidentId",
  },
  {
    resourceType: WorkspaceNoteResourceType.ScheduledMaintenance,
    noteType: WorkspaceNoteType.Private,
    service: ScheduledMaintenanceInternalNoteService,
    idKey: "scheduledMaintenanceId",
  },
  {
    resourceType: WorkspaceNoteResourceType.ScheduledMaintenance,
    noteType: WorkspaceNoteType.Public,
    service: ScheduledMaintenancePublicNoteService,
    idKey: "scheduledMaintenanceId",
  },
  {
    resourceType: WorkspaceNoteResourceType.Alert,
    noteType: WorkspaceNoteType.Private,
    service: AlertInternalNoteService,
    idKey: "alertId",
  },
  {
    resourceType: WorkspaceNoteResourceType.IncidentEpisode,
    noteType: WorkspaceNoteType.Private,
    service: IncidentEpisodeInternalNoteService,
    idKey: "incidentEpisodeId",
  },
  {
    resourceType: WorkspaceNoteResourceType.AlertEpisode,
    noteType: WorkspaceNoteType.Private,
    service: AlertEpisodeInternalNoteService,
    idKey: "alertEpisodeId",
  },
];

describe("WorkspaceReactionNote.saveNote", () => {
  test.each(noteServiceCases)(
    "$resourceType $noteType note is written by the right service",
    async ({ resourceType, noteType, service, idKey }: NoteServiceCase) => {
      const resource: WorkspaceNoteResource = {
        resourceType: resourceType,
        resourceId: ObjectID.generate(),
        projectId: projectId,
      };

      const hasSpy: AnySpy = jest
        .spyOn(service, "hasNoteFromSlackMessage")
        .mockResolvedValue(false) as AnySpy;
      const addSpy: AnySpy = jest
        .spyOn(service, "addNote")
        .mockResolvedValue(undefined) as AnySpy;

      const result: WorkspaceNoteSaveResult =
        await WorkspaceReactionNote.saveNote({
          resource: resource,
          noteType: noteType,
          props: memberProps,
          note: "Restarted the database",
          sourceMessageKey: "C1:1.2",
        });

      expect(result).toBe(WorkspaceNoteSaveResult.Saved);
      expect(hasSpy).toHaveBeenCalledWith({
        [idKey]: resource.resourceId,
        postedFromSlackMessageId: "C1:1.2",
      });
      // Saved with the member's own props: the note is theirs.
      expect(addSpy).toHaveBeenCalledWith({
        [idKey]: resource.resourceId,
        projectId: projectId,
        props: memberProps,
        note: "Restarted the database",
        postedFromSlackMessageId: "C1:1.2",
      });
    },
  );

  test.each(noteServiceCases)(
    "$resourceType $noteType note already saved from the message is not saved again",
    async ({ resourceType, noteType, service }: NoteServiceCase) => {
      jest.spyOn(service, "hasNoteFromSlackMessage").mockResolvedValue(true);
      const addSpy: AnySpy = jest.spyOn(service, "addNote") as AnySpy;

      const result: WorkspaceNoteSaveResult =
        await WorkspaceReactionNote.saveNote({
          resource: {
            resourceType: resourceType,
            resourceId: ObjectID.generate(),
            projectId: projectId,
          },
          noteType: noteType,
          props: memberProps,
          note: "Restarted the database",
          sourceMessageKey: "C1:1.2",
        });

      expect(result).toBe(WorkspaceNoteSaveResult.Duplicate);
      expect(addSpy).not.toHaveBeenCalled();
    },
  );

  test("a public note on an alert is refused rather than silently made private", async () => {
    const addSpy: AnySpy = jest.spyOn(
      AlertInternalNoteService,
      "addNote",
    ) as AnySpy;

    await expect(
      WorkspaceReactionNote.saveNote({
        resource: {
          resourceType: WorkspaceNoteResourceType.Alert,
          resourceId: ObjectID.generate(),
          projectId: projectId,
        },
        noteType: WorkspaceNoteType.Public,
        props: memberProps,
        note: "x",
        sourceMessageKey: "C1:1.2",
      }),
    ).rejects.toThrow("Alert does not support public notes.");

    expect(addSpy).not.toHaveBeenCalled();
  });

  test("hasNote asks the note service matching the note type", async () => {
    const publicSpy: AnySpy = jest
      .spyOn(IncidentPublicNoteService, "hasNoteFromSlackMessage")
      .mockResolvedValue(true) as AnySpy;
    const privateSpy: AnySpy = jest
      .spyOn(IncidentInternalNoteService, "hasNoteFromSlackMessage")
      .mockResolvedValue(false) as AnySpy;

    const resource: WorkspaceNoteResource = {
      resourceType: WorkspaceNoteResourceType.Incident,
      resourceId: ObjectID.generate(),
      projectId: projectId,
    };

    await expect(
      WorkspaceReactionNote.hasNote({
        resource: resource,
        noteType: WorkspaceNoteType.Public,
        sourceMessageKey: "C1:1.2",
      }),
    ).resolves.toBe(true);

    await expect(
      WorkspaceReactionNote.hasNote({
        resource: resource,
        noteType: WorkspaceNoteType.Private,
        sourceMessageKey: "C1:1.2",
      }),
    ).resolves.toBe(false);

    expect(publicSpy).toHaveBeenCalledTimes(1);
    expect(privateSpy).toHaveBeenCalledTimes(1);
  });
});

describe("WorkspaceReactionNote.getResourceDisplay", () => {
  const link: URL = URL.fromString("https://oneuptime.test/dashboard/x");

  type DisplayCase = {
    resourceType: WorkspaceNoteResourceType;
    service: any;
    numberMethod: string;
    linkMethod: string;
    label: string;
  };

  const cases: Array<DisplayCase> = [
    {
      resourceType: WorkspaceNoteResourceType.Incident,
      service: IncidentService,
      numberMethod: "getIncidentNumber",
      linkMethod: "getIncidentLinkInDashboard",
      label: "Incident",
    },
    {
      resourceType: WorkspaceNoteResourceType.Alert,
      service: AlertService,
      numberMethod: "getAlertNumber",
      linkMethod: "getAlertLinkInDashboard",
      label: "Alert",
    },
    {
      resourceType: WorkspaceNoteResourceType.ScheduledMaintenance,
      service: ScheduledMaintenanceService,
      numberMethod: "getScheduledMaintenanceNumber",
      linkMethod: "getScheduledMaintenanceLinkInDashboard",
      label: "Scheduled Maintenance",
    },
    {
      resourceType: WorkspaceNoteResourceType.IncidentEpisode,
      service: IncidentEpisodeService,
      numberMethod: "getEpisodeNumber",
      linkMethod: "getEpisodeLinkInDashboard",
      label: "Incident Episode",
    },
    {
      resourceType: WorkspaceNoteResourceType.AlertEpisode,
      service: AlertEpisodeService,
      numberMethod: "getEpisodeNumber",
      linkMethod: "getEpisodeLinkInDashboard",
      label: "Alert Episode",
    },
  ];

  test.each(cases)(
    "$resourceType uses the prefixed number when there is one",
    async ({
      resourceType,
      service,
      numberMethod,
      linkMethod,
      label,
    }: DisplayCase) => {
      jest
        .spyOn(service, numberMethod)
        .mockResolvedValue({ number: 7, numberWithPrefix: "INC-7" });
      const linkSpy: AnySpy = jest
        .spyOn(service, linkMethod)
        .mockResolvedValue(link) as AnySpy;

      const resourceId: ObjectID = ObjectID.generate();
      const display: { label: string; link: URL } =
        await WorkspaceReactionNote.getResourceDisplay({
          resourceType: resourceType,
          resourceId: resourceId,
          projectId: projectId,
        });

      expect(display).toEqual({ label: `${label} INC-7`, link: link });
      expect(linkSpy).toHaveBeenCalledWith(projectId, resourceId);
    },
  );

  test.each(cases)(
    "$resourceType falls back to #number, then to the bare label",
    async ({
      resourceType,
      service,
      numberMethod,
      linkMethod,
      label,
    }: DisplayCase) => {
      const numberSpy: AnySpy = jest
        .spyOn(service, numberMethod)
        .mockResolvedValue({ number: 7, numberWithPrefix: null }) as AnySpy;
      jest.spyOn(service, linkMethod).mockResolvedValue(link);

      const resource: WorkspaceNoteResource = {
        resourceType: resourceType,
        resourceId: ObjectID.generate(),
        projectId: projectId,
      };

      await expect(
        WorkspaceReactionNote.getResourceDisplay(resource),
      ).resolves.toEqual({ label: `${label} #7`, link: link });

      numberSpy.mockResolvedValue({ number: null, numberWithPrefix: null });

      await expect(
        WorkspaceReactionNote.getResourceDisplay(resource),
      ).resolves.toEqual({ label: label, link: link });
    },
  );
});

describe("WorkspaceReactionNote.getConfirmationMessage", () => {
  test("a private note's confirmation links the record by its label", () => {
    expect(
      WorkspaceReactionNote.getConfirmationMessage({
        noteType: WorkspaceNoteType.Private,
        resourceLabel: "Alert #3",
        resourceLink: "https://x/3",
      }).toString(),
    ).toBe("✅ Saved as a **private note** on [Alert #3](https://x/3).");
  });

  test("a public note's confirmation mentions the status page", () => {
    expect(
      WorkspaceReactionNote.getConfirmationMessage({
        noteType: WorkspaceNoteType.Public,
        resourceLabel: "Incident #7",
        resourceLink: "https://x/7",
      }).toString(),
    ).toBe(
      "✅ Saved as a **public note** on [Incident #7](https://x/7). It is shown on the status page.",
    );
  });

  test("Slack posts the same confirmation as mrkdwn: bold, and the label in the link", () => {
    const text: string = SlackUtil.slackify(
      WorkspaceReactionNote.getConfirmationMessage({
        noteType: WorkspaceNoteType.Private,
        resourceLabel: "Incident #7",
        resourceLink: "https://x/7",
      }).toString(),
    ).trim();

    expect(text).toContain("*private note*");
    expect(text).toContain("<https://x/7|Incident #7>");
  });

  test("a label with Markdown in it is the link's text, never a link or styling of its own", () => {
    const markdown: string = WorkspaceReactionNote.getConfirmationMessage({
      noteType: WorkspaceNoteType.Private,
      resourceLabel: "Incident **x** [docs](https://example.com) <!channel>",
      resourceLink: "https://x/7",
    }).toString();

    expect(markdown).toContain("\\*\\*x\\*\\*");
    expect(markdown).toContain("\\[docs\\]\\(https://example.com\\)");
    expect(markdown).not.toContain("<!channel>");
    expect(markdown.endsWith("](https://x/7).")).toBe(true);
  });
});

describe("WorkspaceReactionNote.saveNote: whose message, posted when", () => {
  const SAVED: SavedChatMessage = {
    workspaceType: WorkspaceType.Slack,
    authorName: "Aidil Rahman",
    postedAt: "2026-10-08T10:17:00.000Z",
  };

  test.each(noteServiceCases)(
    "$resourceType $noteType note keeps where it came from; a private one is filed when it was posted",
    async ({ resourceType, noteType, service, idKey }: NoteServiceCase) => {
      jest.spyOn(service, "hasNoteFromSlackMessage").mockResolvedValue(false);
      const addSpy: AnySpy = jest
        .spyOn(service, "addNote")
        .mockResolvedValue(undefined) as AnySpy;
      const resourceId: ObjectID = ObjectID.generate();

      await WorkspaceReactionNote.saveNote({
        resource: {
          resourceType: resourceType,
          resourceId: resourceId,
          projectId: projectId,
        },
        noteType: noteType,
        props: memberProps,
        note: "Restarted the database",
        sourceMessageKey: "C1:1.2",
        savedFromChatMessage: SAVED,
      });

      const expected: Record<string, unknown> = {
        [idKey]: resourceId,
        projectId: projectId,
        props: memberProps,
        note: "Restarted the database",
        postedFromSlackMessageId: "C1:1.2",
        savedFromChatMessage: SAVED,
      };

      // A public note is published now: the status page's readers see it then.
      if (noteType === WorkspaceNoteType.Private) {
        expected["postedAt"] = new Date("2026-10-08T10:17:00.000Z");
      }

      expect(addSpy).toHaveBeenCalledTimes(1);
      expect(addSpy.mock.calls[0]![0]).toEqual(expected);
    },
  );

  test("two saves of one message at once: the second is a duplicate, and nothing is asked twice", async () => {
    const claims: Set<string> = new Set<string>();
    const claimSpy: AnySpy = jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockImplementation((async (namespace: string, key: string) => {
        if (claims.has(`${namespace}:${key}`)) {
          return false;
        }
        claims.add(`${namespace}:${key}`);
        return true;
      }) as never) as AnySpy;
    const releaseSpy: AnySpy = jest
      .spyOn(GlobalCache, "deleteKey")
      .mockResolvedValue(undefined as never) as AnySpy;

    let finishFirst: () => void = (): void => {};
    const hasSpy: AnySpy = jest
      .spyOn(IncidentInternalNoteService, "hasNoteFromSlackMessage")
      .mockResolvedValue(false) as AnySpy;
    const addSpy: AnySpy = jest
      .spyOn(IncidentInternalNoteService, "addNote")
      .mockImplementation((() => {
        return new Promise<void>((resolve: () => void) => {
          finishFirst = resolve;
        });
      }) as never) as AnySpy;

    const resource: WorkspaceNoteResource = {
      resourceType: WorkspaceNoteResourceType.Incident,
      resourceId: ObjectID.generate(),
      projectId: projectId,
    };
    const save: () => Promise<WorkspaceNoteSaveResult> =
      (): Promise<WorkspaceNoteSaveResult> => {
        return WorkspaceReactionNote.saveNote({
          resource: resource,
          noteType: WorkspaceNoteType.Private,
          props: memberProps,
          note: "Restarted the database",
          sourceMessageKey: "C1:1.2",
        });
      };

    // A pin and a 📌 on the same message, handled at the same moment.
    const first: Promise<WorkspaceNoteSaveResult> = save();
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
    const second: WorkspaceNoteSaveResult = await save();

    expect(second).toBe(WorkspaceNoteSaveResult.Duplicate);
    expect(hasSpy).toHaveBeenCalledTimes(1);

    finishFirst();
    await expect(first).resolves.toBe(WorkspaceNoteSaveResult.Saved);

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(claimSpy.mock.calls[0]![0]).toBe("workspace-reaction-note-save");
    expect(claimSpy.mock.calls[0]![1]).toBe(
      `${resource.resourceId.toString()}:private:C1:1.2`,
    );
    // Once saved, the note itself says so: the claim is given back.
    expect(releaseSpy).toHaveBeenCalledWith(
      "workspace-reaction-note-save",
      `${resource.resourceId.toString()}:private:C1:1.2`,
    );
  });

  test("without the cache, the saved notes alone decide", async () => {
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockRejectedValue(new Error("Redis client is not connected"));
    const releaseSpy: AnySpy = jest.spyOn(GlobalCache, "deleteKey") as AnySpy;
    jest
      .spyOn(IncidentInternalNoteService, "hasNoteFromSlackMessage")
      .mockResolvedValue(false);
    const addSpy: AnySpy = jest
      .spyOn(IncidentInternalNoteService, "addNote")
      .mockResolvedValue(undefined as never) as AnySpy;

    await expect(
      WorkspaceReactionNote.saveNote({
        resource: {
          resourceType: WorkspaceNoteResourceType.Incident,
          resourceId: ObjectID.generate(),
          projectId: projectId,
        },
        noteType: WorkspaceNoteType.Private,
        props: memberProps,
        note: "x",
        sourceMessageKey: "C1:1.2",
      }),
    ).resolves.toBe(WorkspaceNoteSaveResult.Saved);

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(releaseSpy).not.toHaveBeenCalled();
  });

  test("a failed save gives the claim back, so the next try can save it", async () => {
    jest.spyOn(GlobalCache, "setStringIfNotExists").mockResolvedValue(true);
    const releaseSpy: AnySpy = jest
      .spyOn(GlobalCache, "deleteKey")
      .mockResolvedValue(undefined as never) as AnySpy;
    jest
      .spyOn(IncidentInternalNoteService, "hasNoteFromSlackMessage")
      .mockResolvedValue(false);
    jest
      .spyOn(IncidentInternalNoteService, "addNote")
      .mockRejectedValue(new Error("database is down"));

    await expect(
      WorkspaceReactionNote.saveNote({
        resource: {
          resourceType: WorkspaceNoteResourceType.Incident,
          resourceId: ObjectID.generate(),
          projectId: projectId,
        },
        noteType: WorkspaceNoteType.Private,
        props: memberProps,
        note: "x",
        sourceMessageKey: "C1:1.2",
      }),
    ).rejects.toThrow("database is down");

    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });
});

describe("WorkspaceReactionNote.getNotePostedAt", () => {
  const NOW: Date = new Date("2026-10-14T12:00:00.000Z");

  test("a private note is filed when its message was posted, however long ago", () => {
    expect(
      WorkspaceReactionNote.getNotePostedAt({
        noteType: WorkspaceNoteType.Private,
        savedFromChatMessage: {
          workspaceType: WorkspaceType.Slack,
          postedAt: "2026-09-01T08:00:00.000Z",
        },
        now: NOW,
      }),
    ).toEqual(new Date("2026-09-01T08:00:00.000Z"));
  });

  test("never later than now, should the chat's clock be ahead", () => {
    expect(
      WorkspaceReactionNote.getNotePostedAt({
        noteType: WorkspaceNoteType.Private,
        savedFromChatMessage: {
          workspaceType: WorkspaceType.MicrosoftTeams,
          postedAt: "2026-10-14T12:05:00.000Z",
        },
        now: NOW,
      }),
    ).toEqual(NOW);
  });

  test("a public note, or a message with no time, is the note service's own time", () => {
    expect(
      WorkspaceReactionNote.getNotePostedAt({
        noteType: WorkspaceNoteType.Public,
        savedFromChatMessage: {
          workspaceType: WorkspaceType.Slack,
          postedAt: "2026-09-01T08:00:00.000Z",
        },
        now: NOW,
      }),
    ).toBeUndefined();

    for (const saved of [
      undefined,
      { workspaceType: WorkspaceType.Slack },
      { workspaceType: WorkspaceType.Slack, postedAt: "not a time" },
    ]) {
      expect(
        WorkspaceReactionNote.getNotePostedAt({
          noteType: WorkspaceNoteType.Private,
          savedFromChatMessage: saved as SavedChatMessage | undefined,
          now: NOW,
        }),
      ).toBeUndefined();
    }
  });
});

describe("WorkspaceReactionNote: what a pin is told", () => {
  /*
   * The answer is not next to the message - Slack shows it at the foot of
   * the channel, Teams at the end of the thread - so it names the message
   * by what the person did, never "This message" (which would read as the
   * answer itself).
   */
  test("nothing to save: no text, or only files for a public note", () => {
    expect(
      WorkspaceReactionNote.getNothingToSaveMessage({
        noteType: WorkspaceNoteType.Private,
        hasAttachments: false,
        workspaceType: WorkspaceType.Slack,
      }),
    ).toBe("The message you pinned has no text to save as a note.");
    expect(
      WorkspaceReactionNote.getNothingToSaveMessage({
        noteType: WorkspaceNoteType.Public,
        hasAttachments: false,
        workspaceType: WorkspaceType.Slack,
      }),
    ).toBe("The message you reacted to has no text to save as a note.");
    expect(
      WorkspaceReactionNote.getNothingToSaveMessage({
        noteType: WorkspaceNoteType.Public,
        hasAttachments: true,
        workspaceType: WorkspaceType.Slack,
      }),
    ).toBe(
      "The message you reacted to has only files or images, which the status page does not show, so it was not saved as a public note.",
    );
  });

  test("in Microsoft Teams, where only a reaction saves a message, it is the message they reacted to", () => {
    expect(
      WorkspaceReactionNote.getNothingToSaveMessage({
        noteType: WorkspaceNoteType.Private,
        hasAttachments: false,
        workspaceType: WorkspaceType.MicrosoftTeams,
      }),
    ).toBe("The message you reacted to has no text to save as a note.");
    expect(
      WorkspaceReactionNote.getNothingToSaveMessage({
        noteType: WorkspaceNoteType.Public,
        hasAttachments: true,
        workspaceType: WorkspaceType.MicrosoftTeams,
      }),
    ).toBe(
      "The message you reacted to has only files or images, which the status page does not show, so it was not saved as a public note.",
    );
  });

  test("only a public note says it leaves files and images out", () => {
    expect(
      WorkspaceReactionNote.getNothingToSaveMessage({
        noteType: WorkspaceNoteType.Private,
        hasAttachments: true,
        workspaceType: WorkspaceType.Slack,
      }),
    ).toBe("The message you pinned has no text to save as a note.");
  });

  test("the confirmation as a notification's plain text", () => {
    expect(
      WorkspaceReactionNote.getConfirmationText({
        noteType: WorkspaceNoteType.Private,
        resourceLabel: "Incident #7",
      }),
    ).toBe("Saved as a private note on Incident #7");
    expect(
      WorkspaceReactionNote.getConfirmationText({
        noteType: WorkspaceNoteType.Public,
        resourceLabel: "Incident #7",
      }),
    ).toBe("Saved as a public note on Incident #7");
  });

  test("each record kind is the event a Connect button finishes, and back", () => {
    for (const resourceType of Object.values(WorkspaceNoteResourceType)) {
      expect(
        WorkspaceReactionNote.getResourceType(
          WorkspaceReactionNote.getEventType(resourceType),
        ),
      ).toBe(resourceType);
    }

    expect(
      WorkspaceReactionNote.getEventType(
        WorkspaceNoteResourceType.AlertEpisode,
      ),
    ).toBe(WorkspaceEventType.AlertEpisode);
  });
});

/*
 * A PRIVATE INCIDENT OR EPISODE TAKES NO PUBLIC NOTES.
 *
 * A 📣 on a message in a private incident's channel asks for a public note
 * the incident cannot take (Types/StatusPage/PrivateRecordPublicNotes): it
 * would reach no status page and no subscriber, and the server refuses one.
 * The message is saved as a private note instead - nothing the person wrote
 * is lost, and only the people who can see the incident read it - and the
 * one confirmation in its thread says so.
 */
describe("WorkspaceReactionNote.getNoteTypeSavedAs", () => {
  function resource(
    resourceType: WorkspaceNoteResourceType,
  ): WorkspaceNoteResource {
    return {
      resourceType: resourceType,
      resourceId: ObjectID.generate(),
      projectId: projectId,
    };
  }

  test("a 📣 on a private incident saves a private note", async () => {
    const incident: WorkspaceNoteResource = resource(
      WorkspaceNoteResourceType.Incident,
    );
    const lookups: Array<PrivateRecordLookup> = stubPrivateRecords([
      incident.resourceId,
    ]);

    await expect(
      WorkspaceReactionNote.getNoteTypeSavedAs({
        resource: incident,
        noteType: WorkspaceNoteType.Public,
      }),
    ).resolves.toBe(WorkspaceNoteType.Private);

    // Asked about this incident, in its project.
    expect(lookups).toEqual([
      {
        kind: PrivateRecordKind.Incident,
        recordId: incident.resourceId.toString(),
        projectId: projectId.toString(),
      },
    ]);
  });

  test("a 📣 on an incident that is not private saves a public note", async () => {
    stubPrivateRecords();

    await expect(
      WorkspaceReactionNote.getNoteTypeSavedAs({
        resource: resource(WorkspaceNoteResourceType.Incident),
        noteType: WorkspaceNoteType.Public,
      }),
    ).resolves.toBe(WorkspaceNoteType.Public);
  });

  test("a private episode's public note is saved private too", async () => {
    const episode: WorkspaceNoteResource = resource(
      WorkspaceNoteResourceType.IncidentEpisode,
    );
    const lookups: Array<PrivateRecordLookup> = stubPrivateRecords([
      episode.resourceId,
    ]);

    await expect(
      WorkspaceReactionNote.getNoteTypeSavedAs({
        resource: episode,
        noteType: WorkspaceNoteType.Public,
      }),
    ).resolves.toBe(WorkspaceNoteType.Private);
    expect(lookups[0]!.kind).toBe(PrivateRecordKind.IncidentEpisode);
  });

  test("a pin is a private note, and nothing is asked", async () => {
    const lookups: Array<PrivateRecordLookup> = stubPrivateRecords();

    for (const resourceType of WorkspaceReactionNote.getAllResourceTypes()) {
      await expect(
        WorkspaceReactionNote.getNoteTypeSavedAs({
          resource: resource(resourceType),
          noteType: WorkspaceNoteType.Private,
        }),
      ).resolves.toBe(WorkspaceNoteType.Private);
    }

    expect(lookups).toEqual([]);
  });

  test("a scheduled maintenance event has no Private switch: a 📣 there is a public note, and nothing is asked", async () => {
    const lookups: Array<PrivateRecordLookup> = stubPrivateRecords();

    await expect(
      WorkspaceReactionNote.getNoteTypeSavedAs({
        resource: resource(WorkspaceNoteResourceType.ScheduledMaintenance),
        noteType: WorkspaceNoteType.Public,
      }),
    ).resolves.toBe(WorkspaceNoteType.Public);
    expect(lookups).toEqual([]);
  });

  test("the records that can be private are incidents and incident episodes", () => {
    expect(
      WorkspaceReactionNote.getAllResourceTypes().filter(
        (resourceType: WorkspaceNoteResourceType): boolean => {
          return (
            WorkspaceReactionNote.getPrivateRecordKind(resourceType) !== null
          );
        },
      ),
    ).toEqual([
      WorkspaceNoteResourceType.Incident,
      WorkspaceNoteResourceType.IncidentEpisode,
    ]);
  });
});

describe("WorkspaceReactionNote.getConfirmationMessage, on a private incident", () => {
  test("a 📣 saved as a private note says why, after the link", () => {
    expect(
      WorkspaceReactionNote.getConfirmationMessage({
        noteType: WorkspaceNoteType.Private,
        askedNoteType: WorkspaceNoteType.Public,
        resourceType: WorkspaceNoteResourceType.Incident,
        resourceLabel: "Incident INC-42",
        resourceLink: "https://x/42",
      }).toString(),
    ).toBe(
      "✅ Saved as a **private note** on [Incident INC-42](https://x/42). The incident is private, so public notes cannot be added to it.",
    );
  });

  test("names an episode as an incident episode", () => {
    expect(
      WorkspaceReactionNote.getConfirmationMessage({
        noteType: WorkspaceNoteType.Private,
        askedNoteType: WorkspaceNoteType.Public,
        resourceType: WorkspaceNoteResourceType.IncidentEpisode,
        resourceLabel: "Incident Episode #3",
        resourceLink: "https://x/3",
      }).toString(),
    ).toContain(
      "The incident episode is private, so public notes cannot be added to it.",
    );
  });

  test("a pin's confirmation is as it always was", () => {
    expect(
      WorkspaceReactionNote.getConfirmationMessage({
        noteType: WorkspaceNoteType.Private,
        askedNoteType: WorkspaceNoteType.Private,
        resourceType: WorkspaceNoteResourceType.Incident,
        resourceLabel: "Incident INC-42",
        resourceLink: "https://x/42",
      }).toString(),
    ).toBe(
      "✅ Saved as a **private note** on [Incident INC-42](https://x/42).",
    );
  });

  test("Slack posts it as mrkdwn: the reason is plain text after the link", () => {
    const text: string = SlackUtil.slackify(
      WorkspaceReactionNote.getConfirmationMessage({
        noteType: WorkspaceNoteType.Private,
        askedNoteType: WorkspaceNoteType.Public,
        resourceType: WorkspaceNoteResourceType.Incident,
        resourceLabel: "Incident INC-42",
        resourceLink: "https://x/42",
      }).toString(),
    ).trim();

    expect(text).toContain("*private note*");
    expect(text).toContain("<https://x/42|Incident INC-42>");
    expect(text).toContain(
      "The incident is private, so public notes cannot be added to it.",
    );
    expect(text).not.toContain("status page");
  });
});
