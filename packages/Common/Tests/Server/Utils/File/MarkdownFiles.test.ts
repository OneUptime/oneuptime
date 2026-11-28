import DatabaseService from "../../../../Server/Services/DatabaseService";
import FileService, {
  ProjectImageFacts,
} from "../../../../Server/Services/FileService";
import ColumnPermissions from "../../../../Server/Types/Database/Permissions/ColumnPermission";
import MarkdownFiles from "../../../../Server/Utils/File/MarkdownFiles";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import User from "../../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import Columns from "../../../../Types/Database/Columns";
import NotAuthenticatedException from "../../../../Types/Exception/NotAuthenticatedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import {
  MarkdownFile,
  MarkdownFileLeftOut,
  MarkdownFileLeftOutReason,
  MarkdownFilesResult,
} from "../../../../Types/File/MarkdownFiles";
import MimeType from "../../../../Types/File/MimeType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * How MarkdownFiles decides what a caller is handed (#11256), with the data
 * layer stubbed so each decision can be watched: the record is read as the
 * caller and nobody else, only the Markdown columns the caller may read are
 * read, the custom fields only when they may read them and only the
 * Markdown ones, the files are looked up among the record's project's alone
 * and checked again, and bytes are read only for what is handed out. The
 * same rules over HTTP, on Postgres: Tests/Server/API/MarkdownFilesPostgres.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "bbbbbbbb-0000-4000-8000-000000000001",
);
const RECORD_ID: ObjectID = new ObjectID(
  "cccccccc-0000-4000-8000-000000000001",
);

const PNG: Buffer = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);
const JPEG: Buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);

const tokenOf: (letter: string) => string = (letter: string): string => {
  return letter.repeat(64);
};

const urlOf: (token: string) => string = (token: string): string => {
  return `https://oneuptime.example.com/file/image/access-token/${token}`;
};

const image: (letter: string) => string = (letter: string): string => {
  return `![${letter}](${urlOf(tokenOf(letter))})`;
};

const facts: (data: {
  letter: string;
  name: string;
  fileType: string;
  bytes: Buffer;
  projectId?: ObjectID;
}) => ProjectImageFacts = (data: {
  letter: string;
  name: string;
  fileType: string;
  bytes: Buffer;
  projectId?: ObjectID;
}): ProjectImageFacts => {
  return {
    fileId: new ObjectID(`dddddddd-0000-4000-8000-00000000000${data.letter}`),
    name: data.name,
    fileType: data.fileType,
    sizeInBytes: data.bytes.length,
    head: new Uint8Array(data.bytes),
    projectId: data.projectId || PROJECT_ID,
    createdByUserId: null,
    isPublic: false,
  };
};

// What an API key of the project that may read incidents reads with.
const apiKeyProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return {
      tenantId: PROJECT_ID,
      userType: UserType.API,
      userGlobalAccessPermission: {
        projectIds: [PROJECT_ID],
        globalPermissions: [Permission.Public, Permission.AuthenticatedRequest],
        _type: "UserGlobalAccessPermission",
      },
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          projectId: PROJECT_ID,
          permissions: [
            {
              permission: Permission.ReadProjectIncident,
              labelIds: [],
              isBlockPermission: false,
              _type: "UserPermission",
            },
          ],
          isBlockPermission: false,
          _type: "UserTenantAccessPermission",
        } as never,
      },
    };
  };

interface FakeService {
  service: DatabaseService<BaseModel>;
  reads: Array<JSONObject>;
  queries: Array<{ sql: string; parameters: Array<unknown> }>;
}

