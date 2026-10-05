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
import File from "../../../Models/DatabaseModels/File";
import { FileOwners } from "../../../Server/Utils/File/FileOwnership";
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
// The probe or AI agent the icon tests write, and the project it belongs to.
const RECORD_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ICON_PROJECT_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const FOREIGN_ICON_FILE_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const UNOWNED_ICON_FILE_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);

// Who each icon file belongs to: ICON_FILE_ID is ICON_PROJECT_ID's own.
const ICON_OWNERS: Record<string, FileOwners> = {
  [ICON_FILE_ID.toString()]: {
    projectId: ICON_PROJECT_ID,
    createdByUserId: null,
  },
  [FOREIGN_ICON_FILE_ID.toString()]: {
    projectId: new ObjectID("99999999-9999-4999-8999-999999999999"),
    createdByUserId: null,
  },
  [UNOWNED_ICON_FILE_ID.toString()]: { projectId: null, createdByUserId: null },
};

interface IconService {
  findBy: (...args: Array<unknown>) => Promise<unknown>;
}

interface IconCase {
  name: string;
  service: IconService;
  build: () => Probe | AIAgent;
}

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
    // The image is a file of the project every note here belongs to.
    jest.spyOn(FileService, "findOneBy").mockResolvedValue({
      _id: FILE_ID,
      projectId: new ObjectID("55555555-5555-4555-8555-555555555555"),
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

    /*
     * A token travels with the markdown it is pasted into: a note publishes
     * only the images of its own project.
     */
    it("publishes an image of the note's own project, and never another project's", async () => {
      const note: IncidentPublicNote = new IncidentPublicNote();
      note.id = new ObjectID("33333333-3333-4333-8333-333333333333");
      note.incidentId = new ObjectID("44444444-4444-4444-8444-444444444444");
      note.projectId = new ObjectID("55555555-5555-4555-8555-555555555555");
      note.note = NOTE_WITH_IMAGE;

      jest.spyOn(FileService, "findOneBy").mockResolvedValue({
        _id: FILE_ID,
        projectId: new ObjectID("55555555-5555-4555-8555-555555555555"),
      } as never);

      await callHook(IncidentPublicNoteService, "onCreateSuccess", {}, note);

      expect(filesMadePublic()).toEqual([FILE_ID]);

      (FileService.updateOneById as unknown as jest.Mock).mockClear();

      jest.spyOn(FileService, "findOneBy").mockResolvedValue({
        _id: FILE_ID,
        projectId: new ObjectID("99999999-9999-4999-8999-999999999999"),
      } as never);

      await callHook(IncidentPublicNoteService, "onCreateSuccess", {}, note);

      expect(FileService.updateOneById).not.toHaveBeenCalled();
    });

    it("never publishes another project's image when a note is edited", async () => {
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
      jest.spyOn(FileService, "findOneBy").mockResolvedValue({
        _id: FILE_ID,
        projectId: new ObjectID("99999999-9999-4999-8999-999999999999"),
      } as never);

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

      expect(FileService.updateOneById).not.toHaveBeenCalled();
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
      announcement.projectId = new ObjectID(
        "55555555-5555-4555-8555-555555555555",
      );
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
      announcement.projectId = new ObjectID(
        "55555555-5555-4555-8555-555555555555",
      );
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

    it("never publishes another project's image, on create or edit", async () => {
      const announcement: StatusPageAnnouncement = new StatusPageAnnouncement();
      announcement.id = new ObjectID("33333333-3333-4333-8333-333333333333");
      announcement.projectId = new ObjectID(
        "55555555-5555-4555-8555-555555555555",
      );
      announcement.description = NOTE_WITH_IMAGE;

      jest.spyOn(FileService, "findOneBy").mockResolvedValue({
        _id: FILE_ID,
        projectId: new ObjectID("99999999-9999-4999-8999-999999999999"),
      } as never);
      const findBy: jest.SpyInstance = jest
        .spyOn(StatusPageAnnouncementService, "findBy")
        .mockResolvedValue([announcement]);

      await callHook(
        StatusPageAnnouncementService,
        "onCreateSuccess",
        {},
        announcement,
      );
      await callHook(
        StatusPageAnnouncementService,
        "onUpdateSuccess",
        { updateBy: { query: {}, data: { description: NOTE_WITH_IMAGE } } },
        [],
      );

      expect(FileService.updateOneById).not.toHaveBeenCalled();
      // The edit reads each announcement's project to hold its images to.
      expect(
        (findBy.mock.calls[0]![0] as { select: Record<string, unknown> })
          .select,
      ).toMatchObject({ description: true, projectId: true });
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
   * or the icon 404s. Only a file of the record's own project is published,
   * and after an update only the icon the record holds now: a record never
   * makes another project's file readable by everyone.
   */
  describe.each([
    {
      name: "probe",
      service: ProbeService as unknown as IconService,
      build: (): Probe | AIAgent => {
        return new Probe();
      },
    },
    {
      name: "AI agent",
      service: AIAgentService as unknown as IconService,
      build: (): Probe | AIAgent => {
        return new AIAgent();
      },
    },
  ])("intentionally public icons: $name", ({ service, build }: IconCase) => {
    beforeEach(() => {
      jest.spyOn(FileService, "getFileOwners").mockImplementation((async (
        fileIds: Array<ObjectID>,
      ): Promise<Map<string, FileOwners>> => {
        const owners: Map<string, FileOwners> = new Map();

        for (const fileId of fileIds) {
          const key: string = fileId.toString().toLowerCase();

          if (ICON_OWNERS[key]) {
            owners.set(key, ICON_OWNERS[key]!);
          }
        }

        return owners;
      }) as never);
    });

    function record(data: {
      projectId?: ObjectID;
      iconFileId?: ObjectID;
      iconFile?: ObjectID;
    }): Probe | AIAgent {
      const item: Probe | AIAgent = build();
      item.id = RECORD_ID;

      if (data.projectId) {
        item.projectId = data.projectId;
      }

      if (data.iconFileId) {
        item.iconFileId = data.iconFileId;
      }

      if (data.iconFile) {
        const file: File = new File();
        file.id = data.iconFile;
        item.iconFile = file;
      }

      return item;
    }

    async function update(data: Record<string, unknown>): Promise<void> {
      await callHook(
        service,
        "onUpdateSuccess",
        {
          updateBy: { query: { _id: RECORD_ID.toString() }, data: data },
          carryForward: null,
        },
        [RECORD_ID],
      );
    }

    it("publishes a global record's icon on create", async () => {
      await callHook(
        service,
        "onCreateSuccess",
        {},
        record({ iconFileId: ICON_FILE_ID }),
      );

      expect(filesMadePublic()).toEqual([ICON_FILE_ID.toString()]);
    });

    it("publishes a project record's icon on create when it is the project's own", async () => {
      await callHook(
        service,
        "onCreateSuccess",
        {},
        record({ projectId: ICON_PROJECT_ID, iconFileId: ICON_FILE_ID }),
      );

      expect(filesMadePublic()).toEqual([ICON_FILE_ID.toString()]);
    });

    it("publishes an icon written as the relation, as the dashboard writes it", async () => {
      await callHook(
        service,
        "onCreateSuccess",
        {},
        record({ projectId: ICON_PROJECT_ID, iconFile: ICON_FILE_ID }),
      );

      expect(filesMadePublic()).toEqual([ICON_FILE_ID.toString()]);
    });

    it("never publishes another project's file, or one with no project, on create", async () => {
      for (const fileId of [FOREIGN_ICON_FILE_ID, UNOWNED_ICON_FILE_ID]) {
        await callHook(
          service,
          "onCreateSuccess",
          {},
          record({ projectId: ICON_PROJECT_ID, iconFileId: fileId }),
        );
      }

      expect(FileService.updateOneById).not.toHaveBeenCalled();
    });

    it("publishes the icon the record holds after an update", async () => {
      const findBy: jest.SpyInstance = jest
        .spyOn(service, "findBy")
        .mockResolvedValue([
          record({ projectId: ICON_PROJECT_ID, iconFileId: ICON_FILE_ID }),
        ] as never);

      await update({ iconFile: { _id: ICON_FILE_ID.toString() } });

      expect(filesMadePublic()).toEqual([ICON_FILE_ID.toString()]);

      const read: {
        select: Record<string, unknown>;
        props: Record<string, unknown>;
      } = findBy.mock.calls[0]![0] as {
        select: Record<string, unknown>;
        props: Record<string, unknown>;
      };

      expect(read.select).toMatchObject({ projectId: true, iconFileId: true });
      expect(read.props).toEqual({ isRoot: true });
    });

    it("publishes what the record holds, not what the update said", async () => {
      jest
        .spyOn(service, "findBy")
        .mockResolvedValue([
          record({ projectId: ICON_PROJECT_ID, iconFileId: ICON_FILE_ID }),
        ] as never);

      await update({ iconFileId: FOREIGN_ICON_FILE_ID });

      expect(filesMadePublic()).toEqual([ICON_FILE_ID.toString()]);
    });

    it("never publishes another project's file after an update", async () => {
      jest.spyOn(service, "findBy").mockResolvedValue([
        record({
          projectId: ICON_PROJECT_ID,
          iconFileId: FOREIGN_ICON_FILE_ID,
        }),
      ] as never);

      await update({ iconFileId: FOREIGN_ICON_FILE_ID });

      expect(FileService.updateOneById).not.toHaveBeenCalled();
    });

    it("leaves files alone when an update does not touch the icon", async () => {
      const findBy: jest.SpyInstance = jest.spyOn(service, "findBy");

      await update({ name: "Renamed", description: "Renamed" });

      expect(findBy).not.toHaveBeenCalled();
      expect(FileService.updateOneById).not.toHaveBeenCalled();
    });
  });
});
