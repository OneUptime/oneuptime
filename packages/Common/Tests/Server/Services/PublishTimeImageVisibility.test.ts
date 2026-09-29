import AIAgent from "../../../Models/DatabaseModels/AIAgent";
import IncidentEpisodePublicNote from "../../../Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import Probe from "../../../Models/DatabaseModels/Probe";
import ScheduledMaintenancePublicNote from "../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import AIAgentService from "../../../Server/Services/AIAgentService";
import FileService from "../../../Server/Services/FileService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodePublicNoteService from "../../../Server/Services/IncidentEpisodePublicNoteService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentPublicNoteService from "../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../Server/Services/IncidentService";
import ProbeService from "../../../Server/Services/ProbeService";
import ScheduledMaintenanceFeedService from "../../../Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenancePublicNoteService from "../../../Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import StatusPageAnnouncementService from "../../../Server/Services/StatusPageAnnouncementService";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Inline images uploaded through the markdown editor arrive PRIVATE — that is
 * what stops a private incident screenshot being readable by anyone holding
 * the URL. They have to flip to public at exactly the moment their parent
 * becomes visible on a status page, or every image in a published note 404s
 * for the anonymous visitors the note was written for.
 *
 * These tests drive the real hooks and assert the flip lands on FileService,
 * so they cover the whole chain (service hook -> sync util -> file write)
 * rather than just "some function was called".
 */

const FILE_ID: string = "11111111-1111-4111-8111-111111111111";
const ICON_FILE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const TOKEN: string = "abc123def456";
const NOTE_WITH_IMAGE: string = `Here is what broke: ![shot](https://example.com/file/image/access-token/${TOKEN})`;

type CallHookFunction = (
  service: unknown,
  name: string,
  ...args: Array<unknown>
) => Promise<unknown>;

// Calls a protected hook without widening the service's public surface.
const callHook: CallHookFunction = (
  service: unknown,
  name: string,
  ...args: Array<unknown>
): Promise<unknown> => {
  const hooks: Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  > = service as Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  >;

  return hooks[name]!.apply(service, args);
};

type UpdatedFileIds = () => Array<string>;

// Every file id the code under test flipped to public.
const filesMadePublic: UpdatedFileIds = (): Array<string> => {
  return (FileService.updateOneById as unknown as jest.Mock).mock.calls
    .filter((call: Array<any>) => {
      return call[0]?.data?.isPublic === true;
    })
    .map((call: Array<any>) => {
      return String(call[0]?.id);
    });
};