// A service of `model` whose one record holds `values`, or none.
const fakeService: (data: {
  model: BaseModel;
  values: JSONObject | null;
  markdownCustomFields?: Array<string>;
}) => FakeService = (data: {
  model: BaseModel;
  values: JSONObject | null;
  markdownCustomFields?: Array<string>;
}): FakeService => {
  const reads: Array<JSONObject> = [];
  const queries: Array<{ sql: string; parameters: Array<unknown> }> = [];
  const modelType: { new (): BaseModel } = data.model.constructor as {
    new (): BaseModel;
  };

  const service: DatabaseService<BaseModel> = {
    modelType: modelType,
    getModel: (): BaseModel => {
      return new modelType();
    },
    findOneBy: async (read: JSONObject): Promise<BaseModel | null> => {
      reads.push(read);

      if (!data.values) {
        return null;
      }

      const record: BaseModel = new modelType();

      for (const [key, value] of Object.entries(data.values)) {
        // Only what was selected comes back, as from the database.
        if ((read["select"] as JSONObject)[key]) {
          record.setValue(key, value as never);
        }
      }

      return record;
    },
    getRepository: () => {
      return {
        manager: {
          query: async (
            sql: string,
            parameters: Array<unknown>,
          ): Promise<unknown> => {
            queries.push({ sql, parameters });

            return (data.markdownCustomFields || []).map((name: string) => {
              return { name };
            });
          },
        },
      };
    },
  } as unknown as DatabaseService<BaseModel>;

  return { service, reads, queries };
};

