import AIAgent from "../../../Models/DatabaseModels/AIAgent";
import Probe from "../../../Models/DatabaseModels/Probe";
import AIAgentService from "../../../Server/Services/AIAgentService";
import FileService from "../../../Server/Services/FileService";
import ProbeService from "../../../Server/Services/ProbeService";
import ObjectID from "../../../Types/ObjectID";
import File from "../../../Models/DatabaseModels/File";
import { FileOwners } from "../../../Server/Utils/File/FileOwnership";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Files uploaded through the file picker arrive PRIVATE — that is what stops
 * a private incident screenshot being readable by anyone holding the URL.
 * A probe's or an AI agent's icon has to flip to public as it is attached,
 * or the icon 404s.
 *
 * These tests drive the real hooks and assert the flip lands on FileService,
 * so they cover the whole chain (service hook -> FileService -> file write)
 * rather than just "some function was called". Inline images in what a
 * record shows to everyone are published by DatabaseService instead
 * (PublishedImages).
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

  /*
   * Public notes and announcements no longer publish their images in their
   * own hooks: DatabaseService does, on every create, update and delete of
   * a record that shows its markdown to everyone, and makes an image private
   * again once nothing shows it (PublishedImages; held by
   * DatabaseServicePublishedImages.test.ts and PublishedImages.test.ts).
   */

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

    /*
     * A create publishes the icon its saved row holds, read back like an
     * update's: the icon is stored under one column, whichever of its two
     * names the create sent.
     */
    async function create(
      created: Probe | AIAgent,
      saved: Probe | AIAgent,
    ): Promise<jest.SpyInstance> {
      const findBy: jest.SpyInstance = jest
        .spyOn(service, "findBy")
        .mockResolvedValue([saved] as never);

      await callHook(service, "onCreateSuccess", {}, created);

      return findBy;
    }

    it("publishes a global record's icon on create", async () => {
      await create(
        record({ iconFileId: ICON_FILE_ID }),
        record({ iconFileId: ICON_FILE_ID }),
      );

      expect(filesMadePublic()).toEqual([ICON_FILE_ID.toString()]);
    });

    it("publishes a project record's icon on create when it is the project's own", async () => {
      const findBy: jest.SpyInstance = await create(
        record({ projectId: ICON_PROJECT_ID, iconFileId: ICON_FILE_ID }),
        record({ projectId: ICON_PROJECT_ID, iconFileId: ICON_FILE_ID }),
      );

      expect(filesMadePublic()).toEqual([ICON_FILE_ID.toString()]);

      const read: {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        props: Record<string, unknown>;
      } = findBy.mock.calls[0]![0] as {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        props: Record<string, unknown>;
      };

      expect(JSON.stringify(read.query)).toContain(RECORD_ID.toString());
      expect(read.select).toMatchObject({ projectId: true, iconFileId: true });
      expect(read.props).toEqual({ isRoot: true });
    });

    it("publishes an icon written as the relation, as the dashboard writes it", async () => {
      await create(
        record({ projectId: ICON_PROJECT_ID, iconFile: ICON_FILE_ID }),
        record({ projectId: ICON_PROJECT_ID, iconFileId: ICON_FILE_ID }),
      );

      expect(filesMadePublic()).toEqual([ICON_FILE_ID.toString()]);
    });

    it("publishes the icon the saved row holds, not what the create's other name said", async () => {
      await create(
        record({
          projectId: ICON_PROJECT_ID,
          iconFileId: FOREIGN_ICON_FILE_ID,
          iconFile: ICON_FILE_ID,
        }),
        record({ projectId: ICON_PROJECT_ID, iconFileId: ICON_FILE_ID }),
      );

      expect(filesMadePublic()).toEqual([ICON_FILE_ID.toString()]);
    });

    it("never publishes another project's file, or one with no project, on create", async () => {
      for (const fileId of [FOREIGN_ICON_FILE_ID, UNOWNED_ICON_FILE_ID]) {
        await create(
          record({ projectId: ICON_PROJECT_ID, iconFileId: fileId }),
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
