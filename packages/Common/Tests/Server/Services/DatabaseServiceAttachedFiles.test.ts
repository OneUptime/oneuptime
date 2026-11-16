import DatabaseService from "../../../Server/Services/DatabaseService";
import logger from "../../../Server/Utils/Logger";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceInternalNote from "../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenancePublicNote from "../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

jest.mock("../../../Server/Utils/Logger");

/*
 * DELETING AN INCIDENT DELETES THE FILES ATTACHED TO IT (issue #6944), and
 * so does deleting a scheduled maintenance event, one of its notes, or a
 * status page announcement (issue #8895), on both of DatabaseService's
 * delete paths: a person's delete (deleteBy) and a retention purge
 * (hardDeleteBy). The service is DatabaseService itself over the record's
 * table, the repository an in-memory stand-in, and the statements the
 * delete runs are answered by a small table of attachments. What is pinned:
 *
 *   - the files attached to the record, its notes and its postmortem are
 *     read before the DELETE, and deleted after it;
 *   - a file something still holds - here a record's custom field - stays,
 *     and only files of their own project are deleted;
 *   - a table with no attachments reads none;
 *   - a read that fails leaves the files, and the delete goes ahead.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6944aaaa-0000-4000-8000-000000000001",
);
const INCIDENT_ID: string = "6944bbbb-0000-4000-8000-000000000001";
const NOTE_FILE: string = "6944ffff-0000-4000-8000-000000000001";
const POSTMORTEM_FILE: string = "6944ffff-0000-4000-8000-000000000002";
const HELD_FILE: string = "6944ffff-0000-4000-8000-000000000003";

// The first table a statement reads from.
const FIRST_TABLE: RegExp = /FROM "(\w+)"/;

class IncidentWrites extends DatabaseService<Incident> {
  public constructor() {
    super(Incident);
  }
}

class StatusPageWrites extends DatabaseService<StatusPage> {
  public constructor() {
    super(StatusPage);
  }
}

type QueryMock = Mock<
  (sql: string, parameters: Array<unknown>) => Promise<unknown>
>;

// Every statement the delete ran, and each step, in order.
let steps: Array<string>;
let deletedFileIds: Array<string>;
// Files a record's custom field still holds.
let heldFileIds: Set<string>;
let failAttachmentReads: boolean;
// The row deleted, and the files each join table lists for it.
let deletedRowId: string;
let attachments: Record<string, Array<string>>;

const query: () => QueryMock = (): QueryMock => {
  return jest.fn(
    async (sql: string, parameters: Array<unknown>): Promise<unknown> => {
      if (sql.includes(`AS "fileId", f."projectId"::text AS "projectId"`)) {
        const joinTable: string = FIRST_TABLE.exec(sql)![1]!;
        steps.push(`read attachments ${joinTable}`);

        if (failAttachmentReads) {
          throw new Error("canceling statement due to statement timeout");
        }

        expect(parameters).toEqual([[deletedRowId]]);

        return (attachments[joinTable] || []).map((fileId: string) => {
          return { fileId, projectId: PROJECT_ID.toString() };
        });
      }

      // CustomFieldFiles.findHeldFileIds: a record's custom field holds HELD_FILE.
      if (sql.startsWith(`SELECT "candidate" FROM unnest`)) {
        return (parameters[1] as Array<string>)
          .filter((id: string): boolean => {
            return heldFileIds.has(id);
          })
          .map((id: string) => {
            return { candidate: id };
          });
      }

      if (sql.startsWith(`DELETE FROM "File"`)) {
        steps.push("delete files");
        expect(parameters[1]).toBe(PROJECT_ID.toString());
        const ids: Array<string> = parameters[0] as Array<string>;
        deletedFileIds.push(...ids);
        return [
          ids.map((id: string) => {
            return { _id: id };
          }),
          ids.length,
        ];
      }

      // PublishedImages' and the other caches' reads: nothing.
      return [];
    },
  );
};

interface FakeRepository {
  find: Mock<(options: unknown) => Promise<Array<BaseModel>>>;
  delete: Mock<(criteria: unknown) => Promise<{ affected: number }>>;
  manager: {
    query: QueryMock;
    connection: { entityMetadatas: Array<unknown> };
  };
}

function useRepository(
  service: DatabaseService<BaseModel>,
  row: BaseModel,
): FakeRepository {
  const repository: FakeRepository = {
    find: jest.fn(async (): Promise<Array<BaseModel>> => {
      return [row];
    }),
    delete: jest.fn(async (): Promise<{ affected: number }> => {
      steps.push("DELETE");
      return { affected: 1 };
    }),
    manager: {
      query: query(),
      connection: { entityMetadatas: [] },
    },
  };

  getJestSpyOn(service, "getRepository").mockReturnValue(repository as never);
  getJestSpyOn(service, "countBy").mockResolvedValue(
    new PositiveNumber(0) as never,
  );
  getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
    undefined as never,
  );

  return repository;
}

function incidentRow(): Incident {
  const incident: Incident = new Incident();
  incident._id = INCIDENT_ID;
  incident.projectId = PROJECT_ID;
  return incident;
}

function rootProps(): DatabaseCommonInteractionProps {
  return { isRoot: true, tenantId: PROJECT_ID };
}

beforeEach(() => {
  steps = [];
  deletedFileIds = [];
  heldFileIds = new Set<string>([HELD_FILE]);
  failAttachmentReads = false;
  deletedRowId = INCIDENT_ID;
  attachments = {
    IncidentInternalNoteFile: [NOTE_FILE, HELD_FILE],
    IncidentPostmortemAttachmentFile: [POSTMORTEM_FILE],
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each([
  [
    "a person's delete",
    async (service: IncidentWrites): Promise<void> => {
      await service.deleteOneById({
        id: new ObjectID(INCIDENT_ID),
        props: rootProps(),
      });
    },
  ],
  [
    "the retention's hard delete",
    async (service: IncidentWrites): Promise<void> => {
      await service.hardDeleteBy({
        query: { _id: INCIDENT_ID },
        limit: 1,
        skip: 0,
        props: rootProps(),
      });
    },
  ],
])(
  "%s of an incident",
  (_name: string, remove: (service: IncidentWrites) => Promise<void>) => {
    test("reads the files of its notes and postmortem before the DELETE, and deletes them after it", async () => {
      const service: IncidentWrites = new IncidentWrites();
      useRepository(
        service as unknown as DatabaseService<BaseModel>,
        incidentRow(),
      );

      await remove(service);

      const deleteAt: number = steps.indexOf("DELETE");

      expect(deleteAt).toBeGreaterThan(-1);
      expect(
        steps.slice(0, deleteAt).filter((step: string): boolean => {
          return step.startsWith("read attachments");
        }),
      ).toEqual([
        "read attachments IncidentPostmortemAttachmentFile",
        "read attachments IncidentInternalNoteFile",
        "read attachments IncidentPublicNoteFile",
      ]);
      expect(steps.indexOf("delete files")).toBeGreaterThan(deleteAt);
      expect(deletedFileIds.sort()).toEqual(
        [NOTE_FILE, POSTMORTEM_FILE].sort(),
      );
    });

    test("a file something else still holds stays", async () => {
      const service: IncidentWrites = new IncidentWrites();
      useRepository(
        service as unknown as DatabaseService<BaseModel>,
        incidentRow(),
      );

      await remove(service);

      expect(deletedFileIds).not.toContain(HELD_FILE);
    });

    test("with every file held, no file is deleted", async () => {
      heldFileIds = new Set<string>([NOTE_FILE, POSTMORTEM_FILE, HELD_FILE]);
      const service: IncidentWrites = new IncidentWrites();
      useRepository(
        service as unknown as DatabaseService<BaseModel>,
        incidentRow(),
      );

      await remove(service);

      expect(steps).toContain("DELETE");
      expect(steps).not.toContain("delete files");
    });

    test("a read of the attachments that fails leaves them, and the incident is still deleted", async () => {
      failAttachmentReads = true;
      const service: IncidentWrites = new IncidentWrites();
      useRepository(
        service as unknown as DatabaseService<BaseModel>,
        incidentRow(),
      );

      await remove(service);

      expect(steps).toContain("DELETE");
      expect(deletedFileIds).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });
  },
);

/*
 * ISSUE #8895: a scheduled maintenance event's notes' files, a note's own
 * files and an announcement's files went nowhere when it was deleted.
 */