describe("MarkdownFiles.readRecordFiles", () => {
  let lookups: Array<{ tokens: Array<string>; projectId: ObjectID }>;
  let byteReads: Array<{ fileIds: Array<ObjectID>; projectId: ObjectID }>;
  let stored: Map<string, ProjectImageFacts>;
  let bytes: Map<string, Buffer>;

  beforeEach(() => {
    lookups = [];
    byteReads = [];
    stored = new Map();
    bytes = new Map();

    jest
      .spyOn(FileService, "getProjectImagesByToken")
      .mockImplementation(
        async (data: { tokens: Array<string>; projectId: ObjectID }) => {
          lookups.push(data);

          return new Map(
            data.tokens
              .filter((token: string): boolean => {
                return stored.has(token);
              })
              .map((token: string): [string, ProjectImageFacts] => {
                return [token, stored.get(token)!];
              }),
          );
        },
      );

    jest
      .spyOn(FileService, "getProjectFileBytes")
      .mockImplementation(
        async (data: { fileIds: Array<ObjectID>; projectId: ObjectID }) => {
          byteReads.push(data);

          return new Map(
            data.fileIds
              .filter((fileId: ObjectID): boolean => {
                return bytes.has(fileId.toString());
              })
              .map((fileId: ObjectID): [string, Buffer] => {
                return [fileId.toString(), bytes.get(fileId.toString())!];
              }),
          );
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const store: (data: {
    letter: string;
    name: string;
    fileType: string;
    bytes: Buffer;
    projectId?: ObjectID;
    keepBytes?: boolean;
  }) => void = (data: {
    letter: string;
    name: string;
    fileType: string;
    bytes: Buffer;
    projectId?: ObjectID;
    keepBytes?: boolean;
  }): void => {
    const image: ProjectImageFacts = facts(data);
    stored.set(tokenOf(data.letter), image);

    if (data.keepBytes !== false) {
      bytes.set(image.fileId.toString(), data.bytes);
    }
  };

  test("reads the record as the caller, by its id in the caller's project, selecting only its Markdown", async () => {
    const fake: FakeService = fakeService({
      model: new Incident(),
      values: { projectId: PROJECT_ID, description: "No images." },
    });

    const props: DatabaseCommonInteractionProps = apiKeyProps();

    await MarkdownFiles.readRecordFiles({
      service: fake.service,
      recordId: RECORD_ID,
      props: props,
    });

    expect(fake.reads).toHaveLength(1);
    expect(fake.reads[0]!["props"]).toBe(props);
    expect(fake.reads[0]!["query"]).toEqual({
      _id: RECORD_ID.toString(),
      projectId: PROJECT_ID,
    });
    expect(fake.reads[0]!["select"]).toEqual({
      _id: true,
      projectId: true,
      description: true,
      rootCause: true,
      postmortemNote: true,
      remediationNotes: true,
      customFields: true,
    });
  });

  test("a Markdown column the caller may not read is not read, and its images are never looked up", async () => {
    const readable: Array<string> = new Incident()
      .getTableColumns()
      .columns.filter((column: string): boolean => {
        return column !== "postmortemNote" && column !== "customFields";
      });

    jest
      .spyOn(ColumnPermissions, "getModelColumnsByPermissions")
      .mockReturnValue(new Columns(readable));

    store({ letter: "a", name: "a.png", fileType: MimeType.png, bytes: PNG });
    store({ letter: "b", name: "b.png", fileType: MimeType.png, bytes: PNG });
    store({ letter: "c", name: "c.png", fileType: MimeType.png, bytes: PNG });

    const fake: FakeService = fakeService({
      model: new Incident(),
      values: {
        projectId: PROJECT_ID,
        description: image("a"),
        postmortemNote: image("b"),
        customFields: { "Customer impact": image("c") },
      },
      markdownCustomFields: ["Customer impact"],
    });

    const result: MarkdownFilesResult = await MarkdownFiles.readRecordFiles({
      service: fake.service,
      recordId: RECORD_ID,
      props: apiKeyProps(),
    });

    const select: JSONObject = fake.reads[0]!["select"] as JSONObject;

    expect(select["postmortemNote"]).toBeUndefined();
    expect(select["customFields"]).toBeUndefined();
    expect(fake.queries).toEqual([]);
    expect(
      lookups.map((lookup: { tokens: Array<string> }) => {
        return lookup.tokens;
      }),
    ).toEqual([[tokenOf("a")]]);
    expect(
      result.files.map((file: MarkdownFile) => {
        return file.name;
      }),
    ).toEqual(["a.png"]);
    expect(result.leftOut).toEqual([]);
  });

  test("only the project's Markdown custom fields are read, by the record's project", async () => {
    store({ letter: "a", name: "a.png", fileType: MimeType.png, bytes: PNG });
    store({ letter: "b", name: "b.png", fileType: MimeType.png, bytes: PNG });

    const fake: FakeService = fakeService({
      model: new Incident(),
      values: {
        projectId: PROJECT_ID,
        customFields: {
          "Customer impact": image("a"),
          "Ticket link": image("b"),
          Count: 4,
        },
      },
      markdownCustomFields: ["Customer impact"],
    });

    const result: MarkdownFilesResult = await MarkdownFiles.readRecordFiles({
      service: fake.service,
      recordId: RECORD_ID,
      props: apiKeyProps(),
    });

    expect(fake.queries).toHaveLength(1);
    expect(fake.queries[0]!.sql).toContain('FROM "IncidentCustomField"');
    expect(fake.queries[0]!.parameters).toEqual([
      PROJECT_ID.toString(),
      CustomFieldType.Markdown,
    ]);
    expect(
      result.files.map((file: MarkdownFile) => {
        return [file.name, file.fields];
      }),
    ).toEqual([["a.png", ["Customer impact"]]]);
    expect(
      lookups.map((lookup: { tokens: Array<string> }) => {
        return lookup.tokens;
      }),
    ).toEqual([[tokenOf("a")]]);
  });

  test("files are looked up among the record's project's alone, and bytes read only for what is handed out", async () => {
    store({ letter: "a", name: "a.png", fileType: MimeType.png, bytes: PNG });
    store({
      letter: "b",
      name: "b.svg",
      fileType: MimeType.svg,
      bytes: Buffer.from("<svg></svg>"),
    });

    const fake: FakeService = fakeService({
      model: new Incident(),
      values: {
        projectId: PROJECT_ID,
        description: `${image("a")} ${image("b")}`,
      },
    });

    const result: MarkdownFilesResult = await MarkdownFiles.readRecordFiles({
      service: fake.service,
      recordId: RECORD_ID,
      props: apiKeyProps(),
    });

    expect(lookups).toHaveLength(1);
    expect(lookups[0]!.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(byteReads).toHaveLength(1);
    expect(byteReads[0]!.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(
      byteReads[0]!.fileIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([stored.get(tokenOf("a"))!.fileId.toString()]);
    expect(
      result.leftOut.map((entry: MarkdownFileLeftOut) => {
        return [entry.name, entry.reason];
      }),
    ).toEqual([["b.svg", MarkdownFileLeftOutReason.NotAPicture]]);
  });

  test("an image another project's file answered for is still not handed out", async () => {
    // As if a lookup ever answered with a file of another project.
    store({
      letter: "a",
      name: "theirs.png",
      fileType: MimeType.png,
      bytes: PNG,
      projectId: OTHER_PROJECT_ID,
    });

    const fake: FakeService = fakeService({
      model: new Incident(),
      values: { projectId: PROJECT_ID, description: image("a") },
    });

    const result: MarkdownFilesResult = await MarkdownFiles.readRecordFiles({
      service: fake.service,
      recordId: RECORD_ID,
      props: apiKeyProps(),
    });

    expect(result.files).toEqual([]);
    expect(result.leftOut).toEqual([
      expect.objectContaining({
        name: null,
        reason: MarkdownFileLeftOutReason.NotFound,
      }),
    ]);
    expect(byteReads).toEqual([]);
  });

  test("a caller whose permissions are for another project reads no Markdown of this one", async () => {
    store({ letter: "a", name: "a.png", fileType: MimeType.png, bytes: PNG });

    const props: DatabaseCommonInteractionProps = apiKeyProps();
    props.userTenantAccessPermission = {
      [OTHER_PROJECT_ID.toString()]: (
        apiKeyProps().userTenantAccessPermission as JSONObject
      )[PROJECT_ID.toString()] as never,
    };

    const fake: FakeService = fakeService({
      model: new Incident(),
      values: { projectId: PROJECT_ID, description: image("a") },
    });

    const result: MarkdownFilesResult = await MarkdownFiles.readRecordFiles({
      service: fake.service,
      recordId: RECORD_ID,
      props: props,
    });

    expect(
      (fake.reads[0]!["select"] as JSONObject)["description"],
    ).toBeUndefined();
    expect(result).toEqual({ files: [], leftOut: [] });
    expect(lookups).toEqual([]);
  });

  test("and were its columns readable, the file check would still see none of this project's files", async () => {
    jest
      .spyOn(ColumnPermissions, "getModelColumnsByPermissions")
      .mockReturnValue(new Columns(new Incident().getTableColumns().columns));

    store({ letter: "a", name: "a.png", fileType: MimeType.png, bytes: PNG });

    const props: DatabaseCommonInteractionProps = apiKeyProps();
    props.userTenantAccessPermission = {
      [OTHER_PROJECT_ID.toString()]: (
        apiKeyProps().userTenantAccessPermission as JSONObject
      )[PROJECT_ID.toString()] as never,
    };

    const fake: FakeService = fakeService({
      model: new Incident(),
      values: { projectId: PROJECT_ID, description: image("a") },
    });

    const result: MarkdownFilesResult = await MarkdownFiles.readRecordFiles({
      service: fake.service,
      recordId: RECORD_ID,
      props: props,
    });

    expect(result.files).toEqual([]);
    expect(result.leftOut[0]!.reason).toBe(MarkdownFileLeftOutReason.NotFound);
  });

  test("a file deleted between the two reads is left out as not found", async () => {
    store({
      letter: "a",
      name: "a.png",
      fileType: MimeType.png,
      bytes: PNG,
      keepBytes: false,
    });

    const fake: FakeService = fakeService({
      model: new Incident(),
      values: { projectId: PROJECT_ID, description: image("a") },
    });

    const result: MarkdownFilesResult = await MarkdownFiles.readRecordFiles({
      service: fake.service,
      recordId: RECORD_ID,
      props: apiKeyProps(),
    });

    expect(result.files).toEqual([]);
    expect(result.leftOut).toEqual([
      expect.objectContaining({
        name: null,
        reason: MarkdownFileLeftOutReason.NotFound,
        urls: [urlOf(tokenOf("a"))],
        fields: ["description"],
      }),
    ]);
  });

  test("a picture stored under an older name of its type is handed out as the type it is", async () => {
    store({
      letter: "a",
      name: "photo.jpg",
      fileType: "image/jpg",
      bytes: JPEG,
    });

    const fake: FakeService = fakeService({
      model: new Incident(),
      values: { projectId: PROJECT_ID, description: image("a") },
    });

    const result: MarkdownFilesResult = await MarkdownFiles.readRecordFiles({
      service: fake.service,
      recordId: RECORD_ID,
      props: apiKeyProps(),
    });

    expect(result.files[0]!.mimeType).toBe(MimeType.jpeg);
    expect(Buffer.from(result.files[0]!.base64, "base64").equals(JPEG)).toBe(
      true,
    );
  });

  test("anonymous: refused before anything is read", async () => {
    const fake: FakeService = fakeService({
      model: new Incident(),
      values: { projectId: PROJECT_ID, description: image("a") },
    });

    await expect(
      MarkdownFiles.readRecordFiles({
        service: fake.service,
        recordId: RECORD_ID,
        props: {},
      }),
    ).rejects.toBeInstanceOf(NotAuthenticatedException);

    expect(fake.reads).toEqual([]);
    expect(lookups).toEqual([]);
  });

  test("a record that is not there for the caller is not found, by its model's name", async () => {
    const fake: FakeService = fakeService({
      model: new IncidentPublicNote(),
      values: null,
    });

    await expect(
      MarkdownFiles.readRecordFiles({
        service: fake.service,
        recordId: RECORD_ID,
        props: apiKeyProps(),
      }),
    ).rejects.toEqual(new NotFoundException("Incident Public Note not found."));

    expect(lookups).toEqual([]);
  });

  test("a model whose records show no files in Markdown is answered as not found, unread", async () => {
    const fake: FakeService = fakeService({
      model: new User(),
      values: { name: "Someone" },
    });

    await expect(
      MarkdownFiles.readRecordFiles({
        service: fake.service,
        recordId: RECORD_ID,
        props: apiKeyProps(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(fake.reads).toEqual([]);
  });

  test("OneUptime itself reads every Markdown column, and is not held to a project in the query", async () => {
    const spy: jest.SpyInstance<any, any> = getJestSpyOn(
      ColumnPermissions,
      "getModelColumnsByPermissions",
    );

    const fake: FakeService = fakeService({
      model: new Incident(),
      values: { projectId: PROJECT_ID, description: "Nothing" },
    });

    await MarkdownFiles.readRecordFiles({
      service: fake.service,
      recordId: RECORD_ID,
      props: { isRoot: true },
    });

    expect(spy).not.toHaveBeenCalled();
    expect(fake.reads[0]!["query"]).toEqual({ _id: RECORD_ID.toString() });
    expect((fake.reads[0]!["select"] as JSONObject)["postmortemNote"]).toBe(
      true,
    );
  });
});

describe("MarkdownFiles.getContentId", () => {
  test("the same for the same token, different for another, and never the token itself", () => {
    const first: string = MarkdownFiles.getContentId(tokenOf("a"));

    expect(first).toMatch(/^image-[0-9a-f]{24}$/);
    expect(MarkdownFiles.getContentId(tokenOf("a"))).toBe(first);
    expect(MarkdownFiles.getContentId(tokenOf("b"))).not.toBe(first);
    expect(tokenOf("a")).not.toContain(first.slice("image-".length));
  });
});
