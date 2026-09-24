import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import AlertEpisodeInternalNote from "../../../../Models/DatabaseModels/AlertEpisodeInternalNote";
import AlertInternalNote from "../../../../Models/DatabaseModels/AlertInternalNote";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisodeInternalNote from "../../../../Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import ScheduledMaintenanceInternalNote from "../../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenancePublicNote from "../../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
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
import WorkspaceNotificationLogService from "../../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceReactionNote, {
  WorkspaceNoteResource,
  WorkspaceNoteResourceType,
  WorkspaceNoteSaveResult,
} from "../../../../Server/Utils/Workspace/WorkspaceReactionNote";
import URL from "../../../../Types/API/URL";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../Types/ObjectID";
import { WorkspaceNoteType } from "../../../../Types/Workspace/WorkspaceNoteReaction";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";

const projectId: ObjectID = ObjectID.generate();
const otherProjectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const CHANNEL_ID: string = "C0INCIDENT";

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
          userId: userId,
          note: "Restarted the database",
          sourceMessageKey: "C1:1.2",
        });

      expect(result).toBe(WorkspaceNoteSaveResult.Saved);
      expect(hasSpy).toHaveBeenCalledWith({
        [idKey]: resource.resourceId,
        postedFromSlackMessageId: "C1:1.2",
      });
      expect(addSpy).toHaveBeenCalledWith({
        [idKey]: resource.resourceId,
        projectId: projectId,
        userId: userId,
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
          userId: userId,
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
        userId: userId,
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
  const slack: {
    formatLink: (url: string, text: string) => string;
    formatBold: (text: string) => string;
  } = {
    formatLink: (url: string, text: string): string => {
      return `<${url}|${text}>`;
    },
    formatBold: (text: string): string => {
      return `*${text}*`;
    },
  };

  const teams: {
    formatLink: (url: string, text: string) => string;
    formatBold: (text: string) => string;
  } = {
    formatLink: (url: string, text: string): string => {
      return `[${text}](${url})`;
    },
    formatBold: (text: string): string => {
      return `**${text}**`;
    },
  };

  test("Slack private note keeps the wording Slack users know", () => {
    expect(
      WorkspaceReactionNote.getConfirmationMessage({
        noteType: WorkspaceNoteType.Private,
        resourceLabel: "Incident #7",
        resourceLink: "https://x/7",
        ...slack,
      }),
    ).toBe("✅ Message saved as *private note* to <https://x/7|Incident #7>.");
  });

  test("Slack public note mentions the status page", () => {
    expect(
      WorkspaceReactionNote.getConfirmationMessage({
        noteType: WorkspaceNoteType.Public,
        resourceLabel: "Incident #7",
        resourceLink: "https://x/7",
        ...slack,
      }),
    ).toBe(
      "✅ Message saved as *public note* to <https://x/7|Incident #7>. This note will be visible on the status page.",
    );
  });

  test("Teams uses markdown links and bold", () => {
    expect(
      WorkspaceReactionNote.getConfirmationMessage({
        noteType: WorkspaceNoteType.Private,
        resourceLabel: "Alert #3",
        resourceLink: "https://x/3",
        ...teams,
      }),
    ).toBe("✅ Message saved as **private note** to [Alert #3](https://x/3).");
  });
});
