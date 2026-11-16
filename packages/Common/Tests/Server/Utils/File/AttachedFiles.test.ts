import AttachedFiles, {
  ATTACHMENT_SOURCES,
  AttachedFilesQuery,
  AttachmentSource,
  getAttachedFilesSql,
  hasAttachedFiles,
} from "../../../../Server/Utils/File/AttachedFiles";
import logger from "../../../../Server/Utils/Logger";
import "../../../../Models/DatabaseModels/Index";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";
import { getMetadataArgsStorage } from "typeorm";
import { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import { TableMetadataArgs } from "typeorm/metadata-args/TableMetadataArgs";

/*
 * THE FILES ATTACHED TO WHAT A DELETE TAKES (issues #6944, #8895): a note's
 * attachments, an incident's postmortem attachments and a status page
 * announcement's attachments outlived the incident, alert, episode,
 * scheduled maintenance event or announcement deleted with them, in the
 * database the retention exists to shrink. What is pinned here:
 *
 *   - the registry is the models' own: every join table of the models that
 *     lists Files is in it - an incident's, an alert's, an episode's, a
 *     scheduled maintenance event's, one of their notes', an
 *     announcement's - each note reached through the column its record's
 *     delete cascades along, and nothing else is;
 *   - the statements name only registry tables and bind every id;
 *   - the files are read by the project each was uploaded in, a failing
 *     read is logged and leaves its files, and nothing is read for a table
 *     with no attachments.
 *
 * DatabaseServiceAttachedFiles.test drives both delete paths over this;
 * ResolvedRecordRetentionPostgres.test and AttachedFilesPostgres.test run it
 * against a real database.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

// The first table a statement reads from.
const FIRST_TABLE: RegExp = /FROM "(\w+)"/;

const RECORD_TABLES: Array<string> = [
  "Incident",
  "Alert",
  "IncidentEpisode",
  "AlertEpisode",
  "ScheduledMaintenance",
  "StatusPageAnnouncement",
];

const NOTE_TABLES: Record<string, { record: string; column: string }> = {
  IncidentInternalNote: { record: "Incident", column: "incidentId" },
  IncidentPublicNote: { record: "Incident", column: "incidentId" },
  IncidentEpisodeInternalNote: {
    record: "IncidentEpisode",
    column: "incidentEpisodeId",
  },
  IncidentEpisodePublicNote: {
    record: "IncidentEpisode",
    column: "incidentEpisodeId",
  },
  AlertInternalNote: { record: "Alert", column: "alertId" },
  AlertEpisodeInternalNote: {
    record: "AlertEpisode",
    column: "alertEpisodeId",
  },
  ScheduledMaintenanceInternalNote: {
    record: "ScheduledMaintenance",
    column: "scheduledMaintenanceId",
  },
  ScheduledMaintenancePublicNote: {
    record: "ScheduledMaintenance",
    column: "scheduledMaintenanceId",
  },
};

// Every join table of the models that lists Files.
const FILE_JOIN_TABLES: Array<string> = [
  "AlertEpisodeInternalNoteFile",
  "AlertInternalNoteFile",
  "IncidentEpisodeInternalNoteFile",
  "IncidentEpisodePublicNoteFile",
  "IncidentInternalNoteFile",
  "IncidentPostmortemAttachmentFile",
  "IncidentPublicNoteFile",
  "ScheduledMaintenanceInternalNoteFile",
  "ScheduledMaintenancePublicNoteFile",
  "StatusPageAnnouncementFile",
];

// The table name of an entity class, as TypeORM's metadata holds it.
function tableOf(target: unknown): string {
  const table: TableMetadataArgs | undefined =
    getMetadataArgsStorage().tables.find((args: TableMetadataArgs) => {
      return args.target === target;
    });

  return table?.name || "";
}

// Every join table of the models that lists Files, with its owner and its owner's column.
function fileJoinTables(): Array<{
  owner: string;
  joinTable: string;
  joinColumn: string;
}> {
  const storage: ReturnType<typeof getMetadataArgsStorage> =
    getMetadataArgsStorage();

  return storage.relations
    .filter((relation: RelationMetadataArgs): boolean => {
      if (relation.relationType !== "many-to-many") {
        return false;
      }

      const type: unknown =
        typeof relation.type === "function"
          ? (relation.type as () => unknown)()
          : relation.type;

      return tableOf(type) === "File";
    })
    .map((relation: RelationMetadataArgs) => {
      const join: JoinTableMetadataArgs | undefined = storage.joinTables.find(
        (args: JoinTableMetadataArgs) => {
          return (
            args.target === relation.target &&
            args.propertyName === relation.propertyName
          );
        },
      );

      const joinColumns: unknown = join?.joinColumns;
      const firstJoinColumn: { name?: string } | undefined = Array.isArray(
        joinColumns,
      )
        ? (joinColumns[0] as { name?: string })
        : (joinColumns as { name?: string } | undefined);

      return {
        owner: tableOf(relation.target),
        joinTable: join?.name || "",
        joinColumn: firstJoinColumn?.name || "",
      };
    });
}

describe("the registry is the models' own", () => {
  /*
   * Every one, not only those of the records already here: a join table
   * that lists Files and is not released by its owner's delete leaves its
   * files behind for good (#8895 found three). A model that gains one fails
   * this until it is added to ATTACHMENT_SOURCES.
   */
  test("every File join table of the models is released by its own delete", () => {
    const joins: Array<{
      owner: string;
      joinTable: string;
      joinColumn: string;
    }> = fileJoinTables();

    expect(
      joins
        .map((join: { joinTable: string }): string => {
          return join.joinTable;
        })
        .sort(),
    ).toEqual([...FILE_JOIN_TABLES].sort());

    for (const join of joins) {
      expect([...RECORD_TABLES, ...Object.keys(NOTE_TABLES)]).toContain(
        join.owner,
      );
      expect(ATTACHMENT_SOURCES).toContainEqual({
        parentTable: join.owner,
        joinTable: join.joinTable,
        joinColumn: join.joinColumn,
      });
    }
  });

  // #8895: deleting one of these left its files in the database.
  test.each([
    [
      "ScheduledMaintenanceInternalNote",
      "ScheduledMaintenanceInternalNoteFile",
      "scheduledMaintenanceInternalNoteId",
    ],
    [
      "ScheduledMaintenancePublicNote",
      "ScheduledMaintenancePublicNoteFile",
      "scheduledMaintenancePublicNoteId",
    ],
    [
      "StatusPageAnnouncement",
      "StatusPageAnnouncementFile",
      "statusPageAnnouncementId",
    ],
  ])(
    "%s releases the files %s lists",
    (parentTable: string, joinTable: string, joinColumn: string) => {
      expect(ATTACHMENT_SOURCES).toContainEqual({
        parentTable,
        joinTable,
        joinColumn,
      });
      expect(hasAttachedFiles(parentTable)).toBe(true);
    },
  );

  test("a scheduled maintenance event releases its notes' files, through the notes", () => {
    expect(
      ATTACHMENT_SOURCES.filter((source: AttachmentSource): boolean => {
        return source.parentTable === "ScheduledMaintenance";
      }),
    ).toEqual([
      {
        parentTable: "ScheduledMaintenance",
        joinTable: "ScheduledMaintenanceInternalNoteFile",
        joinColumn: "scheduledMaintenanceInternalNoteId",
        through: {
          table: "ScheduledMaintenanceInternalNote",
          foreignKey: "scheduledMaintenanceId",
        },
      },
      {
        parentTable: "ScheduledMaintenance",
        joinTable: "ScheduledMaintenancePublicNoteFile",
        joinColumn: "scheduledMaintenancePublicNoteId",
        through: {
          table: "ScheduledMaintenancePublicNote",
          foreignKey: "scheduledMaintenanceId",
        },
      },
    ]);
  });

  // An announcement has no notes: its files are its own.
  test("an announcement releases only its own join table's files", () => {
    expect(
      ATTACHMENT_SOURCES.filter((source: AttachmentSource): boolean => {
        return source.parentTable === "StatusPageAnnouncement";
      }),
    ).toEqual([
      {
        parentTable: "StatusPageAnnouncement",
        joinTable: "StatusPageAnnouncementFile",
        joinColumn: "statusPageAnnouncementId",
      },
    ]);
  });

  test("no source is listed twice", () => {
    const keys: Array<string> = ATTACHMENT_SOURCES.map(
      (source: AttachmentSource): string => {
        return JSON.stringify(source);
      },
    );

    expect(new Set(keys).size).toBe(keys.length);
  });

  test("a note's files are released by its record's delete too, through the column the cascade follows", () => {
    for (const [noteTable, { record, column }] of Object.entries(NOTE_TABLES)) {
      const direct: AttachmentSource | undefined = ATTACHMENT_SOURCES.find(
        (source: AttachmentSource): boolean => {
          return source.parentTable === noteTable;
        },
      );

      expect(direct).toBeDefined();
      expect(ATTACHMENT_SOURCES).toContainEqual({
        parentTable: record,
        joinTable: direct!.joinTable,
        joinColumn: direct!.joinColumn,
        through: { table: noteTable, foreignKey: column },
      });

      // The note's own column that names its record, deleted with it.
      const relation: RelationMetadataArgs | undefined =
        getMetadataArgsStorage().relations.find(
          (candidate: RelationMetadataArgs): boolean => {
            return (
              tableOf(candidate.target) === noteTable &&
              candidate.relationType === "many-to-one" &&
              tableOf(
                typeof candidate.type === "function"
                  ? (candidate.type as () => unknown)()
                  : candidate.type,
              ) === record
            );
          },
        );

      expect(relation?.options.onDelete).toBe("CASCADE");
    }
  });

  test("only the records with attachments and their notes release files here", () => {
    for (const source of ATTACHMENT_SOURCES) {
      expect([...RECORD_TABLES, ...Object.keys(NOTE_TABLES)]).toContain(
        source.parentTable,
      );
    }

    /*
     * A status page's logo, a user's picture, what a template holds: never
     * released by these deletes.
     */
    expect(hasAttachedFiles("StatusPage")).toBe(false);
    expect(hasAttachedFiles("User")).toBe(false);
    expect(hasAttachedFiles("File")).toBe(false);
    expect(hasAttachedFiles("ScheduledMaintenanceTemplate")).toBe(false);
    expect(hasAttachedFiles("StatusPageAnnouncementTemplate")).toBe(false);
    expect(hasAttachedFiles("Monitor")).toBe(false);
    expect(hasAttachedFiles(undefined)).toBe(false);

    for (const table of [...RECORD_TABLES, ...Object.keys(NOTE_TABLES)]) {
      expect(hasAttachedFiles(table)).toBe(true);
    }
  });
});