interface RecordWithAttachments {
  name: string;
  model: { new (): BaseModel };
  // The join tables its delete reads, in order, and the files each lists.
  reads: Array<[string, Array<string>]>;
}

const RECORDS_WITH_ATTACHMENTS: Array<RecordWithAttachments> = [
  {
    name: "a scheduled maintenance event",
    model: ScheduledMaintenance as unknown as { new (): BaseModel },
    reads: [
      ["ScheduledMaintenanceInternalNoteFile", [NOTE_FILE, HELD_FILE]],
      ["ScheduledMaintenancePublicNoteFile", [POSTMORTEM_FILE]],
    ],
  },
  {
    name: "a scheduled maintenance event's internal note",
    model: ScheduledMaintenanceInternalNote as unknown as {
      new (): BaseModel;
    },
    reads: [["ScheduledMaintenanceInternalNoteFile", [NOTE_FILE, HELD_FILE]]],
  },
  {
    name: "a scheduled maintenance event's public note",
    model: ScheduledMaintenancePublicNote as unknown as {
      new (): BaseModel;
    },
    reads: [["ScheduledMaintenancePublicNoteFile", [NOTE_FILE, HELD_FILE]]],
  },
  {
    name: "a status page announcement",
    model: StatusPageAnnouncement as unknown as { new (): BaseModel },
    reads: [["StatusPageAnnouncementFile", [NOTE_FILE, HELD_FILE]]],
  },
];

