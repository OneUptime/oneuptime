import DatabaseService from "../../../../Server/Services/DatabaseService";
import FileService, {
  ProjectImageFacts,
} from "../../../../Server/Services/FileService";
import ColumnPermissions from "../../../../Server/Types/Database/Permissions/ColumnPermission";
import RecordAttachments from "../../../../Server/Utils/File/RecordAttachments";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentFeed from "../../../../Models/DatabaseModels/IncidentFeed";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import Columns from "../../../../Types/Database/Columns";
import NotAuthenticatedException from "../../../../Types/Exception/NotAuthenticatedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import MimeType from "../../../../Types/File/MimeType";
import {
  AttachmentLeftOutReason,
  ATTACHMENTS_MAX_COUNT,
  ATTACHMENTS_MAX_REFERENCES,
  RecordAttachmentsResult,
} from "../../../../Types/File/RecordAttachments";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
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
 * How RecordAttachments decides what a caller is handed (#11477), with the
 * data layer stubbed so each decision can be watched: the record is read as
 * the caller, only the lists of files and custom fields they may read are
 * read - the lists as ids alone - only the project's file custom fields are
 * looked in, the files are looked up among the record's project's alone and
 * checked again, and bytes are read only for what is handed out. Through the
 * runner, against Postgres:
 * App/Tests/FeatureSet/Workflow/RunWorkflowGetAttachmentsFromRecordPostgres.
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

const PDF: Buffer = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");
const PNG: Buffer = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);
const SVG: Buffer = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

const idOf: (index: number) => string = (index: number): string => {
  return `dddddddd-0000-4000-8000-${String(index).padStart(12, "0")}`;
};

const facts: (data: {
  index: number;
  name: string;
  fileType: string;
  bytes: Buffer;
  projectId?: ObjectID;
  sizeInBytes?: number;
}) => ProjectImageFacts = (data: {
  index: number;
  name: string;
  fileType: string;
  bytes: Buffer;
  projectId?: ObjectID;
  sizeInBytes?: number;
}): ProjectImageFacts => {
  return {
    fileId: new ObjectID(idOf(data.index)),
    name: data.name,
    fileType: data.fileType,
    sizeInBytes: data.sizeInBytes ?? data.bytes.length,
    head: new Uint8Array(data.bytes),
    projectId: data.projectId || PROJECT_ID,
    createdByUserId: null,
    isPublic: false,
  };
};

// What a workflow of the project that may read the record reads with.
const workflowProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return {
      tenantId: PROJECT_ID,
      userType: UserType.Workflow,
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          projectId: PROJECT_ID,
          permissions: [
            {
              permission: Permission.ProjectAdmin,
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
  fileCustomFields?: Array<string>;
}) => FakeService = (data: {
  model: BaseModel;
  values: JSONObject | null;
  fileCustomFields?: Array<string>;
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

            return (data.fileCustomFields || []).map((name: string) => {
              return { name };
            });
          },
        },
      };
    },
  } as unknown as DatabaseService<BaseModel>;

  return { service, reads, queries };
};

