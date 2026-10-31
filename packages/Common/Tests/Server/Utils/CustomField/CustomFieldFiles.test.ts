import CustomFieldFiles, {
  CustomFieldFileMessages,
  CustomFieldFileQuery,
  FileReferenceColumn,
  PreparedCustomFieldFiles,
} from "../../../../Server/Utils/CustomField/CustomFieldFiles";
import {
  CustomFieldValueStore,
  getCustomFieldValueStores,
} from "../../../../Server/Utils/CustomField/CustomFieldValueStores";
import {
  CUSTOM_FIELD_RECORD_KINDS,
  CustomFieldRecordKind,
} from "../../../../Types/CustomField/CustomFieldRecordKinds";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import MimeType from "../../../../Types/File/MimeType";
import { JSONObject } from "../../../../Types/JSON";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * What a write may put in a File or Multiple files custom field, what is
 * stored, and which files go once nothing holds them. The statements are
 * answered by a small in-memory database that reads each one the way
 * Postgres would for these tables, so every check here is the server's own
 * code on the server's own statements.
 */

const PROJECT: string = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT: string = "22222222-2222-4222-8222-222222222222";

type IdFunction = (n: number) => string;

const fileIdOf: IdFunction = (n: number): string => {
  return `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
};

interface FakeFile {
  _id: string;
  name: string;
  fileType: string;
  projectId: string | null;
  bytes: Uint8Array;
  // Bytes it holds, when not bytes.length (a big file is not built).
  size?: number;
}

interface FakeDefinition {
  projectId: string;
  name: string;
  customFieldType: CustomFieldType;
}

interface FakeRecord {
  projectId: string;
  customFields: JSONObject | null;
}

const PDF_BYTES: Uint8Array = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n");
const PNG_BYTES: Uint8Array = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
const HTML_BYTES: Uint8Array = new TextEncoder().encode(
  "<html><script>alert(1)</script></html>",
);

class FakeDatabase {
  public files: Map<string, FakeFile> = new Map();
  public definitions: Map<string, Array<FakeDefinition>> = new Map();
  public records: Map<string, Array<FakeRecord>> = new Map();
  // Rows of tables that point at files: table -> column -> ids.
  public references: Map<string, Map<string, Array<string>>> = new Map();
  public statements: Array<string> = [];
  public failDeletes: boolean = false;

  public query: CustomFieldFileQuery = async (
    sql: string,
    parameters: Array<unknown>,
  ): Promise<unknown> => {
    this.statements.push(sql);

    if (sql.startsWith('SELECT "name", "customFieldType" FROM ')) {
      const table: string = FakeDatabase.tableAfter(sql, "FROM ");
      const projectId: string = parameters[0] as string;

      return (this.definitions.get(table) || [])
        .filter((definition: FakeDefinition): boolean => {
          return (
            definition.projectId === projectId &&
            (definition.customFieldType === parameters[1] ||
              definition.customFieldType === parameters[2])
          );
        })
        .map((definition: FakeDefinition) => {
          return {
            name: definition.name,
            customFieldType: definition.customFieldType,
          };
        });
    }

    if (sql.startsWith('SELECT "_id", "name", "fileType", "projectId"')) {
      const ids: Array<string> = parameters[0] as Array<string>;

      return ids
        .map((id: string): FakeFile | undefined => {
          return this.files.get(id);
        })
        .filter((file: FakeFile | undefined): file is FakeFile => {
          return Boolean(file);
        })
        .map((file: FakeFile) => {
          return {
            _id: file._id,
            name: file.name,
            fileType: file.fileType,
            projectId: file.projectId,
            size: String(file.size ?? file.bytes.length),
            head: Buffer.from(file.bytes.subarray(0, 8192)),
          };
        });
    }

    if (sql.startsWith('SELECT "candidate" FROM unnest(')) {
      const table: string = FakeDatabase.tableAfter(sql, "SELECT 1 FROM ");
      const projectId: string = parameters[0] as string;
      const candidates: Array<string> = parameters[1] as Array<string>;

      return candidates
        .filter((candidate: string): boolean => {
          return (this.records.get(table) || []).some(
            (record: FakeRecord): boolean => {
              return (
                record.projectId === projectId &&
                record.customFields !== null &&
                JSON.stringify(record.customFields).indexOf(candidate) !== -1
              );
            },
          );
        })
        .map((candidate: string) => {
          return { candidate };
        });
    }

    if (sql.startsWith("SELECT DISTINCT ")) {
      const column: string = FakeDatabase.tableAfter(sql, "SELECT DISTINCT ");
      const table: string = FakeDatabase.tableAfter(sql, " FROM ");
      const ids: Array<string> = parameters[0] as Array<string>;
      const held: Array<string> = this.references.get(table)?.get(column) || [];

      return ids
        .filter((id: string): boolean => {
          return held.includes(id);
        })
        .map((id: string) => {
          return { fileId: id };
        });
    }

    if (sql.startsWith('DELETE FROM "File"')) {
      if (this.failDeletes) {
        throw new Error("connection lost");
      }

      const ids: Array<string> = parameters[0] as Array<string>;
      const projectId: string = parameters[1] as string;
      const deleted: Array<{ _id: string }> = [];

      for (const id of ids) {
        const file: FakeFile | undefined = this.files.get(id);

        if (file && file.projectId === projectId) {
          this.files.delete(id);
          deleted.push({ _id: id });
        }
      }

      // As TypeORM hands back a DELETE ... RETURNING: [rows, count].
      return [deleted, deleted.length];
    }

    throw new Error(`Unexpected statement: ${sql}`);
  };

  // The quoted name that follows a marker in a statement.
  public static tableAfter(sql: string, marker: string): string {
    const start: number = sql.indexOf(marker) + marker.length;
    const open: number = sql.indexOf('"', start);
    const close: number = sql.indexOf('"', open + 1);
    return sql.slice(open + 1, close);
  }

  public addFile(file: Partial<FakeFile> & { n: number }): string {
    const id: string = fileIdOf(file.n);

    this.files.set(id, {
      _id: id,
      name: file.name ?? `file-${file.n}.pdf`,
      fileType: file.fileType ?? MimeType.pdf,
      projectId: file.projectId === undefined ? PROJECT : file.projectId,
      bytes: file.bytes ?? PDF_BYTES,
      ...(file.size !== undefined ? { size: file.size } : {}),
    });

    return id;
  }

  public addField(
    name: string,
    customFieldType: CustomFieldType,
    projectId: string = PROJECT,
    table: string = "IncidentCustomField",
  ): void {
    const list: Array<FakeDefinition> = this.definitions.get(table) || [];
    list.push({ projectId, name, customFieldType });
    this.definitions.set(table, list);
  }
}

let db: FakeDatabase;

beforeEach(() => {
  db = new FakeDatabase();
  db.addField("Contract", CustomFieldType.File);
  db.addField("Screenshots", CustomFieldType.MultipleFiles);
  db.addField("Summary", CustomFieldType.Text);
});

type CreateFunction = (
  customFields: unknown,
  projectId?: string,
) => Promise<PreparedCustomFieldFiles | null>;

const create: CreateFunction = async (
  customFields: unknown,
  projectId: string = PROJECT,
): Promise<PreparedCustomFieldFiles | null> => {
  return await CustomFieldFiles.prepareWrite({
    recordTableName: "Incident",
    customFields: customFields,
    rows: [{ projectId: projectId, customFields: {} }],
    query: db.query,
  });
};

type StoredFunction = (n: number) => JSONObject;

const stored: StoredFunction = (n: number): JSONObject => {
  const file: FakeFile = db.files.get(fileIdOf(n))!;

  return {
    fileId: file._id,
    name: file.name,
    fileType: file.fileType,
    size: file.size ?? file.bytes.length,
  };
};

describe("a write that names no file and holds none", () => {
  test("is left alone, and nothing is read", async () => {
    expect(await create({ Summary: "Disk full" })).toBeNull();
    expect(await create(null)).toBeNull();
    expect(await create({})).toBeNull();
    expect(db.statements).toEqual([]);
  });

  test("a kind of record without custom fields is never looked at", async () => {
    expect(
      await CustomFieldFiles.prepareWrite({
        recordTableName: "Label",
        customFields: { Contract: fileIdOf(1) },
        rows: [{ projectId: PROJECT, customFields: {} }],
        query: db.query,
      }),
    ).toBeNull();
    expect(db.statements).toEqual([]);
  });
});

describe("a File field on create", () => {
  test("stores the file as the file says it is, whatever the write said", async () => {
    const id: string = db.addFile({ n: 1, name: "change-request.pdf" });

    const prepared: PreparedCustomFieldFiles | null = await create({
      Contract: { _id: id, name: "evil.exe", fileType: "text/html", size: 1 },
      Summary: "kept",
    });

    expect(prepared!.customFields).toEqual({
      Contract: {
        fileId: id,
        name: "change-request.pdf",
        fileType: MimeType.pdf,
        size: PDF_BYTES.length,
      },
      Summary: "kept",
    });
    expect(prepared!.releasedFileIds.size).toBe(0);
  });

  test("takes the file's id as text, { fileId } and { id }", async () => {
    const id: string = db.addFile({ n: 1 });

    for (const shape of [id, { fileId: id }, { id: id.toUpperCase() }]) {
      expect(
        (await create({ Contract: shape }))!.customFields!["Contract"],
      ).toEqual(stored(1));
    }
  });

  test("a file of another project, one with no project and one that does not exist read the same", async () => {
    const foreign: string = db.addFile({ n: 1, projectId: OTHER_PROJECT });
    const orphan: string = db.addFile({ n: 2, projectId: null });
    const missing: string = fileIdOf(3);

    for (const id of [foreign, orphan, missing]) {
      await expect(create({ Contract: id })).rejects.toThrow(
        CustomFieldFileMessages.notFound("Contract"),
      );
    }
  });

  test("a file larger than 10 MB is refused, naming it", async () => {
    const id: string = db.addFile({
      n: 1,
      name: "dump.pdf",
      size: 10 * 1024 * 1024 + 1,
    });

    await expect(create({ Contract: id })).rejects.toThrow(
      '"dump.pdf" is larger than 10 MB, the most a file in "Contract" can be.',
    );
  });

  test("exactly 10 MB is taken", async () => {
    const id: string = db.addFile({ n: 1, size: 10 * 1024 * 1024 });

    expect(
      (await create({ Contract: id }))!.customFields!["Contract"],
    ).toBeDefined();
  });

  test("a kind of file the field does not take is refused", async () => {
    const id: string = db.addFile({
      n: 1,
      name: "diagram.svg",
      fileType: MimeType.svg,
      bytes: new TextEncoder().encode("<svg></svg>"),
    });

    await expect(create({ Contract: id })).rejects.toThrow(
      CustomFieldFileMessages.notAccepted({
        field: "Contract",
        file: "diagram.svg",
      }),
    );
  });

  test("a file that does not hold what its type says is refused", async () => {
    const id: string = db.addFile({
      n: 1,
      name: "invoice.pdf",
      bytes: HTML_BYTES,
    });

    await expect(create({ Contract: id })).rejects.toThrow(
      CustomFieldFileMessages.notWhatItSays({
        field: "Contract",
        file: "invoice.pdf",
      }),
    );
  });

  test("a list, or a value that names no file, is refused", async () => {
    const id: string = db.addFile({ n: 1 });

    await expect(create({ Contract: [id] })).rejects.toThrow(
      'holds one file: send the file\'s id, or { "fileId": "<id>" }.',
    );

    // A value naming no file, beside one that does.
    await expect(
      create({ Contract: "contract.pdf", Screenshots: [id] }),
    ).rejects.toThrow('"Contract" holds one file');
  });

  test("an emptied field loses its key", async () => {
    db.addFile({ n: 1 });

    for (const empty of [null, "", []]) {
      const prepared: PreparedCustomFieldFiles | null = await create({
        Contract: empty,
        Screenshots: [fileIdOf(1)],
      });

      expect(
        Object.prototype.hasOwnProperty.call(
          prepared!.customFields,
          "Contract",
        ),
      ).toBe(false);
    }
  });

  test("a field of another kind of record is not this record's file field", async () => {
    // Defined for alerts only.
    db.addField("Runbook", CustomFieldType.File, PROJECT, "AlertCustomField");
    const id: string = db.addFile({ n: 1 });

    const prepared: PreparedCustomFieldFiles | null = await create({
      Runbook: id,
      Contract: id,
    });

    // Text, as far as incidents are concerned.
    expect(prepared!.customFields!["Runbook"]).toBe(id);
    expect(prepared!.customFields!["Contract"]).toEqual(stored(1));
  });

  test("a text field holding an id is left as it is", async () => {
    const id: string = db.addFile({ n: 1 });

    expect((await create({ Summary: id }))!.customFields).toEqual({
      Summary: id,
    });
  });
});

describe("a Multiple files field on create", () => {
  test("stores the files in the order given", async () => {
    db.addFile({
      n: 1,
      name: "b.png",
      fileType: MimeType.png,
      bytes: PNG_BYTES,
    });
    db.addFile({ n: 2, name: "a.pdf" });

    const prepared: PreparedCustomFieldFiles | null = await create({
      Screenshots: [{ _id: fileIdOf(1) }, fileIdOf(2)],
    });

    expect(prepared!.customFields!["Screenshots"]).toEqual([
      stored(1),
      stored(2),
    ]);
  });

  test("one file on its own is a list of one", async () => {
    db.addFile({ n: 1 });

    expect(
      (await create({ Screenshots: { fileId: fileIdOf(1) } }))!.customFields![
        "Screenshots"
      ],
    ).toEqual([stored(1)]);
  });

  test("the same file twice is refused", async () => {
    db.addFile({ n: 1 });

    await expect(
      create({ Screenshots: [fileIdOf(1), fileIdOf(1).toUpperCase()] }),
    ).rejects.toThrow('"Screenshots" lists the same file more than once.');
  });

  test("more than 10 files is refused", async () => {
    const ids: Array<string> = [];

    for (let n: number = 1; n <= 11; n++) {
      ids.push(db.addFile({ n }));
    }

    await expect(create({ Screenshots: ids })).rejects.toThrow(
      '"Screenshots" holds at most 10 files, but was sent 11.',
    );

    expect(
      (
        (await create({ Screenshots: ids.slice(0, 10) }))!.customFields![
          "Screenshots"
        ] as Array<unknown>
      ).length,
    ).toBe(10);
  });

  test("more than 50 MB together is refused, saying how much they come to", async () => {
    const ids: Array<string> = [];

    for (let n: number = 1; n <= 6; n++) {
      ids.push(db.addFile({ n, size: 9 * 1024 * 1024 }));
    }

    await expect(create({ Screenshots: ids })).rejects.toThrow(
      CustomFieldFileMessages.tooMuchInAll({
        field: "Screenshots",
        size: "54 MB",
      }),
    );
  });

  test("an entry that names no file is refused", async () => {
    db.addFile({ n: 1 });

    await expect(
      create({ Screenshots: [fileIdOf(1), "photo.png"] }),
    ).rejects.toThrow('"Screenshots" holds a list of files');
  });

  test("every new file is checked: one bad file refuses the write", async () => {
    db.addFile({ n: 1 });
    db.addFile({ n: 2, projectId: OTHER_PROJECT });

    await expect(
      create({ Screenshots: [fileIdOf(1), fileIdOf(2)] }),
    ).rejects.toThrow(CustomFieldFileMessages.notFound("Screenshots"));
  });
});

describe("an update", () => {
  type UpdateFunction = (data: {
    written: unknown;
    held: JSONObject | null;
    projectId?: string;
  }) => Promise<PreparedCustomFieldFiles | null>;

  const update: UpdateFunction = async (data: {
    written: unknown;
    held: JSONObject | null;
    projectId?: string;
  }): Promise<PreparedCustomFieldFiles | null> => {
    return await CustomFieldFiles.prepareWrite({
      recordTableName: "Incident",
      customFields: data.written,
      rows: [{ projectId: data.projectId || PROJECT, customFields: data.held }],
      query: db.query,
    });
  };

  test("a file the record holds is not checked again, as it was saved before these checks", async () => {
    // A file of another project, saved before files had owners.
    db.addFile({ n: 1, projectId: OTHER_PROJECT });

    const prepared: PreparedCustomFieldFiles | null = await update({
      written: { Contract: { _id: fileIdOf(1) } },
      held: { Contract: stored(1) },
    });

    expect(prepared!.customFields!["Contract"]).toEqual(stored(1));
    expect(prepared!.releasedFileIds.size).toBe(0);
  });

  test("a new file is checked, and the one it replaces is let go of", async () => {
    db.addFile({ n: 1 });
    db.addFile({ n: 2 });

    const prepared: PreparedCustomFieldFiles | null = await update({
      written: { Contract: fileIdOf(2) },
      held: { Contract: stored(1) },
    });

    expect(prepared!.customFields!["Contract"]).toEqual(stored(2));
    expect(Array.from(prepared!.releasedFileIds.get(PROJECT)!)).toEqual([
      fileIdOf(1),
    ]);
  });

  test("a field left out of the bag lets go of its files", async () => {
    db.addFile({ n: 1 });
    db.addFile({ n: 2 });

    const prepared: PreparedCustomFieldFiles | null = await update({
      written: { Summary: "only this" },
      held: { Contract: stored(1), Screenshots: [stored(2)] },
    });

    expect(prepared!.customFields).toEqual({ Summary: "only this" });
    expect(Array.from(prepared!.releasedFileIds.get(PROJECT)!).sort()).toEqual(
      [fileIdOf(1), fileIdOf(2)].sort(),
    );
  });

  test("clearing the whole bag lets go of every file", async () => {
    db.addFile({ n: 1 });

    const prepared: PreparedCustomFieldFiles | null = await update({
      written: null,
      held: { Contract: stored(1) },
    });

    expect(prepared!.customFields).toBeNull();
    expect(Array.from(prepared!.releasedFileIds.get(PROJECT)!)).toEqual([
      fileIdOf(1),
    ]);
  });

  test("a file moved from one field to another is not let go of", async () => {
    db.addFile({ n: 1 });

    const prepared: PreparedCustomFieldFiles | null = await update({
      written: { Screenshots: [fileIdOf(1)] },
      held: { Contract: stored(1) },
    });

    expect(prepared!.customFields!["Screenshots"]).toEqual([stored(1)]);
    expect(prepared!.releasedFileIds.size).toBe(0);
  });

  test("a file taken out of a list is let go of; the others stay, in their new order", async () => {
    db.addFile({ n: 1 });
    db.addFile({ n: 2 });
    db.addFile({ n: 3 });

    const prepared: PreparedCustomFieldFiles | null = await update({
      written: { Screenshots: [fileIdOf(3), fileIdOf(1)] },
      held: { Screenshots: [stored(1), stored(2), stored(3)] },
    });

    expect(prepared!.customFields!["Screenshots"]).toEqual([
      stored(3),
      stored(1),
    ]);
    expect(Array.from(prepared!.releasedFileIds.get(PROJECT)!)).toEqual([
      fileIdOf(2),
    ]);
  });

  test("a file the record held that is gone since is dropped, not stored", async () => {
    db.addFile({ n: 1 });
    const gone: JSONObject = stored(1);
    db.files.delete(fileIdOf(1));
    db.addFile({ n: 2 });

    const prepared: PreparedCustomFieldFiles | null = await update({
      written: { Screenshots: [fileIdOf(1), fileIdOf(2)] },
      held: { Screenshots: [gone] },
    });

    expect(prepared!.customFields!["Screenshots"]).toEqual([stored(2)]);
  });

  test("a write that only lets go of files still reads what it needs", async () => {
    db.addFile({ n: 1 });

    const prepared: PreparedCustomFieldFiles | null = await update({
      written: {},
      held: { Contract: stored(1) },
    });

    expect(prepared!.customFields).toEqual({});
    expect(prepared!.releasedFileIds.get(PROJECT)!.has(fileIdOf(1))).toBe(true);
  });
});

describe("a root write across projects", () => {
  test("is refused when the projects' file fields differ and it names files", async () => {
    db.addFile({ n: 1 });

    await expect(
      CustomFieldFiles.prepareWrite({
        recordTableName: "Incident",
        customFields: { Contract: fileIdOf(1) },
        rows: [
          { projectId: PROJECT, customFields: {} },
          { projectId: OTHER_PROJECT, customFields: {} },
        ],
        query: db.query,
      }),
    ).rejects.toThrow(CustomFieldFileMessages.severalProjects);
  });

  test("checks each new file against each row's own project", async () => {
    db.addField("Contract", CustomFieldType.File, OTHER_PROJECT);
    db.addField("Screenshots", CustomFieldType.MultipleFiles, OTHER_PROJECT);
    db.addField("Summary", CustomFieldType.Text, OTHER_PROJECT);
    db.addFile({ n: 1 });

    await expect(
      CustomFieldFiles.prepareWrite({
        recordTableName: "Incident",
        customFields: { Contract: fileIdOf(1) },
        rows: [
          { projectId: PROJECT, customFields: {} },
          { projectId: OTHER_PROJECT, customFields: {} },
        ],
        query: db.query,
      }),
    ).rejects.toThrow(CustomFieldFileMessages.notFound("Contract"));
  });
});

describe("the files deleted rows let go of", () => {
  test("every file each row holds, by project", () => {
    db.addFile({ n: 1 });
    db.addFile({ n: 2 });
    db.addFile({ n: 3, projectId: OTHER_PROJECT });

    const released: Map<
      string,
      Set<string>
    > = CustomFieldFiles.getReleasedFileIdsOfDeletedRows([
      { projectId: PROJECT, customFields: { Contract: stored(1) } },
      { projectId: PROJECT, customFields: { Screenshots: [stored(2)] } },
      { projectId: OTHER_PROJECT, customFields: { X: [stored(3)] } },
      { projectId: PROJECT, customFields: { Summary: fileIdOf(9) } },
      { projectId: PROJECT, customFields: null },
      { projectId: null, customFields: { Contract: stored(1) } },
    ]);

    expect(Array.from(released.get(PROJECT)!).sort()).toEqual(
      [fileIdOf(1), fileIdOf(2)].sort(),
    );
    expect(Array.from(released.get(OTHER_PROJECT)!)).toEqual([fileIdOf(3)]);
  });
});

describe("deleting the files nothing holds", () => {
  const references: Array<FileReferenceColumn> = [
    { tableName: "StatusPage", columnName: "logoFileId" },
    { tableName: "IncidentInternalNoteFile", columnName: "fileId" },
  ];

  test("deletes a file no record and no column holds", async () => {
    db.addFile({ n: 1 });

    expect(
      await CustomFieldFiles.deleteUnheldFiles({
        releasedFileIds: new Map([[PROJECT, new Set([fileIdOf(1)])]]),
        fileReferenceColumns: references,
        query: db.query,
      }),
    ).toBe(1);
    expect(db.files.has(fileIdOf(1))).toBe(false);
  });

  test("keeps a file another record of the project holds in a custom field", async () => {
    db.addFile({ n: 1 });
    db.records.set("IncidentTemplate", [
      { projectId: PROJECT, customFields: { Contract: stored(1) } },
    ]);

    expect(
      await CustomFieldFiles.deleteUnheldFiles({
        releasedFileIds: new Map([[PROJECT, new Set([fileIdOf(1)])]]),
        fileReferenceColumns: references,
        query: db.query,
      }),
    ).toBe(0);
    expect(db.files.has(fileIdOf(1))).toBe(true);
  });

  test("a record of another project holding it does not keep it", async () => {
    db.addFile({ n: 1 });
    db.records.set("Incident", [
      { projectId: OTHER_PROJECT, customFields: { Contract: stored(1) } },
    ]);

    expect(
      await CustomFieldFiles.deleteUnheldFiles({
        releasedFileIds: new Map([[PROJECT, new Set([fileIdOf(1)])]]),
        fileReferenceColumns: references,
        query: db.query,
      }),
    ).toBe(1);
  });

  test("keeps a file a column points at: a logo, a note's attachment", async () => {
    db.addFile({ n: 1 });
    db.addFile({ n: 2 });
    db.references.set("StatusPage", new Map([["logoFileId", [fileIdOf(1)]]]));
    db.references.set(
      "IncidentInternalNoteFile",
      new Map([["fileId", [fileIdOf(2)]]]),
    );

    expect(
      await CustomFieldFiles.deleteUnheldFiles({
        releasedFileIds: new Map([
          [PROJECT, new Set([fileIdOf(1), fileIdOf(2)])],
        ]),
        fileReferenceColumns: references,
        query: db.query,
      }),
    ).toBe(0);
    expect(db.files.size).toBe(2);
  });

  test("never deletes a file of another project", async () => {
    db.addFile({ n: 1, projectId: OTHER_PROJECT });

    expect(
      await CustomFieldFiles.deleteUnheldFiles({
        releasedFileIds: new Map([[PROJECT, new Set([fileIdOf(1)])]]),
        fileReferenceColumns: [],
        query: db.query,
      }),
    ).toBe(0);
    expect(db.files.has(fileIdOf(1))).toBe(true);
  });

  test("asks every kind of record that holds custom fields", async () => {
    db.addFile({ n: 1 });

    await CustomFieldFiles.deleteUnheldFiles({
      releasedFileIds: new Map([[PROJECT, new Set([fileIdOf(1)])]]),
      fileReferenceColumns: [],
      query: db.query,
    });

    const asked: Set<string> = new Set(
      db.statements
        .filter((sql: string): boolean => {
          return sql.startsWith('SELECT "candidate"');
        })
        .map((sql: string): string => {
          return FakeDatabase.tableAfter(sql, "SELECT 1 FROM ");
        }),
    );

    expect(Array.from(asked).sort()).toEqual(
      Array.from(
        new Set(
          CUSTOM_FIELD_RECORD_KINDS.map(
            (kind: CustomFieldRecordKind): string => {
              return kind.recordTableName;
            },
          ),
        ),
      ).sort(),
    );
  });

  test("a failure is logged, never thrown", async () => {
    db.addFile({ n: 1 });
    db.failDeletes = true;

    await expect(
      CustomFieldFiles.deleteUnheldFiles({
        releasedFileIds: new Map([[PROJECT, new Set([fileIdOf(1)])]]),
        fileReferenceColumns: [],
        query: db.query,
      }),
    ).resolves.toBe(0);
  });

  test("ids that are not ids are never sent", async () => {
    await CustomFieldFiles.deleteUnheldFiles({
      releasedFileIds: new Map([
        [PROJECT, new Set(["' OR 1=1 --"])],
        ["not-a-project", new Set([fileIdOf(1)])],
      ]),
      fileReferenceColumns: [],
      query: db.query,
    });

    expect(db.statements).toEqual([]);
  });
});

describe("the columns that point at files", () => {
  test("are read from the entity metadata: relations to one file and join tables of several", () => {
    const file: { tableName: string } = { tableName: "File" };

    expect(
      CustomFieldFiles.getFileReferenceColumns([
        {
          tableName: "StatusPage",
          relations: [
            {
              inverseEntityMetadata: file,
              isManyToOne: true,
              joinColumns: [{ databaseName: "logoFileId" }],
            },
            {
              inverseEntityMetadata: { tableName: "Project" },
              isManyToOne: true,
              joinColumns: [{ databaseName: "projectId" }],
            },
          ],
        },
        {
          tableName: "IncidentInternalNote",
          relations: [
            {
              inverseEntityMetadata: file,
              isManyToManyOwner: true,
              joinColumns: [],
              junctionEntityMetadata: {
                tableName: "IncidentInternalNoteFile",
                inverseColumns: [{ databaseName: "fileId" }],
              },
            },
          ],
        },
        {
          // The same relation seen twice is one column.
          tableName: "StatusPage",
          relations: [
            {
              inverseEntityMetadata: file,
              isOneToOneOwner: true,
              joinColumns: [{ databaseName: "logoFileId" }],
            },
          ],
        },
      ]),
    ).toEqual([
      { tableName: "StatusPage", columnName: "logoFileId" },
      { tableName: "IncidentInternalNoteFile", columnName: "fileId" },
    ]);
  });

  test("a relation that does not own its column points at nothing", () => {
    expect(
      CustomFieldFiles.getFileReferenceColumns([
        {
          tableName: "File",
          relations: [
            {
              inverseEntityMetadata: { tableName: "File" },
              joinColumns: [],
            },
          ],
        },
      ]),
    ).toEqual([]);
  });
});

describe("the kinds of record CustomFieldFiles looks after", () => {
  test("agree with the server's stores of custom field values", () => {
    const fromStores: Map<string, string> = new Map<string, string>();

    for (const store of getCustomFieldValueStores()) {
      for (const service of store.getValueServices()) {
        fromStores.set(
          service.getModel().tableName || "",
          (store as CustomFieldValueStore).definitionTableName,
        );
      }
    }

    for (const kind of CUSTOM_FIELD_RECORD_KINDS) {
      expect(fromStores.get(kind.recordTableName)).toBe(
        kind.definitionTableName,
      );
    }

    expect(fromStores.size).toBe(CUSTOM_FIELD_RECORD_KINDS.length);
  });
});

describe("mayNameFiles and holdsFiles", () => {
  test("an id, an object naming one, or a list holding either might name a file", () => {
    expect(CustomFieldFiles.mayNameFiles({ a: fileIdOf(1) })).toBe(true);
    expect(CustomFieldFiles.mayNameFiles({ a: { _id: fileIdOf(1) } })).toBe(
      true,
    );
    expect(CustomFieldFiles.mayNameFiles({ a: ["x", fileIdOf(1)] })).toBe(true);
    expect(CustomFieldFiles.mayNameFiles({ a: "x", b: 3, c: true })).toBe(
      false,
    );
    expect(CustomFieldFiles.mayNameFiles(null)).toBe(false);
    expect(CustomFieldFiles.mayNameFiles([fileIdOf(1)])).toBe(false);
  });

  test("only a stored reference is a held file", () => {
    db.addFile({ n: 1 });

    expect(CustomFieldFiles.holdsFiles({ a: stored(1) })).toBe(true);
    expect(CustomFieldFiles.holdsFiles({ a: [stored(1)] })).toBe(true);
    expect(CustomFieldFiles.holdsFiles({ a: fileIdOf(1) })).toBe(false);
    expect(CustomFieldFiles.holdsFiles({ a: { _id: fileIdOf(1) } })).toBe(
      false,
    );
    expect(CustomFieldFiles.holdsFiles(undefined)).toBe(false);
  });
});
