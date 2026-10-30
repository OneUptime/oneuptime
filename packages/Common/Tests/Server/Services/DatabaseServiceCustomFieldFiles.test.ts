import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import FileService from "../../../Server/Services/FileService";
import { CustomFieldFileMessages } from "../../../Server/Utils/CustomField/CustomFieldFiles";
import { FileOwners } from "../../../Server/Utils/File/FileOwnership";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import BadDataException from "../../../Types/Exception/BadDataException";
import MimeType from "../../../Types/File/MimeType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getJestSpyOn } from "../../Spy";
import { stubReadableParents } from "../TestingUtils/ReadableParents";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * DatabaseService's own write path runs CustomFieldFiles on every create,
 * update and delete of a record with custom fields - root and hook-free
 * writes too. The service here is DatabaseService itself (a status page has
 * custom fields), with no hooks of its own; the repository is an in-memory
 * list of rows, and the statements CustomFieldFiles runs are answered by a
 * small table of files and fields.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const STATUS_PAGE_ID: string = "eeeeeeee-0000-4000-8000-000000000001";

const FILE_1: string = "aaaaaaaa-0000-4000-8000-000000000001";
const FILE_2: string = "aaaaaaaa-0000-4000-8000-000000000002";
const FOREIGN_FILE: string = "bbbbbbbb-0000-4000-8000-000000000001";

const PDF: Uint8Array = new TextEncoder().encode("%PDF-1.7\n");

interface StoredFileRow {
  _id: string;
  name: string;
  fileType: string;
  projectId: string;
  bytes: Uint8Array;
}

class StatusPageWrites extends DatabaseService<StatusPage> {
  public constructor() {
    super(StatusPage);
  }
}

let files: Map<string, StoredFileRow>;
let statements: Array<string>;
let deletedFileIds: Array<string>;

type QueryMock = Mock<
  (sql: string, parameters: Array<unknown>) => Promise<unknown>
>;

// What the statements CustomFieldFiles runs read; anything else reads nothing.
const query: () => QueryMock = (): QueryMock => {
  return jest.fn(
    async (sql: string, parameters: Array<unknown>): Promise<unknown> => {
      statements.push(sql);

      if (sql.startsWith('SELECT "name", "customFieldType" FROM ')) {
        return parameters[0] === PROJECT_ID.toString()
          ? [
              { name: "Contract", customFieldType: CustomFieldType.File },
              {
                name: "Diagrams",
                customFieldType: CustomFieldType.MultipleFiles,
              },
            ]
          : [];
      }

      if (sql.startsWith('SELECT "_id", "name", "fileType", "projectId"')) {
        return (parameters[0] as Array<string>)
          .filter((id: string): boolean => {
            return files.has(id);
          })
          .map((id: string) => {
            const file: StoredFileRow = files.get(id)!;
            return {
              _id: file._id,
              name: file.name,
              fileType: file.fileType,
              projectId: file.projectId,
              size: file.bytes.length,
              head: Buffer.from(file.bytes),
            };
          });
      }

      if (sql.startsWith('DELETE FROM "File"')) {
        const ids: Array<string> = parameters[0] as Array<string>;
        deletedFileIds.push(...ids);
        return [
          ids.map((id: string) => {
            return { _id: id };
          }),
          ids.length,
        ];
      }

      // Who else holds a file, PublishedImages' reads: nothing.
      return [];
    },
  );
};

interface FakeRepository {
  rows: Array<BaseModel>;
  find: Mock<(options: { where?: unknown }) => Promise<Array<BaseModel>>>;
  save: Mock<(entity: unknown) => Promise<unknown>>;
  update: Mock<
    (criteria: unknown, data: unknown) => Promise<{ affected: number }>
  >;
  delete: Mock<(criteria: unknown) => Promise<{ affected: number }>>;
  manager: {
    query: QueryMock;
    connection: { entityMetadatas: Array<unknown> };
  };
}