describe("RecordAttachments.readRecordAttachments", () => {
  let lookups: Array<{ fileIds: Array<string>; projectId: string }>;
  let byteReads: Array<{ fileIds: Array<string>; projectId: string }>;
  let stored: Map<string, ProjectImageFacts>;
  let bytes: Map<string, Buffer>;

  const store: (file: ProjectImageFacts, content: Buffer) => void = (
    file: ProjectImageFacts,
    content: Buffer,
  ): void => {
    stored.set(file.fileId.toString(), file);
    bytes.set(file.fileId.toString(), content);
  };

  beforeEach(() => {
    lookups = [];
    byteReads = [];
    stored = new Map();
    bytes = new Map();

    jest
      .spyOn(FileService, "getProjectFilesById")
      .mockImplementation(
        async (data: {
          fileIds: Array<ObjectID | string>;
          projectId: ObjectID;
        }) => {
          const ids: Array<string> = data.fileIds.map(
            (id: ObjectID | string): string => {
              return id.toString();
            },
          );

          lookups.push({ fileIds: ids, projectId: data.projectId.toString() });

          return new Map(
            ids
              .filter((id: string): boolean => {
                return stored.has(id);
              })
              .map((id: string): [string, ProjectImageFacts] => {
                return [id, stored.get(id)!];
              }),
          );
        },
      );

    jest
      .spyOn(FileService, "getProjectFileBytes")
      .mockImplementation(
        async (data: { fileIds: Array<ObjectID>; projectId: ObjectID }) => {
          const ids: Array<string> = data.fileIds.map(
            (id: ObjectID): string => {
              return id.toString();
            },
          );

          byteReads.push({
            fileIds: ids,
            projectId: data.projectId.toString(),
          });

          return new Map(
            ids
              .filter((id: string): boolean => {
                return bytes.has(id);
              })
              .map((id: string): [string, Buffer] => {
                return [id, bytes.get(id)!];
              }),
          );
        },
      );

    jest
      .spyOn(ColumnPermissions, "getModelColumnsByPermissions")
      .mockReturnValue(
        new Columns([
          ...new IncidentInternalNote().getTableColumns().columns,
          ...new Incident().getTableColumns().columns,
        ]),
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a note's attachments, whole, in the order it holds them, with names, types and content ids", async () => {
    const pdf: ProjectImageFacts = facts({
      index: 1,
      name: "change-request.pdf",
      fileType: MimeType.pdf,
      bytes: PDF,
    });
    const png: ProjectImageFacts = facts({
      index: 2,
      name: "graph.png",
      fileType: MimeType.png,
      bytes: PNG,
    });

    store(pdf, PDF);
    store(png, PNG);

    const fake: FakeService = fakeService({
      model: new IncidentInternalNote(),
      values: {
        projectId: PROJECT_ID,
        attachments: [{ _id: idOf(1) }, { _id: idOf(2) }],
      },
    });

    const result: RecordAttachmentsResult =
      await RecordAttachments.readRecordAttachments({
        service: fake.service,
        recordId: RECORD_ID,
        props: workflowProps(),
      });

    expect(result).toEqual({
      files: [
        {
          name: "change-request.pdf",
          mimeType: MimeType.pdf,
          sizeInBytes: PDF.length,
          base64: PDF.toString("base64"),
          contentId: RecordAttachments.getContentId(idOf(1)),
          fields: ["attachments"],
        },
        {
          name: "graph.png",
          mimeType: MimeType.png,
          sizeInBytes: PNG.length,
          base64: PNG.toString("base64"),
          contentId: RecordAttachments.getContentId(idOf(2)),
          fields: ["attachments"],
        },
      ],
      leftOut: [],
    });
  });

  test("reads the record as the caller, its lists as ids alone, in its project", async () => {
    const fake: FakeService = fakeService({
      model: new IncidentInternalNote(),
      values: { projectId: PROJECT_ID, attachments: [] },
    });
    const props: DatabaseCommonInteractionProps = workflowProps();

    await RecordAttachments.readRecordAttachments({
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
      attachments: { _id: true },
    });
  });

  test("an incident's postmortem attachments, then its file custom fields, in the order the project made them", async () => {
    store(
      facts({
        index: 1,
        name: "postmortem.pdf",
        fileType: MimeType.pdf,
        bytes: PDF,
      }),
      PDF,
    );
    store(
      facts({
        index: 2,
        name: "signed.pdf",
        fileType: MimeType.pdf,
        bytes: PDF,
      }),
      PDF,
    );
    store(
      facts({ index: 3, name: "rack.png", fileType: MimeType.png, bytes: PNG }),
      PNG,
    );

    const fake: FakeService = fakeService({
      model: new Incident(),
      values: {
        projectId: PROJECT_ID,
        postmortemAttachments: [{ _id: idOf(1) }],
        customFields: {
          "Signed change request": {
            fileId: idOf(2),
            name: "signed.pdf",
            fileType: MimeType.pdf,
            size: PDF.length,
          },
          Photos: [
            {
              fileId: idOf(3),
              name: "rack.png",
              fileType: MimeType.png,
              size: 12,
            },
          ],
          // A Text field holding an id is no file field.
          "Ticket link": idOf(1),
        },
      },
      fileCustomFields: ["Signed change request", "Photos"],
    });

    const result: RecordAttachmentsResult =
      await RecordAttachments.readRecordAttachments({
        service: fake.service,
        recordId: RECORD_ID,
        props: workflowProps(),
      });

    expect(
      result.files.map((file: { name: string; fields: Array<string> }) => {
        return [file.name, file.fields];
      }),
    ).toEqual([
      ["postmortem.pdf", ["postmortemAttachments"]],
      ["signed.pdf", ["Signed change request"]],
      ["rack.png", ["Photos"]],
    ]);

    // The project's file fields, asked once, File and Multiple files, in the order made.
    expect(fake.queries).toHaveLength(1);
    expect(fake.queries[0]!.sql).toContain('ORDER BY "createdAt" ASC');
    expect(fake.queries[0]!.parameters).toEqual([
      PROJECT_ID.toString(),
      CustomFieldType.File,
      CustomFieldType.MultipleFiles,
    ]);
  });

  test("a file held twice is one file, naming both places", async () => {
    store(
      facts({ index: 1, name: "plan.pdf", fileType: MimeType.pdf, bytes: PDF }),
      PDF,
    );

    const fake: FakeService = fakeService({
      model: new Incident(),
      values: {
        projectId: PROJECT_ID,
        postmortemAttachments: [
          { _id: idOf(1) },
          { _id: idOf(1).toUpperCase() },
        ],
        customFields: {
          Plan: {
            fileId: idOf(1),
            name: "plan.pdf",
            fileType: MimeType.pdf,
            size: 9,
          },
        },
      },
      fileCustomFields: ["Plan"],
    });

    const result: RecordAttachmentsResult =
      await RecordAttachments.readRecordAttachments({
        service: fake.service,
        recordId: RECORD_ID,
        props: workflowProps(),
      });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.fields).toEqual(["postmortemAttachments", "Plan"]);
  });

  test("only the columns the caller may read are read: no list, no custom fields", async () => {
    jest.restoreAllMocks();
    jest
      .spyOn(ColumnPermissions, "getModelColumnsByPermissions")
      .mockReturnValue(new Columns(["_id", "projectId", "title"]));
    const lookup: ReturnType<typeof jest.spyOn> = jest.spyOn(
      FileService,
      "getProjectFilesById",
    );

    const fake: FakeService = fakeService({
      model: new Incident(),
      values: {
        projectId: PROJECT_ID,
        postmortemAttachments: [{ _id: idOf(1) }],
        customFields: { Plan: { fileId: idOf(1) } },
      },
      fileCustomFields: ["Plan"],
    });

    const result: RecordAttachmentsResult =
      await RecordAttachments.readRecordAttachments({
        service: fake.service,
        recordId: RECORD_ID,
        props: workflowProps(),
      });

    expect(fake.reads[0]!["select"]).toEqual({ _id: true, projectId: true });
    expect(fake.queries).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
    expect(result).toEqual({ files: [], leftOut: [] });
  });

  test("a file of another project, a deleted one and an id of none read alike: not found, no name", async () => {
    store(
      facts({
        index: 1,
        name: "theirs.pdf",
        fileType: MimeType.pdf,
        bytes: PDF,
        projectId: OTHER_PROJECT_ID,
      }),
      PDF,
    );

    const fake: FakeService = fakeService({
      model: new IncidentInternalNote(),
      values: {
        projectId: PROJECT_ID,
        attachments: [{ _id: idOf(1) }, { _id: idOf(2) }],
      },
    });

    const result: RecordAttachmentsResult =
      await RecordAttachments.readRecordAttachments({
        service: fake.service,
        recordId: RECORD_ID,
        props: workflowProps(),
      });

    expect(result.files).toEqual([]);
    expect(result.leftOut).toEqual([
      expect.objectContaining({
        name: null,
        reason: AttachmentLeftOutReason.NotFound,
      }),
      expect.objectContaining({
        name: null,
        reason: AttachmentLeftOutReason.NotFound,
      }),
    ]);
    // Looked up among the record's project's files alone.
    expect(lookups[0]!.projectId).toBe(PROJECT_ID.toString());
    // No bytes read for nothing.
    expect(byteReads).toEqual([]);
  });

  test("an SVG, and a page stored as a PDF, are left out, by name; their bytes never read", async () => {
    store(
      facts({
        index: 1,
        name: "diagram.svg",
        fileType: MimeType.svg,
        bytes: SVG,
      }),
      SVG,
    );
    store(
      facts({
        index: 2,
        name: "not-a.pdf",
        fileType: MimeType.pdf,
        bytes: Buffer.from("<!doctype html><script></script>"),
      }),
      Buffer.from("x"),
    );
    store(
      facts({ index: 3, name: "fine.pdf", fileType: MimeType.pdf, bytes: PDF }),
      PDF,
    );

    const fake: FakeService = fakeService({
      model: new IncidentInternalNote(),
      values: {
        projectId: PROJECT_ID,
        attachments: [{ _id: idOf(1) }, { _id: idOf(2) }, { _id: idOf(3) }],
      },
    });

    const result: RecordAttachmentsResult =
      await RecordAttachments.readRecordAttachments({
        service: fake.service,
        recordId: RECORD_ID,
        props: workflowProps(),
      });

    expect(
      result.files.map((file: { name: string }): string => {
        return file.name;
      }),
    ).toEqual(["fine.pdf"]);
    expect(
      result.leftOut.map((left: { name: string | null; reason: string }) => {
        return [left.name, left.reason];
      }),
    ).toEqual([
      ["diagram.svg", AttachmentLeftOutReason.NotAllowed],
      ["not-a.pdf", AttachmentLeftOutReason.NotAllowed],
    ]);
    expect(byteReads).toEqual([
      { fileIds: [idOf(3)], projectId: PROJECT_ID.toString() },
    ]);
  });

  test("past twenty files, the rest are too many; past a hundred, the rest are not looked up", async () => {
    const attachments: Array<JSONObject> = [];

    for (
      let index: number = 1;
      index <= ATTACHMENTS_MAX_REFERENCES + 5;
      index++
    ) {
      store(
        facts({
          index: index,
          name: `file-${index}.pdf`,
          fileType: MimeType.pdf,
          bytes: PDF,
        }),
        PDF,
      );
      attachments.push({ _id: idOf(index) });
    }

    const fake: FakeService = fakeService({
      model: new IncidentInternalNote(),
      values: { projectId: PROJECT_ID, attachments: attachments },
    });

    const result: RecordAttachmentsResult =
      await RecordAttachments.readRecordAttachments({
        service: fake.service,
        recordId: RECORD_ID,
        props: workflowProps(),
      });

    expect(result.files).toHaveLength(ATTACHMENTS_MAX_COUNT);
    expect(lookups[0]!.fileIds).toHaveLength(ATTACHMENTS_MAX_REFERENCES);
    expect(
      result.leftOut.filter((left: { reason: string }): boolean => {
        return left.reason === AttachmentLeftOutReason.TooMany;
      }),
    ).toHaveLength(ATTACHMENTS_MAX_REFERENCES + 5 - ATTACHMENTS_MAX_COUNT);
    // The five never looked up have no name.
    expect(result.leftOut.slice(-5)).toEqual(
      new Array(5).fill(
        expect.objectContaining({
          name: null,
          reason: AttachmentLeftOutReason.TooMany,
        }),
      ),
    );
  });

  test("a file deleted between the two reads is left out as not found", async () => {
    store(
      facts({ index: 1, name: "gone.pdf", fileType: MimeType.pdf, bytes: PDF }),
      PDF,
    );
    bytes.delete(idOf(1));

    const fake: FakeService = fakeService({
      model: new IncidentInternalNote(),
      values: { projectId: PROJECT_ID, attachments: [{ _id: idOf(1) }] },
    });

    const result: RecordAttachmentsResult =
      await RecordAttachments.readRecordAttachments({
        service: fake.service,
        recordId: RECORD_ID,
        props: workflowProps(),
      });

    expect(result.files).toEqual([]);
    expect(result.leftOut[0]!.reason).toBe(AttachmentLeftOutReason.NotFound);
  });

  test("a record that is not there for the caller is not found", async () => {
    const fake: FakeService = fakeService({
      model: new IncidentInternalNote(),
      values: null,
    });

    await expect(
      RecordAttachments.readRecordAttachments({
        service: fake.service,
        recordId: RECORD_ID,
        props: workflowProps(),
      }),
    ).rejects.toThrow(NotFoundException);
  });

  test("a kind of record that holds no files is not found, and never read", async () => {
    const fake: FakeService = fakeService({
      model: new IncidentFeed(),
      values: { projectId: PROJECT_ID },
    });

    await expect(
      RecordAttachments.readRecordAttachments({
        service: fake.service,
        recordId: RECORD_ID,
        props: workflowProps(),
      }),
    ).rejects.toThrow(NotFoundException);
    expect(fake.reads).toEqual([]);
  });

  test("nobody signed in is refused before anything is read", async () => {
    const fake: FakeService = fakeService({
      model: new IncidentInternalNote(),
      values: { projectId: PROJECT_ID, attachments: [] },
    });

    await expect(
      RecordAttachments.readRecordAttachments({
        service: fake.service,
        recordId: RECORD_ID,
        props: {},
      }),
    ).rejects.toThrow(NotAuthenticatedException);
    expect(fake.reads).toEqual([]);
  });

  test("the content id is the same for the same file, and never its id", () => {
    const first: string = RecordAttachments.getContentId(idOf(1));

    expect(first).toMatch(/^attachment-[0-9a-f]{24}$/);
    expect(RecordAttachments.getContentId(idOf(1).toUpperCase())).toBe(first);
    expect(RecordAttachments.getContentId(idOf(2))).not.toBe(first);
    expect(first).not.toContain(idOf(1).replace(/-/g, "").slice(0, 12));
  });
});