describe("the statements", () => {
  test("a record's own attachments: its join table, the file's project, the ids bound", () => {
    expect(
      getAttachedFilesSql({
        parentTable: "Incident",
        joinTable: "IncidentPostmortemAttachmentFile",
        joinColumn: "incidentId",
      }),
    ).toBe(
      `SELECT DISTINCT j."fileId"::text AS "fileId", f."projectId"::text AS "projectId" FROM "IncidentPostmortemAttachmentFile" j JOIN "File" f ON f."_id" = j."fileId" WHERE j."incidentId" = ANY($1::uuid[]) AND f."projectId" IS NOT NULL`,
    );
  });

  test("a note's attachments, through the notes of the records deleted", () => {
    expect(
      getAttachedFilesSql({
        parentTable: "Alert",
        joinTable: "AlertInternalNoteFile",
        joinColumn: "alertInternalNoteId",
        through: { table: "AlertInternalNote", foreignKey: "alertId" },
      }),
    ).toBe(
      `SELECT DISTINCT j."fileId"::text AS "fileId", f."projectId"::text AS "projectId" FROM "AlertInternalNoteFile" j JOIN "AlertInternalNote" n ON n."_id" = j."alertInternalNoteId" JOIN "File" f ON f."_id" = j."fileId" WHERE n."alertId" = ANY($1::uuid[]) AND f."projectId" IS NOT NULL`,
    );
  });

  test("a name is quoted, a quote in it doubled", () => {
    expect(
      getAttachedFilesSql({
        parentTable: "X",
        joinTable: 'Odd"Table',
        joinColumn: "c",
      }),
    ).toContain(`FROM "Odd""Table" j`);
  });
});