function useRepository(
  service: DatabaseService<BaseModel>,
  rows: Array<BaseModel> = [],
): FakeRepository {
  const repository: FakeRepository = {
    rows: rows,
    find: jest.fn(async (): Promise<Array<BaseModel>> => {
      return rows;
    }),
    save: jest.fn(async (entity: unknown): Promise<unknown> => {
      return entity;
    }),
    update: jest.fn(async (): Promise<{ affected: number }> => {
      return { affected: 1 };
    }),
    delete: jest.fn(async (): Promise<{ affected: number }> => {
      return { affected: rows.length };
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
  getJestSpyOn(service, "checkRequiredFields").mockImplementation(((
    data: unknown,
  ) => {
    return data;
  }) as never);
  getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(service, "autoOwnerOnCreate").mockResolvedValue(
    undefined as never,
  );

  return repository;
}

function rootProps(): DatabaseCommonInteractionProps {
  return { isRoot: true, tenantId: PROJECT_ID };
}

function storedFile(id: string): JSONObject {
  const file: StoredFileRow = files.get(id)!;

  return {
    fileId: id,
    name: file.name,
    fileType: file.fileType,
    size: file.bytes.length,
  };
}

function statusPageRow(customFields: JSONObject | null): StatusPage {
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = STATUS_PAGE_ID;
  statusPage.projectId = PROJECT_ID;
  statusPage.name = "Status";
  statusPage.customFields = customFields as never;
  return statusPage;
}

async function refusalOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("The write was not refused.");
}

beforeEach(() => {
  statements = [];
  deletedFileIds = [];
  files = new Map<string, StoredFileRow>([
    [
      FILE_1,
      {
        _id: FILE_1,
        name: "contract.pdf",
        fileType: MimeType.pdf,
        projectId: PROJECT_ID.toString(),
        bytes: PDF,
      },
    ],
    [
      FILE_2,
      {
        _id: FILE_2,
        name: "addendum.pdf",
        fileType: MimeType.pdf,
        projectId: PROJECT_ID.toString(),
        bytes: PDF,
      },
    ],
    [
      FOREIGN_FILE,
      {
        _id: FOREIGN_FILE,
        name: "theirs.pdf",
        fileType: MimeType.pdf,
        projectId: OTHER_PROJECT_ID.toString(),
        bytes: PDF,
      },
    ],
  ]);

  jest
    .spyOn(FileService, "getFileOwners")
    .mockResolvedValue(new Map<string, FileOwners>() as never);
  jest
    .spyOn(AuditLogService, "recordCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AuditLogService, "recordUpdate")
    .mockResolvedValue(undefined as never);
  stubReadableParents();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("create", () => {
  test("stores a file field as the file says it is", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    const repository: FakeRepository = useRepository(service);

    const statusPage: StatusPage = new StatusPage();
    statusPage.name = "Status";
    statusPage.customFields = {
      Contract: { _id: FILE_1, name: "renamed.exe" },
      Notes: "kept",
    };

    await service.create({ data: statusPage, props: rootProps() });

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(
      (repository.save.mock.calls[0]![0] as StatusPage).customFields,
    ).toEqual({ Contract: storedFile(FILE_1), Notes: "kept" });
  });

  test("refuses a file of another project, root and hook-free creates too, and saves nothing", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    const repository: FakeRepository = useRepository(service);

    for (const props of [rootProps(), { ...rootProps(), ignoreHooks: true }]) {
      const statusPage: StatusPage = new StatusPage();
      statusPage.name = "Status";
      statusPage.customFields = { Contract: FOREIGN_FILE };

      expect(await refusalOf(service.create({ data: statusPage, props }))).toBe(
        CustomFieldFileMessages.notFound("Contract"),
      );
    }

    expect(repository.save).not.toHaveBeenCalled();
  });

  test("runs no statement for a create whose custom fields name no file", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    useRepository(service);

    const statusPage: StatusPage = new StatusPage();
    statusPage.name = "Status";
    statusPage.customFields = { Notes: "only text" };

    await service.create({ data: statusPage, props: rootProps() });

    expect(
      statements.filter((sql: string): boolean => {
        return (
          sql.indexOf('"File"') !== -1 || sql.indexOf("CustomField") !== -1
        );
      }),
    ).toEqual([]);
  });
});

describe("update", () => {
  test("stores the new file, and deletes the one it replaced once nothing holds it", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    const repository: FakeRepository = useRepository(service, [
      statusPageRow({ Contract: storedFile(FILE_1) }),
    ]);

    await service.updateOneById({
      id: new ObjectID(STATUS_PAGE_ID),
      data: { customFields: { Contract: { fileId: FILE_2 } } } as never,
      props: rootProps(),
    });

    expect(repository.update).toHaveBeenCalledTimes(1);
    expect(
      (repository.update.mock.calls[0]![1] as Record<string, unknown>)[
        "customFields"
      ],
    ).toEqual({ Contract: storedFile(FILE_2) });
    expect(deletedFileIds).toEqual([FILE_1]);
  });

  test("a file the record holds is sent back without being checked again", async () => {
    // Held from before the checks: another project's file.
    const service: StatusPageWrites = new StatusPageWrites();
    const repository: FakeRepository = useRepository(service, [
      statusPageRow({ Contract: storedFile(FOREIGN_FILE) }),
    ]);

    await service.updateOneById({
      id: new ObjectID(STATUS_PAGE_ID),
      data: {
        customFields: {
          Contract: { _id: FOREIGN_FILE },
          Notes: "edited",
        },
      } as never,
      props: rootProps(),
    });

    expect(repository.update).toHaveBeenCalledTimes(1);
    expect(deletedFileIds).toEqual([]);
  });

  test("refuses a new file of another project, and writes nothing", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    const repository: FakeRepository = useRepository(service, [
      statusPageRow({}),
    ]);

    expect(
      await refusalOf(
        service.updateOneById({
          id: new ObjectID(STATUS_PAGE_ID),
          data: { customFields: { Diagrams: [FOREIGN_FILE] } } as never,
          props: rootProps(),
        }),
      ),
    ).toBe(CustomFieldFileMessages.notFound("Diagrams"));

    expect(repository.update).not.toHaveBeenCalled();
    expect(deletedFileIds).toEqual([]);
  });

  test("an update that does not write custom fields never looks at files", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    useRepository(service, [statusPageRow({ Contract: storedFile(FILE_1) })]);

    await service.updateOneById({
      id: new ObjectID(STATUS_PAGE_ID),
      data: { name: "Renamed" } as never,
      props: rootProps(),
    });

    expect(
      statements.filter((sql: string): boolean => {
        return sql.indexOf('"File"') !== -1;
      }),
    ).toEqual([]);
    expect(deletedFileIds).toEqual([]);
  });
});

describe("delete", () => {
  test("deletes the files the record's custom fields held", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    const repository: FakeRepository = useRepository(service, [
      statusPageRow({
        Contract: storedFile(FILE_1),
        Diagrams: [storedFile(FILE_2)],
      }),
    ]);

    await service.deleteOneById({
      id: new ObjectID(STATUS_PAGE_ID),
      props: rootProps(),
    });

    expect(repository.delete).toHaveBeenCalledTimes(1);
    expect(deletedFileIds.sort()).toEqual([FILE_1, FILE_2].sort());
  });

  test("and on a hard delete - a retention purge - too", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    useRepository(service, [statusPageRow({ Contract: storedFile(FILE_1) })]);

    await service.hardDeleteBy({
      query: { _id: STATUS_PAGE_ID } as never,
      limit: 10,
      skip: 0,
      props: rootProps(),
    });

    expect(deletedFileIds).toEqual([FILE_1]);
  });

  test("a record with no files deletes none", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    useRepository(service, [statusPageRow({ Notes: "text" })]);

    await service.deleteOneById({
      id: new ObjectID(STATUS_PAGE_ID),
      props: rootProps(),
    });

    expect(deletedFileIds).toEqual([]);
  });
});