describe.each(RECORDS_WITH_ATTACHMENTS)(
  "deleting $name",
  ({ model, reads }: RecordWithAttachments) => {
    const RECORD_ID: string = "8895bbbb-0000-4000-8000-000000000001";

    // Every file its join tables list, but the one a custom field holds.
    const released: Array<string> = Array.from(
      new Set<string>(
        reads.flatMap(([, files]: [string, Array<string>]) => {
          return files;
        }),
      ),
    ).filter((fileId: string): boolean => {
      return fileId !== HELD_FILE;
    });

    function serviceAndRow(): DatabaseService<BaseModel> {
      const service: DatabaseService<BaseModel> =
        new DatabaseService<BaseModel>(model);
      const row: BaseModel = new model();
      row._id = RECORD_ID;
      row.setColumnValue("projectId", PROJECT_ID);
      useRepository(service, row);
      return service;
    }

    beforeEach(() => {
      deletedRowId = RECORD_ID;
      attachments = Object.fromEntries(reads);
    });

    test.each([
      [
        "a person's delete",
        async (service: DatabaseService<BaseModel>): Promise<void> => {
          await service.deleteOneById({
            id: new ObjectID(RECORD_ID),
            props: rootProps(),
          });
        },
      ],
      [
        "a retention purge's hard delete",
        async (service: DatabaseService<BaseModel>): Promise<void> => {
          await service.hardDeleteBy({
            query: { _id: RECORD_ID },
            limit: 1,
            skip: 0,
            props: rootProps(),
          });
        },
      ],
    ])(
      "%s reads its files before the DELETE and deletes them after it, but the one still held",
      async (
        _path: string,
        remove: (service: DatabaseService<BaseModel>) => Promise<void>,
      ) => {
        await remove(serviceAndRow());

        const deleteAt: number = steps.indexOf("DELETE");

        expect(deleteAt).toBeGreaterThan(-1);
        expect(
          steps.slice(0, deleteAt).filter((step: string): boolean => {
            return step.startsWith("read attachments");
          }),
        ).toEqual(
          reads.map(([joinTable]: [string, Array<string>]): string => {
            return `read attachments ${joinTable}`;
          }),
        );
        expect(steps.indexOf("delete files")).toBeGreaterThan(deleteAt);
        expect(deletedFileIds.sort()).toEqual([...released].sort());
        expect(deletedFileIds).not.toContain(HELD_FILE);
      },
    );

    test("with every file held, no file is deleted", async () => {
      heldFileIds = new Set<string>([NOTE_FILE, POSTMORTEM_FILE, HELD_FILE]);

      await serviceAndRow().deleteOneById({
        id: new ObjectID(RECORD_ID),
        props: rootProps(),
      });

      expect(steps).toContain("DELETE");
      expect(steps).not.toContain("delete files");
    });

    test("a read of its files that fails leaves them, and it is still deleted", async () => {
      failAttachmentReads = true;

      await serviceAndRow().hardDeleteBy({
        query: { _id: RECORD_ID },
        limit: 1,
        skip: 0,
        props: rootProps(),
      });

      expect(steps).toContain("DELETE");
      expect(deletedFileIds).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });
  },
);

describe("a table with no attachments", () => {
  test("reads none and deletes no file", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    const statusPage: StatusPage = new StatusPage();
    statusPage._id = INCIDENT_ID;
    statusPage.projectId = PROJECT_ID;
    useRepository(service as unknown as DatabaseService<BaseModel>, statusPage);

    await service.deleteOneById({
      id: new ObjectID(INCIDENT_ID),
      props: rootProps(),
    });

    expect(steps).toEqual(["DELETE"]);
  });
});