describe("publish-time inline image visibility", () => {
  beforeEach(() => {
    jest.spyOn(FileService, "findOneBy").mockResolvedValue({
      _id: FILE_ID,
    } as never);
    jest
      .spyOn(FileService, "updateOneById")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("IncidentPublicNoteService", () => {
    beforeEach(() => {
      jest.spyOn(IncidentService, "getIncidentNumber").mockResolvedValue({
        number: 1,
        numberWithPrefix: "#1",
      });
      jest
        .spyOn(IncidentService, "getIncidentLinkInDashboard")
        .mockResolvedValue(URL.fromString("https://oneuptime.test/incident"));
      jest
        .spyOn(IncidentFeedService, "createIncidentFeedItem")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(IncidentPublicNoteService, "findOneById")
        .mockResolvedValue(null);
    });

    it("publishes inline images when a public note is created", async () => {
      const note: IncidentPublicNote = new IncidentPublicNote();
      note.id = new ObjectID("33333333-3333-4333-8333-333333333333");
      note.incidentId = new ObjectID("44444444-4444-4444-8444-444444444444");
      note.projectId = new ObjectID("55555555-5555-4555-8555-555555555555");
      note.note = NOTE_WITH_IMAGE;

      await callHook(IncidentPublicNoteService, "onCreateSuccess", {}, note);

      expect(filesMadePublic()).toEqual([FILE_ID]);
    });

    it("publishes inline images when a public note is edited", async () => {
      const note: IncidentPublicNote = new IncidentPublicNote();
      note.id = new ObjectID("33333333-3333-4333-8333-333333333333");
      note.incidentId = new ObjectID("44444444-4444-4444-8444-444444444444");
      note.projectId = new ObjectID("55555555-5555-4555-8555-555555555555");
      note.note = NOTE_WITH_IMAGE;
      note.incident = {
        id: new ObjectID("44444444-4444-4444-8444-444444444444"),
        projectId: new ObjectID("55555555-5555-4555-8555-555555555555"),
        incidentNumber: 1,
      } as never;

      jest.spyOn(IncidentPublicNoteService, "findBy").mockResolvedValue([note]);

      await callHook(
        IncidentPublicNoteService,
        "onUpdateSuccess",
        {
          updateBy: {
            query: {},
            data: { note: NOTE_WITH_IMAGE },
            props: { isRoot: true },
          },
        },
        [],
      );

      expect(filesMadePublic()).toEqual([FILE_ID]);
    });

    it("does not touch any file when the note has no inline images", async () => {
      const note: IncidentPublicNote = new IncidentPublicNote();
      note.id = new ObjectID("33333333-3333-4333-8333-333333333333");
      note.incidentId = new ObjectID("44444444-4444-4444-8444-444444444444");
      note.projectId = new ObjectID("55555555-5555-4555-8555-555555555555");
      note.note = "No screenshots on this one.";

      await callHook(IncidentPublicNoteService, "onCreateSuccess", {}, note);

      expect(FileService.updateOneById).not.toHaveBeenCalled();
    });
  });

  describe("IncidentEpisodePublicNoteService", () => {
    beforeEach(() => {
      jest.spyOn(IncidentEpisodeService, "getEpisodeNumber").mockResolvedValue({
        number: 1,
        numberWithPrefix: "#1",
      });
      jest
        .spyOn(IncidentEpisodeService, "getEpisodeLinkInDashboard")
        .mockResolvedValue(URL.fromString("https://oneuptime.test/episode"));
      jest
        .spyOn(IncidentEpisodeFeedService, "createIncidentEpisodeFeedItem")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(IncidentEpisodePublicNoteService, "findOneById")
        .mockResolvedValue(null);
    });

    it("publishes inline images when a public note is created", async () => {
      const note: IncidentEpisodePublicNote = new IncidentEpisodePublicNote();
      note.id = new ObjectID("33333333-3333-4333-8333-333333333333");
      note.incidentEpisodeId = new ObjectID(
        "44444444-4444-4444-8444-444444444444",
      );
      note.projectId = new ObjectID("55555555-5555-4555-8555-555555555555");
      note.note = NOTE_WITH_IMAGE;

      await callHook(
        IncidentEpisodePublicNoteService,
        "onCreateSuccess",
        {},
        note,
      );

      expect(filesMadePublic()).toEqual([FILE_ID]);
    });

    it("publishes inline images when a public note is edited", async () => {
      const note: IncidentEpisodePublicNote = new IncidentEpisodePublicNote();
      note.id = new ObjectID("33333333-3333-4333-8333-333333333333");
      note.incidentEpisodeId = new ObjectID(
        "44444444-4444-4444-8444-444444444444",
      );
      note.projectId = new ObjectID("55555555-5555-4555-8555-555555555555");
      note.note = NOTE_WITH_IMAGE;
      note.incidentEpisode = {
        id: new ObjectID("44444444-4444-4444-8444-444444444444"),
        projectId: new ObjectID("55555555-5555-4555-8555-555555555555"),
        episodeNumber: 1,
      } as never;

      jest
        .spyOn(IncidentEpisodePublicNoteService, "findBy")
        .mockResolvedValue([note]);

      await callHook(
        IncidentEpisodePublicNoteService,
        "onUpdateSuccess",
        {
          updateBy: {
            query: {},
            data: { note: NOTE_WITH_IMAGE },
            props: { isRoot: true },
          },
        },
        [],
      );

      expect(filesMadePublic()).toEqual([FILE_ID]);
    });
  });

  describe("ScheduledMaintenancePublicNoteService", () => {
    beforeEach(() => {
      jest
        .spyOn(ScheduledMaintenanceService, "getScheduledMaintenanceNumber")
        .mockResolvedValue({ number: 1, numberWithPrefix: "#1" });
      jest
        .spyOn(
          ScheduledMaintenanceService,
          "getScheduledMaintenanceLinkInDashboard",
        )
        .mockResolvedValue(
          URL.fromString("https://oneuptime.test/maintenance"),
        );
      jest
        .spyOn(
          ScheduledMaintenanceFeedService,
          "createScheduledMaintenanceFeedItem",
        )
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(ScheduledMaintenancePublicNoteService, "findOneById")
        .mockResolvedValue(null);
    });

    it("publishes inline images when a public note is created", async () => {
      const note: ScheduledMaintenancePublicNote =
        new ScheduledMaintenancePublicNote();
      note.id = new ObjectID("33333333-3333-4333-8333-333333333333");
      note.scheduledMaintenanceId = new ObjectID(
        "44444444-4444-4444-8444-444444444444",
      );
      note.projectId = new ObjectID("55555555-5555-4555-8555-555555555555");
      note.note = NOTE_WITH_IMAGE;

      await callHook(
        ScheduledMaintenancePublicNoteService,
        "onCreateSuccess",
        {},
        note,
      );

      expect(filesMadePublic()).toEqual([FILE_ID]);
    });

    it("publishes inline images when a public note is edited", async () => {
      const note: ScheduledMaintenancePublicNote =
        new ScheduledMaintenancePublicNote();
      note.id = new ObjectID("33333333-3333-4333-8333-333333333333");
      note.scheduledMaintenanceId = new ObjectID(
        "44444444-4444-4444-8444-444444444444",
      );
      note.projectId = new ObjectID("55555555-5555-4555-8555-555555555555");
      note.note = NOTE_WITH_IMAGE;
      note.scheduledMaintenance = {
        id: new ObjectID("44444444-4444-4444-8444-444444444444"),
        projectId: new ObjectID("55555555-5555-4555-8555-555555555555"),
        scheduledMaintenanceNumber: 1,
      } as never;

      jest
        .spyOn(ScheduledMaintenancePublicNoteService, "findBy")
        .mockResolvedValue([note]);

      await callHook(
        ScheduledMaintenancePublicNoteService,
        "onUpdateSuccess",
        {
          updateBy: {
            query: {},
            data: { note: NOTE_WITH_IMAGE },
            props: { isRoot: true },
          },
        },
        [],
      );

      expect(filesMadePublic()).toEqual([FILE_ID]);
    });
  });

  describe("StatusPageAnnouncementService", () => {
    it("publishes inline images when an announcement is created", async () => {
      const announcement: StatusPageAnnouncement = new StatusPageAnnouncement();
      announcement.id = new ObjectID("33333333-3333-4333-8333-333333333333");
      announcement.description = NOTE_WITH_IMAGE;

      await callHook(
        StatusPageAnnouncementService,
        "onCreateSuccess",
        {},
        announcement,
      );

      expect(filesMadePublic()).toEqual([FILE_ID]);
    });

    it("publishes inline images when an announcement is edited", async () => {
      const announcement: StatusPageAnnouncement = new StatusPageAnnouncement();
      announcement.id = new ObjectID("33333333-3333-4333-8333-333333333333");
      announcement.description = NOTE_WITH_IMAGE;

      jest
        .spyOn(StatusPageAnnouncementService, "findBy")
        .mockResolvedValue([announcement]);

      await callHook(
        StatusPageAnnouncementService,
        "onUpdateSuccess",
        { updateBy: { query: {}, data: { description: NOTE_WITH_IMAGE } } },
        [],
      );

      expect(filesMadePublic()).toEqual([FILE_ID]);
    });

    it("does not touch any file when the description has no inline images", async () => {
      const announcement: StatusPageAnnouncement = new StatusPageAnnouncement();
      announcement.id = new ObjectID("33333333-3333-4333-8333-333333333333");
      announcement.description = "Scheduled work is now complete.";

      await callHook(
        StatusPageAnnouncementService,
        "onCreateSuccess",
        {},
        announcement,
      );

      expect(FileService.updateOneById).not.toHaveBeenCalled();
    });
  });

  /*
   * Probe and AI agent icons are the only readers of the id-based image
   * route, which serves public files only. They upload through the file
   * picker, which marks uploads private — so attaching one has to publish it
   * or the icon 404s.
   */
  describe("intentionally public icons", () => {
    it("publishes a probe icon on create", async () => {
      const probe: Probe = new Probe();
      probe.id = new ObjectID("33333333-3333-4333-8333-333333333333");
      probe.iconFileId = ICON_FILE_ID;

      await callHook(ProbeService, "onCreateSuccess", {}, probe);

      expect(filesMadePublic()).toEqual([ICON_FILE_ID.toString()]);
    });

    it("publishes a probe icon when it is swapped out", async () => {
      await callHook(
        ProbeService,
        "onUpdateSuccess",
        {
          updateBy: { query: {}, data: { iconFileId: ICON_FILE_ID } },
          carryForward: null,
        },
        [],
      );

      expect(filesMadePublic()).toEqual([ICON_FILE_ID.toString()]);
    });

    it("leaves files alone when a probe update does not touch the icon", async () => {
      await callHook(
        ProbeService,
        "onUpdateSuccess",
        {
          updateBy: { query: {}, data: { name: "Renamed probe" } },
          carryForward: null,
        },
        [],
      );

      expect(FileService.updateOneById).not.toHaveBeenCalled();
    });

    it("publishes an AI agent icon on create", async () => {
      const agent: AIAgent = new AIAgent();
      agent.id = new ObjectID("33333333-3333-4333-8333-333333333333");
      agent.iconFileId = ICON_FILE_ID;

      await callHook(AIAgentService, "onCreateSuccess", {}, agent);

      expect(filesMadePublic()).toEqual([ICON_FILE_ID.toString()]);
    });

    it("publishes an AI agent icon when it is swapped out", async () => {
      await callHook(
        AIAgentService,
        "onUpdateSuccess",
        {
          updateBy: { query: {}, data: { iconFileId: ICON_FILE_ID } },
          carryForward: null,
        },
        [],
      );

      expect(filesMadePublic()).toEqual([ICON_FILE_ID.toString()]);
    });

    it("leaves files alone when an agent update does not touch the icon", async () => {
      await callHook(
        AIAgentService,
        "onUpdateSuccess",
        {
          updateBy: { query: {}, data: { description: "Renamed" } },
          carryForward: null,
        },
        [],
      );

      expect(FileService.updateOneById).not.toHaveBeenCalled();
    });
  });
});