describe("readFilesOfRowsDeleted", () => {
  const PROJECT_A: string = "6944a000-0000-4000-8000-000000000001";
  const PROJECT_B: string = "6944b000-0000-4000-8000-000000000002";
  const FILE_1: string = "6944f000-0000-4000-8000-000000000001";
  const FILE_2: string = "6944f000-0000-4000-8000-000000000002";
  const FILE_3: string = "6944f000-0000-4000-8000-000000000003";
  const INCIDENT: string = "6944c000-0000-4000-8000-000000000001";

  test("reads each source of the table, once, with the ids, and groups the files by project", async () => {
    const calls: Array<{ sql: string; parameters: Array<unknown> }> = [];

    const released: Map<
      string,
      Set<string>
    > = await AttachedFiles.readFilesOfRowsDeleted({
      tableName: "Incident",
      ids: [INCIDENT.toUpperCase(), "not-an-id"],
      query: async (
        sql: string,
        parameters: Array<unknown>,
      ): Promise<unknown> => {
        calls.push({ sql, parameters });

        if (sql.includes(`FROM "IncidentPostmortemAttachmentFile"`)) {
          return [{ fileId: FILE_1, projectId: PROJECT_A }];
        }

        if (sql.includes(`FROM "IncidentInternalNoteFile"`)) {
          return [
            { fileId: FILE_2.toUpperCase(), projectId: PROJECT_A },
            { fileId: FILE_3, projectId: PROJECT_B },
            { fileId: "x", projectId: PROJECT_A },
            { fileId: FILE_1, projectId: null },
          ];
        }

        return [];
      },
    });

    expect(
      calls.map((call: { sql: string }): string => {
        return FIRST_TABLE.exec(call.sql)![1]!;
      }),
    ).toEqual([
      "IncidentPostmortemAttachmentFile",
      "IncidentInternalNoteFile",
      "IncidentPublicNoteFile",
    ]);

    for (const call of calls) {
      expect(call.parameters).toEqual([[INCIDENT]]);
    }

    expect(released).toEqual(
      new Map([
        [PROJECT_A, new Set([FILE_1, FILE_2])],
        [PROJECT_B, new Set([FILE_3])],
      ]),
    );
  });

  test("an episode reads its notes' files only", async () => {
    const tables: Array<string> = [];

    await AttachedFiles.readFilesOfRowsDeleted({
      tableName: "IncidentEpisode",
      ids: [INCIDENT],
      query: async (sql: string): Promise<unknown> => {
        tables.push(FIRST_TABLE.exec(sql)![1]!);
        return [];
      },
    });

    expect(tables).toEqual([
      "IncidentEpisodeInternalNoteFile",
      "IncidentEpisodePublicNoteFile",
    ]);
  });

  test("a note deleted on its own reads its own join table", async () => {
    const statements: Array<string> = [];

    await AttachedFiles.readFilesOfRowsDeleted({
      tableName: "AlertEpisodeInternalNote",
      ids: [INCIDENT],
      query: async (sql: string): Promise<unknown> => {
        statements.push(sql);
        return [];
      },
    });

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain(
      `FROM "AlertEpisodeInternalNoteFile" j JOIN "File" f`,
    );
    expect(statements[0]).toContain(`j."alertEpisodeInternalNoteId" = ANY`);
  });

  // #8895.
  test("a scheduled maintenance event reads its internal and public notes' files, through its notes", async () => {
    const calls: Array<{ sql: string; parameters: Array<unknown> }> = [];

    const released: Map<
      string,
      Set<string>
    > = await AttachedFiles.readFilesOfRowsDeleted({
      tableName: "ScheduledMaintenance",
      ids: [INCIDENT],
      query: async (
        sql: string,
        parameters: Array<unknown>,
      ): Promise<unknown> => {
        calls.push({ sql, parameters });

        if (sql.includes(`FROM "ScheduledMaintenanceInternalNoteFile"`)) {
          return [{ fileId: FILE_1, projectId: PROJECT_A }];
        }

        return [{ fileId: FILE_2, projectId: PROJECT_A }];
      },
    });

    expect(
      calls.map((call: { sql: string }): string => {
        return call.sql;
      }),
    ).toEqual([
      `SELECT DISTINCT j."fileId"::text AS "fileId", f."projectId"::text AS "projectId" FROM "ScheduledMaintenanceInternalNoteFile" j JOIN "ScheduledMaintenanceInternalNote" n ON n."_id" = j."scheduledMaintenanceInternalNoteId" JOIN "File" f ON f."_id" = j."fileId" WHERE n."scheduledMaintenanceId" = ANY($1::uuid[]) AND f."projectId" IS NOT NULL`,
      `SELECT DISTINCT j."fileId"::text AS "fileId", f."projectId"::text AS "projectId" FROM "ScheduledMaintenancePublicNoteFile" j JOIN "ScheduledMaintenancePublicNote" n ON n."_id" = j."scheduledMaintenancePublicNoteId" JOIN "File" f ON f."_id" = j."fileId" WHERE n."scheduledMaintenanceId" = ANY($1::uuid[]) AND f."projectId" IS NOT NULL`,
    ]);

    for (const call of calls) {
      expect(call.parameters).toEqual([[INCIDENT]]);
    }

    expect(released).toEqual(new Map([[PROJECT_A, new Set([FILE_1, FILE_2])]]));
  });

  test.each([
    [
      "ScheduledMaintenanceInternalNote",
      "ScheduledMaintenanceInternalNoteFile",
      "scheduledMaintenanceInternalNoteId",
    ],
    [
      "ScheduledMaintenancePublicNote",
      "ScheduledMaintenancePublicNoteFile",
      "scheduledMaintenancePublicNoteId",
    ],
    [
      "StatusPageAnnouncement",
      "StatusPageAnnouncementFile",
      "statusPageAnnouncementId",
    ],
  ])(
    "a %s deleted reads its own join table, %s, by %s",
    async (tableName: string, joinTable: string, joinColumn: string) => {
      const calls: Array<{ sql: string; parameters: Array<unknown> }> = [];

      const released: Map<
        string,
        Set<string>
      > = await AttachedFiles.readFilesOfRowsDeleted({
        tableName,
        ids: [INCIDENT],
        query: async (
          sql: string,
          parameters: Array<unknown>,
        ): Promise<unknown> => {
          calls.push({ sql, parameters });
          return [{ fileId: FILE_3, projectId: PROJECT_B }];
        },
      });

      expect(calls).toEqual([
        {
          sql: `SELECT DISTINCT j."fileId"::text AS "fileId", f."projectId"::text AS "projectId" FROM "${joinTable}" j JOIN "File" f ON f."_id" = j."fileId" WHERE j."${joinColumn}" = ANY($1::uuid[]) AND f."projectId" IS NOT NULL`,
          parameters: [[INCIDENT]],
        },
      ]);
      expect(released).toEqual(new Map([[PROJECT_B, new Set([FILE_3])]]));
    },
  );

  test("no valid id, or a table with no attachments, reads nothing", async () => {
    // jest-mock's Mock, the type @jest/globals' jest.fn returns.
    const query: Mock<AttachedFilesQuery> = jest.fn<AttachedFilesQuery>(
      async (): Promise<unknown> => {
        return [];
      },
    );

    expect(
      (
        await AttachedFiles.readFilesOfRowsDeleted({
          tableName: "Incident",
          ids: ["nope"],
          query,
        })
      ).size,
    ).toBe(0);
    expect(
      (
        await AttachedFiles.readFilesOfRowsDeleted({
          tableName: "StatusPage",
          ids: [INCIDENT],
          query,
        })
      ).size,
    ).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  test("a read that fails is logged and leaves its files; the others are still read", async () => {
    const errorLog: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "error")
      .mockImplementation((() => {
        return undefined;
      }) as never);

    const released: Map<
      string,
      Set<string>
    > = await AttachedFiles.readFilesOfRowsDeleted({
      tableName: "Incident",
      ids: [INCIDENT],
      query: async (sql: string): Promise<unknown> => {
        if (sql.includes(`FROM "IncidentPostmortemAttachmentFile"`)) {
          throw new Error("relation does not exist");
        }

        if (sql.includes(`FROM "IncidentPublicNoteFile"`)) {
          return [[{ fileId: FILE_3, projectId: PROJECT_B }], 1];
        }

        return [];
      },
    });

    expect(released).toEqual(new Map([[PROJECT_B, new Set([FILE_3])]]));
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(String(errorLog.mock.calls[0]![0])).toContain(
      "IncidentPostmortemAttachmentFile",
    );
  });
});
